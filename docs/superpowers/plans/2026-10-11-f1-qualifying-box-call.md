# F1 Qualifying & Box Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Q1/Q2/Q3 knockout, Short and One-shot qualifying with clocks, track evolution and drama banners; and a race "Box, box" pit call with a tyre pick, entry guidance and a BOX tag.

**Architecture:** A pure server module `src/game/QualiSession.js` holds the rules (knockout counts, clock lengths, segment ranking, grid order). `Game` (quali mode) runs one session state machine (`g.quali`: running → flag → break → … → done) and emits `quali_clock` / `quali_lap` / `quali_segment`. Track evolution is one multiplier `p.gripEvo` in the shared sim. The box call is a per-car meta field `boxCall` set via a `box_call` socket message. The client adds the clock, break overlay, banners, tower states, and box-call UI.

**Tech Stack:** Node (CommonJS server, `node --test`), socket.io, three.js ES-module client.

**Spec:** `docs/superpowers/specs/2026-10-11-f1-qualifying-box-call-design.md`

## Global Constraints

- Lobby `qualiFormat`: `'full' | 'short' | 'oneshot' | 'off'`, default `'full'`; `qualifying` derived (`qualiFormat !== 'off'`). Full with < 4 drivers runs as Short.
- Knockout per Full segment end (after Q1, after Q2): `max(1, floor(N / 4))` of the drivers still in.
- Clocks: reference lap `refS = racingLine.lapS × 1.15`; Full Q1 5, Q2 4, Q3 3.5 × refS; Short 6 × refS; rounded to 30 s, min 120 s; One-shot no clock (cap 3 × refS). Flag: a lap started before the clock hits 0 counts; segment ends when all cars are done or 1.5 × refS after the flag. Break 30 s.
- Grid: Q3 order, then Q2 knock-outs by Q2 time, then Q1 knock-outs by Q1 time; no time = last (by join order); tie = earlier `at`.
- Track evolution: `evo = 1 + 0.02 × min(1, driven / planned)` (driven = session time in running/flag phases; planned = sum of segment clocks); `p.tyreGrip = gripOf(compound, wear) × (p.gripEvo ?? 1)`.
- Box call: key B; `boxCall: null | 'this' | 'next'` (meta); `'next'` when called < 200 m before `pit.entryS`; `'next'` → `'this'` at the start line; missed entry (past `entryS + 50 m` on track) keeps `'this'` and emits `{ id, kind: 'box_missed' }` via `track_limits`; cleared at service start and at finish; race only; ignored in the pit lane.
- Texts (exact): `BOX, BOX — CHOOSE TYRES`, `BOX THIS LAP — SOFTS` / `MEDIUMS` / `HARDS`, `BOX NEXT LAP — …`, `BOX CANCELLED`, `MISSED THE BOX — STAYING OUT`, `PIT ENTRY 250 m`, `Q2 · 4:12`, `QUALIFYING · 5:40`, `ONE-SHOT · OUT-LAP` / `ONE-SHOT · FLYING LAP`, `FINISH YOUR LAP`, `IMPROVED P7 → P3`, `STILL IN THE DROP ZONE — P8`, `PROVISIONAL POLE`, `PROVISIONAL POLE — RAHUL 1:21.403`, `Q1 RESULTS`, `KNOCKED OUT`, `THROUGH`, `Q2 starts in 0:18`, `POLE POSITION — RAHUL 1:20.998`, `KNOCKED OUT — P8`.
- Hidden test setting `qualiScale` (number, clamped 0.02–1, default 1) multiplies clocks, flag cap and break (break min 3 s) — for browser tests only, not in the lobby UI.
- Never touch the server on port 3232; test servers use 3299. game3d.js top-level code must not use `$` before its `const $` definition (~line 1800).

## Review Focus

1. A driver on a timed lap when the clock hits zero who then enters the pit lane — done, lap doesn't count (pit entry ends the lap as today). → Task 2 test "pit entry after the flag ends the run".
2. A knocked-out driver pressing throttle in the box — must stay parked. → Task 2 test "knocked-out cars can't leave".
3. A driver leaving mid-segment — keeps their time, is ranked, isn't in later segments; knockout count uses drivers still connected. → Task 2 test "disconnect mid-segment".
4. Box call pressed then the driver dives into the pit lane on the same lap from the call — normal stop with the chosen tyre, call cleared. → Task 4 test "call then stop".
5. Pause during qualifying — the clock must not run. → Task 2 test "paused clock" (check how `Game` pauses; `update` not running is enough if pause skips `update`).

---

### Task 1: QualiSession rules + racing-line lap time

**Files:**
- Create: `src/game/QualiSession.js`
- Modify: `src/game/RacingLine.js:101` (`compute` returns `lapS`)
- Test: `test/qualiSession.test.js`

