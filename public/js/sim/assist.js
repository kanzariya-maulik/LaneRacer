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

// Braking help, judged against the racing line's corner speeds at real grip (track.lineLimit).
// aim: share of the corner speed to arrive at; margin: share of the braking grip (at the corner speed) the help plans
// to use. liftM: when the car is over the target for a corner point this close ahead, the help cuts the throttle, so
// drive doesn't take the cornering grip (friction circle) and a driver who holds the throttle still turns in.
// High brakes early and lifts in the corner. Low brakes at the last moment, but lifts as soon as a corner it can see
// (within its braking reach) is too fast, so leaning on it costs time.
// Tuned with test/help.test.js (flat-out driver): High a little slower than a no-help driver at the limit, Low slower still
const HIGH = { aim: 0.90, margin: 0.7, liftM: 30 };
const LOW = { aim: 0.90, margin: 1.0, liftM: Infinity };
const LOOK_EXTRA_M = 30;

// level: 0 off, 0.5 Low, 1 High. Stateless (client prediction runs it too). Worn tyres: lower targets, less braking
function brakeAssist(car, input, track, near, level) {
    const { path, cum, lineLimit, scale } = track;
    const v = car.speed / scale;
    if (!(level > 0) || v < 5 || input.brake >= 1) return input;
    const { aim, margin, liftM } = level >= 1 ? HIGH : LOW;
    const tyre = car.tyreGrip ?? 1, mu = C.MU * tyre, corner = aim * Math.sqrt(tyre);
    const reach = (v * v) / (2 * margin * mu * C.G) + LOOK_EXTRA_M;
    const n = path.length, total = cum[n];
    const here = cum[near.i] + near.t * (cum[near.i + 1] - cum[near.i]);
    let lift = false; // a corner point in the lift window that the car is over the target for
    for (let k = 0; k <= n; k++) {
        const j = (near.i + k) % n;
        const d = k === 0 ? 0 : ((((cum[j] - here) % total) + total) % total) / scale;
        if (d > reach) break;
        if (lineLimit[j] >= MAX_SAFE) continue; // a straight: never braked for (DRS and tow can beat the cap)
        const s = lineLimit[j] * corner;
        if (d <= liftM && v > s) lift = true;
        // Downforce fades as the car slows, so judge against the grip left at the corner speed
        // Downhill (grade < 0) gravity eats into the braking: brake earlier; uphill it helps
        if (k > 0 && v > s && (v * v - s * s) / (2 * Math.max(d, 1)) > margin * mu * (C.G + DOWN * s * s) + C.G * (car.grade || 0)) {
            return { throttle: 0, brake: 1, steer: input.steer };
        }
    }
    return lift && input.throttle > 0 ? { throttle: 0, brake: input.brake, steer: input.steer } : input;
}

export { DOWN, MAX_SAFE, HIGH, LOW, safeSpeeds, brakeAssist };
