const { test, before } = require('node:test');
const assert = require('node:assert');

let N;
before(async () => { N = await import('../public/js/netsync.js'); });
const car = (idx, x, angle = 0, speed = 0) => [idx, x, 0, angle, speed, 0, 0];
const pkt = (s, t, cars) => ({ s, t, c: cars });

test('buffer keeps order and drops duplicates', () => {
    const b = new N.SnapshotBuffer();
    assert.ok(b.push(pkt(2, 0.2, [car(0, 20)]), 10));
    assert.ok(b.push(pkt(1, 0.1, [car(0, 10)]), 10.01), 'late but recent packet is kept, in order');
    assert.ok(!b.push(pkt(2, 0.2, [car(0, 20)]), 10.02), 'duplicate dropped');
    assert.deepStrictEqual(b.snaps.map(x => x.s), [1, 2]);
    assert.strictEqual(b.latest().s, 2);
});

test('a late packet never moves the newest snapshot backwards', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(5, 0.5, [car(0, 50)]), 1);
    b.push(pkt(3, 0.3, [car(0, 30)]), 1.1);
    assert.strictEqual(b.latest().s, 5);
    assert.ok(Math.abs(b.serverNow(1.2) - 0.7) < 1e-9, 'clock follows the newest arrival only');
});

test('sample interpolates between snapshots and takes angles the short way round', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0, 3.1)]), 0);
    b.push(pkt(2, 0.1, [car(0, 10, -3.1)]), 0.1);
    const p = N.sample(b, 0.05, 0);
    assert.ok(Math.abs(p.x - 5) < 1e-9);
    assert.ok(Math.abs(Math.abs(p.angle) - Math.PI) < 0.01, `angle ${p.angle} went the long way`);
});

test('sample extrapolates up to 250 ms past the newest snapshot, then holds', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0, 0, 100)]), 0);
    assert.ok(Math.abs(N.sample(b, 0.05, 0).x - 5) < 1e-9);
    assert.ok(Math.abs(N.sample(b, 0.5, 0).x - 25) < 1e-9, 'capped at 250 ms');
});

test('missing car indices and unknown cars are handled', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0), car(2, 5)]), 0);
    b.push(pkt(2, 0.1, [car(2, 15)]), 0.1);  // car 0 left
    assert.ok(Math.abs(N.sample(b, 0.05, 2).x - 10) < 1e-9);
    assert.strictEqual(N.sample(b, 0.05, 7), null);
    assert.ok(N.sample(b, 0.05, 0), 'last known pose kept for a car that left');
});

test('project pushes the own car forward along its heading, capped at 250 ms', () => {
    const e = [0, 0, 0, Math.PI / 2, 60, 0, 0];
    assert.ok(Math.abs(N.project(e, 0.05).y - 3) < 1e-9);
    assert.ok(Math.abs(N.project(e, 1).y - 15) < 1e-9);
});

test('decodeFlags', () => {
    assert.deepStrictEqual(N.decodeFlags(1 | 4 | 64), { inPit: true, limiter: false, drs: true, drsAvailable: false, finished: false, lapValid: false, ghost: true });
});

test('late in-order arrivals never move a car backwards', () => {
    const b = new N.SnapshotBuffer();
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const v = 80, tick = 1 / 60;
    let pending = [], lastX = -Infinity, backward = 0;
    for (let k = 0; k < 600; k++) {
        const t = k * tick;
        pending.push([t + 0.02 + rand() * 0.05, N.SnapshotBuffer && { s: k + 1, t, c: [car(0, v * t, 0, v)] }]);
        const now = t + 0.5 * tick;
        pending = pending.filter(([at, p]) => (at <= now ? (b.push(p, at), false) : true));
        if (!b.latest()) continue;
        const p = N.sample(b, b.serverNow(now) - N.INTERP_S, 0);
        if (p.x < lastX - 1e-9) backward++;
        lastX = Math.max(lastX, p.x);
    }
    assert.strictEqual(backward, 0, `${backward} frames went backwards`);
});

test('race time holds while the race clock is frozen (countdown), then runs', () => {
    const b = new N.SnapshotBuffer();
    b.push({ s: 1, t: 5.0, g: 0, c: [] }, 10);
    b.push({ s: 2, t: 5.1, g: 0, c: [] }, 10.1);
    assert.strictEqual(b.gameTime(5.3), 0, 'no lap time before lights out');
    b.push({ s: 3, t: 5.2, g: 0.1, c: [] }, 10.2);
    assert.ok(Math.abs(b.gameTime(5.3) - 0.2) < 1e-9, 'running clock is projected forward');
});

