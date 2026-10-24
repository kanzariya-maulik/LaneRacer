# Formation Lap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before every race with at least one human, the grid drives one untimed formation lap, then each player parks on their own grid slot with help (steering settle, stop gauge, soft snap), then the existing five-light start runs.

**Architecture:** The server owns a new session status `FORMATION` between "every browser has drawn" and the lights (`src/socketManager.js`). `Game` (`src/game/Game.js`) keeps the race `frozen` (race clock at 0, no lap progress, no limits) and runs a formation state machine per car (`p.form.phase`: `drive → approach → snap → held`). The parking motion lives in the shared sim (`public/js/sim/drive.js`), like pit assist, so the client predictor moves the car identically. The client shows the formation HUD (tower head, stop gauge, grid-forming clock, own slot glow).

**Tech Stack:** Node.js (CommonJS server, ES modules client sharing `public/js/sim`), Socket.IO, three.js r186 WebGPU, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-24-formation-lap-design.md`

## Global Constraints

- 30 s after the **first human** car is `held`, every car not yet held is placed on its slot (`FORMATION_WAIT_S = 30`). Bots never start this clock.
- The whole formation lap ends after 3 minutes regardless (`FORMATION_MAX_S = 180`).
- Races with no human drivers skip the formation lap. Host setting `formationLap` (boolean, default `true`); `false` skips it.
- Players always own throttle and brake. The game only: nudges steering in the last `FORM_SETTLE_M = 50` m below `FORM_SETTLE_KMH = 80` km/h; snaps once stopped within `FORM_SNAP_M = 1` m of the mark at walking pace (`FORM_SNAP_MS = 1.5` m/s) and within `FORM_SNAP_RAD = 0.35` rad; the snap takes ~`FORM_SNAP_S = 0.5` s.
- Formation lap: cars are ghosts, no lap timing/sectors/lap counting, no DRS, no tyre wear, no track-limit or contact penalties, no pit stops or box calls, tower order = grid order.
- `IN POSITION` (`held`) only after the car has driven the lap (passed the half-lap mark), never while still sitting on its slot at the start.
- After the formation lap, race state is reset so lap 1 starts clean; the existing jump-start rule applies from the first light.
- Commits: only when the user asks (user rule); the per-task Commit steps mark natural commit points and are skipped otherwise. Never add `Co-Authored-By` or any trailer.
- Browser checks: `node scripts/browser-check.mjs` only (its own port 3299; the user's server on 3232 is never touched).
- HUD styling: `public/css/hud.css` tokens and DESIGN.md "HUD" section; no backdrop blur.

## Review Focus

- A player who never drives off their slot must not count as in position (else they start the 30 s clock and skip everyone's lap) — test in Task 2.
- A player who drives into the pit lane on the formation lap must not be taken over by pit assist — test in Task 2.
- The only human disconnecting mid-formation must not leave bots waiting 3 minutes — test in Task 2 (`removePlayer`).
- Host restart during the formation lap must cancel it cleanly (no stale `onFormationDone` firing lights into a new session) — test in Task 4.
- Crossing the start line during the formation lap must not count a lap; at lights every car is on lap 0 with clean timing — test in Task 2.

---

### Task 1: Grid parking in the shared sim

**Files:**
- Modify: `public/js/sim/drive.js` (new exports near `guideToBox`; `driveCar` phase handling at its top)
- Test: `test/formation.test.js` (create)

**Interfaces:**
- Produces (all exported from `drive.js`):
  - constants `FORM_SETTLE_M = 50`, `FORM_SETTLE_KMH = 80`, `FORM_SNAP_M = 1`, `FORM_SNAP_MS = 1.5`, `FORM_SNAP_RAD = 0.35`, `FORM_SNAP_S = 0.5`, `FORM_HELD_M = 0.02`
  - `slotFrame(p, slot, scale) -> { a, l, h, d }`: metres along the slot heading (`a < 0` short of the mark), metres to the side, heading error (rad, wrapped), distance. Same frame as `guideToBox` (extract and reuse it there).
  - `gridSettle(p, input, t) -> input`: returns a copy of `input` whose `steer` is blended toward the slot's centre line when `p.form?.phase === 'approach'` and speed < `FORM_SETTLE_KMH`; the blend is weak (player steering of ±1 always wins: the nudge adds at most ±0.35 lock and fades to 0 at `FORM_SETTLE_M`); throttle/brake untouched.
  - `driveCar` behaviour: `p.form.phase === 'held'` → car zeroed in place like the pit `service` phase; `'snap'` → input ignored, pose moves toward `p.grid` (`{ x, y, angle }`) exponentially (time constant `FORM_SNAP_S / 3`), velocity zeroed; `'approach'` → `input = gridSettle(p, input, t)` before the existing flow; `'drive'`/no form → unchanged.

- [ ] **Step 1: Write failing tests** in `test/formation.test.js` (CommonJS like `test/drive.test.js`, Monza via `Track.load('monza')`, slot = `track.startPositions[4]`):
  - `slotFrame: 10 m short of the slot on its heading reads a ≈ -10, l ≈ 0, h ≈ 0`
  - `gridSettle: off the line with no steering, the nudge steers toward the slot line; full opposite lock still steers away` (sign checks on `steer`)
  - `gridSettle: above 80 km/h or before approach, input is returned unchanged` (deepEqual)
  - `driveCar snap: from 0.6 m off and 0.2 rad, 60 ticks at dt 1/60 land within FORM_HELD_M and 0.01 rad of the slot`
  - `driveCar held: throttle 1 for 60 ticks moves the car 0 m`
  - `driveCar without form: identical to before` (one tick from a fixed state equals a recorded copy, or rely on `test/simGolden.test.js` staying green)
- [ ] **Step 2:** `node --test test/formation.test.js` → FAIL (`slotFrame is not a function`).
- [ ] **Step 3:** Implement in `drive.js` as specified above; refactor `guideToBox` to call `slotFrame`.
- [ ] **Step 4:** `node --test test/formation.test.js test/simGolden.test.js test/pitassist.test.js test/drive.test.js` → PASS.
- [ ] **Step 5:** Commit `Add grid parking assist to the shared sim`.

### Task 2: Formation state machine in Game

**Files:**
- Modify: `src/game/Game.js` (constructor fields, `META_FIELDS`, `update()`, `updateBots()`, `updateRanks()`, `setBoxCall()`, `setNextCompound()`, `removePlayer()`, new methods)
- Test: `test/formation.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - constants in Game.js: `FORMATION_WAIT_S = 30`, `FORMATION_MAX_S = 180`
  - per car (race mode): `p.grid = { x, y, angle }` (the start slot; `gridX/gridY` stay for the jump-start rule); `p.form = null | { phase: 'drive'|'approach'|'snap'|'held', half: boolean }`. Add `'form'` and `'grid'` to `META_FIELDS`.
  - `game.formation = null | { startedAt: number (session clock s), firstHeldAt: number|null }`
  - `game.onFormationDone = null | () => void` (set by socketManager; called once)
  - `startFormation()`: sets `formation`, every car `form = { phase: 'drive', half: false }`, `ghost = true`, stores `p.formWearPerM = p.wearPerM` and sets `wearPerM = 0`.
  - `updateFormation(p)` (per car, after `drive`): `half ||= lapS within [0.35, 0.65] of the lap`; `drive → approach` when `half` and `slotFrame.d <= FORM_SETTLE_M`; `approach → snap` when `d <= FORM_SNAP_M`, `|speed| <= FORM_SNAP_MS`, `|h| <= FORM_SNAP_RAD`; `snap → held` when `d <= FORM_HELD_M` and `|h| <= 0.01` (pose set exactly to the slot); on a human's first `held` set `firstHeldAt` and emit `formation { phase: 'forming', endsInMs: 30000 }`; `approach → drive` again if the car leaves `FORM_SETTLE_M * 1.5`.
  - `formationTick()` (once per `update`, after the car loop): finish when every car is `held`, or `firstHeldAt` is 30 s old, or `startedAt` is 180 s old → `endFormation()` then `onFormationDone?.()`.
  - `endFormation()`: every non-held car placed on `p.grid` (x, y, angle, zero velocity); every car reset: `lap 0, checkpoint 0, passTimes {0: 0}, lapStart 0, lastLap null, sectors [null×3], lapValid true, offLimits false, fromPit false, wear 0, wearPerM = formWearPerM, penalty 0, jumpStart false, throttledEarly false, reacted false, drs false, drsEligible [], stop null, boxCall null, ghost = settings.ghostStart !== false, form null`; a pending `nextCompound` is fitted as on the grid today; `incidents` and `contacts` cleared; `formation = null`; emit `formation { phase: 'done' }`.
