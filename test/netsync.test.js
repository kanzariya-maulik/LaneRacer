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

test('sample extrapolates up to 100 ms past the newest snapshot, then holds', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0, 0, 100)]), 0);
    assert.ok(Math.abs(N.sample(b, 0.05, 0).x - 5) < 1e-9);
    assert.ok(Math.abs(N.sample(b, 0.5, 0).x - 10) < 1e-9, 'capped at 100 ms');
});

test('missing car indices and unknown cars are handled', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0), car(2, 5)]), 0);
    b.push(pkt(2, 0.1, [car(2, 15)]), 0.1);  // car 0 left
    assert.ok(Math.abs(N.sample(b, 0.05, 2).x - 10) < 1e-9);
    assert.strictEqual(N.sample(b, 0.05, 7), null);
    assert.ok(N.sample(b, 0.05, 0), 'last known pose kept for a car that left');
});

test('project pushes the own car forward along its heading, capped at 100 ms', () => {
    const e = [0, 0, 0, Math.PI / 2, 60, 0, 0];
    assert.ok(Math.abs(N.project(e, 0.05).y - 3) < 1e-9);
    assert.ok(Math.abs(N.project(e, 1).y - 6) < 1e-9);
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
