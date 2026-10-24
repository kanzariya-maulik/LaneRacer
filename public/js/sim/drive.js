// The car's own motion for one tick: assist, tyres, pit wall, barriers, pit lane limiter.
// Shared: the server runs it for every car, the browser runs it to predict its own car.
import { C, step, parseAssist } from './carphysics.js';
import Physics from './physics.js';
import { brakeAssist } from './assist.js';
import { gripOf, wearLoad } from './tyres.js';
import { slopeAt, roadAt } from './elevation.js';
import { GRIP, rasterize, surfaceAt } from './surface.js';
import { wallIndex, collideWalls } from './walls.js';

export const PIT_RUNOFF_M = 2;     // the pit lane's run-off: this far outside its edge (build.js puts its barrier there)
export const PIT_LIMIT_KMH = 80;    // unless the circuit sets its own (circuits.json pitLimitKmh: Zandvoort 60)
export const DRS_DRAG = 0.89;      // drag with the flap open (~+13 km/h top speed, as in F1)
const BRIDGE_ROAD = 6;             // points either side of a bridge wall's own road that it applies to

// The track as built, ready for the sim: its surface grid and barrier index, made once per track object (the server's,
// or the copy the client got in game_init: the same data, so the same grid and walls)
const prepared = new WeakMap();
export function prepareTrack(t) {
    let r = prepared.get(t);
    if (r) return r;
    const xs = [], ys = [];
    for (const w of t.walls) for (const q of w.pts) { xs.push(q.x); ys.push(q.y); }
    for (const q of t.path) { xs.push(q.x); ys.push(q.y); }
    const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    r = { grid: rasterize(t.build.surfaces, bounds, t.scale), walls: wallIndex(t.walls, t.scale) };
    prepared.set(t, r);
    return r;
}

// What's under (x, y): the road out to the white line on that side, the kerb past it, then the circuit's surfaces
export function surfaceUnder(t, near, x, y) {
    const n = t.path.length, a = t.path[near.i], b = t.path[(near.i + 1) % n];
    const right = -(b.y - a.y) * (x - near.px) + (b.x - a.x) * (y - near.py) > 0; // + lateral = the driver's right
    const at = (A) => A[near.i] + (A[(near.i + 1) % n] - A[near.i]) * near.t;
    const edge = at(right ? t.edgeR : t.edgeL);
    if (near.dist <= edge) return 'road';
    if (near.dist <= edge + at(right ? t.kerbR : t.kerbL)) return 'kerb';
    return surfaceAt(prepareTrack(t).grid, x, y);
}

// Is (x, y) within reach of the pit lane (its bounding box, grown by the barrier distance)? Cached per pit lane
const pitBoxes = new WeakMap(), FAR_PIT = { dist: Infinity, px: 0, py: 0, i: 0, t: 0 };
function nearPitBox(pit, x, y) {
    let b = pitBoxes.get(pit);
    if (!b) {
        const m = pit.width * 2 + 200; // world units: well past the pit barrier
        b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const q of pit.path) { b.x0 = Math.min(b.x0, q.x - m); b.y0 = Math.min(b.y0, q.y - m); b.x1 = Math.max(b.x1, q.x + m); b.y1 = Math.max(b.y1, q.y + m); }
        pitBoxes.set(pit, b);
    }
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

// Distance along the pit lane of a nearestOnPath result
export const pitAlong = (pit, n) => pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);
// Half the lane's width at a nearestOnPath result (0 at the mouths: the lane tapers into the road edge)
export const pitHalf = (pit, n) => (pit.widthAt[n.i] + (pit.widthAt[Math.min(n.i + 1, pit.widthAt.length - 1)] - pit.widthAt[n.i]) * n.t) / 2;

// Barrier response (physics.js): n points from the barrier back toward the car
export const bounce = (p, nx, ny) => Physics.bounce(p, nx, ny);

// In the pit lane = on pit asphalt and off the track's (where they overlap, it's track), and on the lane's side of the pit
// wall: the wall stands at the lane's edge, and a car rubbing it from the track had its centre inside the lane's width (the
// assist then pinned it to the wall, steering for the lane centre); limiter caps speed
export function updatePitState(p, t, near, nearPit) {
    const pit = t.pit;
    p.pitS = pitAlong(pit, nearPit);
    p.inPit = nearPit.dist <= pitHalf(pit, nearPit) && surfaceUnder(t, near, p.x, p.y) !== 'road'
        && !Physics.crossWall(p.x, p.y, nearPit.px, nearPit.py, pit.wall);
    p.limiter = p.inPit && p.pitS >= pit.limStart && p.pitS <= pit.limEnd;
    if (p.limiter) {
        const max = ((pit.limitKmh || PIT_LIMIT_KMH) / 3.6) * t.scale, v = Math.hypot(p.vx, p.vy);
        if (v > max) {
            p.vx *= max / v;
            p.vy *= max / v;
            p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
        }
    }
}

