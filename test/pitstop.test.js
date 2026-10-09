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

// Limiter speed down the lane centre from 80 m out, full brake from `brakeAt` m before the box (as a driver would)
function approach(id, brakeAt) {
    const t = Track.load(id), g = start(t, [lp('a', 'ferrari')]), p = g.players.a, sc = t.scale, lim = ((t.pit.limitKmh || 80) / 3.6) * sc;
    const q = pitPoint(t, p.box.s - 80 * sc);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * lim, vy: Math.sin(q.angle) * lim, speed: lim });
    g.updatePit(p);
    let trig = null, parked = null, maxBack = 0, longest = 0;
    for (let k = 0; k < 60 * 15 && parked === null; k++) {
        if (!p.stop) { lanePilot(g, p, t, false); if (p.box.s - p.pitS < brakeAt * sc) p.input = { ...p.input, throttle: 0, brake: 1 }; }
        g.update();
        if (p.stop && trig === null) trig = k;
        if (p.stop?.phase === 'guide') { maxBack = Math.max(maxBack, -p.speed / sc); longest = Math.max(longest, p.stop.age); }
        if (p.stop?.phase === 'service') parked = k;
        if (trig !== null && !p.stop && parked === null) break; // the guide gave up
    }
    return { t, p, trig, parked, maxBack, longest, dist: Math.hypot(p.x - p.box.x, p.y - p.box.y) / sc };
}

test('braking for the box at any point from the limiter: parked on the mark, or control back by 6 s; reverse at most 2 m/s', () => {
    // Within 3 s of the trigger where the physics allows it: from 80 km/h a car needs ~13.5 m to stop, so braking later
    // overshoots and the guide has to back it up at walking pace (see the task-6 report for the full table)
    const quick = new Set(['monza 14', 'spa 14', 'monaco 14', 'zandvoort 14', 'buddh 14', 'monaco 10', 'zandvoort 10']);
    for (const id of ['monza', 'spa', 'monaco', 'zandvoort', 'buddh']) for (const brakeAt of [3, 6, 10, 14]) {
        const r = approach(id, brakeAt), at = `${id} ${brakeAt} m`;
        assert.ok(r.trig !== null, `${at}: never guided`);
        assert.ok(r.maxBack <= 2 + 1e-9, `${at}: reversed at ${r.maxBack.toFixed(2)} m/s`);
        assert.ok(r.longest <= 6 + 1 / 60 + 1e-9, `${at}: guided for ${r.longest.toFixed(2)} s`);
        if (r.parked !== null) assert.ok(r.dist < 0.5, `${at}: parked ${r.dist.toFixed(2)} m from the mark`);
        else assert.strictEqual(r.p.stops, 0, `${at}: gave up but serviced`);
        if (quick.has(`${id} ${brakeAt}`)) assert.ok(r.parked !== null && (r.parked - r.trig) / 60 <= 3, `${at}: ${r.parked === null ? 'gave up' : ((r.parked - r.trig) / 60).toFixed(2) + ' s'}`);
    }
});

// The car at rest level with its box, `off` m out toward the lane centre, being guided
function levelWithBox(id, off) {
    const t = Track.load(id), g = start(t, [lp('a', 'ferrari')]), p = g.players.a, b = p.box, sc = t.scale;
    const c = pitPoint(t, b.s), ux = -Math.sin(b.angle), uy = Math.cos(b.angle), side = Math.sign((c.x - b.x) * ux + (c.y - b.y) * uy) || 1;
    Object.assign(p, { x: b.x + side * ux * off * sc, y: b.y + side * uy * off * sc, angle: b.angle, vx: 0, vy: 0, speed: 0, stop: { phase: 'guide', t: 2.7, age: 0 } });
    g.updatePit(p);
    return { t, g, p };
}

test('stopped level with the box but out in the lane: the guide shuffles back and in onto the mark', () => {
    for (const id of ['monza', 'spa', 'monaco', 'zandvoort', 'buddh']) for (const off of [1, 1.5]) {
        const { t, g, p } = levelWithBox(id, off);
        for (let k = 0; k < 60 * 6 && p.stop?.phase === 'guide'; k++) g.update();
        assert.strictEqual(p.stop?.phase, 'service', `${id} ${off} m out`);
        assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.5 * t.scale);
    }
});

