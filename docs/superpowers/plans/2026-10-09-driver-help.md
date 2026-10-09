# Driver Help Levels & Real-Limit Racing Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 0–100 % assist sliders with fair help levels (braking Off/Low/High, steering Off/On) that brake from the racing line's real corner speeds, give no extra grip, can be fixed by the host for everyone, and show as badges.

**Architecture:** The shared simulation (`public/js/sim/`, run by the server and by the client predictor) gets the level snapping, the grip change and the new braking help. `src/game/RacingLine.js` computes a per-centreline-point corner limit from the racing line (`track.lineLimit`, sent with the track) and a real-limit speed profile for the line colours. The lobby/socket layer stores each driver's own choice and the host's fixed levels; the browser UI swaps the sliders for buttons and adds badges.

**Tech Stack:** Node.js (CommonJS server, `node:test`), browser ES modules + classic scripts, Socket.IO, three.js (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-09-driver-help-design.md`

## Global Constraints

- Shared sim stays deterministic and identical on client and server: no `Math.random`, no state outside the car object, the same `track` arrays on both sides.
- Wire format unchanged: assist is the string `'steer,brake'` in percent. Levels: steering `0 | 100`, braking `0 | 50 | 100`. Parsed form `{ steer: 0|1, brake: 0|0.5|1 }`.
- Snapping (everywhere): steer `< 0.5 → 0` else `1`; brake `< 0.25 → 0`, `< 0.75 → 0.5`, else `1` (fractions of 1).
- Braking help constants: `HIGH = { aim: 0.95, margin: 0.9 }`, `LOW = { aim: 0.90, margin: 1.0 }`. Task 3 may tune `HIGH` within aim 0.93–0.97 and margin 0.8–1.0 only, to meet the lap band; `LOW` is fixed.
- Lap band: on Monza, Monaco and Spa a High-help bot laps 2–4 % slower than a bot driving the racing line at the real limit; High and Low never leave the road.
- No extra cornering grip from any help (`ASSIST_GRIP` removed).
- `safeSpeed` stays (scenery boards and some tests use it); the braking help no longer reads it.
- The golden physics trace (`test/fixtures/drive-golden.json`) may be re-recorded with `node test/fixtures/make-drive-golden.js` in a task only after confirming its divergence comes from that task's change (grip or braking help).
- Never start, stop or touch a server on port 3232 (the user's own). Browser checks use port 3299.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A browser with an old saved slider value (e.g. `'35,80'` in `localStorage`) must show a valid level and drive with the same level on server and client — pinned in Task 1 (lobby/parse snapping tests) and Task 5 (`parseHelp`).
2. A car on High help that is a couple of metres off the racing line must still make every corner — pinned in Task 3 (offset bot test).
3. Worn tyres (wear 1, −12 % grip) on High must still make every corner — pinned in Task 3 (worn-tyre bot test).
4. The host switching to "Same for all" and back must restore each driver's own choice, and `set_assist` while fixed must not change the car — pinned in Task 4.
5. A car above 95 % of `MAX_SAFE` on a straight (DRS + tow) must not be braked by High help — pinned in Task 3 (straight-line test).

---

### Task 1: Help levels snap, and steering help gives no extra grip

**Files:**
- Modify: `public/js/sim/carphysics.js` (constants block lines ~16–27, `parseAssist` lines ~33–49, `latAccel` line ~83)
- Modify: `src/lobby.js` (`sanitizeAssist` lines ~68–86, exports)
- Test: `test/carPhysics.test.js`, `test/lobby.test.js`

**Interfaces:**
- Produces: `snapAssist(steer: number, brake: number) → { steer: 0|1, brake: 0|0.5|1 }` exported from `public/js/sim/carphysics.js` (and so from `src/game/CarPhysics.js`); `parseAssist` returns snapped values; `lobby.sanitizeAssist` returns snapped values.

- [ ] **Step 1: Write the failing tests**

In `test/lobby.test.js`, replace the body of the `sanitizeAssist` test (line ~107) with:

```js
test('sanitizeAssist: levels snap (steer Off/On, brake Off/Low/High), anything else is full help', () => {
    assert.deepStrictEqual(lobby.sanitizeAssist('off'),    { steer: 0, brake: 0 });
    assert.deepStrictEqual(lobby.sanitizeAssist('full'),   { steer: 1, brake: 1 });
    assert.deepStrictEqual(lobby.sanitizeAssist('turbo'),  { steer: 1, brake: 1 }); // unknown → full
    assert.deepStrictEqual(lobby.sanitizeAssist('75,50'),  { steer: 1, brake: 0.5 });
    assert.deepStrictEqual(lobby.sanitizeAssist('0,100'),  { steer: 0, brake: 1 });
    assert.deepStrictEqual(lobby.sanitizeAssist('35,80'),  { steer: 0, brake: 1 });   // old slider values snap
    assert.deepStrictEqual(lobby.sanitizeAssist('60,20'),  { steer: 1, brake: 0 });
    assert.deepStrictEqual(lobby.sanitizeAssist('50,25'),  { steer: 1, brake: 0.5 });
    assert.deepStrictEqual(lobby.sanitizeAssist('x,y'),    { steer: 1, brake: 1 });
});
```

In `test/carPhysics.test.js` add (reuse the file's existing imports of `C`/`step`/`parseAssist`; add any missing name to its import line):

```js
test('parseAssist snaps to the help levels', () => {
    assert.deepStrictEqual(parseAssist('35,80'), { steer: 0, brake: 1 });
    assert.deepStrictEqual(parseAssist('100,50'), { steer: 1, brake: 0.5 });
    assert.deepStrictEqual(parseAssist('off'), { steer: 0, brake: 0 });
    assert.deepStrictEqual(parseAssist(null), { steer: 1, brake: 1 });
});

test('steering help gives no extra grip: at the grip limit both cars corner alike', () => {
    // Steady full-lock circle at 120 km/h (both cars saturate their grip there), 4 s to settle
    const lat = (assist) => {
        const v = 120 / 3.6 * 6;
        const car = { x: 0, y: 0, angle: 0, vx: v, vy: 0, speed: v, steer: 0 };
        let a = 0;
        for (let k = 0; k < 240; k++) {
            const before = car.angle;
            step(car, { throttle: 0.6, brake: 0, steer: 1 }, 1 / 60, 6, false, assist);
            if (k > 180) a = Math.max(a, Math.abs(car.angle - before) * 60 * (car.speed / 6)); // yaw rate × speed
        }
        return { a, use: car.latUse };
    };
    const on = lat('100,0'), off = lat('0,0');
    assert.ok(on.use > 0.98 && off.use > 0.98, `not at the limit: ${on.use} / ${off.use}`);
    assert.ok(Math.abs(on.a - off.a) / off.a < 0.01, `on ${on.a.toFixed(2)} vs off ${off.a.toFixed(2)} m/s²`);
});
```

If `car.latUse` does not reach 0.98 at 120 km/h for both, raise the speed in 20 km/h steps (keep it ≤ 140 km/h, where the steering help is still fully on) until it does, and note the speed used in the report.

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/lobby.test.js test/carPhysics.test.js`
Expected: FAIL — `'75,50'` gives `{ steer: 0.75, … }`, `parseAssist('35,80')` gives fractions, and the grip test shows steering help On cornering harder.

- [ ] **Step 3: Implement**

In `public/js/sim/carphysics.js`:
- Delete the `ASSIST_GRIP` constant line and change the `ASSIST_STEER` comment to `// steering help: extra lock, full below ASSIST_FULL_KMH, none above ASSIST_OFF_KMH`.
- Change the `latAccel` line to:

```js
    const latAccel = (C.LAT_ASSIST * Math.sqrt(Math.max(0, grip * grip - ft * ft))) / C.MASS; // every car corners on the same grip
```

- Replace `parseAssist` and add `snapAssist` above it:

```js
// Help levels: steering Off/On, braking Off/Low/High (fractions of 1; old slider values snap to the nearest level)
function snapAssist(steer, brake) {
    return { steer: steer >= 0.5 ? 1 : 0, brake: brake < 0.25 ? 0 : brake < 0.75 ? 0.5 : 1 };
}

// Parse an assist value into { steer: 0|1, brake: 0|0.5|1 }.
// Accepts: legacy 'off'/'full' strings, the 'steerPct,brakePct' string, or a pre-parsed object (server-sanitised).
function parseAssist(assist) {
    if (assist && typeof assist === 'object') return assist;
    if (assist === 'off') return { steer: 0, brake: 0 };
    const parts = String(assist).split(',').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) return snapAssist(parts[0] / 100, parts[1] / 100);
    return { steer: 1, brake: 1 }; // 'full', null and anything unknown
}
```

- Add `snapAssist` to the file's export list.

In `src/lobby.js`, add at the top with the other requires: `const { snapAssist } = require('./game/CarPhysics');` and replace `sanitizeAssist`:

```js
// Each player's own driving help, snapped to the levels (see carphysics.snapAssist).
// Accepts the legacy 'full'/'off' strings or 'steerPct,brakePct'; anything else is full help.
function sanitizeAssist(a) {
    if (a === 'off') return { steer: 0, brake: 0 };
    const parts = typeof a === 'string' ? a.split(',').map(Number) : [];
    if (parts.length === 2 && parts.every(Number.isFinite)) return snapAssist(parts[0] / 100, parts[1] / 100);
    return { steer: 1, brake: 1 }; // safe default: full help
}
```

(If `require('./game/CarPhysics')` creates a require cycle or fails to load, report it as BLOCKED with the error — do not copy the snapping into lobby.js.)

- [ ] **Step 4: Run the tests**

Run: `node --test test/lobby.test.js test/carPhysics.test.js`
Expected: PASS. If an existing steering test (e.g. `'steering assist: chicane at 100 km/h ≤ 16 m, hairpin at 60 km/h ≤ 10 m'`) now fails because the extra grip is gone, measure the new distances and raise only that test's thresholds to the measured value + 10 %, with a comment `// no extra grip from the steering help since 2026-10-09`. Record before/after numbers in the report.

- [ ] **Step 5: Full suite and golden trace**

Run: `npm test`
If only `test/simGolden.test.js` fails (plus the threshold adjustment above), confirm the divergence is from the grip change: temporarily restore the old `latAccel` line, run `node --test test/simGolden.test.js` (PASS), put the new line back, then run `node test/fixtures/make-drive-golden.js` and `npm test` (PASS). Record this in the report. Any other failure: fix it or report it.

- [ ] **Step 6: Commit**

```bash
git add public/js/sim/carphysics.js src/lobby.js test/carPhysics.test.js test/lobby.test.js test/fixtures/drive-golden.json
git commit -m "Snap assists to help levels and drop the steering help's extra grip"
```

---

### Task 2: Racing line at the real limit, and the corner limit table

**Files:**
- Modify: `src/game/RacingLine.js` (whole speed-profile part)
- Modify: `src/game/Track.js:395`
- Test: `test/racingLine.test.js`, `test/track.test.js`

**Interfaces:**
- Consumes: `Assist.safeSpeeds(path, scale, vcurv)`, `Assist.DOWN`, `Assist.MAX_SAFE` (unchanged).
- Produces: `track.lineLimit: number[]` (m/s per centreline point, floored to 0.1, from the racing line's own curvature at real grip, crest unloading included); `RacingLine.compute(t)` returns `{ offset, speed, phase, limit }`; `RacingLine.profile(L, scale, cap)` (no 4th argument); `RacingLine.latMax(v)` without help grip.

- [ ] **Step 1: Update the tests**

In `test/racingLine.test.js`:
- Change the import line `const { AIM } = require('../src/game/Assist');` to `const { MAX_SAFE } = require('../src/game/Assist');`.
- In the first test (`racing line stays on track, within grip and the assist's speeds`), rename it to `` `${id}: racing line stays on track and within grip` `` and replace the three lines using `AIM`:

```js
            assert.ok(v <= t.lineLimit[i] + 0.06, `point ${i}: ${v} m/s faster than the line's corner limit`);
        });
        const centre = RL.profile(t.path, t.scale, t.safeSpeed);
        const line = RL.profile(RL.linePoints(t.path, rl.offset), t.scale, t.lineLimit);
