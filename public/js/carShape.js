// The F1 car (2023 ground-effect era), built in the browser from smooth parametric surfaces, and its liveries painted
// straight onto those surfaces. Every part is a function surface(u, v) → point, so
// the same function gives the mesh (any detail level: smooth near the camera, light far away), smooth normals, and,
// texel by texel, where each point of the livery texture lies on the car (team rules paint by part + position).
// No three.js here (carModel.js wraps it), so the livery worker can paint with it. Car frame: x forward, y left, z up, metres, origin between the axles on the ground. three.js: (x, z, -y).

export const WHEEL_RADIUS = 0.36;   // game3d.js WHEEL_RADIUS_M
export const WHEELS = { wheel_FL: [1.60, 0.80, 0.305], wheel_FR: [1.60, -0.80, 0.305], wheel_RL: [-1.85, 0.78, 0.405], wheel_RR: [-1.85, -0.78, 0.405] }; // x, y, width
export const DETAIL = { low: 0.38, mid: 0.65, high: 1.0 }; // × the base segment counts (~6k / 16k / 37k triangles)
export const ATLAS = 1024;

// ---------- curves ----------
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
// Catmull-Rom through rows of numbers (sections, path points) at u ∈ [0, 1], spaced by the first column's distance
function spline(rows) {
    const n = rows.length, d = [0];
    for (let i = 1; i < n; i++) d.push(d[i - 1] + Math.max(1e-6, Math.hypot(...rows[i].slice(0, 3).map((v, k) => v - (rows[i - 1][k] ?? 0)))));
    const L = d[n - 1];
    return (u) => {
        const s = Math.min(Math.max(u, 0), 1) * L;
        let i = 0; while (i < n - 2 && d[i + 1] < s) i++;
        const t = (s - d[i]) / (d[i + 1] - d[i] || 1), a = rows[Math.max(0, i - 1)], b = rows[i], c = rows[i + 1], e = rows[Math.min(n - 1, i + 2)];
        return b.map((_, k) => cr(a[k], b[k], c[k], e[k], t));
    };
}
const sgnPow = (c, e) => Math.sign(c) * Math.abs(c) ** e;

// ---------- surfaces: { part, f(u, v) → [x, y, z], c(u) → centre (normals point away from it), nu, nv, caps } ----------
// Rounded section: half-width wt at the top, wb at the bottom (wb < wt = undercut), squareness p
// inner: half-width on the side toward the centreline (a side part's inner half buried deep in the body: a clean seam,
// not two nearly coincident walls flickering through each other)
function loft(part, sections, { p = 3, nu = 28, nv = 40, yc = 0, inner = null } = {}) {
    const S = spline(sections.map((s) => [s[0], s[5] ?? yc, 0, s[1], s[2], s[3], s[4]]));
    return {
        part, nu, nv, caps: true,
        f: (u, v) => {
            const [x, y0, , wt, wb, zb, zt] = S(u), t = 2 * Math.PI * v, cu = sgnPow(Math.cos(t), 2 / p), sv = sgnPow(Math.sin(t), 2 / p), k = (sv + 1) / 2;
            const w = inner !== null && cu * Math.sign(y0) < 0 ? inner : wb + (wt - wb) * k;
            return [x, y0 + w * cu, zb + (zt - zb) * k];
        },
        c: (u) => { const [x, y0, , , , zb, zt] = S(u); return [x, y0, (zb + zt) / 2]; },
    };
}

