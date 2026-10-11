# LanRace F1 Qualifying & "Box, Box" Pit Call — Design Spec

Date: 2026-10-11
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `feature/teaching` (live coach) on top of `develop` (tyres, driver help, pit assist, fair racing rules)

## Goal

Qualifying that feels like real F1 and the F1 games — Q1/Q2/Q3 knockouts on a clock, last-minute drama, provisional pole — plus a race pit call: the driver calls "Box, box", picks the tyres for that stop, and is guided into the pit entry. Fun first.

## What exists today

- Qualifying (`Game` mode `'quali'`): cars start parked in their box (`stop.phase 'wait'`), each run = `outLaps` + `qualiLaps` timed laps then parked; ends when all are done or `QUALI_S_PER_LAP × laps` passes; track limits delete the lap; best lap → grid (`startQuali` → `quali_results` → `startRace`). Lobby: `qualifying` on/off, `outLaps`, `qualiLaps`.
- Tyres: pick 1/2/3 any time (`setNextCompound`); fitted at once parked in the quali box; tyre card opens 500 m before the pit entry and in the lane until serviced.
- Pit stops: entering the pit lane starts the full pit assist (lane → guide → service → hold → out).
- Grip: `driveCar` sets `p.tyreGrip = gripOf(compound, wear)` every tick (shared sim); the predictor does the same.

## Decisions

| Topic | Decision |
|---|---|
| Formats | Lobby "Qualifying": Full (Q1/Q2/Q3, default), Short, One-shot, Off; Full with < 4 drivers runs as Short |
| Knockout | Each knockout removes max(1, floor(N/4)) drivers (20 → 5/5, Q3 10) |
| Clocks | Q1 = 5, Q2 = 4, Q3 = 3.5 reference laps; Short = 6; rounded to 30 s; reference lap = racing-line lap × 1.15 |
| Runs | Unlimited runs while the clock runs; garage start each segment; chequered flag: a lap started before 0:00 counts |
| Between segments | 30 s results screen; survivors back to their boxes; knocked out stay parked and spectate |
| Grid | Q3 order, then Q2 knock-outs by Q2 time, then Q1 knock-outs by Q1 time; no time = back; tie: earlier time wins |
| One-shot | Out-lap + exactly one flying lap each (simultaneous); a deleted lap = no time |
| Fun | Track evolution (grip ×1.00 → ×1.02 over qualifying), drop zone in the tower, provisional pole banner + chat, IMPROVED / DROP ZONE banners, KNOCKED OUT / THROUGH cards, pole card |
| Pit call (race) | Key B / BOX button: "BOX, BOX", pick compound, guidance to the pit entry, BOX tag for everyone, cancel with B, carries to the next lap if missed; entering the lane without a call still pits |

## 1. Qualifying (server, `Game` quali mode)

### Settings
- `qualiFormat: 'full' | 'short' | 'oneshot' | 'off'` (sanitised in `lobby.js`, default `'full'`); `qualifying` becomes derived (`qualiFormat !== 'off'`) for existing readers. `outLaps` / `qualiLaps` are retired from the lobby UI (kept readable for old saved settings, unused).

### Session state (`g.quali`)
`{ format, segment: 1|2|3 (Short/One-shot: 1), phase: 'running' | 'flag' | 'break' | 'done', endsAt (session time), breakEndsAt, out: Set(ids knocked out), best: { [segment]: { [id]: { time, at } } } }`.