```

- In `a car following the line at its speeds laps cleanly with Full assist`: rename to `…laps cleanly (steering help on, braking its own)`, change `assist: 'full'` to `assist: '100,0'`, and change the profile line to `const lap = RL.profile(L, sc, t.lineLimit).lap;`.
- Delete the test `at the line's speed the Full braking assist never has to brake (red starts where it would)` and its `const { brakeAssist, MAX_SAFE } = require('../src/game/Assist');` line (MAX_SAFE now comes from the top import). Task 3 replaces it.
- In `flat out at the speed cap on a straight is green, not lift`, replace the `top`/`wrong` lines with:

```js
        const t = tracks[id], rl = t.racingLine, n = rl.speed.length;
        const wrong = rl.speed.map((v, i) => (t.lineLimit[i] >= MAX_SAFE - 0.1 && rl.speed[(i + 1) % n] >= v && rl.phase[i] !== 0 ? i : -1)).filter((i) => i >= 0);
```

In `test/track.test.js`, next to the `safeSpeed` assertions (line ~94), add:

```js
        assert.strictEqual(t.lineLimit.length, t.path.length);
        for (const v of t.lineLimit) assert.ok(v > 15 && v <= 100);
        // The line is wider than the centreline: its slowest corner is no slower than the centreline's
        assert.ok(Math.min(...t.lineLimit) >= Math.min(...t.safeSpeed) - 0.1, `${id}: line corner slower than centreline`);
```

