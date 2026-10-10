# Tyre Choice Panel & Real Pit Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players pick tyres from an always-on S/M/H panel (fitted at once on the grid and in the quali garage, next stop otherwise), draw a real-looking pit lane on all 14 maps, and make the player's own box unmistakable with a countdown, a pit crew and a lollipop board; show every car's compound on its tyres.

**Architecture:** One server rule change in `Game.setNextCompound`. A new pure client module `public/js/pitLayout.js` computes every pit marking, garage piece, canopy piece and crew spot, plus the box cue text and the picker-open rule, so node tests cover them; `game3d.js` only turns that into three.js meshes and HUD. Tyre band colours come from a per-instance colour on the already-batched wheel mesh.

**Tech Stack:** Node.js (`node:test`), browser ES modules, three.js, Socket.IO (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-10-pit-lane-tyre-choice-design.md`

## Global Constraints

- World units are metres × `track.scale`; the pit lane is 10 m wide on every circuit; `pit.trackSide` = s (±1), garages are on the `-s` side; `side(p, angle, off) = { x: p.x − sin(angle)·off, y: p.y + cos(angle)·off }` (same helper as game3d.js).
- Boxes stay where Track.build puts them (working-lane centre, 2.5 m from the lane centre on the garage side); nothing here changes the sim, the stop guide or the network packet.
- Box paint 7 × 3.4 m; team code in the 2 m gap ahead of the box (centre 4.5 m ahead); canopy 1.5 m deep from the garage front line (`ph + 2 m`) toward the lane, its lane-side edge ≥ boxes' garage-side edge + 1 m; lane split line and garage-row edge line 0.3 m wide over the garage span ± 9 m.
- Compound colours: S `#e10600`, M `#ffd12e`, H `#f2f2f2`.
- Picker expanded: race grid (status `COUNTDOWN`); qualifying while parked in your box; race from 500 m before `pit.entryS` and in the lane until 1 m past your box. Never for spectators.
- Immediate fit: race and `frozen`, or qualifying car within `PARK_M` of its box, no stop in progress, speed < 0.5 m/s. Race grid fit sets `compoundsUsed = [c]`; quali adds.
- Crew only at the player's own box while they are in the pit lane; ~7 figures, low-poly.
- Draw calls: at most +6 per track for the pit lane over today; crew adds at most 4 while shown.
- Never start/stop/touch a server on port 3232; browser checks use 3299 with the tab visible.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A spectator / overflow player pressing 1 / 2 / 3 on the grid must not change anyone's tyres or throw — pinned in Task 1 (unknown id ignored).
2. A qualifying car that missed its box and stopped a few metres off its mark must not get an instant fresh set — pinned in Task 1 (parked-off-mark test).
3. Circuits whose garages are skipped for run-off (Zandvoort, Sakhir) must still get painted boxes, codes and crew spots — pinned in Task 2 (all-circuit layout test).
4. Codes, crew and canopy must stay inside the 10 m lane / off the boxes on every circuit, including Monaco's shortened lane — pinned in Task 2.
5. The picker must open on the race grid and in the quali garage and stay shut for spectators and in the lobby — pinned in Task 2 (`pickerOpen` table test).

---

### Task 1: Tyre pick fits at once on the grid and in the quali box

**Files:**
- Modify: `src/game/Game.js` (`setNextCompound`, ~line 266)
- Test: `test/pitstop.test.js` (append)

**Interfaces:**
- Produces: `Game#setNextCompound(id, c)` — fits now when (race && frozen) or (quali && parked in box), otherwise sets `nextCompound`.

- [ ] **Step 1: Write the failing tests** — append to `test/pitstop.test.js` (it already defines `Track`, `Game`, `io`, `lp`, `RACE`; add `const Tyres = require('../public/js/sim/tyres.js');` at the top if not present, and use the file's quali settings object or `{ maxLaps: 3, qualifying: true, rng: () => 0.5 }` with the mode the existing quali tests use):

```js
test('grid: a tyre pick before lights out fits a fresh set and replaces the start set', () => {
    const t = Track.load('monza'), g = new Game(io, [lp('a')], t, RACE, () => {});
    const p = g.players.a;
    assert.ok(g.frozen, 'race starts frozen');
    p.wear = 0.3;
    g.setNextCompound('a', 'S');
    assert.strictEqual(p.compound, 'S');
    assert.strictEqual(p.wear, 0);
    assert.strictEqual(p.nextCompound, null);
    assert.deepStrictEqual(p.compoundsUsed, ['S']);
    assert.strictEqual(p.tyreGrip, Tyres.gripOf('S', 0));
    assert.strictEqual(p.wearPerM, Game.tyreWearPerM(g.settings, t, 'S'));
});

test('race under way: a pick only sets the next stop\'s set', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), RACE, () => {});
    g.frozen = false;
    g.setNextCompound('a', 'H');
    assert.strictEqual(g.players.a.compound, 'M');
    assert.strictEqual(g.players.a.nextCompound, 'H');
});

test('quali parked in the box: a pick fits now and adds to the compounds used', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), QUALI, () => {});
    const p = g.players.a;
    assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 1, 'quali car starts on its box');
    g.setNextCompound('a', 'S');
    assert.strictEqual(p.compound, 'S');
    assert.deepStrictEqual(p.compoundsUsed.sort(), ['M', 'S']);
});

test('quali: moving, mid-stop, or stopped off the mark → next set only', () => {
    const t = Track.load('monza'), sc = t.scale;
    for (const set of [
        (p) => { p.vx = 5 * sc; },                                  // driving away
        (p) => { p.stop = { phase: 'service', t: 2 }; },            // a stop in progress
        (p) => { p.x += Math.cos(p.angle) * 4 * sc; p.y += Math.sin(p.angle) * 4 * sc; }, // missed the mark by 4 m
    ]) {
        const g = new Game(io, [lp('a')], t, QUALI, () => {});
        const p = g.players.a;
        set(p);
        g.setNextCompound('a', 'H');
        assert.strictEqual(p.compound, 'M');
        assert.strictEqual(p.nextCompound, 'H');
    }
});

test('tyre picks: unknown driver or compound are ignored', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), RACE, () => {});
    assert.doesNotThrow(() => g.setNextCompound('ghost', 'S'));
    g.setNextCompound('a', 'X');
    assert.strictEqual(g.players.a.compound, 'M');
    assert.strictEqual(g.players.a.nextCompound, null);
});

test('grid change to softs, then no stop: still a one-compound finisher (+22 s)', () => {
    const g = new Game(io, [lp('a')], Track.load('monza'), RACE, () => {});
    g.setNextCompound('a', 'S');
    g.finishCar(g.players.a);
    assert.strictEqual(g.players.a.penalty, 22);
});
```

Define `QUALI` next to `RACE` if the file has none (match the settings the file's existing qualifying tests pass to `Game`).

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/pitstop.test.js`
Expected: FAIL — the grid and quali tests see `compound` still `M`.

- [ ] **Step 3: Implement** — replace `setNextCompound` in `src/game/Game.js`:

```js
    // A tyre pick (keys 1/2/3 or the HUD): fitted at once on the grid (lights on) or parked in the quali box, otherwise the
    // set for the next stop
    setNextCompound(id, c) {
        const p = this.players[id];
        if (!p || !Tyres.isCompound(c)) return;
        const sc = this.track.scale;
        const grid = this.mode === 'race' && this.frozen;
        const parked = this.mode === 'quali' && !p.stop && p.box && Math.hypot(p.x - p.box.x, p.y - p.box.y) < PARK_M * sc
            && Math.hypot(p.vx, p.vy) < 0.5 * sc;
        if (!grid && !parked) { p.nextCompound = c; return; }
        p.compound = c;
        p.nextCompound = null;
        p.wear = 0;
        p.wearPerM = Game.tyreWearPerM(this.settings, this.track, c);
        p.tyreGrip = Tyres.gripOf(c, 0);
        p.compoundsUsed = grid ? [c] : p.compoundsUsed.includes(c) ? p.compoundsUsed : [...p.compoundsUsed, c];
    }
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/pitstop.test.js` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/pitstop.test.js
git commit -m "Tyre picks fit a fresh set at once on the grid and parked in the quali box"
```

---

### Task 2: Pit layout module (pure)

**Files:**
- Create: `public/js/pitLayout.js`
- Modify: `public/js/game3d.js` (delete its `distToPath`, ~line 416, and import it from `./pitLayout.js`)
- Test: `test/pitLayout.client.test.js`

**Interfaces:**
- Produces (ES module exports):
  - `TEAM_CODES` (teamId → 3-letter code), `BOX_M = { len: 7, wide: 3.4 }`, `COMPOUND_COLORS = { S: '#e10600', M: '#ffd12e', H: '#f2f2f2' }`
  - `side(p, angle, off)`, `distToPath(p, path, closed = true)` (moved from game3d.js unchanged)
  - `pitLayout(t) → { split: { i0, i1 }, edge: { i0, i1 }, boxes: [{ teamId, code, x, y, angle, s, codeAt: { x, y } }], garages: [{ teamId, x, y, angle, s, skip, front: { x, y } }], canopy: [{ x, y, angle }] }`
  - `crewSpots(box, scale) → [{ role, x, y, angle }]` roles: `'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR' | 'jackF' | 'jackR' | 'lollipop'`
  - `boxCue(distM, speedMs, canStop) → string | null` (`canStop(m)` = can the car still stop within m metres)
  - `pickerOpen({ spectator, status, inPit, parked, toEntryM, boxDistM }) → boolean`

- [ ] **Step 1: Write the failing tests** — create `test/pitLayout.client.test.js`:

```js
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
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/pitLayout.client.test.js`
Expected: FAIL — `Cannot find module …/pitLayout.js`.

- [ ] **Step 3: Implement** — create `public/js/pitLayout.js`:

```js
// Pit lane layout for drawing (game3d.js buildPit) and the player's own-box cues. Pure — no three.js, no DOM — so node
// tests cover every circuit. World units (metres × track.scale); t = a built track, t.pit from Track.build; the garages are
// on the -pit.trackSide side of the lane.
export const TEAM_CODES = { redbull: 'RBR', ferrari: 'FER', mercedes: 'MER', alpine: 'ALP', mclaren: 'MCL', alfaromeo: 'ALF',
    astonmartin: 'AMR', haas: 'HAA', alphatauri: 'AT', williams: 'WIL', 'redbull-suzuka': 'RBR' };
export const BOX_M = { len: 7, wide: 3.4 };
export const COMPOUND_COLORS = { S: '#e10600', M: '#ffd12e', H: '#f2f2f2' };
const RUNOFF_M = 2, WALL_OFFSET = 80, GARAGE_BACK_M = 2.5, CANOPY_DEEP_M = 1.5, SPAN_PAD_M = 9, ENTRY_PICK_M = 500;

export const side = (p, angle, off) => ({ x: p.x - Math.sin(angle) * off, y: p.y + Math.cos(angle) * off });

export function distToPath(p, path, closed = true) {
    let best = Infinity;
    for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        let u = l2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        best = Math.min(best, Math.hypot(p.x - (a.x + u * (b.x - a.x)), p.y - (a.y + u * (b.y - a.y))));
    }
    return best;
}

const ahead = (p, angle, m) => ({ x: p.x + Math.cos(angle) * m, y: p.y + Math.sin(angle) * m });

export function pitLayout(t) {
    const pit = t.pit, sc = t.scale, s = pit.trackSide, back = pit.width / 2 + RUNOFF_M * sc;
    const [lo, hi] = pit.garageSpan, pad = SPAN_PAD_M * sc, n = pit.cum.length;
    let i0 = pit.cum.findIndex((c) => c >= lo - pad);
    i0 = Math.max(0, i0 > 0 && pit.cum[i0] > lo - pad ? i0 - 1 : i0);
    let i1 = n - 1;
    while (i1 > 0 && pit.cum[i1 - 1] >= hi + pad) i1--;
    const split = { i0, i1 };
    const garages = pit.garages.map((g) => {
        const c = side(g, g.angle, -s * (back + GARAGE_BACK_M * sc)), fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        // no building where it would stand on the track's run-off (Zandvoort, Sakhir: the track runs close behind the pits)
        const skip = [[-9, -2.5], [9, -2.5], [-9, 2.5], [9, 2.5]].some(([a, l]) =>
            distToPath({ x: c.x + (fx * a - fy * l) * sc, y: c.y + (fy * a + fx * l) * sc }, t.path) < t.width / 2 + (t.wallOffset ?? WALL_OFFSET));
        return { teamId: g.teamId, x: c.x, y: c.y, angle: g.angle, s: g.s, skip, front: side(g, g.angle, -s * back) };
    });
    const boxes = pit.garages.flatMap((g) => g.boxes.map((b) => ({
        teamId: g.teamId, code: TEAM_CODES[g.teamId] || g.teamId.slice(0, 3).toUpperCase(),
        x: b.x, y: b.y, angle: b.angle, s: b.s, codeAt: ahead(b, b.angle, (BOX_M.len / 2 + 1) * sc),
    })));
    const canopy = garages.filter((g) => !g.skip).map((g) => ({ ...side(g.front, g.angle, s * (CANOPY_DEEP_M / 2) * sc), angle: g.angle }));
    return { split, edge: { ...split }, boxes, garages, canopy };
}

// Around a car parked on its box: wheel men at the corners, jacks fore and aft, the lollipop ahead of the nose
const CREW = [['wheelFL', 1.8, 1.6], ['wheelFR', 1.8, -1.6], ['wheelRL', -1.8, 1.6], ['wheelRR', -1.8, -1.6],
    ['jackF', 3.6, 0], ['jackR', -3.6, 0], ['lollipop', 4.6, 0]];
export function crewSpots(box, scale) {
    return CREW.map(([role, a, l]) => {
        const p = side(ahead(box, box.angle, a * scale), box.angle, l * scale);
        return { role, x: p.x, y: p.y, angle: Math.atan2(box.y - p.y, box.x - p.x) }; // facing the car
    });
}

// HUD cue on the way to your box. distM: metres along the lane to the mark (< 0 past it); canStop(m): can the car stop in m
export function boxCue(distM, speedMs, canStop) {
    if (distM > 0.5) {
        if (!canStop(distM + 0.5)) return 'MISSED — GO AROUND';
        return canStop(distM - 3) ? `YOUR BOX ${Math.round(distM)} m` : 'BRAKE';
    }
    return distM < -1 && speedMs > 2 ? 'MISSED — GO AROUND' : null;
}

// When the tyre picker pops out (spec §1)
export function pickerOpen({ spectator, status, inPit, parked, toEntryM, boxDistM }) {
    if (spectator) return false;
    if (status === 'COUNTDOWN') return true;
    if (status === 'QUALIFYING') return !!(inPit && parked);
    if (status !== 'RACE') return false;
    if (inPit) return boxDistM !== null && boxDistM > -1;
    return toEntryM >= 0 && toEntryM <= ENTRY_PICK_M;
}
```

In `public/js/game3d.js`: delete the local `function distToPath(…) {…}` (~line 416) and add `import { distToPath } from './pitLayout.js';` with the other imports. Leave every caller unchanged.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pitLayout.client.test.js` → PASS (if a circuit fails a lane/canopy assertion, report its numbers — do not loosen the assertions; fix the layout constants only within the spec's values). Then `node --check public/js/game3d.js && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/pitLayout.js public/js/game3d.js test/pitLayout.client.test.js
git commit -m "Pure pit layout: lane lines, painted boxes, codes, garages, canopy, crew spots, box cue, picker rule"
```

---

### Task 3: Draw the real pit lane on every map

**Files:**
- Modify: `public/js/game3d.js` (`buildPit`, ~lines 630–690)
- Test: `node --check`, `npm test`; visuals in Task 7

**Interfaces:**
- Consumes: `pitLayout(t)`, `BOX_M`, `side` from `./pitLayout.js` (Task 2); existing helpers `strip`, `instanced`, `atlasPlanes`, `textPlane`, `pitY`, `facing`, `solid`, `teamInfo`, `mergeGeometries`.

- [ ] **Step 1: Import** — extend the Task 2 import: `import { distToPath, pitLayout, BOX_M } from './pitLayout.js';` (game3d.js keeps its own `side` const; both are the same formula).

- [ ] **Step 2: Lane lines** — in `buildPit`, after the two white edge strips, add:

```js
    const lay = pitLayout(t);
    // Fast lane | working lane (white) and the garage-row edge (yellow), along the garages
    const onSpan = (i) => inner(i) && i >= lay.split.i0 && i < lay.split.i1;
    world.add(strip(pit.path, half.map(() => -line / 2), half.map(() => line / 2), 0.86, onSpan, solid('#f2f2f2')));
    const yA = half.map((h) => -s * (h - line)), yB = half.map((h) => -s * (h - 2 * line));
    world.add(strip(pit.path, s > 0 ? yA : yB, s > 0 ? yB : yA, 0.86, onSpan, solid('#ffd400')));
```

- [ ] **Step 3: Replace the garage / box block** — replace everything from `const buildings = [], signs = [], marks = [];` to the end of `buildPit` with:

```js
    const shells = [], signs = [], doors = [], lit = [], roofs = [], paint = [], outlines = [], codes = [];
    const tc = (id) => teamInfo[id]?.chatColor || '#888888';
    for (const g of lay.garages) {
        if (g.skip) continue;
        const h = pitY(g.x, g.y), info = teamInfo[g.teamId] || { name: g.teamId };
        shells.push({ x: g.x, y: h, z: g.y, angle: -g.angle });
        // Open front: a dark doorway with the team-colour back wall lit inside it, facing the lane
        const d = side(g.front, g.angle, s * 0.02 * scale), e = side(g.front, g.angle, s * 0.04 * scale), rot = s > 0 ? -g.angle : Math.PI - g.angle;
        doors.push({ x: d.x, y: h + 2.75 * scale, z: d.y, angle: rot });
        lit.push({ x: e.x, y: h + 2.4 * scale, z: e.y, angle: rot, color: tc(g.teamId) });
        const f = side(g.front, g.angle, s * 0.1 * scale);
        signs.push({ text: info.name.toUpperCase(), x: f.x, y: 6.4 * scale + h, z: f.y, rotY: rot, bg: tc(g.teamId) });
    }
    for (const c of lay.canopy) roofs.push({ x: c.x, y: pitY(c.x, c.y) + 5.6 * scale, z: c.y, angle: -c.angle });
    for (const b of lay.boxes) {
        const h = pitY(b.x, b.y), dark = new THREE.Color(tc(b.teamId)).multiplyScalar(0.75);
        paint.push({ x: b.x, y: 0.8 + h, z: b.y, angle: -b.angle, color: dark });
        outlines.push({ x: b.x, y: 0.82 + h, z: b.y, angle: -b.angle });
        codes.push({ text: b.code, x: b.codeAt.x, y: 0.83 + h, z: b.codeAt.y, rotY: facing(b.angle), flat: true });
    }
    const add = (geo, mat, list) => { if (list.length) world.add(instanced(geo, mat, list)); };
    const shellMesh = instanced(new THREE.BoxGeometry(18 * scale, 12 * scale, 5 * scale), new THREE.MeshStandardMaterial({ color: 0x2b2f36 }), shells);
    shellMesh.castShadow = true;
    if (shells.length) world.add(shellMesh);
    add(new THREE.PlaneGeometry(16 * scale, 5.5 * scale), new THREE.MeshBasicMaterial({ color: 0x0b0d10 }), doors);
    add(new THREE.PlaneGeometry(14 * scale, 4.2 * scale), new THREE.MeshBasicMaterial({ color: 0xffffff }), lit);
    add(new THREE.BoxGeometry(18 * scale, 0.2 * scale, 1.5 * scale), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), roofs);
    const boxGeo = new THREE.PlaneGeometry(BOX_M.len * scale, BOX_M.wide * scale);
    boxGeo.rotateX(-Math.PI / 2);
    add(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), paint);
    // Car outline: four thin bars (5.4 × 2 m) laid flat
    const bar = (w, d, x, z) => { const q = new THREE.PlaneGeometry(w, d); q.rotateX(-Math.PI / 2); q.translate(x, 0, z); return q; };
    const lw = 0.15 * scale, ol = 5.4 * scale, ow = 2 * scale;
    const outlineGeo = mergeGeometries([bar(ol, lw, 0, ow / 2), bar(ol, lw, 0, -ow / 2), bar(lw, ow, ol / 2, 0), bar(lw, ow, -ol / 2, 0)]);
    add(outlineGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), outlines);
    if (signs.length) world.add(atlasPlanes(signs, 17 * scale, 1.6 * scale, '#888888'));
    if (codes.length) world.add(atlasPlanes(codes, 1.6 * scale, 1.2 * scale, 'rgba(0,0,0,0)'));
