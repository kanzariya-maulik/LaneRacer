const { test } = require('node:test');
const assert = require('node:assert');
const Ticker = require('../src/ticker');

test('ticker: exactly one step per 16.667 ms on an uneven poll schedule, catch-up capped at 4, resync after a stall', () => {
    let now = 0, runs = 0;
    const t = new Ticker(1000 / 60, () => runs++, () => now, 4);
    t.next = 0;
    for (now = 0; now <= 10000; now += 1 + (Math.floor(now) % 3)) t.poll();   // polls every 1–3 ms
    assert.strictEqual(runs, Math.floor(10000 / (1000 / 60)) + 1);
    runs = 0; now += 1000; t.poll();                                         // 1 s stall
    assert.strictEqual(runs, 4, 'no burst bigger than 4');
    runs = 0; now += 1000 / 60; t.poll();
    assert.strictEqual(runs, 1, 'back to one per step, not catching up the whole second');
});
