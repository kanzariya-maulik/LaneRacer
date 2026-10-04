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

test('loads all thirteen circuits', () => {
    assert.deepStrictEqual(Object.keys(tracks).sort(), ['cota', 'hungaroring', 'imola', 'interlagos', 'monaco', 'montreal', 'monza', 'sakhir', 'silverstone', 'spa', 'spielberg', 'suzuka', 'zandvoort']);
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
        for (const cp of t.checkpoints) assert.strictEqual(cp.radius, t.width / 2 + t.wallOffset); // out to the barrier
        const [a, b, c] = t.sectorCps;
        assert.strictEqual(a, 0);
        assert.ok(b >= 3 && c - b >= 3 && t.checkpoints.length - c >= 3, `sector cps ${t.sectorCps}`);
    });

    test(`${id}: sector lines are checkpoints at sector2M / sector3M`, () => {
        const c = circuits[id];
        for (const [k, m] of [[1, c.sector2M], [2, c.sector3M]]) {
            const p = Track.pointAt(t.path, t.cum, (c.startLineM + m) * t.scale);
            const cp = t.checkpoints[t.sectorCps[k]];
            assert.ok(Math.hypot(cp.x - p.x, cp.y - p.y) < 1e-6, `sector ${k + 1} line misplaced`);
        }
    });

    test(`${id}: pit entry closed just before the first garage`, () => {
        const { closeS, closeWall, garageSpan, wall, path: pp, cum } = t.pit;
        assert.ok(closeS < garageSpan[0], 'closure must be before the garages');
        const n = Physics.nearestOnPath(wall[0].x, wall[0].y, pp, false);
        assert.ok(Math.abs(closeS - (cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]))) < 1 * t.scale, 'closure must start at the pit wall');
        assert.strictEqual(closeWall.length, 2);
    });

    test(`${id}: safe corner speeds`, () => {
        assert.strictEqual(t.safeSpeed.length, t.path.length);
        for (const v of t.safeSpeed) assert.ok(v > 15 && v <= 100);
    });

    test(`${id}: start line at circuits.json startLineM`, () => {
        const p = Track.pointAt(t.path, t.cum, circuits[id].startLineM * t.scale);
        assert.strictEqual(t.start.x, p.x);
        assert.strictEqual(t.start.y, p.y);
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
        const line = Track.pointAt(t.path, t.cum, (c.startLineM + (c.gridLineM || 0)) * t.scale); // grid line, if separate
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

    test(`${id}: pit wall clears the track edge and runs past the garages`, () => {
        const { wall, path: pp, cum, garageSpan } = t.pit;
        assert.ok(wall.length > 20, `wall only ${wall.length} points`);
        for (const w of wall) assert.ok(Physics.nearestOnTrack(w.x, w.y, t).dist >= t.width / 2, 'wall on the track');
        const sOf = (w) => { const n = Physics.nearestOnPath(w.x, w.y, pp, false); return cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]); };
        assert.ok(sOf(wall[0]) < garageSpan[0] && sOf(wall.at(-1)) > garageSpan[1], 'wall gap beside the garages');
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
// Monaco ~42, Imola ~33
const ELEVATION_RANGE = { spa: [80, 130], suzuka: [30, 55], sakhir: [10, 30], silverstone: [6, 20], monza: [8, 25], spielberg: [50, 75], interlagos: [30, 55], hungaroring: [25, 45], cota: [24, 45], zandvoort: [5, 15], montreal: [2, 10], monaco: [35, 50], imola: [28, 42] };
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
    assert.strictEqual(t.start.x, pts[0].x);
    assert.strictEqual(t.startPositions.length, 22);
    assert.deepStrictEqual(t.sectorCps.length, 3);
});

for (const id of Track.TRACK_IDS) {
    test(`${id}: pit entry barrier reaches past the track run-off`, () => {
        const t = tracks[id], out = t.pit.closeWall[0], near = Physics.nearestOnTrack(out.x, out.y, t);
        // past the run-off barrier, or (Monaco: the pit lane leaves inside the Rascasse hairpin) against the road, closer than a
        // car is wide
        assert.ok(near.dist >= t.width / 2 + t.wallOffset || near.dist - t.width / 2 < 2 * t.scale, 'gap around the barrier end'); // past this track's barrier
    });
}

const DRS_COUNT = { monza: 2, spa: 2, silverstone: 2, suzuka: 1, sakhir: 3, interlagos: 2, cota: 2, zandvoort: 2, spielberg: 3, montreal: 3, hungaroring: 2, monaco: 1, imola: 1 };
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
            assert.strictEqual(t.safeSpeed[ahead], 100, `${id} zone starts in a corner`);
            let slow = i; // the corner's slowest point is behind the activation, or within 15 m (corner positions are ±10 m)
            for (let k = i; k !== ahead; k = (k + 1) % n) if (t.safeSpeed[k] < t.safeSpeed[slow] - 0.5) slow = k;
            assert.ok((((t.cum[slow] - t.cum[i]) % t.cum[n]) + t.cum[n]) % t.cum[n] <= 15 * t.scale, `${id} zone starts before the apex`);
        }
    });
}
