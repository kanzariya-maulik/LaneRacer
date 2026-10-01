const CarPhysics = require('./CarPhysics');
const Physics = require('./Physics');

const TICK_RATE = 60;
const WALL_OFFSET = 80;     // world units past the track edge; Track.js checkpoints use the same
const QUALI_CUTOFF_S = 150; // after the flag, laps in progress get this long to finish

class Game {
    constructor(io, players, track, settings, onFinish, mode = 'race') {
        this.io = io;
        this.track = track;
        this.settings = settings;
        this.onFinish = onFinish;
        this.mode = mode;
        this.dt = 1 / TICK_RATE;
        this.time = 0;                     // session clock (s); race clock starts at lights out
        this.frozen = mode === 'race';     // race cars wait for lights out
        this.flagAt = mode === 'quali' ? settings.qualiMinutes * 60 : Infinity;
        this.flagShown = false;
        this.loopPath = null;
        this.winnerCount = 0;

        const cpCount = track.checkpoints.length;
        this.players = {};
        players.forEach((p, index) => {
            const slot = track.startPositions[index % track.startPositions.length];
            this.players[p.id] = {
                id: p.id,
                username: p.username,
                teamId: p.teamId,
                x: slot.x, y: slot.y, angle: slot.angle,
                vx: 0, vy: 0, speed: 0, steer: 0,
                lastSafeX: slot.x, lastSafeY: slot.y,
                lap: 0,
                // Race cars sit behind the line having "passed" checkpoint 0; quali cars must cross it to start a lap
                checkpoint: mode === 'quali' ? cpCount - 1 : 0,
                progress: 0,
                passTimes: { 0: 0 },
                lapStart: mode === 'race' ? 0 : null,
                lastLap: null,
                bestLap: null,
                finished: false,
                finishOrder: 0,
                rank: index + 1,
                gap: null,
                lapsDown: 0,
                joinOrder: index,
                input: { throttle: 0, brake: 0, steer: 0 }
            };
        });
    }

    static rankPlayers(players, checkpoints) {
        const distToNext = (p) => {
            const cp = checkpoints[(p.checkpoint + 1) % checkpoints.length];
            return Math.hypot(p.x - cp.x, p.y - cp.y);
        };
        return [...players].sort((a, b) => {
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            if (a.finished) return a.finishOrder - b.finishOrder;
            if (a.lap !== b.lap) return b.lap - a.lap;
            if (a.checkpoint !== b.checkpoint) return b.checkpoint - a.checkpoint;
            return distToNext(a) - distToNext(b);
        });
    }

    static qualiOrder(players) {
        return [...players].sort((a, b) => {
            if (a.bestLap === null || b.bestLap === null) {
                if (a.bestLap === b.bestLap) return a.joinOrder - b.joinOrder;
                return a.bestLap === null ? 1 : -1;
            }
            return a.bestLap - b.bestLap;
        });
    }

    initPayload() {
        return { players: this.players, track: this.track, mode: this.mode };
    }

    handleInput(id, input) {
        if (this.players[id]) this.players[id].input = input; // kept while frozen, applies at lights out
    }

    removePlayer(id) {
        delete this.players[id];
    }

    start() {
        this.io.emit('game_init', this.initPayload());
        if (this.mode === 'quali') this.io.emit('session', { phase: 'QUALIFYING', endsInMs: this.flagAt * 1000 });
        this.loopPath = setInterval(() => this.update(), 1000 / TICK_RATE);
    }

    stop() {
        if (this.loopPath) clearInterval(this.loopPath);
        this.loopPath = null;
    }

    release() {
        this.frozen = false;
        this.time = 0;
    }

    drive(p) {
        const t = this.track, scale = t.scale;
        const before = Physics.nearestOnTrack(p.x, p.y, t);
        CarPhysics.step(p, p.input, this.dt, scale, before.dist > t.width / 2);

        const wallDist = t.width / 2 + WALL_OFFSET;
        const after = Physics.nearestOnTrack(p.x, p.y, t);
        if (after.dist > wallDist) {
            const nx = (p.x - after.px) / after.dist, ny = (p.y - after.py) / after.dist;
            p.x = after.px + nx * (wallDist - 1);
            p.y = after.py + ny * (wallDist - 1);
            const vn = p.vx * nx + p.vy * ny;
            const v = Math.hypot(p.vx, p.vy);
            if (vn > 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
            // Speed loss scales with how square-on the hit is: head-on keeps WALL_KEEP, a graze keeps almost all
            const impact = v > 0 ? Math.max(0, vn) / v : 0;
            const keep = 1 - (1 - CarPhysics.C.WALL_KEEP) * impact;
            p.vx *= keep;
            p.vy *= keep;
            p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
        }

        if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
            p.lastSafeX = p.x;
            p.lastSafeY = p.y;
        } else {
            p.x = p.lastSafeX; p.y = p.lastSafeY;
            p.vx = p.vy = p.speed = 0;
            if (!Number.isFinite(p.angle)) p.angle = 0;
        }
    }

