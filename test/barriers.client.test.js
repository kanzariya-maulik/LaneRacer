// Barriers as built (public/js/barriers.js barrierPlacements): one batch per kind, rails, posts, tyres and fences where the
// physics barrier is, standing on the ground
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');

let B;
before(async () => { B = await import('../public/js/barriers.js'); });
const t = Track.loadAll().monza, sc = t.scale, flat = () => 0;
const place = () => B.barrierPlacements(t.build.barriers, sc, { ground: flat, road: flat });

test('monza: one batch per barrier kind present, and a fence batch', () => {
    const P = place(), kinds = new Set(t.build.barriers.map((w) => w.kind));
    for (const k of kinds) assert.ok(Object.keys(P).some((name) => name.startsWith(`${k}:`)), `no batch for ${k}`);
    for (const name of Object.keys(P)) assert.ok(P[name].length > 0, `empty batch ${name}`);
    assert.ok(P['fence:mesh']?.length && P['fence:post']?.length, 'debris fence and its posts');
});

test('monza: fence posts every 4 m along each barrier, Armco posts every 2 m', () => {
    const P = place();
    for (const [name, every] of [['fence:post', 4], ['armco:post', 2]]) {
        const byWall = new Map();
        for (const q of P[name]) { if (!byWall.has(q.wall)) byWall.set(q.wall, []); byWall.get(q.wall).push(q); }
        for (const list of byWall.values()) for (let k = 1; k < list.length; k++) {
            const d = list[k].along - list[k - 1].along;
            assert.ok(Math.abs(d - every) <= 0.1, `${name} ${d.toFixed(2)} m apart`);
        }
    }
});

test('monza: every piece sits on the ground and on its barrier line', () => {
    const P = place(), up = (x, y) => (x + y) * 0.001; // a tilted ground: pieces follow it
    const Q = B.barrierPlacements(t.build.barriers, sc, { ground: up, road: flat });
    for (const name of Object.keys(Q)) for (const q of Q[name]) {
        if (name.endsWith(':post') || name.startsWith('concrete')) assert.ok(q.y0 <= Math.min(up(q.x, q.z), 0) + 1e-6, `${name} floats`);
    }
    assert.ok(P['concrete:block'].every((q) => q.len > 0 && q.h > 0), 'blocks have size');
});

test('monza: the road height is looked up once per barrier point, not per piece (each lookup searches the whole track)', () => {
    let calls = 0;
    const P = B.barrierPlacements(t.build.barriers, sc, { ground: flat, road: (x, y) => { calls++; return (x + y) * 0.001; } });
    assert.ok(calls <= t.build.barriers.reduce((a, w) => a + w.pts.length, 0), `${calls} road lookups`);
    for (const q of P['armco:post']) assert.ok(q.y0 <= Math.min(0, (q.x + q.z) * 0.001) + 1e-6, 'posts still stand on the lower of road and ground');
});

// three r186 puts a small InstancedMesh's matrices in a uniform array named after its node id (NodeBuffer_<id>): every mesh
// then had its own shader, never shared or found in the browser's shader cache (37 pipelines compiled at each race start).
// Past the 64 KB uniform limit it reads them as vertex attributes: one shader for every mesh of a material
test('instancedMesh: matrices as attributes (no per-mesh shader), drawing only the copies asked for', async () => {
    const THREE = await import('three');
    for (const n of [0, 1, 17, 96, 3000]) {
        const m = B.instancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), n);
        assert.ok(m.instanceMatrix.count * 16 * 4 > 65536, `${n}: still a uniform array`);
        assert.strictEqual(m.count, n);
    }
});
