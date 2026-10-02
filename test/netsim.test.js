const { test } = require('node:test');
const assert = require('node:assert');
const { parseNetSim, planDelivery } = require('../src/netsim');

test('NET_SIM parses latency,jitter,loss and plans delays inside latency ± jitter, dropping about loss %', () => {
    assert.deepStrictEqual(parseNetSim('30,20,2'), { latency: 30, jitter: 20, loss: 2 });
    assert.strictEqual(parseNetSim(''), null);
    let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sim = parseNetSim('30,20,2'); let dropped = 0;
    for (let i = 0; i < 10000; i++) {
        const d = planDelivery(sim, rand);
        if (d === null) { dropped++; continue; }
        assert.ok(d >= 10 && d <= 50, `${d}`);
    }
    assert.ok(dropped > 120 && dropped < 290, `${dropped} drops`);
});
