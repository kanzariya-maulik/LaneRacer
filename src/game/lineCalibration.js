// Corner limits as the car really holds them. The racing line's speeds come from a grip model that's conservative (the car
// holds 8-16 % more speed through most corners, measured), so bots aimed at it lapped 1.5-3 s slower than a good driver.
// Here a car follows the line at its speeds, faster corner by corner, until it runs off or hits a wall: each corner keeps
// the fastest clean speed, less a safety margin. Run offline (scripts/calibrate-lines.mjs); tracks load the result (Track.js).
const Track = require('./Track');
const RacingLine = require('./RacingLine');
const { driveLap } = require('./lineFollower');

const STEP = 0.02, MAX_SCALE = 1.25, MARGIN = 0.015, PAD = 2, ATTRIBUTE_PTS = 20, VERIFY_TRIES = 6;
const MERGE_M = 150; // corners closer than this are one complex (a chicane): the entry's speed decides whether the exit holds

// Corners: runs of the line's braking/corner phases, padded, and merged when less than MERGE_M apart; a failure is pinned
// to the corner it happened in, or the last one before it (running wide shows on the exit)
function corners(phase, gapM = () => Infinity) {
    const n = phase.length, out = [];
    let i0 = phase.findIndex((ph) => ph === 0); // start on a straight so no corner wraps the index origin
    if (i0 < 0) i0 = 0;
    for (let k = 0; k < n; k++) {
        const i = (i0 + k) % n;
        if (phase[i] === 0) continue;
        const last = out.at(-1);
        if (last && ((last.to + 1) % n === i || gapM(last.to, i) < MERGE_M)) last.to = i; else out.push({ from: i, to: i });
    }
    return out.map((c) => ({ from: (c.from - PAD + n) % n, to: (c.to + PAD) % n }));
}
const inside = (c, i, n) => (c.from <= c.to ? i >= c.from && i <= c.to : i >= c.from || i <= c.to);
function cornerOf(list, i, n) {
    for (let d = 0; d <= ATTRIBUTE_PTS; d++) {
        const j = (i - d + n) % n, c = list.findIndex((x) => inside(x, j, n));
        if (c >= 0) return c;
    }
    return -1;
}

// A flying lap of the exact line follower (lineFollower.js) on the line built with these scales: the corners where it left
// the asphalt or hit a wall. The follower drives the published speeds as they are, so a clean lap means a player (or a
// bot) who brakes where the line says makes the corner
function failures(t, list, scale, steerHelp) {
    const n = t.path.length, { limit, ...line } = RacingLine.compute(t, scale);
    t.racingLine = line; t.lineLimit = limit;
    const bad = new Set();
    const r = driveLap(t, steerHelp ? '100,0' : '0,0', { aim: 1, onFail: (i) => bad.add(cornerOf(list, i, n)) });
    if (!r.finished) bad.add(-2); // never finished: every corner suspect (doesn't happen on a clean scale)
    bad.delete(-1);
    return bad;
}

function calibrate(trackId, { steerHelp = 1 } = {}) {
    const t = Track.load(trackId, null), n = t.path.length;
    const total = t.cum[n], gapM = (a, b) => ((((t.cum[b] - t.cum[a]) % total) + total) % total) / t.scale;
    const list = corners(t.racingLine.phase, gapM), level = list.map(() => 1), frozen = list.map(() => false);
    const scaleOf = (lv) => { const s = new Array(n).fill(1); list.forEach((c, k) => { for (let i = c.from; ; i = (i + 1) % n) { s[i] = lv[k]; if (i === c.to) break; } }); return s; };
    // Raise every corner still clean by one step a round; a corner that fails goes back to its last clean value for good
    while (frozen.some((f) => !f)) {
        const trial = level.map((v, k) => (frozen[k] ? v : Math.min(MAX_SCALE, +(v + STEP).toFixed(3))));
        const bad = failures(t, list, scaleOf(trial), steerHelp);
        const all = bad.has(-2); // no lap at all: nothing in this round counts as clean
        trial.forEach((v, k) => { if (frozen[k]) return; if (all || bad.has(k) || v >= MAX_SCALE) frozen[k] = true; if (!all && !bad.has(k)) level[k] = v; });
    }
    // The margin, then laps until clean (corners interact: a faster exit is a faster entry to the next one)
    const final = level.map((v) => +(v * (1 - MARGIN)).toFixed(3));
    for (let tries = 0; tries < VERIFY_TRIES; tries++) {
        const bad = failures(t, list, scaleOf(final), steerHelp);
        if (!bad.size) break;
        for (const k of (bad.has(-2) ? final.keys() : bad)) if (k >= 0) final[k] = +Math.max(0.95, final[k] - STEP).toFixed(3);
    }
    return scaleOf(final);
}

module.exports = { calibrate, corners };
