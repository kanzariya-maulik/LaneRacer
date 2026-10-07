// Deterministic trackside scenery from the circuit's own shape. Pure, shared by game3d.js and the node tests.
import { pathHeights } from './sim/elevation.js';
import { themeOf } from './themes.js';
export const WALL_OFFSET = 80;          // world units past the track edge (public/js/sim/drive.js)
const PIT_RUNOFF_M = 2;                 // drive.js: the pit lane's barrier this far outside its edge
const SLOW_MS = 150 / 3.6;              // corners slower than this get gravel, tyre walls, a grandstand
const TEXTS = ['LAN RACE', 'FULL SEND', 'DRS ZONE', 'BOX BOX', 'LIGHTS OUT', 'PUSH PUSH'];

export function seedOf(id) {
    let h = 2166136261;
    for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
}

function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function heading(path, i) {
    const n = path.length, a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
    return Math.atan2(b.y - a.y, b.x - a.x);
}
const offset = (p, angle, off) => ({ x: p.x - Math.sin(angle) * off, y: p.y + Math.cos(angle) * off });

function distTo(path, x, y, closed = true) {
    let best = Infinity;
    for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + t * (b.x - a.x)), y - (a.y + t * (b.y - a.y))));
    }
    return best;
}

export const safeDist = (t) => t.width / 2 + (t.wallOffset ?? WALL_OFFSET) + 3 * t.scale;

// Spatial index of the centreline, so the ~100,000 nearest-road questions behind the terrain read a handful of segments
// each instead of all ~600: a fine grid (40 m cells: which segments pass through) near the track, and a coarse map
// (200 m: each area's nearest segment and its distance) for the open fields far from it. Built once per track.
const CELL_M = 40, NEAR_RINGS = 6, FAR_CELL_M = 200, FAR_SPREAD = 8, indexes = new WeakMap();
function trackIndex(t) {
    let g = indexes.get(t.path);
    if (g) return g;
    const P = t.path, n = P.length, cell = CELL_M * t.scale, cells = new Map();
    for (let j = 0; j < n; j++) {
        const a = P[j], b = P[(j + 1) % n];
        for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= Math.floor(Math.max(a.x, b.x) / cell); cx++)
            for (let cy = Math.floor(Math.min(a.y, b.y) / cell); cy <= Math.floor(Math.max(a.y, b.y) / cell); cy++) {
                const k = cx * 100003 + cy;
                if (!cells.has(k)) cells.set(k, []);
                cells.get(k).push(j);
            }
    }
    const far = FAR_CELL_M * t.scale, xs = P.map((p) => p.x), ys = P.map((p) => p.y), pad = 3000 * t.scale;
    const fx0 = Math.min(...xs) - pad, fy0 = Math.min(...ys) - pad;
    const fw = Math.ceil((Math.max(...xs) + pad - fx0) / far) + 1, fh = Math.ceil((Math.max(...ys) + pad - fy0) / far) + 1;
    const farNear = new Int32Array(fw * fh), farDist = new Float64Array(fw * fh);
    for (let iy = 0; iy < fh; iy++) for (let ix = 0; ix < fw; ix++) {
        const px = fx0 + ix * far, py = fy0 + iy * far;
        let bd = Infinity, bj = 0;
        for (let j = 0; j < n; j++) { const d = (P[j].x - px) ** 2 + (P[j].y - py) ** 2; if (d < bd) { bd = d; bj = j; } }
        farNear[iy * fw + ix] = bj; farDist[iy * fw + ix] = Math.sqrt(bd);
    }
    g = { cell, cells, n, far, fx0, fy0, fw, fh, farNear, farDist, stamp: new Uint32Array(n), epoch: 0 };
    indexes.set(t.path, g);
    return g;
}

