const Physics = require('./Physics');
const Drive = require('../../public/js/sim/drive.js');
const Ticker = require('../ticker');
const { pointAt } = require('./Track');
const RacingLine = require('./RacingLine');
const Logger = require('../logger');

const TICK_RATE = 60;
const QUALI_LAPS = 2;       // flying laps after the out-lap
const QUALI_MAX_S = 360;    // quali ends at this session time even if someone never finishes
const LIMIT_WARNINGS = 2;    // race: violations before penalties start
const LIMIT_PENALTY_S = 5;
const JUMP_PENALTY_S = 10;    // moving before lights out
const JUMP_MOVE_M = 0.5;      // further than this from the grid slot = moved
const FINISH_WINDOW_S = 60;   // after the winner finishes, the rest have this long before they're classified DNF
const INPUT_TIMEOUT_S = 0.3;  // no input for this long = controls released
const INPUT_QUEUE_MAX = 4;    // inputs buffered per player; a burst beyond this drops its oldest
const DRS_GAP_S = 1;          // race: within this of the car ahead at the detection point
const SLIP_MAX = 0.2;         // drag cut right behind another car…
const SLIP_MIN_M = 5, SLIP_RANGE_M = 40, SLIP_LAT_M = 3; // …fading out by 40 m behind, only roughly in line

