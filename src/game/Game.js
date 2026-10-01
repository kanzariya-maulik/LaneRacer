const CarPhysics = require('./CarPhysics');
const Physics = require('./Physics');
const Assist = require('./Assist');
const { pointAt } = require('./Track');

const TICK_RATE = 60;
const WALL_OFFSET = 80;     // world units past the track edge; Track.js checkpoints use the same
const QUALI_LAPS = 2;       // flying laps after the out-lap
const QUALI_MAX_S = 360;    // quali ends at this session time even if someone never finishes
const PIT_LIMIT_KMH = 80;
const PIT_RUNOFF_M = 2;     // barrier this far outside the pit lane edge
const KERB_M = 1.5;          // kerbs past the track edge drive like asphalt
const LIMIT_WARNINGS = 2;    // race: violations before penalties start
const LIMIT_PENALTY_S = 5;

// Distance along the pit lane of a nearestOnPath result
const pitAlong = (pit, n) => pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);

// Barrier response: n points from the barrier back toward the car
function bounce(p, nx, ny) {
    const vn = -(p.vx * nx + p.vy * ny); // speed into the barrier
    const v = Math.hypot(p.vx, p.vy);
    if (vn > 0) { p.vx += vn * nx; p.vy += vn * ny; }
    // Speed loss scales with how square-on the hit is: head-on keeps WALL_KEEP, a graze keeps almost all
    const impact = v > 0 ? Math.max(0, vn) / v : 0;
    const keep = 1 - (1 - CarPhysics.C.WALL_KEEP) * impact;
    p.vx *= keep;
    p.vy *= keep;
    p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
}


