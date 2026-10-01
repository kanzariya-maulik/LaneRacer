const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const TEAMS = require('../public/teams.json');

function readGlbJson(file) {
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.toString('ascii', 0, 4), 'glTF');
    const len = buf.readUInt32LE(12);
    assert.strictEqual(buf.toString('ascii', 16, 20), 'JSON');
    return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

test('car.glb has body, four wheels, livery UVs and no vertex colours', () => {
    const gltf = readGlbJson(path.join(PUB, 'models', 'car.glb'));
    const nodeNames = gltf.nodes.map(n => n.name);
    for (const n of ['body', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) assert.ok(nodeNames.includes(n), `missing node ${n}`);
    const matNames = gltf.materials.map(m => m.name);
    for (const m of ['livery', 'tyre', 'rim']) assert.ok(matNames.includes(m), `missing material ${m}`);
    const body = gltf.meshes[gltf.nodes.find(n => n.name === 'body').mesh];
    for (const prim of body.primitives) {
        assert.ok('TEXCOORD_0' in prim.attributes, 'body needs UVs');
        assert.ok(!('COLOR_0' in prim.attributes), 'part-id colours must not ship (three would tint the car)');
    }
});


function pngSize(file) {
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.toString('ascii', 1, 4), 'PNG');
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('every team has a 1024² livery and a 320×120 thumbnail', () => {
    for (const t of TEAMS) {
        assert.deepStrictEqual(pngSize(path.join(PUB, 'liveries', `${t.id}.png`)), [1024, 1024], t.id);
        assert.deepStrictEqual(pngSize(path.join(PUB, 'liveries', `${t.id}-thumb.png`)), [320, 120], t.id);
    }
});

function glb() { return readGlbJson(path.join(PUB, 'models', 'car.glb')); }
const tris = (g, mesh) => g.meshes[mesh].primitives.reduce((s, p) => s + g.accessors[p.indices].count / 3, 0);

test('car body: at most 8000 triangles and inside the old size box (glTF is Y-up: z → -Y)', () => {
    const g = glb(), body = g.nodes.find(n => n.name === 'body');
    assert.ok(tris(g, body.mesh) <= 8000, `${tris(g, body.mesh)} triangles`);
    assert.strictEqual(g.meshes[body.mesh].primitives.length, 1, 'body must stay one draw call per car (one material)');
    for (const p of g.meshes[body.mesh].primitives) {
        const { min, max } = g.accessors[p.attributes.POSITION];
        assert.ok(min[0] >= -2.95 && max[0] <= 2.95, 'length');
        assert.ok(min[1] >= 0 && max[1] <= 1.05, 'height');
        assert.ok(min[2] >= -1.0 && max[2] <= 1.0, 'width');
    }
});

test('wheels: same pivots and radius, tyre then rim, round 32-sided tyres with a shoulder', () => {
    const g = glb();
    const want = { wheel_FL: [1.6, 0.36, -0.8], wheel_FR: [1.6, 0.36, 0.8], wheel_RL: [-1.85, 0.36, -0.78], wheel_RR: [-1.85, 0.36, 0.78] };
    for (const [name, pos] of Object.entries(want)) {
        const n = g.nodes.find(x => x.name === name);
        n.translation.forEach((v, i) => assert.ok(Math.abs(v - pos[i]) < 1e-3, `${name} pivot moved`));
        const [tyre, rim] = g.meshes[n.mesh].primitives;
        assert.deepStrictEqual([g.materials[tyre.material].name, g.materials[rim.material].name], ['tyre', 'rim'], 'game batches tyre then rim');
        assert.ok(Math.abs(g.accessors[tyre.attributes.POSITION].max[1] - 0.36) < 2e-3, 'radius 0.36');
        assert.ok(g.accessors[tyre.indices].count / 3 >= 400, 'old 24-sided tyre is gone');
    }
});
