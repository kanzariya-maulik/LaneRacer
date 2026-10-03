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

test('sectorClass: decided live against the current session best: purple holder, green personal best, yellow, grey', () => {
    const best = [28, 40, 25], ids = ['a', 'b', 'a'];
    const s = (id, sector, time, personalBest = true, valid = true) => ({ id, sector, time, personalBest, valid });
    assert.strictEqual(T.sectorClass(s('a', 1, 28), best, ids), 'sec-purple', 'holder of the session best');
    assert.strictEqual(T.sectorClass(s('a', 2, 41), best, ids), 'sec-green', 'personal best, not the session best');
    assert.strictEqual(T.sectorClass(s('a', 2, 43, false), best, ids), 'sec-yellow');
    assert.strictEqual(T.sectorClass(s('a', 1, 28, true, false), best, ids), 'sec-grey', 'invalid lap');
    assert.strictEqual(T.sectorClass(s('b', 1, 28), best, ids), 'sec-green', 'same time but not the holder');
});

test('sectorClass: A\'s purple S1 turns green the moment B beats it', () => {
    const aS1 = { id: 'a', sector: 1, time: 30, personalBest: true, valid: true };
    assert.strictEqual(T.sectorClass(aS1, [30, null, null], ['a', null, null]), 'sec-purple');
    assert.strictEqual(T.sectorClass(aS1, [29.5, null, null], ['b', null, null]), 'sec-green');
});

test('liveSectors: each driver\'s current lap (times, coloured when drawn), restarting at sector 1', () => {
    const live = {};
    const sec = (id, sector, time) => T.liveSectors(live, { id, sector, time, valid: true, personalBest: true });
    sec('a', 1, 30); sec('a', 2, 40); sec('b', 1, 31);
    assert.deepStrictEqual(live.a.map((x) => x && x.time), [30, 40, null]);
    assert.deepStrictEqual(live.b.map((x) => x && x.time), [31, null, null]);
    sec('a', 3, 25); sec('a', 1, 29);
    assert.deepStrictEqual(live.a.map((x) => x && x.time), [29, null, null], 'new lap clears the old bars');
});

test('lastLapClass: your last lap is purple while it is the session fastest, green once someone beats it', () => {
    assert.strictEqual(T.lastLapClass(84, 84, 84, false), 't-purple');
    assert.strictEqual(T.lastLapClass(84, 84, 83.5, false), 't-green', 'beaten: still your personal best');
    assert.strictEqual(T.lastLapClass(86, 84, 83.5, false), '', 'slower than your best');
    assert.strictEqual(T.lastLapClass(80, 84, 83.5, true), 't-red', 'deleted lap');
    assert.strictEqual(T.lastLapClass(null, null, null, false), '');
});

test('resultCells: winner shows the final time, others the gap; penalty and places changed; DNF', () => {
    const fmt = (t) => `T${t}`;
    assert.deepStrictEqual(T.resultCells({ position: 1, total: 100, gap: null, penalty: 0, change: 0, dnf: false }, fmt),
        { time: 'T100', pen: '', change: '', changeCls: '' });
    assert.deepStrictEqual(T.resultCells({ position: 3, total: 106, gap: 6.0004, penalty: 5, change: -1, dnf: false }, fmt),
        { time: '+6.000', pen: '+5s', change: '▼1', changeCls: 'down' });
    assert.deepStrictEqual(T.resultCells({ position: 2, total: 102, gap: 2, penalty: 0, change: 1, dnf: false }, fmt),
        { time: '+2.000', pen: '', change: '▲1', changeCls: 'up' });
    assert.deepStrictEqual(T.resultCells({ position: 4, total: null, gap: null, penalty: 0, change: 0, dnf: true }, fmt),
        { time: 'DNF', pen: '', change: '', changeCls: '' });
});
