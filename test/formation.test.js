// Formation lap: the grid-slot parking help in the shared sim, and the race's formation state machine
const test = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Drive = require('../public/js/sim/drive.js');

const monza = Track.load('monza');
const sc = monza.scale;
const slot = monza.startPositions[4];
// A car posed relative to the slot: a metres along its heading (< 0 short of it), l to the side, h heading error
const carAt = (a, l, h = 0, speed = 0) => {
    const c = Math.cos(slot.angle), s = Math.sin(slot.angle), ang = slot.angle + h;
    return { x: slot.x + (a * c - l * s) * sc, y: slot.y + (a * s + l * c) * sc, angle: ang, vx: Math.cos(ang) * speed * sc, vy: Math.sin(ang) * speed * sc,
        speed: speed * sc, steer: 0, assist: 'off', grid: { x: slot.x, y: slot.y, angle: slot.angle } };
};
const ticks = (p, n, input) => { for (let i = 0; i < n; i++) Drive.driveCar(p, input, monza, 1 / 60); };

test('slotFrame: 10 m short of the slot on its heading reads a ≈ -10, l ≈ 0, h ≈ 0', () => {
    const f = Drive.slotFrame(carAt(-10, 0), slot, sc);
    assert.ok(Math.abs(f.a + 10) < 1e-6 && Math.abs(f.l) < 1e-6 && Math.abs(f.h) < 1e-9 && Math.abs(f.d - 10) < 1e-6, JSON.stringify(f));
});

test('gridSettle: off the line with no steering, the nudge steers toward the slot line; full opposite lock still steers away', () => {
    const left = { ...carAt(-20, 2, 0, 10), form: { phase: 'approach' } }; // 2 m to the left (+l)
    const nudged = Drive.gridSettle(left, { throttle: 0, brake: 0, steer: 0 }, monza);
    const right = { ...carAt(-20, -2, 0, 10), form: { phase: 'approach' } };
    const nudgedR = Drive.gridSettle(right, { throttle: 0, brake: 0, steer: 0 }, monza);
    assert.ok(nudged.steer !== 0 && Math.sign(nudged.steer) === -Math.sign(nudgedR.steer), `${nudged.steer} / ${nudgedR.steer}`);
    const fight = Drive.gridSettle(left, { throttle: 0, brake: 0, steer: -Math.sign(nudged.steer) }, monza);
    assert.ok(Math.sign(fight.steer) === -Math.sign(nudged.steer), 'the player wins');
});

test('gridSettle: above 80 km/h or before approach, input is returned unchanged', () => {
    const input = { throttle: 0.5, brake: 0, steer: 0.1 };
    assert.deepStrictEqual(Drive.gridSettle({ ...carAt(-20, 2, 0, 30), form: { phase: 'approach' } }, input, monza), input);
    assert.deepStrictEqual(Drive.gridSettle({ ...carAt(-20, 2, 0, 10), form: { phase: 'drive' } }, input, monza), input);
});

test('driveCar snap: from 0.6 m off and 0.2 rad, 60 ticks land within FORM_HELD_M and 0.01 rad of the slot', () => {
    const p = { ...carAt(-0.5, 0.33, 0.2), form: { phase: 'snap' } };
    ticks(p, 60, { throttle: 1, brake: 0, steer: 1 });
    const f = Drive.slotFrame(p, slot, sc);
    assert.ok(f.d < Drive.FORM_HELD_M && Math.abs(f.h) < 0.01, JSON.stringify(f));
    assert.strictEqual(p.speed, 0);
});

test('driveCar held: throttle 1 for 60 ticks moves the car 0 m', () => {
    const p = { ...carAt(0, 0), form: { phase: 'held' } }, x = p.x, y = p.y;
    ticks(p, 60, { throttle: 1, brake: 0, steer: 0.5 });
    assert.strictEqual(p.x, x); assert.strictEqual(p.y, y);
});

// ---- The race's formation state machine (Game) ----
const Game = require('../src/game/Game');
const lp = (id) => ({ id, username: id.toUpperCase(), teamId: 'ferrari' });
const total = monza.cum[monza.path.length];
function race(ids = ['a', 'b', 'c']) {
    const sent = [];
    const io = { emit: (ev, d) => sent.push([ev, d]), volatile: { emit() {} } };
    const g = new Game(io, ids.map(lp), monza, { maxLaps: 3, qualifying: false }, () => {}, 'race');
    g.sent = sent;
    return g;
}
// Pose a car relative to its own slot (a metres along the slot heading, l to the side), stopped
const toSlot = (p, a = 0, l = 0) => {
    const c = Math.cos(p.grid.angle), s = Math.sin(p.grid.angle);
    Object.assign(p, { x: p.grid.x + (a * c - l * s) * sc, y: p.grid.y + (a * s + l * c) * sc, angle: p.grid.angle, vx: 0, vy: 0, speed: 0 });
};
const half = (p) => { p.lapS = total / 2; };

