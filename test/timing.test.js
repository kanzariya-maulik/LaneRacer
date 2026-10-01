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
