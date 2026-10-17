// A circuit as built: surface polygons, kerbs, barriers, features (data/tracks/<id>.build.json, metres in the TUMFTM
// frame: x east, y north). Circuits without researched data get defaultBuild: today's barrier rule as polylines, so all
// of them drive and draw the same way until their real data lands.

const WALL_OFFSET_M = 80 / 6;  // today's barrier: this far past the track edge
const KERB_TURN = 0.05;        // rad per path segment: tighter corners get kerbs (game3d.js today)
const PIT_RUNOFF_M = 2;        // drive.js: the pit lane's barrier this far outside its edge

const heading = (P, i) => { const n = P.length, a = P[(i - 1 + n) % n], b = P[(i + 1) % n]; return Math.atan2(b.y - a.y, b.x - a.x); };

// Lap distance of point i in metres past the start line
const lapM = (t, i) => { const total = t.cum[t.path.length]; return ((((t.cum[i] - t.startS) % total) + total) % total) / t.scale; };
const toM = (t, p) => [+(p.x / t.scale).toFixed(2), +(-p.y / t.scale).toFixed(2)]; // world → TUMFTM metres

// Runs of kept items round a loop (a run that wraps the end carries on from the start)
function runs(E, keep) {
    const n = E.length, start = keep.findIndex((k, i) => k && !keep[(i - 1 + n) % n]);
    if (start < 0) return keep[0] ? [E] : [];
    const out = [];
    let run = [];
    for (let k = 0; k <= n; k++) {
        const i = (start + k) % n;
        if (k < n && keep[i]) run.push(E[i]);
        else { if (run.length) out.push(run); run = []; }
    }
    return out;
}

// The area cars may use today: within the barrier distance (the real edge on that side + 13.3 m) of the track, or of
// the pit lane (its half width + 2 m). Signed distance on a 1 m grid of points: < 0 inside. Two legs closer than two
// barrier distances share one area (no island of barrier between them, as Track.js openWalls did)
function reachField(t) {
    const P = t.path, n = P.length, sc = t.scale, cell = 1 * sc, maxLim = (Math.max(...t.edgeR, ...t.edgeL) / sc + WALL_OFFSET_M + 2) * sc;
    const xs = P.map((p) => p.x), ys = P.map((p) => p.y), x0 = Math.min(...xs) - maxLim - 2 * cell, y0 = Math.min(...ys) - maxLim - 2 * cell;
    const w = Math.ceil((Math.max(...xs) + maxLim + 2 * cell - x0) / cell) + 1, h = Math.ceil((Math.max(...ys) + maxLim + 2 * cell - y0) / cell) + 1;
    const f = new Float32Array(w * h).fill(Infinity);
    // a capsule round segment a-b: lim(u) on the side the point lies, from the edges at both ends
    const capsule = (a, b, limL, limR) => {
        const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey || 1, R = Math.max(limL[0], limL[1], limR[0], limR[1]);
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R - x0) / cell)), i1 = Math.min(w - 1, Math.ceil((Math.max(a.x, b.x) + R - x0) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - R - y0) / cell)), j1 = Math.min(h - 1, Math.ceil((Math.max(a.y, b.y) + R - y0) / cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const x = x0 + i * cell, y = y0 + j * cell, u = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2));
            const right = -ey * (x - a.x) + ex * (y - a.y) > 0, L = right ? limR : limL; // +lateral = driver's right (y down)
            const v = Math.hypot(x - a.x - u * ex, y - a.y - u * ey) - (L[0] + (L[1] - L[0]) * u);
            if (v < f[j * w + i]) f[j * w + i] = v;
        }
    };
    const lim = (e) => e + WALL_OFFSET_M * sc;
    for (let i = 0; i < n; i++) { const k = (i + 1) % n; capsule(P[i], P[k], [lim(t.edgeL[i]), lim(t.edgeL[k])], [lim(t.edgeR[i]), lim(t.edgeR[k])]); }
    if (t.pit) { const Q = t.pit.path, r = t.pit.width / 2 + PIT_RUNOFF_M * sc; for (let i = 0; i + 1 < Q.length; i++) capsule(Q[i], Q[i + 1], [r, r], [r, r]); }
    return { f, w, h, x0, y0, cell };
}

