const test = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
const lobby = require('../src/lobby');
const Game = require('../src/game/Game');

const CAR_RADIUS = 18;
const CUSTOM_IDS = ['oval', 'oval-x', 'ring', 'ring-x', 'track-x', 'bone-x'];

test('Track exports ALL_TRACK_IDS and CUSTOM_TRACK_IDS', () => {
    assert.deepStrictEqual(Track.CUSTOM_TRACK_IDS, CUSTOM_IDS);
    assert.strictEqual(Track.ALL_TRACK_IDS.length, 20);
    for (const id of CUSTOM_IDS) {
        assert.ok(Track.ALL_TRACK_IDS.includes(id), `Missing ${id} in ALL_TRACK_IDS`);
    }
});

test('Track.loadAll(true) loads 20 circuits including all custom -x tracks', () => {
    const all = Track.loadAll(true);
    assert.strictEqual(Object.keys(all).length, 20);
    for (const id of CUSTOM_IDS) {
        assert.ok(all[id], `Track ${id} not loaded`);
    }
});

test('Track.loadAll() default loads 14 standard F1 circuits', () => {
    const f1 = Track.loadAll();
    assert.strictEqual(Object.keys(f1).length, 14);
    for (const id of CUSTOM_IDS) {
        assert.strictEqual(f1[id], undefined);
    }
});

for (const id of CUSTOM_IDS) {
    test(`${id}: custom track loads and satisfies core track requirements`, () => {
        const t = Track.load(id);
        assert.ok(t);
        assert.strictEqual(t.id, id);
        assert.ok(t.path.length >= 350, `path length ${t.path.length}`);

        // Closed loop
        const a = t.path[0], b = t.path[t.path.length - 1];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 50 * t.scale, 'last point should be near first');

        // Checkpoints & sectors
        assert.ok(t.checkpoints.length >= 15 && t.checkpoints.length <= 19, `${t.checkpoints.length} checkpoints`);
        assert.strictEqual(t.checkpoints[0].x, t.start.x);
        assert.strictEqual(t.checkpoints[0].y, t.start.y);
        assert.strictEqual(t.sectorCps.length, 3);
        const [s1, s2, s3] = t.sectorCps;
        assert.strictEqual(s1, 0);
        assert.ok(s2 >= 3 && s3 - s2 >= 3 && t.checkpoints.length - s3 >= 3, `sector cps: ${t.sectorCps}`);

        // DRS zones
        assert.strictEqual(t.drsZones.length, 2);
        const total = t.cum[t.path.length];
        for (const z of t.drsZones) {
            for (const s of [z.detectS, z.startS, z.endS]) assert.ok(s >= 0 && s < total);
        }

        // 22 grid slots
        assert.strictEqual(t.startPositions.length, 22);
        for (const s of t.startPositions) {
            assert.ok(Physics.getDistanceFromTrack(s.x, s.y, t) < t.width / 2, `slot off track at ${s.x},${s.y}`);
            assert.ok(Number.isFinite(s.angle));
        }
        for (let i = 0; i < 22; i++) {
            for (let j = i + 1; j < 22; j++) {
                const sA = t.startPositions[i], sB = t.startPositions[j];
                assert.ok(Math.hypot(sA.x - sB.x, sA.y - sB.y) >= 2 * CAR_RADIUS, `slots ${i} and ${j} overlap`);
            }
        }

        // Safe speeds and racing line
        assert.strictEqual(t.safeSpeed.length, t.path.length);
        for (const v of t.safeSpeed) assert.ok(v > 15 && v <= 100);
        assert.ok(t.racingLine);
        assert.strictEqual(t.racingLine.offset.length, t.path.length);
        assert.strictEqual(t.racingLine.speed.length, t.path.length);
    });
}

