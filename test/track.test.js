const test = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

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
