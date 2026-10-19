// Rubber on the racing line and skid marks (public/js/rubber.js): subtle, growing with laps, capped
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');

let R, TM;
before(async () => { R = await import('../public/js/rubber.js'); TM = await import('../public/js/trackMesh.js'); });
const t = Track.loadAll().monza;

test('rubberLevel: 0.15 on a fresh track, grows with every lap, close to 1 after a long weekend', () => {
    assert.strictEqual(R.rubberLevel(0), 0.15);
    assert.ok(R.rubberLevel(1000) > 0.99);
    for (let n = 1; n <= 200; n++) assert.ok(R.rubberLevel(n) > R.rubberLevel(n - 1));
});

test('rubberProfile(monza): full weight in the 150 m braking into T1, less down the middle of the straight', () => {
    const P = R.rubberProfile(t), lap = TM.buildTrackGeometry(t).lap;
    assert.strictEqual(P.length, lap.length * 2, '[offset m, weight] per smooth-curve point');
    let braking = 0, straight = 0;
    lap.forEach((m, k) => {
        const w = P[k * 2 + 1];
        if (m > 757 && m < 900) { braking++; assert.strictEqual(w, 1, `weight ${w} at ${m.toFixed(0)} m`); }
        if (m > 250 && m < 350) { straight++; assert.ok(w < 1, `weight ${w} at ${m.toFixed(0)} m`); }
    });
    assert.ok(braking > 10 && straight > 10);
    for (let k = 0; k < lap.length; k++) assert.ok(Math.abs(P[k * 2]) < 15, 'offset within the road');
});

test('SkidLayer: one locked tyre passing darkens 20 % (a streak), never more than 45 % however many', () => {
    const L = new R.SkidLayer(t);
    L.stamp(900, 1.5, 1);
    assert.ok(Math.abs(L.darkness(900, 1.5) - 0.2) < 2e-3);
    for (let k = 0; k < 1000; k++) L.stamp(900, 1.5, 1);
    assert.strictEqual(L.darkness(900, 1.5), 0.45);
    assert.strictEqual(L.darkness(2000, 1.5), 0, 'nothing elsewhere');
    L.clear();
    assert.strictEqual(L.darkness(900, 1.5), 0);
});