test('startFormation: every car ghost, form.phase drive, no tyre wear while driving', () => {
    const g = race(), a = g.players.a;
    g.startFormation();
    for (const p of Object.values(g.players)) { assert.strictEqual(p.ghost, true); assert.strictEqual(p.form.phase, 'drive'); }
    for (let i = 0; i < 180; i++) { a.input = { throttle: 1, brake: 0, steer: 0 }; g.update(); }
    assert.ok(a.speed > 0 && a.wear === 0, `speed ${a.speed} wear ${a.wear}`);
});

test('a car still on its slot at the start never becomes held', () => {
    const g = race();
    g.startFormation();
    for (let i = 0; i < 100; i++) g.update();
    assert.strictEqual(g.players.a.form.phase, 'drive');
    assert.strictEqual(g.formation.firstHeldAt, null);
});

test("after half a lap, stopping 0.5 m short of the slot snaps and holds; 'forming' is sent with 30 s", () => {
    const g = race(), a = g.players.a;
    g.startFormation();
    half(a); g.updateFormation(a);
    toSlot(a, -0.5, 0.2);
    for (let i = 0; i < 90; i++) g.update();
    assert.strictEqual(a.form.phase, 'held');
    assert.ok(Drive.slotFrame(a, a.grid, sc).d < Drive.FORM_HELD_M);
    assert.ok(g.formation.firstHeldAt !== null);
    assert.deepStrictEqual(g.sent.find(([ev]) => ev === 'formation')?.[1], { phase: 'forming', endsInMs: 30000 });
});

test('30 s after the first human is held, the rest are placed on their slots and onFormationDone fires once', () => {
    const g = race(); let done = 0;
    g.onFormationDone = () => done++;
    g.startFormation();
    const b = g.players.b; b.x += 500 * sc; // far away on the formation lap
    g.formation.firstHeldAt = g.clock - 30;
    g.formationTick(); g.formationTick();
    assert.strictEqual(done, 1);
    assert.strictEqual(g.formation, null);
    assert.ok(Drive.slotFrame(b, b.grid, sc).d < 1e-9 && b.form === null);
});

test('a bot held first does not start the 30 s clock', () => {
    const g = race(), c = g.players.c;
    g.startFormation();
    c.isBot = true; half(c); g.updateFormation(c); toSlot(c);
    c.form.phase = 'snap'; g.updateFormation(c);
    assert.strictEqual(c.form.phase, 'held');
    assert.strictEqual(g.formation.firstHeldAt, null);
});

test('180 s with nobody held ends the formation', () => {
    const g = race(); let done = 0;
    g.onFormationDone = () => done++;
    g.startFormation();
    g.formation.startedAt = g.clock - 180;
    g.formationTick();
    assert.strictEqual(done, 1);
});

test('crossing the start line during formation counts no lap; after it every car starts lap 1 clean', () => {
    const g = race(), a = g.players.a, cps = monza.checkpoints;
    g.startFormation();
    a.penalty = 5; a.lapValid = false; a.jumpStart = true;
    for (let k = 1; k <= cps.length; k++) { const cp = cps[k % cps.length]; a.x = cp.x; a.y = cp.y; g.update(); }
    assert.strictEqual(a.lap, 0);
    g.endFormation();
    assert.deepStrictEqual([a.lap, a.checkpoint, a.lapStart, a.penalty, a.lapValid, a.jumpStart, a.form], [0, 0, 0, 0, true, false, null]);
    assert.strictEqual(a.ghost, true); // ghost start setting default
});

test('driving into the pit lane during formation: no stop phase is ever set', () => {
    const g = race(), a = g.players.a, pts = monza.pit.path, m = pts[Math.floor(pts.length / 2)], n = pts[Math.floor(pts.length / 2) + 1];
    g.startFormation();
    a.boxCall = null; g.setBoxCall('a', true);
    const ang = Math.atan2(n.y - m.y, n.x - m.x);
    Object.assign(a, { x: m.x, y: m.y, angle: ang, vx: Math.cos(ang) * 15 * sc, vy: Math.sin(ang) * 15 * sc, speed: 15 * sc });
    for (let i = 0; i < 60; i++) { a.input = { throttle: 0.3, brake: 0, steer: 0 }; g.update(); }
    assert.strictEqual(a.stop, null);
    assert.strictEqual(a.boxCall, null);
});

test('ranks during formation follow grid order even when the last car drives ahead', () => {
    const g = race(), c = g.players.c, cp = monza.checkpoints[3];
    g.startFormation();
    c.x = cp.x; c.y = cp.y; c.checkpoint = 3;
    g.update();
    assert.deepStrictEqual(['a', 'b', 'c'].map((id) => g.players[id].rank), [1, 2, 3]);
});

