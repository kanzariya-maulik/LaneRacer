# LanRace AI Drivers — Design Spec

Date: 2026-10-12
Status: Approved in chat (parts 1–3), pending written-spec review
Builds on: `develop` at 268723b (netcode input cushion, binary fast updates; qualifying, box call, tyres, pit assist, fair racing rules)

## Goal

A host setting that fills the empty grid with AI drivers at a chosen difficulty, so one player can race a full field alone and a few friends on LAN always get a full 20–22 car race. Bots play the whole game: they qualify with real runs, race wheel to wheel, make human mistakes, and run a tyre and pit strategy.

## What exists today

- `Game` runs every car from `p.input` through the shared sim (`Drive.driveCar`), with the same rules for all cars: track limits, contact penalties, ghost start, DRS, slipstream (`p.tow`), pit assist (`lane → guide → service → hold → out`), compound rule (`finishCar`).
- Racing line (`track.racingLine`, `RacingLine.compute`): per path point `offset` from the centreline, target `speed` (profile with braking), `phase`, corner `limit`; `lapS` = ideal lap time.
- Grid: 11 teams × 2 seats (`public/teams.json`), `MAX_RACERS = 22`; `lobby.pickRacers`, `lobby.canJoinTeam`.
- Pit control: `Game.setBoxCall(id, on)`, `Game.setNextCompound(id, c)`. Quali box exit: throttle while `canLeaveBox(p)`. Release from `hold`: an edge-triggered throttle press.
- Tyres (`public/js/sim/tyres.js`): life S 0.40 / M 0.65 / H 0.90 of race distance, grip S 1.06 / M 1.00 / H 0.95, fade to 80 % wear, cliff beyond.
- Session flow (`socketManager`): `startQuali(racers)` → `quali_results` → `startRace(grid)`, where `grid = results.map(r => state.players[r.id])`.

## Decisions

| Topic | Decision |
|---|---|
| Who it's for | Solo vs a full AI grid, and LAN races padded to a full field |
| Setting | Host: `aiDrivers` on/off (default off), `aiLevel` `easy` / `medium` / `hard` / `pro` (default `medium`) |
| Fill | At session start, every free team seat up to 22; humans always keep their seats |
| Difficulty | One level for the field, each bot ±1.5 % pace spread around it |
| Pace targets (lap vs racing-line `lapS`) | Easy 112 %, Medium 105 %, Hard 101 %, Pro 99.5 % (calibrated by test, bands ±1 %) |
| Physics | Same sim as humans, driving with full help (the human default), so pace compares fairly |
| Racecraft | Overtake with tow/DRS on the inside of the next corner, no ramming, one defensive move, room when alongside, blue flags |
| Mistakes | Per-corner chance by level (late brake / early brake / missed apex), suppressed with a car alongside or close behind |
| Qualifying | Out-lap → push laps → in-lap; Hard/Pro go out late for track evolution, second run if in the drop zone; Softs |
| Race strategy | Legal 1- or 2-stop plan per bot, varied across the grid, stints ≤ 75 % wear, adapts to wear, undercut on Hard/Pro |
| Names | Fictional names (no real drivers), "AI" tag in tower and results |

## 1. Roster and lobby

### Settings (`lobby.sanitizeSettings`)
- `aiDrivers: boolean` (default `false`), `aiLevel: 'easy' | 'medium' | 'hard' | 'pro'` (default `'medium'`). Anything else keeps the current value.
- Lobby UI (`index.html`, `app.js`): an "AI drivers" toggle and a level select in the host settings, shown read-only to others like the other settings.

### Roster (`src/game/bots/roster.js`, pure)
- `fillGrid(humans, level, seed)` → bot player records `{ id: 'ai-<n>', username, teamId, assist: { steer: 1, brake: 1 }, compound, isBot: true, ai: { level, pace, aggression, mistake, reaction, seed } }`, one per free team seat (a team holds at most 2 cars: humans first), until `humans + bots = 22`.
- `pace`: the level's target lap fraction × (1 + uniform(−0.015, 0.015)); `aggression`, `mistake`, `reaction` from the level table (§2), each with a small per-bot jitter. Seeded RNG (`seed` from the session) so a test can reproduce a grid.
- Names: a fixed list of fictional names in the module, shuffled by the seed, never repeated in one session.

