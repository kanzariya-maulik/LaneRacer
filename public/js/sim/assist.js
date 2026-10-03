// Driving assists that need the track: corner speed map (braking assist added in Game)
import { C } from './carphysics.js';

const DOWN = (0.5 * C.RHO * C.CLA) / C.MASS; // downforce acceleration per (m/s)², in m/s² / (m/s)²
const MAX_SAFE = 100;                         // m/s (360 km/h): flat out
const SPAN = 2;                               // points each side (~20 m) for the corner radius

// Highest speed (m/s) the car's cornering grip holds at each centreline point
function safeSpeeds(path, scale) {
    const n = path.length, A = C.LAT_ASSIST * C.MU;
    return path.map((_, i) => {
        const a = path[(i - SPAN + n) % n], b = path[i], c = path[(i + SPAN) % n];
        const ab = Math.hypot(b.x - a.x, b.y - a.y) / scale;
        const bc = Math.hypot(c.x - b.x, c.y - b.y) / scale;
        const ca = Math.hypot(a.x - c.x, a.y - c.y) / scale;
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (scale * scale);
        const curvature = area2 > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0; // 1/R = 4·area/(abc)
        // v²/R = A·(g + DOWN·v²)  →  v² = A·g / (1/R − A·DOWN)
        const k = curvature - A * DOWN;
        return k > 0 ? Math.min(MAX_SAFE, Math.sqrt((A * C.G) / k)) : MAX_SAFE;
    });
}

const BRAKE_MARGIN = 0.7;  // brake when a corner ahead needs this share of the car's braking grip at the corner speed
const LOOK_EXTRA_M = 30;
const AIM = 0.95;          // aim a little under the limit: a margin for the driver's line

function parseBrakeAssist(assist) {
    if (typeof assist === 'object' && assist !== null) {
        return Number.isFinite(assist.brake) ? Math.min(100, Math.max(0, assist.brake)) : 100;
    }
    if (typeof assist === 'string') {
        const m = assist.match(/^(\d+),(\d+)$/);
        if (m) return Math.min(100, Math.max(0, parseInt(m[2], 10)));
        const lower = assist.trim().toLowerCase();
        if (lower === 'off' || lower === 'steer' || lower === 'low') return 0;
        if (lower === 'medium') return 50;
        if (lower === 'full' || lower === 'high' || lower === 'brake') return 100;
    }
    return 100;
}

// Full assist: lift and brake when a corner ahead can't be made at this speed; the driver still steers
function brakeAssist(car, input, track, near, assist = '100,100') {
    const brakeVal = parseBrakeAssist(assist);
    if (brakeVal <= 0) return input; // 0% braking assist = DOES NOT BRAKE AUTOMATICALLY AT ALL

    const ratio = Math.min(1, Math.max(0, brakeVal / 100));
    const { path, cum, safeSpeed, scale } = track;
    const v = car.speed / scale;
    if (v < 5 || input.brake >= 1) return input;

    const reach = (v * v) / (2 * BRAKE_MARGIN * C.MU * C.G) + LOOK_EXTRA_M;
    const n = path.length, total = cum[n];
    const here = cum[near.i] + near.t * (cum[near.i + 1] - cum[near.i]);

    let maxAutoBrake = 0;

    for (let k = 1; k <= n; k++) {
        const j = (near.i + k) % n;
        const d = ((((cum[j] - here) % total) + total) % total) / scale;
        if (d > reach) break;

        const s = safeSpeed[j] * AIM;

        if (v > s && d > 0.5) {
            const maxGripDecel = BRAKE_MARGIN * C.MU * (C.G + DOWN * s * s);
            const reqDecel = (v * v - s * s) / (2 * d);
            if (reqDecel > maxGripDecel) {
                const demand = Math.min(1, reqDecel / maxGripDecel);
                const pwr = ratio * demand;
                if (pwr > maxAutoBrake) maxAutoBrake = pwr;
            }
        }
    }

    if (maxAutoBrake > 0) {
        const thr = (input.throttle || 0) * (1 - maxAutoBrake);
        const brk = Math.max(input.brake || 0, maxAutoBrake);
        return { throttle: thr, brake: brk, steer: input.steer, explicitReverse: input.explicitReverse };
    }

    return input;
}

export { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN, safeSpeeds, brakeAssist };
