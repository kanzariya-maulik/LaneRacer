const { test, before } = require('node:test');
const assert = require('node:assert');

let Q;
before(async () => { Q = await import('../public/js/quality.js'); });

test('presets follow the spec table', () => {
    assert.deepStrictEqual(Object.keys(Q.LEVELS), ['low', 'medium', 'high']);
    assert.strictEqual(Q.LEVELS.low.shadows, 0);
    assert.strictEqual(Q.LEVELS.medium.shadows, 1024);
    assert.strictEqual(Q.LEVELS.high.antialias, true);
    assert.deepStrictEqual([Q.LEVELS.low.scenery, Q.LEVELS.medium.scenery, Q.LEVELS.high.scenery], [0.3, 0.6, 1]);
});

test('ratioRange caps High at the screen and at 2', () => {
    assert.deepStrictEqual(Q.ratioRange('low', 2), { start: 0.75, min: 0.5, max: 1 });
    assert.deepStrictEqual(Q.ratioRange('high', 1), { start: 1, min: 0.75, max: 1 });
    assert.deepStrictEqual(Q.ratioRange('high', 3), { start: 2, min: 0.75, max: 2 });
});

test('resolveLevel: manual choice wins, auto uses the measured level, else Medium', () => {
    assert.strictEqual(Q.resolveLevel('low', 'high'), 'low');
    assert.strictEqual(Q.resolveLevel('auto', 'high'), 'high');
    assert.strictEqual(Q.resolveLevel('auto', null), 'medium');
    assert.strictEqual(Q.resolveLevel('garbage', 'nope'), 'medium');
});

test('autoPick: slow → Low, fast → High, otherwise unchanged', () => {
    assert.strictEqual(Q.autoPick(25, 'medium', 1), 'low');
    assert.strictEqual(Q.autoPick(10, 'medium', 1), 'high');
    assert.strictEqual(Q.autoPick(16, 'medium', 1), 'medium');
});

test('adaptStep: drops fast, recovers only after good seconds (10 after a drop, then 3), stays in range', () => {
    let st = { ratio: 1, min: 0.6, max: 1, good: 0 };
    st = Q.adaptStep(st, 10);
    assert.strictEqual(st.ratio, 0.9);
    for (let i = 1; i <= 10; i++) st = Q.adaptStep(st, 10 + i * 3); // each drop helps a little, still slow
    assert.strictEqual(st.ratio, 0.6);
    st = Q.adaptStep(st, 50); // leaves the probe state
    for (let i = 0; i < 9; i++) st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.6, 'not after 9 s');
    st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.65);
    st = Q.adaptStep(st, 60); st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.65, 'next step not after 2 s');
    st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.7);
    st = { ratio: 1, min: 0.6, max: 1, good: 5 };
    assert.strictEqual(Q.adaptStep(st, 60).ratio, 1, 'never above max');
    assert.strictEqual(Q.adaptStep({ ratio: 0.8, min: 0.6, max: 1, good: 2 }, 55).good, 0, '50–58 fps resets the streak');
});

test('adaptStep: after a drop, raising again needs a longer good streak (no flip-flop)', () => {
    let st = { ratio: 1, min: 0.6, max: 1, good: 0 };
    st = Q.adaptStep(st, 60); st = Q.adaptStep(st, 60); st = Q.adaptStep(st, 40); // 0.9, just dropped
    for (let i = 0; i < 5; i++) st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.9, 'raised again within 5 s of a drop');
    for (let i = 0; i < 5; i++) st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.95, 'recovers after 10 good seconds');
});

test('adaptStep: when a drop does not raise fps (frame cap), it undoes the drop and stops lowering', () => {
    let st = { ratio: 2, min: 0.75, max: 2, good: 0 };
    st = Q.adaptStep(st, 30);
    assert.strictEqual(st.ratio, 1.9, 'first drop is tried');
    st = Q.adaptStep(st, 30);
    assert.strictEqual(st.ratio, 2, 'no gain: back to where it was');
    for (let i = 0; i < 20; i++) st = Q.adaptStep(st, 30);
    assert.strictEqual(st.ratio, 2, 'capped frame rate never sinks the resolution');
});

test('adaptStep: a drop that helps is kept and the next one is tried', () => {
    let st = { ratio: 1, min: 0.6, max: 1, good: 0 };
    st = Q.adaptStep(st, 40);   // 0.9
    st = Q.adaptStep(st, 46);   // helped by 6 fps, still slow → 0.8
    assert.strictEqual(st.ratio, 0.8);
});

test('snapToTexel: shadow camera moves in whole shadow-map texels (no shimmer)', () => {
    const step = 720 / 2048;
    for (const v of [0, 12.34, -987.6, 5000.01]) {
        const s = Q.snapToTexel(v, 720, 2048);
        assert.ok(Math.abs(s / step - Math.round(s / step)) < 1e-6, `${v} → ${s} not on the grid`);
        assert.ok(Math.abs(s - v) <= step / 2 + 1e-9);
    }
});

test('frameCapped: a steady 30 fps (Energy Saver) is detected, real slowness is not', () => {
    assert.strictEqual(Q.frameCapped([30, 30, 29.8, 30.1, 30, 30]), true);
    assert.strictEqual(Q.frameCapped([30, 30, 30]), false, 'needs 6 seconds');
    assert.strictEqual(Q.frameCapped([24, 31, 27, 35, 29, 33]), false, 'jittery = GPU load, not a cap');
    assert.strictEqual(Q.frameCapped([60, 60, 60, 60, 60, 60]), false);
});
