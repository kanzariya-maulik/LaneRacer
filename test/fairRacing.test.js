// Fair racing: ghost start through the first corners, lenient lap-1 blame, cut vs wide, strike ladder
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

const io = { emit() {}, volatile: { emit() {} } };
const spy = () => { const events = []; return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } }; };
const monza = Track.load('monza');
const lp = (id, teamId = 'ferrari') => ({ id, username: id.toUpperCase(), teamId });
const RACE = { maxLaps: 3, qualifying: false };
const sector1End = (g) => g.track.sectorCps[1];

test('ghost start: every race car is a ghost on the grid; off by setting; quali unaffected', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    assert.ok(g.players.a.ghost && g.players.b.ghost);
    const off = new Game(io, [lp('a'), lp('b')], monza, { ...RACE, ghostStart: false }, () => {});
    assert.ok(!off.players.a.ghost && !off.players.b.ghost);
});

test('ghost start: ghosts never collide; solid after sector 1 when clear', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    const a = g.players.a, b = g.players.b;
    b.x = a.x; b.y = a.y; b.angle = a.angle; // fully overlapping
    a.vx = 30 * monza.scale; b.vx = 0;
    g.update();
    assert.ok(Physics.carOverlap(a, b, monza.scale), 'ghosts pass through: no push apart');
    a.checkpoint = sector1End(g); b.checkpoint = sector1End(g);
    g.updateGhosts(['a', 'b']);
    assert.ok(a.ghost && b.ghost, 'overlapping cars stay ghost until clear');
    b.x += 20 * monza.scale;
    g.updateGhosts(['a', 'b']);
    assert.ok(!a.ghost && !b.ghost, 'clear and past sector 1: solid');
});

test('ghost start: before sector 1 a clear car stays ghost; the 25 s cap ends it', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const a = g.players.a;
    g.time = 10; g.updateGhosts(['a']);
    assert.ok(a.ghost);
    g.time = 25; g.updateGhosts(['a']);
    assert.ok(!a.ghost);
});

test('ghost bit in the fast packet is per car', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    g.players.b.ghost = false;
    const pk = g.fastPacket().c, flagsOf = (i) => pk.find((e) => e[0] === i)[6];
    const ia = g.index.a, ib = g.index.b;
    assert.ok(flagsOf(ia) & Game.FLAGS.ghost);
    assert.ok(!(flagsOf(ib) & Game.FLAGS.ghost));
});

// Two solid cars touching at speed: a drives into b with `aIn`, b into a with `bIn` (m/s)
function contact(g, aIn, bIn) {
    const a = g.players.a, b = g.players.b, sc = monza.scale;
    a.ghost = b.ghost = false;
    a.vx = aIn * sc; a.vy = 0; b.vx = -bIn * sc; b.vy = 0;
    g.noteContact(a, b, { nx: -1, ny: 0 }); // n points from b to a: a is left of b
}

test('lap-1 blame is lenient: 2.5x is a racing incident on the first lap, a penalty after it', () => {
    const s1 = spy(), g1 = new Game(s1.io, [lp('a'), lp('b')], monza, RACE, () => {});
    g1.release();
    contact(g1, 10, 4);
    assert.strictEqual(g1.incidents.length, 0);
    const g2 = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g2.release();
    g2.players.a.lap = g2.players.b.lap = 1;
    contact(g2, 10, 4);
    assert.strictEqual(g2.incidents.length, 1);
    const g3 = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g3.release();
    contact(g3, 12, 3); // 4x: a clear hit even on lap 1
    assert.strictEqual(g3.incidents.length, 1);
});

const tracks = Track.loadAll();
// Tightest bend of a circuit: the path index with the largest |bend|
// Usable: a car 2 m past the white line on either side is still nearest to this stretch (not beside another leg of a hairpin)
// and really off the road line there; the tightest hairpin bends of sakhir, cota and buddh fail this and are skipped
const usable = (t, i) => [1, -1].every((s) => {
    const q = pastLine(t, i, s), n = Physics.nearestOnTrack(q.x, q.y, t);
    return Math.abs(n.i - i) <= 3 && n.dist > Track.edgeAt(t, n, q.x, q.y) + Physics.CAR_HALF_WIDTH_M * t.scale;
});
const tightest = (t) => t.path.reduce((b, _, i) => (usable(t, i) && (b < 0 || Math.abs(Game.bendAt(t, i)) > Math.abs(Game.bendAt(t, b))) ? i : b), -1);
// A point beside path index i, `m` metres past the white line on the given side (+1 = left of the heading, -1 = right)
function pastLine(t, i, sideSign, m = 2) {
    const P = t.path, a = P[i], b = P[(i + 1) % P.length], h = Math.atan2(b.y - a.y, b.x - a.x);
    const probe = { x: a.x - Math.sin(h) * sideSign * t.scale, y: a.y + Math.cos(h) * sideSign * t.scale };
    const line = Track.edgeAt(t, Physics.nearestOnTrack(probe.x, probe.y, t), probe.x, probe.y);
    const off = line + (Physics.CAR_HALF_WIDTH_M + m) * t.scale;
    return { x: a.x - Math.sin(h) * sideSign * off, y: a.y + Math.cos(h) * sideSign * off };
}
// Independent inside check: the inside of a bend is the side the chord between ±25 m lies on
function insideSign(t, i) {
    const P = t.path, n = P.length, a = P[i], b = P[(i + 1) % n], h = Math.atan2(b.y - a.y, b.x - a.x);
    let k = i, j = i, back = 0, fwd = 0;
    while (back < 25 * t.scale) { const q = (k - 1 + n) % n; back += Math.hypot(P[k].x - P[q].x, P[k].y - P[q].y); k = q; }
    while (fwd < 25 * t.scale) { const q = (j + 1) % n; fwd += Math.hypot(P[q].x - P[j].x, P[q].y - P[j].y); j = q; }
    const mx = (P[k].x + P[j].x) / 2 - a.x, my = (P[k].y + P[j].y) / 2 - a.y;
    return -Math.sin(h) * mx + Math.cos(h) * my > 0 ? 1 : -1; // + = left (L = (-sin h, cos h))
}
const strike = (g, p, at) => { p.x = at.x; p.y = at.y; p.offLimits = false; g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, g.track)); };

