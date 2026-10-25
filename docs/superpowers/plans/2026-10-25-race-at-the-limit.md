# Race at the Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro bots drive at each corner's true, calibrated limit with late braking and real racecraft, and the drawn line and braking help use the same limits.

**Architecture:** A per-track, per-point corner speed scale (found offline by driving a lone bot ever faster through each corner until it runs wide) is stored next to the track data and applied inside `RacingLine.compute`, so the bots' targets, the drawn line and the braking help all move together. Bot braking, tyre-grip use and racecraft change in `driver.js`; level pace in `roster.js`. A race harness measures pace, overtakes, collisions and DNFs before and after.

**Tech Stack:** Node (CommonJS server sim, ES-module shared sim in `public/js/sim`), `node:test`.

**Spec:** docs/superpowers/specs/2026-10-24-race-at-the-limit-design.md

## Global Constraints

- Same car for everyone: no extra grip, power or downforce for bots; no change to car physics, tyres or penalties.
- Calibration never runs at game start or track load; tracks load stored limits.
- Safety margin: calibrated limit = fastest clean scale × (1 − 0.015).
- Calibrated on new medium tyres, at full steering help and at none; if the two differ by under 1 % everywhere, store one set.
- Level pace (lap ÷ new lapS): pro 1.0, hard 1.005, medium 1.035, easy 1.085. Pro spread one-sided 0 to +1 %; other levels ±1.5 %.
- Hard but fair: never steer into a car alongside, no moves into a car committed to the apex, no punting from behind.
- Success: 22-car Pro race best laps within 0.5 % of new lapS; more bot-on-bot overtakes than baseline; collisions and DNFs no worse than baseline (mean of seeds 1–3, 10 % tolerance) on monza, spa, silverstone, suzuka, monaco, interlagos.
- Server tick: 22 bots under 4 ms (existing botSession test).
- Commit messages: no Co-Authored-By or any trailer. Commit only when the user asks.

## Review Focus

1. A track whose limits file is missing or has a different point count (track reshaped, `npm run tracks` re-run): the game must still load with scale 1, never crash. Test in Task 2.
2. A player with steering help Off: the braking help must brake for the no-help limit, never later. Test in Task 4.
3. Worn or hard tyres: bots and braking help must slow by √grip; a bot on worn hards must not run wide where it was clean on new mediums. Test in Task 3.
4. A dive-bomb into a car already turned in: the attacker must back out, not hit it. Test in Task 6.
5. Formation lap and pit approach still at their own speeds (FORMATION_PACE, pit assist), unaffected by faster corner targets. Covered by existing formation and pit tests, re-run in Task 7.

---

### Task 1: Race metrics harness and baseline

**Files:**
- Create: `scripts/bot-race.mjs`
- Create: `docs/superpowers/plans/race-at-the-limit-baseline.json` (output)

**Interfaces:**
- Produces: `node scripts/bot-race.mjs --tracks monza,spa,silverstone,suzuka,monaco,interlagos --seeds 1,2,3 --out <file>` writing `{ [track]: { [seed]: { bestRatio, medianRatio, overtakes, collisions, dnfs, stopped } } }`; `bestRatio` = best bot lap ÷ `track.racingLine.lapS`.

- [ ] **Step 1:** Write the harness: 22 pro bots (`fillGrid([], 'pro', 3, 22)`), 5 laps, `{ tyreWear: true, collisions: true, contactPenalties: true, ghostStart: true, formationLap: false, rng: rngOf(seed) }`, run until `g.classified` or 12 sim minutes. Collisions = count of `track_limits` events with kind `collision`. Overtakes = for each pair of cars, a change in their order by race distance (`lap` + `lapS`) on track where neither car is `inPit` and the last change for that pair was > 3 s ago.
- [ ] **Step 2:** Run it on current code; save the output as the baseline file. Expected: a JSON file with 18 entries; record a one-line summary per track in the ledger.
- [ ] **Step 3:** Commit the script and baseline when the user asks.

### Task 2: Per-point corner speed scale in the racing line, loaded with the track

