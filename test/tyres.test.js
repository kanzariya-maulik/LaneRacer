// test/tyres.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');
let T;
before(async () => { T = await import('../public/js/sim/tyres.js'); });

test('grip: soft > medium > hard when new', () => {
    assert.ok(T.gripOf('S', 0) > T.gripOf('M', 0) && T.gripOf('M', 0) > T.gripOf('H', 0));
    assert.strictEqual(T.gripOf('M', 0), 1);
});

test('grip from wear: -3 % at 0.8, -12 % at 1.0, clamped past it', () => {
    assert.ok(Math.abs(T.gripOf('M', 0.8) - 0.97) < 1e-9);
    assert.ok(Math.abs(T.gripOf('M', 1) - 0.88) < 1e-9);
    assert.strictEqual(T.gripOf('M', 1.5), T.gripOf('M', 1));
    assert.ok(T.gripOf('S', 0.9) < T.gripOf('S', 0.85)); // the cliff keeps falling
});

test('wear per metre: a set lasts its share of the race at typical load', () => {
    const lapM = 5000, laps = 10;
    for (const c of ['S', 'M', 'H']) {
        const metres = 1 / T.wearPerM(c, lapM, laps);
        assert.ok(Math.abs(metres - T.COMPOUNDS[c].life * lapM * laps) < 1e-6, c);
    }
});

test('wear load: harder driving wears faster, normalised by LOAD_TYPICAL', () => {
    assert.ok(T.wearLoad(0.9, 0, 0) > T.wearLoad(0.3, 0, 0));
    assert.ok(T.wearLoad(0.3, 1, 0) > T.wearLoad(0.3, 0, 0));
    assert.ok(T.wearLoad(0.3, 0, 0.21) > T.wearLoad(0.3, 0, 0));
    assert.ok(Math.abs(T.wearLoad(0, 0, 0) - 1 / T.LOAD_TYPICAL) < 1e-12);
});

test('next harder compound, and compound names', () => {
    assert.deepStrictEqual(['S', 'M', 'H'].map(T.nextHarder), ['M', 'H', 'M']);
    assert.ok(T.isCompound('S') && !T.isCompound('X') && !T.isCompound(undefined));
});

test('calibrated: a clean lap wears each circuit at its typical rate (±15 %)', async () => {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('node', ['scripts/calibrate-tyres.js'], { encoding: 'utf8' });
    const per = out.split('\n').filter((l) => /^\w+\s+\d/.test(l)).map((l) => +l.trim().split(/\s+/)[1]);
    assert.strictEqual(per.length, 14);
    for (const v of per) assert.ok(Math.abs(v / T.LOAD_TYPICAL - 1) < 0.15, `${v} vs ${T.LOAD_TYPICAL}`);
});
