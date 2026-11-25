const test = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data', 'tracks');
const circuits = JSON.parse(fs.readFileSync(path.join(DATA, 'circuits.json'), 'utf8'));

const CAR_RADIUS = 18; // Physics.checkCarCollision

const tracks = Track.loadAll();
// Where the survey (the track's own points, before Track.js smooths them) puts a spot `m` metres from point 0: the
// smoothed track keeps it there, give or take how far the smoothing moved the road (FAIR_MOVE_M)
const FAIR_MOVE_M = 2;
const surveyAt = (id, m) => {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8')), P = raw.path, cum = [0];
    for (let i = 1; i <= P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i % P.length].x - P[i - 1].x, P[i % P.length].y - P[i - 1].y));
    return Track.pointAt(P, cum, m * raw.scale);
};

test('loads all fourteen circuits', () => {
    assert.deepStrictEqual(Object.keys(tracks).sort(), ['buddh', 'cota', 'hungaroring', 'imola', 'interlagos', 'monaco', 'montreal', 'monza', 'sakhir', 'silverstone', 'spa', 'spielberg', 'suzuka', 'zandvoort']);
});

for (const id of Track.TRACK_IDS) {
    const t = tracks[id];

    test(`${id}: closed loop`, () => {
        assert.ok(t.path.length > 400, `only ${t.path.length} points`);
        const a = t.path[0], b = t.path[t.path.length - 1];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 15 * t.scale, 'last point should be near the first');
    });

    test(`${id}: checkpoints per sector, first on the start line`, () => {
        assert.ok(t.checkpoints.length >= 15 && t.checkpoints.length <= 19, `${t.checkpoints.length} checkpoints`);
        assert.strictEqual(t.checkpoints[0].x, t.start.x);
        assert.strictEqual(t.checkpoints[0].y, t.start.y);
        for (const cp of t.checkpoints) { // out past the barriers there, at most 120 m
            const n = Physics.nearestOnTrack(cp.x, cp.y, t), far = Math.max(t.barrierR[n.i], t.barrierL[n.i]);
            assert.ok(cp.radius >= Math.min(far, 110 * t.scale) && cp.radius <= 120 * t.scale, `radius ${cp.radius / t.scale} m, barrier ${far / t.scale} m`);
        }
        const [a, b, c] = t.sectorCps;
        assert.strictEqual(a, 0);
        assert.ok(b >= 3 && c - b >= 3 && t.checkpoints.length - c >= 3, `sector cps ${t.sectorCps}`);
    });

    test(`${id}: sector lines are checkpoints at sector2M / sector3M`, () => {
        const c = circuits[id];
        for (const [k, m] of [[1, c.sector2M], [2, c.sector3M]]) {
            const p = surveyAt(id, c.startLineM + m), cp = t.checkpoints[t.sectorCps[k]];
            assert.ok(Math.hypot(cp.x - p.x, cp.y - p.y) < FAIR_MOVE_M * t.scale, `sector ${k + 1} line misplaced`);
            assert.ok(Physics.nearestOnTrack(cp.x, cp.y, t).dist < 1e-6, `sector ${k + 1} line off the centreline`);
        }
    });

    test(`${id}: pit lane only meets the road at its two mouths, full width clear of the real road edge`, () => {
        if (circuits[id].pitSurveyedMouths) return; // its real split runs over the track's asphalt (pitGeometry.test.js checks it)
        const pit = t.pit;
        pit.path.forEach((q, i) => {
            const n = Physics.nearestOnTrack(q.x, q.y, t), half = Track.edgeAt(t, n, q.x, q.y); // the real edge on that side
            assert.ok(n.dist - pit.widthAt[i] / 2 >= half - 0.01 * t.scale, `lane asphalt on the road at ${(pit.cum[i] / t.scale).toFixed(0)} m`);
        });
        const full = (i) => pit.widthAt[i] >= pit.width - 1e-6;
        const first = pit.widthAt.findIndex((_, i) => full(i)), last = pit.widthAt.length - 1 - [...pit.widthAt].reverse().findIndex((_, i) => full(pit.widthAt.length - 1 - i));
        assert.ok(pit.cum[first] <= 60 * t.scale && pit.len - pit.cum[last] <= 60 * t.scale, 'full width within 60 m of each mouth');
        assert.strictEqual(pit.widthAt[0], 0); assert.strictEqual(pit.widthAt.at(-1), 0);
        assert.ok(!('closeWall' in pit) && !('closeS' in pit));
    });

    test(`${id}: pit lane is smooth (radius ≥ 30 m on the connectors) and never crosses itself`, () => {
        const P = t.pit.path, n = P.length;
        for (let i = 2; i < n - 2; i++) {
            const a = P[i - 2], b = P[i], c = P[i + 2];
            const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
            const cr = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
            if (cr && t.pit.widthAt[i] < t.pit.width - 1e-6) assert.ok((ab * bc * ca) / (2 * cr) >= 30 * t.scale - 1e-6, `tight connector at ${i}`);
        }
        for (let i = 0; i + 1 < n; i++) for (let j = i + 2; j + 1 < n; j++) {
            const p = P[i], q = P[i + 1], r = P[j], s = P[j + 1];
            const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
            if (!d) continue;
            const u = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, v = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
            assert.ok(!(u > 0 && u < 1 && v > 0 && v < 1), `lane crosses itself at ${i}/${j}`);
        }
    });

    test(`${id}: pit wall runs the whole full-width lane on the track side`, () => {
        const pit = t.pit, sOf = (w) => { const k = Physics.nearestOnPath(w.x, w.y, pit.path, false); return pit.cum[k.i] + k.t * (pit.cum[k.i + 1] - pit.cum[k.i]); };
        // full width with its track side clear of the road edge by the wall's end gap (Track.js WALL_END_GAP_M: 0.5 m)
        const side = (i) => { const a = pit.path[i], b = pit.path[Math.min(i + 1, pit.path.length - 1)], h = Math.atan2(b.y - a.y, b.x - a.x) || 0, o = (pit.trackSide * pit.width) / 2;
            const q = { x: a.x - Math.sin(h) * o, y: a.y + Math.cos(h) * o }, n = Physics.nearestOnTrack(q.x, q.y, t); return (n.dist - Track.edgeAt(t, n, q.x, q.y)) / t.scale; };
        const full = pit.widthAt.map((w, i) => w >= pit.width - 1e-6 && side(i) >= 0.5), first = full.indexOf(true), last = full.lastIndexOf(true);
        // a surveyed entry (Monza): the wall starts where its painted gore ends, and stops where the exit line starts
        const from = pit.gore ? pit.gore.to : pit.cum[first], to = pit.gore ? pit.gore.exitFrom : pit.cum[last];
        assert.ok(sOf(pit.wall[0]) <= from + 5 * t.scale && sOf(pit.wall.at(-1)) >= to - 5 * t.scale);
        for (const w of pit.wall) { const n = Physics.nearestOnTrack(w.x, w.y, t); assert.ok(n.dist >= Track.edgeAt(t, n, w.x, w.y) - 0.01 * t.scale, 'wall on the road'); }
    });

    test(`${id}: safe corner speeds`, () => {
        assert.strictEqual(t.safeSpeed.length, t.path.length);
        for (const v of t.safeSpeed) assert.ok(v > 10 && v <= 100); // real grip: Monaco's hairpin is ~45-50 km/h (12.5-14 m/s)
        assert.strictEqual(t.lineLimit.length, t.path.length);
        for (const v of t.lineLimit) assert.ok(v > 10 && v <= 100);
        // The line is wider than the centreline: its slowest corner is no slower than the centreline's
        assert.ok(Math.min(...t.lineLimit) >= Math.min(...t.safeSpeed) - 0.1, `${id}: line corner slower than centreline`);
    });

    test(`${id}: start line at circuits.json startLineM`, () => {
        const p = surveyAt(id, circuits[id].startLineM), q = Track.pointAt(t.path, t.cum, t.startS);
        assert.ok(Math.hypot(t.start.x - p.x, t.start.y - p.y) < FAIR_MOVE_M * t.scale, 'start line moved');
        assert.deepStrictEqual(t.start, q);
    });

    test(`${id}: grid behind the start line, pole on the ${circuits[id].poleSide}, alternating`, () => {
        const pole = circuits[id].poleSide, other = pole === 'left' ? 'right' : 'left';
        // y points down the screen, so driver's left has a negative cross product
        const sideOf = (s) => {
            const n = Physics.nearestOnTrack(s.x, s.y, t);
            return Math.cos(s.angle) * (s.y - n.py) - Math.sin(s.angle) * (s.x - n.px) < 0 ? 'left' : 'right';
        };
        t.startPositions.forEach((s, i) => assert.strictEqual(sideOf(s), i % 2 === 0 ? pole : other, `slot ${i}`));
        const s0 = t.startPositions[0], c = circuits[id];
        const line = t.gridLine || t.start; // grid line, if separate
        assert.ok(Math.hypot(line.x - surveyAt(id, c.startLineM + (c.gridLineM || 0)).x, line.y - surveyAt(id, c.startLineM + (c.gridLineM || 0)).y) < FAIR_MOVE_M * t.scale, 'grid line moved');
        const ahead = Math.cos(line.angle) * (s0.x - line.x) + Math.sin(line.angle) * (s0.y - line.y);
        assert.ok(ahead < -7 * t.scale && ahead > -9 * t.scale, `pole is ${(-ahead / t.scale).toFixed(1)} m behind the line`);
    });

    test(`${id}: whole grid between the timing line and checkpoint 1`, () => {
        // Race cars start having passed checkpoint 0 only, so a grid past the timing line must stay short of checkpoint 1
        const total = t.cum[t.path.length], lapS = (p) => {
            const n = Physics.nearestOnTrack(p.x, p.y, t);
            return (((t.cum[n.i] + n.t * (t.cum[n.i + 1] - t.cum[n.i]) - t.startS) % total) + total) % total;
        };
        const cp1 = lapS(t.checkpoints[1]) - t.checkpoints[1].radius;
        for (const s of t.startPositions) {
            const d = lapS(s);
            assert.ok(d > total / 2 || d < cp1, `slot at ${(d / t.scale).toFixed(0)} m reaches checkpoint 1`);
        }
    });

    test(`${id}: 11 garages × 2 boxes in team order, in the pit lane, inside the limiter zone`, () => {
        const pit = t.pit;
        assert.deepStrictEqual(pit.garages.map(g => g.teamId), Track.GARAGE_ORDER);
        const fromEntry = circuits[id].garagesFrom === 'entry';
        for (let k = 1; k < pit.garages.length; k++) {
            assert.ok(fromEntry ? pit.garages[k].s > pit.garages[k - 1].s : pit.garages[k].s < pit.garages[k - 1].s,
                `garage 1 is nearest the pit ${fromEntry ? 'entry' : 'exit'}`);
        }
        for (const g of pit.garages) {
            assert.strictEqual(g.boxes.length, 2);
            for (const b of g.boxes) {
                const n = Physics.nearestOnPath(b.x, b.y, pit.path, false);
                assert.ok(n.dist < pit.width / 2, `${g.teamId} box outside the pit lane`);
                assert.ok(Physics.nearestOnTrack(b.x, b.y, t).dist > t.width / 2, `${g.teamId} box on the track`);
                const s = pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);
                assert.ok(s > pit.limStart && s < pit.limEnd, `${g.teamId} box outside the limiter zone`);
            }
        }
    });

    test(`${id}: real width: the survey's edges (widened when narrow) are the track limits, barriers beyond them, kerbs per point`, () => {
        const raw = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'tracks', `${id}.json`), 'utf8'));
        t.path.forEach((_, i) => {
            assert.ok(t.edgeR[i] >= raw.edges[i][0] * t.scale - 1e-9 && t.edgeL[i] >= raw.edges[i][1] * t.scale - 1e-9, `narrower than the survey at ${i}`);
            assert.ok(t.barrierR[i] > t.edgeR[i] && t.barrierL[i] > t.edgeL[i], `barrier inside the road at point ${i}`);
            assert.ok(t.kerbR[i] >= 0 && t.kerbL[i] >= 0);
        });
        assert.ok(t.walls.length > 0 && t.build && t.build.barriers.length > 0);
        assert.ok(t.kerbR.some((k) => k > 0), 'some kerbs');
        const median = raw.edges.map(([r, l]) => r + l).sort((a, b) => a - b)[raw.edges.length >> 1];
        assert.ok(Math.abs(t.width / t.scale - Math.max(median, 11.5)) <= 0.5, `width ${t.width / t.scale} m vs real median ${median} m`);
    });

    test(`${id}: 22 grid slots on the asphalt and not overlapping`, () => {
        assert.strictEqual(t.startPositions.length, 22);
        for (const s of t.startPositions) {
            assert.ok(Physics.getDistanceFromTrack(s.x, s.y, t) < t.width / 2, `slot off track at ${s.x},${s.y}`);
            assert.ok(Number.isFinite(s.angle));
        }
        for (let i = 0; i < 22; i++) {
            for (let j = i + 1; j < 22; j++) {
                const a = t.startPositions[i], b = t.startPositions[j];
                assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * CAR_RADIUS, `slots ${i} and ${j} overlap`);
            }
        }
    });
}