// Nearest centreline point to (x, y) among segments j with accept(j): { d (world units), j, k (0..1 along it) }.
// Near the track: rings of fine cells outwards until nothing unread could be nearer. Far out: the coarse map's
// candidates (the segments around its four surrounding areas' nearest ones). Allocation-free apart from the result.
function nearestSeg(t, x, y, accept = null) {
    const P = t.path, g = trackIndex(t), { cell, cells, n, stamp } = g, ep = ++g.epoch;
    let bd = Infinity, bj = -1, bk = 0;
    const test = (j) => {
        if (stamp[j] === ep) return;
        stamp[j] = ep;
        if (accept && !accept(j)) return;
        const a = P[j], b = P[(j + 1) % n], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
        const k = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0, d = Math.hypot(x - a.x - k * ex, y - a.y - k * ey);
        if (d < bd) { bd = d; bj = j; bk = k; }
    };
    const fix = Math.max(0, Math.min(g.fw - 2, Math.floor((x - g.fx0) / g.far))), fiy = Math.max(0, Math.min(g.fh - 2, Math.floor((y - g.fy0) / g.far)));
    const farAway = g.farDist[fiy * g.fw + fix] - 1.5 * g.far > NEAR_RINGS * cell; // no track within reach of the rings
    if (!farAway) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        for (let r = 0; r <= NEAR_RINGS; r++) {
            if (bd <= (r - 1) * cell) return { d: bd, j: bj, k: bk }; // everything unread is at least (r - 1) cells away
            for (let ox = -r; ox <= r; ox++) {
                const edge = ox === -r || ox === r;
                for (let oy = -r; oy <= r; oy += edge ? 1 : 2 * r) {
                    const list = cells.get((cx + ox) * 100003 + cy + oy);
                    if (list) for (let q = 0; q < list.length; q++) test(list[q]);
                }
            }
        }
        if (bd <= NEAR_RINGS * cell) return { d: bd, j: bj, k: bk };
    }
    if (accept) return { d: bd, j: bj, k: bk }; // filtered (another stretch of road): only within reach of the rings matters
    for (const k of [fiy * g.fw + fix, fiy * g.fw + fix + 1, (fiy + 1) * g.fw + fix, (fiy + 1) * g.fw + fix + 1])
        for (let s = -FAR_SPREAD; s <= FAR_SPREAD; s++) test((((g.farNear[k] + s) % n) + n) % n);
    return { d: bd, j: bj, k: bk };
}

const SAME_ROAD = 6;  // points (~60 m) either side along the lap count as the same stretch of road
const BANK = 1.5;    // grass bank between two roads at different heights: metres across per metre of height
const FAR_GROUND_M = 300; // beyond this from any road the ground just follows the nearest one

// Nearest point of the track to (x, y) on a stretch other than the one around point i, within ~240 m (none: j = -1;
// further away it can't shape the banks here): { d (world units), h (m), j }
function otherRoad(t, x, y, i) {
    const n = t.path.length, best = nearestSeg(t, x, y, (j) => { const g = Math.abs(j - i); return Math.min(g, n - g) > SAME_ROAD; });
    return { ...best, h: best.j >= 0 && t.z ? t.z[best.j] + (t.z[(best.j + 1) % n] - t.z[best.j]) * best.k : 0 };
}

// Is (x, y) on the pit lane's asphalt, or within extra (world units) of it (bounding box first: most points are nowhere
// near)
const pitBoxes = new WeakMap(), PIT_BOX_PAD_M = 3;
export function onPit(t, x, y, extra = 0) {
    const pit = t.pit;
    if (!pit) return false;
    const P = pit.path, r = pit.width / 2 + PIT_BOX_PAD_M * t.scale;
    let box = pitBoxes.get(pit);
    if (!box) {
        const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
        pitBoxes.set(pit, (box = [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r]));
    }
    const [bx0, by0, bx1, by1] = box;
    return x >= bx0 && x <= bx1 && y >= by0 && y <= by1 && distTo(P, x, y, false) < pit.width / 2 + extra;
}