**Files:**
- Modify: `src/game/RacingLine.js` (`profile`, `compute`)
- Modify: `src/game/Track.js` (`build`)
- Test: `test/racingLine.test.js`, `test/track.test.js`

**Interfaces:**
- Produces: `RacingLine.compute(t, scale?)` where `scale` is an array of `path.length` numbers (default all 1); each point's corner limit (`limit[i]` and the profile's `vmax[i]`) is multiplied by `scale[i]` before the drive/brake passes.
- Produces: `track.lineLimit` (full-help limits) and `track.lineLimitNoHelp` (no-help limits; same array object when only one set is stored). Data file: `data/tracks/<id>.limits.json` = `{ points: <path.length>, help: number[], noHelp?: number[] }`.

- [ ] **Step 1: Failing tests:**
  - `racingLine.test.js` › `'a corner scale raises that corner's limit and speed, and only there'`: compute monza with scale 1 and with scale 1.05 on the indices of the first chicane only; assert `limit` and `speed` are ≥ 1.04× there, unchanged (±0.1) on the main straight 300 m earlier, and `lapS` lower.
  - `track.test.js` › `'limits file: loaded when its point count matches, ignored (scale 1) when missing or stale'`: build a track from raw data with a temp limits object of the wrong length; assert `lineLimit` equals the no-file result.
- [ ] **Step 2:** Run `node --test test/racingLine.test.js test/track.test.js`. Expected: the two new tests FAIL.
- [ ] **Step 3:** Implement. `Track.build` reads the limits file (if present and `points === path.length`), calls `compute(track, help)` and, if `noHelp` exists, a second `safeSpeeds`-based limit with `noHelp` for `lineLimitNoHelp`.
- [ ] **Step 4:** Run the full suite (`npm test`). Expected: all pass (no limits files exist yet, so every track is unchanged).

### Task 3: Bots brake at the limit and corner on their tyres' grip

**Files:**
- Modify: `src/game/bots/driver.js` (`drive`: speed target and pedal mapping)
- Test: `test/botDriver.test.js`

**Interfaces:**
- Consumes: the racing line as today.
- Produces: in corners the target is `racingLine.speed[j] × min(factor, √tyreGrip)` (today `min(factor, 1)`); braking pedal `min(1, −err × BRAKE_GAIN)` with `BRAKE_GAIN = 1.5` (today 0.3).

- [ ] **Step 1: Failing tests:**
  - `'a lone pro bot loses under 0.5 s a lap in braking zones'` on monza: time per path index on lap 2 vs the line's own `ds / speed` summed over `phase === 2`; assert the excess < 0.5 s.
  - `'worn hard tyres: slower through corners than new mediums, and still clean'`: same bot, `tyreGrip` held at 0.85 vs 1.0 (no wear); assert slower lap and zero `wide` events.
- [ ] **Step 2:** Run `node --test test/botDriver.test.js`. Expected: the braking test FAILS (≈ 1.1 s today).
- [ ] **Step 3:** Implement the two changes.
- [ ] **Step 4:** Run the bot suites (`node --test test/botDriver.test.js test/botSession.test.js test/botStrategy.test.js test/fairRacing.test.js`). Expected: all pass.

### Task 4: Calibrate every track's limits