// Published height differences (m): Spa ~102, Suzuka ~40, Sakhir ~20, Silverstone ~12, Monza ~15, Spielberg ~65, Interlagos ~40,
// Hungaroring ~35, COTA ~41 (F1 car heights give ~30 along the racing surface), Zandvoort ~10 (dunes), Montreal ~5,
// Monaco ~42, Imola ~33, Buddh ~14 (Copernicus DEM: 12.3)
const ELEVATION_RANGE = { spa: [80, 130], suzuka: [30, 55], sakhir: [10, 30], silverstone: [6, 20], monza: [8, 25], spielberg: [50, 75], interlagos: [30, 55], hungaroring: [25, 45], cota: [24, 45], zandvoort: [5, 15], montreal: [2, 10], monaco: [35, 50], imola: [28, 42], buddh: [10, 18] };
for (const id of Track.TRACK_IDS) {
    test(`${id}: real elevation, one height per path point, ${ELEVATION_RANGE[id].join('-')} m range`, () => {
        const t = tracks[id];
        assert.strictEqual(t.z.length, t.path.length);
        assert.ok(t.z.every(Number.isFinite) && Math.min(...t.z) === 0);
        const range = Math.max(...t.z);
        assert.ok(range >= ELEVATION_RANGE[id][0] && range <= ELEVATION_RANGE[id][1], `${range} m`);
        // smoothed: no step between neighbouring points (~10 m apart) steeper than 25 %
        t.z.forEach((h, i) => assert.ok(Math.abs(t.z[(i + 1) % t.z.length] - h) < 2.5, `step at point ${i}`));
    });
}