// Cambered aerofoil (NACA 4-digit form), v round the profile from the trailing edge over the top and back underneath
function aerofoil(v, camber = 0.06, at = 0.4, thick = 0.12) {
    const up = v < 0.5, s = up ? 1 - 2 * v : 2 * v - 1, x = (1 - Math.cos(Math.PI * s)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < at ? (camber / at ** 2) * (2 * at * x - x * x) : (camber / (1 - at) ** 2) * (1 - 2 * at + 2 * at * x - x * x);
    return [x, yc + (up ? yt : -yt)];
}
// Wing across y; f = |y| / half: rise(f) lifts the section (tip curl, spoon), sweep(f) moves it back, aoa tilts it nose-up
function wing(part, { xLe, z, chord, thick, half, aoa = 0, rise = () => 0, sweep = () => 0, y0 = -half, camber = 0.06, nu = 28, nv = 30 }) {
    const a = (aoa * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), t = thick / chord;
    const at = (u) => { const y = y0 + (half - y0) * u, f = Math.abs(y) / half; return { y, x0: xLe - sweep(f), z0: z + rise(f) }; };
    return {
        part, nu, nv, caps: true,
        f: (u, v) => {
            const { y, x0, z0 } = at(u), [px, pz] = aerofoil(v, camber, 0.4, t), dx = -px * chord, dz = pz * chord;
            return [x0 + dx * ca + dz * sa, y, z0 - dx * sa + dz * ca];
        },
        c: (u) => { const { y, x0, z0 } = at(u); return [x0 - (chord / 2) * ca, y, z0 + (chord / 2) * sa + 0.03 * chord]; },
    };
}

// Tube through points (halo, swan neck, struts)
function tube(part, points, r, { nu = 24, nv = 12 } = {}) {
    const P = spline(points), d = (u) => { const a = P(Math.max(0, u - 0.01)), b = P(Math.min(1, u + 0.01)); const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
    return {
        part, nu: points.length > 2 ? nu : 1, nv, caps: true,
        f: (u, v) => {
            const c = P(u), t = d(u), ref = Math.abs(t[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
            const n = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]], nl = Math.hypot(...n);
            const N = n.map((q) => q / nl), B = [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]], w = 2 * Math.PI * v;
            return [0, 1, 2].map((k) => c[k] + r * (Math.cos(w) * N[k] + Math.sin(w) * B[k]));
        },
        c: (u) => P(u),
    };
}
const strut = (part, a, b, r = 0.016) => tube(part, [a, b], r, { nv: 8 });

function ellipsoid(part, [cx, cy, cz], [rx, ry, rz], { nu = 12, nv = 20 } = {}) {
    return {
        part, nu, nv, caps: false,
        f: (u, v) => { const th = Math.PI * u, ph = 2 * Math.PI * v; return [cx + rx * Math.cos(th), cy + ry * Math.sin(th) * Math.cos(ph), cz + rz * Math.sin(th) * Math.sin(ph)]; },
        c: () => [cx, cy, cz],
    };
}

// ---------- the car ----------
// Shapes from the 2023 cars (RB19, W14, SF-23 launch and track photos) inside the FIA box: 5.6 m long, 2.0 m wide,
// 0.95 m tall; 3.6 m wheelbase; 18" tyres 720 mm across, 305 / 405 mm wide
function parts() {
    const P = [], mirror = (fn) => { for (const s of [1, -1]) P.push(fn(s)); };
    // Floor: plank-to-edge floor board, edge wings curling up, diffuser kicking up to the beam wing
    P.push(loft('floor', [[1.20, 0.55, 0.55, 0.03, 0.065], [0.6, 0.80, 0.80, 0.03, 0.065], [-1.3, 0.80, 0.80, 0.03, 0.065], [-1.55, 0.64, 0.64, 0.035, 0.08]], { p: 10, nu: 10, nv: 28 }));
    mirror((s) => loft('floor', [[0.55, 0.018, 0.018, 0.065, 0.09, 0.80 * s], [-0.2, 0.018, 0.018, 0.065, 0.17, 0.80 * s], [-1.25, 0.018, 0.018, 0.065, 0.12, 0.80 * s]], { p: 6, nu: 14, nv: 12 }));
    P.push(loft('floor', [[-1.50, 0.62, 0.62, 0.04, 0.10], [-1.80, 0.58, 0.58, 0.07, 0.20], [-2.12, 0.54, 0.54, 0.12, 0.30]], { p: 10, nu: 12, nv: 28 }));
    // Survival cell and the nose sweeping down onto the front wing: one loft, so there's no seam between them
    P.push(loft('chassis', [[-0.40, 0.33, 0.36, 0.08, 0.60], [0.20, 0.32, 0.35, 0.09, 0.63], [0.90, 0.29, 0.32, 0.11, 0.60], [1.35, 0.25, 0.29, 0.14, 0.56],
        [1.85, 0.17, 0.21, 0.15, 0.45], [2.35, 0.10, 0.13, 0.14, 0.32], [2.74, 0.05, 0.065, 0.13, 0.22]], { p: 3.2, nu: 40, nv: 40 }));
    P.push(ellipsoid('cockpit', [0.30, 0, 0.628], [0.42, 0.22, 0.012]));                                   // cockpit opening (carbon)
    // Sidepods: tall narrow inlet, deep undercut, downwash ramp to the floor; a dark inlet mouth in front
    mirror((s) => loft('sidepods', [[0.86, 0.13, 0.07, 0.30, 0.58, 0.50 * s], [0.68, 0.19, 0.09, 0.16, 0.61, 0.51 * s], [0.40, 0.21, 0.10, 0.12, 0.61, 0.52 * s],
        [-0.40, 0.20, 0.11, 0.10, 0.50, 0.48 * s], [-1.00, 0.14, 0.10, 0.09, 0.30, 0.42 * s], [-1.40, 0.07, 0.06, 0.08, 0.15, 0.36 * s]], { p: 3.4, nu: 34, nv: 36, inner: 0.3 }));
    mirror((s) => ellipsoid('inlet', [0.865, 0.50 * s, 0.46], [0.012, 0.09, 0.10]));
    // Engine cover tapering to the coke-bottle tail; airbox and roll hoop above the helmet; crash structure; shark fin
    P.push(loft('engine', [[-0.30, 0.28, 0.34, 0.10, 0.66], [-0.90, 0.20, 0.26, 0.12, 0.60], [-1.40, 0.12, 0.16, 0.14, 0.44], [-1.85, 0.07, 0.09, 0.16, 0.32]], { p: 3, nu: 30, nv: 36 }));
    P.push(loft('engine', [[0.04, 0.07, 0.10, 0.64, 0.96], [-0.25, 0.08, 0.16, 0.60, 0.93], [-0.70, 0.06, 0.20, 0.58, 0.80], [-1.15, 0.02, 0.16, 0.56, 0.64]], { p: 2.2, nu: 24, nv: 30 }));
    P.push(ellipsoid('intake', [0.035, 0, 0.86], [0.012, 0.06, 0.075]));
    P.push(loft('engine', [[-1.80, 0.09, 0.10, 0.16, 0.34], [-2.30, 0.06, 0.07, 0.20, 0.31], [-2.48, 0.05, 0.05, 0.22, 0.30]], { p: 4, nu: 10, nv: 16 }));
    P.push(loft('fin', [[-0.80, 0.006, 0.006, 0.60, 0.80], [-1.70, 0.005, 0.005, 0.32, 0.62]], { p: 2, nu: 10, nv: 8 }));
    P.push(loft('light', [[-2.48, 0.035, 0.035, 0.225, 0.295], [-2.50, 0.035, 0.035, 0.225, 0.295]], { p: 8, nu: 1, nv: 8 }));  // rain light
    P.push(loft('tcam', [[0.08, 0.05, 0.05, 0.955, 0.985], [-0.02, 0.05, 0.05, 0.955, 0.985]], { p: 6, nu: 1, nv: 12 }));   // T-camera on the airbox
    // Halo: side arms over the cockpit into the centre pillar; the driver's helmet under it
    P.push(tube('halo', [[-0.10, 0.30, 0.60], [0.05, 0.28, 0.77], [0.35, 0.17, 0.83], [0.58, 0.0, 0.81], [0.35, -0.17, 0.83], [0.05, -0.28, 0.77], [-0.10, -0.30, 0.60]], 0.03, { nu: 40 }));
    P.push(tube('halo', [[0.58, 0, 0.81], [0.78, 0, 0.75], [0.96, 0, 0.62]], 0.028)); // front pillar onto the chassis (FIA: x ~0.98)
    P.push(ellipsoid('helmet', [0.18, 0, 0.74], [0.13, 0.115, 0.13], { nu: 14, nv: 22 }));
    // Mirrors on stalks
    mirror((s) => ellipsoid('chassis', [0.74, 0.56 * s, 0.68], [0.05, 0.10, 0.032], { nu: 8, nv: 14 })); // FIA box: x 0.65-0.83, y 0.47-0.68
    mirror((s) => strut('chassis', [0.72, 0.30 * s, 0.59], [0.74, 0.47 * s, 0.67], 0.012));
    // Suspension (carbon): wishbones front and rear, pull rods
    for (const s of [1, -1]) for (const [a, b] of [[[1.42, 0.22, 0.42], [1.60, 0.68, 0.45]], [[1.80, 0.20, 0.42], [1.60, 0.68, 0.45]], [[1.40, 0.20, 0.18], [1.60, 0.68, 0.24]],
        [[1.82, 0.18, 0.20], [1.60, 0.68, 0.24]], [[1.62, 0.66, 0.44], [1.50, 0.22, 0.20]], [[-1.60, 0.16, 0.40], [-1.85, 0.62, 0.46]], [[-2.05, 0.12, 0.40], [-1.85, 0.62, 0.46]],
        [[-1.60, 0.16, 0.18], [-1.85, 0.62, 0.24]], [[-2.05, 0.12, 0.20], [-1.85, 0.62, 0.24]], [[-1.86, 0.60, 0.25], [-1.70, 0.18, 0.44]]]) {
        P.push(strut('suspension', [a[0], a[1] * s, a[2]], [b[0], b[1] * s, b[2]]));
    }
    // Front wing: main plane and three flaps sweeping up to the tips, curved endplates
    P.push(wing('fw_main', { xLe: 2.92, z: 0.06, chord: 0.40, thick: 0.034, half: 0.95, aoa: -4, nu: 40, // raised centre under the nose (FIA: z ≥ 0.135 there)
        rise: (f) => 0.07 * Math.max(0, f - 0.45) / 0.55 + (f < 0.22 ? 0.045 * (1 + Math.cos((Math.PI * f) / 0.22)) / 2 : 0) }));
    for (let k = 0; k < 3; k++) {
        P.push(wing('fw_flap', { xLe: 2.64 - 0.09 * k, z: 0.10 + 0.045 * k, chord: 0.15, thick: 0.021, half: 0.93, aoa: -(14 + 9 * k), camber: 0.08,
            rise: (f) => (0.06 + 0.035 * k) * Math.max(0, f - 0.35) / 0.65, sweep: (f) => 0.05 * f * f, nu: 32 }));
    }
    mirror((s) => loft('fw_end', [[2.93, 0.010, 0.010, 0.04, 0.12, 0.955 * s], [2.62, 0.010, 0.010, 0.035, 0.25, 0.955 * s], [2.30, 0.010, 0.010, 0.06, 0.20, 0.955 * s]], { p: 6, nu: 16, nv: 10 }));
    // Rear wing, 2022+: spoon main plane, DRS flap whose tips roll down into curved endplates, two beam-wing elements, swan
    // neck hooked over the main plane, DRS actuator
    const roll = (f) => 0.20 * Math.max(0, (f - 0.70) / 0.30) ** 2;
    P.push(wing('rw_main', { xLe: -2.08, z: 0.82, chord: 0.30, thick: 0.03, half: 0.50, aoa: -8, rise: (f) => -0.035 * (1 - f * f) - roll(f), nu: 32 }));
    P.push(wing('rw_flap', { xLe: -2.25, z: 0.91, chord: 0.22, thick: 0.022, half: 0.50, aoa: -28, camber: 0.08, rise: (f) => -0.02 * (1 - f * f) - roll(f), sweep: (f) => 0.04 * roll(f) / 0.2, nu: 32 }));
    P.push(wing('rw_main', { xLe: -2.16, z: 0.40, chord: 0.17, thick: 0.018, half: 0.47, aoa: -6, nu: 20 }));
    P.push(wing('rw_main', { xLe: -2.24, z: 0.33, chord: 0.15, thick: 0.016, half: 0.47, aoa: -14, nu: 20 }));
    mirror((s) => loft('rw_end', [[-2.10, 0.010, 0.010, 0.66, 0.72, 0.505 * s], [-2.20, 0.010, 0.010, 0.58, 0.86, 0.505 * s], [-2.31, 0.010, 0.010, 0.30, 0.94, 0.505 * s],
        [-2.46, 0.010, 0.010, 0.30, 0.95, 0.505 * s], [-2.56, 0.010, 0.010, 0.56, 0.88, 0.505 * s]], { p: 6, nu: 20, nv: 10 }));
    P.push(tube('rw_pillar', [[-1.96, 0, 0.33], [-2.03, 0, 0.62], [-2.06, 0, 0.86], [-2.12, 0, 0.90], [-2.20, 0, 0.84]], 0.02, { nu: 20 }));
    P.push(ellipsoid('rw_pillar', [-2.33, 0, 0.955], [0.06, 0.025, 0.02], { nu: 8, nv: 12 }));
    return P;
}

// ---------- meshing ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// Outward unit normal at (u, v): du × dv by finite differences, the same way round over the whole surface (decided once,
// by most of its points facing away from its centre: per point, a thin wing's edges would flip)
const rawNormal = (S, u, v) => {
    const e = 1e-3;
    return cross(sub(S.f(Math.min(1, u + e), v), S.f(Math.max(0, u - e), v)), sub(S.f(u, (v + e) % 1), S.f(u, (v - e + 1) % 1)));
};
const outwards = new WeakMap();
function orientation(S) {
    if (!outwards.has(S)) {
        let vote = 0;
        for (let i = 0; i <= 8; i++) for (let j = 0; j < 16; j++) { const u = i / 8, v = j / 16; vote += Math.sign(dot(rawNormal(S, u, v), sub(S.f(u, v), S.c(u)))); }
        outwards.set(S, vote < 0 ? -1 : 1);
    }
    return outwards.get(S);
}
function normalAt(S, u, v) {
    const n = rawNormal(S, u, v);
    if (Math.hypot(...n) < 1e-12) return unit(sub(S.f(u, v), S.c(u))); // a pole (ellipsoid tip)
    return unit(n.map((q) => q * orientation(S)));
}
const counts = (S, k) => [Math.max(1, Math.round(S.nu * k)), Math.max(6, Math.round(S.nv * k))];
const area = (S) => { // rough lengths along u and round v, for the atlas
    let lu = 0, lv = 0;
    for (let i = 0; i < 6; i++) { const a = S.f(i / 6, 0.25), b = S.f((i + 1) / 6, 0.25); lu += Math.hypot(...sub(b, a)); const c = S.f(0.5, i / 6), d = S.f(0.5, (i + 1) / 6); lv += Math.hypot(...sub(d, c)); }
    return [Math.max(lu, 0.01), Math.max(lv, 0.01)];
};

// Atlas: a rectangle per surface, sized by its lengths (one texel density everywhere), shelf-packed in the unit square
let layout = null;
export function atlasLayout() {
    if (layout) return layout;
    const S = parts(), dims = S.map(area), pad = 3 / ATLAS;
    let lo = 0.01, hi = 2, best = null;
    for (let it = 0; it < 30; it++) {
        const k = (lo + hi) / 2, rects = [];
        let x = 0, y = 0, rowH = 0, ok = true;
        for (const i of dims.map((_, i) => i).sort((a, b) => dims[b][1] - dims[a][1])) {
            const w = dims[i][0] * k + 2 * pad, h = dims[i][1] * k + 2 * pad;
            if (w > 1) { ok = false; break; }
            if (x + w > 1) { x = 0; y += rowH; rowH = 0; }
            if (y + h > 1) { ok = false; break; }
            rects[i] = [x + pad, y + pad, w - 2 * pad, h - 2 * pad];
            x += w; rowH = Math.max(rowH, h);
        }
        if (ok) { lo = k; best = rects; } else hi = k;
    }
    return (layout = { S, rects: best });
}

// One BufferGeometry with every surface (uv into the atlas), smooth analytic normals, caps on closed lofts
export function bodyArrays(detail = 'mid', filter = (s) => s.part !== 'rw_flap', offset = null) {
    const { S, rects } = atlasLayout(), k = DETAIL[detail] ?? DETAIL.mid, pos = [], nrm = [], uv = [], idx = [];
    const to3 = (p) => [p[0], p[2], -p[1]]; // car frame → three.js (y up)
    S.forEach((s, si) => {
        if (filter && !filter(s)) return;
        const [nu, nv] = counts(s, k), [rx, ry, rw, rh] = rects[si], base = pos.length / 3;
        for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
            const u = i / nu, v = j / nv;
            const p3 = to3(s.f(u, v % 1));
            if (offset) pos.push(p3[0] - offset[0], p3[1] - offset[1], p3[2] - offset[2]);
            else pos.push(...p3);
            nrm.push(...to3(normalAt(s, u, v % 1)));
            uv.push(rx + u * rw, ry + v * rh);
        }
        // wind each quad so its face turns the same way as the outward normal
        const P = (i, j) => { const o = (base + i * (nv + 1) + j) * 3; return [pos[o], pos[o + 1], pos[o + 2]]; };
        const N = (i, j) => { const o = (base + i * (nv + 1) + j) * 3; return [nrm[o], nrm[o + 1], nrm[o + 2]]; };
        // every quad wound to face its own outward normal (one test for the whole surface got some inside out)
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            const a = base + i * (nv + 1) + j, b = a + nv + 1, c = b + 1, d = a + 1;
            const n = [0, 1, 2].map((q) => N(i, j)[q] + N(i + 1, j)[q] + N(i + 1, j + 1)[q] + N(i, j + 1)[q]);
            const flip = dot(cross(sub(P(i + 1, j + 1), P(i, j)), sub(P(i, j + 1), P(i + 1, j))), n) < 0; // diagonals' cross ∝ du × dv
            if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
        }
        if (s.caps) for (const [i, out] of [[0, -1], [nu, 1]]) { // flat caps: a fan from the ring's centre
            const ring = [], c = to3(s.c(i / nu)), du = to3(sub(s.c(Math.min(1, i / nu + 0.01)), s.c(Math.max(0, i / nu - 0.01))));
            const n = unit(du.map((q) => q * out)), cb = pos.length / 3;
            if (offset) pos.push(c[0] - offset[0], c[1] - offset[1], c[2] - offset[2]);
            else pos.push(...c);
            nrm.push(...n); uv.push(rx + (i / nu) * rw, ry + 0.25 * rh);
            for (let j = 0; j <= nv; j++) { const o = (base + i * (nv + 1) + j) * 3; pos.push(pos[o], pos[o + 1], pos[o + 2]); nrm.push(...n); uv.push(rx + (i / nu) * rw, ry + (j / nv) * rh); ring.push(cb + 1 + j); }
            const p0 = P(i, 0), p1 = P(i, 1), w = dot(cross(sub(p0, c), sub(p1, c)), n) < 0;
            for (let j = 0; j < nv; j++) w ? idx.push(cb, ring[j + 1], ring[j]) : idx.push(cb, ring[j], ring[j + 1]);
        }
    });
    return { pos, nrm, uv, idx };
}

