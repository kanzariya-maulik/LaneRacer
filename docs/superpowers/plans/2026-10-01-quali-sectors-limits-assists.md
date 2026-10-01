# Qualifying Format, Sectors, Track Limits & Assists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualifying becomes out-lap + 2 flying laps from the garages with the pit entry closed. Laps show three real sectors (purple/green/yellow). Track limits are enforced (quali lap deletion; race warnings, then +5 s). Grass is slower. Per-player Steering/Full assists help newer drivers.

**Architecture:**
- `Track.build` places checkpoints so the sector lines are checkpoints, precomputes safe corner speeds (`src/game/Assist.js`), and adds a pit-entry closure barrier.
- `CarPhysics.step` gains grass drag and the steering assist.
- `Game` owns the session rules: quali phases, sectors, limits, classification and braking assist.
- Lobby and socket plumbing carry `settings.qualifying` and `player.assist`.
- The client draws it all.

**Tech Stack:** Node 24, `node:test`, Three.js 0.186 (client).

**Spec:** `docs/superpowers/specs/2026-10-01-quali-sectors-limits-assists-design.md`

## Global Constraints

- Quali: out-lap + `QUALI_LAPS = 2` flying laps; `QUALI_MAX_S = 360`; best valid lap sets the grid; no-valid-lap cars last in join order.
- Pit entry closed in quali and race; barrier just before the first garage.
- Sectors: 3 per circuit, `sector2M`/`sector3M` in `circuits.json`; at least 3 checkpoints per sector, about 16 in total.
- Colours: purple = session best, green = personal best, yellow = slower, grey = lap invalid.
- Track limits: violation when the car centre is more than `width/2 + CAR_HALF_WIDTH_M·scale` from the centreline. It counts once per excursion and re-arms at `width/2`.
  - Quali: the lap is deleted.
  - Race: warnings 1–2, then +5 s each.
  - Results are re-sorted by finish time + penalty.