```

Before relying on per-placement `color` and `angle`, read `instanced()` (~line 575) to confirm the placement fields it supports (`x, y, z, angle, color` were used by the old marks); if `color` must be a string or a `THREE.Color`, adapt. If the plane faces render the wrong way (back-face culled from the lane), give that material `side: THREE.DoubleSide`. The building block keeps its original size and position (`lay.garages` uses the old formula).

- [ ] **Step 4: Verify**

Run: `node --check public/js/game3d.js && npm test` → OK, PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/game3d.js
git commit -m "Pit lane: fast/working lane lines, painted team boxes with codes, open lit garages and a canopy"
```

---

### Task 4: HUD tyre picker

**Files:**
- Modify: `public/index.html` (~line 230 `.cl-tyre`), `public/css/style.css` (~lines 790–796), `public/js/game3d.js` (key handler ~line 226, HUD tyre block ~line 1836)
- Test: `node --check`, `npm test`; behaviour in Task 7

**Interfaces:**
- Consumes: `pickerOpen` from `./pitLayout.js` (Task 2); player meta `compound`, `nextCompound`; `predictor.car` (`pitS`, `vx`, `vy`), `predictor.box` (`s`, `x`, `y`); `clientState.trackData.pit.entryS`; `trackIndex` from `./racingline.js` (already imported; read its signature).
- Produces: `pickTyre(c)` in game3d.js (used by keys and clicks).