- Guards while `formation` is set: skip `checkJumpStart`, `updateStop`, `checkBoxMissed`; `setBoxCall` ignored; `setNextCompound` stores `nextCompound` (fitted at `endFormation`); `updateRanks` ranks by grid index (`this.index`); bots in formation: `BotDriver.drive(p, { ...ctx, frozen: false, formation: true })` while `form.phase === 'drive'` (driver scales its target speed by `FORMATION_PACE = 0.6` when `ctx.formation`), else their input is irrelevant (the assist parks them; for `approach` give bots `{ throttle: 0, brake: 1 }` once `d < 8` so they stop near the mark, then snap takes over).
- `removePlayer`: if no human is left during formation, finish it at the next `formationTick`.

- [ ] **Step 1: Write failing tests** (append to `test/formation.test.js`; build a 3-car race `new Game(io, [lp('a'), lp('b'), bot('c')], monza, { ...RACE }, () => {}, 'race')`, drive cars by teleport + `update()`):
  - `startFormation: every car ghost, form.phase drive, no tyre wear after 200 m`
  - `a car still on its slot at the start never becomes held` (100 updates idle → phase `drive`)
  - `after half a lap, stopping 0.5 m from the slot snaps and holds; firstHeldAt set; 'forming' emitted with endsInMs 30000`
  - `30 s after the first human is held, the rest are placed on their slots and onFormationDone fires once`
  - `a bot held first does not start the 30 s clock`
  - `180 s with nobody held ends the formation`
  - `crossing the start line during formation counts no lap; after endFormation every car has lap 0, lapStart 0, penalty 0, lapValid true`
  - `driving into the pit lane during formation: no stop phase is ever set`
  - `ranks during formation follow grid order even when car 3 drives ahead`
  - `the only human leaving ends the formation on the next tick`
