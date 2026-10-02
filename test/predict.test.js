const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');

let P;
before(async () => { P = await import('../public/js/predict.js'); });
const io = { emit() {}, volatile: { emit() {} } };
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Server game + one predicting client over a simulated network (latency ± jitter, loss), 60 s of driving
function run({ latency = 30, jitter = 20, loss = 2, seconds = 60, track = 'monza', bump = null } = {}) {
    const t = Track.load(track), sc = t.scale, rand = rng(42);
    let pkt = null;
    const g = new Game({ emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkt = d; } } },
        [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 99, qualifying: false }, () => {});
    g.frozen = false;
    const pr = new P.Predictor(t);
    const events = [];                  // [time, fn]
    const at = (time, fn) => { if (rand() * 100 >= loss) events.push([time + (latency + (rand() * 2 - 1) * jitter) / 1000, fn]); };
    const serverPos = new Map(), clientPos = new Map();
    let seq = 0, sent = [], maxStep = 0, lastPose = null;
    for (let k = 0; k < seconds * 60; k++) {
        const now = k / 60;
        events.sort((a, b) => a[0] - b[0]);
        while (events.length && events[0][0] <= now) events.shift()[1]();
        // client: sample input (steer at a point ahead on the track), predict, send newest + 5
        if (!pr.car && pkt) pr.reset(pkt.c[0]);
        if (pr.car) {
            const n = Physics.nearestOnTrack(pr.car.x, pr.car.y, t), ah = t.path[(n.i + 3) % t.path.length];
            let d = Math.atan2(ah.y - pr.car.y, ah.x - pr.car.x) - pr.car.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            const input = { seq: ++seq, steer: Math.max(-1, Math.min(1, d * 2)), throttle: Math.abs(d) > 0.25 ? 0.4 : 1, brake: 0, drs: false };
            pr.step(input);
            clientPos.set(seq, [pr.car.x, pr.car.y]);
            sent = [...sent, input].slice(-6);
            const batch = sent.slice();
            at(now, () => g.handleInputs('a', batch));
            const pose = pr.pose(1, {});
            if (lastPose) maxStep = Math.max(maxStep, Math.abs(Math.hypot(pose.x - lastPose.x, pose.y - lastPose.y) - Math.abs(pr.car.speed) / 60));
            lastPose = pose;
        }
        // server tick
        if (bump && k === bump) { g.players.a.x += 2 * sc; }   // a collision the client could not foresee
        g.update();
        const a = g.players.a;
        serverPos.set(a.lastSeq, [a.x, a.y]);
        const snap = JSON.parse(JSON.stringify(pkt));
        at(now, () => pr.onServer(snap.c[0]));
    }
    const errs = [];
    for (const [s, sp] of serverPos) { const cp = clientPos.get(s); if (cp) errs.push(Math.hypot(cp[0] - sp[0], cp[1] - sp[1]) / sc); }
    errs.sort((a, b) => a - b);
    return { p95: errs[Math.floor(errs.length * 0.95)], maxStepM: maxStep / sc, pr, sc };
}

test('prediction tracks the server within 5 cm (p95) over 60 s of 30±20 ms, 2% loss WiFi', () => {
    const r = run();
    assert.ok(r.p95 < 0.05, `p95 ${r.p95.toFixed(3)} m`);
    assert.ok(r.maxStepM < 0.10, `largest per-step correction ${r.maxStepM.toFixed(3)} m`);
});

test('an unforeseen server-side shove blends out instead of snapping, < 1 cm left after 200 ms', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t), sc = t.scale;
    const e = [0, t.path[10].x, t.path[10].y, 0, 0, 0, 0, 0, 0, 0, 3];
    pr.reset(e);
    pr.onServer([0, e[1] + 0.5 * sc, e[2], 0, 0, 0, 0, 0, 0, 0, 3]);         // server says 0.5 m further
    const p0 = pr.pose(1, {});
    assert.ok(Math.abs(p0.x - e[1]) < 1e-6, 'no visible jump at the moment of correction');
    for (let k = 0; k < 12; k++) pr.step({ seq: 4 + k, steer: 0, throttle: 0, brake: 0, drs: false });
    const p1 = pr.pose(1, {});
    assert.ok(Math.abs(p1.x - pr.car.x) < 0.01 * sc, `offset left ${(p1.x - pr.car.x) / sc} m`);
});

test('corrections of 5 m or more snap (teleport, reset)', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t), sc = t.scale;
    pr.reset([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    pr.onServer([0, 10 * sc, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    assert.strictEqual(pr.pose(1, {}).x, 10 * sc);
});

test('finished cars are not predicted; pending inputs are capped after a stall', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t);
    pr.reset([0, t.path[10].x, t.path[10].y, 0, 50, 0, 16, 50, 0, 0, 1]);    // finished flag
    const x0 = pr.car.x;
    pr.step({ seq: 2, steer: 0, throttle: 1, brake: 0, drs: false });
    assert.strictEqual(pr.car.x, x0, 'finished: holds the server pose');
    pr.reset([0, t.path[10].x, t.path[10].y, 0, 0, 0, 0, 0, 0, 0, 1]);
    for (let k = 0; k < 500; k++) pr.step({ seq: 2 + k, steer: 0, throttle: 0, brake: 0, drs: false });
    assert.ok(pr.pending.length <= P.MAX_PENDING);
});

test('a server update older than one already applied (reordered packet) is ignored', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t), sc = t.scale;
    const x0 = t.path[10].x, y0 = t.path[10].y;
    pr.reset([0, x0, y0, 0, 0, 0, 0, 0, 0, 0, 5]);
    pr.onServer([0, x0 + 3 * sc, y0, 0, 0, 0, 0, 0, 0, 0, 9]);
    pr.onServer([0, x0 + 1 * sc, y0, 0, 0, 0, 0, 0, 0, 0, 7]);      // late, older
    assert.strictEqual(pr.car.x, x0 + 3 * sc);
});

test('bad WiFi (60±50 ms, 5% loss): still within 5 cm, no visible correction steps', () => {
    const r = run({ latency: 60, jitter: 50, loss: 5, seconds: 30 });
    assert.ok(r.p95 < 0.05, `p95 ${r.p95.toFixed(3)} m`);
    assert.ok(r.maxStepM < 0.10, `largest per-step correction ${r.maxStepM.toFixed(3)} m`);
});
