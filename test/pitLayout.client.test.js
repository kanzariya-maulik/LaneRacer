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
            for (const c of L.crewSpots(b, sc)) assert.ok(Math.abs(lateral(t, c)) <= 5 + 0.05, `${c.role} outside the lane`);
        }
        const boxEdge = Math.max(...lay.boxes.map((b) => lateral(t, b) + L.BOX_M.wide / 2));
        for (const c of lay.canopy) assert.ok(lateral(t, c) - 0.75 >= boxEdge + 1 - 0.05, 'canopy over the boxes');
        assert.strictEqual(lay.garages.length, pit.garages.length);
    });
}

test('crew: seven people around the box, lollipop ahead of the nose', () => {
    const box = { x: 0, y: 0, angle: 0 }, spots = L.crewSpots(box, 1);
    assert.deepStrictEqual(spots.map((s) => s.role).sort(), ['jackF', 'jackR', 'lollipop', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']);
    const lol = spots.find((s) => s.role === 'lollipop');
    assert.ok(lol.x > 4 && Math.abs(lol.y) < 0.01);
});

test('boxCue: distance, BRAKE when braking is due, MISSED when too late or past', () => {
    const stopsIn = (d) => (m) => m >= d; // the car needs d metres to stop
    assert.strictEqual(L.boxCue(120, 22, stopsIn(30)), 'YOUR BOX 120 m');
    assert.strictEqual(L.boxCue(31, 22, stopsIn(30)), 'BRAKE');
    assert.strictEqual(L.boxCue(20, 22, stopsIn(30)), 'MISSED — GO AROUND');
    assert.strictEqual(L.boxCue(-3, 15, stopsIn(30)), 'MISSED — GO AROUND');
    assert.strictEqual(L.boxCue(2, 1.5, stopsIn(0.5)), 'YOUR BOX 2 m'); // crawling onto the mark: no BRAKE flash
    assert.strictEqual(L.boxCue(0.2, 0, stopsIn(0)), null); // on the mark
    assert.strictEqual(L.boxCue(-3, 0.5, stopsIn(0)), null); // crawled just past and stopped: the guide handles it
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
});