- Assists: `'off' | 'steering' | 'full'`; client default `'steering'`; server sanitises unknown values to `'off'`.
- No new npm dependencies. Commit after each task on `feature/3d-f1`. No `Co-Authored-By` or other trailers (user's `/commit` rule).

### Deviations from the spec (measured while planning)

1. **Steering assist strength: +60% lock, +30% grip**, not the spec's +40%/+15%. Measured: +40%/+15% gives a 17.1 m chicane radius at 100 km/h, missing the spec's own ≤ 16 m target. +60%/+30% gives 14.7 m (chicane) and 7.1 m (hairpin at 60 km/h). At 280 km/h there is no change (207.3 m either way).
2. **Grass drag is speed-proportional:** `0.25 · v` (1/s) on top of the asphalt rolling resistance, with drive capped at 0.3 g. The spec's constant 0.6 g drag with 0.3 g drive would leave a car stopped on the grass unable to move. Measured:
   - a 30 m cut at 150 km/h loses 24 km/h
   - 2 s of full throttle from 150 km/h ends at about 100 km/h
   - from rest it reaches about 28 km/h in 5 s (not stuck)
   - grass turning radius at 60 km/h is 13.7 m (existing test needs ≤ 24 m)
3. **Kerbs drive like asphalt:** physics asphalt extends 1.5 m past the track edge (the kerb width the client draws). Otherwise the much slower grass would punish normal kerb use. The track-limit line stays at `width/2 + 1 m` (centre), so a car fully on the kerb is still a violation.
4. **Braking-assist trigger:** it brakes when a corner ahead needs more than 70% of the car's braking grip at its current speed, `0.7 · μ · (g + downforce/m)`, instead of a fixed 2.5 g. Below about 150 km/h the car can't brake at 2.5 g at all, so a fixed threshold would trigger too late.
5. **Corner radius span:** the radius is taken from the points 2 indices behind and ahead, about 20 m each side (centreline points are 10 m apart), not exactly 15 m.
6. **Assist badge source:** the badge reads the lobby player record (`clientState.players[id].assist`), which every client already has. `game_state` doesn't carry `assist`.
7. **Race laps are invalidated too:** a race violation also sets `lapValid = false`, so that lap's sectors show grey and can't be a best. This makes the colours mean the same thing in both sessions.

### Researched sector lines (distance from the start line, m; all flagged unconfirmed)

| Circuit | S2 starts | Landmark | S3 starts | Landmark |
|---|---|---|---|---|
| monza | 2000 | after Curva Grande, before Roggia | 3900 | Serraglio straight, before Ascari |
| spa | 2300 | end of Kemmel straight, before Les Combes | 5300 | after Stavelot, before Blanchimont |
| silverstone | 1500 | Wellington Straight | 4100 | start of Hangar Straight |
| suzuka | 2200 | between Dunlop and Degner 1 | 4500 | back straight after Spoon |
| sakhir | 1650 | between T4 and T5 | 4000 | between T12 and T13 |

The corner positions come from the track data: Monza's chicane is at 929 m, Spa's La Source at 389 m. Each split gives roughly equal-time sectors, as in real F1.

## Review Focus

1. A car on the racing line past the pit-entry merge must not hit the closure barrier or be pushed off. Tested in Task 4.
2. A car leaving the pit exit onto the track must not trigger track limits. Tested in Task 6.
3. A disconnect mid-race must not block the final classification (re-sort uses only cars still present). Tested in Task 6.
4. A stored assist value that isn't in the client's option list must fall back to `'steering'` on the client and `'off'` on the server. Server tested in Task 7; client covered by the manual check.
5. A car already braking harder than the assist would must keep its own inputs (the assist never weakens braking). Tested in Task 7.

---

### Task 1: Track — sector checkpoints, pit-entry closure, safe corner speeds

**Files:**
- Create: `src/game/Assist.js` (`safeSpeeds` only in this task)
- Modify: `src/game/Track.js`, `data/tracks/circuits.json`
- Test: `test/track.test.js`, `test/assist.test.js` (new)

**Interfaces:**
- Produces:
  - `track.sectorCps`: `[0, i2, i3]`, the checkpoint indices where sectors 1, 2 and 3 start
  - `track.checkpoints`: re-spaced per sector
  - `track.safeSpeed`: `number[]` (m/s, ≤ 100), one per path point
  - `track.pit.closeS`: world units along the pit
  - `track.pit.closeWall`: `[{x, y}, {x, y}]`
- Produces: `Assist.safeSpeeds(path, scale) → number[]` and `Assist.DOWN`, `Assist.MAX_SAFE`.

- [ ] **Step 1: Add the sector facts to `data/tracks/circuits.json`.** For each circuit add `sector2M`/`sector3M` from the table above, add `"sector2M", "sector3M"` to `unconfirmed`, and append one source line. Example for monza (repeat with each circuit's values and landmarks):

```json
    "sector2M": 2000, "sector3M": 3900,
```
and in `sources`:
```json
    "sectors: by landmark from F1 circuit maps (S2 after Curva Grande before Roggia, S3 on the Serraglio straight before Ascari)"
```

Use these source lines for the others:
- spa: `"sectors: by landmark (S2 end of Kemmel before Les Combes, S3 after Stavelot before Blanchimont)"`
- silverstone: `"sectors: by landmark (S2 on Wellington Straight, S3 at the start of Hangar Straight)"`
- suzuka: `"sectors: by landmark (S2 between Dunlop and Degner 1, S3 on the back straight after Spoon)"`
- sakhir: `"sectors: by landmark (S2 between T4 and T5, S3 between T12 and T13)"`

- [ ] **Step 2: Write the failing tests.**

In `test/track.test.js`, replace the body of the `${id}: 16 checkpoints, first on the start line` test and rename it:

```js
    test(`${id}: checkpoints per sector, first on the start line`, () => {
        assert.ok(t.checkpoints.length >= 15 && t.checkpoints.length <= 19, `${t.checkpoints.length} checkpoints`);
        assert.strictEqual(t.checkpoints[0].x, t.start.x);
        assert.strictEqual(t.checkpoints[0].y, t.start.y);
        for (const cp of t.checkpoints) assert.strictEqual(cp.radius, t.width / 2 + 80);
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
        assert.ok(closeS < garageSpan[0] && closeS > garageSpan[0] - 11 * t.scale);
        const n = Physics.nearestOnPath(wall[0].x, wall[0].y, pp, false);
        assert.ok(closeS >= cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]) - 1, 'closure upstream of the pit wall');
        assert.strictEqual(closeWall.length, 2);
    });

    test(`${id}: safe corner speeds`, () => {
        assert.strictEqual(t.safeSpeed.length, t.path.length);
        for (const v of t.safeSpeed) assert.ok(v > 15 && v <= 100);
    });
```

and outside the loop, extend `a track without a pit lane still builds` with:

```js
    assert.deepStrictEqual(t.sectorCps.length, 3);
```

Create `test/assist.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const Assist = require('../src/game/Assist');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
const at = (m) => monza.safeSpeed[monza.cum.findIndex(c => c >= m * monza.scale)];

test('safe speed: flat out on the straight, ~90 km/h at the first chicane', () => {
    assert.strictEqual(at(300), Assist.MAX_SAFE);
    let min = Infinity;
    for (let m = 800; m < 1300; m += 10) min = Math.min(min, at(m));
    assert.ok(min * 3.6 > 70 && min * 3.6 < 110, `${(min * 3.6).toFixed(0)} km/h`);
});

test('safe speed: a straight line is flat out', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 60, y: 0 }));
    for (const v of Assist.safeSpeeds(line, 6).slice(3, -3)) assert.strictEqual(v, Assist.MAX_SAFE);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/track.test.js test/assist.test.js`
Expected: FAIL with `Cannot find module '../src/game/Assist'`, plus track failures on `sectorCps` undefined.

- [ ] **Step 4: Implement.** Create `src/game/Assist.js`:

```js
// Driving assists that need the track: corner speed map (braking assist added in Game)
const { C } = require('./CarPhysics');

const DOWN = (0.5 * C.RHO * C.CLA) / C.MASS; // downforce acceleration per (m/s)², in m/s² / (m/s)²
const MAX_SAFE = 100;                         // m/s (360 km/h): flat out
const SPAN = 2;                               // points each side (~20 m) for the corner radius

// Highest speed (m/s) the car's cornering grip holds at each centreline point
function safeSpeeds(path, scale) {
    const n = path.length, A = C.LAT_ASSIST * C.MU;
    return path.map((_, i) => {
        const a = path[(i - SPAN + n) % n], b = path[i], c = path[(i + SPAN) % n];
        const ab = Math.hypot(b.x - a.x, b.y - a.y) / scale;
        const bc = Math.hypot(c.x - b.x, c.y - b.y) / scale;
        const ca = Math.hypot(a.x - c.x, a.y - c.y) / scale;
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (scale * scale);
        const curvature = area2 > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0; // 1/R = 4·area/(abc)
        // v²/R = A·(g + DOWN·v²)  →  v² = A·g / (1/R − A·DOWN)
        const k = curvature - A * DOWN;
        return k > 0 ? Math.min(MAX_SAFE, Math.sqrt((A * C.G) / k)) : MAX_SAFE;
    });
}

module.exports = { DOWN, MAX_SAFE, safeSpeeds };
```

In `src/game/Track.js`:
- Add `const Assist = require('./Assist');` under the `Physics` require.
- Add the constants `const CLOSE_GAP_M = 10; // pit entry barrier this far before the first garage` and `const PIT_RUNOFF_M = 2; // matches Game.js`.

Replace the checkpoint loop in `build`:

```js
    // Checkpoints: the start line and both sector lines are checkpoints, the rest evenly spaced per sector
    const bounds = [
        0,
        circuit.sector2M != null ? circuit.sector2M * scale : total / 3,
        circuit.sector3M != null ? circuit.sector3M * scale : (2 * total) / 3,
        total,
    ];
    const checkpoints = [], sectorCps = [];
    for (let k = 0; k < 3; k++) {
        const len = bounds[k + 1] - bounds[k];
        const count = Math.max(3, Math.round((CHECKPOINT_COUNT * len) / total));
        sectorCps.push(checkpoints.length);
        for (let j = 0; j < count; j++) {
            const p = pointAt(pts, cum, startS + bounds[k] + (j * len) / count);
            checkpoints.push({ x: p.x, y: p.y, radius: width / 2 + WALL_OFFSET });
        }
    }
```

Change the `track` object line to include them:

```js
    const track = { id: raw.id, name: raw.name, scale, width, path: pts, cum, start, checkpoints, sectorCps, startPositions, safeSpeed: Assist.safeSpeeds(pts, scale), pit: null };
```

In `buildPit`, after `const garageSpan = …`:

```js
    // Pit entry closed (no pit stops): barrier across the lane just before the first garage
    const closeS = Math.max(wallLo, garageSpan[0] - CLOSE_GAP_M * scale);
    const cl = pointAt(pts, cum, closeS, false);
    const closeWall = [lateral(cl, trackSide * half), lateral(cl, -trackSide * (half + PIT_RUNOFF_M * scale))].map(({ x, y }) => ({ x, y }));
```

and add `closeS, closeWall,` to the returned object.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS. The `game.test.js` helpers use `cps.length` dynamically, and `socketManager.test.js` compares grid slots, which are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/game/Assist.js src/game/Track.js data/tracks/circuits.json test/track.test.js test/assist.test.js
git commit -m "Add real sector lines, pit entry closure and corner speed map"
```

---

### Task 2: CarPhysics — slower grass and steering assist

**Files:**
- Modify: `src/game/CarPhysics.js`
- Test: `test/carPhysics.test.js`

**Interfaces:**
- Produces: `CarPhysics.step(car, input, dt, scale, offTrack = false, assist = 'off')`. Any value other than `'off'` enables the steering boost.
- Produces: `C.GRASS_DRAG`, `C.GRASS_DRIVE_G`, `C.ASSIST_STEER`, `C.ASSIST_GRIP`, `C.ASSIST_FULL_KMH`, `C.ASSIST_OFF_KMH`. `C.GRASS_ROLL_G` is removed; its only user is `step`.

- [ ] **Step 1: Write the failing tests.** In `test/carPhysics.test.js`, change `pathRadius` to take an assist:

```js
function pathRadius(v, seconds, input = COAST_LOCK, assist = 'off') {
    const c = mk(v), d0 = vDir(c), n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) step(c, input, DT, S, false, assist);
    return (Math.hypot(c.vx, c.vy) / S) / ((vDir(c) - d0) / seconds);
}
```

and append:

```js
test('grass: a 30 m cut at 150 km/h on full throttle loses more than 20 km/h', () => {
    const c = mk(150 / 3.6);
    while (c.x / S < 30) step(c, FULL, DT, S, true);
    assert.ok(150 - kmh(c) > 20, `lost ${(150 - kmh(c)).toFixed(1)} km/h`);
});

test('grass: full throttle levels off below 110 km/h, and a stopped car can still drive away', () => {
    const fast = mk(150 / 3.6);
    for (let i = 0; i < 120; i++) step(fast, FULL, DT, S, true);
    assert.ok(kmh(fast) < 110, `${kmh(fast).toFixed(0)} km/h after 2 s`);
    const stopped = mk(0);
    for (let i = 0; i < 300; i++) step(stopped, FULL, DT, S, true);
    assert.ok(kmh(stopped) > 20, `${kmh(stopped).toFixed(0)} km/h after 5 s from rest`);
});

test('steering assist: chicane at 100 km/h ≤ 16 m, hairpin at 60 km/h ≤ 10 m', () => {
    const chicane = pathRadius(100 / 3.6, 0.5, { throttle: 0.3, brake: 0, steer: 1 }, 'steering');
    assert.ok(chicane <= 16, `chicane radius ${chicane} m`);
    const hairpin = pathRadius(60 / 3.6, 0.5, COAST_LOCK, 'steering');
    assert.ok(hairpin <= 10, `hairpin radius ${hairpin} m`);
});

test('steering assist changes nothing above 250 km/h', () => {
    const a = mk(260 / 3.6), b = mk(260 / 3.6);
    const input = { throttle: 1, brake: 0, steer: 0.4 };
    for (let i = 0; i < 30; i++) { step(a, input, DT, S, false, 'off'); step(b, input, DT, S, false, 'full'); }
    assert.deepStrictEqual([b.x, b.y, b.angle, b.vx, b.vy], [a.x, a.y, a.angle, a.vx, a.vy]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/carPhysics.test.js`
Expected: FAIL on the grass-cut test (about 6 km/h lost today), the level-off test, and the assist radius test (chicane about 20.1 m).

- [ ] **Step 3: Implement.** In `C`, replace `GRASS_ROLL_G: 0.25,` with:

```js
    GRASS_DRAG: 0.25,      // 1/s: grass slows the car by this × speed (stuck-free, unlike a flat drag)
    GRASS_DRIVE_G: 0.3,    // drive force on grass, in g (wheelspin)
    ASSIST_STEER: 0.6,     // steering assist: extra lock…
    ASSIST_GRIP: 0.3,      // …and extra cornering grip, full below ASSIST_FULL_KMH, none above ASSIST_OFF_KMH
    ASSIST_FULL_KMH: 150,
    ASSIST_OFF_KMH: 250,
```

Change the signature and the first lines of `step`:

```js
function step(car, input, dt, scale, offTrack = false, assist = 'off') {
    const mu = offTrack ? C.GRASS_MU : C.MU;

    let vx = car.vx / scale, vy = car.vy / scale;
    let fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    let vf = vx * fx + vy * fy;
    const v = Math.hypot(vx, vy);
    const roll = C.ROLL_G * C.G + (offTrack ? C.GRASS_DRAG * v : 0);
    const k = assist === 'off' ? 0 : Math.max(0, Math.min(1, (C.ASSIST_OFF_KMH - v * 3.6) / (C.ASSIST_OFF_KMH - C.ASSIST_FULL_KMH)));
    const downforce = 0.5 * C.RHO * C.CLA * v * v;
```

Change the drive line to:

```js
        ft += input.throttle * Math.min(C.POWER / Math.max(vf, 1), C.TRACTION * grip, offTrack ? C.GRASS_DRIVE_G * C.G * C.MASS : Infinity);
```

Change the `latAccel` and `maxSteer` lines to:

```js
    const latAccel = ((1 + C.ASSIST_GRIP * k) * C.LAT_ASSIST * Math.sqrt(Math.max(0, grip * grip - ft * ft))) / C.MASS;
```
```js
    const maxSteer = Math.min(((1 + C.ASSIST_STEER * k) * C.MAX_STEER) / (1 + Math.abs(vf) / C.STEER_FADE), lockForGrip);
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all, including the old `grass slows the car at least 0.25 g` (now about 0.76 g) and `on grass at 60 km/h full lock gets back within a 24 m radius` (13.7 m).

- [ ] **Step 5: Commit**

```bash
git add src/game/CarPhysics.js test/carPhysics.test.js
git commit -m "Slow cars on grass and add a low-speed steering assist"
```

---

### Task 3: Qualifying format — out-lap + 2 flying laps, 6-minute cap, on/off setting

**Files:**
- Modify: `src/game/Game.js`, `src/lobby.js`, `src/socketManager.js`
- Test: `test/game.test.js`, `test/lobby.test.js`, `test/socketManager.test.js`

**Interfaces:**
- Produces: `settings.qualifying` (bool) replacing `settings.qualiMinutes`. A quali car with `finished === true` is "done" (parked).
- Produces: `Game` constants `QUALI_LAPS = 2`, `QUALI_MAX_S = 360`. The `session` event at quali start reports `{ phase: 'QUALIFYING', endsInMs: 360000 }`.

- [ ] **Step 1: Migrate the settings in the tests.** In `test/game.test.js`, `test/lobby.test.js` and `test/socketManager.test.js`:
- replace `qualiMinutes: 0` with `qualifying: false`
- replace `qualiMinutes: N` (N ≥ 1) with `qualifying: true`

```bash
sed -i '' -E 's/qualiMinutes: 0/qualifying: false/g; s/qualiMinutes: [1-9][0-9]*/qualifying: true/g' test/game.test.js test/lobby.test.js
```

In `test/socketManager.test.js`, change the `join` helper so `0` means off and anything else on:

```js
function join(io, id, teamId, quali) {
    const s = io.connect(id);
    s.fire('join_lobby', { username: id.toUpperCase(), teamId });
    if (quali !== undefined) s.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualifying: !!quali });
    else s.fire('toggle_ready', true);
    return s;
}
```

Also in that file:
- change `t.mock.timers.tick((60 + 150) * 1000 + 100); // nobody ever crosses the line` to `t.mock.timers.tick(360 * 1000 + 100); // nobody ever crosses the line: the 6-minute cap ends quali`
- change `c.fire('update_settings', { qualiMinutes: 0 });` to `c.fire('update_settings', { qualifying: false });`

Replace the `sanitizeSettings clamps and ignores garbage` test in `test/lobby.test.js` (DEFAULTS becomes `{ trackId: 'monza', maxLaps: 3, qualifying: true }` via the sed):

```js
test('sanitizeSettings clamps and ignores garbage', () => {
    assert.deepStrictEqual(lobby.sanitizeSettings(DEFAULTS, null, TRACK_IDS), DEFAULTS);
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'monaco', maxLaps: '7', qualifying: 'yes', maxSpeedKmh: 300, evil: 1 }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 3, qualifying: true },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'spa', maxLaps: 0, qualifying: false }, TRACK_IDS),
        { trackId: 'spa', maxLaps: 1, qualifying: false },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { maxLaps: 4.6, qualiMinutes: 5 }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 5, qualifying: true },
    );
});
```

In `test/game.test.js`, delete these three tests:
- `quali: lap started before the flag counts, then that car is done`
- `quali ends when everyone has taken the flag, or 150 s after it`
- `quali: after the flag, a car that can no longer start a lap is done`

Add:

```js
test('quali: out-lap, then two timed laps, then the car is parked', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a;
    crossLine(g, a, 10);                    // end of the out-lap: timing starts
    assert.strictEqual(a.lapStart, 10);
    lap(g, a, 10, 90);
    close(a.lastLap, 90);
    assert.strictEqual(a.finished, false);
    lap(g, a, 100, 88);
    close(a.lastLap, 88);
    assert.strictEqual(a.finished, true, 'two flying laps should end the run');
    assert.strictEqual(a.lap, 2);
    close(a.bestLap, 88);
    a.input = { throttle: 1, brake: 0, steer: 0 };
    const x = a.x;
    g.update();
    assert.strictEqual(a.x, x, 'parked car moved');
    assert.strictEqual(a.speed, 0);
});

test('quali ends when every car is done, or 6 minutes after the start', () => {
    let results = null;
    const g = new Game(io, [lp('a'), lp('b')], monza, QUALI, (r) => { results = r; }, 'quali');
    g.players.a.finished = true;
    g.time = 300;
    g.update();
    assert.strictEqual(results, null);
    g.time = 360;
    g.update();
    assert.deepStrictEqual(results.map(r => r.id), ['a', 'b']);

    let all = null;
    const g2 = new Game(io, [lp('a'), lp('b')], monza, QUALI, (r) => { all = r; }, 'quali');
    g2.players.a.finished = true;
    g2.players.b.finished = true;
    g2.update();
    assert.ok(all);
});

test('quali session clock is the 6-minute cap', () => {
    const sessions = [];
    const io2 = { emit(ev, d) { if (ev === 'session') sessions.push(d); }, volatile: { emit() {} } };
    const g = new Game(io2, [lp('a')], monza, QUALI, () => {}, 'quali');
    g.start();
    g.stop();
    assert.deepStrictEqual(sessions, [{ phase: 'QUALIFYING', endsInMs: 360000 }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL. The parked-car test fails because there is no done state, the 6-minute test because the flag timing uses `NaN`, and lobby and socket tests fail on `qualifying` not being accepted.

- [ ] **Step 3: Implement.**

In `src/lobby.js`, replace the `qualiMinutes` line in `sanitizeSettings` with:

```js
    if (typeof incoming.qualifying === 'boolean') next.qualifying = incoming.qualifying;
```

In `src/socketManager.js`:
- the default settings become `{ trackId: 'monza', maxLaps: 3, qualifying: true }`
- `if (state.settings.qualiMinutes > 0) startQuali(io, racers);` becomes `if (state.settings.qualifying) startQuali(io, racers);`

In `src/game/Game.js`:
- Replace `const QUALI_CUTOFF_S = 150; …` with:

```js
const QUALI_LAPS = 2;       // flying laps after the out-lap
const QUALI_MAX_S = 360;    // quali ends at this session time even if someone never finishes
```

- In the constructor, delete the `this.flagAt = …` and `this.flagShown = false;` lines.
- In `start()`: `if (this.mode === 'quali') this.io.emit('session', { phase: 'QUALIFYING', endsInMs: QUALI_MAX_S * 1000 });`
- In `update()`, replace `if (this.mode === 'race' && p.finished) continue;` with `if (p.finished) continue; // finished race cars and parked quali cars stay put`.
- Delete the "After the flag a car with no lap running…" block and the `QUALI_FLAG` block.
- Change the `over` expression's quali branch to `: active === 0 || this.time >= QUALI_MAX_S;`.

Replace the quali tail of `checkLapProgress` (from `if (p.finished) return; // already took the chequered flag` to the end of the method) with:

```js
        if (p.finished) return;
        if (p.lapStart !== null) {
            p.lap++;
            this.recordLap(p);
            if (p.lap >= QUALI_LAPS) { // run complete: park the car
                p.finished = true;
                p.lapStart = null;
                p.vx = p.vy = p.speed = 0;
                return;
            }
            return;
        }
        p.lapStart = p.inPit ? null : this.time; // out-lap: timing starts at the first crossing after pit exit
    }
```

Note: `recordLap` already restarts `lapStart` at the line, so the second `return` keeps a flying lap running into the next one.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/lobby.js src/socketManager.js test/game.test.js test/lobby.test.js test/socketManager.test.js
git commit -m "Run qualifying as an out-lap plus two flying laps with a 6-minute cap"
```

---

### Task 4: Pit entry closed (physics)

**Files:**
- Modify: `src/game/Game.js` (`drive`)
- Test: `test/game.test.js`

**Interfaces:**
- Consumes: `track.pit.closeS` and `track.pit.closeWall` (Task 1).

- [ ] **Step 1: Write the failing tests** (append to `test/game.test.js`)

```js
const pitS = (p) => {
    const n = Physics.nearestOnPath(p.x, p.y, monza.pit.path, false);
    return monza.pit.cum[n.i] + n.t * (monza.pit.cum[n.i + 1] - monza.pit.cum[n.i]);
};
const pitPoint = (s) => Track.pointAt(monza.pit.path, monza.pit.cum, s, false);

test('pit entry is closed: driving up the pit lane stops before the garages', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, pitPoint(monza.pit.closeS - 30 * monza.scale), 20);
    p.input = FULL;
    for (let k = 0; k < 180; k++) {
        g.drive(p);
        assert.ok(pitS(p) < monza.pit.closeS, 'car got past the pit entry barrier');
    }
});

test('garage cars still drive out of the pit lane', () => {
    const g = new Game(io, [lp('a', 'redbull-suzuka')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a, s0 = pitS(p);
    p.input = FULL;
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.ok(pitS(p) - s0 > 10 * monza.scale, 'garage car could not drive off');
});

test('racing line past the pit entry is not blocked', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    const e = monza.pit.path[3], c = Physics.nearestOnTrack(e.x, e.y, monza);
    const ahead = Track.pointAt(monza.path, monza.cum, monza.cum[c.i]);
    place(p, { x: c.px, y: c.py, angle: ahead.angle }, 70);
    const x0 = p.x, y0 = p.y;
    for (let k = 0; k < 60; k++) g.drive(p);
    assert.ok(Math.hypot(p.x - x0, p.y - y0) / monza.scale > 50, 'track car was stopped by the pit barrier');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/game.test.js`
Expected: FAIL. `pit entry is closed` fails with "car got past the pit entry barrier". The other two pass already; they guard against over-blocking.

- [ ] **Step 3: Implement** in `Game.drive`. Change the pit-wall hit line to:

```js
        const hit = pit && (Physics.crossWall(x0, y0, p.x, p.y, pit.wall) || Physics.crossWall(x0, y0, p.x, p.y, pit.closeWall));
```

Change the `overPit` line to:

```js
        // The pit lane upstream of the closure barrier is off-limits (no pit stops)
        const afterS = afterPit && pit.cum[afterPit.i] + afterPit.t * (pit.cum[afterPit.i + 1] - pit.cum[afterPit.i]);
        const overPit = afterPit && afterS >= pit.closeS ? afterPit.dist - pitDist : Infinity;
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/game.test.js
git commit -m "Close the pit entry with a barrier before the garages"
```

---

### Task 5: Sector timing and colours (server)

**Files:**
- Modify: `src/game/Game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Consumes: `track.sectorCps` (Task 1).
- Produces player fields:
  - `sectors: [s1|null, s2|null, s3|null]`
  - `bestSectors: [..]`
  - `bestLapSectors: [..] | null`
  - `lapValid: bool`
  - `lastValid: bool | null`
  - `sectorStart: number | null`
- Produces: `game.bestSectors` (session).
- Produces event `sector` `{ id, lap, sector, time, valid, personalBest, sessionBest }` and `timing` with an extra `valid` field.
- `game_state` adds `lapValid`, `lastValid`, `bestLapSectors`.
- Produces: `Game.prototype.recordSector(p, n)`, `Game.prototype.newLap(p)`.

- [ ] **Step 1: Write the failing tests** (append to `test/game.test.js`)

```js
function spy() {
    const events = [];
    return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } };
}
const sectorsOf = (events, id) => events.filter(([ev, d]) => ev === 'sector' && d.id === id).map(([, d]) => d);

test('sectors: three per lap, adding up to the lap time, with personal and session bests', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a'), lp('b')], monza, QUALI, () => {}, 'quali');
    const { a, b } = g.players;
    crossLine(g, a, 10);
    lap(g, a, 10, 90);
    const s = sectorsOf(events, 'a');
    assert.deepStrictEqual(s.map(x => x.sector), [1, 2, 3]);
    close(s.reduce((sum, x) => sum + x.time, 0), 90);
    assert.ok(s.every(x => x.valid && x.personalBest && x.sessionBest));
    assert.deepStrictEqual(a.bestLapSectors, s.map(x => x.time));

    crossLine(g, b, 12);
    lap(g, b, 12, 80);
    assert.ok(sectorsOf(events, 'b').every(x => x.sessionBest), 'faster lap should set session bests');
    lap(g, a, 100, 95);
    const slow = sectorsOf(events, 'a').slice(3);
    assert.ok(slow.every(x => !x.personalBest && !x.sessionBest));
});

test('sectors: an invalid lap never sets a best; the out-lap is untimed', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a;
    a.checkpoint = 0; // on the out-lap, crossing sector lines before the start line
    lap(g, a, 0, 60);
    assert.strictEqual(sectorsOf(events, 'a').length, 0, 'out-lap produced sector times');
    lap(g, a, 60, 90);
    a.lapValid = false;
    lap(g, a, 150, 85);
    const bad = sectorsOf(events, 'a').filter(x => x.lap === 2);
    assert.ok(bad.length === 3 && bad.every(x => !x.valid && !x.personalBest && !x.sessionBest));
    close(a.bestLap, 90);
    assert.strictEqual(a.lastValid, false);
    const timing = events.filter(([ev]) => ev === 'timing').map(([, d]) => d);
    assert.strictEqual(timing.at(-1).valid, false);
});
```

Note on the second test: `lap()` from `checkpoint = 0` visits checkpoints 1…N−1, then 0, so the first call ends on the start line. That ends the out-lap and starts timing. The second call is flying lap 1 (90 s), the third is flying lap 2 (85 s, invalid).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/game.test.js`
Expected: FAIL. No `sector` events are emitted, and `bestLapSectors` is undefined.

- [ ] **Step 3: Implement** in `src/game/Game.js`.

In the constructor:
- after `this.winnerCount = 0;` add `this.bestSectors = [null, null, null]; // session bests, valid laps only`
- in the player object, after `bestLap: null,` add:

```js
                sectors: [null, null, null],
                bestSectors: [null, null, null],
                bestLapSectors: null,
                lapValid: true,
                lastValid: null,
                sectorStart: mode === 'race' ? 0 : null, // quali: untimed out-lap
```

Replace `recordLap` with:

```js
    recordLap(p) {
        const lapTime = this.time - p.lapStart;
        p.lastLap = lapTime;
        p.lastValid = p.lapValid;
        if (p.lapValid && (p.bestLap === null || lapTime < p.bestLap)) {
            p.bestLap = lapTime;
            p.bestLapSectors = [...p.sectors];
        }
        p.lapStart = this.time;
        this.io.emit('timing', { id: p.id, lap: p.lap, lapTime, bestLap: p.bestLap, valid: p.lapValid });
        this.newLap(p);
    }

    newLap(p) {
        p.sectors = [null, null, null];
        p.lapValid = true;
        p.sectorStart = this.time;
    }

    // Sector n (1–3) just ended; colours: session best > personal best > slower, invalid laps never count
    recordSector(p, n) {
        if (p.sectorStart === null) return; // out-lap
        const time = this.time - p.sectorStart, i = n - 1;
        const personalBest = p.lapValid && (p.bestSectors[i] === null || time < p.bestSectors[i]);
        const sessionBest = p.lapValid && (this.bestSectors[i] === null || time < this.bestSectors[i]);
        if (personalBest) p.bestSectors[i] = time;
        if (sessionBest) this.bestSectors[i] = time;
        p.sectors[i] = time;
        p.sectorStart = this.time;
        this.io.emit('sector', { id: p.id, lap: p.lap + 1, sector: n, time, valid: p.lapValid, personalBest, sessionBest });
    }
```

In `checkLapProgress`, replace `if (target !== 0) return;` with:

```js
        const sec = this.track.sectorCps.indexOf(target);
        if (sec > 0) this.recordSector(p, sec); // sector 1 or 2 ended
        if (target !== 0) return;
        if (!p.finished) this.recordSector(p, 3);
```

and in the quali tail, replace `p.lapStart = p.inPit ? null : this.time; // out-lap: …` with:

```js
        p.lapStart = p.inPit ? null : this.time; // out-lap: timing starts at the first crossing after pit exit
        if (p.lapStart !== null) this.newLap(p);
```

In the parked branch of Task 3's quali tail, also set `p.sectorStart = null;` next to `p.lapStart = null;`.

In `update()`'s `stateSync[id]`, add `lapValid: p.lapValid, lastValid: p.lastValid, bestLapSectors: p.bestLapSectors,`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all. The race lap-time test still passes: `sectorStart` starts at 0 like `lapStart`.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/game.test.js
git commit -m "Time three sectors per lap with personal and session bests"
```

---

### Task 6: Track limits, kerbs and race classification

**Files:**
- Modify: `src/game/Game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Produces player fields: `limits` (count), `penalty` (s), `offLimits` (bool), `finishTime`.
- Produces: `game_state` adds `penalty`.
- Produces event `track_limits` with one of these shapes:
  - `{ id, kind: 'deleted' }`
  - `{ id, kind: 'warning', count }`
  - `{ id, kind: 'penalty', penalty }`
- Produces: `Game.prototype.checkLimits(p, near)` and `Game.prototype.classify()`. Constants: `KERB_M = 1.5`, `LIMIT_WARNINGS = 2`, `LIMIT_PENALTY_S = 5`.

- [ ] **Step 1: Write the failing tests** (append to `test/game.test.js`)

```js
// A point beside Monza's start straight, on the side away from the pit lane, `m` metres from the centreline
const beside = (m) => {
    const s = monza.start, k = monza.pit.trackSide;
    return { x: s.x - Math.sin(s.angle) * k * m * monza.scale, y: s.y + Math.cos(s.angle) * k * m * monza.scale, angle: s.angle };
};
const halfM = monza.width / 2 / monza.scale;
function excursion(g, p) {
    for (const m of [halfM + 2, 0]) {
        const at = beside(m);
        p.x = at.x; p.y = at.y;
        g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    }
}

test('track limits: one violation per excursion, re-armed back on track', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a;
    const off = beside(halfM + 2);
    p.x = off.x; p.y = off.y;
    g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    assert.strictEqual(p.limits, 1);
    excursion(g, p);
    assert.strictEqual(p.limits, 2);
});

test('track limits: half a car past the line is not a violation', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a, at = beside(halfM + 0.5);
    p.x = at.x; p.y = at.y;
    g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    assert.strictEqual(p.limits, 0);
});

test('quali: leaving the track deletes the lap but it is still recorded', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a;
    crossLine(g, a, 10);
    excursion(g, a);
    assert.strictEqual(a.lapValid, false);
    assert.ok(events.some(([ev, d]) => ev === 'track_limits' && d.kind === 'deleted'));
    lap(g, a, 10, 80);
    close(a.lastLap, 80);
    assert.strictEqual(a.bestLap, null);
    lap(g, a, 90, 95);
    close(a.bestLap, 95);
});

test('track limits: quali out-lap and pit lane are exempt', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a; // out-lap: lapStart null
    excursion(g, a);
    a.lapStart = 5;
    a.inPit = true;
    const off = beside(halfM + 2);
    a.x = off.x; a.y = off.y;
    g.checkLimits(a, Physics.nearestOnTrack(a.x, a.y, monza));
    assert.strictEqual(a.lapValid, true);
});

test('race: two warnings, then +5 s per violation', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a;
    for (let k = 0; k < 4; k++) excursion(g, p);
    const kinds = events.filter(([ev]) => ev === 'track_limits').map(([, d]) => d);
    assert.deepStrictEqual(kinds.map(d => d.kind), ['warning', 'warning', 'penalty', 'penalty']);
    assert.deepStrictEqual(kinds.slice(0, 2).map(d => d.count), [1, 2]);
    assert.strictEqual(p.penalty, 10);
});

test('race result is re-sorted by finish time plus penalty', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas')], monza, { maxLaps: 1, qualifying: false }, () => {});
    g.release();
    const { a, b } = g.players;
    a.penalty = 10;
    lap(g, a, 0, 100);
    lap(g, b, 0, 105);
    assert.strictEqual(a.finishOrder, 1, 'a took the flag first');
    g.update();
    assert.strictEqual(b.finishOrder, 1);
    assert.strictEqual(a.finishOrder, 2);
    assert.strictEqual(b.rank, 1);
});

test('race classification works after a driver disconnects', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas')], monza, { maxLaps: 1, qualifying: false }, () => {});
    g.release();
    lap(g, g.players.a, 0, 100);
    g.removePlayer('b');
    g.update();
    assert.strictEqual(g.players.a.finishOrder, 1);
});

test('kerbs drive like asphalt; further out is grass', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    for (const [m, asphalt] of [[halfM + 1, true], [halfM + 3, false]]) {
        place(p, beside(m), 40);
        p.input = FULL;
        const ref = { ...p };
        g.drive(p);
        CarPhysics.step(ref, FULL, g.dt, monza.scale, false);
        assert.strictEqual(Math.abs(p.speed - ref.speed) < 1e-9, asphalt, `${m.toFixed(1)} m from the centre`);
    }
});

test('leaving the pit exit onto the track is not a track-limits violation', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a, pit = monza.pit;
    for (let i = pit.path.length - 30; i < pit.path.length; i++) {
        p.x = pit.path[i].x; p.y = pit.path[i].y;
        g.updatePit(p);
        g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    }
    assert.strictEqual(p.limits, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/game.test.js`
Expected: FAIL with `g.checkLimits is not a function`. The classification test fails on `b.finishOrder`, and the kerb test fails at 1 m (grass physics today).

- [ ] **Step 3: Implement** in `src/game/Game.js`. Constants under `PIT_RUNOFF_M`:

```js
const KERB_M = 1.5;          // kerbs past the track edge drive like asphalt
const LIMIT_WARNINGS = 2;    // race: violations before penalties start
const LIMIT_PENALTY_S = 5;
```

In the player object, add `limits: 0, penalty: 0, offLimits: false, finishTime: null,`.

In `drive`, change the grass test to include the kerb:

```js
        const grass = before.dist > t.width / 2 + KERB_M * scale && !(beforePit && beforePit.dist <= pit.width / 2);
```

and after `if (pit) this.updatePit(p, after, afterPit);` add:

```js
        this.checkLimits(p, after);
```

Add the methods:

```js
    // All four wheels past the white line, once per excursion; pit lane, quali out-lap exempt
    checkLimits(p, near) {
        const t = this.track;
        if (near.dist <= t.width / 2) { p.offLimits = false; return; }
        if (p.offLimits || p.inPit || near.dist <= t.width / 2 + Physics.CAR_HALF_WIDTH_M * t.scale) return;
        if (this.mode === 'quali' && (p.lapStart === null || p.finished)) return;
        p.offLimits = true;
        p.lapValid = false;
        if (this.mode === 'quali') {
            this.io.emit('track_limits', { id: p.id, kind: 'deleted' });
            return;
        }
        p.limits++;
        if (p.limits <= LIMIT_WARNINGS) {
            this.io.emit('track_limits', { id: p.id, kind: 'warning', count: p.limits });
            return;
        }
        p.penalty += LIMIT_PENALTY_S;
        this.io.emit('track_limits', { id: p.id, kind: 'penalty', penalty: p.penalty });
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: +${LIMIT_PENALTY_S}s track limits penalty (total +${p.penalty}s)` });
    }

    // Final result: finish time plus penalties, once every car has finished
    classify() {
        this.classified = true;
        const list = Object.values(this.players).sort((a, b) => a.finishTime + a.penalty - (b.finishTime + b.penalty));
        const changed = list.some((p, i) => p.finishOrder !== i + 1);
        list.forEach((p, i) => { p.finishOrder = i + 1; });
        if (changed) {
            this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `Result after penalties: ${list.map((p, i) => `P${i + 1} ${p.username}`).join(', ')}` });
        }
    }
```

In the race finish branch of `checkLapProgress`, add `p.finishTime = this.time;` after `p.finished = true;`.

In `update()`, just before `this.updateRanks();`:

```js
        if (this.mode === 'race' && !this.classified && ids.length && ids.every(id => this.players[id]?.finished)) this.classify();
```

Note: `ids` is captured at the start of `update()`. A player removed mid-tick is skipped by `?.`, and `classify()` re-reads `this.players`.

In `stateSync[id]`, add `penalty: p.penalty,`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all. If an older test now records an unexpected violation (a test that drives a car off the track), check that its scenario really leaves the track. The existing wall tests leave the track at race time, which is a legitimate violation and doesn't change what they assert.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/game.test.js
git commit -m "Enforce track limits, drive kerbs as asphalt, classify race with penalties"
```

---

### Task 7: Assists — lobby choice and braking assist

**Files:**
- Modify: `src/lobby.js`, `src/socketManager.js`, `src/game/Game.js`, `src/game/Assist.js`
- Test: `test/lobby.test.js`, `test/socketManager.test.js`, `test/assist.test.js`, `test/game.test.js`

**Interfaces:**
- Produces: `lobby.ASSISTS`, `lobby.sanitizeAssist(a) → 'off'|'steering'|'full'`.
- Produces: socket `join_lobby` accepts `assist`; new event `set_assist` (string, lobby only). The player record has an `assist` field.
- Produces: `Assist.brakeAssist(car, input, track, near) → input`, where `near` is `Physics.nearestOnTrack` output. It returns the same object when no braking is needed.
- Game players carry `assist`.

- [ ] **Step 1: Write the failing tests.**

Append to `test/lobby.test.js`:

```js
test('sanitizeAssist', () => {
    for (const a of ['off', 'steering', 'full']) assert.strictEqual(lobby.sanitizeAssist(a), a);
    for (const bad of [undefined, null, 'FULL', 'auto', 3, {}]) assert.strictEqual(lobby.sanitizeAssist(bad), 'off');
});
```

Append to `test/socketManager.test.js`:

```js
test('assist chosen on join and changed in the lobby; garbage becomes off', () => {
    const io = fakeIo();
    setupSocketManager(io);
    const s = io.connect('a');
    s.fire('join_lobby', { username: 'A', teamId: 'ferrari', assist: 'full' });
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'full');
    s.fire('set_assist', 'bogus');
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'off');
    s.fire('set_assist', 'steering');
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'steering');
    s.fire('disconnect');
});
```

Append to `test/game.test.js`:

```js
test('assist choice reaches the car', () => {
    const g = new Game(io, [{ ...lp('a'), assist: 'full' }, lp('b', 'haas')], monza, RACE, () => {});
    assert.strictEqual(g.players.a.assist, 'full');
    assert.strictEqual(g.players.b.assist, 'off');
});
```

Append to `test/assist.test.js`:

```js
const Physics = require('../src/game/Physics');
const CarPhysics = require('../src/game/CarPhysics');

// Flat out from 200 m down Monza's straight toward the first chicane (car keeps straight; the straight is straight)
function runToChicane(useAssist) {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 300 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    let apex = 0, min = Infinity;
    for (let i = 0; i < monza.path.length; i++) {
        const m = monza.cum[i] / monza.scale;
        if (m > 800 && m < 1300 && monza.safeSpeed[i] < min) { min = monza.safeSpeed[i]; apex = monza.cum[i]; }
    }
    const FULL = { throttle: 1, brake: 0, steer: 0 };
    for (let k = 0; k < 60 * 20; k++) {
        const near = Physics.nearestOnTrack(car.x, car.y, monza);
        if (monza.cum[near.i] >= apex) return { speed: car.speed / monza.scale, safe: min };
        const input = useAssist ? Assist.brakeAssist(car, FULL, monza, near) : FULL;
        CarPhysics.step(car, input, 1 / 60, monza.scale, false, useAssist ? 'full' : 'off');
    }
    throw new Error('never reached the chicane');
}

test('braking assist: flat out from 300 km/h, the car is at or below the chicane safe speed', () => {
    const { speed, safe } = runToChicane(true);
    assert.ok(speed <= safe * 1.05, `${(speed * 3.6).toFixed(0)} km/h vs safe ${(safe * 3.6).toFixed(0)}`);
    const off = runToChicane(false);
    assert.ok(off.speed > off.safe * 1.5, 'without the assist the car should arrive far too fast');
});

test('braking assist leaves the driver alone on a straight and never weakens braking', () => {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 150 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    const near = Physics.nearestOnTrack(car.x, car.y, monza);
    const input = { throttle: 1, brake: 0, steer: 0.2 };
    assert.strictEqual(Assist.brakeAssist(car, input, monza, near), input);
    const braking = { throttle: 0, brake: 1, steer: 0 };
    assert.strictEqual(Assist.brakeAssist(car, braking, monza, near).brake, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL with `lobby.sanitizeAssist is not a function`, `Assist.brakeAssist is not a function`, `assist` undefined on the socket player, and `g.players.a.assist` undefined.

- [ ] **Step 3: Implement.**

`src/lobby.js`, before `module.exports`:

```js
const ASSISTS = ['off', 'steering', 'full'];
function sanitizeAssist(assist) {
    return ASSISTS.includes(assist) ? assist : 'off';
}
```

and add `ASSISTS, sanitizeAssist` to the exports.

`src/socketManager.js`:
- in `join_lobby`'s player object, after `color: check.team.chatColor,`, add `assist: lobby.sanitizeAssist(data.assist),`
- after the `toggle_ready` handler, add:

```js
        socket.on('set_assist', (assist) => {
            const player = state.players[socket.id];
            if (!player || state.status !== 'LOBBY') return;
            player.assist = lobby.sanitizeAssist(assist);
            io.emit('lobby_state_sync', lobbySnapshot());
        });
```

`src/game/Assist.js`, before `module.exports`:

```js
const BRAKE_MARGIN = 0.7;  // brake when a corner ahead needs this share of the car's braking grip
const LOOK_EXTRA_M = 30;

// Full assist: lift and brake when a corner ahead can't be made at this speed; the driver still steers
function brakeAssist(car, input, track, near) {
    const { path, cum, safeSpeed, scale } = track;
    const v = car.speed / scale;
    if (v < 5 || input.brake >= 1) return input;
    const cap = BRAKE_MARGIN * C.MU * (C.G + DOWN * v * v);
    const reach = (v * v) / (2 * BRAKE_MARGIN * C.MU * C.G) + LOOK_EXTRA_M;
    const n = path.length, total = cum[n];
    const here = cum[near.i] + near.t * (cum[near.i + 1] - cum[near.i]);
    for (let k = 1; k <= n; k++) {
        const j = (near.i + k) % n;
        const d = ((((cum[j] - here) % total) + total) % total) / scale;
        if (d > reach) break;
        const s = safeSpeed[j];
        if (v > s && (v * v - s * s) / (2 * Math.max(d, 1)) > cap) return { throttle: 0, brake: 1, steer: input.steer };
    }
    return input;
}
```

and export `brakeAssist` too: `module.exports = { DOWN, MAX_SAFE, safeSpeeds, brakeAssist };`.

`src/game/Game.js`:
- add `const Assist = require('./Assist');` under the other requires
- in the player object, add `assist: p.assist || 'off',`
- in `drive`, replace `CarPhysics.step(p, p.input, this.dt, scale, grass);` with:

```js
        const input = p.assist === 'full' && !p.inPit ? Assist.brakeAssist(p, p.input, t, before) : p.input;
        CarPhysics.step(p, input, this.dt, scale, grass, p.assist);
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add src/lobby.js src/socketManager.js src/game/Game.js src/game/Assist.js test/lobby.test.js test/socketManager.test.js test/assist.test.js test/game.test.js
git commit -m "Add per-player steering and braking assists"
```

---

### Task 8: Client — lobby controls, sectors, limits messages, closed pit, badges

**Files:**
- Modify: `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/socket.js`, `public/js/game3d.js`

**Interfaces:**
- Consumes:
  - `settings.qualifying`
  - player `assist`
  - events `sector`, `track_limits`, `timing.valid`
  - `game_state` fields `lapValid`, `lastValid`, `bestLapSectors`, `penalty`, `finished`, `lap`
  - `track.pit.closeS`, `track.pit.closeWall`

- [ ] **Step 1: Markup** (`public/index.html`).

Replace the `<select id="setting-quali">…</select>` options with:

```html
                                <select id="setting-quali">
                                    <option value="1" selected>On (out-lap + 2 laps)</option>
                                    <option value="0">Off</option>
                                </select>
```

After the team picker `</div>` (before `<button id="btn-join"`):

```html
                    <label class="assist-picker">Assists:
                        <select id="assist-select">
                            <option value="off">Off</option>
                            <option value="steering" selected>Steering</option>
                            <option value="full">Full (steering + braking)</option>
                        </select>
                    </label>
```

Inside `<div id="lap-times">`, after the BEST line:

```html
                    <div id="sector-panel"><span class="sec" id="sec-1">S1</span><span class="sec" id="sec-2">S2</span><span class="sec" id="sec-3">S3</span></div>
```

After `<div id="pit-limiter" …></div>`:

```html
            <div id="sector-flash" class="hidden"></div>
            <div id="race-msg" class="hidden"></div>
```

- [ ] **Step 2: Styles** (append to `public/css/style.css`)

```css
.assist-picker { display: block; margin: 10px 0; }
#sector-panel { display: flex; gap: 8px; margin-top: 4px; font-family: monospace; }
.sec { color: #cbd5e1; }
.sec-purple { color: #c084fc; }
.sec-green { color: #4ade80; }
.sec-yellow { color: #facc15; }
.sec-grey { color: #6b7280; }
.t-red { color: #f87171; }
#sector-flash { position: absolute; top: 34%; left: 50%; transform: translateX(-50%); font: 800 28px monospace; text-shadow: 0 2px 6px #000; }
#race-msg { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); background: rgba(200, 20, 20, 0.9); color: #fff; font-weight: 800; letter-spacing: 1px; padding: 8px 18px; border-radius: 4px; }
.tt-sectors { display: inline-flex; gap: 2px; margin: 0 6px; }
.tt-sectors i { display: inline-block; width: 10px; height: 4px; background: #4b5563; }
.tt-sectors i.sb-purple { background: #c084fc; }
.tt-sectors i.sb-yellow { background: #facc15; }
```

- [ ] **Step 3: Lobby logic** (`public/js/app.js`).

Under the other element lookups:

```js
const assistSelect = document.getElementById('assist-select');
try { assistSelect.value = localStorage.getItem('lanrace.assist') || 'steering'; } catch (e) { /* storage blocked: keep the default */ }
if (!assistSelect.value) assistSelect.value = 'steering'; // stored value no longer an option
assistSelect.addEventListener('change', () => {
    try { localStorage.setItem('lanrace.assist', assistSelect.value); } catch (e) { /* not persisted */ }
    if (isJoined) socket.emit('set_assist', assistSelect.value);
});
const assistBadge = (p) => (p && p.assist === 'full' ? ' [F]' : p && p.assist === 'steering' ? ' [S]' : '');
window.assistBadge = assistBadge;
```

Change the join emit to `socket.emit('join_lobby', { username, teamId: selectedTeam, assist: assistSelect.value });`.

In `emitSettings`, replace the `qualiMinutes` line with `qualifying: setQuali.value === '1'`. In the settings UI, replace `setQuali.value = clientState.settings.qualiMinutes;` with `setQuali.value = clientState.settings.qualifying ? '1' : '0';`.

In `updateLobbyUI`, change the name line to:

```js
        nameNode.textContent = player.username + assistBadge(player) + (id === myId ? ' (You)' : '');
```

- [ ] **Step 4: Socket state** (`public/js/socket.js`).

In `clientState`, set `settings: { trackId: 'monza', maxLaps: 3, qualifying: true },` and add:

```js
    sessionBest: [null, null, null], // fastest valid sector times this session
    mySectors: [null, null, null],   // current lap: { time, cls }
    myBestSectors: [null, null, null],
```

In the `game_init` handler, reset them:

```js
    clientState.sessionBest = [null, null, null];
    clientState.mySectors = [null, null, null];
    clientState.myBestSectors = [null, null, null];
```

Add handlers:

```js
socket.on('sector', (s) => {
    const i = s.sector - 1;
    if (s.sessionBest) clientState.sessionBest[i] = s.time;
    if (s.id !== clientState.me) return;
    const cls = !s.valid ? 'sec-grey' : s.sessionBest ? 'sec-purple' : s.personalBest ? 'sec-green' : 'sec-yellow';
    const prev = clientState.myBestSectors[i];
    if (s.personalBest) clientState.myBestSectors[i] = s.time;
    if (s.sector === 1) clientState.mySectors = [null, null, null];
    clientState.mySectors[i] = { time: s.time, cls };
    if (window.showSectorFlash) window.showSectorFlash(s.sector, s.time, prev === null ? null : s.time - prev, cls);
});

socket.on('track_limits', (e) => {
    if (e.id !== clientState.me || !window.showBanner) return;
    window.showBanner(e.kind === 'deleted' ? 'TRACK LIMITS — LAP DELETED'
        : e.kind === 'warning' ? `TRACK LIMITS — WARNING ${e.count}/2`
        : `+5s PENALTY (total +${e.penalty}s)`);
});
```

- [ ] **Step 5: HUD** (`public/js/game3d.js`).

After `window.showQualiResults`, add:

```js
let flashTimer = null, bannerTimer = null;
window.showSectorFlash = (n, time, delta, cls) => {
    const el = $('sector-flash');
    el.textContent = `S${n} ${time.toFixed(3)}` + (delta === null ? '' : `  ${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(3)}`);
    el.className = cls;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.add('hidden'), 2000);
};
window.showBanner = (text) => {
    const el = $('race-msg');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.add('hidden'), 3000);
};
```

In `showQualiResults`, change the name part of the `li.textContent` line to `${lp ? lp.username + window.assistBadge(lp) : '—'}`.

In `updateHUD`, replace the lap-time block (from `$('lt-current').innerText = …` to `$('lt-best').innerText = …`) with:

```js
    const curEl = $('lt-current');
    curEl.innerText = racing ? fmtTime(me.curLap) : '--';
    curEl.classList.toggle('t-red', !!racing && me.lapValid === false);
    const lastEl = $('lt-last');
    const deleted = !!racing && me.lastValid === false;
    lastEl.innerText = racing ? fmtTime(me.lastLap) + (deleted ? ' DELETED' : '') : '--';
    lastEl.classList.toggle('t-red', deleted);
    lastEl.classList.toggle('t-purple', !deleted && !!racing && me.lastLap !== null && me.lastLap === fastest);
    lastEl.classList.toggle('t-green', !deleted && !!racing && me.lastLap !== null && me.lastLap === me.bestLap && me.lastLap !== fastest);
    $('lt-best').innerText = racing ? fmtTime(me.bestLap) : '--';
    for (let i = 0; i < 3; i++) {
        const el = $(`sec-${i + 1}`), s = racing ? clientState.mySectors[i] : null;
        el.textContent = s ? `S${i + 1} ${s.time.toFixed(3)}` : `S${i + 1}`;
        el.className = `sec ${s ? s.cls : ''}`;
    }
```

Replace the quali session-bar lines (the `bar = sess.phase === 'QUALI_FLAG' …` line and the `if (sess.phase !== 'QUALI_FLAG' …` line) with:

```js
        bar = `QUALIFYING ${fmtClock(sess.endsAt - Date.now())}`;
        if (racing) bar += me.finished ? ` · QUALIFYING COMPLETE — P${me.rank}` : me.curLap === null ? (me.inPit ? ' · PIT LANE' : ' · OUT LAP') : ` · LAP ${me.lap + 1}/2`;
```

In the timing tower loop, change the name and append sector bars in quali:

```js
        name.textContent = `${p.rank}. ${lp.username}${window.assistBadge(lp)}${p.penalty ? ` +${p.penalty}s` : ''}`;
```

and replace `li.append(name, time);` with:

```js
        if (quali) {
            const bars = document.createElement('span');
            bars.className = 'tt-sectors';
            (p.bestLapSectors || [null, null, null]).forEach((s, i) => {
                const b = document.createElement('i');
                const best = clientState.sessionBest[i];
                if (s !== null) b.className = best !== null && s <= best + 1e-9 ? 'sb-purple' : 'sb-yellow';
                bars.appendChild(b);
            });
            li.append(name, bars, time);
        } else {
            li.append(name, time);
        }
```

- [ ] **Step 6: Closed pit visuals** (`public/js/game3d.js`, `buildPit` and `drawMinimap`).

In `buildPit`, after the `inner` line:

```js
    const open = (i) => inner(i) && pit.cum[i] >= pit.closeS; // nothing drawn on the closed pit entry
```

and use `open` instead of `inner` in the three `strip(...)` calls and the outer-wall `wall(...)` call. Then:
- replace `board(pit.cum[2], 'PIT IN', '#d62828');` with `board(pit.closeS, 'PIT CLOSED', '#d62828');`
- replace `board(pit.limStart, 'PIT LIMIT 80', '#1e5bd8');` with `board(Math.max(pit.limStart, pit.closeS), 'PIT LIMIT 80', '#1e5bd8');`
- replace `for (const s0 of [pit.limStart, pit.limEnd]) {` with `for (const s0 of [Math.max(pit.limStart, pit.closeS), pit.limEnd]) {`

Add after the boards:

```js
    world.add(wall(pit.closeWall, 0, 1.2 * scale, (i) => i === 0, solid('#d62828')));
```

In `drawMinimap`, change the pit path line to draw only the open part:

```js
        t.pit.path.filter((_, i) => t.pit.cum[i] >= t.pit.closeS)
            .forEach((p, i) => (i ? mm.lineTo(mx(p.x), my(p.y)) : mm.moveTo(mx(p.x), my(p.y))));
```

- [ ] **Step 7: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/app.js && node --check public/js/socket.js && npm test`
Expected: no syntax errors; all tests pass.

Manual (browser, `npm start`, `http://localhost:3232`, Monza, Qualifying On, 1 lap):
- The lobby shows the Assists select (default Steering) and the `[S]`/`[F]` badges. A page reload keeps the choice.
- Qualifying: the session bar reads "OUT LAP", then "LAP 1/2", "LAP 2/2", then "QUALIFYING COMPLETE — P1", and the car parks.
- Sector panel colours update at each line, with the flash and delta showing.
- Cutting the first chicane shows "TRACK LIMITS — LAP DELETED", turns the lap time red and marks it "DELETED".
- The PIT CLOSED board and red barrier are at the pit entry, and the pit-lane drawing starts there.
- Race: the 3rd cut shows "+5s PENALTY" and the tower shows "+5s".
- With Full assist, flat out into the first chicane, the car brakes by itself.

Take screenshots if the Chrome extension is connected; otherwise ask the user to check.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/css/style.css public/js/app.js public/js/socket.js public/js/game3d.js
git commit -m "Show sectors, track-limit messages, closed pit and assist badges"
```
