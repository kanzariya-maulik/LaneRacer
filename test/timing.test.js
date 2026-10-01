const { test, before } = require('node:test');
const assert = require('node:assert');

let T;
before(async () => { T = await import('../public/js/timing.js'); });
const row = (gap, lapsDown = 0) => ({ gap, lapsDown });

test('leader mode: gap to the leader, lapped cars in laps', () => {
    const rows = [row(null), row(1.2), row(3.87), row(null, 1), row(null, 2)];
    assert.deepStrictEqual(rows.map((_, i) => T.gapText(rows, i, 'leader')), [null, '+1.200', '+3.870', '+1 LAP', '+2 LAPS']);
});

test('interval mode: gap to the car directly ahead', () => {
    const rows = [row(null), row(1.2), row(3.87), row(null, 1), row(null, 1), row(null, 3)];
    assert.deepStrictEqual(rows.map((_, i) => T.gapText(rows, i, 'interval')), [null, '+1.200', '+2.670', '+1 LAP', '', '+2 LAPS']);
});

test('interval mode: unknown gap ahead or behind shows nothing, never negative', () => {
    const rows = [row(null), row(null), row(2.5), row(2.4)];
    assert.deepStrictEqual(rows.map((_, i) => T.gapText(rows, i, 'interval')), [null, '', '', '+0.000']);
});

test('driver code: three letters, upper case', () => {
    assert.strictEqual(T.driverCode('Max'), 'MAX');
    assert.strictEqual(T.driverCode('lewis_44'), 'LEW');
    assert.strictEqual(T.driverCode('Bot12'), 'BOT');
    assert.strictEqual(T.driverCode('42'), '42');
});

test('lap delta: last lap against best', () => {
    assert.strictEqual(T.lapDelta(null, 90), null);
    assert.deepStrictEqual(T.lapDelta(90, 90), { text: 'PB', cls: 't-green' });
    assert.deepStrictEqual(T.lapDelta(90.38, 90), { text: '+0.380', cls: 't-yellow' });
});

test('stepFollow: spectating follows a driver, not a position, and steps through the order', () => {
    assert.strictEqual(T.stepFollow(['a', 'b', 'c'], null, 0), 'a', 'starts on the leader');
    assert.strictEqual(T.stepFollow(['b', 'a', 'c'], 'a', 0), 'a', 'same driver after an overtake');
    assert.strictEqual(T.stepFollow(['b', 'a', 'c'], 'a', 1), 'c');
    assert.strictEqual(T.stepFollow(['b', 'a', 'c'], 'b', -1), 'c', 'wraps');
    assert.strictEqual(T.stepFollow(['b', 'c'], 'a', 0), 'b', 'followed driver left: back to the leader');
    assert.strictEqual(T.stepFollow([], 'a', 0), null);
});

test('inDrsZone: zones by lap distance, including one that wraps past the start line', () => {
    const zones = [{ startS: 100, endS: 300 }, { startS: 900, endS: 50 }];
    assert.strictEqual(T.inDrsZone(zones, 150), true);
    assert.strictEqual(T.inDrsZone(zones, 500), false);
    assert.strictEqual(T.inDrsZone(zones, 950), true);
    assert.strictEqual(T.inDrsZone(zones, 20), true, 'wrapped zone');
});

test('drsHint explains why DRS is off', () => {
    const base = { mode: 'race', inPit: false, drs: false, drsAvailable: false, lap: 2, inZone: false };
    assert.strictEqual(T.drsHint({ ...base, inPit: true }), 'PIT LANE');
    assert.strictEqual(T.drsHint({ ...base, drs: true }), 'OPEN');
    assert.strictEqual(T.drsHint({ ...base, drsAvailable: true }), 'PRESS E / Y');
    assert.strictEqual(T.drsHint({ ...base, lap: 0 }), 'FROM LAP 2');
    assert.strictEqual(T.drsHint({ ...base, inZone: true }), 'NEED < 1.0 s');
    assert.strictEqual(T.drsHint(base), 'IN DRS ZONES');
    assert.strictEqual(T.drsHint({ ...base, mode: 'quali', lap: 0 }), 'IN DRS ZONES', 'quali: no lap or gap rule');
});
