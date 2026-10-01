// Racing line: minimum-curvature path within the track edges, and the speed the car carries along it.
// Visual only: speeds are capped to what the Full braking assist allows, so the colours match what the car does.
const { C } = require('./CarPhysics');
const { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN } = require('./Assist');

const PASSES = 2000;     // smoothing passes (prototype: ~50 ms per track; more passes don't make laps faster)
const MARGIN_M = 1.5;    // keep this far inside the track edge
const PIT_MARGIN_M = 3;  // ...and this far on the pit side before the closed pit entry
const PIT_RAMP_M = 60;   // matches Track.js CLOSE_RAMP_M

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

// Cornering acceleration with the (always-on) steering assist's extra grip below 250 km/h
const assistK = (v) => Math.max(0, Math.min(1, (C.ASSIST_OFF_KMH - v * 3.6) / (C.ASSIST_OFF_KMH - C.ASSIST_FULL_KMH)));
const latMax = (v) => (1 + C.ASSIST_GRIP * assistK(v)) * C.LAT_ASSIST * C.MU * (C.G + DOWN * v * v);
const drag = (v) => (0.5 * C.RHO * C.CDA * v * v) / C.MASS + C.ROLL_G * C.G;

function cornerSpeed(k) {
    if (k * MAX_SAFE * MAX_SAFE <= latMax(MAX_SAFE)) return MAX_SAFE;
    let lo = 0, hi = MAX_SAFE;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (m * m * k <= latMax(m)) lo = m; else hi = m; }
    return lo;
}

// Speed along a line: corner limits, then forward (drive) and backward (brake) passes, twice round so the lap wraps
// assist (optional): { cum, safe } — also hold each point to the Full braking assist's own rule, so red starts where it brakes
function profile(L, scale, cap, assist) {
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
        const a = BRAKE_MARGIN * C.MU * (C.G + DOWN * vj * vj) * rem(j, vj) + drag(vj); // where the braking assist starts
        v[i] = Math.min(v[i], Math.sqrt(vj * vj + 2 * a * ds[i]));
    }
    if (assist) holdToAssist(v, assist, scale);
    const phase = v.map((vi, i) => {
        const drop = vi - v[(i + 1) % n];
        const cornerLimited = vi >= 0.97 * vmax[i] && vmax[i] < MAX_SAFE * AIM - 0.1; // not the straight-line speed cap
        return drop > 1 ? 2 : cornerLimited || drop > 0 ? 1 : 0;
    });
    const lap = ds.reduce((s, d, i) => s + d / Math.max((v[i] + v[(i + 1) % n]) / 2, 0.1), 0);
    return { speed: v, phase, vmax, lap };
}

// Mirror of Assist.brakeAssist: it brakes when some point j ahead needs more than BRAKE_MARGIN of the grip at its
// target speed s_j (centreline distance, at least 1 m). Keep v[i] under that limit for every j within reach.
function holdToAssist(v, { cum, safe }, scale) {
    const n = v.length, total = cum[n];
    for (let i = 0; i < n; i++) {
        const reach = (v[i] * v[i]) / (2 * BRAKE_MARGIN * C.MU * C.G) + 30;
        for (let k = 1; k <= n; k++) {
            const j = (i + k) % n, d = ((((cum[j] - cum[i]) % total) + total) % total) / scale;
            if (d > reach) break;
            const s = safe[j] * AIM;
            v[i] = Math.min(v[i], Math.sqrt(s * s + 2 * Math.max(d, 1) * BRAKE_MARGIN * C.MU * (C.G + DOWN * s * s)) - 0.05);
        }
    }
}

// Track points in the 60 m before the closed pit entry, and which offset sign faces the pit lane
function pitWindow(t) {
    const P = t.path, n = P.length, pit = t.pit, total = t.cum[n];
    let pk = 0;
    for (let k = 0; k < pit.path.length; k++) if (pit.cum[k] <= pit.closeS) pk = k;
    const q = pit.path[pk];
    let c = 0, best = Infinity;
    P.forEach((p, i) => { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < best) { best = d; c = i; } });
    const N = normals(P)[c];
    const side = Math.sign((q.x - P[c].x) * N.x + (q.y - P[c].y) * N.y) || 1;
    const idx = [];
    for (let k = -1; k < n; k++) {
        const i = (c - k + n) % n;
        if (((t.cum[c] - t.cum[i] + total) % total) / t.scale > PIT_RAMP_M) break;
        idx.push(i);
    }
    return { side, idx };
}

function compute(t) {
    const P = t.path, n = P.length, N = normals(P), lim = t.width / 2 - MARGIN_M * t.scale;
    const lo = new Array(n).fill(-lim), hi = new Array(n).fill(lim);
    if (t.pit) {
        const { side, idx } = pitWindow(t), pl = t.width / 2 - PIT_MARGIN_M * t.scale;
        for (const i of idx) { if (side > 0) hi[i] = Math.min(hi[i], pl); else lo[i] = Math.max(lo[i], -pl); }
    }
    // Minimum curvature: pull each point toward the 4th-order smooth of its neighbours, along its normal
    const o = new Array(n).fill(0);
    for (let pass = 0; pass < PASSES; pass++) {
        const L = P.map((p, i) => ({ x: p.x + N[i].x * o[i], y: p.y + N[i].y * o[i] }));
        for (let i = 0; i < n; i++) {
            const g = (d) => L[(i + d + n) % n];
            const tx = (-g(-2).x + 4 * g(-1).x + 4 * g(1).x - g(2).x) / 6, ty = (-g(-2).y + 4 * g(-1).y + 4 * g(1).y - g(2).y) / 6;
            const want = (tx - P[i].x) * N[i].x + (ty - P[i].y) * N[i].y;
            o[i] = Math.max(lo[i], Math.min(hi[i], o[i] + 0.5 * (want - o[i])));
        }
    }
    const offset = o.map((x) => Math.round(x * 10) / 10);
    const prof = profile(linePoints(P, offset), t.scale, t.safeSpeed.map((s) => s * AIM), { cum: t.cum, safe: t.safeSpeed });
    return { offset, speed: prof.speed.map((v) => Math.floor(v * 10) / 10), phase: prof.phase };
}

module.exports = { compute, profile, linePoints, curvatures, latMax, pitWindow };
