const Physics = require('./Physics');
const netlog = require('../netlog');
const Tyres = require('../../public/js/sim/tyres.js');
const Drive = require('../../public/js/sim/drive.js');
const Ticker = require('../ticker');
const { pointAt, edgeAt } = require('./Track');
const QualiSession = require('./QualiSession');

const TICK_RATE = 60;
const CP_GATE_M = 30;        // a checkpoint also counts this far past it along the lap: wide of its circle (open grass), not a cut
const LIMIT_WARNINGS = 3;    // race: corner cuts warned before the black-and-white flag, then penalties
const BEND_SPAN_M = 25;       // a bend's direction is read over this far either side
const STRAIGHT_PER_M = 1 / 400; // turning less than this (radius > 400 m): a straight, off there is "wide"
// Car-to-car incidents (race, collisions on): who drove into whom, judged once the consequences are known
const CONTACT_LIGHT_MS = 3;      // closing slower than this (~11 km/h): rubbing wheels, not an incident
const CONTACT_BLAME_LAP1 = 3;    // first lap: only a clear hit is anyone's fault (everyone arrives at turn 1 together)
const GHOST_MAX_S = 25;          // ghost start ends by this long after lights out even if sector 1 is longer
const CONTACT_BLAME = 2;         // at fault: into the other car at least this many times as fast as it came into you
const CONTACT_GAP_S = 1;         // contact again within this: still the same coming-together
const INCIDENT_JUDGE_S = 2;      // the victim is watched this long: pushed off or spun makes it worse
const COLLISION_PENALTY_S = 5, COLLISION_OFF_PENALTY_S = 10;
const LIMIT_PENALTY_S = 5;
const JUMP_PENALTY_S = 10;    // moving before lights out
const JUMP_MOVE_M = 0.5;      // further than this from the grid slot = moved
const FINISH_WINDOW_S = 60;   // after the winner finishes, the rest have this long before they're classified DNF
const INPUT_TIMEOUT_S = 0.3;  // no input for this long = controls released
const INPUT_QUEUE_MAX = 4;    // inputs buffered per player; a burst beyond this drops its oldest
const LAG_REALIGN_BATCHES = 30; // input packets in a row landing behind the server's slots (~0.5 s) = lasting lag: re-align
const DRS_GAP_S = 1;          // race: within this of the car ahead at the detection point
const SLIP_MAX = 0.2;         // drag cut right behind another car…
const SLIP_MIN_M = 5, SLIP_RANGE_M = 40, SLIP_LAT_M = 3; // …fading out by 40 m behind, only roughly in line

const STOP_S = 2.5, STOP_SPREAD_S = 0.4, RELEASE_HOLD_S = 0.5, RELEASE_GAP_M = 10, PARK_M = 0.5, PARK_MS = 0.3;
const RELEASE_AUTO_S = 0.5, PERFECT_S = 0.2, JUMP_WINDOW_S = 1, RELEASE_JUMP_S = 0.5, RELEASE_THROTTLE = 0.5;
const COMPOUND_PENALTY_S = 22;
const BOX_NEXT_M = 200, BOX_MISS_M = 50; // box call: closer than this to the entry → next lap; this far past it → missed
const GUIDE_MAX_S = 6; // not parked by then: the car is driven out without a service (never stranded)
const LANE_MAX_S = 60, OFF_LANE_S = 1; // driven this long (wedged), or shoved out of the lane this long: the driver gets it back
const STALL_S = 5, STALL_M = 1;        // lane/out: not this much further along the lane in this long (wedged): the driver gets it back
const STOP_CODE = { guide: 1, service: 2, hold: 3, lane: 4, out: 5, wait: 6 };

const FLAGS = { inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 };
const META_FIELDS = ['lap', 'checkpoint', 'rank', 'gap', 'lapsDown', 'lastLap', 'bestLap', 'lapStart', 'bestLapSectors', 'lastValid', 'penalty', 'compound', 'nextCompound', 'stops', 'compoundsUsed', 'wearPerM', 'lastStop', 'segBest', 'qualiOut', 'boxCall'];
const META_EVERY = 6; // ticks: info updates at 10 Hz
const r1 = (v) => Math.round(v * 10) / 10;

// Signed heading change per metre of the path over ±BEND_SPAN_M around index i: > 0 turns clockwise on screen (y down),
// i.e. toward the path's right; the inside of the bend is the side it turns toward
function bendAt(t, i) {
    const P = t.path, n = P.length, span = BEND_SPAN_M * t.scale;
    let k = i, j = i, back = 0, fwd = 0;
    while (back < span) { const q = (k - 1 + n) % n; back += Math.hypot(P[k].x - P[q].x, P[k].y - P[q].y); k = q; }
    while (fwd < span) { const q = (j + 1) % n; fwd += Math.hypot(P[q].x - P[j].x, P[q].y - P[j].y); j = q; }
    const h1 = Math.atan2(P[i].y - P[k].y, P[i].x - P[k].x), h2 = Math.atan2(P[j].y - P[i].y, P[j].x - P[i].x);
    return Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)) / ((back + fwd) / t.scale);
}

const fmtLap = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;

class Game {
    // net: optional transport (src/webrtcManager.js) that sends game_state over the UDP DataChannel
    // The host's qualifying run (lobby.sanitizeSettings): timed laps, and the session limit that grows with the whole run