for (const id of Track.TRACK_IDS) {
    test(`${id}: the inside of the tightest bend is a cut, the outside is wide`, () => {
        const t = tracks[id], i = tightest(t), ins = insideSign(t, i);
        const { events, io: sio } = spy(), g = new Game(sio, [lp('a')], t, RACE, () => {});
        g.release();
        const p = g.players.a;
        strike(g, p, pastLine(t, i, ins));
        assert.strictEqual(p.limits, 1, 'cut = strike');
        strike(g, p, pastLine(t, i, -ins));
        assert.strictEqual(p.limits, 1, 'wide = no strike');
        assert.strictEqual(p.lapValid, false);
        assert.ok(events.some(([ev, d]) => ev === 'track_limits' && d.kind === 'wide'));
    });
}

test('a long straight is wide on both sides', () => {
    const t = monza, i = t.path.reduce((b, _, k) => (Math.abs(Game.bendAt(t, k)) < Math.abs(Game.bendAt(t, b)) ? k : b), 0);
    const g = new Game(io, [lp('a')], t, RACE, () => {});
    g.release();
    strike(g, g.players.a, pastLine(t, i, 1));
    strike(g, g.players.a, pastLine(t, i, -1));
    assert.strictEqual(g.players.a.limits, 0);
});

test('strike ladder: three warnings, a black-and-white flag, then +5 s each', () => {
    const { events, io: sio } = spy(), t = monza, i = tightest(t), ins = insideSign(t, i);
    const g = new Game(sio, [lp('a')], t, RACE, () => {});
    g.release();
    const p = g.players.a;
    for (let k = 0; k < 6; k++) strike(g, p, pastLine(t, i, ins));
    const kinds = events.filter(([ev]) => ev === 'track_limits').map(([, d]) => d.kind + (d.count ? d.count : ''));
    assert.deepStrictEqual(kinds, ['warning1', 'warning2', 'warning3', 'flag', 'penalty', 'penalty']);
    assert.strictEqual(p.penalty, 10);
    assert.ok(events.find(([, d]) => d.kind === 'warning').at(1).of === 3);
});

test('pushed-off victim gets no strike or wide', () => {
    const { events, io: sio } = spy(), t = monza, i = tightest(t), ins = insideSign(t, i);
    const g = new Game(sio, [lp('a'), lp('b')], t, RACE, () => {});
    g.release();
    g.incidents.push({ striker: 'b', victim: 'a', at: 0, off: false, before: false });
    strike(g, g.players.a, pastLine(t, i, ins));
    strike(g, g.players.a, pastLine(t, i, -ins));
    assert.strictEqual(g.players.a.limits, 0);
    assert.ok(!events.some(([ev, d]) => ev === 'track_limits' && d.id === 'a'));
});

test('incident events reach both drivers, only with contact penalties on', () => {
    for (const contactPenalties of [true, false]) {
        const { events, io: sio } = spy(), g = new Game(sio, [lp('a'), lp('b')], monza, { ...RACE, contactPenalties }, () => {});
        g.release();
        g.players.a.lap = g.players.b.lap = 1;
        contact(g, 6, 5); // alike: racing incident
        const inc = events.filter(([ev, d]) => ev === 'track_limits' && d.kind === 'incident');
        assert.strictEqual(inc.length, contactPenalties ? 2 : 0);
        if (contactPenalties) assert.deepStrictEqual(inc.map(([, d]) => [d.id, d.with]).sort(), [['a', 'B'], ['b', 'A']]);
    }
});

test('collision and hit events carry what the steward card needs', () => {
    const { events, io: sio } = spy(), g = new Game(sio, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    g.players.a.lap = g.players.b.lap = 1;
    contact(g, 12, 1);
    g.judgeIncidents(true);
    const col = events.find(([, d]) => d.kind === 'collision')[1], hit = events.find(([, d]) => d.kind === 'hit')[1];
    assert.deepStrictEqual([col.id, col.add, col.victim, col.off], ['a', 5, 'B', false]);
    assert.deepStrictEqual([hit.id, hit.by, hit.add], ['b', 'A', 5]);
});
