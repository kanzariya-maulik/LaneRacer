const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

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

const TEAMS = require('../public/teams.json');

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