const FLAGS = { inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 };
const META_FIELDS = ['lap', 'checkpoint', 'rank', 'gap', 'lapsDown', 'lastLap', 'bestLap', 'lapStart', 'bestLapSectors', 'lastValid', 'penalty'];
const META_EVERY = 6; // ticks: info updates at 10 Hz
const r1 = (v) => Math.round(v * 10) / 10;

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
        this.time = 0;                     // race clock (s), starts at lights out
        this.clock = 0;                    // session clock (s) for client interpolation, never frozen
        this.frozen = mode === 'race';     // race: lights still on — cars can move, but that's a jump start
        this.paused = false;               // host pause state
        this.ticker = null;
        this.winnerCount = 0;
        this.bestSectors = [null, null, null]; // session bests, valid laps only
        this.bestSectorIds = [null, null, null]; // who holds each (purple sector)
        this.fastestLap = null;                // { id, time, lap }: purple lap, valid laps only
        this.lastDetect = [];                  // per DRS zone: time the last car crossed its detection point

        const cpCount = track.checkpoints.length;
        this.players = {};
        this.index = {}; this.seq = 0; this.sentMeta = {};
        const boxes = mode === 'quali' && track.pit ? Game.garageSlots(players, track) : null;
        players.forEach((p, index) => {
            this.index[p.id] = index;
            const slot = boxes ? boxes[index] : track.startPositions[index % track.startPositions.length];
            this.players[p.id] = {
                id: p.id,
                username: p.username,
                teamId: p.teamId,
                assist: p.assist || 'off',
                isBot: !!p.isBot,
                x: slot.x, y: slot.y, angle: slot.angle,
                vx: 0, vy: 0, speed: 0, steer: 0,
                inPit: false, limiter: false, pitS: 0,
                limits: 0, penalty: 0, offLimits: false, finishTime: null,
                lastSafeX: slot.x, lastSafeY: slot.y, gridX: slot.x, gridY: slot.y, jumpStart: false, reacted: false,
                drs: false, drsAvailable: false, drsEligible: [], tow: 0, lapS: null,
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
                input: { throttle: 0, brake: 0, steer: 0 },
                queue: [], lastSeq: -1, starve: 0, // prediction clients: sequenced inputs, last applied, ticks with none
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

    // 60 Hz: only what moves, packed small
    fastPacket() {
        const c = [];
        for (const id in this.players) {
            const p = this.players[id];
            const flags = (p.inPit && FLAGS.inPit) | (p.limiter && FLAGS.limiter) | (p.drs && FLAGS.drs)
                | (p.drsAvailable && FLAGS.drsAvailable) | (p.finished && FLAGS.finished)
                | (p.lapValid && FLAGS.lapValid) | ((this.mode === 'quali' || this.settings.collisions === false) && FLAGS.ghost);
            c.push([this.index[id], r1(p.x), r1(p.y), +p.angle.toFixed(4), r1(p.speed), +p.steer.toFixed(3), flags,
                    r1(p.vx), r1(p.vy), +(p.tow || 0).toFixed(2), p.lastSeq]);
        }
        return { s: this.seq, t: +this.clock.toFixed(3), g: +this.time.toFixed(3), c };
    }

    // Slow fields, only those that changed since the last info update
    metaDiff() {
        const diff = {};
        for (const id in this.players) {
            const p = this.players[id], sent = this.sentMeta[id] || (this.sentMeta[id] = {});
            for (const f of META_FIELDS) {
                const v = JSON.stringify(p[f] ?? null);
                if (sent[f] === v) continue;
                sent[f] = v;
                (diff[id] || (diff[id] = {}))[f] = p[f] ?? null;
            }
        }
        return diff;
    }

    initPayload() {
        // Late joiners also need the quali clock and the session-best sectors (tower colours)
        const session = this.mode === 'quali' ? { phase: 'QUALIFYING', endsInMs: Math.max(0, (QUALI_MAX_S - this.time) * 1000) } : null;
        return { players: this.players, track: this.track, mode: this.mode, index: this.index, session, bestSectors: this.bestSectors, bestSectorIds: this.bestSectorIds, fastestLap: this.fastestLap };
    }

    handleInput(id, input) {
        const p = this.players[id];
        if (!p) return;
        p.input = input; // kept while frozen, applies at lights out
        p.inputAt = this.clock;
    }

    // Prediction clients: each tick applies exactly one queued input, in sequence order
    handleInputs(id, list) {
        const p = this.players[id];
        if (!p) return;
        // Far behind the server's slots (stalled tab, reconnect): re-align to this client instead of dropping it forever
        if (list.length && Math.max(...list.map((i) => i.seq)) < p.lastSeq - INPUT_QUEUE_MAX) {
            p.lastSeq = Math.max(p.applied ?? -1, Math.min(...list.map((i) => i.seq)) - 1); // the batch's resends were already applied
            p.queue = [];
        }
        const top = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
        for (const i of list) if (i.seq > top && !p.queue.some((q) => q.seq === i.seq)) p.queue.push(i);
        p.queue.sort((a, b) => a.seq - b.seq);
        p.inputAt = this.clock;
    }

    removePlayer(id) {
        delete this.players[id];
    }

    start() {
        this.io.emit('game_init', this.initPayload());
        if (this.mode === 'quali') this.io.emit('session', { phase: 'QUALIFYING', endsInMs: QUALI_MAX_S * 1000 });
        this.ticker = new Ticker(1000 / TICK_RATE, () => this.timedUpdate());
        this.ticker.start();
    }

    stop() {
        if (this.ticker) this.ticker.stop();
        this.ticker = null;
    }

    // update() plus a tick-cost average and a once-a-second net_stats for the overlay
    timedUpdate() {
        if (this.paused) return;
        const t0 = process.hrtime.bigint();
        this.update();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        this.tickMs = this.tickMs === undefined ? ms : this.tickMs + (ms - this.tickMs) * 0.05;
        if (this.seq % TICK_RATE === 0) {
            const starve = {};
            for (const id in this.players) { starve[id] = this.players[id].starve; this.players[id].starve = 0; }
            this.io.emit('net_stats', { tickMs: +this.tickMs.toFixed(2), starve });
        }
    }

    // DRS: race — within 1 s of the car ahead at a zone's detection point, from lap 2; quali — free in the zones.
    // The driver opens it with the button; braking or leaving the zone closes it.
    updateDrs(p, prevS, curS) {
        const t = this.track, total = t.cum[t.path.length], race = this.mode === 'race';
        const passed = (x) => {
            const step = (curS - prevS + total) % total, d = (x - prevS + total) % total;
            return step < total / 2 && d > 0 && d <= step;
        };
        const inZone = (z) => (z.startS <= z.endS ? curS >= z.startS && curS < z.endS : curS >= z.startS || curS < z.endS);
        let available = false;
        t.drsZones.forEach((z, k) => {
            if (race && passed(z.detectS)) {
                p.drsEligible[k] = this.time - (this.lastDetect[k] ?? -Infinity) <= DRS_GAP_S;
                this.lastDetect[k] = this.time;
            }
            if (inZone(z) && !p.inPit && (!race || (p.lap >= 1 && p.drsEligible[k]))) available = true;
        });
        p.drsAvailable = available;
        if (!available || p.input.brake > 0) p.drs = false;
        else if (p.input.drs) p.drs = true;
    }

    // Slipstream: drag cut for a car close behind another, roughly in line and pointing the same way
    updateTow() {
        const list = Object.values(this.players), sc = this.track.scale;
        for (const p of list) {
            p.tow = 0;
            if (p.finished) continue;
            const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
            for (const o of list) {
                if (o === p || o.finished) continue;
                const dx = o.x - p.x, dy = o.y - p.y;
                const ahead = (dx * fx + dy * fy) / sc, side = Math.abs(-dx * fy + dy * fx) / sc;
                if (ahead < SLIP_MIN_M || ahead > SLIP_RANGE_M || side > SLIP_LAT_M || Math.cos(o.angle - p.angle) < 0.9) continue;
                p.tow = Math.max(p.tow, SLIP_MAX * (1 - (ahead - SLIP_MIN_M) / (SLIP_RANGE_M - SLIP_MIN_M)));
            }
        }
    }

    // Moved off the grid slot before lights out: +5 s, once
    checkJumpStart(p) {
        if (p.input.throttle > 0) p.throttledEarly = true; // only the driver's own throttle counts, not a shunt from behind
        if (p.jumpStart || !p.throttledEarly || Math.hypot(p.x - p.gridX, p.y - p.gridY) <= JUMP_MOVE_M * this.track.scale) return;
        p.jumpStart = true;
        p.penalty += JUMP_PENALTY_S;
        this.io.emit('track_limits', { id: p.id, kind: 'jump', penalty: p.penalty });
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: jump start, +${JUMP_PENALTY_S}s penalty` });
    }

    // Time from lights out to the first throttle
    reaction(p) {
        p.reacted = true;
        this.io.emit('reaction', { id: p.id, time: this.time });
    }

    release() {
        this.frozen = false;
        this.time = 0;
    }

    // Motion is shared with the browser (driveCar); the rest is the referee's job
    drive(p) {
        const t = this.track, wasLimited = p.limiter;
        const after = Drive.driveCar(p, p.input, t, this.dt);
        if (this.mode === 'quali' && p.limiter && !wasLimited) p.lapStart = p.sectorStart = null; // crossing the pit entry line ends a timed lap
        this.checkLimits(p, after);
        const total = t.cum[t.path.length];
        const lapS = (((t.cum[after.i] + after.t * (t.cum[after.i + 1] - t.cum[after.i]) - t.startS) % total) + total) % total;
        this.updateDrs(p, p.lapS ?? lapS, lapS);
        p.lapS = lapS;
    }

    // In the pit lane = on pit asphalt and off the track's (where they overlap, it's track)
    updatePit(p, near = Physics.nearestOnTrack(p.x, p.y, this.track), nearPit = Physics.nearestOnPath(p.x, p.y, this.track.pit.path, false)) {
        const wasLimited = p.limiter;
        Drive.updatePitState(p, this.track, near, nearPit);
        // Crossing the pit entry line ends a timed lap
        if (this.mode === 'quali' && p.limiter && !wasLimited) p.lapStart = p.sectorStart = null;
    }

    updateBotInput(p) {
        const t = this.track;
        if (!t._racingLinePoints && t.racingLine?.offset) {
            t._racingLinePoints = RacingLine.linePoints(t.path, t.racingLine.offset);
        }
        const rlPoints = t._racingLinePoints || t.path;
        const near = Physics.nearestOnTrack(p.x, p.y, t);
        const curS = t.cum[near.i] + near.t * (t.cum[near.i + 1] - t.cum[near.i]);
        const speedMs = Math.abs(p.speed) / t.scale;

        // Speed-sensitive lookahead: 14m at low speed, up to 26m at high speed
        const lookAheadM = Math.max(14, Math.min(26, 12 + speedMs * 0.15));
        const lookAheadDist = lookAheadM * t.scale;
        const totalS = t.cum[t.path.length];
        const targetS = (((curS + lookAheadDist) % totalS) + totalS) % totalS;

        // Interpolate target point along the optimal racing line
        const n = t.path.length;
        let idx = 0;
        for (let i = 0; i < n; i++) {
            if (t.cum[i + 1] >= targetS) { idx = i; break; }
        }
        const span = Math.max(1, t.cum[idx + 1] - t.cum[idx]);
        const tRatio = Math.max(0, Math.min(1, (targetS - t.cum[idx]) / span));
        const p1 = rlPoints[idx], p2 = rlPoints[(idx + 1) % n];
        const targetX = p1.x + tRatio * (p2.x - p1.x);
        const targetY = p1.y + tRatio * (p2.y - p1.y);

        const targetAngle = Math.atan2(targetY - p.y, targetX - p.x);
        let angleDiff = targetAngle - p.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const steerTarget = Math.max(-1, Math.min(1, angleDiff * 3.0));

        // Speed target from racing line speed profile
        const targetSpeedMs = t.racingLine?.speed ? t.racingLine.speed[near.i] : Infinity;
        const needBrake = !this.frozen && speedMs > targetSpeedMs * 1.02;

        p.assist = '100,100';
        p.input = {
            throttle: this.frozen ? 0 : (needBrake ? 0 : 1.0),
            brake: this.frozen ? 0 : (needBrake ? Math.min(1, (speedMs - targetSpeedMs) / 5) : 0),
            steer: steerTarget,
            drs: true,
            isBot: true
        };

        if (this.seq % 30 === 0) {
            Logger.bot(`status: ${this.frozen ? 'FROZEN' : 'RACING'} | pos: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) | speed: ${(speedMs * 3.6).toFixed(1)} km/h (target: ${(targetSpeedMs * 3.6).toFixed(1)} km/h) | steer: ${steerTarget.toFixed(2)} | throttle: ${p.input.throttle} | brake: ${p.input.brake.toFixed(2)} | lap: ${p.lap} | cp: ${p.checkpoint} | limits: ${p.limits}`);
        }
    }

    update() {
        const ids = Object.keys(this.players);
        {
            if (!this.frozen) this.time += this.dt; // race clock starts at lights out
            this.clock += this.dt;
            // The client resends every 100 ms; silence (hidden tab, dropped link) means let go, not full throttle forever
            for (const id of ids) {
                const p = this.players[id];
                if (p.isBot) {
                    this.updateBotInput(p);
                    continue;
                }
                if (p.inputAt !== undefined && this.clock - p.inputAt > INPUT_TIMEOUT_S) p.input = { throttle: 0, brake: 0, steer: 0, drs: false };
                // One input slot per tick. A missing input is guessed (last one repeated) in its own slot and its late copy
                // dropped, so the server never runs an extra tick the client didn't: corrections stay input-sized, not a tick of travel
                while (p.queue.length && p.queue[0].seq <= p.lastSeq) p.queue.shift();
                if (p.queue.length > INPUT_QUEUE_MAX) {
                    p.queue.splice(0, p.queue.length - INPUT_QUEUE_MAX);
                    p.lastSeq = p.queue[0].seq - 1; // buffered too far ahead: skip to the newest four
                }
                if (p.queue.length && (p.lastSeq < 0 || p.queue[0].seq === p.lastSeq + 1)) {
                    p.input = p.queue.shift();
                    p.lastSeq = p.applied = p.input.seq; // applied: real inputs only, lastSeq also counts guessed slots
                } else if (p.lastSeq >= 0 && this.clock - p.inputAt <= INPUT_TIMEOUT_S) {
                    p.lastSeq++;
                    p.starve++;
                }
            }
            if (this.mode === 'race') this.updateTow();
            for (const id of ids) {
                const p = this.players[id];
                if (p.finished) continue; // finished race cars and parked quali cars stay put
                this.drive(p);
                if (this.frozen) this.checkJumpStart(p);
                else {
                    if (this.mode === 'race' && !p.reacted && p.input.throttle > 0) this.reaction(p);
                    this.checkLapProgress(p);
                }
            }
            if (this.mode === 'race' && this.settings.collisions !== false) { // host can turn contact off
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        const a = this.players[ids[i]], b = this.players[ids[j]];
                        if (!a.finished && !b.finished) Physics.resolveCarCollision(a, b, this.track.scale);
                    }
                }
            }
        }

        // A parked or disconnected-in-spirit car can't hold everyone on track forever
        if (this.mode === 'race' && this.firstFinishAt !== undefined && this.time - this.firstFinishAt > FINISH_WINDOW_S) {
            for (const id of ids) {
                const p = this.players[id];
                if (!p.finished) Object.assign(p, { finished: true, dnf: true, finishTime: null, vx: 0, vy: 0, speed: 0 });
            }
        }
        if (this.mode === 'race' && !this.classified && ids.length && ids.every(id => this.players[id]?.finished)) this.classify();
        this.updateRanks();

        this.seq++;
        const packet = this.fastPacket();
        if (this.net) this.net.broadcastGameState(packet, this.io); // UDP, Socket.IO until a peer's channel opens
        else this.io.volatile.emit('game_state', packet);
        if (this.seq % META_EVERY === 1) {
            const diff = this.metaDiff();
            if (Object.keys(diff).length) this.io.emit('game_meta', diff);
        }

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
                // Cars are timed at their own last checkpoint, so a car can read closer than the one ahead: never show that
                const ahead = i > 1 ? ranked[i - 1].gap : 0;
                if (p.gap !== null && ahead !== null && p.gap < ahead) p.gap = ahead;
            }
        });
    }

    // All four wheels past the white line, once per excursion; pit lane, quali out-lap exempt
    checkLimits(p, near) {
        const t = this.track;
        if (near.dist <= t.width / 2) { p.offLimits = false; return; }
        if (this.frozen) return; // lights still on: jump starts are judged separately
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

    // Final result: finish time plus penalties, once every car has finished; everyone gets the results screen
    classify() {
        this.classified = true;
        const all = Object.values(this.players);
        const list = all.filter((p) => !p.dnf).sort((a, b) => a.finishTime + a.penalty - (b.finishTime + b.penalty))
            .concat(all.filter((p) => p.dnf).sort((a, b) => b.progress - a.progress)); // DNF last, furthest first
        const winner = list[0] && !list[0].dnf ? list[0].finishTime + list[0].penalty : null;
        const rows = list.map((p, i) => {
            const total = p.dnf ? null : p.finishTime + p.penalty;
            return {
                id: p.id, position: i + 1, finishTime: p.dnf ? null : p.finishTime, penalty: p.penalty, total,
                gap: i === 0 || total === null ? null : total - winner,
                change: p.dnf || !p.finishOrder ? 0 : p.finishOrder - (i + 1), // places won (+) or lost (−) to penalties
                laps: p.lap, bestLap: p.bestLap, dnf: !!p.dnf,
            };
        });
        list.forEach((p, i) => { p.finishOrder = i + 1; });
        this.io.emit('race_results', { rows, fastestLapId: this.fastestLap?.id ?? null });
    }

    recordLap(p) {
        const lapTime = this.time - p.lapStart;
        p.lastLap = lapTime;
        p.lastValid = p.lapValid;
        if (p.lapValid) { // bests only from completed valid laps
            p.sectors.forEach((s, i) => {
                if (s === null) return;
                if (p.bestSectors[i] === null || s < p.bestSectors[i]) p.bestSectors[i] = s;
                if (this.bestSectors[i] === null || s < this.bestSectors[i]) { this.bestSectors[i] = s; this.bestSectorIds[i] = p.id; }
            });
        }
        if (p.lapValid && (p.bestLap === null || lapTime < p.bestLap)) {
            p.bestLap = lapTime;
            p.bestLapSectors = [...p.sectors];
        }
        if (p.lapValid && (this.fastestLap === null || lapTime < this.fastestLap.time)) {
            this.fastestLap = { id: p.id, time: lapTime, lap: p.lap };
            this.io.emit('fastest_lap', this.fastestLap); // everyone's screen shows the purple fastest-lap graphic
        }
        p.lapStart = this.time;
        this.io.emit('timing', { id: p.id, lap: p.lap, lapTime, bestLap: p.bestLap, valid: p.lapValid,
            sessionBest: this.bestSectors, bestSectorIds: this.bestSectorIds, fastestLap: this.fastestLap });
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
                p.vx = p.vy = p.speed = 0; // parked: a moving velocity would make other clients dead-reckon it forward
                this.winnerCount++;
                p.finishOrder = this.winnerCount;
                if (this.winnerCount === 1) this.firstFinishAt = this.time;
            }
            return;
        }
        if (p.finished) return;
        if (p.lapStart !== null) {
            p.lap++;
            this.recordLap(p);
            const maxQualiLaps = Number.isFinite(this.settings.qualiLaps) && this.settings.qualiLaps > 0 ? this.settings.qualiLaps : QUALI_LAPS;
            if (p.lap >= maxQualiLaps) { // run complete: park the car
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

Game.FLAGS = FLAGS;
Game.META_FIELDS = META_FIELDS;
module.exports = Game;
