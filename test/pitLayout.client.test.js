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
            const o = lateral(t, b);
            assert.ok(o > 0 && o + L.BOX_M.wide / 2 <= 5 + 0.05, `box ${b.teamId} at ${o.toFixed(2)} m: not in the working lane`);
            assert.ok(Math.abs(lateral(t, b.codeAt)) <= 5, `code ${b.code} outside the lane`);
            for (const c of L.crewSpots(b, sc, -pit.trackSide)) assert.ok(Math.abs(lateral(t, c)) <= 5 + 0.05, `${c.role} outside the lane`);
        }
        const boxEdge = Math.max(...lay.boxes.map((b) => lateral(t, b) + L.BOX_M.wide / 2));
        for (const c of lay.canopy) assert.ok(lateral(t, c) - 0.75 >= boxEdge + 1 - 0.05, 'canopy over the boxes');
        assert.strictEqual(lay.garages.length, pit.garages.length);
    });
}

test('crew: seven people around the box, all clear of the car corridor, jacks and lollipop on the garage side', () => {
    for (const g of [1, -1]) for (const angle of [0, 1.1]) {
        const box = { x: 5, y: -3, angle }, spots = L.crewSpots(box, 1, g);
        assert.deepStrictEqual(spots.map((s) => s.role).sort(), ['jackF', 'jackR', 'lollipop', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']);
        for (const s of spots) {
            const dx = s.x - box.x, dy = s.y - box.y;
            const fwd = dx * Math.cos(angle) + dy * Math.sin(angle), lat = -dx * Math.sin(angle) + dy * Math.cos(angle);
            assert.ok(Math.abs(lat) >= 1.1, `${s.role} in the car corridor (${lat.toFixed(2)} m)`);
            if (/jack|lollipop/.test(s.role)) assert.ok(Math.sign(lat) === g, `${s.role} not on the garage side`);
            assert.ok(Math.abs(s.ox * Math.sin(angle) * -1 + s.oy * Math.cos(angle) - Math.sign(lat)) < 1e-9, `${s.role} GO step not sideways-out`);
            if (s.role === 'lollipop') assert.ok(fwd > 4, 'lollipop ahead of the nose');
        }
    }
});

const roles17 = ['gunFL', 'gunFR', 'gunRL', 'gunRR', 'offFL', 'offFR', 'offRL', 'offRR', 'onFL', 'onFR', 'onRL', 'onRR', 'jackF', 'jackR', 'stabL', 'stabR', 'lollipop'];
for (const id of Track.TRACK_IDS) {
    test(`${id}: wheel marks in every box, a 17-strong crew inside the lane, a wall stand per garage`, () => {
        const t = tracks[id], lay = L.pitLayout(t), sc = t.scale;
        for (const b of lay.boxes) {
            const marks = L.tMarks(b, sc);
            assert.strictEqual(marks.length, 4);
            for (const m of marks) assert.ok(Math.hypot(m.x - b.x, m.y - b.y) / sc < Math.hypot(L.BOX_M.len, L.BOX_M.wide) / 2, 'mark outside its box');
            const crew = L.crew17(b, sc, t.pit.trackSide);
            assert.deepStrictEqual(crew.map((c) => c.role).sort(), [...roles17].sort());
            for (const c of crew) for (const at of [c.idle, c.work]) assert.ok(Math.abs(lateral(t, at)) <= 5 + 0.05, `${c.role} outside the lane`);
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

test('pickerOpen: grid, quali garage, pit approach; never spectators or the lobby', () => {
    const base = { spectator: false, status: 'RACE', inPit: false, parked: false, toEntryM: 2000, boxDistM: null };
    const open = (o) => L.pickerOpen({ ...base, ...o });
    assert.strictEqual(open({ status: 'COUNTDOWN' }), true);
    assert.strictEqual(open({ status: 'COUNTDOWN', spectator: true }), false);
    assert.strictEqual(open({ status: 'LOBBY' }), false);
    assert.strictEqual(open({ status: 'QUALIFYING', inPit: true, parked: true, boxDistM: 0 }), true);
    assert.strictEqual(open({ status: 'QUALIFYING', inPit: true, parked: false, boxDistM: 40 }), false);
    assert.strictEqual(open({ toEntryM: 450 }), true);
    assert.strictEqual(open({ toEntryM: 600 }), false);
    assert.strictEqual(open({ inPit: true, boxDistM: 80 }), true);
    assert.strictEqual(open({ inPit: true, boxDistM: -2 }), false);
    assert.strictEqual(open({ inPit: true, boxDistM: 0, phase: 'service', done: true }), true); // still choosing during the change
    assert.strictEqual(open({ inPit: true, boxDistM: 0, phase: 'hold', done: true }), false); // serviced
    assert.strictEqual(open({ inPit: true, boxDistM: -0.5, done: true }), false); // released, still on the box
});