    constructor(io, players, track, settings, onFinish, mode = 'race', net = null) {
        this.io = io;
        this.net = net;
        this.track = track;
        this.settings = settings;
        this.contacts = new Map(); // car pair → last contact time (race incidents)
        this.incidents = [];       // hits waiting for their verdict
        this.onFinish = onFinish;
        this.mode = mode;
        this.dt = 1 / TICK_RATE;
        this.rng = settings.rng || Math.random; // pit service time
        this.time = 0;                     // race clock (s), starts at lights out
        this.clock = 0;                    // session clock (s) for client interpolation, never frozen
        this.frozen = mode === 'race';     // race: lights still on — cars can move, but that's a jump start
        this.ticker = null;
        this.winnerCount = 0;
        this.bestSectors = [null, null, null]; // live session bests (purple): completed valid laps + laps still valid
        this.bestSectorIds = [null, null, null]; // who holds each
        this.doneSectors = [null, null, null]; // bests from completed valid laps only (kept if the driver leaves)
        this.doneSectorIds = [null, null, null];
        this.fastestLap = null;                // { id, time, lap }: purple lap, valid laps only
        this.lastDetect = [];                  // per DRS zone: the last car across its detection point { id, at }

        const cpCount = track.checkpoints.length;
        this.players = {};
        this.index = {}; this.seq = 0; this.sentMeta = {};
        const boxes = track.pit ? Game.garageSlots(players, track) : null;
        players.forEach((p, index) => {
            this.index[p.id] = index;
            const slot = mode === 'quali' && boxes ? boxes[index] : track.startPositions[index % track.startPositions.length];
            this.players[p.id] = {
                id: p.id,
                username: p.username,
                teamId: p.teamId,
                assist: p.assist || 'off',
                x: slot.x, y: slot.y, angle: slot.angle,
                vx: 0, vy: 0, speed: 0, steer: 0,
                inPit: false, limiter: false, pitS: 0,
                box: boxes ? boxes[index] : null, stop: mode === 'quali' && boxes ? { phase: 'wait', t: 0, age: 0 } : null, lastStop: null,
                servicedLap: -1, pitVisits: 0, servicedVisit: -1, wasInPit: false,
                limits: 0, penalty: 0, offLimits: false, finishTime: null,
                lastSafeX: slot.x, lastSafeY: slot.y, gridX: slot.x, gridY: slot.y, jumpStart: false, reacted: false,
                drs: false, drsAvailable: false, drsEligible: [], tow: 0, lapS: null,
                ...(() => {
                    const compound = Tyres.isCompound(p.compound) ? p.compound : 'M';
                    return { compound, nextCompound: null, wear: 0, wearPerM: Game.tyreWearPerM(settings, track, compound),
                        tyreGrip: Tyres.gripOf(compound, 0), stops: 0, compoundsUsed: [compound] };
                })(),
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
                ghost: mode === 'race' && settings.ghostStart !== false,
                segBest: null, segAt: null, qualiOut: false, qualiDone: false, // qualifying segment (meta for everyone)
                boxCall: null, // race: 'this' | 'next' after the driver calls "box, box"
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
        if (mode === 'quali') {
            const format = QualiSession.effectiveFormat(settings.qualiFormat || 'short', Object.keys(this.players).length);
            const refS = (track.racingLine?.lapS || 90) * 1.15, scale = settings.qualiScale ?? 1;
            const plan = QualiSession.segmentPlan(format, refS, scale);
            this.quali = { format, segment: 1, phase: 'running', plan, refS, scale, endsAt: format === 'oneshot' ? 3 * refS * scale : plan[0],
                flagCapAt: Infinity, breakEndsAt: 0, segments: [], out: new Set(), left: [], driven: 0, evo: 1 };
        }
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

    // Wear per metre for a compound in this session (0 with tyre wear off)
    static tyreWearPerM(settings, track, compound) {
        if (settings.tyreWear === false) return 0;
        return Tyres.wearPerM(compound, track.cum[track.path.length] / track.scale, settings.maxLaps || 1);
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

    // Pit assist: entering the lane hands the car to the game (drive.js) — along the lane, onto the mark, serviced, then out to
    // the end of the limiter zone. Quali cars wait on their mark for the throttle. Driver inputs are ignored (driveCar)
    updateStop(p) {
        const t = this.track, sc = t.scale;
        if (!t.pit || !p.box || p.finished) return;
        // Only from the entry end: not onto the exit lane, nor an inPit flicker at the exit tip after the hand-back
        const entered = p.inPit && !p.wasInPit && p.pitS < t.pit.limStart;
        if (entered) { p.pitVisits++; p.entryLap = p.lap; } // quali: a fresh set every visit. Race: the lap may tick in the lane
        p.wasInPit = p.inPit;
        const thr = (p.input.throttle || 0) >= RELEASE_THROTTLE;
        // Release presses are edge-triggered: throttle held while the game drives is neither perfect nor a jump
        const press = thr && !p.thrWas;
        p.thrWas = thr;
        const go = (phase, extra = {}) => { p.stop = { phase, t: 0, age: 0, ...extra }; if (phase === 'service') p.boxCall = null; }; // the crew is on it: the call is done
        if (!p.stop) {
            if (!entered) return;
            const due = this.mode === 'quali' ? p.servicedVisit !== p.pitVisits : p.servicedLap !== p.lap;
            return go(due ? 'lane' : 'out');
        }
        const st = p.stop;
        st.age += this.dt;
        if (st.phase === 'wait') { if (thr && this.canLeaveBox(p)) go('out'); return; }
        if (st.phase === 'lane' || st.phase === 'out' || st.phase === 'guide') {
            // Out of the lane = past its edge and runoff (a hot entry running wide along the barrier is still in it)
            const n = p.inPit ? null : Physics.nearestOnPath(p.x, p.y, t.pit.path, false);
            const away = n && n.dist > Drive.pitHalf(t.pit, n) + (Drive.PIT_RUNOFF_M + 1) * sc;
            st.off = away ? (st.off || 0) + this.dt : 0;
            if (st.off >= OFF_LANE_S) return void (p.stop = null);
        }
        if (st.phase === 'lane' || st.phase === 'out') {
            if (st.best === undefined || p.pitS >= st.best + STALL_M * sc) { st.best = p.pitS; st.bestAt = st.age; }
            if (st.age - st.bestAt > STALL_S) return void (p.stop = null);
            if (st.age > LANE_MAX_S) return st.phase === 'lane' ? go('out') : void (p.stop = null);
        }
        if (st.phase === 'lane') { if (p.box.s - p.pitS <= Drive.ASSIST_HANDOVER_M * sc) go('guide'); return; }
        if (st.phase === 'guide') {
            if (Math.hypot(p.x - p.box.x, p.y - p.box.y) < PARK_M * sc && Math.hypot(p.vx, p.vy) < PARK_MS * sc) go('service', { t: STOP_S + this.rng() * STOP_SPREAD_S, parkedAt: this.clock });
            else if (st.age > GUIDE_MAX_S) go('out');
            return;
        }
        if (st.phase === 'service') {
            st.t -= this.dt;
            if (press && st.t <= JUMP_WINDOW_S) st.jumped = true;
            if (st.t > 0) return;
            this.serviceTyres(p);
            if (this.mode === 'quali') { this.recordStop(p, st.parkedAt, 'auto'); return go('wait'); }
            return go('hold', { parkedAt: st.parkedAt, greenAt: this.clock, jumped: !!st.jumped, unsafe: 0 });
        }
        if (st.phase === 'hold') {
            // Unsafe release: a moving car in the lane just behind the box holds us (at most RELEASE_HOLD_S)
            const busy = Object.values(this.players).some((q) => q !== p && q.inPit && Math.hypot(q.vx, q.vy) > sc
                && q.pitS < p.box.s && p.box.s - q.pitS < RELEASE_GAP_M * sc);
            const held = busy && st.unsafe < RELEASE_HOLD_S;
            if (held) { st.unsafe += this.dt; st.greenAt += this.dt; }
            const since = this.clock - st.greenAt - (st.jumped ? RELEASE_JUMP_S : 0);
            st.t = Math.max(0, -since) + (held ? RELEASE_HOLD_S - st.unsafe : 0); // still held this long at least (HUD: HOLD)
            if (held) return;
            if (since < 0) return;
            const pressed = press && !st.jumped;
            if (!pressed && since < RELEASE_AUTO_S) return;
            this.recordStop(p, st.parkedAt, st.jumped ? 'jumped' : pressed && since <= PERFECT_S ? 'perfect' : 'auto');
            return go('out');
        }
        if (st.phase === 'out' && (p.pitS >= t.pit.limEnd || !p.inPit)) p.stop = null;
    }

    // Stop time: parked on the mark to leaving the box; on the HUD (meta) and in chat
    recordStop(p, parkedAt, release) {
        p.lastStop = { s: Math.round((this.clock - parkedAt) * 100) / 100, release, n: p.stops }; // n: the HUD banner's key
        const how = release === 'perfect' ? ' (perfect release)' : release === 'jumped' ? ' (jumped the release)' : '';
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#22c55e', msg: `PIT: ${p.username} ${p.lastStop.s.toFixed(2)} s${how}` });
    }

    serviceTyres(p) {
        p.compound = p.nextCompound || Tyres.nextHarder(p.compound);
        p.nextCompound = null;
        p.wear = 0;
        p.wearPerM = Game.tyreWearPerM(this.settings, this.track, p.compound);
        p.tyreGrip = Tyres.gripOf(p.compound, 0);
        p.stops++;
        if (!p.compoundsUsed.includes(p.compound)) p.compoundsUsed = [...p.compoundsUsed, p.compound];
        p.servicedLap = p.entryLap ?? p.lap; // the lap it came in on: a box past the start line is reached on the next
        p.servicedVisit = p.pitVisits;
    }

    // A race finisher who never ran a second compound (races of 2+ laps, tyre wear on)
    finishCar(p) {
        p.boxCall = null;
        if (this.mode !== 'race' || this.settings.tyreWear === false || (this.settings.maxLaps || 1) < 2 || p.compoundsUsed.length >= 2) return;
        p.penalty += COMPOUND_PENALTY_S;
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: +${COMPOUND_PENALTY_S}s, raced on one tyre compound (total +${p.penalty}s)` });
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
                | (p.lapValid && FLAGS.lapValid) | ((this.mode === 'quali' || this.settings.collisions === false || p.ghost) && FLAGS.ghost);
            c.push([this.index[id], r1(p.x), r1(p.y), +p.angle.toFixed(4), r1(p.speed), +p.steer.toFixed(3), flags,
                    r1(p.vx), r1(p.vy), +(p.tow || 0).toFixed(2), p.lastSeq, +(p.wear || 0).toFixed(4),
                    p.stop ? STOP_CODE[p.stop.phase] : 0, p.stop ? +p.stop.t.toFixed(1) : 0]);
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
        const session = this.mode === 'quali' ? this.qualiClock() : null;
        return { players: this.players, track: this.track, mode: this.mode, index: this.index, session, bestSectors: this.bestSectors, bestSectorIds: this.bestSectorIds, fastestLap: this.fastestLap, paused: !!this.paused };
    }

    handleInput(id, input) {
        const p = this.players[id];
        if (!p) return;
        p.input = input; // kept while frozen, applies at lights out
        p.inputAt = this.clock;
    }

    // A tyre pick (keys 1/2/3 or the HUD): fitted at once on the grid (lights on) or parked in the quali box, otherwise the
    // set for the next stop
    setNextCompound(id, c) {
        const p = this.players[id];
        if (!p || !Tyres.isCompound(c)) return;
        const grid = this.mode === 'race' && this.frozen;
        const parked = this.mode === 'quali' && p.stop?.phase === 'wait';
        if (!grid && !parked) { p.nextCompound = c; return; }
        p.compound = c;
        p.nextCompound = null;
        p.wear = 0;
        p.wearPerM = Game.tyreWearPerM(this.settings, this.track, c);
        p.tyreGrip = Tyres.gripOf(c, 0);
        p.compoundsUsed = grid ? [c] : p.compoundsUsed.includes(c) ? p.compoundsUsed : [...p.compoundsUsed, c];
    }

    // Prediction clients: each tick applies exactly one queued input, in sequence order
    handleInputs(id, list) {
        const p = this.players[id];
        if (!p) return;
        // Brand-new inputs that already sit behind the server's slots: the client lags them. Far behind (stalled tab,
        // reconnect): re-align now. A little behind for a while (a lasting latency rise of even one tick): every input
        // would land in an already-guessed slot and the car repeat a stale input forever, so re-align too. A brief jitter
        // spike recovers by itself and is left alone. Resends/reordered packets carry nothing new and count for neither.
        const fresh = list.filter((i) => i.seq > (p.maxSeen ?? -1));
        if (fresh.length) {
            const newest = Math.max(...fresh.map((i) => i.seq));
            p.behind = newest <= p.lastSeq ? (p.behind || 0) + 1 : 0;
            if (newest < p.lastSeq - INPUT_QUEUE_MAX || p.behind >= LAG_REALIGN_BATCHES) {
                p.behind = 0;
                p.realigns = (p.realigns || 0) + 1; // network log: each one is a visible correction for this driver
                p.lastSeq = Math.max(p.applied ?? -1, Math.min(...fresh.map((i) => i.seq)) - 1); // never re-apply a real input
                p.queue = [];
            }
            p.maxSeen = newest;
        }
        const top = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
        for (const i of list) if (i.seq > top && !p.queue.some((q) => q.seq === i.seq)) p.queue.push(i);
        p.queue.sort((a, b) => a.seq - b.seq);
        p.inputAt = this.clock;
    }

    removePlayer(id) {
        const gone = this.players[id];
        if (this.quali && gone && gone.segBest !== null && !gone.qualiOut && (this.quali.phase === 'running' || this.quali.phase === 'flag')) this.quali.left.push(this.qualiEntry(gone)); // keeps its time this segment (not across a break)
        delete this.players[id];
        this.refreshBests(); // their lap in progress no longer counts
    }

    // Live session-best sectors, F1 style: a sector counts the moment it's set on a lap that is still valid, and stops
    // counting if that lap is deleted. Everyone is told whenever the holder or time changes.
    refreshBests() {
        const best = [...this.doneSectors], ids = [...this.doneSectorIds];
        for (const p of Object.values(this.players)) {
            if (!p.lapValid) continue;
            p.sectors.forEach((s, i) => { if (s !== null && (best[i] === null || s < best[i])) { best[i] = s; ids[i] = p.id; } });
        }
        if (best.every((s, i) => s === this.bestSectors[i] && ids[i] === this.bestSectorIds[i])) return;
        this.bestSectors = best;
        this.bestSectorIds = ids;
        this.io.emit('session_best', { sessionBest: best, bestSectorIds: ids });
    }

    start() {
        this.io.emit('game_init', this.initPayload());
        if (this.mode === 'quali') this.io.emit('session', { phase: 'QUALIFYING', endsInMs: this.qualiClock().endsInMs });
        this.ticker = new Ticker(1000 / TICK_RATE, () => this.timedUpdate());
        this.ticker.start();
    }

    stop() {
        if (this.ticker) this.ticker.stop();
        this.ticker = null;
    }

    // update() plus a tick-cost average and a once-a-second net_stats for the overlay
    timedUpdate() {
        if (this.paused) return; // host pause: no tick at all, so cars, race clock, quali timer and finish window all hold
        const t0 = process.hrtime.bigint();
        this.update();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        this.tickMs = this.tickMs === undefined ? ms : this.tickMs + (ms - this.tickMs) * 0.05;
        if (this.seq % TICK_RATE === 0) {
            const starve = {};
            for (const id in this.players) { starve[id] = this.players[id].starveLast = this.players[id].starve; this.players[id].starve = 0; }
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
            if (race && !p.inPit && passed(z.detectS)) { // pit lane: not racing, gives and gets nothing
                const last = this.lastDetect[k];  // re-crossing after a spin: not within 1 s of yourself
                p.drsEligible[k] = !!last && last.id !== p.id && this.time - last.at <= DRS_GAP_S;
                this.lastDetect[k] = { id: p.id, at: this.time };
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
        this.io.emit('track_limits', { id: p.id, kind: 'jump', add: JUMP_PENALTY_S, penalty: p.penalty });
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
        if (this.mode === 'quali' && p.limiter && !wasLimited) this.endRunAtPitEntry(p); // crossing the pit entry line ends a timed lap
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
        if (this.mode === 'quali' && p.limiter && !wasLimited) this.endRunAtPitEntry(p);
    }

    update() {
        const ids = Object.keys(this.players);
        {
            if (!this.frozen) this.time += this.dt; // race clock starts at lights out
            this.clock += this.dt;
            // The client resends every 100 ms; silence (hidden tab, dropped link) means let go, not full throttle forever
            for (const id of ids) {
                const p = this.players[id];
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
                this.updateStop(p);
                if (this.mode === 'race' && !this.frozen) this.checkBoxMissed(p);
                if (this.frozen) this.checkJumpStart(p);
                else {
                    if (this.mode === 'race' && !p.reacted && p.input.throttle > 0) this.reaction(p);
                    this.checkLapProgress(p);
                }
            }
            if (this.mode === 'race') this.updateGhosts(ids);
            if (this.mode === 'race' && this.settings.collisions !== false) { // host can turn contact off
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        const a = this.players[ids[i]], b = this.players[ids[j]];
                        if (a.finished || b.finished || a.ghost || b.ghost) continue;
                        const hit = Physics.carOverlap(a, b, this.track.scale);
                        if (!hit) continue;
                        this.noteContact(a, b, hit); // before the bump changes their speeds
                        Physics.resolveCarCollision(a, b, this.track.scale);
                    }
                }
            }
            if (this.mode === 'race') this.judgeIncidents();
        }

        // A parked or disconnected-in-spirit car can't hold everyone on track forever
        if (this.mode === 'race' && this.firstFinishAt !== undefined && this.time - this.firstFinishAt > FINISH_WINDOW_S) {
            for (const id of ids) {
                const p = this.players[id];
                if (!p.finished) Object.assign(p, { finished: true, dnf: true, finishTime: null, vx: 0, vy: 0, speed: 0, stop: null });
            }
        }
        if (this.mode === 'race' && !this.classified && ids.length && ids.every(id => this.players[id]?.finished)) {
            this.judgeIncidents(true); // a hit on the last lap still counts
            this.classify();
        }
        this.updateRanks();

        this.seq++;
        const packet = this.fastPacket();
        if (this.net) this.net.broadcastGameState(packet, this.io); // UDP, Socket.IO until a peer's channel opens
        else this.io.volatile.emit('game_state', packet);
        if (this.seq % META_EVERY === 1) {
            const diff = this.metaDiff();
            if (Object.keys(diff).length) this.io.emit('game_meta', diff);
        }

        if (this.mode === 'quali') { this.updateQuali(); for (const id of ids) if (this.players[id]) this.players[id].gripEvo = this.quali.evo; return; }
        if (ids.every((id) => this.players[id].finished)) {
            this.stop();
            this.onFinish();
        }
    }

    // ---------- "box, box" (race) ----------
    // Metres along the track to the pit entry (lapS is from the start line, pit.entryS from path index 0)
    toEntryM(p) {
        const t = this.track, total = t.cum[t.path.length];
        return ((((t.pit.entryS - ((p.lapS ?? 0) + (t.startS || 0))) % total) + total) % total) / t.scale;
    }
    setBoxCall(id, on) {
        const p = this.players[id];
        if (!p || this.mode !== 'race' || !this.track.pit || p.finished || p.inPit) return;
        p.boxCall = on ? (this.toEntryM(p) < BOX_NEXT_M ? 'next' : 'this') : null;
        p.boxMissedLap = null;
    }
    // Drove past the entry with the call on: stays called for the next lap, told once
    checkBoxMissed(p) {
        if (p.boxCall !== 'this' || p.inPit || !this.track.pit) { p.prevToEntry = null; return; }
        const d = this.toEntryM(p), lapM = this.track.cum[this.track.path.length] / this.track.scale, past = lapM - d;
        if (p.prevToEntry != null && p.prevToEntry < BOX_NEXT_M && past >= BOX_MISS_M && past < lapM / 2 && p.boxMissedLap !== p.lap) {
            p.boxMissedLap = p.lap;
            this.io.emit('track_limits', { id: p.id, kind: 'box_missed' });
        }
        if (d < lapM / 2) p.prevToEntry = d; // remembered while approaching, frozen once past
    }

    // ---------- qualifying session ----------
    qualiEntry(p) { return { id: p.id, time: p.segBest, at: p.segAt, joinOrder: p.joinOrder }; }
    canLeaveBox(p) { return !this.quali || (!p.qualiOut && !p.qualiDone && this.quali.phase === 'running'); }
    liveIds() { return Object.keys(this.players).filter((id) => !this.players[id].qualiOut); }
    segmentRanking() { return QualiSession.rankSegment(this.liveIds().map((id) => this.qualiEntry(this.players[id])).concat(this.quali.left)); }
    qualiRankPlayers(list) {
        const live = QualiSession.rankSegment(list.filter((p) => !p.qualiOut).map((p) => this.qualiEntry(p))).map((e) => this.players[e.id]);
        return live.concat(list.filter((p) => p.qualiOut).sort((a, b) => a.joinOrder - b.joinOrder));
    }
    survivors() {
        const q = this.quali, n = this.liveIds().length + q.left.length;
        return q.format === 'full' && q.segment < 3 ? n - QualiSession.knockoutCount(n) : n;
    }
    qualiClock() {
        const q = this.quali;
        const endsInMs = q.phase === 'running' && q.format !== 'oneshot' ? Math.max(0, (q.endsAt - this.time) * 1000)
            : q.phase === 'break' ? Math.max(0, (q.breakEndsAt - this.time) * 1000) : 0;
        return { phase: 'QUALIFYING', segment: q.segment, format: q.format, qphase: q.phase, endsInMs, survive: this.survivors(), out: [...q.out], evo: q.evo };
    }
    // Crossing the pit entry line ends a timed lap; after the chequered flag it ends the run
    endRunAtPitEntry(p) {
        const flying = p.lapStart !== null;
        p.lapStart = p.sectorStart = null;
        if (this.quali.phase === 'flag' || (this.quali.format === 'oneshot' && flying)) p.qualiDone = true; // one-shot: an aborted flying lap is the shot
    }
    // A completed timed lap: segment best, positions, provisional pole
    qualiLap(p, time) {
        const q = this.quali, counts = p.lapValid && this.time - time < q.endsAt;
        const before = this.segmentRanking(), had = p.segBest !== null, prevPos = had ? before.findIndex((e) => e.id === p.id) + 1 : null;
        if (counts && (p.segBest === null || time < p.segBest)) { p.segBest = time; p.segAt = this.time; }
        const after = this.segmentRanking(), pos = after.findIndex((e) => e.id === p.id) + 1;
        const pole = counts && pos === 1 && p.segBest === time;
        this.io.emit('quali_lap', { id: p.id, time, valid: counts, segment: q.segment, pos, prevPos, pole });
        if (pole) this.io.emit('chat_msg', { username: 'SYSTEM', color: '#a855f7', msg: `PROVISIONAL POLE: ${p.username} ${fmtLap(time)}` });
    }
    // Qualifying clock: running → flag (laps started before zero may finish) → break (results, back to the boxes) → next segment / done
    updateQuali() {
        const q = this.quali, live = this.liveIds();
        if (q.phase === 'running' || q.phase === 'flag') q.driven += this.dt;
        const planned = q.plan.filter(Number.isFinite).reduce((a, b) => a + b, 0) || q.endsAt;
        q.evo = 1 + 0.02 * Math.min(1, q.driven / planned);
        if (q.phase === 'running' && (this.time >= q.endsAt || (q.format === 'oneshot' && live.every((id) => this.players[id].qualiDone)))) {
            q.phase = 'flag';
            q.flagCapAt = this.time + 1.5 * q.refS * q.scale;
            for (const id of live) { const p = this.players[id]; if (p.lapStart === null) p.qualiDone = true; } // not on a timed lap: done
        }
        if (q.phase === 'flag' && (live.every((id) => this.players[id].qualiDone) || this.time >= q.flagCapAt)) this.endSegment(live);
        else if (q.phase === 'break' && this.time >= q.breakEndsAt) this.startSegment();
        if (this.seq % 30 === 0) this.io.emit('quali_clock', this.qualiClock());
    }
    endSegment(live) {
        const q = this.quali, ranked = QualiSession.rankSegment(live.map((id) => this.qualiEntry(this.players[id])).concat(q.left));
        const k = q.format === 'full' && q.segment < 3 ? QualiSession.knockoutCount(ranked.length) : 0;
        const out = ranked.slice(ranked.length - k).map((e) => e.id);
        q.segments.push({ ranked, out });
        for (const id of out) { q.out.add(id); if (this.players[id]) this.players[id].qualiOut = true; }
        const last = q.format !== 'full' || q.segment === 3, first = ranked[0]?.time;
        const breakS = Math.max(3, 30 * q.scale);
        this.io.emit('quali_segment', { segment: q.segment, rows: ranked.map((e) => ({ id: e.id, time: e.time, gap: e.time !== null && first != null ? e.time - first : null, out: out.includes(e.id) })),
            next: last ? null : q.segment + 1, breakMs: last ? 0 : breakS * 1000 });
        if (out.length) this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `Q${q.segment}: ${out.map((id) => this.players[id]?.username || id).join(', ')} knocked out` });
        q.left = [];
        this.resetToBoxes();
        if (!last) { q.phase = 'break'; q.breakEndsAt = this.time + breakS; return; }
        q.phase = 'done';
        this.stop();
        this.onFinish(QualiSession.gridOrder(q.segments).map((id) => {
            let seg = 0;
            q.segments.forEach((s, i) => { if (s.ranked.some((e) => e.id === id)) seg = i; });
            const time = q.segments[seg].ranked.find((e) => e.id === id).time;
            return { id, bestLap: time, segment: seg + 1, time };
        }));
    }
    startSegment() {
        const q = this.quali;
        q.segment++;
        q.phase = 'running';
        q.endsAt = this.time + q.plan[q.segment - 1];
        q.flagCapAt = Infinity;
        for (const p of Object.values(this.players)) Object.assign(p, { segBest: null, segAt: null, qualiDone: false });
    }
    resetToBoxes() {
        for (const p of Object.values(this.players)) {
            if (p.box) Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle });
            Object.assign(p, { vx: 0, vy: 0, speed: 0, stop: { phase: 'wait', t: 0, age: 0 }, inPit: true, lapStart: null, sectorStart: null, outLaps: 0, finished: false });
        }
    }

    updateRanks() {
        const list = Object.values(this.players);
        if (!list.length) return;
        const ranked = this.mode === 'quali' ? this.qualiRankPlayers(list) : Game.rankPlayers(list, this.track.checkpoints);
        const leader = ranked[0];
        const cpCount = this.track.checkpoints.length;
        ranked.forEach((p, i) => {
            p.rank = i + 1;
            if (this.mode === 'quali') {
                p.lapsDown = 0;
                p.gap = i > 0 && p.segBest !== null && leader.segBest !== null ? p.segBest - leader.segBest : null;
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

    // Ghost start: cars pass through each other from the grid until past sector 1 of the first lap (or GHOST_MAX_S after
    // lights out), and only turn solid clear of every other car, so nobody is ever popped apart
    updateGhosts(ids) {
        for (const id of ids) {
            const p = this.players[id];
            if (!p.ghost) continue;
            const done = p.lap > 0 || p.checkpoint >= this.track.sectorCps[1] || (!this.frozen && this.time >= GHOST_MAX_S);
            if (!done) continue;
            const sc = this.track.scale;
            if (ids.some((o) => o !== id && !this.players[o].finished && this.tooClose(p, this.players[o], sc))) continue;
            p.ghost = false;
        }
    }

    // Closer than two car lengths + 1 m + one second of closing speed (m/s along the line between them, 0 if separating)
    tooClose(a, b, sc) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const closing = d > 0 ? Math.max(0, ((a.vx - b.vx) * dx + (a.vy - b.vy) * dy) / d / sc) : 0;
        return d < (2 * Physics.CAR_HALF_LENGTH_M + 1 + closing) * sc || !!Physics.carOverlap(a, b, sc);
    }

    // First contact between two cars: each one's own speed into the other (m/s, n points from b to a) says who drove
    // into whom. Rear-end: the car behind. Side swipe: the car that moved across. Both alike: a racing incident
    noteContact(a, b, { nx, ny }) {
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`, last = this.contacts.get(key);
        this.contacts.set(key, this.time);
        if (last !== undefined && this.time - last <= CONTACT_GAP_S) return;
        const sc = this.track.scale, aIn = -(a.vx * nx + a.vy * ny) / sc, bIn = (b.vx * nx + b.vy * ny) / sc;
        if (aIn + bIn < CONTACT_LIGHT_MS) return;
        const k = a.lap === 0 || b.lap === 0 ? CONTACT_BLAME_LAP1 : CONTACT_BLAME;
        const blame = (x, y) => x > 0 && x >= k * Math.max(y, 0);
        const [striker, victim] = blame(aIn, bIn) ? [a, b] : blame(bIn, aIn) ? [b, a] : [];
        if (!striker) {
            a.contactAt = b.contactAt = this.time; // knocked about: no track-limits strike for INCIDENT_JUDGE_S
            if (this.settings.contactPenalties !== false) {
                this.io.emit('chat_msg', { username: 'SYSTEM', color: '#f59e0b', msg: `${a.username} / ${b.username}: racing incident, no action` });
                this.io.emit('track_limits', { id: a.id, kind: 'incident', with: b.username });
                this.io.emit('track_limits', { id: b.id, kind: 'incident', with: a.username });
            }
            return;
        }
        // Already off or spun before the hit: the hit didn't do that, so no +10 s for it
        this.incidents.push({ striker: striker.id, victim: victim.id, at: this.time, off: false, before: victim.offLimits || this.spun(victim) });
    }

    // Facing more than 90° away from the way the track runs here
    spun(p) {
        const P = this.track.path, i = Physics.nearestOnTrack(p.x, p.y, this.track).i, q = P[(i + 1) % P.length];
        const h = Math.atan2(q.y - P[i].y, q.x - P[i].x);
        return Math.abs(Math.atan2(Math.sin(p.angle - h), Math.cos(p.angle - h))) > Math.PI / 2;
    }

    // Watch each victim for INCIDENT_JUDGE_S, then the verdict: +5 s for the hit, +10 s if it put them off or round.
    // now: judge everything pending at once (the race is over). Contact penalties off: incidents are still tracked so
    // a pushed-off victim gets no track-limits strike, but nobody is penalised
    judgeIncidents(now = false) {
        for (const inc of this.incidents) {
            const v = this.players[inc.victim];
            if (v && !inc.off && !inc.before && (v.offLimits || this.spun(v))) inc.off = true;
        }
        const due = now ? this.incidents : this.incidents.filter((i) => this.time - i.at >= INCIDENT_JUDGE_S);
        if (!due.length) return;
        this.incidents = now ? [] : this.incidents.filter((i) => this.time - i.at < INCIDENT_JUDGE_S);
        if (this.settings.contactPenalties === false) return;
        for (const inc of due) {
            const s = this.players[inc.striker], v = this.players[inc.victim];
            if (!s || !v) continue; // one of them left
            const add = inc.off ? COLLISION_OFF_PENALTY_S : COLLISION_PENALTY_S;
            s.penalty += add;
            this.io.emit('track_limits', { id: s.id, kind: 'collision', add, penalty: s.penalty, victim: v.username, off: inc.off });
            this.io.emit('track_limits', { id: v.id, kind: 'hit', by: s.username, add });
            const what = inc.off ? `pushed ${v.username} off track` : `hit ${v.username}`;
            this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${s.username} ${what}, +${add}s (total +${s.penalty}s)` });
            netlog.log(`[INCIDENT] ${s.username} (${s.id}) ${what} (${v.id}), +${add}s`);
        }
    }

    // All four wheels past the real white line (t.limit), once per excursion; pit lane, quali out-lap exempt, and so is
    // rejoining from the pit exit until the car is first back inside the line
    checkLimits(p, near) {
        const t = this.track;
        if (p.inPit) p.fromPit = true;
        const line = edgeAt(t, near, p.x, p.y); // the real white line on this side, here
        if (near.dist <= line) { p.offLimits = false; p.fromPit = false; return; } // inside it (the run-off beyond is asphalt)
        if (this.frozen) return; // lights still on: jump starts are judged separately
        if (p.offLimits || p.inPit || p.fromPit || near.dist <= line + Physics.CAR_HALF_WIDTH_M * t.scale) return;
        if (this.mode === 'quali' && (p.lapStart === null || p.finished)) return;
        p.offLimits = true;
        if (this.mode === 'quali') {
            p.lapValid = false; // quali: lap deleted (race: warnings / penalties only)
            this.io.emit('track_limits', { id: p.id, kind: 'deleted' });
            this.refreshBests(); // its sectors stop counting: purple goes back to the previous holder
            return;
        }
        if (this.time - (p.contactAt ?? -Infinity) < INCIDENT_JUDGE_S) return; // racing incident just now
        if (this.incidents.some((i) => i.victim === p.id)) return; // pushed off: the driver who hit them answers for it
        // Inside of a bend = a cut (gains time): a strike. Outside, or on a straight = wide (loses time): the lap just
        // doesn't count for the fastest lap
        const k = bendAt(t, near.i), P = t.path, a = P[near.i], b = P[(near.i + 1) % P.length];
        const right = -(b.y - a.y) * (p.x - near.px) + (b.x - a.x) * (p.y - near.py) > 0; // same side test as edgeAt
        const cut = Math.abs(k) >= STRAIGHT_PER_M && (k > 0) === right;
        if (p.lapValid) { p.lapValid = false; this.refreshBests(); } // a purple sector set earlier on this lap goes back
        if (!cut) { this.io.emit('track_limits', { id: p.id, kind: 'wide' }); return; }
        p.limits++;
        if (p.limits <= LIMIT_WARNINGS) {
            this.io.emit('track_limits', { id: p.id, kind: 'warning', count: p.limits, of: LIMIT_WARNINGS });
            return;
        }
        if (p.limits === LIMIT_WARNINGS + 1) {
            this.io.emit('track_limits', { id: p.id, kind: 'flag' });
            this.io.emit('chat_msg', { username: 'SYSTEM', color: '#f59e0b', msg: `${p.username}: black and white flag, next corner cut is a penalty` });
            return;
        }
        p.penalty += LIMIT_PENALTY_S;
        this.io.emit('track_limits', { id: p.id, kind: 'penalty', add: LIMIT_PENALTY_S, penalty: p.penalty });
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: +${LIMIT_PENALTY_S}s corner cutting penalty (total +${p.penalty}s)` });
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
        if (p.lapValid) { // personal bests only from completed valid laps
            p.sectors.forEach((s, i) => {
                if (s === null) return;
                if (p.bestSectors[i] === null || s < p.bestSectors[i]) p.bestSectors[i] = s;
                if (this.doneSectors[i] === null || s < this.doneSectors[i]) { this.doneSectors[i] = s; this.doneSectorIds[i] = p.id; }
            });
        }
        this.refreshBests(); // a lap that ended invalid (deleted mid-lap without a refresh) drops out here
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
        if (this.mode === 'quali') this.qualiLap(p, lapTime);
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
        if (p.lapValid) this.refreshBests(); // purple now, not when the lap ends
    }

    checkLapProgress(p) {
        const cps = this.track.checkpoints;
        const target = (p.checkpoint + 1) % cps.length;
        const cp = cps[target];
        const pos = this.trackPos(p), total = this.track.cum[this.track.path.length];
        // Missing one would cost a whole extra lap (strict order), so a car just past it along the lap counts too
        const past = !p.inPit && p.lapS != null && (((p.lapS - cp.s) % total) + total) % total < CP_GATE_M * this.track.scale;
        if (!past && Math.hypot(pos.x - cp.x, pos.y - cp.y) >= cp.radius) return;

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
            if (p.boxCall === 'next') p.boxCall = 'this';
            this.recordLap(p);
            if (p.lap >= this.settings.maxLaps) {
                p.finished = true;
                p.finishTime = this.time;
                p.stop = null; // parked where it is: no stop code in the packet forever
                this.finishCar(p);
                p.vx = p.vy = p.speed = 0; // parked: a moving velocity would make other clients dead-reckon it forward
                this.winnerCount++;
                p.finishOrder = this.winnerCount;
                if (this.winnerCount === 1) this.firstFinishAt = this.time;
            }
            return;
        }
        if (p.finished || p.qualiOut) return;
        const q = this.quali;
        if (p.lapStart !== null) {
            p.lap++;
            this.recordLap(p);
            if (q.phase !== 'running' || this.time >= q.endsAt || q.format === 'oneshot') { // chequered flag, or the one-shot lap: run over
                p.qualiDone = true;
                p.lapStart = p.sectorStart = null;
            }
            return; // otherwise recordLap already started the next flying lap at the line
        }
        // Out-laps: untimed crossings after pit exit (one in the pit lane doesn't count); timing starts at the last one
        if (p.inPit || p.qualiDone || q.phase !== 'running') return;
        p.outLaps = (p.outLaps || 0) + 1;
        if (p.outLaps < (this.settings.outLaps ?? 1)) return;
        p.lapStart = this.time;
        this.newLap(p);
    }
}

Game.FLAGS = FLAGS;
Game.META_FIELDS = META_FIELDS;
Game.bendAt = bendAt;
module.exports = Game;
