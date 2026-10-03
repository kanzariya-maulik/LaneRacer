// Driving assists that need the track: corner speed map (braking assist added in Game)
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

const BRAKE_MARGIN = 0.7;  // brake when a corner ahead needs this share of the car's braking grip at the corner speed
const LOOK_EXTRA_M = 30;
const AIM = 0.95;          // aim a little under the limit: a margin for the driver's line

// Full assist: lift and brake when a corner ahead can't be made at this speed; the driver still steers
function brakeAssist(car, input, track, near) {
    const { path, cum, safeSpeed, scale } = track;
    const v = car.speed / scale;
    if (v < 5 || input.brake >= 1) return input;
    const reach = (v * v) / (2 * BRAKE_MARGIN * C.MU * C.G) + LOOK_EXTRA_M;
    const n = path.length, total = cum[n];
    const here = cum[near.i] + near.t * (cum[near.i + 1] - cum[near.i]);
    for (let k = 1; k <= n; k++) {
        const j = (near.i + k) % n;
        const d = ((((cum[j] - here) % total) + total) % total) / scale;
        if (d > reach) break;
        const s = safeSpeed[j] * AIM;
        // Downforce fades as the car slows, so judge against the grip left at the corner speed
        // Downhill (grade < 0) gravity eats into the braking: brake earlier; uphill it helps
        if (v > s && (v * v - s * s) / (2 * Math.max(d, 1)) > BRAKE_MARGIN * C.MU * (C.G + DOWN * s * s) + C.G * (car.grade || 0)) return { throttle: 0, brake: 1, steer: input.steer };
    }
    return input;
}

export { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN, safeSpeeds, brakeAssist };
