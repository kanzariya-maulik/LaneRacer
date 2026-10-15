const { test, before } = require('node:test');
const assert = require('node:assert');

let Q;
before(async () => { Q = await import('../public/js/quality.js'); });

test('presets follow the spec table', () => {
    assert.deepStrictEqual(Object.keys(Q.LEVELS), ['low', 'medium', 'high', 'ultra']);
    assert.deepStrictEqual(Q.ORDER, ['low', 'medium', 'high', 'ultra']);
    for (const [name, L] of Object.entries(Q.LEVELS)) {
        for (const k of ['scale', 'dpr', 'effects', 'shadows', 'cascades', 'scenery', 'far', 'fog', 'envMap', 'tyreMarks', 'anisotropy']) assert.ok(k in L, `${name}.${k}`);
        const [s, lo, hi] = L.scale;
        assert.ok(lo <= s && s <= hi && hi <= 1 && lo > 0, `${name} scale`);
        assert.strictEqual(L.effects.includes('taau') + L.effects.includes('traa') + L.effects.includes('smaa') + L.effects.includes('fxaa'), 1, `${name}: one anti-aliasing`);
    }
    assert.deepStrictEqual([Q.LEVELS.low.shadows, Q.LEVELS.medium.shadows, Q.LEVELS.high.shadows, Q.LEVELS.ultra.shadows], [0, 1024, 2048, 4096]);
    assert.deepStrictEqual([Q.LEVELS.low.cascades, Q.LEVELS.medium.cascades, Q.LEVELS.high.cascades, Q.LEVELS.ultra.cascades], [0, 2, 3, 4]);
    assert.deepStrictEqual(Q.LEVELS.low.effects, ['fxaa', 'fsr1']);
    assert.deepStrictEqual(Q.LEVELS.ultra.scale, [1, 1, 1], 'ultra renders at full scale');
    assert.ok(Q.LEVELS.ultra.effects.includes('ssr') && !Q.LEVELS.high.effects.includes('ssr'));
    assert.deepStrictEqual([Q.LEVELS.low.scenery, Q.LEVELS.medium.scenery, Q.LEVELS.high.scenery, Q.LEVELS.ultra.scenery], [0.3, 0.6, 1, 1]);
});

test('scaleRange and pixelRatio: internal scale per level, device pixels capped per level', () => {
    assert.deepStrictEqual(Q.scaleRange('low'), { start: 0.75, min: 0.5, max: 1 });
    assert.deepStrictEqual(Q.scaleRange('high'), { start: 1, min: 0.75, max: 1 });
    assert.strictEqual(Q.pixelRatio('low', 2), 1);
    assert.strictEqual(Q.pixelRatio('high', 3), 2);
    assert.strictEqual(Q.pixelRatio('high', 1), 1);
});

test('resolveLevel: manual wins, auto uses the measurement, else Medium (Low on WebGL2)', () => {
    assert.strictEqual(Q.resolveLevel('low', 'high'), 'low');
    assert.strictEqual(Q.resolveLevel('ultra', null, 'webgl2'), 'ultra', 'a manual choice is never lowered');
    assert.strictEqual(Q.resolveLevel('auto', 'high'), 'high');
    assert.strictEqual(Q.resolveLevel('auto', 'high', 'webgl2'), 'high', 'a real measurement is kept');
    assert.strictEqual(Q.resolveLevel('auto', null), 'medium');
    assert.strictEqual(Q.resolveLevel('auto', null, 'webgl2'), 'low');
    assert.strictEqual(Q.resolveLevel('garbage', 'nope'), 'medium');
});

test('stepDown: one level lower, Low stays Low', () => {
    assert.deepStrictEqual(Q.ORDER.map(Q.stepDown), ['low', 'low', 'medium', 'high']);
});

test('autoPick: slow → Low, fast → High, very fast on High → Ultra, Ultra kept unless slow', () => {
    assert.strictEqual(Q.autoPick(25, 'medium', 1), 'low');
    assert.strictEqual(Q.autoPick(10, 'medium', 1), 'high');
    assert.strictEqual(Q.autoPick(6, 'medium', 1), 'high', 'Ultra only from a measurement taken on High');
    assert.strictEqual(Q.autoPick(16, 'medium', 1), 'medium');
    assert.strictEqual(Q.autoPick(6, 'high', 1), 'ultra');
    assert.strictEqual(Q.autoPick(9, 'high', 1), 'high');
    assert.strictEqual(Q.autoPick(10, 'ultra', 1), 'ultra');
    assert.strictEqual(Q.autoPick(25, 'ultra', 1), 'low');
});

