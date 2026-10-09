// test/pitstop.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');
const io = { emit() {}, volatile: { emit() {} } };
const lp = (id, teamId = 'redbull', extra = {}) => ({ id, username: id, teamId, assist: 'full', ...extra });
const RACE = { maxLaps: 3, qualifying: false, rng: () => 0.5 };
let D;
before(async () => { D = await import('../public/js/sim/drive.js'); });

const pitPoint = (t, s) => Track.pointAt(t.pit.path, t.pit.cum, s, false);
// The lane centre this far along, carried straight on past the exit tip
function aheadOnLane(t, s) {
    const end = pitPoint(t, t.pit.len), over = Math.max(0, s - t.pit.len);
    return over ? { x: end.x + Math.cos(end.angle) * over, y: end.y + Math.sin(end.angle) * over } : pitPoint(t, s);
}
// Drive along the lane centre to the limiter speed, braking from 15 m before the box (as a driver stopping would)
function lanePilot(g, p, t, brakeFor = true) {
    const sc = t.scale;
    let ah = aheadOnLane(t, p.pitS + 12 * sc);
    // Leaving: merge, aiming 3 m to the road side of the lane through its last 40 m (the exit taper runs along the white line)
    if (!brakeFor && p.pitS > t.pit.len - 40 * sc) {
        const r = Physics.nearestOnTrack(ah.x, ah.y, t), k = Math.min(1, (3 * sc) / r.dist);
        ah = { x: ah.x + (r.px - ah.x) * k, y: ah.y + (r.py - ah.y) * k };
    }
    let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
    const near = brakeFor && p.box.s - p.pitS < 15 * sc && p.box.s - p.pitS > 0;
    p.input = { steer: Math.max(-1, Math.min(1, d * 2)), throttle: near ? 0 : 1, brake: near ? 1 : 0, drs: false };
}
function start(t, players, settings = RACE) {
    const g = new Game(io, players, t, settings, () => {});
    g.frozen = false;
    return g;
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: a car drives in, is guided into its box, serviced and released onto the track`, () => {
        const t = Track.load(id), g = start(t, [lp('a', 'ferrari')]), p = g.players.a;
        g.setNextCompound('a', 'H');
        const q = pitPoint(t, Math.max(t.pit.limStart, p.box.s - 120 * t.scale));
        Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * 20 * t.scale, vy: Math.sin(q.angle) * 20 * t.scale, speed: 20 * t.scale });
        g.updatePit(p); // pitS for lanePilot before the first drive
        let still = 0, serviced = false;
        for (let k = 0; k < 60 * 60 && !serviced; k++) {
            if (!p.stop) lanePilot(g, p, t);
            g.update();
            if (p.stop?.phase === 'service') still++;
            if (p.stops === 1) serviced = true;
        }
        assert.ok(serviced, 'never serviced');
        assert.strictEqual(p.compound, 'H'); assert.strictEqual(p.wear, 0); assert.deepStrictEqual(p.compoundsUsed, ['M', 'H']);
        assert.ok(still / 60 >= 2.5 && still / 60 <= 2.95, `${(still / 60).toFixed(2)} s stationary`);
        assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.6 * t.scale, 'parked on the box mark');
        // Until past the lane's tip: the tapered mouth never overlaps the road (Track.js buildPit), so the tick a car leaves
        // the lane it is crossing the sliver between the lane's asphalt and the white line (kerb, not a limits breach: fromPit)
        for (let k = 0; k < 60 * 40 && (p.inPit || p.stop || p.pitS < t.pit.len - 1e-6 * t.scale); k++) { if (!p.stop) lanePilot(g, p, t, false); g.update(); }
        assert.ok(!p.inPit && !p.stop, 'released and out of the lane');
        assert.ok(Physics.nearestOnTrack(p.x, p.y, t).dist < t.width / 2, 'back on the road');
    });
}

test('drive-through without braking: no stop, no service', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    const q = pitPoint(t, p.box.s - 100 * t.scale);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * 20 * t.scale, vy: Math.sin(q.angle) * 20 * t.scale, speed: 20 * t.scale });
    g.updatePit(p);
    for (let k = 0; k < 60 * 12; k++) { lanePilot(g, p, t, false); g.update(); assert.strictEqual(p.stop, null); }
    assert.strictEqual(p.stops, 0);
});

test('guided stop from 80 km/h braking late still stops on the mark', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a, v = (80 / 3.6) * t.scale;
    const q = pitPoint(t, p.box.s - 13 * t.scale);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v, input: { throttle: 0, brake: 1, steer: 0 } });
    for (let k = 0; k < 60 * 6 && !(p.stop && p.stop.phase !== 'guide'); k++) g.update();
    assert.ok(p.stop && p.stop.phase === 'service', 'not in service');
    assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.6 * t.scale);
});

test('team-mates get different boxes', () => {
    const t = Track.load('monza'), g = start(t, [lp('a', 'mclaren'), lp('b', 'mclaren')]);
    assert.ok(Math.hypot(g.players.a.box.x - g.players.b.box.x, g.players.a.box.y - g.players.b.box.y) > 5 * t.scale);
});

test('one service per lap', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    p.servicedLap = p.lap;
    const q = pitPoint(t, p.box.s - 8 * t.scale);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: 0, vy: 0, speed: 0, input: { throttle: 0, brake: 1, steer: 0 } });
    for (let k = 0; k < 30; k++) g.update();
    assert.strictEqual(p.stop, null);
});

test('race finish on one compound costs 22 s; two compounds none; tyre wear off none', () => {
    for (const [used, wearOn, want] of [[['M'], true, 22], [['M', 'S'], true, 0], [['M'], false, 0]]) {
        const t = Track.load('monza'), g = start(t, [lp('a')], { ...RACE, maxLaps: 2, tyreWear: wearOn }), p = g.players.a;
        p.compoundsUsed = used; p.lap = 1;
        g.finishCar(p);
        assert.strictEqual(p.penalty, want, `${used} wear ${wearOn}`);
    }
});

test('the packet carries the stop state and the predictor holds the car still through service', async () => {
    const { Predictor } = await import('../public/js/predict.js');
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle, vx: 0, vy: 0, speed: 0, stop: { phase: 'service', t: 2.4 } });
    const e = g.fastPacket().c.find((c) => c[0] === g.index.a);
    assert.strictEqual(e[12], 2); assert.strictEqual(e[13], 2.4);
    const pr = new Predictor(JSON.parse(JSON.stringify(t)), 'full');
    pr.reset(e);
    for (let k = 0; k < 60; k++) pr.step({ throttle: 1, brake: 0, steer: 1, drs: false });
    assert.ok(Math.hypot(pr.car.x - e[1], pr.car.y - e[2]) < 1e-6, 'predicted car moved during service'); // from where the packet put it (x, y to 0.1)
});

test('quali cars sitting in their boxes at the start are not serviced', () => {
    for (const id of ['monaco', 'imola']) { // their boxes land a hair (1e-12 m) short of the car's lane position
        const t = Track.load(id), g = new Game(io, [lp('a', 'ferrari'), lp('b', 'ferrari'), lp('c', 'haas'), lp('d', 'haas')], t, { qualiLaps: 2 }, () => {}, 'quali');
        for (let k = 0; k < 120; k++) g.update();
        for (const p of Object.values(g.players)) { assert.strictEqual(p.stop, null, `${id} ${p.id}`); assert.strictEqual(p.stops, 0); }
    }
});