(Use the loop variable name the surrounding test uses for the track id.)

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/racingLine.test.js test/track.test.js`
Expected: FAIL — `t.lineLimit` is undefined.

- [ ] **Step 3: Implement**

In `src/game/RacingLine.js`:
- Header comment line 2 becomes: `// Speeds are the car's real limit (no help grip, full braking), so red starts where a good driver brakes.`
- Imports: `const { DOWN, MAX_SAFE, safeSpeeds } = require('./Assist');`
- Delete `assistK` and replace `latMax`:

```js
// Cornering acceleration: every car has the same grip (the steering help adds lock, not grip)
const latMax = (v) => C.LAT_ASSIST * C.MU * (C.G + DOWN * v * v);
```

- `profile(L, scale, cap)`: remove the `assist` parameter and the `if (assist) holdToAssist(…)` line; in the backward pass use full braking:

```js
        const a = C.MU * (C.G + DOWN * vj * vj) * rem(j, vj) + drag(vj); // full braking at the limit
```

  and in `phase` change `vmax[i] < MAX_SAFE * AIM - 0.1` to `vmax[i] < MAX_SAFE - 0.1`. Update the comment above `profile` to drop the `assist` line.
- Delete `holdToAssist` and its comment.
- At the end of `compute`:

```js
    const offset = o.map((x) => Math.round(x * 10) / 10);
    const L = linePoints(P, offset);
    // Corner limit along the line at real grip (crests included): the braking help's targets, shared with the client
    const limit = safeSpeeds(L, t.scale, t.vcurv).map((v) => Math.floor(v * 10) / 10);
    const prof = profile(L, t.scale, limit);
    return { offset, speed: prof.speed.map((v) => Math.floor(v * 10) / 10), phase: prof.phase, limit };
```

In `src/game/Track.js` replace line 395 (`track.racingLine = RacingLine.compute(track); …`) with:

