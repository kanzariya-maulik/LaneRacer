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

test('loads all five circuits', () => {
    assert.deepStrictEqual(Object.keys(tracks).sort(), ['monza', 'sakhir', 'silverstone', 'spa', 'suzuka']);
});

for (const id of Track.TRACK_IDS) {
    const t = tracks[id];

    test(`${id}: closed loop`, () => {
        assert.ok(t.path.length > 400, `only ${t.path.length} points`);
        const a = t.path[0], b = t.path[t.path.length - 1];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 15 * t.scale, 'last point should be near the first');
    });

    test(`${id}: 16 checkpoints, first on the start line`, () => {
        assert.strictEqual(t.checkpoints.length, 16);
        assert.strictEqual(t.checkpoints[0].x, t.path[0].x);
        assert.strictEqual(t.checkpoints[0].y, t.path[0].y);
        for (const cp of t.checkpoints) assert.strictEqual(cp.radius, t.width / 2 + 80);
    });

    test(`${id}: 20 grid slots on the asphalt and not overlapping`, () => {
        assert.strictEqual(t.startPositions.length, 20);
        for (const s of t.startPositions) {
            assert.ok(Physics.getDistanceFromTrack(s.x, s.y, t) < t.width / 2, `slot off track at ${s.x},${s.y}`);
            assert.ok(Number.isFinite(s.angle));
        }
        for (let i = 0; i < 20; i++) {
            for (let j = i + 1; j < 20; j++) {
                const a = t.startPositions[i], b = t.startPositions[j];
                assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * CAR_RADIUS, `slots ${i} and ${j} overlap`);
            }
        }
    });
}

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