    update() {
        const ids = Object.keys(this.players);
        if (!this.frozen) {
            this.time += this.dt;
            for (const id of ids) {
                const p = this.players[id];
                if (this.mode === 'race' && p.finished) continue;
                this.drive(p);
                this.checkLapProgress(p);
            }
            if (this.mode === 'race') {
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        const a = this.players[ids[i]], b = this.players[ids[j]];
                        if (!a.finished && !b.finished) Physics.resolveCarCollision(a, b, this.track.scale);
                    }
                }
            }
        }

        if (this.mode === 'quali' && !this.flagShown && this.time >= this.flagAt) {
            this.flagShown = true;
            this.io.emit('session', { phase: 'QUALI_FLAG', endsInMs: QUALI_CUTOFF_S * 1000 });
        }

        this.updateRanks();

        const stateSync = {};
        for (const id in this.players) {
            const p = this.players[id];
            stateSync[id] = {
                x: p.x, y: p.y, angle: p.angle, speed: p.speed, steer: p.steer,
                lap: p.lap, checkpoint: p.checkpoint, rank: p.rank, finished: p.finished,
                gap: p.gap, lapsDown: p.lapsDown, lastLap: p.lastLap, bestLap: p.bestLap,
                curLap: p.lapStart === null || p.finished ? null : this.time - p.lapStart,
                ghost: this.mode === 'quali'
            };
        }
        this.io.volatile.emit('game_state', stateSync);

        const active = ids.filter(id => !this.players[id].finished).length;
        const over = this.mode === 'race'
            ? active === 0
            : active === 0 || this.time >= this.flagAt + QUALI_CUTOFF_S;
        if (over) {
            this.stop();
            if (this.mode === 'quali') {
                this.onFinish(Game.qualiOrder(Object.values(this.players)).map(p => ({ id: p.id, bestLap: p.bestLap })));
            } else {
                this.onFinish();
            }
        }
    }

    updateRanks() {
        const list = Object.values(this.players);
        if (!list.length) return;
        const ranked = this.mode === 'quali' ? Game.qualiOrder(list) : Game.rankPlayers(list, this.track.checkpoints);
        const leader = ranked[0];
        const cpCount = this.track.checkpoints.length;
        ranked.forEach((p, i) => {
            p.rank = i + 1;
            if (this.mode === 'quali') {
                p.lapsDown = 0;
                p.gap = i > 0 && p.bestLap !== null && leader.bestLap !== null ? p.bestLap - leader.bestLap : null;
            } else {
                p.lapsDown = Math.floor((leader.progress - p.progress) / cpCount);
                const mine = p.passTimes[p.progress], theirs = leader.passTimes[p.progress];
                p.gap = i > 0 && p.lapsDown === 0 && mine !== undefined && theirs !== undefined ? mine - theirs : null;
            }
        });
    }

    recordLap(p) {
        const lapTime = this.time - p.lapStart;
        p.lastLap = lapTime;
        if (p.bestLap === null || lapTime < p.bestLap) p.bestLap = lapTime;
        p.lapStart = this.time;
        this.io.emit('timing', { id: p.id, lap: p.lap, lapTime, bestLap: p.bestLap });
    }

    checkLapProgress(p) {
        const cps = this.track.checkpoints;
        const target = (p.checkpoint + 1) % cps.length;
        const cp = cps[target];
        if (Math.hypot(p.x - cp.x, p.y - cp.y) >= cp.radius) return;

        p.checkpoint = target;
        p.progress++;
        p.passTimes[p.progress] = this.time;
        if (target !== 0) return;

        // Crossed the start/finish line
        if (this.mode === 'race') {
            p.lap++;
            this.recordLap(p);
            if (p.lap >= this.settings.maxLaps) {
                p.finished = true;
                this.winnerCount++;
                p.finishOrder = this.winnerCount;
                this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username} finished P${p.finishOrder}!` });
            }
            return;
        }
        if (p.finished) return; // already took the chequered flag
        if (p.lapStart !== null) {
            p.lap++;
            this.recordLap(p);
        }
        if (this.time >= this.flagAt) {
            p.finished = true;     // chequered flag: session over for this car
            p.lapStart = null;
            return;
        }
        p.lapStart = this.time;
    }
}

module.exports = Game;
