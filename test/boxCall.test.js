// "Box, box": the race pit call — this lap or next, cancel, missed entry carries over, cleared at the stop
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
const lp = (id) => ({ id, username: id.toUpperCase(), teamId: 'ferrari' });
const spy = () => { const events = []; return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } }; };
const RACE = { maxLaps: 3, qualifying: false };
const total = monza.cum[monza.path.length];
// Put the car on the track `m` metres before the pit entry (negative: past it)
function before(g, p, m) {
    const s = (((monza.pit.entryS - m * monza.scale) % total) + total) % total, q = Track.pointAt(monza.path, monza.cum, s);
    Object.assign(p, { x: q.x, y: q.y, inPit: false, lapS: (((s - monza.startS) % total) + total) % total });
}
const race = (io = spy().io) => { const g = new Game(io, [lp('a')], monza, RACE, () => {}); g.release(); return g; };

test('call far before the entry: this lap; within 200 m: next lap; cancel clears', () => {
    const g = race(), p = g.players.a;
    before(g, p, 1000); g.setBoxCall('a', true);
    assert.strictEqual(p.boxCall, 'this');
    g.setBoxCall('a', false);
    assert.strictEqual(p.boxCall, null);
    before(g, p, 150); g.setBoxCall('a', true);
    assert.strictEqual(p.boxCall, 'next');
});

test('next lap becomes this lap at the start line', () => {
    const g = race(), p = g.players.a;
    before(g, p, 150); g.setBoxCall('a', true);
    const cp = monza.checkpoints;
    for (let k = 1; k <= cp.length; k++) { const t = (p.checkpoint + 1) % cp.length; p.x = cp[t].x; p.y = cp[t].y; g.checkLapProgress(p); }
    assert.strictEqual(p.boxCall, 'this');
});

test('ignored in qualifying, in the pit lane, and when finished', () => {
    const q = new Game(spy().io, [lp('a'), lp('b')], monza, { maxLaps: 3, qualifying: true, qualiFormat: 'short' }, () => {}, 'quali');
    q.setBoxCall('a', true);
    assert.ok(!q.players.a.boxCall);
    const g = race(), p = g.players.a;
    before(g, p, 1000); p.inPit = true; g.setBoxCall('a', true);
    assert.ok(!p.boxCall);
    p.inPit = false; p.finished = true; g.setBoxCall('a', true);
    assert.ok(!p.boxCall);
});

test('missed entry: the call stays for the next lap and the driver is told once', () => {
    const { events, io } = spy(), g = race(io), p = g.players.a;
    before(g, p, 300); g.setBoxCall('a', true);
    for (const m of [100, 20, -10, -60, -80]) { before(g, p, m); g.checkBoxMissed(p); }
    assert.strictEqual(p.boxCall, 'this');
    assert.strictEqual(events.filter(([e, d]) => e === 'track_limits' && d.kind === 'box_missed').length, 1);
});

test('call then stop: service clears the call, the stop fits the chosen set', () => {
    const g = race(), p = g.players.a;
    before(g, p, 1000); g.setBoxCall('a', true); g.setNextCompound('a', 'S');
    p.stop = { phase: 'guide', t: 0, age: 0, parkedAt: 0 };
    p.box = p.box || { x: p.x, y: p.y, angle: 0, s: 0 };
    Object.assign(p, { x: p.box.x, y: p.box.y, vx: 0, vy: 0, speed: 0, inPit: true, pitS: p.box.s });
    for (let k = 0; k < 60 * 4 && p.stop?.phase !== 'service'; k++) g.updateStop(p);
    assert.strictEqual(p.stop.phase, 'service');
    assert.strictEqual(p.boxCall, null);
});

test('boxCall travels in the meta diff', () => {
    const g = race(), p = g.players.a;
    g.metaDiff();
    before(g, p, 1000); g.setBoxCall('a', true);
    assert.deepStrictEqual(g.metaDiff().a, { boxCall: 'this' });
});