test('the only human leaving ends the formation on the next tick', () => {
    const g = race(); let done = 0;
    g.onFormationDone = () => done++;
    g.startFormation();
    g.players.b.isBot = true; g.players.c.isBot = true;
    g.removePlayer('a');
    g.formationTick();
    assert.strictEqual(done, 1);
});

// ---- Final review fixes ----
const { fillGrid } = require('../src/game/bots/roster');
test('bots drive the formation lap and park themselves on their slots (one idle human, five bots, Monza)', () => {
    const human = lp('h'), bots = fillGrid([human], 'medium', 7, 6);
    const g = new Game({ emit() {}, volatile: { emit() {} } }, [human, ...bots], monza, { maxLaps: 3, qualifying: false }, () => {}, 'race');
    g.startFormation();
    assert.ok(Object.values(g.players).every((p) => p.bot === undefined), 'bot driver state from before the formation lap is gone');
    const held = new Set();
    for (let k = 0; k < 60 * 179 && g.formation; k++) {
        g.update();
        for (const p of Object.values(g.players)) if (p.isBot && p.form?.phase === 'held') held.add(p.id);
    }
    assert.strictEqual(held.size, 5, `held: ${[...held]}`);
});

test('throttle held while parked is not a jump start when the formation ends; pressing it again after letting go is', () => {
    const g = race(), a = g.players.a;
    g.startFormation();
    a.form.half = true; a.form.phase = 'held';
    a.input = { throttle: 1, brake: 0, steer: 0 };
    a.lapS = 123;
    g.endFormation();
    assert.strictEqual(a.lapS, null);
    assert.deepStrictEqual(g.lastDetect, []);
    for (let i = 0; i < 30; i++) { a.input = { throttle: 1, brake: 0, steer: 0 }; g.update(); }
    assert.strictEqual(a.penalty, 0);
    a.input = { throttle: 0, brake: 0, steer: 0 }; g.update();
    for (let i = 0; i < 60; i++) { a.input = { throttle: 1, brake: 0, steer: 0 }; g.update(); }
    assert.ok(a.jumpStart && a.penalty > 0);
});

// ...but it doesn't drive the car either: held through the whole light sequence it rolled 144 m off the slot, unpenalised
test('a throttle held from the formation lap through the lights keeps the car on its slot', () => {
    const g = race(), a = g.players.a;
    g.startFormation();
    g.endFormation();
    const x0 = a.x, y0 = a.y;
    for (let i = 0; i < 60 * 5; i++) { a.input = { throttle: 1, brake: 0, steer: 0 }; g.update(); }
    assert.ok(Math.hypot(a.x - x0, a.y - y0) / monza.scale < 0.5, `rolled ${(Math.hypot(a.x - x0, a.y - y0) / monza.scale).toFixed(1)} m`);
    assert.strictEqual(a.penalty, 0);
});

test('throttle while the grid is still loading, before a formation lap, is not a jump start', () => {
    const g = race(), a = g.players.a;
    assert.strictEqual(g.wantsFormation, true);
    for (let i = 0; i < 60; i++) { a.input = { throttle: 1, brake: 0, steer: 0 }; g.update(); }
    assert.ok(!a.jumpStart && a.penalty === 0 && !g.sent.some(([ev, d]) => ev === 'track_limits' && d.kind === 'jump'));
    const off = new Game({ emit() {}, volatile: { emit() {} } }, [lp('a')], monza, { maxLaps: 3, qualifying: false, formationLap: false }, () => {}, 'race');
    assert.strictEqual(off.wantsFormation, false); // no formation lap: the grid is the start, jump starts count from the first tick
});

// No overtaking on the formation lap: a warning only (user's call), once per pass, again only after giving the place back
test('passing a car that starts ahead on the formation lap warns the passer once; giving the place back and passing again warns again', () => {
    const g = race(), a = g.players.a, b = g.players.b;
    g.startFormation();
    const passes = () => g.sent.filter(([ev, d]) => ev === 'track_limits' && d.kind === 'formation_pass');
    const at = (p, metres) => { // p this far along the track's centre line (clear of the grid, ~280-300 m)
        const s = (metres * sc) % total, i = monza.cum.findIndex((c) => c > s) - 1, q = monza.path[i];
        p.x = q.x; p.y = q.y;
    };
    at(a, 1300); at(b, 1280); g.update(); // grid order kept: a (P1) ahead of b (P2)
    assert.strictEqual(passes().length, 0);
    at(b, 1320); g.update(); g.update(); // b passes a
    assert.deepStrictEqual(passes().map(([, d]) => [d.id, d.with]), [['b', 'A']]);
    at(b, 1330); g.update(); // still ahead: no repeat
    assert.strictEqual(passes().length, 1);
    at(a, 1400); g.update(); // place given back
    at(b, 1420); g.update(); // passes again
    assert.strictEqual(passes().length, 2);
    assert.strictEqual(b.penalty, 0); // a warning only
});
