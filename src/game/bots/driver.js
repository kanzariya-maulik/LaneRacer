// src/game/bots/driver.js
// AI driver: a bot car's view of the track and traffic → { throttle, brake, steer, drs }, once per tick, before the shared
// physics. Same car, same help (full), same rules as a human.
const { C, parseAssist } = require('../CarPhysics');
const { pursue, pedals } = require('../limitControl');
const RacingLine = require('../RacingLine');
const Drive = require('../../../public/js/sim/drive.js');
const { trackIndex } = require('../../../public/js/racingline.js');
const Physics = require('../Physics');

const IDLE = Object.freeze({ throttle: 0, brake: 0, steer: 0, drs: false });
const EDGE_M = 1.0;                                    // lane moves stay this far inside the white lines (real width)
const LANE_RATE_MS = 3;                                // sideways moves at most this fast
const PIT_APPROACH_M = 40, PIT_SETUP_M = 300, PIT_DEC = 10; // box called: over to the pit side and down to the limit from PIT_SETUP_M, the pit assist steers in for the last PIT_APPROACH_M
// Tuned by lap tests (test/botDriver.test.js): steering aim (s of travel, m bounds), steering gain (the grip cap makes the
// real lock smaller than the geometric one), line speed × base / pace
const FORMATION_PACE = 0.6; // share of race pace on the formation lap
const PACE = { base: 1 };