**Interfaces:**
- Produces (CommonJS):
  - `knockoutCount(n) → number` = `max(1, floor(n / 4))`.
  - `effectiveFormat(format, drivers) → 'full'|'short'|'oneshot'|'off'` (full with < 4 → short).
  - `segmentPlan(format, refS, scale = 1) → number[]` seconds per segment (full 3 entries, short 1, oneshot `[Infinity]`), each `max(120, round30(k × refS)) × scale`.
  - `rankSegment(entries) → entries sorted` where `entry = { id, time|null, at|null, joinOrder }` (time asc; tie → earlier `at`; null last by joinOrder).
  - `gridOrder(segments) → ids[]` where `segments = [{ ranked: entries[], out: ids[] }]` in segment order: last segment's ranked order first, then each earlier segment's `out` ids in that segment's ranked order, latest segment first.
- `RacingLine.compute(t)` result gains `lapS` (the profile's lap time in seconds).

- [ ] **Step 1: Failing tests** — `test/qualiSession.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const Q = require('../src/game/QualiSession');
const Track = require('../src/game/Track');

test('knockout: a quarter of the field, at least one', () => {
    assert.deepStrictEqual([2, 4, 5, 6, 8, 10, 20].map(Q.knockoutCount), [1, 1, 1, 1, 2, 2, 5]);
});

test('full needs 4 drivers', () => {
    assert.strictEqual(Q.effectiveFormat('full', 3), 'short');
    assert.strictEqual(Q.effectiveFormat('full', 4), 'full');
    assert.strictEqual(Q.effectiveFormat('oneshot', 2), 'oneshot');
});

test('segment clocks from the reference lap, rounded to 30 s, at least 2 min', () => {
    assert.deepStrictEqual(Q.segmentPlan('full', 98), [480, 390, 330]);
    assert.deepStrictEqual(Q.segmentPlan('short', 98), [600]);
    assert.deepStrictEqual(Q.segmentPlan('full', 20), [120, 120, 120]);
    assert.deepStrictEqual(Q.segmentPlan('oneshot', 98), [Infinity]);
    assert.deepStrictEqual(Q.segmentPlan('full', 98, 0.1), [48, 39, 33]);
});

test('ranking: time, then earlier time, then no time by join order', () => {
    const r = Q.rankSegment([
        { id: 'a', time: 81.2, at: 50, joinOrder: 1 }, { id: 'b', time: 80.9, at: 90, joinOrder: 2 },
        { id: 'c', time: 81.2, at: 40, joinOrder: 3 }, { id: 'd', time: null, at: null, joinOrder: 0 }, { id: 'e', time: null, at: null, joinOrder: 4 }]);
    assert.deepStrictEqual(r.map((e) => e.id), ['b', 'c', 'a', 'd', 'e']);
});

test('grid: Q3 order, then Q2 knock-outs, then Q1 knock-outs', () => {
    const e = (id, time) => ({ id, time, at: time, joinOrder: 0 });
    const segs = [
        { ranked: [e('a', 80), e('b', 81), e('c', 82), e('d', 83), e('f', 90), e('g', null)], out: ['f', 'g'] },
        { ranked: [e('b', 79), e('a', 79.5), e('c', 80), e('d', 81)], out: ['d'] },
        { ranked: [e('c', 78), e('a', 78.5), e('b', 79)], out: [] },
    ];
    assert.deepStrictEqual(Q.gridOrder(segs), ['c', 'a', 'b', 'd', 'f', 'g']);
});

test('racing line has a lap time on every circuit', () => {
    for (const id of Track.TRACK_IDS) { const t = Track.load(id); assert.ok(t.racingLine.lapS > 30 && t.racingLine.lapS < 200, `${id} ${t.racingLine.lapS}`); }
});
```

- [ ] **Step 2: Run** `node --test test/qualiSession.test.js` → FAIL.

- [ ] **Step 3: Implement** `src/game/QualiSession.js`:

```js
// Qualifying rules (pure): knockout counts, segment clocks, segment ranking, grid order
const SEGMENT_LAPS = { full: [5, 4, 3.5], short: [6] };
const MIN_S = 120;

const knockoutCount = (n) => Math.max(1, Math.floor(n / 4));
const effectiveFormat = (format, drivers) => (format === 'full' && drivers < 4 ? 'short' : format);
const round30 = (s) => Math.round(s / 30) * 30;

function segmentPlan(format, refS, scale = 1) {
    if (format === 'oneshot') return [Infinity];
    return (SEGMENT_LAPS[format] || SEGMENT_LAPS.short).map((k) => Math.max(MIN_S, round30(k * refS)) * scale);
}

function rankSegment(entries) {
    return [...entries].sort((a, b) => {
        if (a.time === null || b.time === null) return a.time === b.time ? a.joinOrder - b.joinOrder : a.time === null ? 1 : -1;
        return a.time - b.time || a.at - b.at;
    });
}

function gridOrder(segments) {
    const last = segments[segments.length - 1], ids = last.ranked.map((e) => e.id);
    for (let k = segments.length - 2; k >= 0; k--) {
        const out = new Set(segments[k].out);
        for (const e of segments[k].ranked) if (out.has(e.id)) ids.push(e.id);
    }
    return ids;
}

module.exports = { knockoutCount, effectiveFormat, segmentPlan, rankSegment, gridOrder };
```

(Check `segmentPlan('full', 98)`: 5×98 = 490 → 480, 4×98 = 392 → 390, 3.5×98 = 343 → 330 (round 343/30 = 11.43 → 11 → 330). Scale 0.1 → 48, 39, 33.)

`src/game/RacingLine.js` `compute`: return `lapS: prof.lap` alongside `offset, speed, phase, limit` (use the existing `profile` result `lap`; if `compute` calls `profile` more than once, take the final one's `lap`).

- [ ] **Step 4: Run** `node --test test/qualiSession.test.js && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/QualiSession.js src/game/RacingLine.js test/qualiSession.test.js
git commit -m "Qualifying rules: knockout counts, segment clocks, ranking, grid order; racing line lap time"
```

---

### Task 2: The qualifying session in `Game` (server)

**Files:**
- Modify: `src/game/Game.js` (constructor quali state; `update()` session machine replacing the `qualiMaxS` end; `checkLapProgress` quali branch; `recordLap` segment bests + `quali_lap`; `updateStop` wait → out guard; `updateRanks` quali branch; `initPayload` session; `META_FIELDS` += `segBest`, `qualiOut`), `src/lobby.js` (`qualiFormat`, `qualiScale`), `src/socketManager.js` (default `qualiFormat: 'full'`; `startQuali` uses `qualifying` derived; results rows include `segment`, `time`)
- Test: `test/qualiGame.test.js`

**Interfaces:**
- Consumes: Task 1 (`QualiSession`, `racingLine.lapS`).
- Produces:
  - `g.quali = { format, segment, phase: 'running'|'flag'|'break'|'done', endsAt, flagCapAt, breakEndsAt, plan: number[], segments: [{ ranked, out }], out: Set, driven }`.
  - Player fields: `p.segBest` (number|null, current segment's best), `p.segAt` (time set), `p.qualiOut` (bool), `p.qualiDone` (bool, done for this segment).
  - Events: `quali_clock { segment, format, phase, endsInMs, survive, out: ids[], evo }` at 2 Hz (every 30 ticks) and in `initPayload().session`; `quali_lap { id, time, valid, segment, pos, prevPos, pole }`; `quali_segment { segment, rows: [{ id, time, gap, out }], next, breakMs }`.
  - `onFinish(rows)` with rows `[{ id, bestLap, segment, time }]` in grid order (`bestLap` = the deciding segment time, for the existing caller).
  - `g.quali.evo` (number) for Task 3.

- [ ] **Step 1: Failing tests** — `test/qualiGame.test.js` (helpers drive laps by teleporting through checkpoints like `test/game.test.js`'s `lap()`; adapt to the real names there):

```js
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
const lp = (id) => ({ id, username: id.toUpperCase(), teamId: 'ferrari' });
const spy = () => { const events = []; return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } }; };
const QS = (format, extra = {}) => ({ maxLaps: 3, qualifying: true, qualiFormat: format, qualiScale: 0.05, ...extra });
// Leave the box and complete one timed lap of `seconds` (out-lap first if the car has no timed lap running)
function timedLap(g, p, seconds) { /* teleport helper: release from 'wait', cross the line to start timing, then lap(g, p, g.time, seconds) — copy test/game.test.js lap()/crossLine() */ }
const tickUntil = (g, cond, max = 60 * 600) => { for (let k = 0; k < max && !cond(); k++) g.update(); };

test('full with 4 drivers: Q1 knocks out 1, Q2 knocks out 1, Q3 decides the front; grid order', () => {
    const { events, io } = spy(), ids = ['a', 'b', 'c', 'd'];
    let rows = null;
    const g = new Game(io, ids.map(lp), monza, QS('full'), (r) => { rows = r; }, 'quali');
    // Q1: d slowest
    ids.forEach((id, k) => timedLap(g, g.players[id], 80 + k));
    tickUntil(g, () => g.quali.phase === 'break');
    const s1 = events.find(([e]) => e === 'quali_segment')[1];
    assert.deepStrictEqual(s1.rows.filter((r) => r.out).map((r) => r.id), ['d']);
    assert.ok(g.players.d.qualiOut);
    tickUntil(g, () => g.quali.segment === 2 && g.quali.phase === 'running');
    // Q2: c slowest of a,b,c
    timedLap(g, g.players.a, 79); timedLap(g, g.players.b, 78); timedLap(g, g.players.c, 82);
    tickUntil(g, () => g.quali.segment === 3 && g.quali.phase === 'running');
    // Q3: a takes pole
    timedLap(g, g.players.a, 77); timedLap(g, g.players.b, 77.5);
    tickUntil(g, () => rows !== null);
    assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd']);
});

test('fewer than 4 drivers run Full as Short (one segment)', () => {
    const g = new Game(spy().io, ['a', 'b'].map(lp), monza, QS('full'), () => {}, 'quali');
    assert.strictEqual(g.quali.format, 'short');
    assert.strictEqual(g.quali.plan.length, 1);
});

test('flag: a lap started before zero counts, one started after does not', () => { /* start a timed lap, advance g.time past endsAt, finish the lap → counts (segBest set); next lap → not timed, car qualiDone */ });
test('pit entry after the flag ends the run', () => { /* on a timed lap at the flag, cross the pit limiter → qualiDone, no time */ });
test('segment ends early when all cars are done', () => { /* all cars park (wait) after the flag → phase break immediately */ });
test('break puts every car back in its box; knocked-out cars cannot leave', () => {
    /* after Q1 break: every p.stop.phase === 'wait', speed 0, at its box; d.qualiOut; d with throttle 1 for 60 ticks stays in 'wait' */
});
test('one-shot: one flying lap each, a deleted lap has no time', () => { /* oneshot: after one timed lap car parks; lapValid=false lap → segBest null, ranked last */ });
test('disconnect mid-segment: keeps time, ranked, not in the next segment', () => { /* removePlayer mid-Q1 after a lap; Q1 rows include it; knockout count uses connected drivers */ });
test('quali_lap reports positions and provisional pole', () => { /* two cars: second car's faster lap → quali_lap pole true, pos 1, prevPos null/2 */ });
```

The `/* … */` bodies are for the implementer to write with the helpers — each must assert exactly what its comment says (no empty tests). Pause: find how `Game` pauses (grep `paused`); add `test('paused clock')` asserting `g.quali.endsAt - g.time` doesn't shrink while paused.

- [ ] **Step 2: Run** `node --test test/qualiGame.test.js` → FAIL.

- [ ] **Step 3: Implement.**

`src/lobby.js` sanitize: `if (['full', 'short', 'oneshot', 'off'].includes(incoming.qualiFormat)) { next.qualiFormat = incoming.qualiFormat; next.qualifying = incoming.qualiFormat !== 'off'; }` and `if (Number.isFinite(incoming.qualiScale)) next.qualiScale = clamp(incoming.qualiScale, 0.02, 1);`. `socketManager.js:15` defaults: `qualiFormat: 'full'`.

`Game` constructor (quali mode), after players exist:

```js
        if (mode === 'quali') {
            const format = QualiSession.effectiveFormat(settings.qualiFormat || 'short', Object.keys(this.players).length);
            const refS = (track.racingLine?.lapS || 90) * 1.15, scale = settings.qualiScale ?? 1;
            this.quali = { format, segment: 1, phase: 'running', plan: QualiSession.segmentPlan(format, refS, scale), refS, scale,
                endsAt: 0, flagCapAt: Infinity, breakEndsAt: 0, segments: [], out: new Set(), driven: 0, evo: 1 };
            this.quali.endsAt = this.quali.plan[0]; // session time starts at 0
            for (const p of Object.values(this.players)) Object.assign(p, { segBest: null, segAt: null, qualiOut: false, qualiDone: false });
        }
```

Replace the quali part of the session end in `update()` with `if (this.mode === 'quali') this.updateQuali();` and keep the race end unchanged. New method:

```js
    // Qualifying clock: running → flag (laps started before zero may finish) → break (results, back to the boxes) → next segment / done
    updateQuali() {
        const q = this.quali, ids = Object.keys(this.players), live = ids.filter((id) => !this.players[id].qualiOut);
        if (q.phase === 'running' || q.phase === 'flag') q.driven += this.dt;
        const planned = q.plan.filter(Number.isFinite).reduce((a, b) => a + b, 0) || q.refS * 3;
        q.evo = 1 + 0.02 * Math.min(1, q.driven / planned);
        if (q.phase === 'running' && (this.time >= q.endsAt || (q.format === 'oneshot' && live.every((id) => this.players[id].qualiDone)))) {
            q.phase = 'flag';
            q.flagCapAt = this.time + 1.5 * q.refS * q.scale;
            for (const id of live) { const p = this.players[id]; if (p.lapStart === null) p.qualiDone = true; } // not on a timed lap: done
        }
        if (q.phase === 'flag' && (live.every((id) => this.players[id].qualiDone) || this.time >= q.flagCapAt)) this.endSegment(live);
        if (q.phase === 'break' && this.time >= q.breakEndsAt) this.startSegment();
        if (this.seq % 30 === 0) this.io.emit('quali_clock', this.qualiClock());
    }
```

`endSegment(live)`: build entries `{ id, time: p.segBest, at: p.segAt, joinOrder: p.joinOrder }` for `live`, `ranked = rankSegment`, `out = (format === 'full' && segment < 3) ? last knockoutCount(ranked.length) ids : []`; push `{ ranked, out }` to `q.segments`; mark `out` cars `qualiOut = true`; emit `quali_segment` (rows with gap to first time, `next` = segment + 1 or null, `breakMs`) and chat `Q${n}: NAMES knocked out` when any; then `resetToBoxes()`; if last segment → `q.phase = 'done'`, `this.stop()`, `this.onFinish(rows)` with `gridOrder(q.segments)` mapped to `{ id, bestLap, segment, time }` (segment = the last segment the driver ran, time = their time there); else `q.phase = 'break'`, `q.breakEndsAt = this.time + Math.max(3, 30 * q.scale)`.

`startSegment()`: `q.segment++`, `q.phase = 'running'`, `q.endsAt = this.time + q.plan[q.segment - 1]`, `q.flagCapAt = Infinity`, clear `segBest/segAt/qualiDone` for all, keep `qualiOut`.

`resetToBoxes()`: for every player: position on `p.box` (x, y, angle), `vx = vy = speed = 0`, `stop = { phase: 'wait', t: 0, age: 0 }`, `inPit = true`, `lapStart = sectorStart = null`, `outLaps = 0`, `finished = false`.

`updateStop` quali `wait` → `out` on throttle: add `&& !p.qualiOut && this.quali.phase !== 'break' && !p.qualiDone` to the condition.

`checkLapProgress` quali branch: remove the "park after `qualiLaps()` laps" rule; instead after `recordLap(p)`:

```js
            const q = this.quali;
            if (q.phase === 'flag' || (q.format === 'oneshot' && p.lap >= 1)) { // chequered flag (or the one-shot lap): this run is over
                p.qualiDone = true; p.lapStart = p.sectorStart = null;
            }
```

and do not start timing (`newLap`) for a car that is `qualiDone` or when `q.phase !== 'running'` (out-lap crossings after the flag).

Pit entry (`drive`, the existing `p.limiter && !wasLimited` line in quali): also `if (this.quali.phase === 'flag') p.qualiDone = true;`.

`recordLap` (quali): a lap counts for the segment when `p.lapValid` and its `lapStart` was before `q.endsAt`. Then update `p.segBest/p.segAt` if faster; compute the segment ranking before and after (rankSegment over live players) → emit `quali_lap { id, time, valid, segment, pos, prevPos, pole }` (pole = pos 1 and it changed hands) and on pole chat `PROVISIONAL POLE: NAME m:ss.mmm`.

`updateRanks` quali branch: rank by the current segment (`rankSegment` on all players; knocked-out after the live ones), `p.gap` vs the leader's `segBest`.

`removePlayer` in quali: if the leaver has a `segBest`, keep a ghost entry for the current segment ranking (store `{ id, time, at, joinOrder }` in `q.left`) and include it in `endSegment` rows and knockouts; not in later segments.

`initPayload().session` for quali: `this.qualiClock()` (`{ segment, format, phase, endsInMs, survive, out, evo }`, `survive` = drivers going through this segment: live count − knockoutCount (Full segments 1–2) else live count).

`socketManager.startQuali`: pass rows through unchanged to `quali_results` (`{ id, bestLap, position, segment, time }`).

- [ ] **Step 4: Run** `node --test test/qualiGame.test.js && npm test` → PASS (update any older quali tests in `test/game.test.js` that relied on `qualiLaps` parking or `qualiMaxS` — they now run with `qualiFormat: 'short'` or the new rules; list each in the report).

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/lobby.js src/socketManager.js test/qualiGame.test.js test/game.test.js
git commit -m "Qualifying sessions: Q1/Q2/Q3 knockouts, short and one-shot, chequered flag, breaks, grid order"
```

---

### Task 3: Track evolution in the shared sim

**Files:**
- Modify: `public/js/sim/drive.js:236`, `public/js/predict.js:36`, `src/game/Game.js` (`update`: set `p.gripEvo = this.quali.evo` on every car each tick in quali), `public/js/game3d.js` or `public/js/socket.js` (store `quali_clock.evo` and set `predictor.car.gripEvo`)
- Test: `test/qualiGame.test.js` (evolution) and the predictor parity test file

**Interfaces:**
- Consumes: `g.quali.evo` (Task 2), `quali_clock.evo`.
- Produces: `p.gripEvo` read by `driveCar` and the predictor.

- [ ] **Step 1: Failing tests:** in `test/qualiGame.test.js`: evo starts at 1, reaches 1.02 by the end of the planned time, holds during breaks; a car's `tyreGrip` after `driveCar` equals `gripOf(compound, wear) × evo`. In the predictor parity file: a JSON round-trip of a car with `gripEvo: 1.015` stepped on server and client gives identical state (copy the existing parity test shape).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** `drive.js`: `p.tyreGrip = gripOf(p.compound, p.wear) * (p.gripEvo ?? 1);` · `predict.js`: `if (c.compound) c.tyreGrip = gripOf(c.compound, c.wear) * (c.gripEvo ?? 1);` and keep `c.gripEvo` when the server snapshot is applied (from `clientState.qualiEvo`, set in `socket.js` `quali_clock` handler: `clientState.qualiEvo = d.evo`; reset to undefined on `game_init` of a race). Game `update` (quali): `for (const id of ids) this.players[id].gripEvo = this.quali.evo;` before driving.
- [ ] **Step 4: Run** `npm test` → PASS (sim golden + parity).
- [ ] **Step 5: Commit** `git commit -m "Track evolution: grip builds up to 2 % through qualifying, same on server and predictor"`

---

### Task 4: Box call (server)

**Files:**
- Modify: `src/game/Game.js` (`setBoxCall`, `META_FIELDS` += `boxCall`, line crossing `'next' → 'this'`, missed-entry check, clear at service and finish), `src/socketManager.js` (`box_call` handler)
- Test: `test/boxCall.test.js`

**Interfaces:**
- Produces: `Game.prototype.setBoxCall(id, on)`; meta `boxCall`; event `track_limits { id, kind: 'box_missed' }`.

- [ ] **Step 1: Failing tests** (`test/boxCall.test.js`, using `Game` race on Monza; place cars by lap distance with the same helpers the pit tests use — `pointOnPath`-style or track `pointAt`):
  - call far before the entry → `'this'`; within 200 m before `pit.entryS` → `'next'`;
  - `'next'` becomes `'this'` when the car crosses the start line;
  - `setBoxCall(id, false)` → null;
  - ignored in quali mode, in the pit lane, and when finished;
  - missed: with `'this'`, drive past `entryS + 50 m` on track (not in the lane) → still `'this'`, one `box_missed` event;
  - call then stop: enter the lane → `service` starts → `boxCall` null; the stop fits `nextCompound` (set via `setNextCompound`) — "call then stop";
  - `boxCall` appears in `metaDiff` when it changes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Find how lap distance and `pit.entryS` relate (Track.js builds `pit.entryS` along `t.cum`; `p.lapS` is set by the sim — check both references and convert if one is offset by `startS`). Helper `toEntryM(p) = ((entryS − s) mod total) / scale`.

```js
    // "Box, box": the driver calls the stop (race only); too close to the entry → next lap
    setBoxCall(id, on) {
        const p = this.players[id];
        if (!p || this.mode !== 'race' || p.finished || p.inPit) return;
        p.boxCall = on ? (this.toEntryM(p) < BOX_NEXT_M ? 'next' : 'this') : null;
    }
```

`BOX_NEXT_M = 200`, `BOX_MISS_M = 50`. In the race line-crossing branch: `if (p.boxCall === 'next') p.boxCall = 'this';`. Missed check in `update` (race, per car, not in the pit lane, `boxCall === 'this'`): remember `p.prevToEntry`; when `toEntryM` jumps from small (< 50) to large (> total − BOX_MISS_M − 10, i.e. the car passed the entry) and `!p.inPit` → emit `box_missed` once (guard with `p.boxMissedLap = p.lap`). `updateStop` when entering `service`: `p.boxCall = null`. `finishCar`: `p.boxCall = null`. Socket: `socket.on('box_call', (d) => { if (gameInstance && d && typeof d.on === 'boolean') gameInstance.setBoxCall(socket.id, d.on); });`.
- [ ] **Step 4: Run** `node --test test/boxCall.test.js && npm test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Box, box: drivers call their stop, next lap if too late, missed entry carries over"`

---

### Task 5: Qualifying UI (client)

**Files:**
- Modify: `public/index.html` (`#quali-clock`, `#quali-break`, `#ko-chip`; lobby `#setting-quali` options; remove Out-laps / Timed laps labels), `public/css/style.css`, `public/js/socket.js` (`quali_clock`, `quali_lap`, `quali_segment` handlers), `public/js/game3d.js` (clock, tower drop zone / OUT, banners, break overlay, knocked-out follow camera), `public/js/app.js` (lobby setting `qualiFormat`, summary row)
- Create: `public/js/qualiText.js` (pure text helpers) · Test: `test/qualiText.client.test.js`

**Interfaces:**
- Consumes: events and fields from Task 2 (`quali_clock`, `quali_lap`, `quali_segment`, meta `segBest`, `qualiOut`).
- Produces: `clockText(clock, me) → string`, `lapBanner(ev, survive) → string|null`, `fmtLap(seconds) → 'm:ss.mmm'`.

- [ ] **Step 1: Failing test** `test/qualiText.client.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
let T;
before(async () => { T = await import('../public/js/qualiText.js'); });

test('clock text per format and phase', () => {
    assert.strictEqual(T.clockText({ format: 'full', segment: 2, phase: 'running', endsInMs: 252000 }), 'Q2 · 4:12');
    assert.strictEqual(T.clockText({ format: 'short', segment: 1, phase: 'running', endsInMs: 340000 }), 'QUALIFYING · 5:40');
    assert.strictEqual(T.clockText({ format: 'oneshot', phase: 'running' }, { onTimedLap: false }), 'ONE-SHOT · OUT-LAP');
    assert.strictEqual(T.clockText({ format: 'oneshot', phase: 'running' }, { onTimedLap: true }), 'ONE-SHOT · FLYING LAP');
    assert.strictEqual(T.clockText({ format: 'full', segment: 1, phase: 'flag' }), 'FINISH YOUR LAP');
});

test('lap banners', () => {
    assert.strictEqual(T.lapBanner({ valid: true, pos: 3, prevPos: 7, pole: false }, 4), 'IMPROVED P7 → P3');
    assert.strictEqual(T.lapBanner({ valid: true, pos: 8, prevPos: 8, pole: false }, 6), 'STILL IN THE DROP ZONE — P8');
    assert.strictEqual(T.lapBanner({ valid: true, pos: 1, prevPos: 2, pole: true }, 4), 'PROVISIONAL POLE');
    assert.strictEqual(T.lapBanner({ valid: false }, 4), null);
    assert.strictEqual(T.fmtLap(81.403), '1:21.403');
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `public/js/qualiText.js`:

```js
// Qualifying texts (pure; node-tested)
export const fmtLap = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function clockText(c, me = {}) {
    if (c.phase === 'flag') return 'FINISH YOUR LAP';
    if (c.format === 'oneshot') return me.onTimedLap ? 'ONE-SHOT · FLYING LAP' : 'ONE-SHOT · OUT-LAP';
    return c.format === 'full' ? `Q${c.segment} · ${mmss(c.endsInMs)}` : `QUALIFYING · ${mmss(c.endsInMs)}`;
}
export function lapBanner(e, survive) {
    if (!e.valid) return null;
    if (e.pole) return 'PROVISIONAL POLE';
    if (e.pos > survive) return `STILL IN THE DROP ZONE — P${e.pos}`;
    if (e.prevPos && e.pos < e.prevPos) return `IMPROVED P${e.prevPos} → P${e.pos}`;
    return null;
}
```

UI wiring (game3d.js / socket.js / index.html / css), exact texts from Global Constraints:
- `socket.js`: `quali_clock` → `clientState.qualiClock = { ...d, at: performance.now() }`; `quali_lap` → if own id: `window.showBanner?.(lapBanner(d, clientState.qualiClock?.survive ?? 99) , true)` when non-null; if `d.pole`: everyone `window.showBanner?.(\`PROVISIONAL POLE — ${name} ${fmtLap(d.time)}\`, true)` (name from `clientState.players`); `quali_segment` → `window.showQualiBreak?.(d)`. (socket.js is a classic script: import the helpers in game3d.js and expose `window.qualiText = { clockText, lapBanner, fmtLap }`, or put these handlers in game3d.js via `socket.on` if `socket` is reachable there — follow the existing pattern for `track_limits`.)
- `#quali-clock` (top centre, below the lights): updated in `updateHUD` from `clientState.qualiClock` with `endsInMs` minus elapsed since `at`; class `low` under 60 s (red), `flag` in flag phase (chequered background); hidden outside QUALIFYING.
- Tower (quali): rows whose rank > `survive` get class `drop` (red tint); players with `qualiOut` get an `OUT` tag (`tt-tag out`, grey) and class `out`.
- `#quali-break` overlay: heading `Q${segment} RESULTS`, rows (pos, name, time via `fmtLap` or `—`, gap `+0.512`), out rows red with `KNOCKED OUT`, others `THROUGH`; own row highlighted; footer `Q${next} starts in 0:18` counting down from `breakMs`; when `next === null`: card `POLE POSITION — NAME 1:20.998`. Hidden when the next segment's `quali_clock` says `running`, or on `game_init`.
- Knocked out: `#ko-chip` `KNOCKED OUT — P8` (position from the last `quali_segment` row) while `me.qualiOut`; camera follows the leader — extend the existing follow-after-finish condition (`watchingAfterFinish()` or equivalent) to include `me.qualiOut`.
- Lobby: `#setting-quali` options `full` "Full (Q1 · Q2 · Q3)" (selected), `short` "Short", `oneshot` "One-shot", `off` "Off"; `app.js` sends `qualiFormat: setQuali.value` and syncs from `settings.qualiFormat ?? (settings.qualifying ? 'short' : 'off')`; remove the Out-laps and Timed laps labels and their listeners; summary row `Qualifying: Full · Q1/Q2/Q3` etc.

- [ ] **Step 4: Run** `node --test test/qualiText.client.test.js && node --check public/js/game3d.js public/js/socket.js public/js/app.js && npm test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Qualifying screens: session clock, drop zone, banners, results between segments, pole card, lobby formats"`

---

### Task 6: Box call UI (client)

**Files:**
- Modify: `public/js/game3d.js` (B key, banners, entry chevrons in `buildPit`, `PIT ENTRY` cue, tower BOX tag, tyre card while called), `public/js/socket.js` (`box_missed` in the `track_limits` handler), `public/js/pitLayout.js` (`pickerOpen` gains `boxCall`), `public/index.html` (`#entry-cue`, `#tc-box` button in the tyre card), `public/css/style.css`
- Test: `test/pitLayout.client.test.js` (pickerOpen with boxCall), `test/qualiText.client.test.js` (box banner text helper)

**Interfaces:**
- Consumes: meta `boxCall` (Task 4), `box_missed` event, existing `toEntryM` in `updateHUD`, tyre card (`#tyre-card`, `cardText`), `pickTyre`.
- Produces: `boxBanner(call, compound|null) → string` in `qualiText.js` (`'this'` → `BOX THIS LAP — SOFTS`, `'next'` → `BOX NEXT LAP — SOFTS`; compound null → the auto compound passed by the caller).

- [ ] **Step 1: Failing tests:** `pickerOpen({ …race, boxCall: 'this', toEntryM: 2000 })` → true; `boxBanner('this', 'S') === 'BOX THIS LAP — SOFTS'`, `boxBanner('next', 'H') === 'BOX NEXT LAP — HARDS'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:**
  - `pickerOpen`: race and `boxCall` truthy → true (before the entry-distance rule).
  - `boxBanner` in `qualiText.js`: `const NAMES = { S: 'SOFTS', M: 'MEDIUMS', H: 'HARDS' }; export const boxBanner = (call, c) => \`BOX ${call === 'next' ? 'NEXT' : 'THIS'} LAP — ${NAMES[c] || ''}\`.trim();`
  - Key B in `onKey` (race, not spectating, not finished): `socket.emit('box_call', { on: !me.boxCall })`. `#tc-box` button in the tyre card (shown in races) does the same; `blur()` after click.
  - In `updateHUD`, change-detect own `me.boxCall`: null → set: `showBanner('BOX, BOX — CHOOSE TYRES', true)` and a beep via the existing sound events (use whichever short UI sound exists, e.g. the DRS chime; skip if none), then 3 s later or on the next tyre pick: `showBanner(boxBanner(me.boxCall, me.nextCompound || auto), true)` (auto = `nextHarder(me.compound)` as `cardText` uses); set → null without a stop starting: `showBanner('BOX CANCELLED')`.
  - `socket.js` `track_limits`: `if (e.kind === 'box_missed') { window.showBanner?.('MISSED THE BOX — STAYING OUT'); return; }` before the steward card.
  - Entry chevrons: in `buildPit`, one InstancedMesh of blue chevrons (reuse the racing-line chevron shape idea: flat triangles) along `pit.path` from its start to `pit.limStart`, every 4 m; `visible` only while own `boxCall === 'this'` and `toEntryM <= 300` (set in `updateHUD`).
  - `#entry-cue`: `PIT ENTRY ${Math.round(toEntryM / 10) * 10} m` under the same condition (bottom centre above the coach line; desktop + phone positions clear of the cluster, tyre card and coach line).
  - Tower: `if (p.boxCall) li.append(el('span', 'tt-tag box', 'BOX'))` (blue).
  - Tyre card text while called: prefix line `BOX THIS LAP` / `BOX NEXT LAP` above the `NEXT:` line.
- [ ] **Step 4: Run** `node --test test/pitLayout.client.test.js test/qualiText.client.test.js && node --check public/js/game3d.js public/js/socket.js && npm test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Box, box on screen: B to call, tyre pick, entry chevrons and distance, BOX tag in the tower"`

---

### Task 7: Real game check (browser)

**Files:** none in the repo (scratchpad only).

- [ ] **Step 1:** Throwaway server on 3299 (never 3232). Four headless players (Playwright `playwright-core` + cached Chromium); host sets `qualiFormat: 'full'` and `qualiScale: 0.05` via `socket.emit('update_settings', …)` from the page.
- [ ] **Step 2:** Watch the session: clock text per segment, `FINISH YOUR LAP`, break overlay with `KNOCKED OUT` / `THROUGH`, `KNOCKED OUT — P…` chip for the eliminated, pole card, grid order on the race grid matching the server's `quali_results`. (A harness may teleport cars through laps server-side to produce times.) Screenshots at 1280×720 and 390×844.
- [ ] **Step 3:** Race: press B far from the pit entry → `BOX, BOX — CHOOSE TYRES`, pick 1 → `BOX THIS LAP — SOFTS`; tower `BOX` tag visible on another player's screen; teleport near the entry → chevrons + `PIT ENTRY … m`; enter the lane → stop fits softs, tag cleared; B twice → `BOX CANCELLED`.
- [ ] **Step 4:** No page errors; fix anything in a `Browser check fixes: …` commit; `npm test` → PASS.
