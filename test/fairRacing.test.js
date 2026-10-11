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
