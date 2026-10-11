// test/pitstop.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
const Game = require('../src/game/Game');
const Tyres = require('../public/js/sim/tyres.js');
const io = { emit() {}, volatile: { emit() {} } };
const lp = (id, teamId = 'redbull', extra = {}) => ({ id, username: id, teamId, assist: 'full', ...extra });
const RACE = { maxLaps: 3, qualifying: false, rng: () => 0.5 };
const QUALI = { qualiLaps: 2 };

const pitPoint = (t, s) => Track.pointAt(t.pit.path, t.pit.cum, s, false);
function start(t, players, settings = RACE) {
    const g = new Game(io, players, t, settings, () => {});
    g.frozen = false;
    return g;
}

// From just inside the pit mouth at racing speed, no driver input: the game does the rest
function enterPit(t, g, p, speedMs = 60, atM = 5) {
    const q = pitPoint(t, atM * t.scale), v = speedMs * t.scale;
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v });
    p.input = { throttle: 0, brake: 0, steer: 0, drs: false };
}
function runStop(t, g, p, onTick = () => {}) {
    const phases = [], sc = t.scale;
    let still = 0, k = 0;
    for (; k < 60 * 120; k++) {
        onTick(k);
        g.update();
        const ph = p.stop?.phase || null;
        if (phases[phases.length - 1] !== ph) phases.push(ph);
        if (ph === 'service') still++;
        if (ph === null && phases.includes('out')) break;
    }
    return { phases, still: still / 60, ticks: k };
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: pit assist — entry to the limiter end with no driver input: parked, serviced, handed back`, () => {
        const t = Track.load(id), sc = t.scale, g = start(t, [lp('a', 'ferrari')]), p = g.players.a;
        g.setNextCompound('a', 'H');
        enterPit(t, g, p);
        let parked = null;
        const r = runStop(t, g, p, () => { if (p.stop?.phase === 'service' && !parked) parked = Math.hypot(p.x - p.box.x, p.y - p.box.y); });
        assert.deepStrictEqual(r.phases.filter((x) => x), ['lane', 'guide', 'service', 'hold', 'out']);
        assert.ok(parked !== null && parked < 0.6 * sc, `parked ${(parked / sc).toFixed(2)} m off the mark`);
        assert.ok(r.still >= 2.5 && r.still <= 2.95, `${r.still.toFixed(2)} s stationary`);
        assert.strictEqual(p.compound, 'H');
        assert.strictEqual(p.stops, 1);
        assert.ok(p.pitS >= t.pit.limEnd - 1 * sc && p.inPit, 'handed back at the limiter end, in the lane');
        assert.ok(p.lastStop && p.lastStop.release === 'auto' && p.lastStop.s >= 3.0 && p.lastStop.s <= 3.5, JSON.stringify(p.lastStop));
    });
}

test('pit assist: the same circuit, the same pit-lane time (fair)', () => {
    const t = Track.load('spa'), times = [];
    for (let n = 0; n < 3; n++) {
        const g = start(t, [lp('a', 'ferrari')], { ...RACE, rng: () => 0 }), p = g.players.a;
        enterPit(t, g, p, 50 + n * 10);
        times.push(runStop(t, g, p).ticks / 60);
    }
    assert.ok(Math.max(...times) - Math.min(...times) <= 0.5, times.join(', '));
});

test('drive-through: a car that has already stopped this lap is driven straight through', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    p.servicedLap = p.lap;
    enterPit(t, g, p);
    const r = runStop(t, g, p);
    assert.deepStrictEqual(r.phases.filter((x) => x), ['out']);
    assert.strictEqual(p.stops, 0);
});

test('release: a fresh press within 0.2 s of green is perfect, none (or held all along) is auto at 0.5 s, jumped +0.5 s', () => {
    const t = Track.load('monza');
    const go = (pressAt) => {
        const msgs = [], metas = [], sio = { emit(ev, d) { if (ev === 'chat_msg') msgs.push(d.msg); if (ev === 'game_meta' && d.a?.lastStop) metas.push(d.a.lastStop); }, volatile: { emit() {} } };
        const g = new Game(sio, [lp('a')], t, RACE, () => {}), p = g.players.a;
        g.frozen = false;
        enterPit(t, g, p);
        let greenAt = null, outAt = null, clock = 0;
        runStop(t, g, p, () => {
            clock += g.dt;
            if (p.stop?.phase === 'hold' && greenAt === null) greenAt = clock;
            if (p.stop?.phase === 'out' && outAt === null) outAt = clock;
            const svc = p.stop?.phase === 'service';
            p.input = { throttle: pressAt === 'held' ? 1 : pressAt === 'early' ? (svc && p.stop.t < 0.8 ? 1 : 0) : greenAt !== null && clock - greenAt >= pressAt ? 1 : 0, brake: 0, steer: 0, drs: false };
        });
        return { wait: outAt - greenAt, release: p.lastStop.release, p, msgs, metas };
    };
    const perfect = go(0.1), auto = go(Infinity), jumped = go('early'), held = go('held');
    assert.strictEqual(held.release, 'auto', 'throttle held the whole stop'); assert.ok(Math.abs(held.wait - 0.5) <= 2 / 60, `held left after ${held.wait}`);
    // The stop time reaches the HUD (meta) and the chat
    const { p, msgs, metas } = perfect;
    assert.deepStrictEqual(metas, [{ s: p.lastStop.s, release: 'perfect', n: 1 }]); // n: the banner's key, even if two stops tie
    assert.ok(p.lastStop.s > 2.5 && p.lastStop.s < 3.2, `${p.lastStop.s}`);
    assert.deepStrictEqual(msgs.filter((m) => m.startsWith('PIT:')), [`PIT: a ${p.lastStop.s.toFixed(2)} s (perfect release)`]);
    assert.strictEqual(perfect.release, 'perfect'); assert.ok(perfect.wait <= 0.15, `perfect left after ${perfect.wait}`);
    assert.strictEqual(auto.release, 'auto'); assert.ok(Math.abs(auto.wait - 0.5) <= 2 / 60, `auto left after ${auto.wait}`);
    assert.strictEqual(jumped.release, 'jumped'); assert.ok(jumped.wait >= 0.5 - 1 / 60, `jumped left after ${jumped.wait}`);
});

test('quali: starts waiting on its mark; stays until throttle; then driven out', () => {
    const t = Track.load('monaco'), g = new Game(io, [lp('a')], t, QUALI, () => {}, 'quali'), p = g.players.a;
    assert.strictEqual(p.stop?.phase, 'wait');
    p.input = { throttle: 0, brake: 0, steer: 0, drs: false };
    for (let k = 0; k < 180; k++) g.update();
    assert.strictEqual(p.stop?.phase, 'wait');
    assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.01 * t.scale);
    p.input = { throttle: 1, brake: 0, steer: 0, drs: false };
    const r = runStop(t, g, p);
    assert.deepStrictEqual(r.phases.filter((x) => x), ['out']); // the first tick with throttle leaves 'wait'
    assert.ok(p.pitS >= t.pit.limEnd - 1 * t.scale);
});

test('guide timeout: an unreachable mark falls back to the drive out, no service', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    enterPit(t, g, p);
    const r = runStop(t, g, p, () => { if (p.stop?.phase === 'guide' && !p.box.moved) { p.box = { ...p.box, x: p.box.x + 40 * t.scale, moved: true }; } });
    assert.ok(r.phases.includes('guide') && !r.phases.includes('service') && r.phases.includes('out'), r.phases.join(','));
    assert.strictEqual(p.stops, 0);
});

test('safety net: a lane car shoved out of the lane is handed back after 1 s; a wedged one after 5 s; a guided one shoved off after 1 s', () => {
    const t = Track.load('monza'), sc = t.scale;
    { // shoved 15 m sideways off the lane, at rest
        const g = start(t, [lp('a')]), p = g.players.a;
        enterPit(t, g, p, 30);
        for (let k = 0; k < 60 && p.stop?.phase !== 'lane'; k++) g.update();
        assert.strictEqual(p.stop?.phase, 'lane');
        const n = -Math.sin(p.angle), m = Math.cos(p.angle), q = pitPoint(t, p.pitS);
        const side = Physics.nearestOnTrack(q.x + n * 15 * sc, q.y + m * 15 * sc, t).dist < Physics.nearestOnTrack(q.x - n * 15 * sc, q.y - m * 15 * sc, t).dist ? 1 : -1;
        Object.assign(p, { x: q.x + side * n * 15 * sc, y: q.y + side * m * 15 * sc, vx: 0, vy: 0, speed: 0 });
        let k = 0;
        for (; k < 120 && p.stop; k++) g.update();
        assert.strictEqual(p.stop, null, `still ${p.stop?.phase}, inPit ${p.inPit}`);
        assert.ok(k / 60 <= 1.2, `handed back after ${(k / 60).toFixed(2)} s`);
    }
    { // pinned in place in the lane: never reaches its box. No progress for 5 s: the driver gets it back
        const g = start(t, [lp('a')]), p = g.players.a;
        enterPit(t, g, p, 30, 20);
        const pin = { x: p.x, y: p.y, angle: p.angle };
        let k = 0;
        for (; k < 60 * 62 && p.stop?.phase !== 'out'; k++) { Object.assign(p, pin, { vx: 0, vy: 0, speed: 0 }); if (k && !p.stop) break; g.update(); }
        assert.strictEqual(p.stop, null, `still ${p.stop?.phase}`);
        assert.ok(k / 60 >= 5 && k / 60 <= 5.2, `handed back after ${(k / 60).toFixed(2)} s`);
        assert.strictEqual(p.stops, 0);
    }
    { // guided toward the box, then shoved 15 m off the lane: handed back after 1 s, not driven back 6 s
        const g = start(t, [lp('a')]), p = g.players.a;
        enterPit(t, g, p, 30);
        for (let k = 0; k < 60 * 30 && p.stop?.phase !== 'guide'; k++) g.update();
        assert.strictEqual(p.stop?.phase, 'guide');
        const n = -Math.sin(p.box.angle), m = Math.cos(p.box.angle), q = pitPoint(t, p.box.s);
        const side = Physics.nearestOnTrack(q.x + n * 15 * sc, q.y + m * 15 * sc, t).dist < Physics.nearestOnTrack(q.x - n * 15 * sc, q.y - m * 15 * sc, t).dist ? 1 : -1;
        Object.assign(p, { x: q.x + side * n * 15 * sc, y: q.y + side * m * 15 * sc, vx: 0, vy: 0, speed: 0 });
        let k = 0;
        for (; k < 120 && p.stop; k++) { Object.assign(p, { vx: 0, vy: 0, speed: 0 }); g.update(); }
        assert.strictEqual(p.stop, null, `still ${p.stop?.phase}`);
        assert.ok(k / 60 <= 1.2, `handed back after ${(k / 60).toFixed(2)} s`);
    }
});

test('watchdog: parked cars (service, hold, wait) are never released for standing still', () => {
    const t = Track.load('monza');
    for (const [phase, mode] of [['service', 'race'], ['hold', 'race'], ['wait', 'quali']]) {
        const g = mode === 'quali' ? new Game(io, [lp('a')], t, QUALI, () => {}, 'quali') : start(t, [lp('a')]), p = g.players.a;
        Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle, vx: 0, vy: 0, speed: 0, input: { throttle: 0, brake: 0, steer: 0 } });
        if (phase !== 'wait') p.stop = { phase, t: 99, age: 0, parkedAt: g.clock, greenAt: g.clock + 99, jumped: false, unsafe: 0 };
        for (let k = 0; k < 60 * 7; k++) g.update();
        assert.strictEqual(p.stop?.phase, phase);
    }
});

test('two cars stopping at neighbouring boxes are both serviced and released', () => {
    const t = Track.load('monza'), g = start(t, [lp('a', 'ferrari'), lp('b', 'ferrari')]), a = g.players.a, b = g.players.b;
    enterPit(t, g, a, 60, 25); enterPit(t, g, b, 60, 5); // b 20 m behind a
    for (let k = 0; k < 60 * 120 && !(a.stops && b.stops && !a.stop && !b.stop); k++) g.update();
    assert.strictEqual(a.stops, 1); assert.strictEqual(b.stops, 1);
});

test('team-mates get different boxes', () => {
    const t = Track.load('monza'), g = start(t, [lp('a', 'mclaren'), lp('b', 'mclaren')]);
    assert.ok(Math.hypot(g.players.a.box.x - g.players.b.box.x, g.players.a.box.y - g.players.b.box.y) > 5 * t.scale);
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
    for (const [phase, code] of [['guide', 1], ['service', 2], ['hold', 3], ['lane', 4], ['out', 5], ['wait', 6]]) {
        p.stop = { phase, t: 0, age: 0 };
        const c = g.fastPacket().c.find((x) => x[0] === g.index.a);
        assert.strictEqual(c[12], code, phase);
        pr.load(c);
        assert.strictEqual(pr.car.stop.phase, phase);
    }
});

test('quali cars sitting in their boxes at the start wait there, not serviced', () => {
    for (const id of ['monaco', 'imola']) { // their boxes land a hair (1e-12 m) short of the car's lane position
        const t = Track.load(id), g = new Game(io, [lp('a', 'ferrari'), lp('b', 'ferrari'), lp('c', 'haas'), lp('d', 'haas')], t, { qualiLaps: 2 }, () => {}, 'quali');
        for (let k = 0; k < 120; k++) g.update();
        for (const p of Object.values(g.players)) { assert.strictEqual(p.stop?.phase, 'wait', `${id} ${p.id}`); assert.strictEqual(p.stops, 0); }
    }
});

// The car `along` m past (< 0: short of) its box and `out` m toward the lane centre, rolling at `v` m/s, being guided
function nearBox(id, along, out, v = 0) {
    const t = Track.load(id), g = start(t, [lp('a', 'ferrari')]), p = g.players.a, b = p.box, sc = t.scale;
    const c = pitPoint(t, b.s), ux = -Math.sin(b.angle), uy = Math.cos(b.angle), side = Math.sign((c.x - b.x) * ux + (c.y - b.y) * uy) || 1;
    const hx = Math.cos(b.angle), hy = Math.sin(b.angle);
    Object.assign(p, { x: b.x + (hx * along + side * ux * out) * sc, y: b.y + (hy * along + side * uy * out) * sc, angle: b.angle,
        vx: hx * v * sc, vy: hy * v * sc, speed: v * sc, stop: { phase: 'guide', t: 2.7, age: 0 } });
    g.updatePit(p);
    return { t, g, p };
}

test('at rest or crawling near the box (level with it 2.4 m out included): parked on the mark within 3 s', () => {
    // [m past the box, m out into the lane, m/s]. Not every spot within 3 m makes 3 s: see the task-6 report's grid
    const spots = [[0, 1, 0], [0, 1.5, 0], [0, 2.4, 0], [0, 2.4, -1.5], [-1, 2.4, 0], [1, 1.5, 0], [1, 1.5, 1.5],
        [-3, 0, 0], [-2, 0, 1.5], [2, 0, 0], [3, 0, -1.5], [-2, 0.5, 0], [2, 0.5, 1.5], [1, -1, 0], [-1, -1, -1.5], [0, 0.5, 1.5]];
    for (const id of ['monza', 'spa', 'monaco', 'zandvoort', 'buddh']) for (const [along, out, v] of spots) {
        const { t, g, p } = nearBox(id, along, out, v);
        let k = 0;
        for (; k < 60 * 6 && p.stop?.phase === 'guide'; k++) g.update();
        const at = `${id} ${along} m past, ${out} m out, ${v} m/s`;
        assert.strictEqual(p.stop?.phase, 'service', at);
        assert.ok(k / 60 <= 3, `${at}: ${(k / 60).toFixed(2)} s`);
        assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.5 * t.scale, at);
    }
});

// Car a finishing its service at the box while car b sits/moves in the lane `behind` m before the box. Returns how much
// longer than the 0.5 s auto release a sat in 'hold' (no throttle from a)
function release(behind, moving) {
    const t = Track.load('monza'), g = start(t, [lp('a', 'ferrari'), lp('b', 'haas')]), a = g.players.a, b = g.players.b, sc = t.scale;
    Object.assign(a, { x: a.box.x, y: a.box.y, angle: a.box.angle, vx: 0, vy: 0, speed: 0, stop: { phase: 'service', t: 1e-6, age: 0, parkedAt: g.clock } });
    const q = pitPoint(t, a.box.s - behind * sc), v = moving ? 2 * sc : 0;
    Object.assign(b, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v, servicedLap: b.lap });
    b.box = null; // no box: pit assist off (this test drives the lane itself)
    g.updatePit(a); g.updatePit(b);
    let held = 0;
    for (let k = 0; k < 120 && a.stop?.phase !== 'out'; k++) {
        b.input = { throttle: moving ? 0.02 : 0, brake: 0, steer: 0 }; // not the brake: held at a standstill it backs the car up
        g.update();
        if (a.stop?.phase === 'hold') held++;
    }
    assert.strictEqual(a.stops, 1); assert.ok(!a.stop || a.stop.phase === 'out');
    return held / 60 - 0.5;
}

test('unsafe release: a moving car within 10 m behind the box holds the release, for at most 0.5 s', () => {
    const near = release(7, true);
    assert.ok(near >= 0.5 - 1e-9 && near <= 0.5 + 1 / 60 + 1e-9, `held ${near.toFixed(3)} s`);
    // No hold: the 0.5 s auto release only, give or take the tick the session clock's float sum lands on
    for (const [behind, moving, why] of [[14, true, 'more than 10 m behind'], [7, false, 'stationary car']]) {
        const extra = release(behind, moving);
        assert.ok(Math.abs(extra) <= 1 / 60 + 1e-9, `${why}: held ${extra.toFixed(3)} s extra`);
    }
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
        // In the lane: a due car is taken to its box ('lane'), otherwise driven through ('out') or left alone (same visit)
        const visit = () => {
            Object.assign(p, { inPit: true, pitS: 5 * sc, vx: 0, vy: 0, input: { throttle: 0, brake: 0, steer: 0 } });
            g.updateStop(p);
            if (p.stop?.phase !== 'lane') { p.stop = null; return false; }
            p.stop = { phase: 'service', t: 1e-6, age: 0, parkedAt: g.clock }; g.updateStop(p);
            assert.strictEqual(p.stop.phase, mode === 'quali' ? 'wait' : 'hold', `${mode}: after the service`); // quali: back to waiting on the mark
            p.stop = null;
            return true;
        };
        p.stop = null; p.inPit = false; g.updateStop(p);
        assert.ok(visit(), `${mode}: first visit`); assert.strictEqual(p.stops, 1);
        assert.ok(!visit(), `${mode}: same visit, no second service`);
        p.inPit = false; g.updateStop(p); // out on track, then back in (same lap)
        assert.strictEqual(visit(), mode === 'quali', `${mode}: next visit`);
        assert.strictEqual(p.stops, mode === 'quali' ? 2 : 1);
    }
});

test('grid: a tyre pick before lights out fits a fresh set and replaces the start set', () => {
    const t = Track.load('monza'), g = new Game(io, [lp('a')], t, RACE, () => {});
    const p = g.players.a;
    assert.ok(g.frozen, 'race starts frozen');
    p.wear = 0.3;
    g.setNextCompound('a', 'S');
    assert.strictEqual(p.compound, 'S');
    assert.strictEqual(p.wear, 0);
    assert.strictEqual(p.nextCompound, null);
    assert.deepStrictEqual(p.compoundsUsed, ['S']);
    assert.strictEqual(p.tyreGrip, Tyres.gripOf('S', 0));
    assert.strictEqual(p.wearPerM, Game.tyreWearPerM(g.settings, t, 'S'));
});

test('race under way: a pick only sets the next stop\'s set', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), RACE, () => {});
    g.frozen = false;
    g.setNextCompound('a', 'H');
    assert.strictEqual(g.players.a.compound, 'M');
    assert.strictEqual(g.players.a.nextCompound, 'H');
});

test('quali parked in the box: a pick fits now and adds to the compounds used', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), QUALI, () => {}, 'quali');
    const p = g.players.a;
    assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 1, 'quali car starts on its box');
    g.setNextCompound('a', 'S');
    assert.strictEqual(p.compound, 'S');
    assert.deepStrictEqual(p.compoundsUsed.sort(), ['M', 'S']);
});

test('quali: moving, mid-stop, or stopped off the mark → next set only', () => {
    const t = Track.load('monza'), sc = t.scale;
    for (const set of [
        (p) => { p.stop = { phase: 'out', t: 0, age: 0 }; p.vx = 5 * sc; }, // driving away
        (p) => { p.stop = { phase: 'service', t: 2 }; },            // a stop in progress
        (p) => { p.stop = null; p.x += Math.cos(p.angle) * 4 * sc; p.y += Math.sin(p.angle) * 4 * sc; }, // driving, 4 m off the mark
    ]) {
        const g = new Game(io, [lp('a')], t, QUALI, () => {}, 'quali');
        const p = g.players.a;
        set(p);
        g.setNextCompound('a', 'H');
        assert.strictEqual(p.compound, 'M');
        assert.strictEqual(p.nextCompound, 'H');
    }
});

test('tyre picks: unknown driver or compound are ignored', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), RACE, () => {});
    assert.doesNotThrow(() => g.setNextCompound('ghost', 'S'));
    g.setNextCompound('a', 'X');
    assert.strictEqual(g.players.a.compound, 'M');
    assert.strictEqual(g.players.a.nextCompound, null);
});

test('grid change to softs, then no stop: still a one-compound finisher (+22 s)', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), RACE, () => {});
    g.setNextCompound('a', 'S');
    g.finishCar(g.players.a);
    assert.strictEqual(g.players.a.penalty, 22);
});

// Enters the lane at `atM` m along it, flat out on the lane line (the driver's own car: no assist yet)
function driveAlong(t, g, p, atM, ticks) {
    const D = require('../public/js/sim/drive.js'), q = pitPoint(t, atM * t.scale), v = 40 * t.scale, grabs = [];
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v });
    for (let k = 0; k < ticks; k++) {
        if (!p.stop) p.input = { ...D.pitAssist({ ...p, stop: null }, t), throttle: 1 };
        const had = p.stop;
        g.update();
        if (p.stop && !had) grabs.push(`${p.stop.phase} at ${(p.pitS / t.scale).toFixed(0)} m`);
    }
    return grabs;
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: a car entering the lane at the exit end is never taken over; nor is a car just handed back`, () => {
        const t = Track.load(id), pit = t.pit, sc = t.scale;
        for (const g of [start(t, [lp('a', 'ferrari')]), new Game(io, [lp('a', 'ferrari')], t, QUALI, () => {}, 'quali')]) {
            const p = g.players.a;
            p.stop = null; g.frozen = false;
            const visits = p.pitVisits;
            for (const atM of [(pit.limEnd + pit.len) / 2 / sc, (p.box.s + pit.limEnd) / 2 / sc]) {
                Object.assign(p, { inPit: false, wasInPit: false });
                assert.deepStrictEqual(driveAlong(t, g, p, atM, 60 * 3), [], `${g.mode}: entered at ${atM.toFixed(0)} m`);
            }
            assert.strictEqual(p.pitVisits, visits, `${g.mode}: a stray entry counted as a pit visit`);
        }
        // Handed back at the limiter end (inPit may flicker at the exit tip), then flat out along the lane line
        const g = start(t, [lp('a', 'ferrari')]), p = g.players.a;
        Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle, vx: 0, vy: 0, speed: 0, stop: { phase: 'out', t: 0, age: 0 }, inPit: true, wasInPit: true });
        p.input = { throttle: 0, brake: 0, steer: 0, drs: false };
        for (let k = 0; k < 60 * 60 && p.stop; k++) g.update();
        assert.strictEqual(p.stop, null);
        assert.deepStrictEqual(driveAlong(t, g, p, p.pitS / sc, 60 * 5), [], 'grabbed again after the hand-back');
    });
}

