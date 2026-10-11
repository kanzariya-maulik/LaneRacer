const test = require('node:test');
const assert = require('node:assert');
const Q = require('../src/game/QualiSession');
const Track = require('../src/game/Track');

test('knockout: a quarter of the field, at least one', () => {
    assert.deepStrictEqual([2, 4, 5, 6, 8, 10, 20].map(Q.knockoutCount), [1, 1, 1, 1, 2, 2, 5]);
});

test('full needs 4 drivers', () => {
    assert.strictEqual(Q.effectiveFormat('full', 3), 'short');
    assert.strictEqual(Q.effectiveFormat('full', 4), 'full');
    assert.strictEqual(Q.effectiveFormat('oneshot', 2), 'oneshot');
});

test('segment clocks from the reference lap, rounded to 30 s, at least 2 min', () => {
    assert.deepStrictEqual(Q.segmentPlan('full', 98), [480, 390, 330]);
    assert.deepStrictEqual(Q.segmentPlan('short', 98), [600]);
    assert.deepStrictEqual(Q.segmentPlan('full', 20), [120, 120, 120]);
    assert.deepStrictEqual(Q.segmentPlan('oneshot', 98), [Infinity]);
    assert.deepStrictEqual(Q.segmentPlan('full', 98, 0.1), [48, 39, 33]);
});

test('ranking: time, then earlier time, then no time by join order', () => {
    const r = Q.rankSegment([
        { id: 'a', time: 81.2, at: 50, joinOrder: 1 }, { id: 'b', time: 80.9, at: 90, joinOrder: 2 },
        { id: 'c', time: 81.2, at: 40, joinOrder: 3 }, { id: 'd', time: null, at: null, joinOrder: 0 }, { id: 'e', time: null, at: null, joinOrder: 4 }]);
    assert.deepStrictEqual(r.map((e) => e.id), ['b', 'c', 'a', 'd', 'e']);
});

test('grid: Q3 order, then Q2 knock-outs, then Q1 knock-outs', () => {
    const e = (id, time) => ({ id, time, at: time, joinOrder: 0 });
    const segs = [
        { ranked: [e('a', 80), e('b', 81), e('c', 82), e('d', 83), e('f', 90), e('g', null)], out: ['f', 'g'] },
        { ranked: [e('b', 79), e('a', 79.5), e('c', 80), e('d', 81)], out: ['d'] },
        { ranked: [e('c', 78), e('a', 78.5), e('b', 79)], out: [] },
    ];
    assert.deepStrictEqual(Q.gridOrder(segs), ['c', 'a', 'b', 'd', 'f', 'g']);
});

test('racing line has a lap time on every circuit', () => {
    for (const id of Track.TRACK_IDS) { const t = Track.load(id); assert.ok(t.racingLine.lapS > 30 && t.racingLine.lapS < 200, `${id} ${t.racingLine.lapS}`); }
});