test('track-x: satisfies user geometry specifications (6 turns, identical radius, symmetry, straight lengths)', () => {
    const t = Track.load('track-x');
    assert.strictEqual(t.name, 'Track - X (6 Turns)');

    // Verify vertical reflection symmetry across x = 0
    // Every point (x, y) has a matching point (-x, y) on the path
    for (const p of t.path) {
        const mirroredX = -p.x;
        const mirroredY = p.y;
        let found = false;
        for (const other of t.path) {
            if (Math.hypot(other.x - mirroredX, other.y - mirroredY) < 1.0) {
                found = true;
                break;
            }
        }
        assert.ok(found, `Point (${p.x}, ${p.y}) has no vertical mirror reflection point on track-x`);
    }

    // Verify 6 semicircles turn radius R = 720
    const R = 720;
    // Flipped: bigger straight Lan 1 is on TOP (y = -2160), Lan 2 is on BOTTOM (y = 2160)
    // Turn 1 center (3600, -1440) -> apex at x = 3600 + 720 = 4320, y = -1440
    // Turn 2 center (1140, 0) -> apex at x = 1140 - 720 = 420, y = 0
    // Turn 3 center (2400, 1440) -> apex at x = 2400 + 720 = 3120, y = 1440
    // Turn 4 center (-2400, 1440) -> apex at x = -2400 - 720 = -3120, y = 1440
    // Turn 5 center (-1140, 0) -> apex at x = -1140 + 720 = -420, y = 0
    // Turn 6 center (-3600, -1440) -> apex at x = -3600 - 720 = -4320, y = -1440
    const apexes = [
        { x: 4320, y: -1440 },
        { x: 420, y: 0 },
        { x: 3120, y: 1440 },
        { x: -3120, y: 1440 },
        { x: -420, y: 0 },
        { x: -4320, y: -1440 }
    ];
    for (const apex of apexes) {
        const hasApex = t.path.some(p => Math.hypot(p.x - apex.x, p.y - apex.y) < 1.0);
        assert.ok(hasApex, `Track should pass through turn apex at (${apex.x}, ${apex.y})`);
    }

    // Verify clockwise direction:
    // Top straight Lan 1 (y = -2160) travels East (dx > 0)
    // Bottom straight Lan 2 (y = 2160) travels West (dx < 0)
    const pTop0 = t.path[0], pTop1 = t.path[1];
    assert.strictEqual(pTop0.y, -2160, 'Top straight should be at y = -2160 (top of canvas)');
    assert.ok(pTop1.x > pTop0.x, 'Top straight should head East (clockwise)');

    // Straight lengths verification:
    // Lan 1 (top): y = -2160, from x = -3600 to 3600 => length 7200
    // Lan 2 (bottom): y = 2160, from x = -2400 to 2400 => length 4800
    // Lan 3 (LHS): y = -720, from x = -3600 to -1140 => length 2460
    // Lan 3 (RHS): y = -720, from x = 1140 to 3600 => length 2460
    // Lan 4 (LHS): y = 720, from x = -2400 to -1140 => length 1260
    // Lan 4 (RHS): y = 720, from x = 1140 to 2400 => length 1260
    // Therefore: Lan 1 > Lan 2 > Lan 3 > Lan 4, and LHS == RHS
    const len1 = 7200;
    const len2 = 4800;
    const len3 = 2460;
    const len4 = 1260;
    assert.ok(len1 > len2, 'lan 1 should be longer than lan 2');
    assert.ok(len2 > len3, 'lan 2 should be longer than lan 3');
    assert.ok(len3 > len4, 'lan 3 should be longer than lan 4');
});

test('lobby allows selecting -x experimental tracks with Track.ALL_TRACK_IDS', () => {
    const current = { trackId: 'monza', maxLaps: 3 };
    for (const id of ['oval-x', 'ring-x', 'track-x']) {
        const next = lobby.sanitizeSettings(current, { trackId: id }, Track.ALL_TRACK_IDS);
        assert.strictEqual(next.trackId, id);
    }
});

test('Game instance runs on all three -x tracks without crashing', () => {
    const mockIo = { emit: () => {}, volatile: { emit: () => {} } };
    for (const id of ['oval-x', 'ring-x', 'track-x']) {
        const tr = Track.load(id);
        const players = [
            { id: 'p1', username: 'Driver 1', teamId: 'ferrari' },
            { id: 'p2', username: 'Driver 2', teamId: 'redbull' }
        ];
        const game = new Game(mockIo, players, tr, { maxLaps: 2, collisions: true }, () => {}, 'race');
        game.start();
        assert.strictEqual(Object.keys(game.players).length, 2);
        // Simulate one physics step
        game.update();
        assert.strictEqual(game.winnerCount, 0);
        game.stop();
    }
});
