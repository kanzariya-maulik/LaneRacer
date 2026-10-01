# LanRace Qualifying Format, Sectors, Track Limits & Assists — Design Spec

Date: 2026-10-01
Status: Approved in chat (sections 1–4), pending written-spec review
Builds on: `2026-10-01-pitlane-grid-design.md`

## Goal

Make sessions read like real F1 for a LAN group with mixed skill. Qualifying becomes an out-lap plus two flying laps from the garages, with the pit entry closed. Laps show three real sectors coloured purple, green or yellow. Track limits are enforced, and per-player assists help newer drivers turn and brake.

## Decisions

| Topic | Decision |
|---|---|
| Quali format | Out-lap + 2 flying laps from the garage, then the car is done. Best valid lap sets the grid. Session ends when all are done, or 6 min after the start. |
| Pit lane | Entry closed in quali and race (barrier before the first garage). Used only to leave the garage in quali. |
| Sectors | 3 per circuit at the real FIA split points, researched by landmark into `circuits.json`; unconfirmed values flagged. |
| Track limits | F1 rules: quali lap deleted; race 2 warnings, then +5 s per violation; slower grass. |
| Assists | Per player in the lobby: Off / Steering / Full (Full = Steering + braking assist). Default Steering. Badge in the timing tower. |

## 1. Qualifying format and pit lane

### Settings
- `settings.qualiMinutes` (0–10) is replaced by `settings.qualifying` (bool). `false` = race from a join-order grid, as `qualiMinutes: 0` did.
- Lobby UI: a "Qualifying" on/off toggle replaces the minutes input.

### Session
- All cars spawn at their garage boxes (as now).
- Per car, the lap phase runs: `out` (untimed), then `flying 1`, then `flying 2`, then `done`.
  - The first line crossing after leaving the pit starts flying lap 1.
  - Each later line crossing ends the current flying lap and starts the next.
  - The crossing that ends flying lap 2 sets the car to `done`.
  - A deleted lap (track limits) still uses up one of the two flying laps.
- A `done` car stops where it is: velocity zeroed, inputs ignored, still a ghost. The car's owner sees "QUALIFYING COMPLETE — P<n>" and can spectate.
- Grid order: best valid lap ascending. Cars without a valid lap go last, in join order.
- End: all cars `done`, or `QUALI_MAX_S = 360` s after the start. At the cap, unfinished cars keep their best valid lap so far.
- HUD session bar: "OUT LAP", "LAP 1/2", "LAP 2/2", "COMPLETE".
- Removed: the chequered-flag phase, the 150 s cutoff and the "idle cars finish at the flag" rule (replaced by `done`). `session` events report `phase: 'QUALIFYING'` with `endsInMs` = time left to the 6-min cap.

### Pit entry closed
- `Track.buildPit` gains `closeS` = start of the first garage (upstream end of `garageSpan`) − 10 m.
- **Physics:** the pit corridor only counts for pit positions `pitS ≥ closeS`. Upstream of that, the pit lane behaves as off-limits:
  - The barrier check treats it as outside the pit corridor.
  - A barrier segment runs across the lane at `closeS`, between the pit wall and the outer wall. Cars bounce off it with the existing wall response.
- **Client:** a "PIT CLOSED" board and a red-and-white barrier at `closeS`. The pit strip, edge lines and minimap pit line are drawn only from `closeS` to the exit.
- The existing "pit entry cancels the lap" rule stays as a harmless backstop.

## 2. Sectors

### Data
- `circuits.json` adds `sector2M` and `sector3M` per circuit: distances along the lap from the start line. They are researched from official F1 circuit maps by landmark, and listed in `unconfirmed` where uncertain by more than 50 m.

### Checkpoints
- `Track.build` places checkpoints so that the start line and both sector lines are checkpoints, with the rest evenly spaced inside each sector. Each sector gets `max(3, round(16 · sectorLength / lapLength))` checkpoints.
- `track.sectorCps = [0, i2, i3]` are the checkpoint indices of the three sector starts.

### Timing (server)
- A sector time is the difference between the pass times at consecutive sector checkpoints. Sector 3 ends at the start line.
- Per player:
  - `sectors`: the current lap's sector times so far
  - `bestSectors`: the best valid time per sector
  - `lapValid`: whether the current lap is still valid
- Per session: `sessionBestSectors`, from valid laps only.
- On each sector completion the server emits `sector` with `{ id, lap, sector: 1|2|3, time, valid, personalBest, sessionBest }`. Only valid times can be personal or session best.
- Quali only: the timing tower needs each driver's sector colours on their best lap, so `game_state` carries `bestLapSectors` (three times or `null`).

### Client
- **Sector panel** beside the lap times shows `S1 S2 S3` for the current lap:
  - purple: session best
  - green: personal best
  - yellow: slower than personal best
  - grey: lap invalid
  - It clears when a new lap starts.