class Game {
    // net: optional transport (src/webrtcManager.js) that sends game_state over the UDP DataChannel
    constructor(io, players, track, settings, onFinish, mode = 'race', net = null) {
        this.io = io;
        this.net = net;
        this.track = track;
        this.settings = settings;
        this.onFinish = onFinish;
        this.mode = mode;
        this.dt = 1 / TICK_RATE;
        this.time = 0;                     // session clock (s); race clock starts at lights out
        this.frozen = mode === 'race';     // race cars wait for lights out
        this.loopPath = null;
        this.winnerCount = 0;
        this.bestSectors = [null, null, null]; // session bests, valid laps only

        const cpCount = track.checkpoints.length;
        this.players = {};
        const boxes = mode === 'quali' && track.pit ? Game.garageSlots(players, track) : null;
        players.forEach((p, index) => {
            const slot = boxes ? boxes[index] : track.startPositions[index % track.startPositions.length];
            this.players[p.id] = {
                id: p.id,
                username: p.username,
                teamId: p.teamId,
                assist: p.assist || 'off',
                x: slot.x, y: slot.y, angle: slot.angle,
                vx: 0, vy: 0, speed: 0, steer: 0,
                inPit: false, limiter: false, pitS: 0,
                limits: 0, penalty: 0, offLimits: false, finishTime: null,
                lastSafeX: slot.x, lastSafeY: slot.y,
                lap: 0,
                // Race cars sit behind the line having "passed" checkpoint 0; quali cars must cross it to start a lap
                checkpoint: mode === 'quali' ? cpCount - 1 : 0,
                progress: 0,
                passTimes: { 0: 0 },
                lapStart: mode === 'race' ? 0 : null,
                lastLap: null,
                bestLap: null,
                sectors: [null, null, null],
                bestSectors: [null, null, null],
                bestLapSectors: null,
                lapValid: true,
                lastValid: null,
                sectorStart: mode === 'race' ? 0 : null, // quali: untimed out-lap
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

    // Each driver's box in their team's garage; unknown teams use the first garage
    // ponytail: a third driver on one team reuses box 0; the lobby caps teams at 2
    static garageSlots(players, track) {
        const used = {};
        return players.map((p) => {
            const g = track.pit.garages.find(x => x.teamId === p.teamId) || track.pit.garages[0];
            used[g.teamId] = (used[g.teamId] || 0) + 1;
            return g.boxes[(used[g.teamId] - 1) % 2];
        });
    }

    // Lap progress for a car in the pit lane: the matching point on the track
    trackPos(p) {
        const t = this.track, pit = t.pit;
        if (!p.inPit) return p;
        return pointAt(t.path, t.cum, pit.entryS + (p.pitS / pit.len) * pit.span);
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
        if (this.mode === 'quali') this.io.emit('session', { phase: 'QUALIFYING', endsInMs: QUALI_MAX_S * 1000 });
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
        const t = this.track, scale = t.scale, pit = t.pit;
        const x0 = p.x, y0 = p.y;
        const nearPit = (x, y) => (pit ? Physics.nearestOnPath(x, y, pit.path, false) : null);
        const before = Physics.nearestOnTrack(p.x, p.y, t), beforePit = nearPit(p.x, p.y);
        const grass = before.dist > t.width / 2 + KERB_M * scale && !(beforePit && beforePit.dist <= pit.width / 2 && pitAlong(pit, beforePit) >= pit.closeS);
        const input = p.assist === 'full' && !p.inPit ? Assist.brakeAssist(p, p.input, t, before) : p.input;
        CarPhysics.step(p, input, this.dt, scale, grass, p.assist);

        // Pit wall: a move across it is undone
        const hit = pit && (Physics.crossWall(x0, y0, p.x, p.y, pit.wall) || Physics.crossWall(x0, y0, p.x, p.y, pit.closeWall));
        if (hit) {
            p.x = x0 + hit.nx * 0.5;
            p.y = y0 + hit.ny * 0.5;
            bounce(p, hit.nx, hit.ny);
        }
        // …and the pit entry barrier stops the whole car body, not just its centre
        // ponytail: the pit wall stays centre-only — on the 1.5×-wide tracks it sits ~0.6 m past the line, inside the kerb
        const o = pit && Physics.wallOverlap(p, pit.closeWall, scale);
        if (o) { p.x += o.nx * o.depth; p.y += o.ny * o.depth; bounce(p, o.nx, o.ny); }

        // Barrier: outside both the track's run-off and the pit lane's
        const wallDist = t.width / 2 + WALL_OFFSET;
        const pitDist = pit && pit.width / 2 + PIT_RUNOFF_M * scale;
        const after = Physics.nearestOnTrack(p.x, p.y, t), afterPit = nearPit(p.x, p.y);
        // The pit lane upstream of the closure barrier is off-limits (no pit stops)
        const afterS = afterPit && pitAlong(pit, afterPit);
        const overTrack = after.dist - wallDist, overPit = afterPit && afterS >= pit.closeS ? afterPit.dist - pitDist : Infinity;
        if (overTrack > 0 && overPit > 0) {
            const [near, lim] = overPit < overTrack ? [afterPit, pitDist] : [after, wallDist];
            const nx = (p.x - near.px) / near.dist, ny = (p.y - near.py) / near.dist;
            p.x = near.px + nx * (lim - 1);
            p.y = near.py + ny * (lim - 1);
            bounce(p, -nx, -ny);
        }
        // Barrier stops the car body: pull the centre in by how far the rectangle reaches toward it
        const edge = Physics.nearestOnTrack(p.x, p.y, t), edgePit = nearPit(p.x, p.y);
        const reach = (n) => n.dist > 1e-9 ? Physics.carReach(p, (p.x - n.px) / n.dist, (p.y - n.py) / n.dist, scale) : 0;
        const inTrack = edge.dist + reach(edge) <= wallDist;
        const inPitLane = edgePit && pitAlong(pit, edgePit) >= pit.closeS && edgePit.dist + reach(edgePit) <= pitDist;
        if (!inTrack && !inPitLane && edge.dist <= wallDist && !(edgePit && edgePit.dist <= pitDist && pitAlong(pit, edgePit) >= pit.closeS)) {
            const nx = (p.x - edge.px) / edge.dist, ny = (p.y - edge.py) / edge.dist;
            const lim = wallDist - reach(edge);
            p.x = edge.px + nx * lim; p.y = edge.py + ny * lim;
            bounce(p, -nx, -ny);
        }

        if (pit) this.updatePit(p, after, afterPit);
        this.checkLimits(p, after);

        if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
            p.lastSafeX = p.x;
            p.lastSafeY = p.y;
        } else {
            p.x = p.lastSafeX; p.y = p.lastSafeY;
            p.vx = p.vy = p.speed = 0;
            if (!Number.isFinite(p.angle)) p.angle = 0;
        }
    }

    // In the pit lane = on pit asphalt and off the track's (where they overlap, it's track)
    updatePit(p, near = Physics.nearestOnTrack(p.x, p.y, this.track), nearPit = Physics.nearestOnPath(p.x, p.y, this.track.pit.path, false)) {
        const t = this.track, pit = t.pit;
        const wasLimited = p.limiter;
        p.pitS = pitAlong(pit, nearPit);
        p.inPit = nearPit.dist <= pit.width / 2 && near.dist > t.width / 2 && p.pitS >= pit.closeS; // closed entry isn't pit lane
        p.limiter = p.inPit && p.pitS >= pit.limStart && p.pitS <= pit.limEnd;
        if (p.limiter) {
            const max = (PIT_LIMIT_KMH / 3.6) * t.scale, v = Math.hypot(p.vx, p.vy);
            if (v > max) {
                p.vx *= max / v;
                p.vy *= max / v;
                p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
            }
        }
        // Crossing the pit entry line ends a timed lap
        if (this.mode === 'quali' && p.limiter && !wasLimited) p.lapStart = p.sectorStart = null;
    }

    update() {
        const ids = Object.keys(this.players);
        if (!this.frozen) {
            this.time += this.dt;
            for (const id of ids) {
                const p = this.players[id];
                if (p.finished) continue; // finished race cars and parked quali cars stay put
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

        if (this.mode === 'race' && !this.classified && ids.length && ids.every(id => this.players[id]?.finished)) this.classify();
        this.updateRanks();

        const stateSync = {};
        for (const id in this.players) {
            const p = this.players[id];
            stateSync[id] = {
                x: p.x, y: p.y, angle: p.angle, speed: p.speed, steer: p.steer, inPit: p.inPit, limiter: p.limiter,
                lap: p.lap, checkpoint: p.checkpoint, rank: p.rank, finished: p.finished,
                gap: p.gap, lapsDown: p.lapsDown, lastLap: p.lastLap, bestLap: p.bestLap,
                curLap: p.lapStart === null || p.finished ? null : this.time - p.lapStart,
                lapValid: p.lapValid, lastValid: p.lastValid, penalty: p.penalty, bestLapSectors: p.bestLapSectors,
                ghost: this.mode === 'quali'
            };
        }
        if (this.net) this.net.broadcastGameState(stateSync, this.io); // UDP, Socket.IO until a peer's channel opens
        else this.io.volatile.emit('game_state', stateSync);

        const active = ids.filter(id => !this.players[id].finished).length;
        const over = this.mode === 'race'
            ? active === 0
            : active === 0 || this.time >= QUALI_MAX_S;
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

    // All four wheels past the white line, once per excursion; pit lane, quali out-lap exempt
    checkLimits(p, near) {
        const t = this.track;
        if (near.dist <= t.width / 2) { p.offLimits = false; return; }
        if (p.offLimits || p.inPit || near.dist <= t.width / 2 + Physics.CAR_HALF_WIDTH_M * t.scale) return;
        if (this.mode === 'quali' && (p.lapStart === null || p.finished)) return;
        p.offLimits = true;
        if (this.mode === 'quali') {
            p.lapValid = false; // quali: lap deleted (race: warnings / penalties only)
            this.io.emit('track_limits', { id: p.id, kind: 'deleted' });
            return;
        }
        p.limits++;
        if (p.limits <= LIMIT_WARNINGS) {
            this.io.emit('track_limits', { id: p.id, kind: 'warning', count: p.limits });
            return;
        }
        p.penalty += LIMIT_PENALTY_S;
        this.io.emit('track_limits', { id: p.id, kind: 'penalty', penalty: p.penalty });
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: +${LIMIT_PENALTY_S}s track limits penalty (total +${p.penalty}s)` });
    }

    // Final result: finish time plus penalties, once every car has finished
    classify() {
        this.classified = true;
        const list = Object.values(this.players).sort((a, b) => a.finishTime + a.penalty - (b.finishTime + b.penalty));
        const changed = list.some((p, i) => p.finishOrder !== i + 1);
        list.forEach((p, i) => { p.finishOrder = i + 1; });
        if (changed) {
            this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `Result after penalties: ${list.map((p, i) => `P${i + 1} ${p.username}`).join(', ')}` });
        }
    }

    recordLap(p) {
        const lapTime = this.time - p.lapStart;
        p.lastLap = lapTime;
        p.lastValid = p.lapValid;
        if (p.lapValid) { // bests only from completed valid laps
            p.sectors.forEach((s, i) => {
                if (s === null) return;
                if (p.bestSectors[i] === null || s < p.bestSectors[i]) p.bestSectors[i] = s;
                if (this.bestSectors[i] === null || s < this.bestSectors[i]) this.bestSectors[i] = s;
            });
        }
        if (p.lapValid && (p.bestLap === null || lapTime < p.bestLap)) {
            p.bestLap = lapTime;
            p.bestLapSectors = [...p.sectors];
        }
        p.lapStart = this.time;
        this.io.emit('timing', { id: p.id, lap: p.lap, lapTime, bestLap: p.bestLap, valid: p.lapValid, sessionBest: this.bestSectors });
        this.newLap(p);
    }

    newLap(p) {
        p.sectors = [null, null, null];
        p.lapValid = true;
        p.sectorStart = this.time;
    }

    // Sector n (1–3) just ended; colours: session best > personal best > slower, invalid laps never count
    recordSector(p, n) {
        if (p.sectorStart === null) return; // out-lap
        const time = this.time - p.sectorStart, i = n - 1;
        const personalBest = p.lapValid && (p.bestSectors[i] === null || time < p.bestSectors[i]);
        const sessionBest = p.lapValid && (this.bestSectors[i] === null || time < this.bestSectors[i]);
        p.sectors[i] = time;
        p.sectorStart = this.time;
        this.io.emit('sector', { id: p.id, lap: p.lap + 1, sector: n, time, valid: p.lapValid, personalBest, sessionBest });
    }

    checkLapProgress(p) {
        const cps = this.track.checkpoints;
        const target = (p.checkpoint + 1) % cps.length;
        const cp = cps[target];
        const pos = this.trackPos(p);
        if (Math.hypot(pos.x - cp.x, pos.y - cp.y) >= cp.radius) return;

        p.checkpoint = target;
        p.progress++;
        p.passTimes[p.progress] = this.time;
        const sec = this.track.sectorCps.indexOf(target);
        if (sec > 0) this.recordSector(p, sec); // sector 1 or 2 ended
        if (target !== 0) return;
        if (!p.finished) this.recordSector(p, 3);

        // Crossed the start/finish line
        if (this.mode === 'race') {
            p.lap++;
            this.recordLap(p);
            if (p.lap >= this.settings.maxLaps) {
                p.finished = true;
                p.finishTime = this.time;
                this.winnerCount++;
                p.finishOrder = this.winnerCount;
                this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username} finished P${p.finishOrder}!` });
            }
            return;
        }
        if (p.finished) return;
        if (p.lapStart !== null) {
            p.lap++;
            this.recordLap(p);
            if (p.lap >= QUALI_LAPS) { // run complete: park the car
                p.finished = true;
                p.lapStart = null;
                p.sectorStart = null;
                p.vx = p.vy = p.speed = 0;
            }
            return; // recordLap already started the next flying lap at the line
        }
        p.lapStart = p.inPit ? null : this.time; // out-lap: timing starts at the first crossing after pit exit
        if (p.lapStart !== null) this.newLap(p);
    }
}

module.exports = Game;
