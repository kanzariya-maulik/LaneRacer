// The track's drawn surfaces as plain arrays (no three.js: game3d.js makes the meshes, the node tests check them): the
// road, its white lines, kerbs and grass verges as ribbons along the smooth curve (scenery.js smoothPath), and the pit
// lane with its apron and wall. Seamless by construction: every ribbon's cross-sections come from one offset function,
// so the road's edge vertex IS the line's and the kerb's; offsets on the inside of a tight corner are held inside its
// radius, so no edge folds back; triangles too thin to see are left out instead of drawn as slivers.
// Positions are three.js (x, height, z = the game's y); world units (track.scale per metre).
import { smoothPath, vergeReach } from './scenery.js';
import { pathHeights } from './sim/elevation.js';

const LINE_M = 0.15;       // white edge line width (FIA minimum 0.10 m; unconfirmed per circuit)
const INSIDE_MAX = 0.95;   // offsets on the inside of a corner stay within this share of its radius
const MIN_AREA_M2 = 1e-4;  // triangles smaller than this are left out (a zero-width end, not a hole)
const APRON_MAX_M = 6;     // the pit apron fills gaps up to this wide between the road edge and the lane
const UNDER_LANE_M = 0.05; // ...and reaches this far under the lane's edge
const PIT_WALL_M = { thick: 0.6, tall: 1 };
// heights above the road surface (world units) each layer is drawn at, as game3d.js always did
export const LAYER_Y = { verge: 0.3, apron: 0.5, lane: 0.55, road: 0.6, kerb: 0.7, line: 0.9 };

// Arrays → a mesh description; tri(a, b, c) adds a triangle when it isn't a sliver
function mesher(sc) {
    const position = [], uv = [], track = [], index = [];
    const vertex = (x, y, z, u = 0, v = 0, lap = 0, lat = 0) => { position.push(Math.fround(x), Math.fround(y), Math.fround(z)); uv.push(u, v); track.push(lap, lat); return position.length / 3 - 1; };
    const tri = (a, b, c) => {
        const P = position, ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.hypot(nx, ny, nz) / 2 / (sc * sc) >= MIN_AREA_M2) index.push(a, b, c);
    };
    const done = (extra = {}) => ({ position: new Float32Array(position), uv: new Float32Array(uv), track: new Float32Array(track), index: new Uint32Array(index), ...extra });
    return { vertex, tri, done };
}

// Lap metres past the start line of each point of the smooth curve rp (it starts at path[0], as cum does)
function lapMetres(t, rp) {
    const n = rp.length, s = [0];
    for (let k = 1; k <= n; k++) s.push(s[k - 1] + Math.hypot(rp[k % n].x - rp[k - 1].x, rp[k % n].y - rp[k - 1].y));
    const total = t.cum[t.path.length], f = total / s[n];
    return rp.map((_, k) => ((((s[k] * f - t.startS) % total) + total) % total) / t.scale);
}

const covers = (q, side, m) => q.side === side && (q.fromM <= q.toM ? m >= q.fromM && m < q.toM : m >= q.fromM || m < q.toM);