test('suzuka: the figure-8 crossover is a bridge, the back straight several metres over the road beneath', () => {
    const t = tracks.suzuka, P = t.path, n = P.length;
    const cross = (a, b, c, d) => {
        const r = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (!r) return false;
        const u = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / r, v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / r;
        return u >= 0 && u <= 1 && v >= 0 && v <= 1;
    };
    const hits = [];
    for (let i = 0; i < n; i++) for (let j = i + 3; j < n - (i === 0 ? 1 : 0); j++) if (cross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) hits.push([i, j]);
    assert.strictEqual(hits.length, 1, 'one crossing');
    const [i, j] = hits[0];
    assert.ok(t.z[j] - t.z[i] > 4, `back straight ${t.z[j]} m over ${t.z[i]} m`);
});

test('build fails loudly on missing files', () => {
    assert.throws(() => Track.load('nope'), /Missing track data/);
});

for (const id of Track.TRACK_IDS) {
    test(`${id}: circuit facts present`, () => {
        const c = circuits[id];
        assert.ok(c, 'missing from circuits.json');
        assert.strictEqual(typeof c.startLineM, 'number');
        assert.ok(['left', 'right'].includes(c.poleSide));
        assert.ok(c.limiterStartM >= 0 && c.limiterStartM < c.limiterEndM);
        assert.ok(Array.isArray(c.sources) && Array.isArray(c.unconfirmed));
    });

    test(`${id}: OSM pit lane imported, aligned and joined to the track`, () => {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
        assert.ok(raw.pit, 'no pit lane: run node scripts/import-pits.js');
        assert.ok(raw.pit.fitM <= 5, `OSM fit ${raw.pit.fitM} m`);
        assert.match(raw.attribution, /OpenStreetMap contributors \(ODbL\)/);
        const pts = raw.pit.path;
        assert.ok(pts.length > 100, `only ${pts.length} points`);
        for (const end of [pts[0], pts.at(-1)]) {
            assert.ok(Physics.getDistanceFromTrack(end.x, end.y, raw) < raw.width / 2 + 15 * raw.scale, 'pit end not joined to the track');
        }
        const m = pts.length >> 1, near = Physics.nearestOnPath(pts[m].x, pts[m].y, raw.path);
        const a = raw.path[near.i], b = raw.path[(near.i + 1) % raw.path.length];
        assert.ok((b.x - a.x) * (pts[m + 1].x - pts[m].x) + (b.y - a.y) * (pts[m + 1].y - pts[m].y) > 0, 'pit lane runs against the track');
        const lim = circuits[id];
        let s = 0;
        for (let i = 1; i < pts.length; i++) {
            s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / raw.scale;
            if (s >= lim.limiterStartM && s <= lim.limiterEndM) {
                assert.ok(Physics.getDistanceFromTrack(pts[i].x, pts[i].y, raw) < 40 * raw.scale, `pit ${s.toFixed(0)} m is far from the straight`);
            }
        }
    });
}