// How far the verge may reach from the centreline at each point on one side (dir 1 / -1), up to the barrier: stops where
// another part of the track is nearer (inside of a hairpin, Suzuka's bridge), so it never lies over other asphalt, at
// the pit lane, and short of a road at another height by room for a grass bank (BANK) so neither road floats over a cliff
export function vergeReach(t, dir) {
    const P = t.path, half = t.width / 2, max = half + (t.wallOffset ?? WALL_OFFSET);
    const step = 2 * t.scale, n = P.length;
    const r = P.map((p, i) => {
        const h = heading(P, i), at = (o) => {
            const q = offset(p, h, dir * o);
            if (nearestSeg(t, q.x, q.y).d < o * 0.95) return false;
            // stops just short of the pit lane: grass never over its asphalt, also halfway to each neighbour (the verge quad
            // spans to them, and a pit lane joining at an angle can pass between two points' rays)
            for (const k of [-1, 1]) {
                const m = P[(i + k + n) % n], hm = heading(P, (i + k + n) % n), qm = offset(m, hm, dir * o);
                if (onPit(t, (q.x + qm.x) / 2, (q.y + qm.y) / 2, 0.5 * t.scale)) return false;
            }
            if (onPit(t, q.x, q.y, 0.5 * t.scale)) return false;
            if (!t.z) return true;
            const other = otherRoad(t, q.x, q.y, i); // both roads stop short, leaving the bank between their verges
            return other.d - o >= BANK * Math.abs(t.z[i] - other.h) * t.scale;
        };
        // the whole width out to o, not just its edge: at a crossing the other road cuts through the middle
        const clear = (o) => { for (let m = half + step / 4; m < o; m += step) if (!at(m)) return false; return at(o); }; // from the edge: a merging pit lane can cover it
        if (clear(max)) return max;
        let lo = half, hi = max;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (clear(m)) lo = m; else hi = m; }
        return lo;
    });
    // Along a bridge's cutting (Suzuka) the lower road's verge ends at the cutting wall: past it the ground stays high (it
    // was lowered behind the wall's ends, leaving it standing free)
    for (const b of t.bridges || []) {
        if (!t.cum || !b.cut || !b.walls) continue;
        const wall = Math.hypot(b.walls[2].pts[0].x - b.cut[0].x, b.walls[2].pts[0].y - b.cut[0].y), total = t.cum[n];
        for (let i = 0; i < n; i++) {
            const d = Math.abs(t.cum[i] - b.lower.s), along = Math.min(d, total - d);
            if (along <= b.under / 2 + 10 * t.scale) r[i] = Math.min(r[i], wall);
        }
    }
    // A quad joins neighbouring points: one short point between long ones would still leave a quad slanting across
    return r.map((_, i) => Math.min(r[(i - 2 + n) % n], r[(i - 1 + n) % n], r[i], r[(i + 1) % n], r[(i + 2) % n]));
}

// How far the verge edge's skirt hangs (m) per path point on one side: the grass skirt, or where the ground beside a
// hillside road falls away further (Monaco's Beau Rivage climb above the harbour), a retaining wall down to it; none (0)
// where the verge ends at the pit lane, whose asphalt carries on at the same level.
// ground: (x, y) → m, the ground as drawn (gridSampler); reach: vergeReach(t, dir)
export const SKIRT_M = 3;
export function skirtDepth(t, reach, dir, ground) {
    const P = t.path, n = P.length;
    return P.map((p, i) => {
        if (!t.z) return SKIRT_M;
        const e = offset(p, heading(P, i), dir * reach[i]);
        if (onPit(t, e.x, e.y, 1.5 * t.scale)) return 0;
        // the lowest drawn ground just past the edge: square to this point's heading and to the next segment's (they differ
        // in a hairpin), half a metre to two metres out
        const q = P[(i + 1) % n], seg = Math.atan2(q.y - p.y, q.x - p.x);
        let low = Infinity;
        for (const h of [heading(P, i), seg]) for (const out of [0.5, 1, 2]) {
            const e = offset(p, h, dir * (reach[i] + out * t.scale));
            low = Math.min(low, ground(e.x, e.y));
        }
        return Math.max(SKIRT_M, t.z[i] - low + 0.5);
    });
}

