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

test('snapLight: the shadow camera lands on the light-space texel grid for an oblique sun', () => {
    const off = { x: 600, y: 1800, z: 400 }, step = 720 / 2048;
    // three.js lookAt basis for a camera at target+off looking at target, up (0,1,0)
    const n = Math.hypot(off.x, off.y, off.z), z = { x: off.x / n, y: off.y / n, z: off.z / n };
    const xl = Math.hypot(z.z, z.x), x = { x: z.z / xl, y: 0, z: -z.x / xl };
    const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    for (const p of [{ x: 0, y: 0, z: 0 }, { x: 123.4, y: 0, z: -987.6 }, { x: 5012.3, y: 3, z: 77.7 }]) {
        const s = Q.snapLight(p, off, step);
        for (const axis of [x, y]) {
            const u = dot(s, axis) / step;
            assert.ok(Math.abs(u - Math.round(u)) < 1e-6, `off-grid by ${(u - Math.round(u)).toFixed(3)} texel`);
        }
        assert.ok(Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) < step * 2, 'stays next to the car');
    }
});
