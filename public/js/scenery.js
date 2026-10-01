// Deterministic trackside scenery from the circuit's own shape. Pure, shared by game3d.js and the node tests.
export const WALL_OFFSET = 80;          // world units past the track edge (src/game/Game.js)
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
            if (ok(q.x, q.y)) return grandstands.push({ x: q.x, y: q.y, angle: h, len: 60 * sc });
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
