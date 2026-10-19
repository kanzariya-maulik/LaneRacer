// The real F1 car models (scripts/cars, public/models): which models, their licences, and the built files
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEAMS = require('../public/teams.json').map((t) => t.id);
const models = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/cars/models.json'), 'utf8'));
const LICENCES = ['CC Attribution', 'CC Attribution-NonCommercial', 'CC Attribution-NonCommercial-ShareAlike'];

test('models.json covers every team, allowed licences, no rips', () => {
    const M = models(), all = [...Object.values(M.cars), M.tyre, M.helmet];
    assert.deepStrictEqual(Object.keys(M.cars).sort(), [...TEAMS].sort());
    for (const m of all) {
        assert.match(m.uid, /^[0-9a-f]{32}$/, m.name);
        assert.ok(LICENCES.includes(m.licence), `${m.name}: ${m.licence}`);
        assert.ok(!/^unpacked/i.test(m.name), `${m.name}: a ripped game file`);
        for (const k of ['name', 'author', 'url']) assert.ok(m[k], `${m.name}: ${k}`);
    }
    assert.strictEqual(M.cars['redbull-suzuka'].uid, M.cars.redbull.uid);
    assert.strictEqual(M.cars['redbull-suzuka'].repaint?.to, 'RB-suzuka');
    assert.strictEqual(M.cars.williams.repaint?.to, 'FW45-2023');
    assert.strictEqual(M.cars.haas.repaint?.to, 'VF23-2023');
});

// A built car (scripts/cars/build.py): markers, budgets, real proportions in the game's car frame. glTF is y up:
// glTF (x, y, z) = car frame (x forward, z up, -y left) → car (x, -z, y)
const { readGlb } = require('../scripts/cars/glb.cjs');
const WHEEL_NAMES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
function checkCar(team) {
    const file = path.join(ROOT, 'public/models/cars', `${team}.glb`);
    assert.ok(fs.existsSync(file), `${team}.glb missing`);
    const G = readGlb(file), car = (name) => { const t = G.nodes.get(name).translation; return [t[0], -t[2], t[1]]; };
    for (const n of ['lod_near', 'lod_far', ...WHEEL_NAMES, 'eye', 'wheel_pos', 'head']) assert.ok(G.nodes.has(n), `${team}: node ${n}`);
    assert.ok(G.triangles('lod_near') <= 60000, `${team}: near ${G.triangles('lod_near')} triangles`);
    assert.ok(G.triangles('lod_far') <= 10000, `${team}: far ${G.triangles('lod_far')} triangles`);
    const [FL, FR, RL, RR] = WHEEL_NAMES.map(car);
    const base = (FL[0] + FR[0]) / 2 - (RL[0] + RR[0]) / 2, track = Math.abs(FL[1] - FR[1]);
    assert.ok(base >= 3.3 && base <= 3.75, `${team}: wheelbase ${base.toFixed(2)} m`);
    assert.ok(track >= 1.4 && track <= 1.75, `${team}: track ${track.toFixed(2)} m`);
    for (const w of WHEEL_NAMES) {
        const r = G.nodes.get(w).extras.radius;
        assert.ok(r > 0.3 && r < 0.4, `${team}: ${w} radius ${r}`);
        assert.ok(Math.abs(car(w)[2] - r) < 0.02, `${team}: ${w} centre ${car(w)[2].toFixed(3)} m high, radius ${r}`);
    }
    const b = G.bounds('lod_near'), len = b.max[0] - b.min[0];
    assert.ok(len >= 4.9 && len <= 5.8, `${team}: ${len.toFixed(2)} m long`);
    const eye = car('eye');
    assert.ok(eye[0] < FL[0] && eye[2] > 0.7 && Math.abs(eye[1]) < 0.1, `${team}: eye at ${eye.map((v) => v.toFixed(2))}`);
    assert.ok(G.bytes <= 8e6, `${team}: ${(G.bytes / 1e6).toFixed(1)} MB`);
}

test('the Mercedes W14: markers, budgets and real proportions', () => checkCar('mercedes'));

test('tyres: Soft, Medium and Hard tyres and a rim, light, at the game\'s wheel radius, unit width on the axle', () => {
    const G = readGlb(path.join(ROOT, 'public/models/tyre.glb'));
    for (const n of ['tyre_S', 'tyre_M', 'tyre_H']) {
        assert.ok(G.nodes.has(n), n);
        assert.ok(G.triangles(n) <= 3000, `${n}: ${G.triangles(n)} triangles`);
        const b = G.bounds(n), r = (b.max[1] - b.min[1]) / 2, w = b.max[2] - b.min[2];
        assert.ok(Math.abs(r - 0.36) <= 0.01, `${n}: radius ${r.toFixed(3)}`);
        assert.ok(Math.abs(w - 1) <= 0.05, `${n}: width ${w.toFixed(2)} (unit, along the axle: three.js z)`);
    }
    assert.ok(G.nodes.has('rim') && G.triangles('rim') <= 1500, `rim: ${G.triangles('rim')} triangles`);
});

test('helmet: paint the game tints, a visor, shoulders; light and helmet-sized', () => {
    const G = readGlb(path.join(ROOT, 'public/models/helmet.glb')), mats = (G.json.materials || []).map((m) => m.name);
    for (const m of ['helmet_paint', 'visor', 'suit']) assert.ok(mats.includes(m), `material ${m}`);
    assert.ok(G.nodes.has('helmet') && G.triangles('helmet') <= 4000, `helmet: ${G.triangles('helmet')} triangles`);
    assert.ok(G.nodes.has('shoulders') && G.triangles('shoulders') <= 800, `shoulders: ${G.triangles('shoulders')} triangles`);
    const b = G.bounds('helmet'), h = b.max[1] - b.min[1];
    assert.ok(h >= 0.26 && h <= 0.32, `helmet ${h.toFixed(2)} m tall`);
});