test('shouldMeasure: auto with nothing stored, or a stored High that may be Ultra; never a manual choice', () => {
    assert.strictEqual(Q.shouldMeasure('auto', null), true);
    assert.strictEqual(Q.shouldMeasure('auto', 'high'), true);
    assert.strictEqual(Q.shouldMeasure('auto', 'medium'), false);
    assert.strictEqual(Q.shouldMeasure('auto', 'ultra'), false);
    assert.strictEqual(Q.shouldMeasure('high', null), false);
});

test('depthBias: decals pulled toward the camera with either depth direction', () => {
    assert.strictEqual(Q.depthBias(-4, false), -4);
    assert.strictEqual(Q.depthBias(-4, true), 4);
    assert.strictEqual(Q.depthBias(0, true), 0);
});

const run = (st, seq) => seq.reduce((x, f) => Q.adaptStep(x, f), st);

test('adaptStep: GPU-bound at 30 fps (vsync) probes the minimum, keeps it if it helps, climbs back under a ceiling', () => {
    let st = { ratio: 2, min: 0.75, max: 2, good: 0 };
    st = Q.adaptStep(st, 30);
    assert.strictEqual(st.ratio, 2, 'one slow second (a hitch) is ignored');
    st = Q.adaptStep(st, 30);
    assert.strictEqual(st.ratio, 0.75, 'one big probe, not 0.1 steps');
    st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.75, 'it helped: kept');
    assert.ok(!st.noDrop);
    st = run(st, new Array(9).fill(60));
    assert.strictEqual(st.ratio, 0.8, 'climbs after 10 good seconds');
    st = run(st, new Array(200).fill(60));
    assert.strictEqual(st.ratio, 1.95, 'never back to the ratio that was too slow');
});

test('adaptStep: a frame cap (no gain at the minimum) restores the ratio and stops lowering', () => {
    let st = { ratio: 2, min: 0.75, max: 2, good: 0 };
    st = run(st, [30, 30, 30]);
    assert.strictEqual(st.ratio, 2);
    assert.strictEqual(st.noDrop, true);
    st = run(st, new Array(20).fill(30));
    assert.strictEqual(st.ratio, 2, 'capped frame rate never sinks the resolution');
});

test('adaptStep: when the ceiling ratio is too slow again, it probes again with a lower ceiling', () => {
    let st = run({ ratio: 1, min: 0.6, max: 1, good: 0 }, [40, 40, 60]);
    assert.strictEqual(st.ratio, 0.6);
    st = run(st, new Array(10).fill(60));        // 0.65
    st = run(st, [45, 45, 60]);                   // too slow at 0.65 → min, ceiling 0.6
    assert.strictEqual(st.ratio, 0.6);
    st = run(st, new Array(50).fill(60));
    assert.strictEqual(st.ratio, 0.6, 'stays under the new ceiling');
});

test('adaptStep: 50–58 fps holds, never above max, never below min', () => {
    assert.strictEqual(Q.adaptStep({ ratio: 0.8, min: 0.6, max: 1, good: 2 }, 55).good, 0);
    assert.strictEqual(Q.adaptStep({ ratio: 1, min: 0.6, max: 1, good: 5 }, 60).ratio, 1);
    assert.strictEqual(run({ ratio: 0.6, min: 0.6, max: 1, good: 0 }, [30, 30]).ratio, 0.6);
    assert.strictEqual(run({ ratio: 1, min: 0.6, max: 1, good: 0 }, [30, 60, 30, 60]).ratio, 1, 'isolated hitches never probe');
});

test('frameCapped: a steady 30 fps (Energy Saver) is detected, real slowness is not', () => {
    assert.strictEqual(Q.frameCapped([30, 30, 29.8, 30.1, 30, 30]), true);
    assert.strictEqual(Q.frameCapped([30, 30, 30]), false, 'needs 6 seconds');
    assert.strictEqual(Q.frameCapped([24, 31, 27, 35, 29, 33]), false, 'jittery = GPU load, not a cap');
    assert.strictEqual(Q.frameCapped([60, 60, 60, 60, 60, 60]), false);
});