- [ ] **Step 1: Markup** — replace the `.cl-tyre` div in `public/index.html` with:

```html
                        <div class="cl-tyre" id="tyre-picker">
                            <div class="tp-row"><button type="button" class="tp tyre-S" data-c="S">S<small>1</small></button><button type="button" class="tp tyre-M" data-c="M">M<small>2</small></button><button type="button" class="tp tyre-H" data-c="H">H<small>3</small></button></div>
                            <div id="tyre-wear"><i></i></div>
                            <small id="tyre-next" class="hidden">BOX — CHOOSE TYRES · 1 / 2 / 3</small>
                        </div>
```

- [ ] **Step 2: CSS** — replace the `#tyre-chip` rule and the `#tyre-next` rule in `public/css/style.css` with:

```css
.tp-row { display: flex; gap: 3px; }
.tp { width: 22px; height: 22px; border-radius: 50%; border: 3px solid; background: #111; display: grid; place-items: center; font: 700 10px/1 var(--font, sans-serif); cursor: pointer; padding: 0; opacity: 0.55; position: relative; }
.tp small { position: absolute; bottom: -9px; font-size: 7px; color: #cbd5e1; }
.tp.fit { opacity: 1; box-shadow: 0 0 0 2px #fff; }
.tp.next { opacity: 1; background: currentColor; color: #111 !important; }
#tyre-picker.open { position: fixed; right: 6%; top: 42%; transform: scale(1.9); transform-origin: right center; background: rgba(0,0,0,0.65); padding: 10px 12px 14px; border-radius: 8px; z-index: 5; }
#tyre-next { font-size: 8px; letter-spacing: 0.04em; margin-top: 6px; }
```

