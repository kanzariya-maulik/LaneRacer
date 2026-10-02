const { test, before } = require('node:test');
const assert = require('node:assert');

let Vo, M;
before(async () => { Vo = await import('../public/js/audio/voices.js'); M = await import('../public/js/audio/mix.js'); });
const car = (id, x) => ({ id, x, y: 0 });

test('pickVoices: the n nearest within range, nearest first; cars that left are dropped', () => {
    const cars = [car('a', 50), car('b', 10), car('c', 400), car('d', 30), car('e', 20), car('f', 60)];
    assert.deepStrictEqual(Vo.pickVoices(cars, 0, 0, [], 4, 300), ['b', 'e', 'd', 'a']);
    assert.deepStrictEqual(Vo.pickVoices(cars.filter((c) => c.id !== 'e'), 0, 0, ['b', 'e', 'd', 'a'], 4, 300), ['b', 'd', 'a', 'f']);
});

test('pickVoices: hysteresis keeps a current voice unless a newcomer is more than 10% closer', () => {
    const cars = [car('a', 10), car('b', 20), car('c', 30), car('d', 40), car('e', 38)];
    assert.ok(Vo.pickVoices(cars, 0, 0, ['a', 'b', 'c', 'd'], 4, 300).includes('d'), 'e is only 5% closer: d keeps its voice');
    cars[4].x = 30;
    assert.ok(Vo.pickVoices(cars, 0, 0, ['a', 'b', 'c', 'd'], 4, 300).includes('e'), 'e 25% closer: takes the voice');
});

test('doppler: approaching raises pitch, receding lowers it, clamped 0.8–1.25', () => {
    assert.strictEqual(M.doppler(0), 1);
    assert.ok(Math.abs(M.doppler(-40) - 343 / 303) < 1e-9, 'approaching at 40 m/s');
    assert.ok(M.doppler(80) < 1 && M.doppler(80) > 0.8);
    assert.strictEqual(M.doppler(-300), 1.25);
    assert.strictEqual(M.doppler(1000), 0.8);
});

test('pickLoops: two nearest recordings with equal-power weights; ends clamp', () => {
    const loops = [{ rpm: 6000 }, { rpm: 10000 }, { rpm: 14000 }, { rpm: 18000 }];
    assert.deepStrictEqual(M.pickLoops(loops, 4000), { a: 0, b: 0, wa: 1, wb: 0 });
    assert.deepStrictEqual(M.pickLoops(loops, 19000), { a: 3, b: 3, wa: 1, wb: 0 });
    const m = M.pickLoops(loops, 12000);
    assert.deepStrictEqual([m.a, m.b], [1, 2]);
    assert.ok(Math.abs(m.wa * m.wa + m.wb * m.wb - 1) < 1e-9 && Math.abs(m.wa - m.wb) < 1e-9);
    assert.strictEqual(M.pickLoops([], 9000), null);
});

test('estimateLoad: accelerating → on throttle, braking → off, steady → holds; eased', () => {
    let l = 0;
    for (let k = 0; k < 60; k++) l = M.estimateLoad(l, 8, 1 / 60);
    assert.ok(l > 0.95);
    for (let k = 0; k < 60; k++) l = M.estimateLoad(l, 0, 1 / 60);
    assert.ok(l > 0.95, 'steady speed keeps the last state');
    for (let k = 0; k < 60; k++) l = M.estimateLoad(l, -20, 1 / 60);
    assert.ok(l < 0.05);
    assert.ok(Number.isFinite(M.estimateLoad(0.5, NaN, 1 / 60)));
});

test('estimateLoad: near top speed small acceleration still reads as on throttle (drag eats most of the power)', () => {
    let l = 0;
    for (let k = 0; k < 60; k++) l = M.estimateLoad(l, 0.8, 1 / 60, 88);
    assert.ok(l > 0.95, `load ${l.toFixed(2)} at 88 m/s, +0.8 m/s²`);
    l = 0;
    for (let k = 0; k < 60; k++) l = M.estimateLoad(l, 0.8, 1 / 60, 20);
    assert.ok(l < 0.05, 'slow and barely accelerating: unchanged');
});

test('engineFx: pit-limiter stutter only on throttle; rev-limiter stutter; crackle only off-throttle above 8k', () => {
    assert.deepStrictEqual(M.engineFx(4500, 0, true, false), { stutter: 0, crackle: 0 }, 'parked in the pit lane: idle, no stutter');
    assert.strictEqual(M.engineFx(9000, 0.8, true, false).stutter, 12);
    assert.strictEqual(M.engineFx(18000, 1, false, true).stutter, 30);
    assert.strictEqual(M.engineFx(15000, 1, false, false).crackle, 0);
    assert.ok(M.engineFx(16000, 0, false, false).crackle > 0.5);
    assert.strictEqual(M.engineFx(6000, 0, false, false).crackle, 0);
});
