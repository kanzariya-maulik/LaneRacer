// The track's drawn surfaces (public/js/trackMesh.js): one seamless mesh per layer, no slivers, folds or gaps
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');

let M;
before(async () => { M = await import('../public/js/trackMesh.js'); });
const tracks = Track.loadAll();
const geo = {};
const build = (id) => (geo[id] ||= M.buildTrackGeometry(tracks[id]));

// Each triangle: area (m²) and whether it faces up
function* triangles(g, sc) {
    const P = g.position, I = g.index;
    for (let k = 0; k < I.length; k += 3) {
        const [a, b, c] = [I[k], I[k + 1], I[k + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        yield { area: Math.hypot(...n) / 2 / (sc * sc), up: n[1] };
    }
}
const vert = (g, i) => [g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]];

for (const id of Track.TRACK_IDS) {
    test(`${id}: every drawn layer is solid: no sliver or upside-down triangle`, () => {
        const G = build(id), sc = tracks[id].scale;
        const layers = { road: G.road, lineR: G.lines.R, lineL: G.lines.L, vergeR: G.verge.R, vergeL: G.verge.L, lane: G.pit.lane, apron: G.pit.apron, ...Object.fromEntries(G.kerbs.map((k, i) => [`kerb${i}`, k])) };
        for (const [name, g] of Object.entries(layers)) for (const tr of triangles(g, sc)) {
            assert.ok(tr.area >= 1e-4, `${name}: sliver ${tr.area} m²`);
            assert.ok(tr.up > 0, `${name}: triangle facing down`);
        }
    });

    test(`${id}: the road's edges are the lines' and kerbs' edges, vertex for vertex`, () => {
        const G = build(id);
        for (const k of G.road.edgeRows) { // { k, right, left }: road vertex indices at cross-section k
            const r = vert(G.road, k.right), l = vert(G.road, k.left);
            assert.deepStrictEqual(vert(G.lines.R, G.lines.R.outer[k.k]), r);
            assert.deepStrictEqual(vert(G.lines.L, G.lines.L.outer[k.k]), l);
        }
        for (const kb of G.kerbs) for (const [k, i] of Object.entries(kb.inner)) {
            const road = G.road.edgeRows[k];
            assert.deepStrictEqual(vert(kb, i), vert(G.road, kb.side > 0 ? road.right : road.left), `kerb at ${k}`);
        }
    });

    test(`${id}: no road edge folds back on the inside of a corner`, () => {
        const G = build(id);
        for (const side of ['right', 'left']) {
            const E = G.road.edgeRows.map((r) => vert(G.road, r[side])), C = G.road.centre, n = E.length;
            for (let k = 0; k < n; k++) {
                const e = [E[(k + 1) % n][0] - E[k][0], E[(k + 1) % n][2] - E[k][2]], c = [C[(k + 1) % n].x - C[k].x, C[(k + 1) % n].y - C[k].y];
                assert.ok(e[0] * c[0] + e[1] * c[1] > 0, `${side} edge runs backwards at ${k}`);
            }
        }
    });

    test(`${id}: kerb stripes are 1 m along the kerb`, () => {
        const G = build(id), sc = tracks[id].scale;
        for (const kb of G.kerbs) for (let q = 1; q < kb.outerRun.length; q++) { // outer vertex indices along the kerb, in order
            const a = vert(kb, kb.outerRun[q - 1]), b = vert(kb, kb.outerRun[q]);
            const dv = kb.uv[kb.outerRun[q] * 2 + 1] - kb.uv[kb.outerRun[q - 1] * 2 + 1];
            assert.ok(Math.abs(dv - Math.hypot(b[0] - a[0], b[2] - a[2]) / sc) < 1e-3, 'stripe coordinate in metres along the kerb');
        }
    });

    test(`${id}: the pit apron meets the road edge and runs under the lane: no grass between them`, () => {
        const G = build(id), t = tracks[id], sc = t.scale, A = G.pit.apron;
        if (!A.index.length) return;
        // on the drawn road's edge (the smooth curve's, which the physics polyline's edge differs from by centimetres)
        const edges = ['right', 'left'].map((side) => G.road.edgeRows.map((r) => vert(G.road, r[side])));
        const offEdge = (p) => Math.min(...edges.map((E) => Math.min(...E.map((a, k) => {
            const b = E[(k + 1) % E.length], ex = b[0] - a[0], ez = b[2] - a[2], u = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[2] - a[2]) * ez) / (ex * ex + ez * ez || 1)));
            return Math.hypot(p[0] - a[0] - u * ex, p[2] - a[2] - u * ez);
        }))));
        for (const i of A.trackSide) {
            const d = offEdge(vert(A, i));
            assert.ok(d < 0.01 * sc, `apron ${(d / sc).toFixed(3)} m off the road edge`);
        }
        for (const i of A.laneSide) { // under the lane's asphalt
            const p = vert(A, i), n = require('../src/game/Physics').nearestOnPath(p[0], p[2], t.pit.path, false);
            assert.ok(n.dist <= (t.pit.widthAt[n.i] + (t.pit.widthAt[Math.min(n.i + 1, t.pit.widthAt.length - 1)] - t.pit.widthAt[n.i]) * n.t) / 2 + 0.001 * sc, 'apron edge outside the lane');
        }
    });

    test(`${id}: the pit wall is a closed box facing outwards, 0.6 m thick and 1 m tall`, () => {
        const G = build(id), t = tracks[id], sc = t.scale, W = t.pit.wall, g = G.pit.wall, P = g.position, I = g.index;
        let vol = 0, len = 0;
        // the box's top vertices: odd ring entries (trackMesh.js: per wall point [left bottom, left top, right bottom, right top])
        const tops = new Set(); for (let i = 1; i < P.length / 3; i += 2) tops.add(i);
        for (let k = 1; k < W.length; k++) len += Math.hypot(W[k].x - W[k - 1].x, W[k].y - W[k - 1].y) / sc;
        for (let k = 0; k < I.length; k += 3) {
            const [a, b, c] = [I[k], I[k + 1], I[k + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]].map((v) => v / sc));
            const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])];
            const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            // a top face (all its vertices top ones) faces up; the bottom faces down
            const top = [I[k], I[k + 1], I[k + 2]].every((i) => tops.has(i));
            if (Math.abs(up) > Math.hypot(n[0], (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))) assert.ok(top ? up > 0 : up < 0, `${top ? 'top' : 'bottom'} face facing the wrong way`);
            vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        }
        // outward faces: positive volume, about its length x 0.6 m x 1 m (closed: any hole or flipped face shows here)
        assert.ok(Math.abs(vol / (len * 0.6) - 1) < 0.1, `volume ${vol.toFixed(1)} m³ for ${len.toFixed(0)} m of wall`);
    });
}

