const { test } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const RL = require('../src/game/RacingLine');
const { MAX_SAFE } = require('../src/game/Assist');

const tracks = Track.loadAll();
const idxAt = (t, s) => t.cum.findIndex((c) => c >= s);

for (const id of Track.TRACK_IDS) {
    test(`${id}: racing line stays on track and within grip`, () => {
        const t = tracks[id], rl = t.racingLine, n = t.path.length;
        assert.ok(rl && rl.offset.length === n && rl.speed.length === n && rl.phase.length === n);
        const m = 1.5 * t.scale - 0.06; // inside the real white lines, + rounding (offset + = driver's right)
        rl.offset.forEach((o, i) => assert.ok(o <= t.edgeR[i] - m && o >= -(t.edgeL[i] - m), `point ${i} offset ${o} past the white line`));
        const k = RL.curvatures(RL.linePoints(t.path, rl.offset), t.scale);
        rl.speed.forEach((v, i) => {
            assert.ok(v * v * k[i] <= RL.latMax(v) * 1.01 + 0.5, `point ${i}: ${v} m/s needs more grip than the car has`);
            assert.ok(v <= t.lineLimit[i] + 0.06, `point ${i}: ${v} m/s faster than the line's corner limit`);
        });
        const centre = RL.profile(t.path, t.scale, t.safeSpeed);
        const line = RL.profile(RL.linePoints(t.path, rl.offset), t.scale, t.lineLimit);
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

test('a track without pit data still gets a line', () => {
    const t = { ...tracks.monza, pit: null };
    const rl = RL.compute(t);
    assert.strictEqual(rl.offset.length, t.path.length);
});

const { driveLap } = require('./helpers/lineBot');

for (const id of Track.TRACK_IDS) {
    // A bot driving the line at its speeds (flying lap, steering help on, braking itself) gets close to the profile's lap.
    // It is not an ideal driver (pure pursuit, speed corrected a moment late), hence the 10 % allowance.
    test(`${id}: a car following the line at its speeds laps cleanly (steering help on, braking its own)`, () => {
        const t = tracks[id];
        const lap = RL.profile(RL.linePoints(t.path, t.racingLine.offset), t.scale, t.lineLimit).lap;
        const r = driveLap(t, '100,0', { driver: 'limit', aim: 1 });
        assert.ok(r.finished, `${id}: no lap`);
        assert.strictEqual(r.walls, 0, `${id}: ${r.walls} wall hits`);
        assert.strictEqual(r.off, 0, `${id}: off the road for ${r.off} ticks`);
        assert.ok(r.time <= lap * 1.1, `${id}: ${r.time.toFixed(1)} s vs profile ${lap.toFixed(1)} s`);
    });
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: flat out at the speed cap on a straight is green, not lift`, () => {
        const t = tracks[id], rl = t.racingLine, n = rl.speed.length;
        const wrong = rl.speed.map((v, i) => (t.lineLimit[i] >= MAX_SAFE - 0.1 && rl.speed[(i + 1) % n] >= v && rl.phase[i] !== 0 ? i : -1)).filter((i) => i >= 0);
        assert.deepStrictEqual(wrong, [], `${wrong.length} straight points marked lift/brake`);
    });
}