export function buildTrackGeometry(t) {
    const sc = t.scale, { rp, up } = smoothPath(t.path, sc, t.cum), n = rp.length;
    const H = t.z ? up(t.z).map((z) => z * sc) : rp.map(() => 0);
    const eR = up(t.edgeR), eL = up(t.edgeL), vR = up(vergeReach(t, 1)), vL = up(vergeReach(t, -1)), lap = lapMetres(t, rp);
    const kerbAt = (side, k) => (t.build?.kerbs || []).find((q) => covers(q, side, lap[k])) || null;
    // tangent, normal (+ = the driver's right, offsetPoints' convention) and the inside of the bend with its radius
    const T = rp.map((_, k) => { const a = rp[(k - 1 + n) % n], b = rp[(k + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; });
    const N = T.map((d) => ({ x: -d.y, y: d.x }));
    const bend = rp.map((p, k) => {
        const a = rp[(k - 1 + n) % n], c = rp[(k + 1) % n], ab = Math.hypot(p.x - a.x, p.y - a.y), bc = Math.hypot(c.x - p.x, c.y - p.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
        const cr = (p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x);
        return { R: cr ? (ab * bc * ca) / (2 * Math.abs(cr)) : Infinity, inside: Math.sign((a.x + c.x - 2 * p.x) * N[k].x + (a.y + c.y - 2 * p.y) * N[k].y) };
    });
    const clamp = (k, o) => (Math.sign(o) === bend[k].inside ? Math.sign(o) * Math.min(Math.abs(o), INSIDE_MAX * bend[k].R) : o);
    // An offset column that still runs backwards somewhere (a wide verge on the inside of a bend whose radius changes
    // fast): pull it in toward floor (the column inside it) there until every step moves forward
    const untangle = (off, floor) => {
        off = off.slice();
        for (let pass = 0; pass < 60; pass++) {
            let bad = false;
            for (let k = 0; k < n; k++) {
                const j = (k + 1) % n, A = at(k, floor[k], 0), B = at(k, off[k], 0), C = at(j, off[j], 0), E = at(j, floor[j], 0);
                // both triangles of the quad between the columns face up (y of the cross product, as mesher draws them)
                const up = (p, q, r) => (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
                const s = Math.sign(off[k] - floor[k]) || 1, [l0, r0, l1, r1] = s > 0 ? [A, B, E, C] : [B, A, C, E];
                if (up(l0, r0, r1) > 0 && up(l0, r1, l1) > 0) continue;
                for (const q of [(k - 1 + n) % n, k, j, (j + 1) % n]) off[q] = floor[q] + (off[q] - floor[q]) * 0.7;
                bad = true;
            }
            if (!bad) break;
        }
        return off;
    };
    const at = (k, o, y) => { const c = clamp(k, o); return [rp[k].x + N[k].x * c, H[k] + y, rp[k].y + N[k].y * c, c]; };
    const world = (m, k, o, y) => { const [x, h, z, c] = at(k, o, y); return m.vertex(x, h, z, x / sc, z / sc, lap[k], c / sc); };

    // A ribbon between two offset columns (from < to), quads only where keep(k)
    const ribbon = (y, from, to, keep = () => true, extra) => {
        const m = mesher(sc), A = [], B = [];
        for (let k = 0; k < n; k++) { A.push(world(m, k, from(k), y)); B.push(world(m, k, to(k), y)); }
        for (let k = 0; k < n; k++) if (keep(k)) { const j = (k + 1) % n; m.tri(A[k], B[k], B[j]); m.tri(A[k], B[j], A[j]); }
        return { m, A, B, done: (x) => m.done({ ...x, ...extra }) };
    };

    // Road: white line to white line
    const road = ribbon(LAYER_Y.road, (k) => -eL[k], (k) => eR[k]);
    const roadMesh = road.done({ edgeRows: road.A.map((l, k) => ({ k, left: l, right: road.B[k] })), centre: rp });
    // White lines: the road's own edge vertices outward... inward (they lie on the road)
    const lineR = ribbon(LAYER_Y.road, (k) => eR[k] - LINE_M * sc, (k) => eR[k]);
    const lineL = ribbon(LAYER_Y.road, (k) => -eL[k], (k) => -eL[k] + LINE_M * sc);
    const lines = { R: lineR.done({ outer: lineR.B }), L: lineL.done({ outer: lineL.A }) };

    // Kerbs: one mesh per run of the same kerb (style, colours), from the road edge out by its width; v = metres along
    // its outer edge (the stripes: 1 m each), u = 0 at the road, 1 outside
    // the kerbs' outer edge (the white line where there's none) is the verges' inner edge
    const kerbW = (side, k) => (kerbAt(side, k)?.w || 0) * sc;
    const inR = untangle(rp.map((_, k) => eR[k] + kerbW('R', k)), eR), inL = untangle(rp.map((_, k) => -(eL[k] + kerbW('L', k))), eL.map((e) => -e));
    const kerbs = [];
    for (const [side, dir, E, O] of [['R', 1, eR, inR], ['L', -1, eL, inL]]) {
        const q = rp.map((_, k) => kerbAt(side, k));
        for (let k0 = 0; k0 < n; k0++) {
            if (!q[k0] || (q[(k0 - 1 + n) % n] === q[k0] && k0 > 0)) continue;
            const kb = q[k0], ks = [];
            for (let k = k0; ks.length < n && q[k % n] === kb; k++) ks.push(k % n);
            if (ks.length < 2) continue;
            const m = mesher(sc), inner = {}, outerRun = [];
            let v = 0, prev = null;
            const rows = ks.map((k) => {
                const o = at(k, O[k], LAYER_Y.road);
                if (prev) v += Math.hypot(o[0] - prev[0], o[2] - prev[2]) / sc;
                prev = o;
                const [ix, ih, iz, ic] = at(k, dir * E[k], LAYER_Y.road);
                const a = m.vertex(ix, ih, iz, dir > 0 ? 0 : 1, v, lap[k], ic / sc), b = m.vertex(o[0], o[1], o[2], dir > 0 ? 1 : 0, v, lap[k], o[3] / sc);
                inner[k] = a; outerRun.push(b);
                return dir > 0 ? [a, b] : [b, a]; // left to right
            });
            for (let r = 0; r + 1 < rows.length; r++) { const [a, b] = rows[r], [c, d] = rows[r + 1]; m.tri(a, b, d); m.tri(a, d, c); }
            kerbs.push(m.done({ side: dir, style: kb.style, colors: kb.colors, inner, outerRun }));
        }
    }

    // Grass verges: from the kerb's outer edge (or the white line) out to the verge's reach, at road height
    const outR = untangle(rp.map((_, k) => Math.max(vR[k], inR[k])), inR), outL = untangle(rp.map((_, k) => -Math.max(vL[k], -inL[k])), inL);
    const vergeR = ribbon(LAYER_Y.verge, (k) => inR[k], (k) => outR[k]);
    const vergeL = ribbon(LAYER_Y.verge, (k) => outL[k], (k) => inL[k]);
    const verge = { R: vergeR.done(), L: vergeL.done() };

    return { road: roadMesh, lines, kerbs, verge, pit: t.pit ? buildPitGeometry(t, rp, N, eR, eL, H, clamp) : null, rp, lap };
}

// The pit lane, its apron to the road edge, and the pit wall
function buildPitGeometry(t, rp, N, eR, eL, H, clamp) {
    const sc = t.scale, pit = t.pit, Q = pit.path, m = Q.length, Z = pathHeights(t, Q).map((z) => z * sc);
    const QN = Q.map((_, i) => { const a = Q[Math.max(0, i - 1)], b = Q[Math.min(m - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; });
    const half = pit.widthAt.map((w) => w / 2), s = pit.trackSide;
    // lane: tip to tip, its own width (0 at the mouths)
    const lane = mesher(sc), A = [], B = [];
    for (let i = 0; i < m; i++) for (const [list, o] of [[A, -half[i]], [B, half[i]]]) {
        const x = Q[i].x + QN[i].x * o, z = Q[i].y + QN[i].y * o;
        list.push(lane.vertex(x, Z[i] + LAYER_Y.lane, z, x / sc, z / sc, pit.cum[i] / sc, o / sc));
    }
    for (let i = 0; i + 1 < m; i++) { lane.tri(A[i], B[i], B[i + 1]); lane.tri(A[i], B[i + 1], A[i + 1]); }

    // apron: from the lane's track-side edge (a little under it) straight to the nearest point of the road's edge on that
    // side, wherever the gap is up to APRON_MAX_M (the mouths and a lane running right beside the track)
    const n = rp.length, edgeOf = (k, dir) => { const o = clamp(k, dir * (dir > 0 ? eR[k] : eL[k])); return { x: rp[k].x + N[k].x * o, y: rp[k].y + N[k].y * o, h: H[k] }; };
    const nearestEdge = (p) => {
        let best = null;
        for (let k = 0; k < n; k++) for (const dir of [1, -1]) {
            const a = edgeOf(k, dir), b = edgeOf((k + 1) % n, dir), ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey || 1;
            const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)), x = a.x + u * ex, y = a.y + u * ey, d = Math.hypot(p.x - x, p.y - y);
            if (!best || d < best.d) best = { d, x, y, h: a.h + (b.h - a.h) * u };
        }
        return best;
    };
    const apron = mesher(sc), trackSide = [], laneSide = [], rows = [];
    for (let i = 0; i < m; i++) {
        const o = s * Math.max(0, half[i] - UNDER_LANE_M * sc), p = { x: Q[i].x + QN[i].x * o, y: Q[i].y + QN[i].y * o }, e = nearestEdge(p);
        if (e.d > APRON_MAX_M * sc) { rows.push(null); continue; }
        const a = apron.vertex(p.x, Z[i] + LAYER_Y.apron, p.y, p.x / sc, p.y / sc), b = apron.vertex(e.x, e.h + LAYER_Y.apron, e.y, e.x / sc, e.y / sc);
        laneSide.push(a); trackSide.push(b);
        const right = (e.x - p.x) * QN[i].x + (e.y - p.y) * QN[i].y > 0;
        rows.push(right ? [a, b, 1] : [b, a, -1]); // left to right across the lane's direction
    }
    for (let i = 0; i + 1 < m; i++) if (rows[i] && rows[i + 1] && rows[i][2] === rows[i + 1][2]) { const [a, b] = rows[i], [c, d] = rows[i + 1]; apron.tri(a, b, d); apron.tri(a, d, c); }

    // pit wall: a box along its line, PIT_WALL_M thick and tall, standing on the lane's ground
    const wall = mesher(sc), W = pit.wall, wn = W.length, face = (a, b, c) => wall.tri(a, c, b); // the ring's order winds inwards
    if (wn > 1) {
        const WN = W.map((_, i) => { const a = W[Math.max(0, i - 1)], b = W[Math.min(wn - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; });
        const WZ = pathHeights(t, W).map((z) => z * sc), th = (PIT_WALL_M.thick / 2) * sc, tall = PIT_WALL_M.tall * sc;
        const ring = W.map((p, i) => [-1, 1].flatMap((d) => [0, tall].map((y) => wall.vertex(p.x + WN[i].x * d * th, WZ[i] + LAYER_Y.lane + y, p.y + WN[i].y * d * th))));
        for (let i = 0; i + 1 < wn; i++) {
            const [lb, lt, rb, rt] = ring[i], [lb2, lt2, rb2, rt2] = ring[i + 1];
            face(lb, lb2, lt2); face(lb, lt2, lt); // left face
            face(rb, rt, rt2); face(rb, rt2, rb2); // right face
            face(lt, lt2, rt2); face(lt, rt2, rt); // top
            face(lb, rb2, lb2); face(lb, rb, rb2); // bottom (closed: never seen, but a box)
        }
        for (const [i, flip] of [[0, true], [wn - 1, false]]) { const [lb, lt, rb, rt] = ring[i]; if (flip) { face(lb, lt, rt); face(lb, rt, rb); } else { face(lb, rt, lt); face(lb, rb, rt); } }
    }
    return { lane: lane.done(), apron: apron.done({ trackSide, laneSide }), wall: wall.done() };
}
