// Driving help that needs the track: corner speed maps and the braking help
import { C } from './carphysics.js';

const DOWN = (0.5 * C.RHO * C.CLA) / C.MASS; // downforce acceleration per (m/s)², in m/s² / (m/s)²
const MAX_SAFE = 100;                         // m/s (360 km/h): flat out
const SPAN = 2;                               // points each side (~20 m) for the corner radius

// Highest speed (m/s) the car's cornering grip holds at each centreline point.
// vcurv (optional, 1/m, Track's road shape): over a crest the car goes light (load 1 + vcurv·v²/g, as in carphysics),
// so a corner there is taken slower; a compression's extra grip isn't counted on
function safeSpeeds(path, scale, vcurv) {
    const n = path.length, A = C.LAT_ASSIST * C.MU;
    return path.map((_, i) => {
        const a = path[(i - SPAN + n) % n], b = path[i], c = path[(i + SPAN) % n];
        const ab = Math.hypot(b.x - a.x, b.y - a.y) / scale;
        const bc = Math.hypot(c.x - b.x, c.y - b.y) / scale;
        const ca = Math.hypot(a.x - c.x, a.y - c.y) / scale;
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (scale * scale);
        const curvature = area2 > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0; // 1/R = 4·area/(abc)
        // v²/R = A·(g + DOWN·v²)  →  v² = A·g / (1/R − A·DOWN)
        let crest = 0; // most negative vertical curvature over the same span
        if (vcurv) for (let d = -SPAN; d <= SPAN; d++) crest = Math.min(crest, vcurv[(i + d + n) % n] || 0);
        // v²/R = A·(g·load + DOWN·v²), load = 1 + crest·v²/g  →  v² = A·g / (1/R − A·(DOWN + crest))
        const k = curvature - A * (DOWN + crest);
        return k > 0 ? Math.min(MAX_SAFE, Math.sqrt((A * C.G) / k)) : MAX_SAFE;
    });
}

// Braking help. On the racing line it brakes for the line's true limits (track.lineLimit, calibrated), off it for the
// grip model's (track.helpLimit): with the true limits a driver a metre off the line left the road. Between ON_LINE_M
// and OFF_LINE_M off it, a blend.
// aim: share of the corner speed to arrive at; margin: share of the braking grip (at the corner speed) the help plans
// to use. The help cuts the throttle (so drive doesn't take the cornering grip on the friction circle, and a driver who
// holds the throttle still turns in) when the car is over the target for a corner point within liftM, or when the
// braking a corner needs is over liftK × the braking it plans (braking is imminent).
// High brakes early and lifts in the corner. Low brakes at the last moment with full grip, lifts only just before
// (about 0.5 s at 330 km/h) and aims lower, so leaning on it costs time.
// Tuned with test/help.test.js (flat-out driver): High a little slower than a no-help driver at the limit, Low slower still
const HIGH = { aim: 0.90, margin: 0.7, liftM: 30, liftK: 1 };
const LOW = { aim: 0.85, margin: 1.0, liftM: 30, liftK: 0.8 };
const LOOK_EXTRA_M = 30;
// Attacking (car.attack: a car just ahead, the driver beside it, set by the server): later braking, on more of the braking
// grip (High's 0.7 up to ATTACK_MARGIN; Low already brakes on all of it), against the grip model's corner speeds, the
// inside line's. Full grip or a faster apex ran a flat-out driver off on most tracks
const ATTACK_MARGIN = 0.85;
const ON_LINE_M = 0.5, OFF_LINE_M = 1.5;
const UPLIFT = 0.25; // share of the line's true gain over the grip model the help brakes for: it brakes on/off, not trailing
// off like a driver at the limit. A flat-out driver ran off Montreal above 0.3 (Monza's Ascari above 0.8)

// 0 on the racing line .. 1 OFF_LINE_M or more off it (no line: 1)
function offLine(car, { path, scale, racingLine }, near) {
    if (!racingLine?.offset || near.px === undefined) return 1;
    const n = path.length, a = path[near.i], b = path[(near.i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const o = ((car.x - near.px) * -(b.y - a.y) + (car.y - near.py) * (b.x - a.x)) / l, lo = racingLine.offset;
    const m = Math.abs(o - (lo[near.i] + (lo[(near.i + 1) % n] - lo[near.i]) * near.t)) / scale;
    return Math.min(1, Math.max(0, (m - ON_LINE_M) / (OFF_LINE_M - ON_LINE_M)));
}

// level: 0 off, 0.5 Low, 1 High. Stateless (client prediction runs it too). Worn tyres: lower targets, less braking
function brakeAssist(car, input, track, near, level) {
    const { path, cum, scale } = track, model = track.helpLimit || track.lineLimit, line = track.lineLimit || model;
    const v = car.speed / scale;
    if (!(level > 0) || v < 5 || input.brake >= 1) return input;
    const { aim, liftM, liftK, ...base } = level >= 1 ? HIGH : LOW, margin = car.attack ? Math.max(base.margin, ATTACK_MARGIN) : base.margin;
    const tyre = car.tyreGrip ?? 1, mu = C.MU * tyre, corner = aim * Math.sqrt(tyre);
    // The line's true limits only on the line, on fresh tyres (worn, they scale by grip, not √grip: the uplift on √grip ran
    // off on most tracks), and never attacking
    const up = car.attack ? 0 : UPLIFT * (1 - offLine(car, track, near)) * Math.min(1, Math.max(0, (tyre - 0.9) / 0.1));
    const limitAt = (j) => model[j] + (line[j] - model[j]) * up;
    const reach = (v * v) / (2 * margin * mu * C.G) + LOOK_EXTRA_M;
    const n = path.length, total = cum[n];
    const here = cum[near.i] + near.t * (cum[near.i + 1] - cum[near.i]);
    let lift = false; // cut the throttle: over the target for a corner point within liftM, or braking imminent
    for (let k = 0; k <= n; k++) {
        const j = (near.i + k) % n;
        const d = k === 0 ? 0 : ((((cum[j] - here) % total) + total) % total) / scale;
        if (d > reach) break;
        if (model[j] >= MAX_SAFE) continue; // a straight: never braked for (DRS and tow can beat the cap)
        const s = limitAt(j) * corner;
        if (!(v > s)) continue;
        if (d <= liftM) lift = true;
        if (k === 0) continue;
        // Downforce fades as the car slows, so judge against the grip left at the corner speed
        // Downhill (grade < 0) gravity eats into the braking: brake earlier; uphill it helps
        const need = (v * v - s * s) / (2 * Math.max(d, 1)), grip = margin * mu * (C.G + DOWN * s * s) + C.G * (car.grade || 0);
        if (need > grip) return { throttle: 0, brake: 1, steer: input.steer };
        if (need > liftK * grip) lift = true;
    }
    return lift && input.throttle > 0 ? { throttle: 0, brake: input.brake, steer: input.steer } : input;
}

export { DOWN, MAX_SAFE, HIGH, LOW, ATTACK_MARGIN, safeSpeeds, brakeAssist };
