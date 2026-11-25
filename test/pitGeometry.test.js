// The pit lane as built (Track.js buildPit): it leaves and rejoins the real road edge, tangent to it, and bends no
// tighter than a 30 m radius; the limiter stays the length it was
const { test } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

const tracks = Track.loadAll();
// limiter lengths (m) before the lane was rebuilt against the real road
const LIMITER_M = { monza: 617, spa: 597, silverstone: 645, suzuka: 766, sakhir: 651, interlagos: 748, cota: 825, zandvoort: 627,
    spielberg: 774, montreal: 575, hungaroring: 937, monaco: 359, imola: 911, buddh: 414 }; // Monaco: its walled stretch starts earlier with the 50 m entry curve
// Pit lanes built end to end from the survey (circuits.json pitSurveyedMouths): the real entry and exit roads. Monza:
// OpenStreetMap way 38168747 (737.5 m) on the game's track branches off 5531 m into the lap (Parabolica exit) and rejoins
// 483 m into the lap (main straight); its outer edge opens away from the road edge at ~6.7° over the split
const SURVEYED = { monza: { entryM: 5531, exitM: 483, edgeDeg: 6.7, lenM: 737.5 } };
const deg = (a) => (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180) / Math.PI;

for (const id of Track.TRACK_IDS) {
    const t = tracks[id], pit = t.pit, Q = pit.path, sc = t.scale;
    const heading = (i) => Math.atan2(Q[i + 1].y - Q[i].y, Q[i + 1].x - Q[i].x);

    test(`${id}: the pit lane has no kinks: each step turns within 5° of its neighbours' mean, never over 25° (9 m radius)`, () => {
        const turn = (i) => Math.atan2(Math.sin(heading(i) - heading(i - 1)), Math.cos(heading(i) - heading(i - 1)));
        for (let i = 1; i + 1 < Q.length; i++) assert.ok(deg(turn(i)) <= 25, `${deg(turn(i)).toFixed(1)}° at ${(pit.cum[i] / sc).toFixed(0)} m`);
        for (let i = 2; i + 2 < Q.length; i++) {
            const k = deg(turn(i) - (turn(i - 1) + turn(i + 1)) / 2);
            assert.ok(k <= 5, `kink ${k.toFixed(1)}° at ${(pit.cum[i] / sc).toFixed(0)} m`);
        }
    });

    test(`${id}: both mouths start on the real road edge, tangent to the road (the first 4 m chord within 5°: the connector's own tangent is the road's, the chord adds the curve)`, () => {
        if (SURVEYED[id]) return; // the real mouths, at their real angle (below)
        for (const [q, d] of [[Q[0], heading(0)], [Q.at(-1), heading(Q.length - 2)]]) {
            const n = Physics.nearestOnTrack(q.x, q.y, t), s = t.cum[n.i] + n.t * (t.cum[n.i + 1] - t.cum[n.i]);
            const a = Track.pointAt(t.path, t.cum, s - 4 * sc), b = Track.pointAt(t.path, t.cum, s + 4 * sc); // the road's tangent there
            assert.ok(Math.abs(n.dist - Track.edgeAt(t, n, q.x, q.y)) <= 0.05 * sc, `tip ${((n.dist - Track.edgeAt(t, n, q.x, q.y)) / sc).toFixed(2)} m off the edge`);
            assert.ok(deg(d - Math.atan2(b.y - a.y, b.x - a.x)) <= 5, `tip at ${deg(d - Math.atan2(b.y - a.y, b.x - a.x)).toFixed(1)}° to the road`);
        }
        for (const m of ['entry', 'exit']) assert.ok(pit.mouths[m].angleDeg >= 0 && pit.mouths[m].angleDeg < 60 && [1, -1].includes(pit.mouths[m].side), m);
    });

    test(`${id}: no pit lane point on the road past the mouths' first metre`, () => {
        if (SURVEYED[id]) return; // its real split: the first and last ~40 m on the track's own asphalt
        for (let i = 0; i < Q.length; i++) {
            if (pit.cum[i] < 1 * sc || pit.len - pit.cum[i] < 1 * sc) continue;
            const n = Physics.nearestOnTrack(Q[i].x, Q[i].y, t);
            assert.ok(n.dist >= Track.edgeAt(t, n, Q[i].x, Q[i].y) - 0.05 * sc, `lane on the road at ${(pit.cum[i] / sc).toFixed(0)} m`);
        }
    });

    // within 5 m: it is clipped to the walled stretch, which is now measured against the real road edge (Spa: 4.6 m shorter)
    test(`${id}: the limiter zone keeps its length`, () => {
        assert.ok(Math.abs((pit.limEnd - pit.limStart) / sc - LIMITER_M[id]) <= 5, `${((pit.limEnd - pit.limStart) / sc).toFixed(1)} m`);
    });
}

for (const [id, real] of Object.entries(SURVEYED)) {
    test(`${id}: the real pit entry and exit roads: where they leave and rejoin the road edge, their angle, the lane's length`, () => {
        const t = tracks[id], pit = t.pit, sc = t.scale, total = t.cum[t.path.length], lapM = (s) => ((((s - t.startS) % total) + total) % total) / sc;
        assert.ok(Math.abs(lapM(pit.entryS) - real.entryM) <= 5, `entry at ${lapM(pit.entryS).toFixed(0)} m into the lap`);
        assert.ok(Math.abs(lapM(pit.exitS) - real.exitM) <= 5, `exit at ${lapM(pit.exitS).toFixed(0)} m into the lap`);
        assert.ok(Math.abs(pit.len / sc - real.lenM) <= 2, `lane ${(pit.len / sc).toFixed(1)} m`);
        // Each split: the tip on the road edge, the lane's track-side edge along the road edge, its outer edge opening (entry) /
        // closing (exit) steadily at the real angle: no notch where it meets the road
        const P = pit.path, n = P.length, full = pit.widthAt.findIndex((w) => w >= pit.width - 1e-6), last = n - 1 - [...pit.widthAt].reverse().findIndex((w) => w >= pit.width - 1e-6);
        const at = (i) => { const q = Physics.nearestOnTrack(P[i].x, P[i].y, t); return { d: q.dist / sc, e: Track.edgeAt(t, q, P[i].x, P[i].y) / sc, w: pit.widthAt[i] / sc }; };
        for (const [tip, to, dir] of [[0, full, 1], [n - 1, last, -1]]) {
            const a = at(tip);
            assert.ok(Math.abs(a.d - a.e) < 0.1, `tip ${(a.d - a.e).toFixed(2)} m off the road edge`);
            let prev = -Infinity;
            for (let i = tip; i !== to; i += dir) {
                const { d, e, w } = at(i);
                assert.ok(d + w / 2 >= prev - 0.05, `outer edge turns back at ${(pit.cum[i] / sc).toFixed(0)} m`);
                assert.ok(d - w / 2 > e - 0.6, `lane edge ${(e - (d - w / 2)).toFixed(2)} m into the road at ${(pit.cum[i] / sc).toFixed(0)} m`);
                prev = d + w / 2;
            }
            const b = at(to), deg = (Math.atan2((b.d + b.w / 2) - a.d, Math.abs(pit.cum[to] - pit.cum[tip]) / sc) * 180) / Math.PI;
            assert.ok(Math.abs(deg - real.edgeDeg) <= 1.5, `outer edge opens at ${deg.toFixed(1)}°`);
        }
    });
}