```js
    const { limit, ...line } = RacingLine.compute(track);
    track.racingLine = line;  // visual guide, sent to clients in game_init
    track.lineLimit = limit;  // braking help's corner speeds (shared sim, sent with the track)
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test test/racingLine.test.js test/track.test.js test/racingline.client.test.js`
Expected: PASS. If the lap test's `time <= lap + 8` fails on a circuit because the bot (no braking help) can't hold the faster line speeds, report the circuit and numbers as DONE_WITH_CONCERNS; do not widen the margin.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS (the braking help still reads `safeSpeed` until Task 3, so driving tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/game/RacingLine.js src/game/Track.js test/racingLine.test.js test/track.test.js
git commit -m "Racing line at the car's real limit, and a corner limit table from the line"
```

---

### Task 3: Braking help Off / Low / High from the racing line

**Files:**
- Modify: `public/js/sim/assist.js` (constants and `brakeAssist`, exports)
- Modify: `public/js/sim/drive.js:166`
- Modify: `public/js/game3d.js:265` (lift-off brake)
- Create: `test/help.test.js`
- Modify: `test/assist.test.js` (braking tests at lines ~32–80)
- Maybe modify: `public/js/sim/tyres.js` (`LOAD_TYPICAL`, only per Step 7), `test/fixtures/drive-golden.json`

**Interfaces:**
- Consumes: `track.lineLimit` (Task 2), `parseAssist` levels (Task 1).
- Produces: `brakeAssist(car, input, track, near, level)` where `level` is `0 | 0.5 | 1`; exports `HIGH`, `LOW` from `assist.js`; `AIM` and `BRAKE_MARGIN` are removed.

- [ ] **Step 1: Write the lap-time tests**

Create `test/help.test.js`:

```js
// Driver help: High brakes for you a little early, Low only saves you, neither leaves the road; the real limit is fastest
const { test } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const RL = require('../src/game/RacingLine');
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');
const { KERB_M } = require('../public/js/sim/drive.js');

const quietIo = { emit() {}, volatile: { emit() {} } };

// One race lap from the grid. driver: 'limit' (brakes to the line's real-limit speeds) or 'flat' (never brakes).
// offsetM: drive this far to the right of the racing line. worn: tyres fully worn all lap.
function lap(id, assist, driver, { offsetM = 0, worn = false } = {}) {
    const t = Track.load(id), n = t.path.length, sc = t.scale, rl = t.racingLine;
    const L = RL.linePoints(t.path, rl.offset.map((o) => o + offsetM * sc));
    const g = new Game(quietIo, [{ id: 'a', username: 'A', teamId: 'redbull', assist }], t, { maxLaps: 1, qualifying: false, tyreWear: worn }, () => {});
    g.frozen = false;
    const p = g.players.a;
    let time = 0, off = 0;
    while (time < 300 && !p.finished) {
        if (worn) p.wear = 1;
        const near = Physics.nearestOnTrack(p.x, p.y, t), i = near.i, aim = L[(i + 3) % n];
        let d = Math.atan2(aim.y - p.y, aim.x - p.x) - p.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const v = p.speed / sc, target = rl.speed[(i + 1) % n];
        const brake = driver === 'limit' && v > target + 1 ? 1 : 0;
        p.input = { steer: Math.max(-1, Math.min(1, d * 3)), throttle: driver === 'limit' && v >= target ? 0 : 1, brake };
        g.update();
        time += g.dt;
        if (near.dist > t.width / 2 + KERB_M * sc && !p.inPit) off++;
    }
    assert.ok(p.finished, `${id} ${assist} ${driver}: no lap in 300 s`);
    return { time, off };
}

for (const id of ['monza', 'monaco', 'spa']) {
    test(`${id}: High help laps 2–4 % slower than the real limit and stays on the road`, () => {
        const limit = lap(id, '100,0', 'limit'), high = lap(id, '100,100', 'flat');
        const r = high.time / limit.time;
        assert.strictEqual(high.off, 0, `High left the road for ${high.off} ticks`);
        assert.ok(r >= 1.02 && r <= 1.04, `High ${high.time.toFixed(2)} s vs limit ${limit.time.toFixed(2)} s (${((r - 1) * 100).toFixed(1)} %)`);
    });

    test(`${id}: Low help saves a driver who never brakes, and costs more time than High`, () => {
        const low = lap(id, '100,50', 'flat'), high = lap(id, '100,100', 'flat');
        assert.strictEqual(low.off, 0, `Low left the road for ${low.off} ticks`);
        assert.ok(low.time > high.time, `Low ${low.time.toFixed(2)} s not slower than High ${high.time.toFixed(2)} s`);
    });
}

test('High help still makes every corner off the racing line and on worn tyres (Monaco)', () => {
    for (const offsetM of [-2, 2]) assert.strictEqual(lap('monaco', '100,100', 'flat', { offsetM }).off, 0, `${offsetM} m off the line`);
    assert.strictEqual(lap('monaco', '100,100', 'flat', { worn: true }).off, 0, 'worn tyres');
});
```

If `KERB_M` is not exported from `drive.js`, use the constant's value from that file via the same import style the other tests use for `drive.js`.

In `test/assist.test.js`:
- In `runToChicane`, find the apex from `monza.lineLimit` instead of `monza.safeSpeed` (same loop, `min` = smallest `lineLimit` between 800 and 1300 m), call `Assist.brakeAssist(car, FULL, monza, near, useAssist ? 1 : 0)`, and pass `useAssist ? '100,100' : '0,0'` to `CarPhysics.step`.
- Rename the test using it to `braking help High: flat out from 300 km/h, the car is at or below 95 % of the chicane's corner speed` and assert `speed <= safe * 0.95 * 1.02`.
- In `braking assist leaves the driver alone…`, pass level `1` to both `brakeAssist` calls.
- Add:

```js
test('braking help: Off never brakes; Low brakes later than High', () => {
    const s0 = monza.cum.findIndex(c => c >= 600 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const at = (kmh) => { const v = kmh / 3.6 * monza.scale; return { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 }; };
    const near = Physics.nearestOnTrack(p.x, p.y, monza), FULL = { throttle: 1, brake: 0, steer: 0 };
    const brakes = (kmh, level) => Assist.brakeAssist(at(kmh), FULL, monza, near, level).brake === 1;
    let high = null, low = null; // lowest speed at which each level brakes here, 300 m before the chicane
    for (let kmh = 120; kmh <= 360; kmh += 5) { if (high === null && brakes(kmh, 1)) high = kmh; if (low === null && brakes(kmh, 0.5)) low = kmh; }
    for (let kmh = 120; kmh <= 360; kmh += 5) assert.strictEqual(brakes(kmh, 0), false, `Off braked at ${kmh} km/h`);
    assert.ok(high !== null && low !== null && low > high, `High from ${high} km/h, Low from ${low} km/h`);
});

test('braking help: no braking on a straight even above 95 % of the speed cap (DRS + tow)', () => {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 99 * monza.scale; // 356 km/h
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    const near = Physics.nearestOnTrack(p.x, p.y, monza), FULL = { throttle: 1, brake: 0, steer: 0 };
    // Every point a straight (limit = the cap): no level may brake, however fast the car goes
    for (const level of [0.5, 1]) {
        const out = Assist.brakeAssist({ ...car }, FULL, { ...monza, lineLimit: monza.lineLimit.map(() => Assist.MAX_SAFE) }, near, level);
        assert.strictEqual(out, FULL, `level ${level} braked on a straight`);
    }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/help.test.js test/assist.test.js`
Expected: FAIL — High is far more than 4 % slower (old centreline rule), the Off/Low/High test fails (no levels), the straight test brakes (aim 0.95 × MAX_SAFE).

- [ ] **Step 3: Implement the braking help**

In `public/js/sim/assist.js` replace everything from `const BRAKE_MARGIN` to the end with:

```js
// Braking help, judged against the racing line's corner speeds at real grip (track.lineLimit).
// High brakes for you a little early; Low waits until you could no longer make the corner, then brakes hard to
// LOW.aim of the corner speed, so leaning on it costs time. aim: share of the corner speed to arrive at;
// margin: share of the braking grip (at the corner speed) the help plans to use.
const HIGH = { aim: 0.95, margin: 0.9 };
const LOW = { aim: 0.90, margin: 1.0 };
const LOOK_EXTRA_M = 30;

// level: 0 off, 0.5 Low, 1 High. Stateless (client prediction runs it too). Worn tyres: lower targets, less braking
function brakeAssist(car, input, track, near, level) {
    const { path, cum, lineLimit, scale } = track;
    const v = car.speed / scale;
    if (!(level > 0) || v < 5 || input.brake >= 1) return input;
    const { aim, margin } = level >= 1 ? HIGH : LOW;
    const tyre = car.tyreGrip ?? 1, mu = C.MU * tyre, corner = aim * Math.sqrt(tyre);
    const reach = (v * v) / (2 * margin * mu * C.G) + LOOK_EXTRA_M;
    const n = path.length, total = cum[n];
    const here = cum[near.i] + near.t * (cum[near.i + 1] - cum[near.i]);
    for (let k = 1; k <= n; k++) {
        const j = (near.i + k) % n;
        const d = ((((cum[j] - here) % total) + total) % total) / scale;
        if (d > reach) break;
        if (lineLimit[j] >= MAX_SAFE) continue; // a straight: never braked for (DRS and tow can beat the cap)
        const s = lineLimit[j] * corner;
        // Downforce fades as the car slows, so judge against the grip left at the corner speed
        // Downhill (grade < 0) gravity eats into the braking: brake earlier; uphill it helps
        if (v > s && (v * v - s * s) / (2 * Math.max(d, 1)) > margin * mu * (C.G + DOWN * s * s) + C.G * (car.grade || 0)) {
            return { throttle: 0, brake: 1, steer: input.steer };
        }
    }
    return input;
}

export { DOWN, MAX_SAFE, HIGH, LOW, safeSpeeds, brakeAssist };
```

Also change the file's first comment line to `// Driving help that needs the track: corner speed maps and the braking help`.

In `public/js/sim/drive.js` replace line 166 with:

```js
    const level = parseAssist(p.assist).brake; // braking help: 0 off, 0.5 Low, 1 High (off in the pit lane)
    const used = level > 0 && !p.inPit ? brakeAssist(p, input, t, before, level) : input;
```

In `public/js/game3d.js` line 265, High already brakes for the driver, so lifting off coasts only on High:

```js
        const car = predictor?.car, lift = car ? liftOffBrake(parseAssist(predictor.assist).brake >= 1 ? 1 : 0, (car.speed || 0) / predictor.track.scale) : 0;
```

Search the repo for other uses of `AIM` or `BRAKE_MARGIN` (`grep -rn "BRAKE_MARGIN\|\bAIM\b" src public/js test scripts`) and move each to `HIGH.aim` / `HIGH.margin`, or to `lineLimit` where it judged corners, keeping each test's intent.

- [ ] **Step 4: Run the focused tests, tune High if needed**

Run: `node --test test/help.test.js test/assist.test.js`
Expected: PASS. If the High band (2–4 %) fails, tune `HIGH.aim` within 0.93–0.97 and `HIGH.margin` within 0.8–1.0 (re-run each time). Record every combination tried with its lap ratios per circuit in the report. If no combination in range passes on all three circuits, stop and report DONE_WITH_CONCERNS with the table; never change the band or `LOW`.

- [ ] **Step 5: Full suite and golden trace**

Run: `npm test`
Fix any test that relied on the old braking rule by moving it to the new levels while keeping its intent (report each). If `test/simGolden.test.js` fails, confirm the cause by temporarily calling the old rule (or setting the golden car's assist to `'100,0'` in a scratch copy) and seeing it pass, then run `node test/fixtures/make-drive-golden.js` and `npm test` (PASS). Record the evidence.

- [ ] **Step 6: Commit**

```bash
git add public/js/sim/assist.js public/js/sim/drive.js public/js/game3d.js test/help.test.js test/assist.test.js test/fixtures/drive-golden.json
git commit -m "Braking help Off/Low/High from the racing line's real corner speeds"
```

- [ ] **Step 7: Tyre calibration check**

Run: `node scripts/calibrate-tyres.js` and `node --test test/tyres.test.js`
If the printed calibration differs from `LOAD_TYPICAL` in `public/js/sim/tyres.js` by more than 5 %, or `tyres.test.js` fails, set `LOAD_TYPICAL` to the printed value (two decimals), re-run `npm test`, and commit:

```bash
git add public/js/sim/tyres.js
git commit -m "Recalibrate tyre wear load for the new corner speeds"
```

Otherwise record "no change needed" with the printed value in the report.

---

### Task 4: Host "Same for all" help

**Files:**
- Modify: `src/lobby.js` (`sanitizeSettings`, new `sanitizeHelp`, `effectiveAssist`, exports)
- Modify: `src/socketManager.js` (default settings line 15, `join_lobby` ~line 108, `update_settings` ~line 195, `set_assist` ~line 228)
- Test: `test/lobby.test.js`, `test/socketManager.test.js`

**Interfaces:**
- Consumes: `snapAssist`, `sanitizeAssist` (Task 1).
- Produces: settings field `help: { mode: 'choose' | 'fixed', steer: 0|100, brake: 0|50|100 }` (default `{ mode: 'choose', steer: 100, brake: 100 }`); each lobby player gets `ownAssist` (their own choice) and `assist` (what their car drives with); `lobby.effectiveAssist(settings, own) → { steer, brake }`.

- [ ] **Step 1: Write the failing tests**

In `test/lobby.test.js`:

```js
test('sanitizeSettings: driver help mode and levels, snapped; garbage keeps the current value', () => {
    const cur = { ...DEFAULTS, help: { mode: 'choose', steer: 100, brake: 100 } };
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { help: { mode: 'fixed', steer: 0, brake: 60 } }, TRACK_IDS).help, { mode: 'fixed', steer: 0, brake: 50 });
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { help: { mode: 'evil', steer: 'x' } }, TRACK_IDS).help, { mode: 'choose', steer: 100, brake: 100 });
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { help: 7 }, TRACK_IDS).help, cur.help);
    assert.deepStrictEqual(lobby.sanitizeSettings(DEFAULTS, { help: { mode: 'fixed' } }, TRACK_IDS).help, { mode: 'fixed', steer: 100, brake: 100 });
});

test('effectiveAssist: the host\'s levels when fixed, otherwise the driver\'s own', () => {
    const own = { steer: 0, brake: 0 };
    assert.deepStrictEqual(lobby.effectiveAssist({ help: { mode: 'choose', steer: 100, brake: 100 } }, own), own);
    assert.deepStrictEqual(lobby.effectiveAssist({ help: { mode: 'fixed', steer: 100, brake: 50 } }, own), { steer: 1, brake: 0.5 });
    assert.deepStrictEqual(lobby.effectiveAssist({}, own), own);
});
```

In `test/socketManager.test.js`, after the existing assist test:

```js
test('host "Same for all" help: every car gets the host\'s levels, set_assist can\'t change it, "Each driver chooses" restores own choices', () => {
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = io.connect('a');
    a.fire('join_lobby', { username: 'A', teamId: 'ferrari', assist: '0,0' });
    const b = io.connect('b');
    b.fire('join_lobby', { username: 'B', teamId: 'haas', assist: '100,100' });
    a.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualifying: true, help: { mode: 'fixed', steer: 0, brake: 50 } });
    let lob = io.events('lobby_state_sync').at(-1);
    assert.deepStrictEqual([lob.players.a.assist, lob.players.b.assist], [{ steer: 0, brake: 0.5 }, { steer: 0, brake: 0.5 }]);
    b.fire('set_assist', '100,100');
    lob = io.events('lobby_state_sync').at(-1);
    assert.deepStrictEqual(lob.players.b.assist, { steer: 0, brake: 0.5 }, 'set_assist changed a fixed car');
    a.fire('update_settings', { help: { mode: 'choose' } });
    lob = io.events('lobby_state_sync').at(-1);
    assert.deepStrictEqual([lob.players.a.assist, lob.players.b.assist], [{ steer: 0, brake: 0 }, { steer: 1, brake: 1 }], 'own choices not restored');
    a.fire('update_settings', { help: { mode: 'fixed', steer: 100, brake: 100 } });
    const c = io.connect('c');
    c.fire('join_lobby', { username: 'C', teamId: 'mclaren', assist: '0,0' });
    a.fire('toggle_ready', true); b.fire('toggle_ready', true); c.fire('toggle_ready', true);
    a.fire('start_game');
    const init = io.events('game_init').at(-1);
    for (const id of ['a', 'b', 'c']) assert.deepStrictEqual(init.players[id].assist, { steer: 1, brake: 1 }, `${id} not on the host's levels`);
    for (const s of [a, b, c]) s.fire('disconnect');
});
```

If `fakeIo`/team ids differ in this file, follow the existing tests' helpers and use any free team id.

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/lobby.test.js test/socketManager.test.js`
Expected: FAIL — `help` is ignored, `effectiveAssist` is not defined.