export function drsFlapArrays(detail = 'mid') {
    return bodyArrays(detail, (s) => s.part === 'rw_flap', [-2.25, 0.91, 0]);
}

// ---------- liveries ----------
// Where every texel of the atlas lies on the car (position, normal, part): the same surfaces evaluated at texel centres
let bake = null;
function bakeAtlas(size) {
    if (bake && bake.size === size) return bake;
    const { S, rects } = atlasLayout(), n = size * size;
    const pos = new Float32Array(n * 3), side = new Uint8Array(n), top = new Uint8Array(n), part = new Array(S.length), owner = new Int16Array(n).fill(-1);
    const pad = 3 / size;
    S.forEach((s, si) => {
        part[si] = s.part;
        const [rx, ry, rw, rh] = rects[si];
        const x0 = Math.max(0, Math.floor((rx - pad) * size)), x1 = Math.min(size - 1, Math.ceil((rx + rw + pad) * size));
        const y0 = Math.max(0, Math.floor((ry - pad) * size)), y1 = Math.min(size - 1, Math.ceil((ry + rh + pad) * size));
        // positions on the rect's own texel grid (one surface evaluation each), normals from neighbouring texels: the
        // grid's u, v are the surface's, so the cross product of the two directions is the surface normal
        const W = x1 - x0 + 1, H = y1 - y0 + 1, g = new Float32Array(W * H * 3), us = new Float32Array(W);
        for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
            const u = Math.min(1, Math.max(0, ((x0 + tx + 0.5) / size - rx) / rw)), v = Math.min(1, Math.max(0, ((y0 + ty + 0.5) / size - ry) / rh));
            us[tx] = u;
            g.set(s.f(u, v % 1), (ty * W + tx) * 3);
        }
        const at = (tx, ty) => { const o = (Math.min(H - 1, Math.max(0, ty)) * W + Math.min(W - 1, Math.max(0, tx))) * 3; return [g[o], g[o + 1], g[o + 2]]; };
        for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
            const k = (y0 + ty) * size + x0 + tx;
            if (owner[k] >= 0) continue;
            const p = at(tx, ty), cu = cross(sub(at(tx + 1, ty), at(tx - 1, ty)), sub(at(tx, ty + 1), at(tx, ty - 1)));
            let nn = Math.hypot(...cu) > 1e-12 ? unit(cu) : unit(sub(p, s.c(us[tx])));
            if (dot(nn, sub(p, s.c(us[tx]))) < 0) nn = nn.map((q) => -q);
            pos.set(p, k * 3); side[k] = Math.abs(nn[1]) > 0.5 ? 1 : 0; top[k] = nn[2] > 0.5 ? 1 : 0; owner[k] = si;
        }
    });
    return (bake = { size, pos, side, top, owner, part });
}

