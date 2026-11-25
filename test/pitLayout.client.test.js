const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');

let L;
before(async () => { L = await import('../public/js/pitLayout.js'); });
const tracks = Track.loadAll();
// Signed distance from the pit lane centre line, + toward the garages (-trackSide side)
function lateral(t, q) {
    const P = t.pit.path;
    let best = { d: Infinity, o: 0 };
    for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
        const px = a.x + u * dx, py = a.y + u * dy, d = Math.hypot(q.x - px, q.y - py);
        if (d < best.d) { const cross = (dx * (q.y - a.y) - dy * (q.x - a.x)) / Math.sqrt(l2); best = { d, o: cross * -t.pit.trackSide }; }
    }
    return best.o / t.scale; // metres, + garage side
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: pit layout — lines over the garages, a painted box and code per box, all inside the lane`, () => {
        const t = tracks[id], pit = t.pit, lay = L.pitLayout(t), sc = t.scale;
        const [lo, hi] = pit.garageSpan;
        assert.ok(pit.cum[lay.split.i0] <= lo && pit.cum[lay.split.i1] >= hi, 'split line covers the garage span');
        assert.deepStrictEqual(lay.edge, lay.split);
        const nBoxes = pit.garages.reduce((k, g) => k + g.boxes.length, 0);
        assert.strictEqual(lay.boxes.length, nBoxes, 'every box painted, skipped garages included');
        for (const b of lay.boxes) {
            assert.ok(/^[A-Z]{2,3}$/.test(b.code), `code ${b.code}`);
            const o = lateral(t, b), half = pit.width / sc / 2; // the working lane: the 5 m beside the garages (drive.js PIT_WORK_LANE_M)
            assert.ok(o - L.BOX_M.wide / 2 >= half - 5 - 0.05 && o + L.BOX_M.wide / 2 <= half + 0.05, `box ${b.teamId} at ${o.toFixed(2)} m: not in the working lane`);
            assert.ok(Math.abs(lateral(t, b.codeAt)) <= half, `code ${b.code} outside the lane`);
        }
        const boxEdge = Math.max(...lay.boxes.map((b) => lateral(t, b) + L.BOX_M.wide / 2));
        for (const c of lay.canopy) assert.ok(lateral(t, c) - 0.75 >= boxEdge + 1 - 0.05, 'canopy over the boxes');
        assert.strictEqual(lay.garages.length, pit.garages.length);
    });
}

const roles17 = ['gunFL', 'gunFR', 'gunRL', 'gunRR', 'offFL', 'offFR', 'offRL', 'offRR', 'onFL', 'onFR', 'onRL', 'onRR', 'jackF', 'jackR', 'stabL', 'stabR', 'lollipop'];
for (const id of Track.TRACK_IDS) {
    test(`${id}: wheel marks in every box, a 17-strong crew inside the lane, a wall stand per garage`, () => {
        const t = tracks[id], lay = L.pitLayout(t), sc = t.scale;
        for (const b of lay.boxes) {
            const marks = L.tMarks(b, sc);
            assert.strictEqual(marks.length, 4);
            const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
            marks.forEach((m, k) => { // wheelbase ±1.8 m along the box, track ±0.8 m across (left of the heading = +)
                const dx = (m.x - b.x) / sc, dy = (m.y - b.y) / sc, along = dx * fx + dy * fy, across = -dx * fy + dy * fx;
                assert.ok(Math.abs(along - (k < 2 ? 1.8 : -1.8)) < 1e-6 && Math.abs(across - (k % 2 ? -0.8 : 0.8)) < 1e-6, `mark ${k} at ${along.toFixed(3)}, ${across.toFixed(3)}`);
            });
            const crew = L.crew17(b, sc, t.pit.trackSide);
            assert.deepStrictEqual(crew.map((c) => c.role).sort(), [...roles17].sort());
            for (const c of crew) for (const at of [c.idle, c.work]) assert.ok(Math.abs(lateral(t, at)) <= t.pit.width / sc / 2 + 0.05, `${c.role} outside the lane`);
            for (const c of crew) if (/^(jackF|jackR|lollipop)$/.test(c.role)) assert.ok(lateral(t, c.idle) > 0, `${c.role} idles on the wrong side`);
            // Waiting crew stand clear of the car's way in and out (2.2 m corridor along the box)
            for (const c of crew) {
                const dx = (c.idle.x - b.x) / sc, dy = (c.idle.y - b.y) / sc, l = -dx * Math.sin(b.angle) + dy * Math.cos(b.angle);
                assert.ok(Math.abs(l) >= 1.1, `${c.role} idles in the car's path`);
            }
        }
        const standing = lay.garages.filter((g) => !g.skip).length, stands = L.wallStands(t);
        assert.strictEqual(stands.length, standing);
        for (const s of stands) { // on the lane side of the wall: nearer the lane than the wall point
            let q = null; // the wall point nearest the stand
            for (let i = 0; i < t.pit.wall.length - 1; i++) {
                const a = t.pit.wall[i], b = t.pit.wall[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
                const u = Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.y - a.y) * dy) / l2)), p = { x: a.x + u * dx, y: a.y + u * dy };
                if (!q || Math.hypot(s.x - p.x, s.y - p.y) < Math.hypot(s.x - q.x, s.y - q.y)) q = p;
            }
            assert.ok(L.distToPath(s, t.pit.path, false) < L.distToPath(q, t.pit.path, false), 'stand on the wrong side of the wall');
        }
    });
}