- [ ] **Step 3: Implement**

In `src/lobby.js` (below `sanitizeAssist`):

```js
// Host setting: every driver chooses their own help, or every car drives with the host's levels
const HELP_DEFAULT = { mode: 'choose', steer: 100, brake: 100 };
function sanitizeHelp(h, current = HELP_DEFAULT) {
    if (!h || typeof h !== 'object') return current;
    const pct = (v, d) => (Number.isFinite(v) ? v : d);
    const a = snapAssist(pct(h.steer, current.steer) / 100, pct(h.brake, current.brake) / 100);
    const mode = h.mode === 'fixed' || h.mode === 'choose' ? h.mode : current.mode;
    return { mode, steer: a.steer * 100, brake: a.brake * 100 };
}

// What a car drives with: the host's levels when fixed, otherwise the driver's own choice
function effectiveAssist(settings, own) {
    const h = settings?.help;
    return h?.mode === 'fixed' ? snapAssist(h.steer / 100, h.brake / 100) : own;
}
```

In `sanitizeSettings`, before `return next;`:

```js
    if (incoming.help !== undefined) next.help = sanitizeHelp(incoming.help, current.help || HELP_DEFAULT);
```

Add `sanitizeHelp, effectiveAssist` to `module.exports`.

In `src/socketManager.js`:
- Default settings (line 15): add `help: { mode: 'choose', steer: 100, brake: 100 }`.
- `join_lobby`: replace the `assist:` line with

