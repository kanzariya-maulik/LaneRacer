// Driving assists that need the track: corner speed map (braking assist added in Game)
const { C } = require('./CarPhysics');

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

module.exports = { DOWN, MAX_SAFE, safeSpeeds };
