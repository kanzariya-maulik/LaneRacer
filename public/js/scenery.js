// Deterministic trackside scenery from the circuit's own shape. Pure, shared by game3d.js and the node tests.
export const WALL_OFFSET = 80;          // world units past the track edge (public/js/sim/drive.js)
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

export const safeDist = (t) => t.width / 2 + WALL_OFFSET + 3 * t.scale;

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

// How far the verge may reach from the centreline at each point on one side (dir 1 / -1), up to the barrier: stops where
// another part of the track is nearer (inside of a hairpin, Suzuka's bridge), so it never lies over other asphalt, and
// short of a road at another height by room for a grass bank (BANK) so neither road floats over a cliff
export function vergeReach(t, dir) {
    const P = t.path, half = t.width / 2, max = half + WALL_OFFSET;
    const step = 2 * t.scale, n = P.length;
    const r = P.map((p, i) => {
        const h = heading(P, i), at = (o) => {
            const q = offset(p, h, dir * o);
            if (nearestSeg(t, q.x, q.y).d < o * 0.95) return false;
            if (!t.z) return true;
            const other = otherRoad(t, q.x, q.y, i); // both roads stop short, leaving the bank between their verges
            return other.d - o >= BANK * Math.abs(t.z[i] - other.h) * t.scale;
        };
        // the whole width out to o, not just its edge: at a crossing the other road cuts through the middle
        const clear = (o) => { for (let m = half + step; m < o; m += step) if (!at(m)) return false; return at(o); };
        if (clear(max)) return max;
        let lo = half, hi = max;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (clear(m)) lo = m; else hi = m; }
        return lo;
    });
    // A quad joins neighbouring points: one short point between long ones would still leave a quad slanting across
    return r.map((_, i) => Math.min(r[(i - 2 + n) % n], r[(i - 1 + n) % n], r[i], r[(i + 1) % n], r[(i + 2) % n]));
}

// Ground height (m) at (x, y): a road's own height out to its verge edge, then a straight grass bank across to the next
// road's verge edge (two roads at different heights: no cliff, no floating road). reach: { 1: vergeReach(t, 1),
// [-1]: vergeReach(t, -1) }
export function terrainGround(t, reach) {
    const P = t.path, n = P.length;
    const lerp = (a, j, k) => a[j] + (a[(j + 1) % n] - a[j]) * k;
    const side = (j, x, y) => { const h = heading(P, j), d = { x: x - P[j].x, y: y - P[j].y }; return -Math.sin(h) * d.x + Math.cos(h) * d.y > 0 ? 1 : -1; };
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

// Terrain height grid (m) over a rectangle, (segs + 1)² vertices, row-major from (x0, y0): ground(x, y) minus `sink`
// (ground: the nearest road's height, so it sits just under each road's verge and two roads at different heights get a
// bank between them), then pressed down under every road's asphalt and kerbs (`reach` from the centreline) so no
// triangle of it covers a road, the lower one at a bridge included
export function terrainHeights(t, x0, y0, w, h, segs, ground, sink, reach) {
    const N = segs + 1, H = new Float64Array(N * N), cw = w / segs, ch = h / segs, P = t.path, n = P.length;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) H[iy * N + ix] = ground(x0 + ix * cw, y0 + iy * ch) - sink;
    if (!t.z) return H;
    // Road points every 2 m over the asphalt and kerbs: the triangle under each (three.js PlaneGeometry: cell corners
    // a (0,0), b (0,1), c (1,1), d (1,0), split along b-d) must stay `sink` below it. Where it doesn't, lower that
    // triangle's corners by their share of the excess (least change), so corners away from the road barely move: a
    // whole-cell minimum would drag down the ground beside a neighbouring road at another height
    const step = 2 * t.scale, pts = [];
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        for (let s = 0; s <= len; s += step) for (let l = -reach; l <= reach; l += step) {
            const f = s / len, x = a.x + (b.x - a.x) * f + nx * l, y = a.y + (b.y - a.y) * f + ny * l;
            const u = (x - x0) / cw, v = (y - y0) / ch, ix = Math.floor(u), iy = Math.floor(v);
            if (ix < 0 || iy < 0 || ix >= segs || iy >= segs) continue;
            const fu = u - ix, fv = v - iy, A = iy * N + ix, B = (iy + 1) * N + ix, Cc = (iy + 1) * N + ix + 1, D = iy * N + ix + 1;
            const tri = fu + fv <= 1 ? [[A, 1 - fu - fv], [D, fu], [B, fv]] : [[Cc, fu + fv - 1], [B, 1 - fu], [D, 1 - fv]];
            pts.push({ tri, w2: tri.reduce((sum, [, w]) => sum + w * w, 0), target: t.z[i] + (t.z[(i + 1) % n] - t.z[i]) * f - sink });
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

export function placeScenery(t, density, seed) {
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

    // Trees: beyond the barrier, denser further out
    const trees = [];
    const want = Math.round(n * 0.6 * density);
    for (let k = 0; k < want * 3 && trees.length < want; k++) {
        const i = Math.floor(rand() * n), side = rand() < 0.5 ? -1 : 1;
        const q = offset(P[i], heading(P, i), side * (clear + (15 + 105 * Math.sqrt(rand())) * sc));
        if (ok(q.x, q.y)) trees.push({ x: q.x, y: q.y, size: rand() < 0.7 ? 1 : 2 });
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

    return { grandstands, trees, billboards, slowCorners };
}
