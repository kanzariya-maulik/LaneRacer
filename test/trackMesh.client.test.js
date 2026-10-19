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
}
