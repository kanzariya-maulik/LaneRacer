# Formation lap

Status: implemented (plan docs/superpowers/plans/2026-10-24-formation-lap.md).

## Why

At a LAN party every friend's browser finishes loading at a different time: car models arrive (21 MB over WiFi), shaders get built on first sight, textures upload. Today that work lands in the countdown and the first racing seconds, so slow laptops stutter or freeze right when it matters. A formation lap, the slow lap real F1 and the F1 game run before the start, gives every browser one untimed lap to see every car and every corner, so the race itself starts smooth. It also makes the start feel like F1.

The one part the user cares about most: at the end of the lap, players must end up exactly on their own grid slot without fuss, and they must feel they parked the car themselves.

## Goals

- Before every race (after qualifying, or straight from the lobby), the grid drives one formation lap before the start lights.
- Players drive their own cars the whole lap.
- At the end of the lap, the game helps each player find and stop on their grid slot, while they stay in control.
- Bots drive the formation lap and park themselves.
- Then the existing five-light start runs as today, with the existing jump-start rule.

## Non-goals

- No safety car, no virtual safety car, no formation-lap penalties beyond what is below.
- No change to qualifying, the pit lane, or the race itself after lights out.
- Not a replacement for the `world_drawn` wait: the session still waits (up to 60 s) for every browser to be ready (models in, pipelines compiled, frames settled) before the formation lap starts, exactly as the lights wait today. The formation lap covers the loading that happens *after* the first draw (late models, shader builds for corners not yet seen).

## Anti-goals (a failure even if it technically works)

- The game drives the car for the player (auto-throttle, auto-brake, teleport while they're trying to park). Players must feel in control.
- One slow or spun friend holds the whole lobby for minutes.
- A player crashes into someone on the formation lap and ruins their race before it starts.
- The formation lap counts as a race lap, sets lap times, gives DRS, or wears tyres in a way that matters.

## How it plays

### 1. Start of the formation lap
- Cars are drawn on the grid as today (status `COUNTDOWN` today; the formation lap is a new phase between "everyone has drawn" and the lights).
- Banner: `FORMATION LAP`. Cars are released immediately (no lights for the formation start, as in real F1; the leader goes first naturally).
- HUD tower head reads `FORMATION LAP` instead of `LAP 1 / n`. The timing box shows no lap time.

### 2. During the lap
- Cars are ghosts to each other for the whole formation lap (pass through, no contact, no stewards), regardless of the ghost-start setting.
- No lap timing, no sectors, no DRS, no track-limits penalties, no tyre wear, no pit stops (the pit entry is not taken over by pit assist; a car that drives into the pit lane is just driving).
- Position on the tower is grid order, not track order: overtaking on the formation lap changes nothing.
- No overtaking (user's call: a warning only): passing a car that starts ahead shows the steward card "No overtaking on the formation lap · Let <name> back past", once per pass; no penalty.
- Speed is not capped (the user decides how to drive), but bots drive at a formation pace (my call: ~60 % of their race pace, weaving is not needed).

### 3. End of the lap: finding and stopping on your slot (the core)
The player does the driving: throttle, brake and stopping are always theirs. The game helps in three quiet ways:

1. **Steering settle (last ~50 m before the slot):** a gentle steering nudge toward the centre line of the player's own grid box. It blends with the player's input, is weak enough that steering against it wins, and only acts below a modest speed (my call: under ~80 km/h).
2. **Stop gauge (F1-game style):** above the dash, `P5` and a bar that fills as the car closes on its mark with the remaining distance (`12.4 m`). It turns green inside the box tolerance, red past the mark. The player's own painted grid box glows in their team colour; other boxes stay as painted.
3. **Soft snap:** once the car is stopped (or nearly: walking pace) within ~1 m of the mark and roughly straight, the game slides it smoothly (over ~0.5 s) onto the exact slot position and heading. `IN POSITION` shows and the car is held there until the lights.
- **Only after the lap:** the stop gauge, the snap and `IN POSITION` switch on only once the car has completed the formation lap (passed every checkpoint). A car sitting on its slot at the start is not "in position".
- **Held until the lights:** once `IN POSITION`, the car is held on its slot (like a parked pit stop) while the rest of the grid forms up, so nobody can wander off. The hold ends when the five-light sequence begins; from then on it is the existing jump-start rule, exactly as today.
- **Overshoot:** if the player passes the mark, they can reverse back slowly, using the walking-pace reverse that pit stops already use; the gauge shows the distance back.

### 4. Waiting for the rest of the grid
- When the **first human** car is in position, a 30-second clock starts (bots don't start it: a back-of-grid bot parks early, and its parking must never cut a human's lap short) (shown on the HUD: `GRID FORMING · 0:24`).
- Any car not in position when it runs out is placed on its slot automatically (instant, from wherever it is; it's out of sight of the others anyway). The user chose 30 s.
- Safety cap: the whole formation lap ends after 3 minutes even if no human ever parks (everyone idle, stuck or away from the keyboard); then everyone is placed.
- A race with no humans (bots only) skips the formation lap.
- When every car is in position (or the 30 s ran out), the existing five-light sequence runs and the race starts. Holding position from now on is judged by the existing jump-start rule.

### 5. Bots
Bots follow their normal driving line at formation pace and, near their slot, stop on it using the same guide (they can use the full assist, snap included). They never wait on anything.

## What carries over / constraints

- Server-authoritative: the formation lap phase, "in position", the 30 s clock and auto-placing are decided by the server (`src/game/Game.js`, `src/socketManager.js`). The client predictor shares the sim (`public/js/sim/drive.js`), so the steering settle and snap belong in the shared sim like pit assist and `guideToBox` do today.
- After the formation lap, every car's race state is reset so lap 1 starts clean: lap counter, checkpoints, pass times, sectors, lap validity, tyre wear, penalties, `jumpStart`/`throttledEarly`, DRS eligibility. Grid slots (`gridX/gridY`) don't change.
- Reconnects, kicks and host pause/restart must work during the formation lap as they do in other phases.
- Host setting: `Formation lap: On / Off` in the race settings, default On (my call: lets them skip it for quick test races; also keeps existing tests meaningful).
- Must stay smooth on the weakest laptop; no new heavy rendering (the glowing slot is a simple emissive decal, not a light).

## Decided by the user
- Players drive the formation lap themselves.
- At the end, help is a combination: the player drives and stops, the game guides and finishes the last bit.
- 30 seconds after the first car is in position, the rest are placed automatically.

## My calls (flag if wrong)
- 30 s clock starts when the first human car is in position; bots don't start it.
- In position only after completing the lap; then held on the slot until the lights begin, after which the jump-start rule applies.
- Overall 3-minute cap on the formation lap; bots-only races skip it.
- Ghost cars, no timing, no wear, no DRS, no penalties on the formation lap.
- Formation start without lights; the formation lap begins as soon as every browser has drawn the grid.
- Bot formation pace ~60 %.
- Settle radius ~50 m, below ~80 km/h; snap within ~1 m at walking pace.
- Host setting, default On.

## Left to the builder
- Exact tuning of the steering nudge, snap tolerance and gauge thresholds (playtest).
- How the "own slot glow" is drawn, as long as it's cheap.
- Wire format for the new phase and events, naming, and where the server state machine changes live.
- Test plan (server phase transitions, auto-place timeout, state reset after formation, snap behaviour in the shared sim).