// Height (m) at (x, y) of a terrainHeights grid as three.js draws it: the triangle there (cell corners a (0,0) b (0,1)
// c (1,1) d (1,0), split along b-d)
export function gridSampler(H, x0, y0, w, h, segs) {
    const N = segs + 1, cw = w / segs, ch = h / segs;
    return (x, y) => {
        const u = Math.max(0, Math.min(segs - 1e-6, (x - x0) / cw)), v = Math.max(0, Math.min(segs - 1e-6, (y - y0) / ch));
        const ix = Math.floor(u), iy = Math.floor(v), fu = u - ix, fv = v - iy;
        const A = H[iy * N + ix], B = H[(iy + 1) * N + ix], C = H[(iy + 1) * N + ix + 1], D = H[iy * N + ix + 1];
        return fu + fv <= 1 ? A * (1 - fu - fv) + D * fu + B * fv : C * (fu + fv - 1) + B * (1 - fu) + D * (1 - fv);
    };
}

// Ground height (m) at (x, y): a road's own height out to its verge edge, then a straight grass bank across to the next
// road's verge edge (two roads at different heights: no cliff, no floating road). reach: { 1: vergeReach(t, 1),
// [-1]: vergeReach(t, -1) }
// Which side of the road (x, y) is on at point j, in vergeReach's dir convention
function sideOf(P, j, x, y) {
    const h = heading(P, j);
    return -Math.sin(h) * (x - P[j].x) + Math.cos(h) * (y - P[j].y) > 0 ? 1 : -1;
}

// On the asphalt or its verge (drawn at road height)? Past it the drawn ground is the terrain grid, which can bank down
// to a lower road (game3d.js puts a car's wheel there on the terrain, not in the air at road height)
export function onVerge(t, reach, x, y) {
    if (!t.z) return true;
    const { d, j, k } = nearestSeg(t, x, y), r = reach[sideOf(t.path, j, x, y)], n = t.path.length;
    return d <= r[j] + (r[(j + 1) % n] - r[j]) * k;
}

export function terrainGround(t, reach) {
    const P = t.path, n = P.length;
    const lerp = (a, j, k) => a[j] + (a[(j + 1) % n] - a[j]) * k;
    const side = (j, x, y) => sideOf(P, j, x, y);
    return (x, y) => {
        if (!t.z) return 0;
        const { d: d1, j: j1, k: k1 } = nearestSeg(t, x, y);
        const h1 = lerp(t.z, j1, k1), e1 = Math.max(0, d1 - lerp(reach[side(j1, x, y)], j1, k1));
        if (e1 === 0) return h1; // on this road's verge
        if (d1 > FAR_GROUND_M * t.scale) return h1; // far out in the fields: banks and cuttings only matter near the roads
        const o = otherRoad(t, x, y, j1);
        if (o.j < 0) return h1;
        const e2 = Math.max(0, o.d - lerp(reach[side(o.j, x, y)], o.j, o.k));
        // Two roads at different heights: the ground stays at the higher one and the lower one runs in a cutting, its
        // grass bank rising BANK across per metre up from its verge edge; beside a bridge the cutting has vertical walls
        // (game3d.js buildBridge) instead, so the bank is 0 wide there
        const [hi, lo, eLo, jLo] = h1 >= o.h ? [h1, o.h, e2, o.j] : [o.h, h1, e1, j1];
        const near = (t.bridges || []).some((b) => (b.lower.i === jLo || Math.abs(b.lower.i - jLo) <= 6) && Math.hypot(x - b.x, y - b.y) < b.under / 2);
        const bank = near ? 0 : BANK * (hi - lo) * t.scale;
        return eLo >= bank ? hi : lo + ((hi - lo) * eLo) / bank;
    };
}

// How far from the centreline the ground is held at road level, per side and point: the run-off out to the verge edge
// (normally the barrier) and a metre past it, so no grass rises through the run-off or over the barrier's foot.
// reach: { 1: vergeReach(t, 1), [-1]: vergeReach(t, -1) }
export const carveReach = (t, reach) => ({ 1: reach[1].map((r) => r + t.scale), [-1]: reach[-1].map((r) => r + t.scale) });

