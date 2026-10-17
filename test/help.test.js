// Driver help: a driver who holds the throttle everywhere gets round every corner on High (and is saved by Low, slower);
// a driver at the limit with no help is faster than both
const { test } = require('node:test');
const assert = require('node:assert');
const { driveLap } = require('./helpers/lineBot');

for (const id of ['monza', 'monaco', 'spa']) {
    test(`${id}: High help laps no faster than the real limit and at most 6 % slower, and stays on the road`, () => {
        const limit = driveLap(id, '100,0', { driver: 'limit' }), high = driveLap(id, '100,100', { driver: 'flat' });
        const r = high.time / limit.time;
        assert.ok(high.finished, 'High finished');
        assert.strictEqual(high.off, 0, `High left the road for ${high.off} ticks`);
        assert.strictEqual(high.walls, 0, 'High hit a wall');
        // r >= 1 is the fairness floor (help never beats a good driver): fix the help if it fails, do not loosen it
        assert.ok(r >= 1, `fairness floor: High ${high.time.toFixed(2)} s faster than limit ${limit.time.toFixed(2)} s — do not loosen`);
        assert.ok(r <= 1.06, `High ${high.time.toFixed(2)} s vs limit ${limit.time.toFixed(2)} s (${((r - 1) * 100).toFixed(1)} %)`);
    });

    test(`${id}: Low help saves a driver who never brakes, and costs more time than High`, () => {
        const low = driveLap(id, '100,50', { driver: 'flat' }), high = driveLap(id, '100,100', { driver: 'flat' });
        assert.ok(low.finished, 'Low finished');
        assert.strictEqual(low.off, 0, `Low left the road for ${low.off} ticks`);
        assert.strictEqual(low.walls, 0, 'Low hit a wall');
        assert.ok(low.time > high.time, `Low ${low.time.toFixed(2)} s not slower than High ${high.time.toFixed(2)} s`);
    });
}

test('High help still makes every corner 1 m either side of the racing line (Spa) and on worn tyres (Monaco)', () => {
    for (const offsetM of [-1, 1]) { // half a car off the line: at real width, 2 m is over the kerb
        const r = driveLap('spa', '100,100', { driver: 'flat', offsetM });
        assert.ok(r.finished && r.off === 0 && r.walls === 0, `${offsetM} m off the line: off ${r.off}, walls ${r.walls}`);
    }
    const w = driveLap('monaco', '100,100', { driver: 'flat', worn: true });
    assert.ok(w.finished && w.off === 0 && w.walls === 0, `worn tyres: off ${w.off}, walls ${w.walls}`);
});