// Marching squares: the f = 0 outline as closed polylines (world units), chained through the grid edges they cross
function outline({ f, w, h, x0, y0, cell }) {
    const cross = (i, j, horiz) => { // where f crosses 0 on the grid edge from (i, j) right (horiz) or down
        const a = f[j * w + i], b = horiz ? f[j * w + i + 1] : f[(j + 1) * w + i], u = a / (a - b);
        return horiz ? { x: x0 + (i + u) * cell, y: y0 + j * cell } : { x: x0 + i * cell, y: y0 + (j + u) * cell };
    };
    const next = new Map(), pt = new Map();
    const link = (e1, e2) => { next.set(e1, e2); for (const e of [e1, e2]) if (!pt.has(e)) pt.set(e, cross(...e.split(',').map(Number).slice(0, 2), e.endsWith(',h'))); };
    const E = (i, j, horiz) => `${i},${j},${horiz ? 'h' : 'v'}`;
    for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
        const a = f[j * w + i] < 0, b = f[j * w + i + 1] < 0, c = f[(j + 1) * w + i + 1] < 0, d = f[(j + 1) * w + i] < 0;
        const top = E(i, j, true), right = E(i + 1, j, false), bottom = E(i, j + 1, true), left = E(i, j, false);
        // inside kept on the left of each piece's direction, so every loop runs the same way round
        const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
        const centre = (f[j * w + i] + f[j * w + i + 1] + f[(j + 1) * w + i + 1] + f[(j + 1) * w + i]) / 4 < 0;
        switch (code) {
            case 1: link(left, bottom); break; case 2: link(bottom, right); break; case 3: link(left, right); break;
            case 4: link(right, top); break; case 6: link(bottom, top); break; case 7: link(left, top); break;
            case 8: link(top, left); break; case 9: link(top, bottom); break; case 11: link(top, right); break;
            case 12: link(right, left); break; case 13: link(right, bottom); break; case 14: link(bottom, left); break;
            case 5: if (centre) { link(left, top); link(right, bottom); } else { link(left, bottom); link(right, top); } break;
            case 10: if (centre) { link(top, right); link(bottom, left); } else { link(top, left); link(bottom, right); } break;
        }
    }
    const loops = [], seen = new Set();
    for (const s0 of next.keys()) {
        if (seen.has(s0)) continue;
        const loop = [];
        for (let e = s0; e !== undefined && !seen.has(e); e = next.get(e)) { seen.add(e); loop.push(pt.get(e)); }
        if (loop.length > 2) loops.push([...loop, loop[0]]);
    }
    return loops;
}

// Douglas-Peucker: drop points within tol of the line through their neighbours
function simplify(P, tol) {
    if (P.length < 3) return P;
    const A0 = P[0], Z = P[P.length - 1];
    if (A0.x === Z.x && A0.y === Z.y) { // a closed loop: its ends coincide, so split it at the point farthest from them
        let m = 1;
        for (let i = 1; i < P.length - 1; i++) if (Math.hypot(P[i].x - A0.x, P[i].y - A0.y) > Math.hypot(P[m].x - A0.x, P[m].y - A0.y)) m = i;
        return [...simplify(P.slice(0, m + 1), tol), ...simplify(P.slice(m), tol).slice(1)];
    }
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const stack = [[0, P.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop(), A = P[a], Bp = P[b], ex = Bp.x - A.x, ey = Bp.y - A.y, l = Math.hypot(ex, ey) || 1;
        let best = -1, bd = tol;
        for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i].x - A.x) * ey - (P[i].y - A.y) * ex) / l; if (d > bd) { bd = d; best = i; } }
        if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return P.filter((_, i) => keep[i]);
}

export function defaultBuild(t) {
    const P = t.path, n = P.length, sc = t.scale;
    const barriers = outline(reachField(t)).map((loop) => ({ kind: 'concrete', h: 1, fence: 3, pts: simplify(loop, 0.1 * sc).map((p) => toM(t, p)), src: 'generated' }));
    // Kerbs where the corner is tight (± 2 points so they don't flicker on and off), both sides, flat red/white
    const turn = P.map((_, i) => { let d = heading(P, (i + 1) % n) - heading(P, i); d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) > KERB_TURN; });
    const curvy = turn.map((_, i) => [-2, -1, 0, 1, 2].some((d) => turn[(i + d + n) % n]));
    const kerbs = [];
    for (const r of runs(P.map((_, i) => i), curvy)) for (const s of ['R', 'L'])
        kerbs.push({ side: s, fromM: +lapM(t, r[0]).toFixed(1), toM: +lapM(t, (r.at(-1) + 1) % n).toFixed(1), style: 'flat', colors: ['red', 'white'], w: 1.5, src: 'generated' });
    return { id: t.id, asphalt: { tone: 0.6, resurfaced: null, patches: [] }, surfaces: [], kerbs, barriers, features: [], sources: ['generated: today\'s barrier rule (real edge + 13.3 m), as the outline of the area it allows'], unconfirmed: ['all'] };
}

// Metres (TUMFTM, y north) → world units (y down the screen), every [x, y] as { x, y }
export function toWorld(b, scale) {
    const pt = ([x, y]) => ({ x: x * scale, y: -y * scale });
    return {
        ...b,
        asphalt: { ...b.asphalt, patches: (b.asphalt?.patches || []).map((p) => ({ ...p, poly: p.poly.map(pt) })) },
        surfaces: b.surfaces.map((s) => ({ ...s, poly: s.poly.map(pt) })),
        barriers: b.barriers.map((w) => ({ ...w, pts: w.pts.map(pt) })),
        features: b.features.map((f) => ({ ...f, ...(f.pts ? { pts: f.pts.map(pt) } : {}), ...(f.at ? { at: pt(f.at) } : {}) })),
    };
}