test('a guide that cannot park gives the car back after 6 s; holding the brake does not re-ask, a fresh press does', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a, sc = t.scale;
    const q = pitPoint(t, p.box.s - 8 * sc);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: 0, vy: 0, speed: 0, input: { throttle: 0, brake: 1, steer: 0 } });
    p.box = { ...p.box, x: p.box.x + 60 * sc }; // the mark out behind the barrier: unreachable (s unchanged, so it still triggers)
    g.update();
    assert.strictEqual(p.stop?.phase, 'guide');
    let k = 1;
    for (; k < 60 * 8 && p.stop; k++) g.update();
    assert.ok(k / 60 >= 6 && k / 60 <= 6 + 2 / 60, `gave up after ${(k / 60).toFixed(2)} s`);
    assert.strictEqual(p.stops, 0); assert.strictEqual(p.servicedLap, -1);
    for (let i = 0; i < 30; i++) { g.update(); assert.strictEqual(p.stop, null, 'brake still held: no new guide'); }
    p.input = { throttle: 0.5, brake: 0, steer: 0 }; // the driver has the car back
    const x0 = p.x, y0 = p.y;
    for (let i = 0; i < 30; i++) g.update();
    assert.ok(Math.hypot(p.x - x0, p.y - y0) > 0.1 * sc, 'driver input moves the car again');
    p.input = { throttle: 0, brake: 1, steer: 0 };
    for (let i = 0; i < 5 && !p.stop; i++) g.update();
    assert.ok(p.box.s - p.pitS >= 0.5 * sc, 'still short of the box'); // so a guide may start
    assert.strictEqual(p.stop?.phase, 'guide', 'a fresh brake press asks again');
});

// Car a finishing its service at the box while car b sits/moves in the lane `behind` m before the box
function release(behind, moving) {
    const t = Track.load('monza'), g = start(t, [lp('a', 'ferrari'), lp('b', 'haas')]), a = g.players.a, b = g.players.b, sc = t.scale;
    Object.assign(a, { x: a.box.x, y: a.box.y, angle: a.box.angle, vx: 0, vy: 0, speed: 0, stop: { phase: 'service', t: 1e-6 } });
    const q = pitPoint(t, a.box.s - behind * sc), v = moving ? 2 * sc : 0;
    Object.assign(b, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v, servicedLap: b.lap });
    g.updatePit(a); g.updatePit(b);
    let held = 0;
    for (let k = 0; k < 120 && a.stop; k++) {
        b.input = { throttle: moving ? 0.02 : 0, brake: moving ? 0 : 1, steer: 0 };
        g.update();
        if (a.stop?.phase === 'hold') held++;
    }
    assert.strictEqual(a.stop, null); assert.strictEqual(a.stops, 1);
    return held / 60;
}

test('unsafe release: a moving car within 10 m behind the box holds the release, for at most 0.5 s', () => {
    const near = release(7, true);
    assert.ok(near >= 0.5 - 1e-9 && near <= 0.5 + 1 / 60 + 1e-9, `held ${near.toFixed(3)} s`);
    assert.strictEqual(release(14, true), 0, 'more than 10 m behind: no hold');
    assert.strictEqual(release(7, false), 0, 'stationary car: no hold');
});

test('race finish through the line: one compound +22 s exactly once, two compounds none; the stop is cleared', () => {
    for (const [used, want] of [[['M'], 22], [['M', 'S'], 0]]) {
        const msgs = [], sio = { emit(ev, d) { if (ev === 'chat_msg') msgs.push(d.msg); }, volatile: { emit() {} } };
        const t = Track.load('monza'), g = new Game(sio, [lp('a')], t, { ...RACE, maxLaps: 2, tyreWear: true }, () => {}), p = g.players.a;
        g.frozen = false; p.compoundsUsed = used;
        const cps = t.checkpoints;
        for (let lapN = 0; lapN < 2; lapN++) for (let k = 1; k <= cps.length; k++) {
            if (lapN === 1 && k === cps.length) p.stop = { phase: 'guide', t: 2.7, age: 0 };
            const target = (p.checkpoint + 1) % cps.length;
            g.time = lapN * 90 + (90 * k) / cps.length; p.x = cps[target].x; p.y = cps[target].y;
            g.checkLapProgress(p);
        }
        assert.ok(p.finished);
        for (let k = 0; k < 10; k++) g.update(); // finished cars are left alone
        assert.strictEqual(p.penalty, want, `${used}`);
        assert.strictEqual(msgs.filter((m) => m.includes('one tyre compound')).length, want ? 1 : 0);
        assert.strictEqual(p.stop, null);
        assert.strictEqual(g.fastPacket().c[0][12], 0);
    }
});

test('quali: a fresh set every pit visit; race: one service per lap', () => {
    for (const mode of ['quali', 'race']) {
        const t = Track.load('monza'), g = new Game(io, [lp('a')], t, mode === 'quali' ? { qualiLaps: 2 } : RACE, () => {}, mode), p = g.players.a, sc = t.scale;
        const visit = () => {
            Object.assign(p, { inPit: true, pitS: p.box.s - 8 * sc, vx: 0, vy: 0, input: { throttle: 0, brake: 1, steer: 0 } });
            g.updateStop(p);
            if (!p.stop) return false;
            p.stop = { phase: 'service', t: 1e-6 }; g.updateStop(p); g.updateStop(p);
            return true;
        };
        p.inPit = false; g.updateStop(p);
        assert.ok(visit(), `${mode}: first visit`); assert.strictEqual(p.stops, 1);
        assert.ok(!visit(), `${mode}: same visit, no second service`);
        p.inPit = false; g.updateStop(p); // out on track, then back in (same lap)
        assert.strictEqual(visit(), mode === 'quali', `${mode}: next visit`);
        assert.strictEqual(p.stops, mode === 'quali' ? 2 : 1);
    }
});