// Terrain height grid (m) over a rectangle, (segs + 1)² vertices, row-major from (x0, y0): ground(x, y) minus `sink`
// (ground: the nearest road's height, so it sits just under each road's verge and two roads at different heights get a
// bank between them), then pressed down under every road out to `reach` from the centreline (a number, or carveReach's
// per side and point) and under the pit lane and its run-off, so no triangle of it covers a road (the lower one at a
// bridge included), the run-off or the pit lane
export function terrainHeights(t, x0, y0, w, h, segs, ground, sink, reach) {
    const N = segs + 1, H = new Float64Array(N * N), cw = w / segs, ch = h / segs, P = t.path, n = P.length;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) H[iy * N + ix] = ground(x0 + ix * cw, y0 + iy * ch) - sink;
    if (!t.z) return H;
    // Road points every 2 m over the asphalt and kerbs: the triangle under each (three.js PlaneGeometry: cell corners
    // a (0,0), b (0,1), c (1,1), d (1,0), split along b-d) must stay `sink` below it. Where it doesn't, lower that
    // triangle's corners by their share of the excess (least change), so corners away from the road barely move: a
    // whole-cell minimum would drag down the ground beside a neighbouring road at another height
    const step = 2 * t.scale, pts = [];
    const press = (x, y, target) => {
        const u = (x - x0) / cw, v = (y - y0) / ch, ix = Math.floor(u), iy = Math.floor(v);
        if (ix < 0 || iy < 0 || ix >= segs || iy >= segs) return;
        const fu = u - ix, fv = v - iy, A = iy * N + ix, B = (iy + 1) * N + ix, Cc = (iy + 1) * N + ix + 1, D = iy * N + ix + 1;
        const tri = fu + fv <= 1 ? [[A, 1 - fu - fv], [D, fu], [B, fv]] : [[Cc, fu + fv - 1], [B, 1 - fu], [D, 1 - fv]];
        pts.push({ tri, w2: tri.reduce((sum, [, w]) => sum + w * w, 0), target });
    };
    const out = (dir, i) => (typeof reach === 'number' ? reach : Math.min(reach[dir][i], reach[dir][(i + 1) % n]));
    // Sideways the way game3d draws the verge (offsetPoints): each point's own normal, blended along the segment, so the
    // outside of a bend has no wedge left unpressed between one segment and the next
    const norm = P.map((_, i) => { const h = heading(P, i); return [-Math.sin(h), Math.cos(h)]; });
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = P[i], b = P[j], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, [ax, ay] = norm[i], [bx, by] = norm[j];
        const lo = -out(-1, i), hi = out(1, i);
        for (let s = 0; s <= len; s += step) for (let l = lo; l <= hi + step / 2; l += step) {
            const f = s / len, ll = Math.min(l, hi);
            press(a.x + ax * ll + (b.x + bx * ll - a.x - ax * ll) * f, a.y + ay * ll + (b.y + by * ll - a.y - ay * ll) * f, t.z[i] + (t.z[j] - t.z[i]) * f - sink);
        }
    }
    // The pit lane (at the height of the road beside it, as game3d draws it) and its run-off out to its barrier
    if (t.pit) {
        const Q = t.pit.path, wide = t.pit.width / 2 + PIT_RUNOFF_M * t.scale, Z = pathHeights(t, Q);
        for (let i = 0; i + 1 < Q.length; i++) {
            const a = Q[i], b = Q[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
            const ha = Z[i], hb = Z[i + 1];
            for (let s = 0; s <= len; s += step) for (let l = -wide; l <= wide + step / 2; l += step) {
                const f = s / len, ll = Math.min(l, wide);
                press(a.x + (b.x - a.x) * f + nx * ll, a.y + (b.y - a.y) * f + ny * ll, ha + (hb - ha) * f - sink);
            }
        }
    }
    for (let pass = 0; pass < 8; pass++) {
        let worst = 0;
        for (const p of pts) {
            const excess = p.tri.reduce((sum, [k, w]) => sum + w * H[k], 0) - p.target;
            if (excess <= 0) continue;
            worst = Math.max(worst, excess);
            for (const [k, w] of p.tri) H[k] -= (excess * w) / p.w2;
        }
        if (worst < 0.01) break;
    }
    return H;
}