### Session flow (`socketManager`)
- `start_game`: when `aiDrivers` is on, `state.bots = roster.fillGrid(racers, aiLevel, Date.now())`; racers = humans + bots. Bots are never in `state.players` (lobby, ready checks, kicks and chat ignore them).
- Quali → race: the grid maps result ids through `state.players` **or** `state.bots`, so bots keep their qualifying positions. A human who left is dropped as now; their seat is not refilled mid-session.
- `restart_session` keeps the same bots. Back to the lobby (`finishRace`) clears `state.bots`; the next start draws a fresh grid.
- Solo: the host alone may start (the ready check already passes with no other humans).

### Visible to players
- `ai: true` joins `Game.META_FIELDS` (sent in `game_init` and meta), so the timing tower and results show an "AI" tag next to bot names. Bots are cars in the fast update like any other (34 bytes each); no other network change.

## 2. Driving and racecraft (`src/game/bots/driver.js`, pure)

`drive(bot, car, ctx) → input { throttle, brake, steer, drs }`, called by `Game.update` for each bot car before `drive(p)`, replacing the input queue for that car. `ctx` = `{ track, cars (nearby, see below), time, frozen, mode, rng }`. Bot cars skip the input queue, starve counting, input timeout and slack.

### Following the line
- Track position: nearest racing-line index (`racingline.trackIndex`-style search from the last index, cached on the car).
- Steering: pure pursuit to a target point on the racing line `L = clamp(0.35 s × speed, 12 m, 60 m)` ahead, shifted sideways by the bot's current lane offset (racecraft). Output `steer` = the needed wheel angle ÷ the car's current max steer, clamped to ±1.
- Speed: target `v* = racingLine.speed[i_ahead] × speedFactor`, `speedFactor = 1 / pace`, looking ahead over the braking distance (the profile already contains braking, so the bot reads the target `≈ 0.15 s` ahead to cover throttle/brake response). Throttle/brake from the speed error with a small dead band; no throttle and brake together.
- Pit lane and quali box: when the pit assist is driving (`stop` phase `lane`, `guide`, `service`, `out`) the bot only supplies throttle presses where the rules need them (box exit, release).

### Level table

| | Easy | Medium | Hard | Pro |
|---|---|---|---|---|
| pace (lap ÷ `lapS`) | 1.12 | 1.05 | 1.01 | 0.995 |
| aggression (0–1) | 0.2 | 0.45 | 0.7 | 0.9 |
| mistake chance per corner | 4 % | 2 % | 0.8 % | 0.2 % |
| start reaction (s) | 0.35–0.45 | 0.28–0.38 | 0.22–0.3 | 0.18–0.24 |
| release press delay (s) | 0.3–0.8 | 0.15–0.5 | 0.05–0.3 | 0–0.15 |

### Awareness
- Each tick the game builds, once, the list of cars sorted by distance along the lap; each bot looks only at cars within 150 m ahead or 60 m behind (wrapped around the lap), with their gap (m), closing speed and lateral offset from the centreline. O(n log n) per tick for the sort, O(nearby) per bot.

