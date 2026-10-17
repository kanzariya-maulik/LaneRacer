const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'textures');
const BUDGET = 40 * 1024 * 1024;

test('every texture is CC0, sized in metres, and present at every resolution', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
    const names = Object.keys(manifest);
    for (const n of ['asphalt', 'asphalt_patch', 'asphalt_pit', 'kerb_paint', 'grass', 'grass_worn', 'gravel', 'concrete', 'fence', 'sand']) assert.ok(names.includes(n), `missing ${n}`);
    for (const [name, t] of Object.entries(manifest)) {
        assert.strictEqual(t.licence, 'CC0', name);
        assert.ok(t.src && t.url, `${name}: source`);
        assert.ok(Array.isArray(t.sizeM) && t.sizeM.length === 2 && t.sizeM.every((v) => v > 0), `${name}: sizeM`);
        assert.ok(t.res.includes(512) && t.res.includes(1024) && t.res.every((r) => [512, 1024, 2048].includes(r)), `${name}: res`);
        for (const [map, file] of Object.entries(t.maps)) for (const r of t.res) {
            const f = path.join(DIR, file.replace('{res}', r));
            assert.ok(fs.existsSync(f), `${name} ${map} ${r}: ${f}`);
        }
    }
});

test('textures fit the 40 MB budget', () => {
    const total = fs.readdirSync(DIR).reduce((s, f) => s + fs.statSync(path.join(DIR, f)).size, 0);
    assert.ok(total <= BUDGET, `${(total / 1048576).toFixed(1)} MB`);
});
