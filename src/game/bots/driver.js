// src/game/bots/driver.js
// AI driver: a bot car's view of the track and traffic → { throttle, brake, steer, drs }, once per tick, before the shared
// physics. Same car, same help (full), same rules as a human.
const { C } = require('../CarPhysics');
const RacingLine = require('../RacingLine');
const Drive = require('../../../public/js/sim/drive.js');
const { trackIndex } = require('../../../public/js/racingline.js');
const Physics = require('../Physics');

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

const CAR_M = 5.6, PASS_M = 3.5, DEFEND_M = 3, BLUE_M = 3.5; // metres
const PATH_M = 3, ROOM_M = 3.5; // in my path within PATH_M sideways; side by side, never aim closer than ROOM_M // a car this close sideways is in my path (2 m wide car + margin)
const FOLLOW_DEC = 8, FOLLOW_GAP_M = 6, AHEAD_M = 400; // cautious braking (cornering eats into it), so look far enough to stop from top speed // m/s² of braking the follow cap allows for (well under the car's limit), metres kept clear

// Cars around me in track terms: f = metres along the lap ahead (+) / behind (−), l = their offset from the centreline
// minus mine (+ = the path normal's side, the same frame as the racing line's offsets). "Ahead" = in the lane my line takes
// at their point of the lap, so cars converging onto my line through a bend count before they're in front of my nose
function scan(p, ctx, v) {
    const t = ctx.track, sc = t.scale, L = lineOf(t), total = t.cum[t.path.length] / sc, b = state(p);
    // Exact lap distance (m) and centreline offset (m) of a car: segment and fraction, not the ~10 m path points
    const where = (o) => {
        const n = Physics.nearestOnPathHint(o.x, o.y, t.path, o.aiSeg, true), P = t.path, a = P[n.i], c = P[(n.i + 1) % P.length];
        o.aiSeg = n.i;
        const ex = c.x - a.x, ey = c.y - a.y, l = Math.hypot(ex, ey) || 1;
        return { s: (t.cum[n.i] + n.t * (t.cum[n.i + 1] - t.cum[n.i])) / sc, off: ((o.x - n.px) * -ey + (o.y - n.py) * ex) / l / sc, i: n.i };
    };
    const me = where(p), mine = me.off, r = { ahead: null, behind: null, alongside: null, lapper: null, close: false };
    for (const o of ctx.cars) {
        if (o === p || o.finished || (o.inPit && o.stop)) continue;
        const w = where(o), oi = w.i, oo = w.off;
        let f = (((w.s - me.s) % total) + total) % total;
        if (f > total / 2) f -= total;
        const e = { o, f, l: oo - mine, off: oo, v: Math.abs(o.speed) / sc };
        if (o === b.passCar) r.target = e;
        if (Math.abs(f) < CAR_M && Math.abs(e.l) < 4) r.alongside = e;
        if (f > 0 && f < AHEAD_M && Math.abs(oo - (t.racingLine.offset[oi] / sc + b.lane)) < PATH_M) { if (!r.ahead || f < r.ahead.f) r.ahead = e; }
        else if (f < 0 && f > -60 && Math.abs(e.l) < 4) {
            if (!r.behind || f > r.behind.f) r.behind = e;
            if (o.lap > p.lap && o.rank < p.rank) r.lapper = e; // a lap or more up on me, catching me
        }
    }
    r.close = !!r.alongside || (!!r.behind && -r.behind.f < Math.max(10, 0.6 * v));
    return r;
}

function racecraft(p, b, ctx, v, here, r, vt) {
    const t = ctx.track, ai = p.ai, ph = t.racingLine.phase[here];
    if (ph === 1) { b.defend = 0; b.defended = false; } // in the corner: the next straight allows a new move
    if (r.lapper && -r.lapper.f < 1.5 * v + 10) { b.passSide = 0; return { laneT: -insideSide(t, here) * BLUE_M, cap: v * 0.97 }; } // blue flag
    let laneT = 0, cap = Infinity;
    const a = r.ahead;
    if (a) {
        const faster = vt > a.v + 0.5 || p.tow > 0 || p.drsAvailable;
        if (!b.passSide && faster && !r.alongside && a.f < Math.max((0.5 + 0.5 * ai.aggression) * v, FOLLOW_GAP_M + 6) + CAR_M) { // held up, even from a standstill
            const inside = insideSide(t, here);
            b.passSide = Math.sign(a.l) === inside ? -inside : inside; // the inside, unless they're already on it
            b.passCar = a.o;
        }
        if (b.passSide && ph === 2 && a.f > CAR_M * 0.5) b.passSide = 0; // not alongside by the braking point: back in line
        cap = Math.sqrt(Math.max(0, a.v * a.v + 2 * FOLLOW_DEC * (a.f - CAR_M - FOLLOW_GAP_M))); // no ramming: can always stop behind it
        if (a.f < 1.5 * v) b.followS += ctx.dt;
    } else if (!r.target || r.target.f < -CAR_M || r.target.f > AHEAD_M) { b.passSide = 0; b.passCar = null; } // out of my lane isn't done: done once it's behind me
    if (b.passSide) laneT = b.passSide * PASS_M;
    else {
        const brakingSoon = t.racingLine.phase[ahead(t, here, 150)] === 2;
        if (!b.defended && ai.aggression >= 0.3 && r.behind && -r.behind.f < 0.5 * v + CAR_M && brakingSoon && ph === 0) {
            b.defend = insideSide(t, here);
            b.defended = true;
        }
        if (b.defend) laneT = b.defend * DEFEND_M;
    }
    if (r.alongside) laneT = b.lane; // side by side: hold my lane, never turn in across them
    return { laneT, cap };
}

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
    const r = scan(p, ctx, v);
    const vLine = t.racingLine.speed[ahead(t, here, Math.max(5, v * SPEED_LOOK_S))] * factor;
    const { laneT, cap } = racecraft(p, b, ctx, v, here, r, vLine);
    const vt = Math.min(vLine, cap);
    b.lane += clamp(laneT - b.lane, -LANE_RATE_MS * ctx.dt, LANE_RATE_MS * ctx.dt);
    const j = ahead(t, here, clamp(v * PACE.lookS, PACE.lookMin, PACE.lookMax));
    let o = clamp(t.racingLine.offset[j] + b.lane * sc, L.lo[j], L.hi[j]);
    if (r.alongside) { // room: their side of the track stays theirs through the corner
        const lim = (r.alongside.off - Math.sign(r.alongside.l) * ROOM_M) * sc;
        o = r.alongside.l > 0 ? Math.min(o, lim) : Math.max(o, lim);
    }
    const steer = steerTo(p, t.path[j].x + L.N[j].x * o, t.path[j].y + L.N[j].y * o, sc, v);
    const err = vt - v;
    const throttle = err > 0 ? Math.min(1, 0.35 + err * 0.5) : 0, brake = err < -0.5 ? Math.min(1, -err * 0.3) : 0;
    return { throttle, brake, steer, drs: !!p.drsAvailable && brake === 0 };
}

module.exports = { drive, state, insideSide, ahead, lineOf, scan, PACE, IDLE };