// Can a car this far (m, along the lane) from its box still stop there? carphysics' straight-line braking: tyre grip on
// weight + downforce, plus drag, decel = A + B v², so the stopping distance is ln(1 + B v² / A) / 2B (matches the sim to
// within a few cm from 80 km/h; the caller's PARK_M is the margin)
export function canStopOnMark(p, t, metres) {
    const v = Math.hypot(p.vx, p.vy) / t.scale, mu = C.MU * (p.tyreGrip ?? 1);
    const A = mu * C.G, B = (0.5 * C.RHO * (mu * C.CLA + C.CDA)) / C.MASS;
    return Math.log(1 + (B * v * v) / A) / (2 * B) <= metres;
}

// Pit assist (Game.updateStop phases 'lane' and 'out'): along the pit lane's centre line at up to the limiter speed. 'lane'
// slows to ASSIST_ARRIVE_MS by ASSIST_HANDOVER_M before the box (guideToBox parks from there); 'out' runs to the limiter
// end. Stateless — steering and speed from the car and the track alone, so the client predictor makes the same choice
export const ASSIST_HANDOVER_M = 12, ASSIST_ARRIVE_MS = 15 / 3.6;
const ASSIST_DEC = 7;          // m/s² planned braking (the car manages ~15)
const ASSIST_LOOK_S = 0.35, ASSIST_LOOK_MIN_M = 8, ASSIST_GAIN = 2; // pedal per m/s of speed error
const ASSIST_LAT = 12, CURVE_SPAN_M = 20, CURVE_STEP_M = 5; // m/s² sideways in the lane's bends, radius from the turn over 20 m