const lines = new WeakMap();
function lineOf(t) {
    let c = lines.get(t);
    if (c) return c;
    const P = t.path, n = P.length, m = EDGE_M * t.scale;
    const N = P.map((_, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; // RacingLine.normals convention: point = path + N × offset
    });
    let pitOff = 0; // the pit entry's side of the road (centreline offset, world units)
    if (t.pit) { const E = t.pit.path[0], i = trackIndex(P, E.x, E.y, null); pitOff = (E.x - P[i].x) * N[i].x + (E.y - P[i].y) * N[i].y; }
    c = { pitOff, N, lo: t.edgeL.map((e) => -(e - m)), hi: t.edgeR.map((e) => e - m), pts: RacingLine.linePoints(P, t.racingLine.offset) };
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

// The racing line's curvature per path point (1/m, unsigned), once per track: the turn the car makes on the line
const lineK = new WeakMap();
const lineCurv = (t) => lineK.get(t) || lineK.set(t, RacingLine.curvatures(RacingLine.linePoints(t.path, t.racingLine.offset), t.scale).map(Math.abs)).get(t);
// The turn the car is making: the line's while on it; off it (wide out of a corner) the arc back to the aim point, if tighter
const OFF_LINE_M = 1.5;
function turnCurv(p, t, here, L, x, y) {
    const sc = t.scale, q = t.path[here], off = ((p.x - q.x) * L.N[here].x + (p.y - q.y) * L.N[here].y - t.racingLine.offset[here]) / sc;
    if (Math.abs(off) <= OFF_LINE_M) return lineCurv(t)[here];
    const dx = (x - p.x) / sc, dy = (y - p.y) / sc;
    return Math.max(lineCurv(t)[here], Math.abs(2 * (-dx * Math.sin(p.angle) + dy * Math.cos(p.angle))) / Math.max(1, dx * dx + dy * dy));
}


function state(p) {
    return p.bot || (p.bot = { idx: null, lane: 0, passSide: 0, defend: 0, defended: false, err: null, prevPhase: 0, followS: 0, press: false, wantPit: false, bog: undefined });
}

const FRONT_M = 80, FRONT_W = 2.5; // a car this close ahead and this close sideways is in front of me whatever my plan
const CAR_M = 5.6, PASS_M = 3.5, DEFEND_M = 3, BLUE_M = 3.5; // metres
const OPENING_AGG = 0.5, OPENING_EDGE_MS = 3; // opening lap after turn 1: aggression × this; a move needs this much more speed
const START_AGG = 0.25, START_LATE = 1.03, START_MAX_S = 25; // the run to turn 1: more willing to attack, alongside brakes a touch later; never past 25 s
const AIM_S = 0.3, AIM_MIN_M = 8; // steer for the point this far ahead on my lane (as lineFollower.js)
const CRAWL_MS = 8; // below this the throttle keeps a floor (crawling out of gravel)
const LOCK_K = 1.2; // the arc to the aim point wants this much more than full lock: it can't make it, slow down (as a driver)
const OVER_K = 1.1; // this far over the target speed: brake whatever the turn takes (run wide off a move, or shoved)
const OFF_LINE_LANE_M = 1; // driving a lane this far off the line (passing, defending) or side by side: the line's true limits aren't this path's
const SWITCHBACK_S = 8; // after being passed: how long the bot goes straight back at the car that did it
const DIVE_LATE = 0.03; // a committed dive brakes this much later (× aggression): the late lunge that makes the move
const CREEP_MS = 3; // m/s: walking pace round a stopped car
const PATH_M = 3, ROOM_M = 3.5; // in my path within PATH_M sideways; side by side, never aim closer than ROOM_M // a car this close sideways is in my path (2 m wide car + margin)
const FOLLOW_DEC_BY = { hard: 11, pro: 14 }, FOLLOW_GAP_BY = { hard: 5, pro: 4 }; // easy / medium keep the cautious defaults
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
    for (const o of ctx.mode === 'quali' ? [] : ctx.cars) { // qualifying cars are ghosts: no traffic to race
        if (o === p || o.finished || (o.ghost && !b.start) || (o.inPit && o.stop && !p.inPit)) continue; // ghosts can't be hit (but at the start they're raced as if solid); in the lane, lane cars count
        const w = where(o), oi = w.i, oo = w.off;
        let f = (((w.s - me.s) % total) + total) % total;
        if (f > total / 2) f -= total;
        const e = { o, f, l: oo - mine, off: oo, v: Math.abs(o.speed) / sc };
        if (o === b.passCar) r.target = e;
        if (o === b.passedBy?.car) r.passer = e;
        // Switchback: a car right behind me a moment ago that's now ahead has just passed me
        if (f < 0 && f > -15 && Math.abs(e.l) < 4) b.lastBehind = { car: o, at: ctx.time };
        else if (f > 0 && b.lastBehind?.car === o && ctx.time - b.lastBehind.at < 2) { b.passedBy = { car: o, at: ctx.time }; b.lastBehind = null; r.passer = e; }
        if (Math.abs(f) < CAR_M && Math.abs(e.l) < 4) r.alongside = e;
        // In my path: in the lane my line takes at their point, or physically in front of me now (I may be off my planned lane:
        // squeezed, rejoining, steering lag — missing those was most of the rear-ends). In the pit lane: its cars
        const myPath = p.inPit ? Math.abs(e.l) < PATH_M : Math.abs(oo - (t.racingLine.offset[oi] / sc + b.lane)) < PATH_M || (f > CAR_M && f < FRONT_M && Math.abs(e.l) < FRONT_W); // fully ahead: overlapping is alongside
        if (f > 0 && f < AHEAD_M && myPath) { if (!r.ahead || f < r.ahead.f) r.ahead = e; }
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
    // Run to turn 1: go for gaps. The rest of the opening lap: calmer (the pack still nose to tail, three wide onto Spa's
    // straights it was most of the contact): moves from closer, no switchbacks
    const opening = ctx.mode === 'race' && p.lap < 1 && !b.start, agg = (ai.aggression + (b.start ? START_AGG : 0)) * (opening ? OPENING_AGG : 1);
    if (ph === 1) { b.defend = 0; b.defended = false; } // in the corner: the next straight allows a new move
    if (r.lapper && -r.lapper.f < 1.5 * v + 10) { b.passSide = 0; return { laneT: -insideSide(t, here) * BLUE_M, cap: v * 0.97 }; } // blue flag
    let laneT = 0, cap = Infinity;
    // Switchback: just passed, straight back at them on the other side while they're within reach (the next corner or two)
    if (b.passedBy && (ctx.time - b.passedBy.at > SWITCHBACK_S || (r.passer && r.passer.f < -CAR_M))) b.passedBy = null;
    if (b.passedBy && r.passer && r.passer.f > 0 && r.passer.f < AHEAD_M && !r.alongside && agg >= 0.5) {
        if (b.passCar !== r.passer.o && ph === 0) { b.passCar = r.passer.o; b.passSide = -Math.sign(r.passer.l) || insideSide(t, here); }
        r.target = r.passer;
    }
    const a = r.ahead;
    if (a) {
        // Opening lap: only a real speed edge (in the nose-to-tail train every car has a tow, and all of them pulled out)
        const faster = opening ? vt > a.v + OPENING_EDGE_MS : vt > a.v + 0.5 || p.tow > 0 || p.drsAvailable;
        if (!b.passSide && ph === 0 && faster && !r.alongside && a.f < Math.max((0.5 + 0.5 * agg) * v, FOLLOW_GAP_M + 6) + CAR_M) { // held up, even from a standstill
            const inside = insideSide(t, here);
            b.passSide = Math.sign(a.l) === inside ? -inside : inside; // the inside, unless they're already on it
            b.passCar = a.o;
        }
        // Into the braking zone: a committed dive (nose within a car length or two, by aggression) stays on; further back it's
        // given up. Past the turn-in with them still ahead and not alongside: called off, never a dive into a car already turning
        if (b.passSide && ph === 2 && a.f > CAR_M * (1 + agg)) b.passSide = 0;
        if (b.passSide && ph === 1 && a.f > CAR_M && !r.alongside) b.passSide = 0;
        const dec = FOLLOW_DEC_BY[ai.level] ?? FOLLOW_DEC, gap = FOLLOW_GAP_BY[ai.level] ?? FOLLOW_GAP_M; // pros follow closer: they trust their brakes
        cap = Math.sqrt(Math.max(0, a.v * a.v + 2 * dec * (a.f - CAR_M - gap))); // no ramming: can always stop behind it
        // Going round a car that's (almost) stopped (stalled, AFK, still loading): creep, don't stop. Held at 0 m/s right behind
        // it the car can't steer out, and the race never ended
        if (b.passSide && a.o === b.passCar && a.v < 2) cap = Math.max(cap, CREEP_MS);
        if (a.f < 1.5 * v) b.followS += ctx.dt;
    } else if (!r.target || r.target.f < -CAR_M || r.target.f > AHEAD_M) { b.passSide = 0; b.passCar = null; } // out of my lane isn't done: done once it's behind me
    if (b.passSide) laneT = b.passSide * PASS_M;
    else {
        const brakingSoon = t.racingLine.phase[ahead(t, here, 150)] === 2;
        if (!b.defended && agg >= 0.3 && r.behind && -r.behind.f < 0.5 * v + CAR_M && brakingSoon && ph === 0) {
            b.defend = insideSide(t, here);
            b.defended = true;
        }
        if (b.defend) laneT = b.defend * DEFEND_M;
        else if (b.start && !b.start.t1) laneT = b.start.lane; // off the line: straight on from the grid slot, not across into single file
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
    if (b.start === undefined) { // first tick of a race: the grid slot's offset from the racing line (m) is the lane off the line
        const P = t.path[b.idx], N = L.N[b.idx];
        b.start = ctx.mode === 'race' && ctx.time < 1 ? { lane: ((p.x - P.x) * N.x + (p.y - P.y) * N.y - t.racingLine.offset[b.idx]) / sc, t1: false } : null;
        if (b.start) b.lane = b.start.lane;
    }
    // Stuck (nose in a wall, beached): back off for a second with the wheel the other way, then drive on. Under 1 m/s: a
    // car crawling out of gravel passes 1 m/s within a second (0.15 g), a car against a wall doesn't
    const r = scan(p, ctx, v);
    if (b.reverse > 0) { b.reverse -= ctx.dt; return { throttle: 0, brake: 1, steer: -b.revSteer, drs: false }; } // brake at a standstill reverses
    const clearBehind = !r.behind || -r.behind.f > 15, queued = r.ahead && r.ahead.f < 20; // held up isn't stuck; never back into someone
    b.slowS = v < 1.0 && ctx.time > (ai.reaction || 0) + 3 && clearBehind && !queued ? (b.slowS || 0) + ctx.dt : 0;
    if (b.slowS > 1.5) { b.slowS = 0; b.reverse = 1; b.revSteer = Math.sign(p.input?.steer || 1); }
    const pitting = ctx.mode === 'race' ? p.boxCall === 'this' : b.wantPit; // race: the game says this lap or next
    const toPit = pitting && t.pit && p.box ? ctx.toEntryM(p) : Infinity;
    const pastPit = toPit === Infinity ? Infinity : t.cum[t.path.length] / sc - toPit; // just past the mouth: still turning in
    // Turning in, just past the mouth, or in the lane with no stop (the game gave up on a jammed one): along the lane
    if (toPit < PIT_APPROACH_M) b.turningIn = true; else if (pastPit >= 150) b.turningIn = false;
    if (toPit < PIT_APPROACH_M || (b.turningIn && pastPit < 150) || (p.inPit && t.pit && p.box)) {
        const a = Drive.pitAssist(p, t), close = r.ahead && r.ahead.f < Math.max(12, v); // the lane has traffic too
        // Held up: brake, but not at a standstill (the brake there reverses: queued at Spa's entry they backed into the train)
        return close ? { throttle: 0, brake: v > 0.5 ? 1 : 0, steer: a.steer, drs: false } : { ...a, drs: false };
    }
    if (ctx.mode === 'race' && ctx.time < ai.reaction) return IDLE;
    if (b.bog === undefined) b.bog = ctx.mode === 'race' && ctx.rng() < (ai.bog || 0);
    const bogging = b.bog && ctx.time < ai.reaction + 0.3;
    const here = b.idx;
    let factor = (PACE.base / ai.pace) * Math.sqrt(p.tyreGrip ?? 1);
    if (ctx.mode === 'quali' && p.lapStart === null) factor *= 0.9; // out-lap
    if (ctx.formation) factor *= FORMATION_PACE; // formation lap: a steady lap, not a race one
    // A mistake at a corner entry, never with someone right there; it lasts until the corner is done (or 2.5 s)
    const phNow = t.racingLine.phase[here];
    if (b.start) { // turn 1: the column hold ends at its braking point (everyone funnels), the attack once it's done
        if (phNow === 2) b.start.t1 = true;
        if ((b.start.t1 && phNow === 0) || ctx.time > START_MAX_S) b.start = null;
    }
    if (phNow === 2 && b.prevPhase !== 2 && !b.err && !r.close && ctx.rng() < ai.mistake) {
        const roll = ctx.rng();
        b.err = { kind: roll < 0.4 ? 'late' : roll < 0.7 ? 'early' : 'apex', until: ctx.time + 2.5 };
    }
    b.prevPhase = phNow;
    if (b.err && (ctx.time > b.err.until || (phNow === 0 && b.err.until - ctx.time < 1.5))) b.err = null;
    if (b.err?.kind === 'late') factor *= 1.06;
    else if (b.err?.kind === 'early') factor *= 0.92;
    // Where I am on the racing line itself (its nearest point, followed forward), as the calibration's driver
    // (lineFollower.js) finds it: in a chicane the line cuts across the centreline, and the centreline's nearest point
    // (here) sits several points off, so speed, aim and turn came from the wrong part of the chicane
    const pts = L.pts, n = pts.length, d2 = (i) => (pts[i].x - p.x) ** 2 + (pts[i].y - p.y) ** 2;
    if (b.li == null || d2(b.li) > (40 * sc) ** 2) b.li = here;
    while (d2((b.li + 1) % n) < d2(b.li)) b.li = (b.li + 1) % n;
    const li = b.li, js = (li + 2) % n; // the speed target a short way ahead
    // The line's corner speeds are the car's real limit: past them it runs wide, so only straights get faster than the line
    const late = b.start && b.passSide && r.alongside ? START_LATE : 1; // alongside into turn 1: brakes a touch later and keeps the line
    // Corners at the line's limit (calibrated on new mediums), less on worn tyres, never more: at the limit some corners are
    // taken on full lock, where softs' extra grip can't turn the car any tighter (a bonus ran wide there). Worn: speed × grip
    // (√grip, the grip-limited figure, still ran wide out of lock-limited corners)
    const vLine = t.racingLine.speed[js] * late * (t.racingLine.phase[js] === 0 || b.err?.kind === 'late' ? factor : Math.min(factor, 1, p.tyreGrip ?? 1));
    const { laneT, cap } = racecraft(p, b, ctx, v, here, r, vLine);
    const diving = b.passSide && r.target && t.racingLine.phase[here] === 2 ? 1 + DIVE_LATE * ai.aggression : 1;
    if (toPit < PIT_SETUP_M) b.passSide = 0; // boxing: no moves on the way in, or it ends up alongside and can't cross to the entry
    const pitV = toPit < PIT_SETUP_M ? Math.sqrt(((t.pit.limitKmh || Drive.PIT_LIMIT_KMH) / 3.6) ** 2 + 2 * PIT_DEC * Math.max(0, toPit - PIT_APPROACH_M)) : Infinity;
    // Boxing: the corners into the pit entry at the grip model's speeds, not the true limit. A car on the limit has no margin
    // left to swing across to the mouth (Spa's opens at the exit of an 84° corner: it slid past it half the time)
    const boxing = toPit < PIT_SETUP_M || Math.abs(b.lane) > OFF_LINE_LANE_M || r.alongside ? 1 / (t.lineScale?.[js] ?? 1) : 1;
    const vt = Math.min(vLine * boxing * diving, cap, pitV);
    const laneWant = laneT + (b.err?.kind === 'apex' ? -insideSide(t, here) * 1.5 : 0);
    b.lane += clamp(laneWant - b.lane, -LANE_RATE_MS * ctx.dt, LANE_RATE_MS * ctx.dt);
    // Aim: exactly AIM_S (AIM_MIN_M) ahead, between the two line points either side of that distance (a whole point further
    // on, up to 10 m, made the arc look gentler than the turn and the pedals took grip the corner needed)
    const look = Math.max(AIM_MIN_M, v * AIM_S) * sc;
    const offAt = (i) => {
        let o = clamp(toPit < PIT_SETUP_M ? L.pitOff : t.racingLine.offset[i] + b.lane * sc, L.lo[i], L.hi[i]);
        if (r.alongside) { // room: their side of the track stays theirs through the corner
            const lim = (r.alongside.off - Math.sign(r.alongside.l) * ROOM_M) * sc;
            o = r.alongside.l > 0 ? Math.min(o, lim) : Math.max(o, lim);
        }
        return { x: t.path[i].x + L.N[i].x * o, y: t.path[i].y + L.N[i].y * o };
    };
    // Measured along the path being driven (a lane, the pit side): through a chicane the racing line cuts across it, and
    // distances to the line's points put the aim on the wrong side of the chicane (bang-bang steering, off at Suzuka's)
    const da = (i) => { const q = offAt(i); return Math.hypot(q.x - p.x, q.y - p.y); };
    let j = li;
    while (da(j) < look && (j + 1) % n !== li) j = (j + 1) % n;
    const h = (j - 1 + n) % n, dh = da(h), dj = da(j), f = dj > dh ? clamp((look - dh) / (dj - dh), 0, 1) : 1;
    // Steering and pedals as the calibration's driver (limitControl.js): the corner limits were found with this control,
    // so it drives them cleanly. The bot's own one (gain 4 on a rough lock, a throttle floor, braking blind to the turn)
    // ran wide out of corners at the calibrated speeds
    const A = offAt(h), B = offAt(j), tx = A.x + f * (B.x - A.x), ty = A.y + f * (B.y - A.y);
    const { steer, arc, need } = pursue(p, tx, ty, sc, parseAssist(p.assist).steer);
    // The turn as the calibration's driver judges it: the pursuit arc too once more than OFF_LINE_M from the nearest line
    // point (it's what the limits were found with; the bot's own finer test let it throttle where that one didn't)
    const turn = Math.sqrt(d2(li)) / sc > OFF_LINE_M ? Math.max(lineCurv(t)[li], arc) : lineCurv(t)[li];
    let { throttle, brake } = pedals(p, sc, vt, turn, steer);
    if (v < CRAWL_MS && vt > v) throttle = Math.max(throttle, 0.2); // crawling out of gravel it needs the power
    // The friction circle leaves no braking when the turn takes all the grip: right at the limit, but a car far over it
    // then sailed into the wall at full speed (Monaco's pool exit, off a passing lane). Shedding speed is the way out
    if (v > vt * OVER_K) { throttle = 0; brake = Math.max(brake, Math.min(1, (v - vt) / 2)); }
    if (need > LOCK_K && v > CRAWL_MS) { throttle = 0; brake = Math.max(brake, Math.min(1, need - LOCK_K)); }
    return { throttle: bogging ? Math.min(throttle, 0.6) : throttle, brake, steer, drs: !!p.drsAvailable && brake === 0 };
}

module.exports = { drive, state, insideSide, ahead, lineOf, scan, PACE, IDLE };
