const { test } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const RL = require('../src/game/RacingLine');
const { AIM } = require('../src/game/Assist');

const tracks = Track.loadAll();
const idxAt = (t, s) => t.cum.findIndex((c) => c >= s);

for (const id of Track.TRACK_IDS) {
    test(`${id}: racing line stays on track, within grip and the assist's speeds`, () => {
        const t = tracks[id], rl = t.racingLine, n = t.path.length;
        assert.ok(rl && rl.offset.length === n && rl.speed.length === n && rl.phase.length === n);
        const lim = t.width / 2 - 1.5 * t.scale + 0.06; // + rounding
        rl.offset.forEach((o, i) => assert.ok(Math.abs(o) <= lim, `point ${i} offset ${o} past ${lim}`));
        const k = RL.curvatures(RL.linePoints(t.path, rl.offset), t.scale);
        rl.speed.forEach((v, i) => {
            assert.ok(v * v * k[i] <= RL.latMax(v) * 1.01 + 0.5, `point ${i}: ${v} m/s needs more grip than the car has`);
            assert.ok(v <= t.safeSpeed[i] * AIM + 0.06, `point ${i}: ${v} m/s faster than the braking assist allows`);
        });
        const centre = RL.profile(t.path, t.scale, t.safeSpeed.map((s) => s * AIM));
        const line = RL.profile(RL.linePoints(t.path, rl.offset), t.scale, t.safeSpeed.map((s) => s * AIM));
        assert.ok(line.lap <= centre.lap + 0.05, `line ${line.lap.toFixed(1)} s slower than centreline ${centre.lap.toFixed(1)} s`);
        assert.ok(rl.phase.includes(0) && rl.phase.includes(1) && rl.phase.includes(2), 'flat, lift and brake all present');
    });
}

for (const id of ['monza', 'spa']) {
    test(`${id}: a brake zone before the first slow corner`, () => {
        const t = tracks[id], n = t.path.length, s0 = idxAt(t, t.startS || 0);
        let m = s0;
        for (let k = 0; k < n; k++) {
            const i = (s0 + k) % n;
            if (((t.cum[i] - t.cum[s0] + t.cum[n]) % t.cum[n]) / t.scale > 1000) break;
            if (t.safeSpeed[i] < t.safeSpeed[m]) m = i;
        }
        let braking = false;
        for (let k = 1; k <= n; k++) {
            const i = (m - k + n) % n;
            if (((t.cum[m] - t.cum[i] + t.cum[n]) % t.cum[n]) / t.scale > 250) break;
            if (t.racingLine.phase[i] === 2) braking = true;
        }
        assert.ok(braking, `no brake zone in the 250 m before point ${m}`);
    });
}

test('pit side keeps clear of the closed pit entry', () => {
    for (const id of Track.TRACK_IDS) {
        const t = tracks[id];
        if (!t.pit) continue;
        const { side, idx } = RL.pitWindow(t);
        const lim = t.width / 2 - 3 * t.scale + 0.06;
        for (const i of idx) assert.ok(side * t.racingLine.offset[i] <= lim, `${id} point ${i} too close to the pit entry`);
    }
});

test('a track without pit data still gets a line', () => {
    const t = { ...tracks.monza, pit: null };
    const rl = RL.compute(t);
    assert.strictEqual(rl.offset.length, t.path.length);
});