test('a track without a pit lane still builds', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: Math.cos(i / 50 * Math.PI) * 3000, y: Math.sin(i / 50 * Math.PI) * 3000 }));
    const t = Track.build({ id: 'ring', name: 'Ring', scale: 6, width: 80, path: pts });
    assert.strictEqual(t.pit, null);
    assert.ok(Math.hypot(t.start.x - pts[0].x, t.start.y - pts[0].y) < 0.5 * t.scale); // smoothing leaves a circle be
    assert.strictEqual(t.startPositions.length, 22);
    assert.deepStrictEqual(t.sectorCps.length, 3);
});

const DRS_COUNT = { monza: 2, spa: 2, silverstone: 2, suzuka: 1, sakhir: 3, interlagos: 2, cota: 2, zandvoort: 2, spielberg: 3, montreal: 3, hungaroring: 2, monaco: 1, imola: 1, buddh: 2 };
for (const id of Track.TRACK_IDS) {
    test(`${id}: DRS zones on flat-out straights`, () => {
        const t = tracks[id], total = t.cum[t.path.length];
        assert.strictEqual(t.drsZones.length, DRS_COUNT[id]);
        for (const z of t.drsZones) {
            for (const s of [z.detectS, z.startS, z.endS]) assert.ok(s >= 0 && s < total);
            // the activation point is on a straight or a corner exit (the FIA opens some just past an apex: Hungaroring T1,
            // Zandvoort T10/T13, Monaco T19): past the corner's slowest point and flat out within 60 m
            const p = Track.pointAt(t.path, t.cum, t.startS + z.startS), n = t.path.length, i = Physics.nearestOnTrack(p.x, p.y, t).i;
            const ahead = Physics.nearestOnTrack(...Object.values(Track.pointAt(t.path, t.cum, t.startS + z.startS + 60 * t.scale)).slice(0, 2), t).i;
            assert.ok(Math.max(t.lineLimit[ahead], t.safeSpeed[ahead]) >= 99.9, `${id} zone starts in a corner`); // flat on the line or the centreline
            let slow = i; // the corner's slowest point is behind the activation, or within 15 m (corner positions are ±10 m)
            for (let k = i; k !== ahead; k = (k + 1) % n) if (t.safeSpeed[k] < t.safeSpeed[slow] - 0.5) slow = k;
            assert.ok((((t.cum[slow] - t.cum[i]) % t.cum[n]) + t.cum[n]) % t.cum[n] <= 15 * t.scale, `${id} zone starts before the apex`);
        }
    });
}