// The lane centre this far along it (world units), carried straight on past the exit tip
export function pointOnPath(pit, s) {
    const P = pit.path, c = pit.cum, n = P.length;
    if (s >= c[n - 1]) {
        const a = P[n - 2], b = P[n - 1], ang = Math.atan2(b.y - a.y, b.x - a.x), over = s - c[n - 1];
        return { x: b.x + Math.cos(ang) * over, y: b.y + Math.sin(ang) * over, angle: ang };
    }
    let i = 0;
    while (i < n - 2 && c[i + 1] < s) i++;
    const a = P[i], b = P[i + 1], f = c[i + 1] > c[i] ? Math.max(0, (s - c[i]) / (c[i + 1] - c[i])) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export function pitAssist(p, t) {
    const pit = t.pit, sc = t.scale, v = p.speed / sc, s = pitAlong(pit, Physics.nearestOnPath(p.x, p.y, pit.path, false)); // own lookup: pitS/pitI are last tick's (unset in the predictor)
    // Steering: pure pursuit onto the lane centre a moment ahead (pulls a car out of its box, too)
    const aim = pointOnPath(pit, s + Math.max(ASSIST_LOOK_MIN_M, ASSIST_LOOK_S * Math.abs(v)) * sc);
    const dx = (aim.x - p.x) / sc, dy = (aim.y - p.y) / sc, ld = Math.max(1, Math.hypot(dx, dy));
    const err = Math.atan2(Math.sin(Math.atan2(dy, dx) - p.angle), Math.cos(Math.atan2(dy, dx) - p.angle));
    const k = (2 * Math.sin(err)) / ld; // 1/m
    const lock = (1 + C.ASSIST_STEER * parseAssist(p.assist).steer) * C.MAX_STEER, lockNow = lock / (1 + Math.abs(v) / C.STEER_FADE);
    const steer = Math.max(-1, Math.min(1, Math.atan(k * C.WHEELBASE) / lockNow));
    // Speed: the limiter, slowed for the pit-entry board and (arriving) for the box
    const limit = (pit.limitKmh || PIT_LIMIT_KMH) / 3.6;
    let want = limit;
    // before the board a hot car only brakes onto the curve that meets the limiter there; it never speeds up past the limiter
    if (s < pit.limStart) want = Math.max(limit, Math.min(v, Math.sqrt(limit * limit + 2 * ASSIST_DEC * (pit.limStart - s) / sc)));
    // ...and for the lane's bends: every bend within braking distance, met at sqrt(A_LAT R) (a hot entry would understeer
    // into the barrier otherwise)
    for (let d = 0; d <= (v * v) / (2 * ASSIST_DEC); d += CURVE_STEP_M) {
        const a = pointOnPath(pit, s + d * sc).angle, b = pointOnPath(pit, s + (d + CURVE_SPAN_M) * sc).angle;
        const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
        if (turn > 1e-3) want = Math.min(want, Math.sqrt((ASSIST_LAT * CURVE_SPAN_M) / turn + 2 * ASSIST_DEC * d));
    }
    if (p.stop?.phase === 'lane') {
        const toGo = Math.max(0, (p.box.s - s) / sc - ASSIST_HANDOVER_M);
        want = Math.min(want, Math.sqrt(ASSIST_ARRIVE_MS * ASSIST_ARRIVE_MS + 2 * ASSIST_DEC * toGo));
    }
    const more = want - v;
    return { steer, throttle: Math.max(0, Math.min(1, more * ASSIST_GAIN)), brake: Math.max(0, Math.min(1, -more * ASSIST_GAIN)), drs: false };
}

// A car being guided into its box (Game.updateStop): onto its mark, shuffling like a driver would. Box frame: a = metres along
// the box heading (< 0 short of the mark), l = metres to the side, h = heading error. The car drives the arc through the mark
// when its steering reaches; otherwise it picks the quickest first stroke (forward or reverse, full lock either way or straight)
// after which it does. Stateless: replanned every tick from the car alone, so the predictor makes the same choice
const GUIDE_ON_MARK_M = 0.3, GUIDE_REVERSE_MS = 2, GUIDE_FAST_MS = 4, GUIDE_STROKE_M = 6, GUIDE_STEP_M = 0.1;
const STROKE_ACC = 9, REVERSE_ACC = 7, STROKE_DEC = 11, TURN_S = 0.15; // m/s² planned with (drive forward / reverse, brake), s lost per direction change
// Forward arc from the origin heading +x to (X, Y): its curvature and length, or null past a half turn
function arcTo(X, Y) {
    if (X <= 0) return null;
    const k = (2 * Y) / (X * X + Y * Y), phi = 2 * Math.atan2(Y, X);
    return { k, len: Math.abs(k) < 1e-9 ? X : phi / k };
}
// Time to cover len (m) from rest to rest, forward or reverse (walking-pace cap)
function strokeS(len, fwd) {
    const acc = fwd ? STROKE_ACC : REVERSE_ACC, cap = fwd ? Infinity : GUIDE_REVERSE_MS, k = 1 / acc + 1 / STROKE_DEC;
    const peak = Math.sqrt((2 * len) / k);
    return peak <= cap ? peak * k : cap * k + (len - (cap * cap * k) / 2) / cap;
}
// The arc through the mark from a pose (box frame), driving forward (dir 1) or reversing (-1), if the lock allows
function finalArc(a, l, h, dir, kMax) {
    const c = Math.cos(h), s = Math.sin(h), fx = -a * c - l * s, fy = a * s - l * c; // the mark in the car's frame
    const arc = arcTo(dir * fx, fy);
    return arc && Math.abs(arc.k) <= kMax ? { dir, k: arc.k, len: arc.len } : null;
}
export function guideToBox(p, t) {
    const b = p.box, sc = t.scale, cb = Math.cos(b.angle), sb = Math.sin(b.angle);
    const dx = (p.x - b.x) / sc, dy = (p.y - b.y) / sc, a = dx * cb + dy * sb, l = -dx * sb + dy * cb, d = Math.hypot(a, l);
    const h = Math.atan2(Math.sin(p.angle - b.angle), Math.cos(p.angle - b.angle)), v = p.speed / sc;
    // On the mark, or would stop on it braking now (~15 m/s², straight on): stop
    const sd = (v * Math.abs(v)) / 30, sa = a + sd * Math.cos(h), sl = l + sd * Math.sin(h);
    if (d < GUIDE_ON_MARK_M || Math.hypot(sa, sl) < GUIDE_ON_MARK_M) return { steer: 0, throttle: v < -0.05 ? 1 : 0, brake: v > 0.05 ? 1 : 0, drs: false };
    const lock = (1 + C.ASSIST_STEER * parseAssist(p.assist).steer) * C.MAX_STEER, kMax = (0.95 * Math.tan(lock)) / C.WHEELBASE;
    const limit = (t.pit.limitKmh || PIT_LIMIT_KMH) / 3.6;
    let plan; // { dir, k, len }: the stroke to drive now and how far it goes before the car stops
    if (v > GUIDE_FAST_MS) {
        // Arriving: aim the arc at the mark (as tight as the steering allows at this speed), braking to stop on it
        const c = Math.cos(h), s = Math.sin(h), arc = arcTo(-a * c - l * s, a * s - l * c);
        plan = arc ? { dir: 1, k: arc.k, len: arc.len } : { dir: 1, k: 0, len: 0 };
    } else {
        const options = [];
        for (const dir of [1, -1]) {
            const f = finalArc(a, l, h, dir, kMax);
            if (f) options.push({ ...f, cost: strokeS(f.len, dir > 0) });
        }
        for (const dir of [1, -1]) for (const k of [kMax, 0, -kMax]) {
            let x = a, y = l, hh = h;
            for (let m = GUIDE_STEP_M; m <= GUIDE_STROKE_M + 1e-9; m += GUIDE_STEP_M) {
                // one step of the stroke: in the box frame the car moves along its heading (backwards when reversing)
                x += dir * GUIDE_STEP_M * Math.cos(hh); y += dir * GUIDE_STEP_M * Math.sin(hh); hh += dir * GUIDE_STEP_M * k;
                if (Math.hypot(x, y) < GUIDE_ON_MARK_M) { options.push({ dir, k, len: m, cost: strokeS(m, dir > 0) }); break; }
                // final arcs planned with room (85% lock): once the stroke ends, the arc surely reaches
                let fin = null;
                for (const d2 of [1, -1]) {
                    const f = finalArc(x, y, hh, d2, 1 * kMax);
                    if (f && (!fin || strokeS(f.len, d2 > 0) < strokeS(fin.len, fin.dir > 0))) fin = f;
                }
                if (fin) { options.push({ dir, k, len: m, cost: strokeS(m, dir > 0) + strokeS(fin.len, fin.dir > 0) + (fin.dir !== dir ? TURN_S : 0) }); break; }
            }
        }
        // Rolling: carry on the way it's going (stroke ends are where plans change, so no dithering at a crawl); at rest: quickest
        const moving = v > 0.02 ? 1 : v < -0.02 ? -1 : 0, same = options.filter((o) => o.dir === moving), pool = same.length ? same : options;
        let best = null;
        for (const o of pool) if (!best || o.cost < best.cost) best = o;
        plan = best || { dir: -1, k: 0, len: 1 }; // nothing within a stroke: back off and look again
    }
    // Steering: the curvature, as a share of the lock this speed allows. Speed: brake to stop where the stroke ends
    const lockNow = lock / (1 + Math.abs(v) / C.STEER_FADE), steer = Math.max(-1, Math.min(1, Math.atan(plan.k * C.WHEELBASE) / lockNow));
    const fwd = plan.dir > 0;
    const want = plan.dir * Math.min(fwd ? limit : GUIDE_REVERSE_MS,
        Math.sqrt(2 * STROKE_DEC * Math.max(0, plan.len - 0.1))); // steering takes brake
    // Speed error toward the stroke's direction: > 0 wants more. Forward: throttle speeds up, brake slows (never reversing a car
    // rolling forward). Reverse: brake backs up, throttle stops it. Proportional, so short strokes don't overshoot
    const more = plan.dir * (want - v), push = Math.min(1, Math.max(0, more * 10)), hold = Math.min(1, Math.max(0, -more * 10));
    return { steer, // same sign both ways: the planned curvature is per metre along the car's heading
        throttle: fwd ? push : hold, brake: fwd ? hold : push, drs: false };
}

export function driveCar(p, input, t, dt) {
    const scale = t.scale, pit = t.pit;
    // Pit stop (Game.updateStop): the game drives — along the lane (pitAssist), onto the mark (guideToBox), parked
    // while the tyres change or a quali car waits; the driver's input is ignored throughout
    const phase = p.stop?.phase;
    if (phase === 'service' || phase === 'hold' || phase === 'wait') {
        p.vx = p.vy = p.speed = 0; p.steer = 0; p.assistBrake = false;
        const near = Physics.nearestOnTrack(p.x, p.y, t, p.roadI);
        if (pit) updatePitState(p, t, near, Physics.nearestOnPath(p.x, p.y, pit.path, false)); // a quali car starts parked: in the lane
        return near;
    }
    if (phase && p.box) input = phase === 'guide' ? guideToBox(p, t) : pitAssist(p, t);
    const x0 = p.x, y0 = p.y;
    // The pit lane only matters near it: elsewhere a far-away answer without searching it (3 of these a tick)
    const nearPit = (x, y) => (!pit ? null : nearPitBox(pit, x, y) ? Physics.nearestOnPathHint(x, y, pit.path, p.pitI) : FAR_PIT);
    const before = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), beforePit = nearPit(p.x, p.y);
    // the pit lane's corridor is asphalt at its full width, mouths included (the apron between the lane and the road)
    const ground = beforePit && beforePit.dist <= pit.width / 2 ? null : GRIP[surfaceUnder(t, before, p.x, p.y)];
    // The road this car is on (followed from last tick, so it keeps its level at a bridge), and how that road climbs
    const road = slopeAt(t, p.x, p.y, p.angle, p.roadI); // hills: gravity, crests and compressions (flat without track z)
    p.grade = road.grade; p.vcurv = road.vcurv;
    if (road.i !== undefined) p.roadI = road.i;
    const level = parseAssist(p.assist).brake; // braking help: 0 off, 0.5 Low, 1 High (off in the pit lane)
    const used = level > 0 && !p.inPit && !p.stop ? brakeAssist(p, input, t, before, level) : input;
    p.assistBrake = used.brake > (input.brake || 0) + 0.05; // the help braked for the driver (the coach doesn't tell them to brake later)
    p.usedThrottle = used.throttle; // what the car got after the help (engine sound follows the help's lift)
    p.dragMul = (p.drs ? DRS_DRAG : 1) * (1 - (p.tow || 0));
    const speed0 = p.speed || 0;
    step(p, used, dt, scale, ground, p.assist);
    // Guided reverse: a walking-pace shuffle, never sped up past it (a car arriving faster is braked down by the guide)
    if (p.stop && p.speed < Math.min(speed0, -GUIDE_REVERSE_MS * scale)) {
        const k = Math.min(speed0, -GUIDE_REVERSE_MS * scale) / p.speed;
        p.vx *= k; p.vy *= k; p.speed *= k;
    }
    // Tyres wear with distance, harder the more grip is in use (tyres.js); grip follows
    if (p.compound) {
        const metres = Math.hypot(p.x - x0, p.y - y0) / scale;
        p.wear = Math.min(1, (p.wear || 0) + metres * (p.wearPerM || 0) * wearLoad(p.latUse || 0, used.brake || 0, ground ? 0 : (p.slip || 0)));
        p.tyreGrip = gripOf(p.compound, p.wear) * (p.gripEvo ?? 1); // qualifying: the track rubbers in (Game.quali.evo)
    }

    // Pit wall: a move across it is undone
    const hit = pit && Physics.crossWall(x0, y0, p.x, p.y, pit.wall);
    if (hit) {
        p.x = x0 + hit.nx * 0.5;
        p.y = y0 + hit.ny * 0.5;
        bounce(p, hit.nx, hit.ny);
    }

    // Bridges (Suzuka): parapets on the deck and the walls of the underpass, each only for cars on its own level
    if (t.bridges && t.bridges.length) {
        const mine = (p.roadI = roadAt(t, p.x, p.y, p.angle, p.roadI).i), n = t.path.length;
        for (const b of t.bridges) for (const w of b.walls) {
            const g = Math.abs(w.i - mine);
            if (Math.min(g, n - g) > BRIDGE_ROAD) continue;
            const seg = w.pts, cross = Physics.crossWall(x0, y0, p.x, p.y, seg); // follows the road's curve
            if (cross) { p.x = x0 + cross.nx * 0.5; p.y = y0 + cross.ny * 0.5; bounce(p, cross.nx, cross.ny); }
            const ov = Physics.wallOverlap(p, seg, scale);
            if (ov) { p.x += ov.nx * ov.depth; p.y += ov.ny * ov.depth; bounce(p, ov.nx, ov.ny); }
        }
    }

    // Barriers where they stand (the build data, the medians between two legs: Track.js walls)
    collideWalls(p, x0, y0, prepareTrack(t).walls, scale);
    const after = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), afterPit = nearPit(p.x, p.y);
    if (afterPit && afterPit !== FAR_PIT) p.pitI = afterPit.i;

    if (pit) updatePitState(p, t, after, afterPit);

    if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
        p.lastSafeX = p.x;
        p.lastSafeY = p.y;
    } else {
        p.x = p.lastSafeX; p.y = p.lastSafeY;
        p.vx = p.vy = p.speed = 0;
        if (!Number.isFinite(p.angle)) p.angle = 0;
    }
    return after;
}