test('cardText: next set, auto, confirmations', () => {
    assert.deepStrictEqual(L.cardText({ compound: 'M', next: 'S', fitted: false }), { next: 'NEXT: S', confirm: '✓ SOFT ON NEXT STOP' });
    assert.deepStrictEqual(L.cardText({ compound: 'M', next: null, fitted: false }), { next: 'NEXT: H (auto)', confirm: null });
    assert.deepStrictEqual(L.cardText({ compound: 'H', next: null, fitted: false }), { next: 'NEXT: M (auto)', confirm: null });
    assert.deepStrictEqual(L.cardText({ compound: 'S', next: null, fitted: true }), { next: 'NEXT: M (auto)', confirm: '✓ SOFT FITTED' });
});

test('pickerOpen: grid, quali garage, pit approach and lane; never spectators or the lobby', () => {
    const base = { spectator: false, status: 'RACE', inPit: false, parked: false, toEntryM: 2000 };
    const open = (o) => L.pickerOpen({ ...base, ...o });
    assert.strictEqual(open({ status: 'COUNTDOWN' }), true);
    assert.strictEqual(open({ status: 'COUNTDOWN', spectator: true }), false);
    assert.strictEqual(open({ status: 'LOBBY' }), false);
    assert.strictEqual(open({ status: 'QUALIFYING', inPit: true, parked: true }), true);
    assert.strictEqual(open({ status: 'QUALIFYING', inPit: true, parked: false }), false);
    assert.strictEqual(open({ toEntryM: 450 }), true);
    assert.strictEqual(open({ toEntryM: 600 }), false);
    for (const phase of ['lane', 'guide', 'service']) assert.strictEqual(open({ inPit: true, phase }), true, phase);
    for (const phase of ['hold', 'out', null]) assert.strictEqual(open({ inPit: true, phase }), false, String(phase));
});

test('pickerOpen: a box call opens the tyre choice anywhere on the lap', () => {
    const base = { spectator: false, status: 'RACE', inPit: false, parked: false, toEntryM: 2000 };
    assert.strictEqual(L.pickerOpen({ ...base }), false);
    assert.strictEqual(L.pickerOpen({ ...base, boxCall: 'this' }), true);
    assert.strictEqual(L.pickerOpen({ ...base, boxCall: 'next', spectator: true }), false);
});

test('stop warning: from half distance on one compound, until boxed; last lap says so; nothing when the rule is off', () => {
    const base = { status: 'RACE', maxLaps: 6, tyreWear: true, lap: 3, compoundsUsed: ['M'], boxCall: null, inPit: false, finished: false };
    assert.match(L.stopWarning(base), /STOP REQUIRED/);
    assert.strictEqual(L.stopWarning({ ...base, lap: 2 }), null, 'before half distance');
    assert.match(L.stopWarning({ ...base, lap: 5 }), /LAST LAP/);
    assert.strictEqual(L.stopWarning({ ...base, compoundsUsed: ['M', 'H'] }), null, 'two compounds run');
    assert.strictEqual(L.stopWarning({ ...base, boxCall: 'this' }), null, 'stop called');
    assert.strictEqual(L.stopWarning({ ...base, inPit: true }), null, 'in the pits');
    assert.strictEqual(L.stopWarning({ ...base, tyreWear: false }), null, 'tyre wear off: no rule');
    assert.strictEqual(L.stopWarning({ ...base, maxLaps: 1, lap: 0 }), null, '1-lap race: no rule');
    assert.strictEqual(L.stopWarning({ ...base, status: 'QUALIFYING' }), null);
    assert.strictEqual(L.stopWarning({ ...base, maxLaps: 4, lap: 3 }), null, 'under 5 laps: a sprint, no rule');
    assert.match(L.stopWarning({ ...base, maxLaps: 5, lap: 4 }), /LAST LAP/, '5 laps: the rule applies');
    assert.strictEqual(L.stopWarning({ ...base, maxLaps: 5, lap: 1 }), null, '5 laps: not before half distance');
});

// No barrier through a garage: the generated barrier kept the pit lane's run-off (2 m) on both sides, the line the
// garage fronts stand on, so a concrete wall and its 3 m fence ran through the open bays of 12 circuits
for (const id of Track.TRACK_IDS) test(`${id}: no barrier runs through a garage`, () => {
    const t = tracks[id], sc = t.scale, bad = [];
    for (const g of L.pitLayout(t).garages.filter((g) => !g.skip)) {
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        for (const b of t.build.barriers) for (let i = 0; i + 1 < b.pts.length; i++) {
            const A = b.pts[i], B = b.pts[i + 1], len = Math.hypot(B.x - A.x, B.y - A.y), steps = Math.ceil(len / (0.5 * sc));
            for (let k = 0; k <= steps; k++) {
                const x = A.x + ((B.x - A.x) * k) / steps - g.x, y = A.y + ((B.y - A.y) * k) / steps - g.y;
                const a = (x * fx + y * fy) / sc, l = (-x * fy + y * fx) / sc; // along the lane, across (m)
                if (Math.abs(a) < 8.5 && Math.abs(l) < 2.3) { bad.push(g.teamId); k = steps; i = b.pts.length; }
            }
        }
    }
    assert.deepStrictEqual([...new Set(bad)], []);
});