test('one stop per lap: boxes before and past the start line both get a service on consecutive laps', () => {
    const t = Track.load('monza');
    for (const team of ['redbull', 'alfaromeo']) { // Monza: redbull's box is before the line, alfaromeo's past it
        const g = start(t, [lp('a', team)], { ...RACE, maxLaps: 5 }), p = g.players.a;
        p.lap = 1;
        for (let n = 1; n <= 2; n++) {
            const lap = p.lap;
            Object.assign(p, { checkpoint: t.checkpoints.length - 1, inPit: false, wasInPit: false, stop: null });
            enterPit(t, g, p, 30);
            runStop(t, g, p);
            assert.strictEqual(p.stops, n, `${team}: stop ${n} (entered on lap ${lap}, now lap ${p.lap})`);
        }
    }
});

test('hold: the remaining hold is in stop.t (HUD: HOLD), 0 once the driver may go', () => {
    const t = Track.load('monza'), g = start(t, [lp('a', 'ferrari'), lp('b', 'haas')]), a = g.players.a, b = g.players.b, sc = t.scale;
    b.box = null; b.input = { throttle: 0, brake: 0, steer: 0 };
    Object.assign(a, { x: a.box.x, y: a.box.y, angle: a.box.angle, vx: 0, vy: 0, speed: 0, input: { throttle: 0, brake: 0, steer: 0 } });
    // jumped the release: held 0.5 s
    a.stop = { phase: 'hold', t: 0, age: 0, parkedAt: g.clock, greenAt: g.clock, jumped: true, unsafe: 0 };
    g.updateStop(a);
    assert.ok(a.stop.t > 0.4 && a.stop.t <= 0.5, `${a.stop.t}`);
    assert.ok(g.fastPacket().c.find((c) => c[0] === g.index.a)[13] > 0);
    for (let k = 0; k < 31; k++) g.update();
    assert.strictEqual(a.stop.phase, 'hold'); assert.strictEqual(a.stop.t, 0);
    // unsafe release: a moving car just behind the box
    const q = pitPoint(t, a.box.s - 7 * sc);
    Object.assign(b, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * 2 * sc, vy: Math.sin(q.angle) * 2 * sc, speed: 2 * sc });
    g.updatePit(b);
    a.stop = { phase: 'hold', t: 0, age: 0, parkedAt: g.clock, greenAt: g.clock, jumped: false, unsafe: 0 };
    g.updateStop(a);
    assert.ok(a.stop.t > 0.4, `${a.stop.t}`);
});