- [ ] **Step 2:** `node --test test/formation.test.js` → new tests FAIL.
- [ ] **Step 3:** Implement as specified; bot pace hook in `src/game/bots/driver.js` (`FORMATION_PACE = 0.6` applied to its target speed when `ctx.formation`).
- [ ] **Step 4:** `npm test` → all PASS (golden traces untouched: no formation without `startFormation`).
- [ ] **Step 5:** Commit `Add formation lap state machine to the race`.

### Task 3: Session flow and host setting

**Files:**
- Modify: `src/socketManager.js` (`startRace`, pause/restart status lists, default settings), `src/lobby.js` (`sanitizeSettings`)
- Test: `test/socketManager.test.js`, `test/lobby.test.js`

**Interfaces:**
- Consumes: `Game.startFormation()`, `game.onFormationDone`.
- Produces: status `'FORMATION'` (between `'COUNTDOWN'` draw-wait and the lights); socket event `formation` `{ phase: 'start' | 'forming' | 'done', endsInMs? }`; setting `formationLap: boolean` (default `true`).
- Flow in `startRace`: status `COUNTDOWN` → wait for all drawn (unchanged, `DRAWN_WAIT_MS`) → if `settings.formationLap !== false` and the grid has a human: `setStatus('FORMATION')`, `race.onFormationDone = () => { setStatus('COUNTDOWN'); lights(); }`, `race.startFormation()`, emit `formation { phase: 'start' }`; else `lights()` as today. Both callbacks check `gameInstance === race`.
- Host restart allowed in `FORMATION` (add to the list with `COUNTDOWN`); host pause allowed in `FORMATION` (add to the pause list).