- **Sector flash**, about 2 s: `S2 31.204 −0.087`, coloured as above. The delta is against the personal best; no delta on the first time in a sector.
- **Quali timing tower:** three small colour bars per driver for their best lap's sectors, compared with the session-best sectors.
- **Race:** sector panel and flash only; the tower keeps showing gaps.

## 3. Track limits and grass

### Violation
- A violation is when the car's centre is more than `width/2 + CAR_HALF_WIDTH_M · scale` from the centreline ("all four wheels off").
- It counts once per excursion. It re-arms when the car's centre is back within `width/2`.
- Exempt:
  - in the pit lane (`inPit`)
  - quali cars on the out-lap or `done`
  - race cars before lights out

### Quali
- A violation sets `lapValid = false`. The lap time is still recorded and emitted (`timing` with `valid: false`), but it can't be a best lap or a best sector.
- The client shows "TRACK LIMITS — LAP DELETED"; the lap time is red with "DELETED".

### Race
- `p.limits` counts violations. Violations 1 and 2 send the driver "TRACK LIMITS — WARNING n/2". From violation 3 on, each adds 5 s to `p.penalty`, and the driver sees "+5s PENALTY".
- A SYSTEM chat message goes to everyone for each penalty.
- `game_state` carries `penalty` (s); the tower shows `+<n>s` next to the name.
- **Classification:** a car's race time is its finish time plus its penalty. Final results and `finishOrder` are re-sorted by race time once all cars have finished. While the race runs, live order ignores penalties, as in F1 timing.

### Grass physics (`CarPhysics`)
- On grass:
  - drive force capped at `GRASS_DRIVE_G = 0.3` g
  - rolling drag raised to `GRASS_ROLL_G = 0.6` g
  - cornering grip unchanged (`GRASS_MU 0.9`)
- Existing grass turning test (60 km/h radius ≤ 24 m) must still pass.
- New test: crossing a 30 m grass shortcut at 150 km/h loses more than 20 km/h.

## 4. Assists

### Lobby
- Player field `assist: 'off' | 'steering' | 'full'`. `lobby.sanitizeAssist` maps anything else to `'off'`. Set by a new `set_assist` event or with `join_lobby`. Shown in the lobby list.
- Client select next to the team picker. Saved in `localStorage` (try/catch) and sent on join. Default `'steering'`.

### Steering assist (`steering` and `full`)
- `CarPhysics.step(car, input, dt, scale, offTrack, assist)`. With assist, a boost `k` is 1 below 150 km/h and fades linearly to 0 at 250 km/h:
  - max steer × (1 + 0.4k)
  - lateral grip × (1 + 0.15k)
- Tests: chicane at 100 km/h radius ≤ 16 m; hairpin at 60 km/h radius ≤ 10 m; behaviour above 250 km/h identical to `off`.

### Braking assist (`full`)
- `Track.build` precomputes `safeSpeed[i]` (m/s) for each centreline point. It uses the radius of the circle through the points 15 m behind and 15 m ahead, solved for the speed at which the car's lateral grip, including downforce, holds that radius, capped at 360 km/h.
- Each tick, the car's nearest index `i` gives its position. The game scans ahead over the braking distance at its current speed plus 30 m. If a point `j` at distance `d` ahead needs a deceleration `(v² − safe[j]²) / (2d)` above `BRAKE_ASSIST_G = 2.5` g, the assist applies `throttle = 0` and `brake = max(input.brake, 1)`; otherwise the player's input is used unchanged.
- Test: at 300 km/h, full throttle and no brake, toward Monza's first chicane, the speed at the chicane's tightest point is ≤ its `safeSpeed` × 1.05.

### Transparency
- `game_state` carries `assist`. The timing tower and the results show badge **S** or **F** after the name (nothing for off).

## Testing

`npm test` (node:test):
- **Quali:**
  - out-lap untimed, then 2 timed laps, then done
  - done cars stop
  - session ends when all are done, or at 360 s
  - grid from best valid lap; no-valid-lap cars last
  - `qualifying: false` gives a join-order race grid
- **Pit:** a car driving into the pit entry from the track is stopped before `closeS`; a garage car can still drive out.
- **Sectors:**
  - sector lines are checkpoints at `sector2M`/`sector3M`
  - sector times sum to the lap time
  - personal and session best flags
  - invalid laps excluded
- **Limits:**
  - one violation per excursion
  - a quali lap is deleted but still recorded
  - race warnings then +5 s
  - results re-sorted by finish time plus penalty
  - pit lane and out-lap exempt
- **Grass:** the slowdown test above; the existing turning test still passes.
- **Assists:**
  - radius tests
  - above 250 km/h unchanged
  - braking-assist apex speed
  - `sanitizeAssist`
  - the assist reaches the car
- **Manual (browser):**
  - quali flow, sector colours and flash
  - deleted-lap and penalty messages
  - PIT CLOSED barrier
  - assist badges
  - lobby select

## Out of scope

Tyres, pit stops, fuel, Q1/Q2/Q3 knockout, racing-line overlay, steering-toward-line assist, penalties for causing collisions, stewarding of "gaining an advantage" beyond all-four-wheels-off.