test('a packet from an old session (much higher seq) does not block the new one', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(20000, 300, [car(0, 1)]), 1);   // straggler from the finished session
    assert.ok(b.push(pkt(1, 0, [car(0, 5)]), 1.1), 'new session accepted');
    assert.ok(b.push(pkt(2, 1 / 60, [car(0, 6)]), 1.12));
    assert.strictEqual(b.latest().s, 2);
    assert.deepStrictEqual(b.snaps.map((x) => x.s), [1, 2], 'old session dropped');
});

test('adaptive delay: calm network ≈ 35 ms, jittery ≈ 2 ticks + 2×p95, clamped', () => {
    const calm = new N.SnapshotBuffer(), wild = new N.SnapshotBuffer();
    let seed = 3; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
        calm.push(pkt(k + 1, k / 60, [car(0, k)]), 1 + k / 60);
        wild.push(pkt(k + 1, k / 60, [car(0, k)]), 1 + k / 60 + rand() * 0.04);
    }
    assert.ok(Math.abs(calm.targetDelayS() - 0.035) < 0.002, `${calm.targetDelayS()}`);
    const w = wild.targetDelayS();
    assert.ok(w > 0.08 && w <= 0.15, `${w}`);
});

test('render clock eases to the target with ≤5% time dilation, never runs backwards, resyncs after a stall', () => {
    const clock = new N.RenderClock();
    let t = clock.advance(0, 10, 0.05), last = t;
    for (let k = 0; k < 120; k++) {                      // target suddenly 50 ms further back
        t = clock.advance(1 / 60, 10 + (k + 1) / 60, k < 60 ? 0.05 : 0.10);
        assert.ok(t >= last, 'never backwards');
        assert.ok(clock.rate >= 0.95 - 1e-9 && clock.rate <= 1.05 + 1e-9);
        last = t;
    }
    t = clock.advance(1 / 60, 60, 0.05);                 // tab was hidden for ~48 s
    assert.ok(Math.abs(t - (60 - 0.05)) < 1e-9, 'snaps instead of crawling');
});

test('Hermite interpolation passes through snapshots and follows the velocity between them', () => {
    const b = new N.SnapshotBuffer();
    // car on a circle of radius 100: positions and velocities at t=0 and t=0.1 (ω = 1 rad/s, v = 100)
    const at = (t) => [0, 100 * Math.sin(t), 100 - 100 * Math.cos(t), t, 100, 0, 0, 100 * Math.cos(t), 100 * Math.sin(t), 0, 0];
    b.push({ s: 1, t: 0, c: [at(0)] }, 0);
    b.push({ s: 2, t: 0.1, c: [at(0.1)] }, 0.1);
    const mid = N.sample(b, 0.05, 0), truth = at(0.05);
    assert.ok(Math.hypot(mid.x - truth[1], mid.y - truth[2]) < 0.01, 'on the arc, not the chord');
    const end = N.sample(b, 0.1, 0);
    assert.ok(Math.abs(end.x - at(0.1)[1]) < 1e-9);
});

test('dead reckoning follows the arc for 250 ms, then holds; recovery blends instead of popping', () => {
    const b = new N.SnapshotBuffer(), WB = 3.6 * 6;          // wheelbase in world units at scale 6
    const steer = Math.atan(WB / 300);                        // radius 300 world units
    b.push({ s: 1, t: 0, c: [[0, 0, 0, 0, 60, steer, 0, 60, 0, 0, 0]] }, 0);
    const p = N.sample(b, 0.25, 0, {}, {}, 6), w = 60 / 300 * 0.25;
    assert.ok(Math.hypot(p.x - 300 * Math.sin(w), p.y - 300 * (1 - Math.cos(w))) < 0.3, 'on the arc');
    const held = N.sample(b, 0.6, 0, {}, {}, 6);
    assert.ok(Math.abs(held.x - p.x) < 1e-9, 'holds after 250 ms');
    const st = {}, out = {};
    N.sample(b, 0.2, 0, out, st, 6);                          // extrapolating
    const before = { x: out.x, y: out.y };
    b.push({ s: 2, t: 0.1, c: [[0, 5.5, 0, 0, 60, 0, 0, 60, 0, 0, 0]] }, 0.2);   // reality: went straight
    b.push({ s: 3, t: 0.3, c: [[0, 17.5, 0, 0, 60, 0, 0, 60, 0, 0, 0]] }, 0.31);
    const after = N.sample(b, 0.2 + 1 / 60, 0, out, st, 6);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 60 / 60 * 1.5, 'no pop on recovery');
});