### Racecraft (lane offset + speed cap)
- **Follow:** car ahead within 2 s at a speed the bot can't hold behind → speed cap = the leading car's speed while the gap is under `max(8 m, 0.4 s)`; never closes into it without a lane free.
- **Overtake:** gap under 1 s and the bot faster (or in tow / DRS): picks the side with room, preferring the inside of the next corner, and shifts its lane offset by up to 0.6 × half track width (kept inside the white lines with a margin). Commits only if, at the braking point, its nose is past the other car's rear axle; otherwise drops back onto the line. Higher aggression starts the move earlier and brakes later on the inside (within the car's real limit).
- **DRS:** `drs = true` whenever `p.drsAvailable` and in a DRS zone (the game decides eligibility as for humans).
- **Defend:** a car within 0.5 s behind before a braking zone → one move toward the inside, made before the braking point, then held until the corner; no second move on that straight. Easy bots don't defend.
- **Room:** a car overlapping alongside (≥ 30 % of a car length) → the bot keeps its lane and won't take the line across it through the corner.
- **Blue flags:** a car a lap or more ahead closing within 1.5 s → the bot moves to the outside off the line and lifts slightly until it's past.
- **Ghost start:** while `p.ghost`, bots race normally (ghost cars can't touch).

### Mistakes
- At each corner entry (racing-line `phase` turns to braking), roll `mistake`: late brake (target read 0.15 s later, runs wide, may cost track limits as for a human), early brake (target × 0.92 for the corner), or missed apex (lane offset +1.5 m outward through it). Skipped when a car is alongside or within 0.6 s behind. Recovery: lane offset eases back to the line over ~1 s.
- Race start: reaction from the level table after lights out; Easy has a 15 % chance of a 0.3 s bog (throttle held at 0.6).

## 3. Strategy (`src/game/bots/strategy.js`, pure)

### Qualifying
- Wait in the box (`stop.phase 'wait'`) until a planned exit time in the segment: Easy uniform over the first 60 % of the clock; Medium 30–70 %; Hard/Pro 55–75 %. Exit = throttle while `canLeaveBox`. Never later than `endsAt − (outLap + pushLap) × 1.2`.
- Run: out-lap at 90 % of race pace, then 2 push laps (1 if the clock won't allow 2; one-shot: exactly one flying lap), then the in-lap: crossing the pit entry ends the run and the pit assist parks the car.
- Second run: back in the box with time for another out-lap + push lap before the flag, and in the drop zone (or without a time) → go again. Otherwise stays parked.
- Tyres: Softs (`setNextCompound('S')` while parked).
- Knocked out: parks as humans do.

### Race plan
- At lights out (`planRace(level, maxLaps, rng)`), with tyre wear on and `maxLaps ≥ 2`: candidate plans 1-stop `M→H`, `H→M`, `S→H`; 2-stop `S→M→S`, `S→H→S`. Each stint's laps = share of the race ≤ `0.75 × life × maxLaps` for its compound; plans that can't fit are dropped. Weights: 2-stops more likely on Hard/Pro and when `maxLaps ≥ 15`; the grid gets a spread so not all bots match. Start compound fitted on the grid via `setNextCompound` while frozen.
- Tyre wear off, or `maxLaps < 2`: no stop, Softs.
- Each lap past halfway through a stint: box this lap if `wear + wearPerLap × lapsToNextEntry > 0.75` (adapts to actual wear). Last lap: never box, unless the compound rule is still unmet (then box at the first chance before the last lap).
- Undercut (Hard/Pro only): stuck within 1.5 s of a car ahead for 2+ laps, inside the stint's last 30 % → box a lap early.
- Calling: `setBoxCall(id, true)` and `setNextCompound(id, next)` once the decision is made (before `BOX_NEXT_M` to the entry, else it carries to the next lap like a human's).
- Release from `hold`: throttle press after the level's release delay.

## 4. Game integration (`Game.js`)

- `players[id].isBot`; `ai` in `META_FIELDS`. `handleInput(s)` ignore bot ids.
- In `update()`, before the drive loop: build the lap-order list once, then for each bot `p.input = driver.drive(...)` and `strategy.tick(...)` (box calls, compounds, quali exits). Order of everything else unchanged.
- One seeded RNG per game (`settings` session seed) shared by the bot modules, so tests are deterministic.
- `removePlayer` is unaffected (bots never disconnect). A game with only bots left (every human gone) ends as now when the last human leaves (`removePlayer` host logic): `state.hostId` empty → `gameInstance.stop()`.

## 5. Edge cases

- 22 humans: no bots added; bots only ever fill free seats.
- A human picks a team seat between sessions: next `fillGrid` respects it (bots are rebuilt every start from the lobby).
- Pause: bots stop with the tick (no tick runs while paused).
- Collisions off / ghost cars: bots still follow, overtake and pit; contact logic simply never fires.
- Quali with < 4 drivers runs as Short (existing rule), but with bots the grid is full, so Full runs normally.
- Host disconnect: unchanged (the host passes to another human; bots never become host).

## 6. Testing

- `test/botRoster.test.js`: fills to 22 with humans in place; never puts 3 cars in a team; unique fictional names; same seed → same grid; settings sanitising.
- `test/botStrategy.test.js`: every plan for maxLaps 2…50 meets the compound rule and keeps each stint ≤ 75 % wear; wear-based early stop; undercut only on Hard/Pro; no last-lap box unless the rule is unmet; no stop with wear off / 1 lap.
- `test/botDriver.test.js`: a lone bot completes clean laps (no track-limit strikes, no wall hits) on Monza, Monaco, Silverstone and one more; lap time within each level's band (±1 % of target); a faster bot passes a slower one within N laps without contact; a bot behind a stopped car doesn't hit it; defending makes one move only.
- `test/botSession.test.js`: a full quali (Full format, `qualiScale` short) and race with 1 scripted human + 21 bots on a short race: every car classified, every bot that raced 2+ laps used two compounds, bots pitted, tick cost (`tickMs`) stays under 4 ms on the dev machine.
- Browser check: headless Chrome over CDP as in the netcode work: lobby toggle, solo start, AI tags in the tower, 60 fps with a full grid.
