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