- [ ] **Step 1: Failing tests:**
  - socketManager: `with a human on the grid, the session goes COUNTDOWN → FORMATION once drawn, and the lights start only after the formation is done` (drive the fake Game's `onFormationDone`)
  - socketManager: `bots-only grid or formationLap false: straight to the lights as before` (existing lights test still passes)
  - socketManager: `host restart during FORMATION: no lights fire from the old race`
  - lobby: `sanitizeSettings keeps formationLap booleans and ignores other types`
- [ ] **Step 2:** `node --test test/socketManager.test.js test/lobby.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Run a formation lap before the start lights`.

### Task 4: Client — status, prediction and HUD

**Files:**
- Modify: `public/js/socket.js` (`formation` event → `window.onFormation(d)`; `FORMATION` in status handling), `public/js/app.js` (`handleStatusChange`: `FORMATION` shows the game screen, lights hidden; host setting select; settings summary row), `public/js/predict.js` (`setForm({ form, grid })` like `setTyres`, from meta), `public/js/game3d.js` (`inSession`/`canPause` include `FORMATION`; HUD; own slot glow), `public/index.html` (gauge markup, setting select), `public/css/hud.css` (gauge styles)
- Test: browser check (below); `test/predict.test.js` gets one test for `setForm`.

**Interfaces:**
- Consumes: meta `form`, `grid`; event `formation`; status `FORMATION`.
- Produces (DOM):
  - `#form-gauge` above the dash inside `#hud-bottom`: `<span id="fg-pos">P5</span><div class="fg-bar"><i></i></div><span id="fg-dist">12.4 m</span>`; classes `.ok` (green, inside `FORM_SNAP_M`), `.over` (red, `a > 0`), `.held` (text `IN POSITION`); visible only in `FORMATION` once `form.phase !== 'drive'`.
  - Tower: `#tt-session` = `FORMATION LAP`, `.tt-lap` hidden in `FORMATION`.
  - `#session-bar`: `GRID FORMING · 0:24` counting down from the `forming` event.
  - Banner `FORMATION LAP` on `phase: 'start'` (neutral tone); none on `done` (the lights take over).
  - Own slot glow: in `gridBoxes`, keep a handle to the player's own slot; during `FORMATION` show a flat team-colour emissive quad over it (one mesh, `MeshBasicMaterial`, no light).
  - Lobby: `#setting-formation` select (`On`/`Off`) in the host race settings next to ghost start; summary row `Formation lap: On|Off`.

- [ ] **Step 1:** Test `predict: setForm copies form and grid onto the predicted car and survives reset` → FAIL, implement, PASS.
- [ ] **Step 2:** Implement the client pieces above.
- [ ] **Step 3: Browser check** (port 3299, own server; the end-to-end timing is covered by Task 2/3 tests, this checks the look):
  `node scripts/browser-check.mjs --track monza --level high --time day --views chase,cockpit --bots 5 --eval "clientState.gameState[clientState.me].form = { phase: 'approach', half: true }" --out <scratchpad>/form`
  Expected: tower head reads `FORMATION LAP`, the stop gauge shows above the dash with `P<n>` and a distance, the own slot glows, no console errors in the JSON line.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Show the formation lap and the grid-slot guide in the HUD`.

### Task 5: Docs

**Files:** `DESIGN.md` (HUD section: formation gauge, slot glow, grid-forming clock), `docs/superpowers/specs/2026-10-24-formation-lap-design.md` (mark implemented).

- [ ] **Step 1:** Update DESIGN.md HUD bullets with the gauge states and colours (green = in tolerance, red = past the mark, team colour = own slot).
- [ ] **Step 2:** Commit `Document the formation lap HUD`.