```js
                ownAssist: own,                                        // the driver's own choice, kept while the host fixes help
                assist: lobby.effectiveAssist(state.settings, own),    // what the car drives with
```

  and declare `const own = lobby.sanitizeAssist(data.assist);` just before `state.players[socket.id] = {`.
- `update_settings`: after `state.settings = …`, add

```js
            for (const p of Object.values(state.players)) p.assist = lobby.effectiveAssist(state.settings, p.ownAssist ?? p.assist);
            io.emit('lobby_state_sync', lobbySnapshot());
```

  (keep the existing `settings_updated` emit; place the new emit after it).
- `set_assist`: replace `player.assist = lobby.sanitizeAssist(assist);` with

```js
            player.ownAssist = lobby.sanitizeAssist(assist);
            player.assist = lobby.effectiveAssist(state.settings, player.ownAssist); // fixed by the host: unchanged
```

- Search `src/` for other places that copy or create a lobby player's `assist` (e.g. reconnect / rejoin) and keep `ownAssist` alongside it the same way.

- [ ] **Step 4: Run the tests**

Run: `node --test test/lobby.test.js test/socketManager.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lobby.js src/socketManager.js test/lobby.test.js test/socketManager.test.js
git commit -m "Host setting: same driver help for everyone"
```

---

### Task 5: Lobby buttons, host setting, Q key, badges

