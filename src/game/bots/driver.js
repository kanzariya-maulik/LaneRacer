// src/game/bots/driver.js
// AI driver: a bot car's view of the track and traffic → { throttle, brake, steer, drs }, once per tick, before the shared
// physics. Same car, same help (full), same rules as a human.
const { C } = require('../CarPhysics');
const RacingLine = require('../RacingLine');
const Drive = require('../../../public/js/sim/drive.js');
const { trackIndex } = require('../../../public/js/racingline.js');

const IDLE = Object.freeze({ throttle: 0, brake: 0, steer: 0, drs: false });
const SPEED_LOOK_S = 0.25;                             // speed target read this far ahead (throttle/brake response)
const EDGE_M = 1.5;                                    // lane moves stay this far inside the white lines
const LANE_RATE_MS = 3;                                // sideways moves at most this fast
const PIT_APPROACH_M = 80;                             // box called: the pit assist steers from this far before the entry
// Tuned by lap tests (test/botDriver.test.js): steering aim (s of travel, m bounds), steering gain (the grip cap makes the
// real lock smaller than the geometric one), line speed × base / pace
const PACE = { base: 1, lookS: 0.25, lookMin: 8, lookMax: 60, gain: 4 };

const lines = new WeakMap();
function lineOf(t) {
    let c = lines.get(t);
    if (c) return c;
    const P = t.path, n = P.length, m = EDGE_M * t.scale;
    const N = P.map((_, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; // RacingLine.normals convention: point = path + N × offset
    });
    c = { N, lo: t.edgeL.map((e) => -(e - m)), hi: t.edgeR.map((e) => e - m), pts: RacingLine.linePoints(P, t.racingLine.offset) };
    lines.set(t, c);
    return c;
}

// Path index `metres` further along the lap from i
function ahead(t, i, metres) {
    const n = t.path.length, total = t.cum[n], want = metres * t.scale;
    for (let k = 1; k < n; k++) {
        const j = (i + k) % n;
        if ((((t.cum[j] - t.cum[i]) % total) + total) % total >= want) return j;
    }
    return i;
}

// The side the line takes at the next corner's apex (within 300 m): +1 = the path normal's side, -1 = the other
function insideSide(t, i) {
    const ph = t.racingLine.phase;
    for (let j = i, d = 0; d < 300; d += 5) { j = ahead(t, j, 5); if (ph[j] === 1) return Math.sign(t.racingLine.offset[j]) || 1; }
    return 1;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Pure pursuit onto (x, y): wheel angle for the arc through it, as a share of the lock (full help: the larger lock)
function steerTo(p, x, y, sc, v) {
    const dx = (x - p.x) / sc, dy = (y - p.y) / sc, d2 = Math.max(1, dx * dx + dy * dy);
    const lat = -dx * Math.sin(p.angle) + dy * Math.cos(p.angle);
    const wheel = Math.atan(((2 * lat) / d2) * C.WHEELBASE);
    const lock = ((1 + C.ASSIST_STEER) * C.MAX_STEER) / (1 + v / C.STEER_FADE);
    return clamp((PACE.gain * wheel) / lock, -1, 1);
}

function state(p) {
    return p.bot || (p.bot = { idx: null, lane: 0, passSide: 0, defend: 0, defended: false, err: null, prevPhase: 0, followS: 0, press: false, wantPit: false, bog: undefined });
}

// Racecraft (Task 3) and mistakes (Task 4) plug in here; for now: the line, alone
function racecraft() { return { laneT: 0, cap: Infinity }; }

function drive(p, ctx) {
    const b = state(p);
    if (p.stop) return { ...IDLE, throttle: b.press ? 1 : 0 }; // pit assist / parked: only release and box-exit presses
    if (ctx.frozen || p.finished) return IDLE;
    const t = ctx.track, sc = t.scale, L = lineOf(t), v = Math.abs(p.speed) / sc, ai = p.ai;
    b.idx = trackIndex(t.path, p.x, p.y, b.idx, 40 * sc);
    if ((p.boxCall || b.wantPit) && t.pit && p.box && ctx.toEntryM(p) < PIT_APPROACH_M) return { ...Drive.pitAssist(p, t), drs: false };
    if (ctx.mode === 'race' && ctx.time < ai.reaction) return IDLE;
    const here = b.idx;
    let factor = (PACE.base / ai.pace) * Math.sqrt(p.tyreGrip ?? 1);
    if (ctx.mode === 'quali' && p.lapStart === null) factor *= 0.9; // out-lap
    const { laneT, cap } = racecraft(p, b, ctx, v, here);
    const vt = Math.min(t.racingLine.speed[ahead(t, here, Math.max(5, v * SPEED_LOOK_S))] * factor, cap);
    b.lane += clamp(laneT - b.lane, -LANE_RATE_MS * ctx.dt, LANE_RATE_MS * ctx.dt);
    const j = ahead(t, here, clamp(v * PACE.lookS, PACE.lookMin, PACE.lookMax));
    const o = clamp(t.racingLine.offset[j] + b.lane * sc, L.lo[j], L.hi[j]);
    const steer = steerTo(p, t.path[j].x + L.N[j].x * o, t.path[j].y + L.N[j].y * o, sc, v);
    const err = vt - v;
    const throttle = err > 0 ? Math.min(1, 0.35 + err * 0.5) : 0, brake = err < -0.5 ? Math.min(1, -err * 0.3) : 0;
    return { throttle, brake, steer, drs: !!p.drsAvailable && brake === 0 };
}

module.exports = { drive, state, insideSide, ahead, lineOf, PACE, IDLE };