const CARBON = '#1b1b1b';
const WINGS = ['fw_main', 'fw_flap', 'rw_main', 'rw_flap'], BODYWORK = ['chassis', 'sidepods', 'engine'];
// Each team: [colour, test(texel)] in order, the last that matches wins. t: { x, y, z, side, top, part, is(...names) }
// Tuned against the 2023 launch photos (F1.com); the nose is the chassis loft ahead of x 1.35
const band = (a, lo, hi) => a >= lo && a <= hi;
const nose = (t) => t.is('chassis') && t.x > 1.35;
const common = (body, wings = CARBON, halo = CARBON) => [[body, () => true], [CARBON, (t) => t.is('floor', 'rw_pillar', 'suspension', 'cockpit', 'intake', 'inlet', 'tcam')],
    [wings, (t) => t.is(...WINGS)], [halo, (t) => t.is('halo')], ['#ff1b1b', (t) => t.is('light')], ['#ffd400', (t) => t.is('tcam') && t.z > 0.975]];
export const LIVERIES = {
    redbull: () => { const NAVY = '#1b2a4a', RED = '#d7182a', YELLOW = '#ffcc00'; return [...common(NAVY),
        [RED, (t) => nose(t) && t.x > 2.35], [RED, (t) => t.is('engine') && t.side && band(t.x, -1.3, -0.4) && t.z > 0.32],
        [YELLOW, (t) => t.is('engine') && t.side && (t.x + 0.85) ** 2 + (t.z - 0.5) ** 2 < 0.09 ** 2], [RED, (t) => t.is('fw_end') && t.z > 0.2],
        [RED, (t) => t.is('sidepods') && t.side && Math.abs(t.z - (0.24 + 0.05 * (t.x + 0.3))) < 0.012], [YELLOW, (t) => t.is('helmet')]]; },
    mercedes: () => { const BLACK = '#101010', TEAL = '#00d2be'; return [...common(BLACK),
        [TEAL, (t) => t.is('sidepods', 'engine') && t.side && Math.abs(t.z - (0.30 + 0.08 * (t.x + 0.5))) < 0.02],
        [TEAL, (t) => t.is('chassis') && t.side && Math.abs(t.z - 0.30) < 0.015], [TEAL, (t) => t.is('fw_flap') && band(Math.abs(t.y), 0.3, 0.6)],
        [TEAL, (t) => t.is('rw_end') && band(t.z, 0.6, 0.65)], ['#f5e100', (t) => t.is('helmet')]]; },
    ferrari: () => { const RED = '#d40000', WHITE = '#f5f5f5'; return [...common(RED, RED),
        [CARBON, (t) => t.is('fw_main')], [CARBON, (t) => t.is('engine', 'fin') && t.top && t.x < -0.9], [CARBON, (t) => t.is('sidepods') && t.z < 0.2],
        [WHITE, (t) => t.is('fw_end') && band(t.z, 0.15, 0.2)], ['#ffd200', (t) => t.is('helmet')]]; },
    mclaren: () => { const PAPAYA = '#ff8000', BLUE = '#47c7fc', ANTH = '#2b2b2b'; return [...common(PAPAYA, ANTH),
        [ANTH, (t) => t.is(...BODYWORK) && t.side && t.z < 0.42], [BLUE, (t) => t.is('sidepods', 'chassis') && t.side && band(t.z, 0.42, 0.46)],
        [PAPAYA, (t) => t.is('rw_main', 'rw_flap', 'fw_end')], [BLUE, (t) => t.is('fw_end') && t.z < 0.1], ['#f5e100', (t) => t.is('helmet')]]; },
    astonmartin: () => { const GREEN = '#00665e', LIME = '#cedc00', BLACK = '#0d0d0d'; return [...common(GREEN),
        [BLACK, (t) => t.is(...BODYWORK) && t.side && t.z < 0.30], [LIME, (t) => t.is(...BODYWORK) && t.side && band(t.z, 0.30, 0.32)],
        [BLACK, (t) => t.is('fw_end', 'rw_end', 'fin')], [LIME, (t) => t.is('helmet')]]; },
    alpine: () => { const BLUE = '#0a6fd1', PINK = '#f59ad6', BLACK = '#111111'; return [...common(BLUE),
        [PINK, (t) => t.is('sidepods') && t.side && t.z > 0.18], [PINK, (t) => t.is('engine') && t.side && t.x < -0.9],
        [BLACK, (t) => t.is('sidepods', 'chassis') && t.side && t.z < 0.18], [PINK, (t) => t.is('rw_main', 'rw_flap', 'fw_flap')],
        [BLACK, (t) => t.is('rw_end')], [BLUE, (t) => t.is('helmet')]]; },
    williams: () => { const BLUE = '#0b2a8a', CYAN = '#37bdf8', BLACK = '#0d0d1a', RED = '#e0242f'; return [...common(BLUE),
        [BLACK, (t) => t.is(...BODYWORK) && t.side && t.z < 0.28], [CYAN, (t) => t.is('sidepods', 'engine') && t.side && Math.abs(t.z - (0.32 + 0.1 * (t.x + 0.2))) < 0.012],
        [RED, (t) => nose(t) && t.side && Math.abs(t.z - 0.26) < 0.01], [BLUE, (t) => t.is('rw_end', 'fw_end')], [CYAN, (t) => t.is('helmet')]]; },
    alphatauri: () => { const NAVY = '#1b2b45', WHITE = '#f2f2f2', RED = '#d71921'; return [...common(NAVY, CARBON, RED),
        [WHITE, (t) => nose(t)], [WHITE, (t) => t.is('chassis') && t.x > 0.6], [WHITE, (t) => t.is('engine', 'fin') && band(t.x, -1.1, -0.1) && t.z > 0.6],
        [RED, (t) => t.is('rw_main', 'rw_flap')], [RED, (t) => t.is('sidepods') && t.side && band(t.z, 0.12, 0.17)], [WHITE, (t) => t.is('helmet')]]; },
    alfaromeo: () => { const RED = '#b3001b', BLACK = '#151515'; return [...common(BLACK),
        [RED, (t) => t.is('chassis') && (t.top || t.z > 0.4)], [RED, (t) => t.is('engine', 'fin') && (t.top || t.z > 0.5)],
        [BLACK, (t) => t.is('fw_end', 'rw_end')], [RED, (t) => t.is('helmet')]]; },
    haas: () => { const BLACK = '#111111', WHITE = '#f2f2f2', RED = '#e10600'; return [...common(BLACK, CARBON, WHITE),
        [WHITE, (t) => t.is('chassis') && (t.top || t.z > 0.36)], [WHITE, (t) => t.is('sidepods') && t.side && Math.abs(t.z - 0.4) < 0.015],
        [RED, (t) => t.is('engine') && t.side && (t.x + 0.7) ** 2 + (t.z - 0.55) ** 2 < 0.1 ** 2], [RED, (t) => t.is('rw_main', 'rw_flap')],
        [RED, (t) => t.is('fw_flap') && band(Math.abs(t.y), 0.4, 0.9)], [WHITE, (t) => t.is('helmet')]]; },
    'redbull-suzuka': () => { const WHITE = '#f4f4f4', RED = '#d1001c'; return [...common(WHITE),
        [RED, (t) => t.is('engine') && t.top && band(t.x, -1.4, -0.25)], [RED, (t) => t.is('engine') && t.side && band(t.x, -1.3, -0.4) && t.z > 0.45],
        [RED, (t) => nose(t) && t.top && (t.x - 2.0) ** 2 + t.y ** 2 < 0.11 ** 2], [RED, (t) => t.is('chassis') && t.side && Math.abs(t.z - 0.40) < 0.01],
        [CARBON, (t) => t.is('sidepods') && t.z < 0.3], [RED, (t) => t.is('fw_main', 'fw_flap') && band(Math.abs(t.y), 0.35, 0.7)],
        [CARBON, (t) => t.is('rw_end', 'fw_end')], [WHITE, (t) => t.is('helmet')]]; },
};

// RGBA pixels (size²) of a team's livery on the atlas; unknown teams get plain grey bodywork
export function paintLivery(teamId, size = ATLAS) {
    const B = bakeAtlas(size), rules = (LIVERIES[teamId] || (() => common('#8a8f96')))(), out = new Uint8ClampedArray(size * size * 4);
    const rgb = new Map(), hex = (h) => rgb.get(h) || (rgb.set(h, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))), rgb.get(h));
    const t = { x: 0, y: 0, z: 0, side: false, top: false, part: '', is: (...names) => names.includes(t.part) };
    for (let k = 0; k < size * size; k++) {
        const o = B.owner[k];
        let c = '#000000';
        if (o >= 0) {
            t.x = B.pos[k * 3]; t.y = B.pos[k * 3 + 1]; t.z = B.pos[k * 3 + 2]; t.side = !!B.side[k]; t.top = !!B.top[k]; t.part = B.part[o];
            for (const [col, test] of rules) if (test(t)) c = col;
        }
        const [r, g, b] = hex(c);
        out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = 255;
    }
    return out;
}