- Reference lap `refS = racingLine.lapS × 1.15` (`RacingLine.compute` returns `lapS`, the profile's lap time). Segment lengths: Full Q1 5, Q2 4, Q3 3.5 × refS; Short 6 × refS; each rounded to 30 s (min 120 s). One-shot has no clock: it ends when every car has done its flying lap or crashed out (cap 3 × refS).
- **Running:** cars may leave the box (first throttle press, as today), do any number of laps; every valid completed lap updates `best[segment][id]` (if faster). Pit visits allowed (new tyres in the box as today). A car that enters the pit lane returns to its box (`wait`).
- **Flag:** at `endsAt` the phase becomes `flag`: a car on a lap it started before `endsAt` may finish it (counts); any lap started after does not count; a car is "done" when it crosses the line after `endsAt`, enters the pit lane, or is parked. The segment ends when all cars are done (or 1.5 × refS after the flag).
- **Break (30 s):** rank the segment's drivers (time asc, tie → earlier `at`; no time = last, by order of joining), knock out `max(1, floor(N/4))` of the remaining field after Q1 and after Q2 (Full only), emit `quali_segment { segment, rows: [{id, time, gap, out}], next: segment+1 | null, breakMs }`. Every car is put back in its box (`stop.phase 'wait'`, speed 0, position on the box mark). Knocked-out cars get `p.qualiOut = true` and stay in `wait` (throttle ignored) until the session ends.
- **Done:** after Q3 (or the single segment) → grid order as in Decisions → existing `quali_results` / `startRace` flow (results now include `segment` and `time` per row).
- Clock to clients: `quali_clock { segment, phase, endsInMs, evo }` at 2 Hz (and on join).

### Track evolution
- `evo` = 1 + 0.02 × (session time driven / total planned qualifying time), capped at 1.02; constant during breaks. Server sets `p.gripEvo = evo` on every car each tick; `driveCar` uses `p.tyreGrip = gripOf(compound, wear) × (p.gripEvo ?? 1)`; the client predictor sets `car.gripEvo` from the latest `quali_clock.evo`. Race: `gripEvo` undefined (1).

### Events for the fun layer
- `quali_lap { id, time, valid, segment, pos, prevPos, pole }` after every completed timed lap (pos/prevPos in the segment ranking; `pole` true when it takes provisional pole).
- Chat: `PROVISIONAL POLE: RAHUL 1:21.403` on a new pole; `Q1: RAHUL, TEJAS knocked out` at each break.

### One-shot
- Each car: out-lap (untimed) → one flying lap (timed) → parked when it crosses the line (or enters the pits / is deleted). `best[1][id]` from that lap only if valid.

## 2. "Box, box" pit call (race)

- Client: key **B** (or a BOX button in the tyre card on touch) emits `box_call { on: true|false }`. When turning on, the tyre card opens (its three buttons; 1/2/3 pick → existing `tyre_next` / `setNextCompound`).
- Server `Game.setBoxCall(id, on)`: race only, not finished, not in the pit lane: `p.boxCall = on ? (distance along the track to pit.entryS < 200 m ? 'next' : 'this') : null`; `boxCall` joins `META_FIELDS`. On crossing the start line with `'next'` → becomes `'this'`. Cleared when service starts (`updateStop` → `service`) or when the car finishes.
- Missed entry: if the car passes `pit.entryS + 50 m` on track with `boxCall === 'this'` and did not enter the lane → stays `'this'` for the next lap and `track_limits`-style event `{ id, kind: 'box_missed' }`.
- Entering the lane without a call: unchanged (normal stop).

### Client UI
- Banner (radio style, with a short beep): `BOX, BOX — CHOOSE TYRES` on call; after a pick or 3 s: `BOX THIS LAP — SOFTS` (or `BOX NEXT LAP — …`; auto compound if no pick); `BOX CANCELLED` on cancel; `MISSED THE BOX — STAYING OUT` on `box_missed`.
- Pit-entry guidance while `boxCall === 'this'` and within 300 m of the entry: blue chevrons along the start of `pit.path` (the entry road) and HUD `PIT ENTRY 250 m` (distance along the track to `pit.entryS`).
- Tyre card: also open while `boxCall` is set; its line reads `BOX THIS LAP · NEXT: S` (or the existing text).
- Timing tower: `BOX` tag next to any driver whose `boxCall` is set (everyone sees it).

## 3. Qualifying UI (client)

- `#quali-clock` top centre: `Q2 · 4:12` (Short: `QUALIFYING · 5:40`; One-shot: `ONE-SHOT · OUT-LAP` / `FLYING LAP` per your car); red under 1:00; `FINISH YOUR LAP` (chequered) in `flag`; hidden in races.
- Timing tower in qualifying: sorted by the current segment's best; rows in the drop zone (positions > survivors after this segment) tinted red; knocked-out drivers greyed with `OUT`.
- Banners from `quali_lap` for your car: `IMPROVED P7 → P3` / `STILL IN THE DROP ZONE — P8` / `PROVISIONAL POLE`; everyone sees `PROVISIONAL POLE — RAHUL 1:21.403`.
- `#quali-break` overlay during breaks: `Q1 RESULTS` list (pos, name, time, gap; knocked-out rows red with `KNOCKED OUT`, others `THROUGH`), `Q2 starts in 0:18`; your own row highlighted; final break shows `POLE POSITION — RAHUL 1:20.998` card.
- Knocked-out drivers: camera follows the leader (existing spectate follow) while their car stays parked; a small `KNOCKED OUT — P8` chip.
- Lobby: the Qualifying select gets four options; Out-laps / Timed laps inputs removed.

## Edge cases

- Disconnect mid-qualifying: the driver keeps their segment best; ranked with it (or last); removed from later segments.
- Late joiner: spectator (as today).
- Fewer than 4 drivers with Full: runs as Short (lobby summary says so).
- All remaining drivers done after the flag: segment ends at once.
- Host restart / pause: as today (pause also stops the quali clock).
- Box call in qualifying: ignored (tyres are picked in the garage).
- Box call while in the pit lane or finished: ignored.

## Testing

- Knockout counts for N = 2…20; grid order across segments; ties by earlier time; no-time drivers last.
- Clock: segment lengths from refS (rounded, min 120 s); flag rule (lap started before 0 counts, after does not); early segment end; break resets cars to boxes; knocked-out cars cannot leave.
- One-shot: one flying lap only; deleted lap = no time.
- Track evolution: evo rises to 1.02 and drives `tyreGrip`; predictor parity holds with `gripEvo` set.
- Box call: this/next by distance; next → this at the line; cancel; missed-entry carry-over with event; cleared at service; meta `boxCall`; ignored in quali / pit lane.
- Real game in a browser: a Full qualifying with 2–4 headless players (shortened clocks via a test setting), break screens, banners, clock; a race with a box call (banner, chevrons, BOX tag, stop with the chosen tyre).

## Out of scope

AI drivers, red flags, sprint format, Q2-tyre race-start rule, parc fermé, team radio audio, pit-call for teammates, strategy predictions.
