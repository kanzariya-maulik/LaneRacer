// Qualifying sessions in Game: Q1/Q2/Q3 knockouts, short, one-shot, chequered flag, breaks, grid order
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
const lp = (id) => ({ id, username: id.toUpperCase(), teamId: 'ferrari' });
const spy = () => { const events = []; return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } }; };
const QS = (format, extra = {}) => ({ maxLaps: 3, qualifying: true, qualiFormat: format, ...extra });

// One timed lap of `seconds` from the line (teleported through the checkpoints), then back in the box
function timedLap(g, p, seconds, { valid = true, park = true } = {}) {
    Object.assign(p, { stop: null, inPit: false, checkpoint: 0, lapStart: g.time, sectorStart: g.time, lapValid: true, qualiDone: false });
    const cps = g.track.checkpoints, t0 = g.time;
    for (let k = 1; k <= cps.length; k++) {
        const target = (p.checkpoint + 1) % cps.length;
        g.time = t0 + (seconds * k) / cps.length;
        if (!valid) p.lapValid = false;
        p.x = cps[target].x; p.y = cps[target].y;
        g.checkLapProgress(p);
    }
    if (park) Object.assign(p, { lapStart: null, sectorStart: null, stop: { phase: 'wait', t: 0, age: 0 }, inPit: true });
}
const at = (g, time) => { g.time = time; g.updateQuali(); };

test('full with 4 drivers: Q1 knocks out 1, Q2 knocks out 1, Q3 decides the front; grid order', () => {
    const { events, io } = spy(), ids = ['a', 'b', 'c', 'd'];
    let rows = null;
    const g = new Game(io, ids.map(lp), monza, QS('full'), (r) => { rows = r; }, 'quali');
    assert.strictEqual(g.quali.format, 'full');
    ids.forEach((id, k) => timedLap(g, g.players[id], 80 + k));
    at(g, g.quali.endsAt);
    assert.strictEqual(g.quali.phase, 'break', 'everyone parked: the flag ends the segment at once');
    const s1 = events.find(([e]) => e === 'quali_segment')[1];
    assert.deepStrictEqual(s1.rows.filter((r) => r.out).map((r) => r.id), ['d']);
    assert.strictEqual(s1.next, 2);
    assert.ok(g.players.d.qualiOut);
    at(g, g.quali.breakEndsAt);
    assert.deepStrictEqual([g.quali.segment, g.quali.phase], [2, 'running']);
    timedLap(g, g.players.a, 79); timedLap(g, g.players.b, 78); timedLap(g, g.players.c, 82);
    at(g, g.quali.endsAt); at(g, g.quali.breakEndsAt);
    assert.deepStrictEqual([g.quali.segment, g.players.c.qualiOut], [3, true]);
    timedLap(g, g.players.a, 77); timedLap(g, g.players.b, 77.5);
    at(g, g.quali.endsAt);
    assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd']);
    assert.deepStrictEqual(rows.map((r) => r.segment), [3, 3, 2, 1]);
});

test('fewer than 4 drivers run Full as Short (one segment)', () => {
    const g = new Game(spy().io, ['a', 'b'].map(lp), monza, QS('full'), () => {}, 'quali');
    assert.strictEqual(g.quali.format, 'short');
    assert.strictEqual(g.quali.plan.length, 1);
});

test('flag: a lap started before zero counts, one started after does not', () => {
    const g = new Game(spy().io, ['a', 'b'].map(lp), monza, QS('short'), () => {}, 'quali'), a = g.players.a;
    g.time = g.quali.endsAt - 10;
    timedLap(g, a, 80, { park: false }); // started 10 s before zero, finished in the flag
    g.updateQuali();
    assert.strictEqual(a.segBest, 80);
    assert.ok(a.qualiDone, 'the flag ends the run at the line');
    assert.strictEqual(a.lapStart, null, 'no new timed lap after the flag');
});

test('pit entry after the flag ends the run', () => {
    const g = new Game(spy().io, ['a', 'b'].map(lp), monza, QS('short'), () => {}, 'quali'), a = g.players.a;
    Object.assign(a, { stop: null, inPit: false, lapStart: g.time, sectorStart: g.time });
    at(g, g.quali.endsAt);
    assert.strictEqual(g.quali.phase, 'flag');
    assert.ok(!a.qualiDone);
    g.endRunAtPitEntry(a);
    assert.ok(a.qualiDone);
    assert.strictEqual(a.segBest, null);
});