**Files:**
- Modify: `public/index.html` (lines ~60–71 assist sliders; host settings after the Tyre wear `<label>`)
- Modify: `public/css/style.css` (lines ~199–207 assist/slider rules)
- Modify: `public/js/app.js` (lines ~63–128 slider code; `emitSettings`; `updateSettingsUI`; element lookups at the top)
- Modify: `public/js/game3d.js` (`toggleAssist` ~177, `onAssistChange` ~185, tower ~1887, `showQualiResults` ~1601, `showRaceResults` ~1616)
- Test: `node --check`, full suite; behaviour in Task 6

**Interfaces:**
- Consumes: settings `help` and lobby players' `assist` (`{ steer: 0|1, brake: 0|0.5|1 }`) from Task 4; wire string `'steer,brake'`.
- Produces: `window.setAssist(v)` (unchanged name, used by `toggleAssist`), `window.onAssistChange(v)` (unchanged).

- [ ] **Step 1: Lobby markup** — in `public/index.html` replace the whole `<div class="graphics-picker assist-sliders">…</div>` block with:

```html
                            <div class="graphics-picker help-picker">
                                <span class="assist-label">Braking help</span>
                                <div class="seg" id="help-brake" role="group" aria-label="Braking help">
                                    <button type="button" data-v="0">Off</button><button type="button" data-v="50">Low</button><button type="button" data-v="100">High</button>
                                </div>
                                <small id="help-brake-hint"></small>
                                <span class="assist-label">Steering help</span>
                                <div class="seg" id="help-steer" role="group" aria-label="Steering help">
                                    <button type="button" data-v="0">Off</button><button type="button" data-v="100">On</button>
                                </div>
                                <small id="help-note">Q cycles braking help during a race</small>
                            </div>
```

After the Tyre wear `<label>…</label>` in the host settings add:

```html
                                    <label>Driver help
                                        <select id="setting-help" title="Same for all: every car drives with the help levels you pick">
                                            <option value="choose" selected>Each driver chooses</option>
                                            <option value="fixed">Same for all</option>
                                        </select>
                                    </label>
                                    <label class="help-fixed-only hidden">Braking help
                                        <select id="setting-help-brake"><option value="0">Off</option><option value="50">Low</option><option value="100" selected>High</option></select>
                                    </label>
                                    <label class="help-fixed-only hidden">Steering help
                                        <select id="setting-help-steer"><option value="0">Off</option><option value="100" selected>On</option></select>
                                    </label>
```

- [ ] **Step 2: CSS** — in `public/css/style.css` delete the `.assist-sliders`, `.assist-row`, `.assist-val` and `.custom-slider*` rules (lines ~199–206, only used by the sliders; check with `grep -n "custom-slider\|assist-row\|assist-val" public` first), change `.assist-sliders small` to `.help-picker small`, keep `.assist-label`, and add:

```css
.seg { display: flex; gap: 4px; margin: 4px 0 2px; }
.seg button { flex: 1; padding: 6px 0; border: 1px solid #334155; background: #0f172a; color: #cbd5e1; border-radius: 4px; font-weight: 700; cursor: pointer; }
.seg button.on { background: var(--f1-red); border-color: var(--f1-red); color: #fff; }
.seg button:disabled { opacity: 0.5; cursor: not-allowed; }
.tt-tag.help { background: #334155; color: #e2e8f0; }
```

- [ ] **Step 3: `app.js` help buttons** — replace everything from `// ── Assist sliders ──` through the end of `debouncedSaveAssist` (lines ~63–128) with:

```js
// ── Driver help: braking Off / Low / High, steering Off / On (sent as 'steer,brake' percent) ──
const helpBrake = document.getElementById('help-brake');
const helpSteer = document.getElementById('help-steer');
const BRAKE_HINTS = { 0: 'Off: you brake. Fastest if you brake late', 50: 'Low: catches you if you would miss a corner, costs time', 100: 'High: brakes for you, about 2–3 % slower a lap' };
let helpLevels = { steer: 100, brake: 100 };

// Same snapping as carphysics.snapAssist: old slider values land on the nearest level
function parseHelp(str) {
    if (str === 'off') return { steer: 0, brake: 0 };
    const [s, b] = String(str).split(',').map(Number);
    if (!Number.isFinite(s) || !Number.isFinite(b)) return { steer: 100, brake: 100 };
    return { steer: s >= 50 ? 100 : 0, brake: b < 25 ? 0 : b < 75 ? 50 : 100 };
}
const fixedHelp = () => (clientState.settings?.help?.mode === 'fixed' ? clientState.settings.help : null);

function renderHelp() {
    const fixed = fixedHelp(), lv = fixed || helpLevels;
    for (const [group, v] of [[helpBrake, lv.brake], [helpSteer, lv.steer]]) {
        group.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', +b.dataset.v === v); b.disabled = !!fixed; });
    }
    document.getElementById('help-brake-hint').textContent = BRAKE_HINTS[lv.brake];
    document.getElementById('help-note').textContent = fixed ? 'Set by the host for everyone' : 'Q cycles braking help during a race';
}

function applyAssistString(str) {
    helpLevels = parseHelp(str);
    const v = `${helpLevels.steer},${helpLevels.brake}`;
    (window.lanraceMem ||= {})['lanrace.assist'] = v;
    if (lastJoin) lastJoin.assist = v;
    renderHelp();
    if (!fixedHelp()) window.onAssistChange?.(v); // fixed: the car keeps the host's levels
    try { localStorage.setItem('lanrace.assist', v); } catch (e) { /* blocked */ }
    if (clientState.players?.[clientState.me]) socket.emit('set_assist', v);
}

helpBrake.addEventListener('click', (e) => { const v = e.target.dataset?.v; if (v !== undefined) applyAssistString(`${helpLevels.steer},${v}`); });
helpSteer.addEventListener('click', (e) => { const v = e.target.dataset?.v; if (v !== undefined) applyAssistString(`${v},${helpLevels.brake}`); });

// Global entry point used by game3d.js (Q key / gamepad) and the auto-restore below
window.setAssist = (v) => applyAssistString(v);
```

