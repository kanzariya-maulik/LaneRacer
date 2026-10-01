const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

let S;
before(async () => { S = await import('../public/js/scenery.js'); });
const tracks = Track.loadAll();

for (const id of Track.TRACK_IDS) {
    test(`${id}: scenery stays clear of the track and pit lane`, () => {
        const t = tracks[id], out = S.placeScenery(t, 1, S.seedOf(id));
        const clear = t.width / 2 + 80 + 3 * t.scale;
        for (const o of [...out.grandstands, ...out.trees, ...out.billboards]) {
            assert.ok(Physics.nearestOnTrack(o.x, o.y, t).dist > clear, `${id}: object on or near the track at ${o.x},${o.y}`);
            if (t.pit) assert.ok(Physics.nearestOnPath(o.x, o.y, t.pit.path, false).dist > t.pit.width / 2 + 6 * t.scale, `${id}: object in the pit lane`);
        }
        // Whole grandstand footprint (60 m long, 12 m deep), not just its centre
        for (const g of out.grandstands) for (let a = -30; a <= 30; a += 5) for (const d of [-6, 6]) {
            const x = g.x + (Math.cos(g.angle) * a - Math.sin(g.angle) * d) * t.scale, y = g.y + (Math.sin(g.angle) * a + Math.cos(g.angle) * d) * t.scale;
            assert.ok(Physics.nearestOnTrack(x, y, t).dist > clear, `${id}: grandstand reaches the track at ${x},${y}`);
            if (t.pit) assert.ok(Physics.nearestOnPath(x, y, t.pit.path, false).dist > t.pit.width / 2 + 6 * t.scale, `${id}: grandstand over the pit lane`);
        }
        assert.ok(out.grandstands.length >= 2, 'grandstands at the main straight and slow corners');
        assert.ok(out.trees.length > 50 && out.billboards.length > 3);
        assert.ok(out.slowCorners.length >= 2);
    });
}

test('scenery is deterministic and scales with density', () => {
    const t = tracks.monza;
    assert.deepStrictEqual(S.placeScenery(t, 0.6, 42), S.placeScenery(t, 0.6, 42));
    const lo = S.placeScenery(t, 0.3, 42), hi = S.placeScenery(t, 1, 42);
    assert.ok(lo.trees.length < hi.trees.length * 0.5);
    assert.strictEqual(lo.grandstands.length, hi.grandstands.length, 'grandstands always placed');
    assert.notStrictEqual(S.seedOf('monza'), S.seedOf('spa'));
});
