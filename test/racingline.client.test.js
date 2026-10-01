const { test, before } = require('node:test');
const assert = require('node:assert');

let R;
before(async () => { R = await import('../public/js/racingline.js'); });
const ring = (n, step = 10) => { const cum = []; for (let i = 0; i <= n; i++) cum.push(i * step); return cum; };

test('segmentColor: base colours far ahead or without a car', () => {
    assert.strictEqual(R.segmentColor(0, 80, 80, null), 'green');
    assert.strictEqual(R.segmentColor(1, 60, 80, null), 'yellow');
    assert.strictEqual(R.segmentColor(2, 30, 80, 400), 'red');
});

test('segmentColor: too fast turns red earlier, slow is green', () => {
    // 80 m/s toward a 30 m/s corner: 200 m out needs 13.75 m/s² (> 0.6·1.6·9.81 ≈ 9.42) → red
    assert.strictEqual(R.segmentColor(2, 30, 80, 200), 'red');
    // the same corner 240 m out at 60 m/s needs 5.6 m/s² → yellow
    assert.strictEqual(R.segmentColor(2, 30, 60, 240), 'yellow');
    // already slower than the target → green, even in a brake zone
    assert.strictEqual(R.segmentColor(2, 30, 25, 50), 'green');
});

test('aheadM wraps across the start line', () => {
    const cum = ring(100); // 1000 m lap
    assert.strictEqual(R.aheadM(cum, 98, 3, 1), 50);
    assert.strictEqual(R.aheadM(cum, 3, 98, 1), 950);
});

test('cornerMask covers 30 m before and 50 m after a lift/brake run, also across index 0', () => {
    const n = 100, cum = ring(n), phase = new Array(n).fill(0);
    phase[0] = 2; phase[1] = 1;  // corner straddling the start line
    phase[50] = 2;
    const m = R.cornerMask(phase, cum, 1);
    for (const i of [97, 98, 99, 0, 1, 2, 6]) assert.ok(m[i], `point ${i} should show`);
    assert.ok(!m[96] && !m[7], 'beyond 30 m before / 50 m after');
    assert.ok(m[47] && m[55] && !m[46] && !m[56]);
    assert.ok(!m[25], 'straight stays hidden');
});

test('trackIndex stays on its own leg where the track crosses itself', () => {
    // figure-8 at 2 m spacing: leg 1 and leg 3 both pass (50, 0)
    const path = [];
    for (let i = 0; i <= 50; i++) path.push({ x: i * 2, y: 0 });             // 0..50, (50,0) is index 25
    for (let i = 1; i <= 50; i++) path.push({ x: 100, y: i * 2 });           // 51..100
    for (let i = 1; i <= 100; i++) path.push({ x: 100 - i, y: 100 - 2 * i }); // 101..200, (50,0) is index 150
    for (let i = 1; i <= 49; i++) path.push({ x: 0, y: -100 + i * 2 });      // 201..249, back toward the start
    assert.strictEqual(R.trackIndex(path, 50.5, 0, 24), 25, 'kept on the first leg');
    assert.strictEqual(R.trackIndex(path, 50.5, 0, 148), 150, 'kept on the second leg');
    assert.strictEqual(R.trackIndex(path, 100.5, 0.2, null), 50, 'full search without history');
});

test('nextMode cycles off → corners → full → off', () => {
    assert.strictEqual(R.nextMode('off'), 'corners');
    assert.strictEqual(R.nextMode('corners'), 'full');
    assert.strictEqual(R.nextMode('full'), 'off');
});

test('trackIndex recovers from a stale index far from the car', () => {
    const path = [];
    for (let i = 0; i < 200; i++) path.push({ x: Math.cos(i / 200 * 2 * Math.PI) * 1000, y: Math.sin(i / 200 * 2 * Math.PI) * 1000 });
    assert.strictEqual(R.trackIndex(path, path[120].x, path[120].y, 10, 50), 120, 'full search when the window is far off');
    assert.strictEqual(R.trackIndex(path, path[12].x, path[12].y, 10, 50), 12);
});