// Mean spacing of the centreline's points (Monaco's are 5 m apart, the rest ~10 m): counts per point scale by it
const meanStep = (t) => (t.cum ? t.cum[t.path.length] / t.path.length : 10 * t.scale);

export function placeScenery(t, density, seed, theme = themeOf(t.id)) {
    const P = t.path, n = P.length, sc = t.scale, rand = rng(seed);
    const clear = safeDist(t) + 0.5 * sc; // a little margin over the tested clearance
    const ok = (x, y) => distTo(P, x, y) > clear && !(t.pit && distTo(t.pit.path, x, y, false) <= t.pit.width / 2 + 7 * sc);

    // Slow corners: runs of points under SLOW_MS, extended to the exit; side = outside of the turn
    const slowCorners = [];
    for (let i = 0; i < n; i++) {
        if (t.safeSpeed[i] >= SLOW_MS || (t.safeSpeed[(i - 1 + n) % n] < SLOW_MS && i > 0)) continue;
        let j = i;
        while (j - i < n && t.safeSpeed[(j + 1) % n] < SLOW_MS) j++;
        const mid = (i + j) >> 1;
        let d = heading(P, (mid + 1) % n) - heading(P, mid);
        d = Math.atan2(Math.sin(d), Math.cos(d));
        slowCorners.push({ from: (i - 3 + n) % n, to: (j + 5) % n, side: d > 0 ? -1 : 1, apex: mid % n });
    }

    // Grandstands: main straight opposite the pits, plus the outside of the 3 slowest corners
    const grandstands = [];
    const stand = (i, side, back) => {
        const h = heading(P, i);
        for (let extra = 0; extra < 60 * sc; extra += 10 * sc) {
            const q = offset(P[i], h, side * (back + extra));
            const c = Math.cos(h), s = Math.sin(h);
            const fits = [-30, -15, 0, 15, 30].every((a) => [-6, 6].every((d) =>
                ok(q.x + (c * a - s * d) * sc, q.y + (s * a + c * d) * sc)));
            if (fits) return grandstands.push({ x: q.x, y: q.y, angle: h, len: 60 * sc });
        }
    };
    const startIdx = t.cum ? t.cum.findIndex((c) => c >= (t.startS || 0)) : 0;
    stand(Math.max(0, startIdx), t.pit ? t.pit.trackSide : 1, clear + 8 * sc);
    [...slowCorners].sort((a, b) => t.safeSpeed[a.apex % n] - t.safeSpeed[b.apex % n]).slice(0, 3)
        .forEach((c) => stand(c.apex % n, c.side, clear + 10 * sc));

    // Trees: beyond the barrier, denser further out; kinds and count from the circuit's theme
    const trees = [], kinds = Object.entries(theme.trees);
    const kindAt = (r) => { for (const [k, share] of kinds) if ((r -= share) <= 0) return k; return kinds[0][0]; };
    const want = Math.round(n * 0.6 * density * theme.density * (10 * sc / meanStep(t)));
    for (let k = 0; k < want * 3 && trees.length < want; k++) {
        const i = Math.floor(rand() * n), side = rand() < 0.5 ? -1 : 1;
        const q = offset(P[i], heading(P, i), side * (clear + (15 + 105 * Math.sqrt(rand())) * sc));
        if (ok(q.x, q.y)) trees.push({ x: q.x, y: q.y, size: rand() < 0.7 ? 1 : 2, kind: kindAt(rand()) });
    }

    // Buildings: a box footprint (w × d m, along × across) clear of the track and the pit lane
    const buildings = [];
    const fits = (q, h, w, d) => { const c = Math.cos(h), s = Math.sin(h); return [-w / 2, w / 2].every((a) => [-d / 2, d / 2].every((e) => ok(q.x + (c * a - s * e) * sc, q.y + (s * a + c * e) * sc))); };
    const block = (i, side, out, w, d, hgt) => {
        const h = heading(P, i), q = offset(P[i], h, side * out);
        if (fits(q, h, w, d)) buildings.push({ x: q.x, y: q.y, angle: h, w, d, h: hgt, tone: rand() });
    };
    if (theme.city === 2) { // streets lined with buildings, right behind the barriers (Monaco)
        for (let i = 0; i < n; i += 2) for (const side of [-1, 1]) for (const row of [0, 1, 2]) {
            const w = 14 + rand() * 16, d = 12 + rand() * 10;
            block(i, side, clear + (6 + d / 2 + row * 26 + rand() * 6) * sc, w, d, 12 + rand() * (row ? 40 : 22));
        }
    } else if (theme.city === 1) { // a skyline past the trees
        const want2 = Math.round(80 * density);
        for (let k = 0; k < want2 * 4 && buildings.length < want2; k++) {
            const i = Math.floor(rand() * n), side = rand() < 0.5 ? -1 : 1;
            block(i, side, clear + (260 + rand() * 700) * sc, 20 + rand() * 30, 20 + rand() * 25, 15 + rand() * rand() * 90);
        }
    }

    // Marshal posts behind the barrier every ~300 m, alternating sides
    const posts = [];
    for (let s = 150 * sc, k = 0; t.cum && s < t.cum[n]; s += 300 * sc, k++) {
        const i = Math.max(0, t.cum.findIndex((c) => c >= s)) % n, side = k % 2 ? 1 : -1, h = heading(P, i), q = offset(P[i], h, side * (clear + 1 * sc));
        if (ok(q.x, q.y)) posts.push({ x: q.x, y: q.y, angle: h });
    }

    // Floodlight towers (drawn at night) behind the barrier every ~60 m, alternating sides, as round Sakhir
    const floodlights = [];
    for (let s = 30 * sc, k = 0; t.cum && s < t.cum[n]; s += 60 * sc, k++) {
        if (t.tunnels?.some(([a, b]) => s >= a && s <= b)) continue; // Monaco's tunnel has its own lamps
        const i = Math.max(0, t.cum.findIndex((c) => c >= s)) % n, side = k % 2 ? 1 : -1, h = heading(P, i);
        for (const out of [3, 8, 14]) { // just behind the barrier, or a little further back where that's taken
            const q = offset(P[i], h, side * (clear + out * sc));
            if (ok(q.x, q.y)) { floodlights.push({ x: q.x, y: q.y, angle: h, side }); break; }
        }
    }

    // 300 / 200 / 100 m boards before the slow corners, on the outside
    const boards = [];
    if (t.cum) for (const c of slowCorners) {
        const entry = t.cum[c.from];
        for (const m of [300, 200, 100]) {
            const s = (((entry - m * sc) % t.cum[n]) + t.cum[n]) % t.cum[n], i = Math.max(0, t.cum.findIndex((x) => x >= s)) % n;
            if (t.safeSpeed[i] < 90) continue; // only on the straight before it
            const h = heading(P, i), q = offset(P[i], h, c.side * (clear + 0.5 * sc));
            if (ok(q.x, q.y)) boards.push({ x: q.x, y: q.y, angle: h, side: c.side, text: String(m) });
        }
    }

    // The circuit's landmark (Suzuka's Ferris wheel, COTA's tower): behind the main straight on the far side from the pits
    let landmark = null;
    if (theme.landmark) {
        const i = Math.max(0, startIdx), side = t.pit ? -t.pit.trackSide : 1, h = heading(P, i);
        for (let out = 120; out < 600 && !landmark; out += 20) {
            const q = offset(P[i], h, side * (clear + out * sc));
            if (fits(q, h, 70, 70)) landmark = { x: q.x, y: q.y, angle: h, kind: theme.landmark };
        }
    }

    // Billboards along flat-out straights, facing the track
    const billboards = [];
    const every = Math.max(10, Math.round(15 / density)); // path points (~10 m each)
    for (let i = 0, k = 0; i < n; i += every, k++) {
        if (t.safeSpeed[i] < 100) continue;
        const side = k % 2 ? 1 : -1, h = heading(P, i);
        const q = offset(P[i], h, side * (clear + 1 * sc));
        if (ok(q.x, q.y)) billboards.push({ x: q.x, y: q.y, angle: h, side, text: TEXTS[k % TEXTS.length] });
    }

    return { grandstands, trees, billboards, slowCorners, buildings, posts, floodlights, boards, landmark };
}