// Monza's pit mouths (Track.js pit.blend): the track's white line beside the lane is dashed where crossing it is legal
// (into the entry road before its gore, out of the exit road past its solid line), solid elsewhere
test('monza: the line beside each pit mouth is dashed where the lane blends in, solid elsewhere', () => {
    const t = tracks.monza, G = build('monza'), blend = t.pit.blend;
    assert.strictEqual(blend.length, 2);
    for (const q of blend) {
        const g = G.lines[q.side], n = G.lap.length, I = g.index, quads = new Set();
        for (let k = 0; k < I.length; k += 3) for (const [u, v] of [[I[k], I[k + 1]], [I[k + 1], I[k + 2]], [I[k + 2], I[k]]]) quads.add(`${Math.min(u, v)},${Math.max(u, v)}`);
        const drawn = { has: (k) => quads.has(`${Math.min(g.outer[k], g.outer[(k + 1) % n])},${Math.max(g.outer[k], g.outer[(k + 1) % n])}`) }; // the quad from k to k+1
        const inside = (m) => (q.fromM <= q.toM ? m >= q.fromM && m < q.toM : m >= q.fromM || m < q.toM);
        const ks = G.lap.map((m, k) => k).filter((k) => inside(G.lap[k]));
        assert.ok(ks.length > 5, `${q.fromM}..${q.toM}: a stretch`);
        const gaps = ks.filter((k) => !drawn.has(k)).length;
        assert.ok(gaps > ks.length / 4 && gaps < (3 * ks.length) / 4, `dashed: ${gaps} gaps of ${ks.length}`);
        for (const k of [(ks[0] - 8 + n) % n, (ks.at(-1) + 8) % n]) assert.ok(drawn.has(k), `solid around it at ${G.lap[k].toFixed(0)} m`);
    }
});

// A kerb is its full width from its first row to its last: untangle took the zero-width quad just outside a kerb for a
// fold and shrank the first and last rows to nothing (every kerb ~6 m short at each end, physics counting it there)
for (const id of Track.TRACK_IDS) test(`${id}: every kerb full width end to end`, () => {
    const G = build(id), sc = tracks[id].scale, bad = [];
    G.kerbs.forEach((kb, n) => {
        const P = kb.position, w = [];
        for (let i = 0; i + 5 < P.length; i += 6) w.push(Math.hypot(P[i + 3] - P[i], P[i + 5] - P[i + 2]) / sc); // a row: inner, outer
        const max = Math.max(...w), ok = (x) => x >= max / 2, lead = w.findIndex(ok), trail = [...w].reverse().findIndex(ok);
        if (lead + trail > 2) bad.push(`kerb ${n}: ${lead} + ${trail} end rows under half width`); // (a fold mid-bend may narrow it)
    });
    assert.deepStrictEqual(bad, []);
});

// The white line is drawn where the track limits are judged: the road is drawn on a smooth curve through the centreline
// points, the limits on the straight segments between them, and the two parted (COTA: 1.26 m, others 0.25-0.75 m)
for (const id of Track.TRACK_IDS) test(`${id}: the drawn edge lies on the judged edge`, () => {
    const t = tracks[id], G = build(id), sc = t.scale, Physics = require('../src/game/Physics'), C = G.road.centre, K = C.length / t.path.length, m = t.path.length;
    let worst = 0, at = null;
    for (const row of G.road.edgeRows) for (const [idx, E, side] of [[row.left, G.road.eL, t.edgeL], [row.right, G.road.eR, t.edgeR]]) {
        const v = vert(G.road, idx), c = C[row.k], e = E[row.k], d = Math.hypot(v[0] - c.x, v[2] - c.y);
        if (d < e - 0.05 * sc) continue; // inside a bend tighter than the offset: the inside clamp (the road can't reach it unfolded)
        // on the judged edge: inside it 0.15 m in, outside it 0.15 m out (where it jumps between two segments' widths, that's
        // the switch), judged on its own road (Suzuka's bridge)
        const cl = (o) => {
            const f = (d + o) / d, x = c.x + (v[0] - c.x) * f, y = c.y + (v[2] - c.y) * f, n = Physics.nearestOnTrack(x, y, t, Math.floor(row.k / K));
            return n.dist - (side[n.i] + (side[(n.i + 1) % m] - side[n.i]) * n.t);
        };
        const bad = Math.max(cl(-0.15 * sc), -cl(0.15 * sc));
        if (bad > 0 && bad / sc > worst) { worst = bad / sc; at = row.k; }
    }
    assert.ok(worst === 0, `${worst.toFixed(2)} m off the judged edge at curve point ${at}`);
});