Then update the restore IIFE below it: `applyAssistString(saved || '100,100');` and `applyAssistString('100,100');` (drop the second argument). Make sure nothing else in `app.js` still references the removed slider names (`grep -n "assistSteer\|assistBrake\|updateSliderTrack\|debouncedSaveAssist" public/js/app.js` returns nothing).

- [ ] **Step 4: `app.js` host setting** — add next to the other setting lookups:

```js
const setHelp = document.getElementById('setting-help');
const setHelpBrake = document.getElementById('setting-help-brake');
const setHelpSteer = document.getElementById('setting-help-steer');
```

In `emitSettings` add `help: { mode: setHelp.value, brake: +setHelpBrake.value, steer: +setHelpSteer.value },`, and add `[setHelp, setHelpBrake, setHelpSteer].forEach((el) => el.addEventListener('change', emitSettings));` after the other listeners.

In `window.updateSettingsUI`, after the `setPenalties.value = …` line:

```js
    const help = clientState.settings.help || { mode: 'choose', steer: 100, brake: 100 };
    setHelp.value = help.mode;
    setHelpBrake.value = String(help.brake);
    setHelpSteer.value = String(help.steer);
    document.querySelectorAll('.help-fixed-only').forEach((el) => el.classList.toggle('hidden', help.mode !== 'fixed'));
    renderHelp();
```

and extend `rows` with

```js
['Driver help', help.mode === 'fixed' ? `Same for all: braking ${{ 0: 'Off', 50: 'Low', 100: 'High' }[help.brake]}, steering ${help.steer ? 'On' : 'Off'}` : 'Each driver chooses']
```

- [ ] **Step 5: `game3d.js` Q key and banner** — replace `toggleAssist` and the body of `window.onAssistChange` up to and including its `showBanner` call:

```js
// Q / gamepad View: step your braking help Off → Low → High → Off (steering help kept); the host can fix it for everyone
function toggleAssist() {
    if (isSpectator()) return;
    if (clientState.settings?.help?.mode === 'fixed') return window.showBanner?.('DRIVER HELP: SET BY HOST', true);
    const [s, b] = String(store.get('lanrace.assist') || '100,100').split(',').map(Number);
    const next = { 0: 50, 50: 100, 100: 0 }[b] ?? 100;
    window.setAssist?.(`${s >= 50 ? 100 : 0},${next}`); // sent at once: the server switches the same tick the predictor does
}
window.onAssistChange = (v) => {
    if (predictor) { predictor.assist = v; if (predictor.car) predictor.car.assist = v; }
    if (clientState.status !== 'LOBBY') {
        const [s, b] = v.split(',').map(Number);
        window.showBanner?.(`BRAKING HELP: ${{ 0: 'OFF', 50: 'LOW', 100: 'HIGH' }[b]}${s ? '' : ' · STEERING HELP OFF'}`, true);
    }
```

Keep whatever follows the banner in the original function unchanged.

- [ ] **Step 6: Badges** — in `game3d.js` add near the tower code:

```js
// Driver help badges: B = braking help (Low or High), S = steering help
const helpTags = (a) => (a ? `${a.brake > 0 ? 'B' : ''}${a.steer > 0 ? 'S' : ''}` : '');
```

Tower (after the `tt-tyre` line): `const tags = helpTags(lp.assist); if (tags) li.append(el('span', 'tt-tag help', tags));`
Quali results: change the name part of the template to `${lp ? lp.username : '—'}${helpTags(lp?.assist) ? ' · ' + helpTags(lp.assist) : ''}`.
Race results: change `span('rr-name', lp?.username || '—')` to `span('rr-name', `${lp?.username || '—'}${helpTags(lp?.assist) ? ' · ' + helpTags(lp.assist) : ''}`)`.

- [ ] **Step 7: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/app.js && npm test`
Expected: OK, PASS.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/css/style.css public/js/app.js public/js/game3d.js
git commit -m "Lobby help buttons, host help setting, Q cycles braking help, help badges"
```

---

### Task 6: Real-game check

**Files:** none unless a defect is found (fix it in the owning file and add a test where one fits).

- [ ] **Step 1:** Start `PORT=3299 node server.js` in the background. The Chrome tab must stay visible (a hidden tab stops the game loop); ask the user to bring the window to the front if `document.visibilityState` is `hidden`.
- [ ] **Step 2: Lobby.** Join; check the Braking Off/Low/High and Steering Off/On buttons highlight the saved level and the hint text changes. Set `localStorage['lanrace.assist'] = '35,80'`, reload: Braking High and Steering Off are shown. As host set "Driver help: Same for all", Braking Low: the buttons grey out with "Set by the host for everyone"; the read-only view shows "Same for all: braking Low, steering On".
- [ ] **Step 3: Race at Monza (Same for all off).** Start a 2-lap race. Press Q three times: banners "BRAKING HELP: LOW", "…HIGH", "…OFF". On High with throttle held, the car brakes itself into the first chicane and stays on the track; the tower shows "BS". Racing line on Full: red starts later than before (closer to the corner). Console: no errors.
- [ ] **Step 4: Fixed help.** Back in the lobby set "Same for all" with Braking High; start; press Q: banner "DRIVER HELP: SET BY HOST", level unchanged.
- [ ] **Step 5:** Stop the 3299 server. Report what was seen, with screenshots of the lobby panel and the tower badges.