Keep the existing `.tyre-S/.tyre-M/.tyre-H`, `#tyre-wear` and `.cl-tyre` rules.

- [ ] **Step 3: One pick function** — in `game3d.js` replace the body of the "Next tyre set" key block with a call to a new top-level function, and wire the buttons:

```js
// A tyre pick (keys 1/2/3 or a click on the picker): fitted at once on the grid / in the quali box, else the next stop's set
function pickTyre(c) {
    if (isSpectator() || clientState.status === 'LOBBY') return;
    socket.emit('tyre_next', c);
    window.showBanner?.(`TYRES: ${{ S: 'SOFT', M: 'MEDIUM', H: 'HARD' }[c]}`, true);
}
document.getElementById('tyre-picker').addEventListener('click', (e) => { const c = e.target.closest('.tp')?.dataset.c; if (c) pickTyre(c); });
```

and in `onKey`: `if (down && !e.repeat && ['1', '2', '3'].includes(key)) pickTyre('SMH'[+key - 1]);`

- [ ] **Step 4: HUD update** — replace the two lines that update `tyre-chip` / `hudTyre` and `tyre-next` with (declare `let hudPick = '';` next to the other HUD caches and delete `hudTyre`):

```js
    const comp = me?.compound || 'M', next = me?.nextCompound || '';
    const car = predictor?.car, box = predictor?.box, td = clientState.trackData;
    const boxDistM = car && box && me?.inPit ? (box.s - (car.pitS || 0)) / td.scale : null;
    let toEntryM = Infinity;
    if (car && td?.pit && !me?.inPit) {
        const i = trackIndex(td.path, car.x, car.y, null), total = td.cum[td.path.length];
        toEntryM = ((((td.pit.entryS - td.cum[i]) % total) + total) % total) / td.scale;
    }
    const parked = boxDistM !== null && Math.abs(boxDistM) < 1 && Math.hypot(car.vx, car.vy) < 0.5 * td.scale;
    const open = pickerOpen({ spectator: isSpectator(), status: clientState.status, inPit: !!me?.inPit, parked, toEntryM, boxDistM });
    const key = `${comp}${next}${open}`;
    if (key !== hudPick) {
        hudPick = key;
        document.querySelectorAll('#tyre-picker .tp').forEach((b) => { b.classList.toggle('fit', b.dataset.c === comp); b.classList.toggle('next', b.dataset.c === next); });
        $('tyre-picker').classList.toggle('open', open);
        $('tyre-next').classList.toggle('hidden', !open);
    }
```