**Files:**
- Create: `src/game/lineCalibration.js`
- Create: `scripts/calibrate-lines.mjs`
- Create: `data/tracks/<id>.limits.json` × 14 (generated)
- Modify: `public/js/sim/assist.js` (`brakeAssist` uses the player's help level)
- Test: `test/lineCalibration.test.js`, `test/assist.test.js`

**Interfaces:**
- Consumes: Task 2's `compute(t, scale)`, Task 3's bot.
- Produces: `calibrate(trackId, { steerHelp: 0 | 1 }) → number[]` (per path point). Algorithm: corners = maximal runs of `phase !== 0` (plus 2 points each side); every corner starts at 1.0; each round, raise every unfrozen corner by 0.02, rebuild the line, drive one clean lap with a lone pro bot (`pace: 1`, mediums, `tyreWear: false`) at that steering help; a corner where the bot triggers `wide`, leaves the asphalt/kerb, or drops below 0.9 × target for over 1 s is frozen at its last clean value; stop when all are frozen or at 1.25. Finally apply the 0.015 margin and verify one more lap is clean (else lower the offending corners by 0.02 and repeat).
- `brakeAssist` reads `lineLimitNoHelp + (lineLimit − lineLimitNoHelp) × steerHelp`, with `steerHelp = parseAssist(car.assist).steer` (0–1).

- [ ] **Step 1: Failing tests:**
  - `lineCalibration.test.js` › `'every track has limits: point count matches, every scale in [1, 1.25]'`.
  - `lineCalibration.test.js` › `'monza, calibrated: a lone pro bot laps within 0.5 % of the new lapS with no wide moments'`.
  - `assist.test.js` › `'braking help with steering help Off brakes for the no-help limit'`: a track object whose `lineLimitNoHelp` is 10 % below `lineLimit` at a corner; at the same distance and speed, a car with steer help 0 gets `brake: 1` where a car with steer help 1 does not.
- [ ] **Step 2:** Run them. Expected: FAIL (no limits files; assist ignores help level).
- [ ] **Step 3:** Implement `lineCalibration.js` and `assist.js`; run `node scripts/calibrate-lines.mjs` (all 14 tracks, both help levels); commit the generated files with the code.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, except the golden drive trace if the braking help's targets are in it. If so, re-record it (`npm run golden` or the test's documented command) and note in the ledger why.

### Task 5: Level pace and spread

**Files:**
- Modify: `src/game/bots/roster.js` (`LEVELS`, spread)
- Test: `test/botRoster.test.js`

- [ ] **Step 1: Failing test** `'pace: pro 1.0 with spread only slower (≤ +1 %), hard 1.005, medium 1.035, easy 1.085 (±1.5 %)'`: 200 draws per level; assert ranges.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Set the values; pro draws `1 + rng() × 0.01`.
- [ ] **Step 4:** Run the bot suites; expected pass.

### Task 6: Racecraft — attack into braking zones, switchback, race everyone

**Files:**
- Modify: `src/game/bots/driver.js` (`racecraft`, `state`)
- Test: `test/botDriver.test.js`

**Interfaces:**
- Produces in bot state: `b.passedBy = { car, at }` set when a car that was behind is now ahead within 2 s; cleared after 8 s or when re-passed.

- [ ] **Step 1: Failing tests** (two-car set-ups on monza before the first chicane, as the existing racecraft tests build them):
  - `'pro attacks into a braking zone from within reach, even at equal pace'`: attacker 8 m behind an equal-pace car, 150 m before the braking point; assert `passSide` set and kept until alongside.
  - `'switchback: passed, the bot attacks the passer back at the next corner'`: after a pass, assert the passed bot sets `passCar` to the passer within 3 s.
  - `'no dive into a car already turned in'`: target alongside at turn-in (`ph === 1`); assert attacker abandons (`passSide` 0) and its steer never points into the target.
  - `'bots attack bots'`: both cars bots; same as the first test.
- [ ] **Step 2:** Run; expected FAIL on the first two and the fourth.
- [ ] **Step 3:** Implement: the attack trigger uses reach (`a.f` < `(0.6 + 0.6 × agg) × v × 0.5` s) before a braking zone instead of requiring `faster`; a committed pass is kept through braking while `a.f < CAR_M × 1.5` and the attacker's target speed at the corner is reachable; `passedBy` drives the switchback (attack the passer, opposite side to the one they used).
- [ ] **Step 4:** Run the bot suites; expected pass, including fairRacing.

### Task 7: Measure against the baseline and finish

- [ ] **Step 1:** Run `node scripts/bot-race.mjs` with Task 1's arguments to `docs/superpowers/plans/race-at-the-limit-after.json`.
- [ ] **Step 2:** Compare with the baseline: per track, mean over seeds of best-lap ratio (expect ≤ 1.005 of the new lapS), overtakes (expect more), collisions and DNFs (expect ≤ baseline × 1.1). If any fails, fix in the owning task's code and re-run.
- [ ] **Step 3:** Run `npm test` and the formation/pit suites. Expected: all pass.
- [ ] **Step 4:** Report to the user with the comparison table; commit when the user asks.