test('segment ends at the flag cap even if a car never finishes', () => {
    const g = new Game(spy().io, ['a', 'b'].map(lp), monza, QS('short'), () => {}, 'quali');
    Object.assign(g.players.a, { stop: null, inPit: false, lapStart: g.time, sectorStart: g.time });
    at(g, g.quali.endsAt);
    at(g, g.quali.flagCapAt);
    assert.strictEqual(g.quali.phase, 'done');
});

test('break puts every car back in its box; knocked-out cars cannot leave', () => {
    const g = new Game(spy().io, ['a', 'b', 'c', 'd'].map(lp), monza, QS('full'), () => {}, 'quali');
    ['a', 'b', 'c', 'd'].forEach((id, k) => timedLap(g, g.players[id], 80 + k));
    Object.assign(g.players.a, { stop: null, inPit: false, x: 0, y: 0, speed: 5 });
    at(g, g.quali.endsAt);
    for (const p of Object.values(g.players)) {
        assert.strictEqual(p.stop.phase, 'wait');
        assert.strictEqual(p.speed, 0);
        assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 1e-6);
    }
    at(g, g.quali.breakEndsAt);
    const d = g.players.d;
    d.input = { throttle: 1, brake: 0, steer: 0 };
    g.updateStop(d);
    assert.strictEqual(d.stop.phase, 'wait');
    const a = g.players.a;
    a.input = { throttle: 1, brake: 0, steer: 0 };
    g.updateStop(a);
    assert.strictEqual(a.stop.phase, 'out', 'a survivor can drive out');
});

test('one-shot: one flying lap each, a deleted lap has no time', () => {
    let rows = null;
    const g = new Game(spy().io, ['a', 'b'].map(lp), monza, QS('oneshot'), (r) => { rows = r; }, 'quali');
    timedLap(g, g.players.a, 80, { park: false });
    assert.ok(g.players.a.qualiDone);
    assert.strictEqual(g.players.a.lapStart, null, 'only one flying lap');
    timedLap(g, g.players.b, 78, { valid: false, park: false });
    assert.strictEqual(g.players.b.segBest, null);
    g.updateQuali(); g.updateQuali();
    assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b']);
});

test('disconnect mid-segment: keeps time, ranked, not in the next segment', () => {
    const { events, io } = spy(), ids = ['a', 'b', 'c', 'd', 'e'];
    const g = new Game(io, ids.map(lp), monza, QS('full'), () => {}, 'quali');
    ids.forEach((id, k) => timedLap(g, g.players[id], 80 + k));
    g.removePlayer('a'); // fastest, gone
    at(g, g.quali.endsAt);
    const rows = events.find(([e]) => e === 'quali_segment')[1].rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e']);
    assert.deepStrictEqual(rows.filter((r) => r.out).map((r) => r.id), ['e']);
    at(g, g.quali.breakEndsAt);
    assert.ok(!g.players.a);
});

test('quali_lap reports positions and provisional pole', () => {
    const { events, io } = spy();
    const g = new Game(io, ['a', 'b'].map(lp), monza, QS('short'), () => {}, 'quali');
    timedLap(g, g.players.a, 80);
    timedLap(g, g.players.b, 79);
    const laps = events.filter(([e]) => e === 'quali_lap').map(([, d]) => d);
    assert.deepStrictEqual(laps.map((d) => [d.id, d.pos, d.pole]), [['a', 1, true], ['b', 1, true]]);
    assert.strictEqual(laps[1].prevPos, null);
    assert.ok(events.some(([e, d]) => e === 'chat_msg' && /PROVISIONAL POLE: B 1:19\.000/.test(d.msg)));
});

test('quali clock is in the init payload and reports survivors', () => {
    const g = new Game(spy().io, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(lp), monza, QS('full'), () => {}, 'quali');
    const c = g.initPayload().session;
    assert.deepStrictEqual([c.phase, c.format, c.segment, c.qphase, c.survive], ['QUALIFYING', 'full', 1, 'running', 6]);
    assert.ok(c.endsInMs > 0);
});