Keep the wear-bar lines. Adapt the `trackIndex` call to its real signature (it may want a last index for speed — pass `null` for a full search, or keep a cached index in a module variable the way the racing-line code does). If this block runs where `racing` is false (lobby), make sure it doesn't throw when `me`/`predictor`/`trackData` are missing.

- [ ] **Step 5: Verify**

Run: `node --check public/js/game3d.js && npm test` → OK, PASS. `grep -n "tyre-chip\|hudTyre" public` → no hits.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/css/style.css public/js/game3d.js
git commit -m "Tyre picker: S/M/H chips with keys, pops out on the grid, in the quali garage and before the pits"
```

---

### Task 5: Your box — outline, sign, countdown, crew and lollipop

**Files:**
- Modify: `public/js/game3d.js` (new `boxCues` block built once per session; per-frame update in the HUD tick), `public/index.html` (one HUD element), `public/css/style.css`
- Test: `node --check`, `npm test`; behaviour in Task 7

**Interfaces:**
- Consumes: `crewSpots`, `boxCue`, `BOX_M` from `./pitLayout.js`; `canStopOnMark(p, t, metres)` from `./sim/drive.js`; `predictor.box`, `predictor.car` (`pitS`, `vx`, `vy`, `stop`); `hudGoUntil` (existing GO timer); `teamInfo`; the player's username from `clientState.players[clientState.me]`.

- [ ] **Step 1: HUD element** — in `index.html` after `<div id="box-msg" class="hidden"></div>` add `<div id="box-cue" class="hidden"></div>`; CSS:

```css
#box-cue { position: absolute; top: 30%; left: 50%; transform: translateX(-50%); font: 800 22px/1 var(--font, sans-serif); color: #fff; background: rgba(0,0,0,0.55); padding: 8px 14px; border-radius: 6px; }
#box-cue.brake { background: #f59e0b; color: #111; }
#box-cue.missed { background: #e10600; }
```

- [ ] **Step 2: Build the cues once** — add to `game3d.js` (import `crewSpots, boxCue` alongside the other pitLayout imports and `canStopOnMark` from `./sim/drive.js`):

```js
// Your own box: a pulsing outline, a "BOX" sign and a pit crew with a lollipop board, shown only while you're in the lane
let boxCues = null, missedUntil = 0;
function buildBoxCues(box, teamId, name) {
    const g = new THREE.Group(), h = pitY(box.x, box.y), col = teamInfo[teamId]?.chatColor || '#888888';
    const bar = (w, d, x, z) => { const q = new THREE.PlaneGeometry(w, d); q.rotateX(-Math.PI / 2); q.translate(x, 0, z); return q; };
    const L = (BOX_M.len + 0.6) * scale, W = (BOX_M.wide + 0.6) * scale, lw = 0.3 * scale;
    const ring = new THREE.Mesh(mergeGeometries([bar(L, lw, 0, W / 2), bar(L, lw, 0, -W / 2), bar(lw, W, L / 2, 0), bar(lw, W, -L / 2, 0)]),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    ring.position.set(box.x, 0.9 + h, box.y);
    ring.rotation.y = -box.angle;
    const sign = textPlane(`BOX · ${name.toUpperCase()}`, 6 * scale, 1.4 * scale, col);
    sign.position.set(box.x, 7 * scale + h, box.y);
    sign.rotation.y = facing(box.angle);
    // Crew: capsule body + head, team colours; four tyres; the lollipop man's board (two faces)
    const body = new THREE.CapsuleGeometry(0.28 * scale, 1.0 * scale, 2, 6); body.translate(0, 0.78 * scale, 0);
    const head = new THREE.SphereGeometry(0.16 * scale, 6, 4); head.translate(0, 1.62 * scale, 0);
    const person = mergeGeometries([body, head]);
    const spots = crewSpots(box, scale);
    const crew = new THREE.InstancedMesh(person, new THREE.MeshStandardMaterial({ color: col }), spots.length);
    const tyres = new THREE.InstancedMesh(new THREE.TorusGeometry(0.3 * scale, 0.12 * scale, 6, 10), new THREE.MeshStandardMaterial({ color: 0x111111 }), 4);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 2.2 * scale), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    const brake = textPlane('BRAKE', 0.9 * scale, 0.9 * scale, '#e10600'), go = textPlane('GO', 0.9 * scale, 0.9 * scale, '#2a9d3f');
    const lol = spots.find((p) => p.role === 'lollipop'), board = new THREE.Group();
    board.add(pole, brake, go);
    pole.position.y = 1.1 * scale; brake.position.y = go.position.y = 2.3 * scale;
    brake.rotation.y = go.rotation.y = facing(box.angle) + Math.PI; // facing the arriving car
    board.position.set(lol.x, h, lol.y);
    g.add(ring, sign, crew, tyres, board);
    g.visible = false;
    world.add(g);
    return { g, ring, crew, tyres, board, brake, go, spots, h, box };
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
function updateBoxCues(me, racing) {
    const car = predictor?.car, box = predictor?.box, td = clientState.trackData;
    if (!boxCues && box && me) boxCues = buildBoxCues(box, me.teamId || clientState.players[clientState.me]?.teamId, clientState.players[clientState.me]?.username || '');
    const cueEl = $('box-cue');
    const show = !!(boxCues && racing && me?.inPit && car);
    if (boxCues) boxCues.g.visible = show;
    if (!show) { cueEl.classList.add('hidden'); return; }
    const st = car.stop, phase = st?.phase || null, go = performance.now() < hudGoUntil, now = performance.now();
    boxCues.ring.material.opacity = 0.55 + 0.45 * Math.sin(now / 180);
    // Crew: lean in during the change, step back at GO
    const toward = phase === 'service' ? 0.3 : go ? -0.5 : 0;
    boxCues.spots.forEach((p, k) => {
        const dx = boxCues.box.x - p.x, dy = boxCues.box.y - p.y, l = Math.hypot(dx, dy) || 1;
        tmpV.set(p.x + (dx / l) * toward * scale, boxCues.h, p.y + (dy / l) * toward * scale);
        tmpQ.setFromEuler(tmpE.set(0, -p.angle + Math.PI / 2, 0));
        boxCues.crew.setMatrixAt(k, tmpM.compose(tmpV, tmpQ, ONE));
        if (k < 4) { tmpV.y = boxCues.h + 0.3 * scale; boxCues.tyres.setMatrixAt(k, tmpM.compose(tmpV, tmpQ, ONE)); }
    });
    boxCues.crew.instanceMatrix.needsUpdate = true;
    boxCues.tyres.instanceMatrix.needsUpdate = true;
    // Lollipop: red BRAKE while you arrive, down during the stop, green GO at release
    boxCues.board.rotation.z = phase ? Math.PI / 2.2 : 0;
    boxCues.brake.visible = !phase && !go;
    boxCues.go.visible = go;
    // Countdown
    const dist = (box.s - (car.pitS || 0)) / td.scale, speed = Math.hypot(car.vx, car.vy) / td.scale;
    let text = phase || go ? null : boxCue(dist, speed, (m) => canStopOnMark(car, td, m));
    if (text?.startsWith('MISSED')) missedUntil = now + 2000;
    if (!text && now < missedUntil) text = 'MISSED — GO AROUND';
    cueEl.classList.toggle('hidden', !text);
    if (text) {
        cueEl.textContent = text;
        cueEl.classList.toggle('brake', text === 'BRAKE');
        cueEl.classList.toggle('missed', text.startsWith('MISSED'));
    }
}
```

Call `updateBoxCues(me, racing)` once per frame from the HUD tick, right after the `box-msg` lines. Reset `boxCues` when a session's world is torn down / rebuilt (find where `buildPit` is called for a new session and set `boxCues = null; missedUntil = 0;` there, removing the old group from `world` if it isn't already cleared with the world). Check the facing of the sign and boards in Task 7 and flip `+ Math.PI` if they face away.

- [ ] **Step 3: Verify**

Run: `node --check public/js/game3d.js && npm test` → OK, PASS.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/css/style.css public/js/game3d.js
git commit -m "Your box: pulsing outline, BOX sign, countdown to the mark, pit crew and lollipop board"
```

---

### Task 6: Tyre band colours show each car's compound

**Files:**
- Modify: `public/js/carModel.js:45` (band vertex colour), `public/js/game3d.js` (`updateWheelBatch`, ~line 1499)
- Test: `node --check`, `npm test`; visuals in Task 7

**Interfaces:**
- Consumes: `COMPOUND_COLORS` from `./pitLayout.js` (Task 2); `clientState.gameState[id].compound`.

- [ ] **Step 1: White band** — in `carModel.js` `wheelGeometries`, change the band colour `[1.0, 0.82, 0.0]` to `[1.0, 1.0, 1.0]` and update the comment above (`Pirelli compound band, coloured per car by the wheel batch's instance colour`).

- [ ] **Step 2: Per-car colour in the wheel batch** — in `updateWheelBatch` (game3d.js), keep a colour per compound and set it on the tyre part (the first sub-mesh, k = 0) for every instance:

```js
const compoundColor = Object.fromEntries(Object.entries(COMPOUND_COLORS).map(([c, hex]) => [c, new THREE.Color(hex)]));
```

(top level), and inside the per-wheel traverse, right after `mesh.setMatrixAt(counts[k - 1]++, o.matrixWorld)`:

```js
                if (k === 1) mesh.setColorAt(counts[0] - 1, compoundColor[clientState.gameState?.[id]?.compound] || compoundColor.M);
```

and after the loop: `if (wheelBatch[0].instanceColor) wheelBatch[0].instanceColor.needsUpdate = true;`. Import `COMPOUND_COLORS` with the other pitLayout imports. The rim part keeps no instance colour. The lobby preview car (built from `buildCar` without the batch) will show a white band — acceptable; note it in the report.

- [ ] **Step 3: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/carModel.js && npm test` → OK, PASS.

- [ ] **Step 4: Commit**

```bash
git add public/js/carModel.js public/js/game3d.js
git commit -m "Tyre bands show each car's compound colour"
```

---

### Task 7: Real-game check

**Files:** none unless a defect is found (fix it in the owning file; add a test where one fits).

- [ ] **Step 1:** Start `PORT=3299 node server.js` in the background. The Chrome tab must be visible (a hidden tab stops the game loop); ask the user to bring it to the front if `document.visibilityState` is `hidden`. Hard-refresh so the new JS/CSS load.
- [ ] **Step 2: Grid.** Race at Monza, 2 laps, qualifying off: before the lights the picker is popped out; click S → banner "TYRES: SOFT", chip S ringed, all cars' tyre bands red/yellow match their compounds.
- [ ] **Step 3: Pit lane look.** Drive (or place the camera) along the Monza and Monaco pit lanes: white split line, yellow edge line, solid team boxes with outlines and codes, open lit garages with names and the canopy, no z-fighting/flicker; screenshot both.
- [ ] **Step 4: Your stop.** Approaching the pit entry the picker pops out; press 3. In the lane: outline pulses, BOX sign with your name, crew and lollipop (red BRAKE) at your box, countdown "YOUR BOX … m" → "BRAKE"; brake: stop, board down, "BOX — 2.x s", then green GO, crew steps back, your tyre band turns white (hard), chip H. Drive past without braking once: "MISSED — GO AROUND".
- [ ] **Step 5: Qualifying.** Quali at Monaco: parked in the box the picker is open; click S → fitted at once (chip S, band red) before driving out.
- [ ] **Step 6: Perf.** F3 overlay: frame time with the pit lane on screen within 10 % of the previous branch (`feature/driver-help`) at the same spot; console free of errors. Stop the 3299 server; report with screenshots.
