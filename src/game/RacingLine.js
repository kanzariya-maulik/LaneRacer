// Racing line: minimum-curvature path within the track edges, and the speed the car carries along it.
// Speeds are the car's real limit (no help grip, full braking), so red starts where a good driver brakes.
const { C } = require('./CarPhysics');
const Physics = require('./Physics');
const { DOWN, MAX_SAFE, safeSpeeds } = require('./Assist');

const PASSES = 2000;     // smoothing passes (~100-160 ms per track)
const MARGIN_M = Physics.CAR_HALF_WIDTH_M + 0.5; // car centre this far inside the white line: its half width + 0.5 m

// Unit normals, same convention as offsetPoints in game3d.js: (x − ty·o, y + tx·o)
function normals(P) {
    const n = P.length;
    return P.map((_, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    });
}

function linePoints(P, offset) {
    const N = normals(P);
    return P.map((p, i) => ({ x: p.x + N[i].x * offset[i], y: p.y + N[i].y * offset[i] }));
}

// 1/R from the circle through points i−2, i, i+2 (metres)
function curvatures(L, scale) {
    const n = L.length;
    return L.map((_, i) => {
        const a = L[(i - 2 + n) % n], b = L[i], c = L[(i + 2) % n];
        const ab = Math.hypot(b.x - a.x, b.y - a.y) / scale, bc = Math.hypot(c.x - b.x, c.y - b.y) / scale, ca = Math.hypot(a.x - c.x, a.y - c.y) / scale;
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (scale * scale);
        return area2 > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0;
    });
}

// Cornering acceleration: every car has the same grip (the steering help adds lock, not grip). The line plans at
// LINE_GRIP of it, as a driver does: at real F1 grip there is no slack left for a steering correction otherwise
const LINE_GRIP = 0.98;
const latMax = (v) => LINE_GRIP * C.LAT_ASSIST * C.MU * (C.G + DOWN * v * v);
const drag = (v) => (0.5 * C.RHO * C.CDA * v * v) / C.MASS + C.ROLL_G * C.G;

function cornerSpeed(k) {
    if (k * MAX_SAFE * MAX_SAFE <= latMax(MAX_SAFE)) return MAX_SAFE;
    let lo = 0, hi = MAX_SAFE;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (m * m * k <= latMax(m)) lo = m; else hi = m; }
    return lo;
}

// Speed along a line: corner limits, then forward (drive) and backward (brake) passes, twice round so the lap wraps
function profile(L, scale, cap) {
    const n = L.length, k = curvatures(L, scale);
    const vmax = k.map((x, i) => Math.min(cornerSpeed(x), cap ? cap[i] : Infinity));
    const v = vmax.slice();
    const ds = L.map((p, i) => Math.hypot(L[(i + 1) % n].x - p.x, L[(i + 1) % n].y - p.y) / scale);
    const rem = (i, vi) => Math.sqrt(Math.max(0, 1 - ((vi * vi * k[i]) / latMax(vi)) ** 2)); // friction circle
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, vi = v[i];
        const a = Math.min(C.POWER / (C.MASS * Math.max(vi, 1)), C.TRACTION * C.MU * (C.G + DOWN * vi * vi)) * rem(i, vi) - drag(vi);
        v[j] = Math.min(v[j], Math.sqrt(Math.max(0, vi * vi + 2 * a * ds[i])));
    }
    for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n, vj = v[j];
        const a = C.MU * (C.G + DOWN * vj * vj) * rem(j, vj) + drag(vj); // full braking at the limit
        v[i] = Math.min(v[i], Math.sqrt(vj * vj + 2 * a * ds[i]));
    }
    const phase = v.map((vi, i) => {
        const drop = vi - v[(i + 1) % n];
        const cornerLimited = vi >= 0.97 * vmax[i] && vmax[i] < MAX_SAFE - 0.1; // not the straight-line speed cap
        return drop > 1 ? 2 : cornerLimited || drop > 0.1 ? 1 : 0; // a drop ≤ 0.1 m/s is float noise at top speed: flat
    });
    const lap = ds.reduce((s, d, i) => s + d / Math.max((v[i] + v[(i + 1) % n]) / 2, 0.1), 0);
    return { speed: v, phase, vmax, lap };
}

function compute(t) {
    const P = t.path, n = P.length, N = normals(P), m = MARGIN_M * t.scale; // inside the real white lines (+ = driver's right)
    const lo = t.edgeL.map((e) => -(e - m)), hi = t.edgeR.map((e) => e - m);
    // Minimum curvature: minimise Σ w_j·|L_{j−1} − 2L_j + L_{j+1}|², each point moving along its normal.
    // w_j = 1/ds_j⁵: |second difference| ≈ κ·ds², so ds⁻³ makes it Σκ²·ds, and the extra ds⁻² weighs tight spots
    // more (the peak sets the corner speed). Unweighted, points bunched on the inside of a hairpin look cheap and
    // the line pinches into a tighter apex than the centreline's.
    const o = new Array(n).fill(0);
    for (let pass = 0; pass < PASSES; pass++) {
        const L = P.map((p, i) => ({ x: p.x + N[i].x * o[i], y: p.y + N[i].y * o[i] }));
        const seg = L.map((p, i) => Math.hypot(L[(i + 1) % n].x - p.x, L[(i + 1) % n].y - p.y));
        const w = seg.map((s, j) => ((seg[(j - 1 + n) % n] + s) / 2) ** -5);
        for (let i = 0; i < n; i++) {
            const g = (d) => L[(i + d + n) % n], a = w[(i - 1 + n) % n], b = w[i], c = w[(i + 1) % n], s = a + 4 * b + c;
            const tx = (-a * (g(-2).x - 2 * g(-1).x) + 2 * b * (g(-1).x + g(1).x) - c * (g(2).x - 2 * g(1).x)) / s;
            const ty = (-a * (g(-2).y - 2 * g(-1).y) + 2 * b * (g(-1).y + g(1).y) - c * (g(2).y - 2 * g(1).y)) / s;
            // Where the normal meets the line through that target (along the line's own direction), not the target
            // projected on the normal: at a hairpin the normals converge and projection pulls points together
            const dx = g(1).x - g(-1).x, dy = g(1).y - g(-1).y, cr = N[i].x * dy - N[i].y * dx;
            const want = Math.abs(cr) > 0.3 * Math.hypot(dx, dy)
                ? ((tx - P[i].x) * dy - (ty - P[i].y) * dx) / cr
                : (tx - P[i].x) * N[i].x + (ty - P[i].y) * N[i].y;
            o[i] = Math.max(lo[i], Math.min(hi[i], o[i] + 0.5 * (want - o[i])));
        }
    }
    const offset = o.map((x) => Math.round(x * 10) / 10);
    const L = linePoints(P, offset);
    // Corner limit along the line at real grip (crests included): the braking help's targets, shared with the client
    const limit = safeSpeeds(L, t.scale, t.vcurv).map((v) => Math.floor(v * 10) / 10);
    const prof = profile(L, t.scale, limit);
    return { offset, speed: prof.speed.map((v) => Math.floor(v * 10) / 10), phase: prof.phase, limit, lapS: Math.round(prof.lap * 10) / 10 };
}

module.exports = { compute, profile, linePoints, curvatures, latMax, MARGIN_M };
