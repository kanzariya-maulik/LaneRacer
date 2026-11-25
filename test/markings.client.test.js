// Monza's FIA markings from the build data's features and the pit lane (public/js/markings.js): where they stand
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

let M;
before(async () => { M = await import('../public/js/markings.js'); });
const t = Track.load('monza'), sc = t.scale;
const offRoad = (q) => { const n = Physics.nearestOnTrack(q.x, q.y, t); return n.dist > Track.edgeAt(t, n, q.x, q.y) - 0.05 * sc; };
const inPoly = (P, q) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > q.y) !== (P[j].y > q.y) && q.x < ((P[j].x - P[i].x) * (q.y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) c = !c; return c; };

test('monza: the pit entry gore is blue paint off the racing surface, a yellow bollard at its tip', () => {
    const m = M.markings(t), gore = m.paint.find((p) => p.feature === 'gore');
    assert.ok(gore && gore.paint[0] === '#1e5bd8' && gore.poly.length >= 6);
    assert.ok(gore.poly.every(offRoad), 'gore on the racing surface');
    const b = m.solids.filter((s) => s.feature === 'bollard');
    assert.strictEqual(b.length, 2, 'pit entry and T4 bollards');
    assert.ok(b.every((s) => s.color === '#facc15' && offRoad(s)));
});

test('monza: SC1 and SC2 across the pit lane, the T4 yellow line and the T5 bumps off the racing surface', () => {
    const m = M.markings(t);
    for (const n of [1, 2]) {
        const l = m.paint.find((p) => p.feature === `sc${n}`);
        assert.ok(l && l.poly.length === 4, `SC${n}`);
        const c = l.poly.reduce((a, q) => ({ x: a.x + q.x / 4, y: a.y + q.y / 4 }), { x: 0, y: 0 });
        assert.ok(Physics.nearestOnPath(c.x, c.y, t.pit.path, false).dist < 1 * sc, `SC${n} not on the pit lane`);
    }
    const y = m.paint.find((p) => p.feature === 'yellowLine');
    assert.ok(y && y.poly.every(offRoad));
    const bumps = m.solids.filter((s) => s.feature === 'bumps');
    assert.ok(bumps.length >= 8 && bumps.every(offRoad), `${bumps.length} bumps`);
    assert.deepStrictEqual([...new Set(bumps.map((s) => s.color))].sort(), ['#111111', '#facc15']);
});

test('monza: four rows of polystyrene blocks on the T1 escape road asphalt, staggered, off the racing surface', () => {
    const m = M.markings(t), rows = m.solids.filter((s) => s.feature === 'blocks');
    assert.strictEqual(rows.length, 4);
    const road = t.build.surfaces.filter((s) => s.kind === 'asphalt');
    for (const r of rows) {
        assert.ok(offRoad(r), 'block row on the track');
        assert.ok(road.some((s) => inPoly(s.poly, r)), 'block row off the escape road');
    }
});

// Drawn at run-off paint's height (on the grass) the gore, SC lines and T4 line lay under the apron, lane and road
// asphalt: Monza's gore showed plain grey. Their layer is above every surface they're painted on, under the white lines
test('markings are drawn above the asphalt they are painted on', async () => {
    const { LAYER_Y } = await import('../public/js/trackMesh.js');
    assert.ok(LAYER_Y.mark > Math.max(LAYER_Y.apron, LAYER_Y.lane, LAYER_Y.road, LAYER_Y.kerb), `mark ${LAYER_Y.mark}`);
    assert.ok(LAYER_Y.mark < LAYER_Y.line);
});

// A malformed feature in the build data (an empty span, no offset) draws nothing rather than a polygon three.js can't
// triangulate: game3d's buildWorld threw on it and the whole circuit failed to load
test('a degenerate yellow line paints nothing; a missing offset paints on the white line', () => {
    const only = (f) => M.markings({ ...t, build: { ...t.build, features: [f] } }).paint;
    for (const f of [{ type: 'yellowLine', fromM: 2190, toM: 2100, side: 'R', offM: 12 }, { type: 'yellowLine', fromM: 2100, toM: 2101, side: 'R', offM: 12 }])
        assert.deepStrictEqual(only(f), [], `${f.fromM}..${f.toM}`);
    const [p] = only({ type: 'yellowLine', fromM: 2100, toM: 2190, side: 'R' });
    assert.ok(p && p.poly.length >= 4 && p.poly.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
});