test('render clock: a 0.3 s stall (frame dt clamped to 0.1 s) is caught up at once, not crawled back at 5%', () => {
    const clock = new N.RenderClock();
    clock.advance(0, 10, 0.05);
    for (let k = 1; k <= 30; k++) clock.advance(1 / 60, 10 + k / 60, 0.05);
    const t = clock.advance(0.1, 10 + 0.5 + 0.3, 0.05);            // 0.3 s hitch, caller clamps dt
    assert.ok(Math.abs(t - (10.8 - 0.05)) < 0.06, `lag ${(10.75 - t).toFixed(3)} s`);
});

test('samplePresent: other cars drawn where they are now (not 35–150 ms in the past), within a few cm', () => {
    const b = new N.SnapshotBuffer(), out = {}, st = {};
    const v = 80, at = (t) => [0, v * t, 0, 0, v, 0, 0, v, 0, 0, 0];  // straight line, 80 units/s
    let worst = 0;
    for (let k = 0; k < 120; k++) {
        const t = k / 60;
        b.push({ s: k + 1, t, c: [at(t)] }, t + 0.03);            // 30 ms network delay
        const now = t + 0.03 + 0.008;
        const p = N.samplePresent(b, now - 0.03, 0, out, st, 6);   // server time now (clock offset = the 30 ms)
        if (k > 2) worst = Math.max(worst, Math.abs(p.x - v * (now - 0.03)));
    }
    assert.ok(worst < 0.05, `off by ${worst.toFixed(3)} units`);
});

test('samplePresent: a correction (the car braked) fades out over ~100 ms instead of popping; big jumps snap', () => {
    const b = new N.SnapshotBuffer(), out = {}, st = {};
    b.push({ s: 1, t: 0, c: [[0, 0, 0, 0, 60, 0, 0, 60, 0, 0, 0]] }, 0);
    const before = { ...N.samplePresent(b, 0.1, 0, out, st, 6) };   // projected 6 units ahead
    b.push({ s: 2, t: 0.1, c: [[0, 4, 0, 0, 20, 0, 0, 20, 0, 0, 0]] }, 0.1); // really at 4, slowing
    const p1 = { ...N.samplePresent(b, 0.1 + 1 / 60, 0, out, st, 6) };
    assert.ok(Math.abs(p1.x - before.x) < 1.5, `popped ${(p1.x - before.x).toFixed(2)}`);
    const p2 = N.samplePresent(b, 0.1 + 0.15, 0, out, st, 6);
    assert.ok(Math.abs(p2.x - (4 + 20 * 0.15)) < 0.01, 'correction gone after 150 ms');
    b.push({ s: 3, t: 0.25, c: [[0, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0]] }, 0.25); // teleport (reset)
    assert.strictEqual(N.samplePresent(b, 0.26, 0, out, st, 6).x, 500);
});

test('present mode through a RenderClock (target delay 0): even frame steps on jittery WiFi', () => {
    const b = new N.SnapshotBuffer(), clock = new N.RenderClock(), out = {}, st = {};
    let seed = 9; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const v = 80, pend = [];
    let lastX = null, errs = [];
    for (let f = 0; f < 600; f++) {
        const now = f / 60 + 0.004;
        pend.push([f / 60 + 0.03 + (rand() * 2 - 1) * 0.02, { s: f + 1, t: f / 60, c: [[0, v * f / 60, 0, 0, v, 0, 0, v, 0, 0, 0]] }]);
        for (let i = pend.length - 1; i >= 0; i--) if (pend[i][0] <= now) { b.push(pend[i][1], pend[i][0]); pend.splice(i, 1); }
        if (!b.latest()) continue;
        const t = clock.advance(1 / 60, b.serverNow(now), 0);
        const p = N.samplePresent(b, t, 0, out, st, 6);
        if (lastX !== null && f > 120) errs.push(Math.abs(p.x - lastX - v / 60) / (v / 60));
        lastX = p.x;
    }
    errs.sort((a, c) => a - c);
    assert.ok(errs[Math.floor(errs.length * 0.95)] < 0.05, `p95 step error ${(errs[Math.floor(errs.length * 0.95)] * 100).toFixed(1)}%`);
});