test('narrow surveys widened to an F1 width (11.5 m median), never within 1.5 m of a barrier, never narrower', () => {
    const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    for (const t of Object.values(tracks)) {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${t.id}.json`), 'utf8'));
        if (!raw.edges) continue;
        const w = t.edgeR.map((r, i) => (r + t.edgeL[i]) / t.scale), was = raw.edges.map((e) => e[0] + e[1]);
        const m = median(w);
        if (median(was) < 11.5) assert.ok(m >= 11.0, `${t.id}: median ${m.toFixed(1)} m (survey ${median(was).toFixed(1)})`);
        else assert.ok(Math.abs(m - median(was)) < 0.05, `${t.id}: a wide survey stays as it is`);
        for (let i = 0; i < w.length; i++) {
            assert.ok(t.edgeR[i] / t.scale >= raw.edges[i][0] - 1e-6 && t.edgeL[i] / t.scale >= raw.edges[i][1] - 1e-6, `${t.id} ${i}: narrower than the survey`);
            for (const [e, b, k] of [[t.edgeR[i], t.barrierR[i], 0], [t.edgeL[i], t.barrierL[i], 1]]) {
                if (e / t.scale > raw.edges[i][k] + 1e-6) assert.ok(b - e >= 1.5 * t.scale - 1e-6, `${t.id} ${i}: widened to ${((b - e) / t.scale).toFixed(2)} m from a barrier`);
            }
        }
    }
});

test('limits file: used when its point count matches the track, ignored (scale 1) when missing or stale', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'monza.json'), 'utf8'));
    const none = Track.build(raw, circuits.monza, null);
    const stale = Track.build(raw, circuits.monza, { points: 3, help: [1.2, 1.2, 1.2] });
    assert.deepStrictEqual(stale.lineLimit, none.lineLimit, 'a stale file changed the limits');
    const n = none.path.length;
    const up = Track.build(raw, circuits.monza, { points: n, help: new Array(n).fill(1.1) });
    const i = none.lineLimit.findIndex((v) => v < 40);
    assert.ok(up.lineLimit[i] >= none.lineLimit[i] * 1.09, 'the line drives the calibrated limits');
    assert.deepStrictEqual(up.helpLimit, none.lineLimit, 'the braking help keeps the grip model\'s');
});

// The widened road gives way to the surveyed pit lane beside it (Track.js build); where the lane ends the edge eases back
// out to its widened place, no step: a 1.4 m jog in one 10 m segment drew a notch in the grass at Monza's pit exit
test('monza: the track edge eases back out past each pit mouth, no notch', () => {
    const t = tracks.monza, n = t.path.length, sc = t.scale, near = 100 * sc;
    for (const s0 of [t.pit.entryS, t.pit.exitS]) {
        for (const e of [t.edgeR, t.edgeL]) for (let i = 0; i < n; i++) {
            if (Math.abs(t.cum[i] - s0) > near) continue;
            const slope = Math.abs(e[(i + 1) % n] - e[i]) / (t.cum[i + 1] - t.cum[i]);
            assert.ok(slope <= 0.06, `edge slope ${slope.toFixed(3)} at ${(t.cum[i] / sc).toFixed(0)} m`);
        }
    }
});

// ...and touches nothing else: the survey's own widening round the lap stays (an ease over the whole edge narrowed
// Monza by up to 1.1 m in the Lesmos, moving its track limits). Built without surveyed mouths the edges aren't eased
test('monza: the eased edge differs from the plain one only along the pit lane', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'monza.json'), 'utf8'));
    const t = tracks.monza, plain = Track.build(raw, { ...circuits.monza, pitSurveyedMouths: false }, null), sc = t.scale;
    const total = t.cum[t.path.length], lapM = (s) => ((((s - t.startS) % total) + total) % total) / sc;
    const from = lapM(t.pit.entryS) - 60, to = lapM(t.pit.exitS) + 60; // the lane runs across the start line
    const off = [];
    for (const k of ['edgeR', 'edgeL']) t[k].forEach((e, i) => {
        const m = lapM(t.cum[i]);
        if (Math.abs(e - plain[k][i]) > 0.01 * sc && !(m >= from || m <= to)) off.push(`${k} ${m.toFixed(0)} m`);
    });
    assert.deepStrictEqual(off, []);
});

// A surveyed pit whose entry never parts from the track in its first half has no gore: an error when the track is built
// (as a lane with no stretch clear of the road is), not a gore from undefined that crashed the client's markings
test('surveyed pit entry with no gore: the build says so', () => {
    const R = 3000, pts = Array.from({ length: 200 }, (_, i) => ({ x: Math.cos((i / 100) * Math.PI) * R, y: Math.sin((i / 100) * Math.PI) * R }));
    // the lane hugs the edge for its first half, clear of it (wall room) only in its second
    const off = (a) => (a < 0.05 ? (a / 0.05) * 54 : a < 0.4 ? 54 : a < 0.45 ? 54 + ((a - 0.4) / 0.05) * 102 : a < 0.55 ? 156 : a < 0.6 ? 156 * (1 - (a - 0.55) / 0.05) : 0);
    const pit = Array.from({ length: 61 }, (_, k) => { const a = k / 100; return { x: Math.cos(a) * (R + off(a)), y: Math.sin(a) * (R + off(a)) }; });
    assert.throws(() => Track.build({ id: 'ring', name: 'Ring', scale: 6, width: 72, path: pts, pit: { path: pit, width: 72 } }, { pitSurveyedMouths: true }, null), /ring: .*gore/);
});


// The pit wall's ends stand clear of the road edge: started where the lane first reached full width, its nose sat on the
// white line (its 0.6 m box on the racing surface) and cars at the edge of the track hit it head on (Zandvoort, Buddh)
for (const id of Track.TRACK_IDS) test(`${id}: both ends of the pit wall stand clear of the road edge`, () => {
    const t = tracks[id], W = t.pit.wall;
    for (const w of [W[0], W.at(-1)]) {
        const n = Physics.nearestOnTrack(w.x, w.y, t), gap = (n.dist - Track.edgeAt(t, n, w.x, w.y)) / t.scale;
        assert.ok(gap >= 0.5, `end ${gap.toFixed(2)} m off the road edge`);
    }
});

// The widened edge gives way to the pit lane as built, not the raw survey: the built lane keeps only the survey's garage
// stretch and joins the road by new connectors, so the survey's 50-100 m beside the road before it clears it is gone. The
// edge was still held in by it: up to 1.9 m of track (Montreal) narrowed with the lane 4-16 m away, a notch in the limits
test('the widened edge is held in only where the built pit lane is beside it (no notch where the survey ran)', () => {
    const bad = [];
    for (const id of Track.TRACK_IDS) {
        if (circuits[id]?.pitSurveyedMouths) continue; // Monza: the surveyed mouths ease out by design (tests above)
        const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
        if (!raw.pit) continue;
        const t = tracks[id] || Track.load(id), sc = t.scale, pit = t.pit, plain = Track.build({ ...raw, pit: undefined }, circuits[id] || {}, null);
        for (const [k, sd] of [['edgeR', 1], ['edgeL', -1]]) t[k].forEach((e, i) => {
            const d = (plain[k][i] - e) / sc, bar = k === 'edgeR' ? t.barrierR : t.barrierL;
            if (d < 0.05 || Math.abs(e - (bar[i] - 1.5 * sc)) < 0.01 * sc) return; // held off a barrier (Track.js WALL_ROOM_M), not the lane
            const a = t.path[i], b = t.path[(i + 1) % t.path.length], h = Math.atan2(b.y - a.y, b.x - a.x);
            const q = { x: a.x - Math.sin(h) * sd * plain[k][i], y: a.y + Math.cos(h) * sd * plain[k][i] }; // where the widened edge would be
            const n = Physics.nearestOnPath(q.x, q.y, pit.path, false), w = pit.widthAt[n.i] + (pit.widthAt[Math.min(n.i + 1, pit.widthAt.length - 1)] - pit.widthAt[n.i]) * n.t;
            const gap = (n.dist - w / 2) / sc; // from there to the lane's own edge
            if (gap > 3) bad.push(`${id} ${k} pt ${i}: -${d.toFixed(2)} m, lane ${gap.toFixed(1)} m off`);
        });
    }
    assert.deepStrictEqual(bad, []);
});
