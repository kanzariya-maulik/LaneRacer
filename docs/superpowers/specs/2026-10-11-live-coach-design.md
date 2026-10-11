# LanRace Live Coach — Design Spec

Date: 2026-10-11
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `develop` at ffe7c62 (tyres, driver help, pit assist, fair racing rules)
Part C of the "make it proper F1" request (A: assists + racing line, B: fair racing rules — both done)

## Goal

Teach new players how to drive and race F1-style while they play: where to brake, how to hit the apex, how to carry speed, how to use the tow and DRS, inside vs outside line — in short, plain messages at the moment they matter, never nagging.

## What exists today

- Racing line (`buildRacingLine`, `game3d.js`): per path point `offset`, `speed` (m/s at the real limit), `phase` (0 flat/accelerate, 1 corner-limited, 2 braking); modes off/corners/full (key R); recoloured from your own speed within 250 m.
- Braking/steering help (key Q); `brakeAssist` runs inside the shared `driveCar` (`public/js/sim/drive.js:221`, `used = … brakeAssist(…)`), but which input was actually used is not exposed.
- Steward card (top centre) for penalties/warnings/incidents; the predicted own car (`predictor.car`) has position, speed, `tow`, flags (`inPit`, `drsAvailable`, `drs`, `ghost`); DRS key E; per-player prefs in `store` (`lanrace.*`).

## Decisions

| Topic | Decision |
|---|---|
| Form | Live coach in the race: corner reports + racecraft tips + progress nudges, client only |
| Toggle | Key C in a session; lobby driver-panel "Coach" On/Off, per player, stored (`lanrace.coach`), default On |
| Where | One line in a strip bottom centre above the speed cluster, 2.5 s, colour by verdict |
| When | Race and qualifying; not spectating, not finished, not in the pit lane |
| Rate | ≤ 1 message per 4 s; each racecraft tip ≤ 3 times per session; a corner goes quiet after 3 "Perfect" in a row; steward card holds the coach back 4 s |

## 1. Corners and the verdict

- **Corners** from the racing line: a corner = a contiguous run of phase 2 (braking) followed by its phase-1 run; corners closer than 60 m merge (a chicane is one corner). Corner k has `brakeS` (lap distance of its first phase-2 point), `apexI` (path index of the minimum line speed in it), `endS` (end of its phase-1 run), `vApex` (line speed at `apexI`). Runs of phase 1 without any phase 2 (flat kinks) are not corners.
- **Per corner the coach records** (from the predicted own car, each frame, by lap distance `s` = nearest path index's `cum`):
  - `brakeAt`: lap distance of the first frame with brake > 0.2 (driver input, or the help — see below) inside the window `[brakeS − 150 m, endS]`;
  - `helpBraked`: true if that first brake came from the help (`p.assistBrake`, below);
  - `vMin`: minimum speed between `brakeS` and `endS`;
  - `apexMiss`: distance (m) from the car to the racing line point at `apexI`, taken at the frame nearest `apexI`;
  - `wide`: the car went past the white line (track-limits edge `edgeAt`) or off the road between `brakeS` and `endS + 30 m`.
- **Verdict** when the car passes `endS`, first match wins:
  1. `wide` → `Too fast in — missed the apex` (red)
  2. not `helpBraked` and `brakeAt` more than 20 m before `brakeS` → `Braked N m early — brake later` (N = early distance rounded to 5 m) (amber)
  3. `vMin < 0.85 × vApex` → `Slow mid-corner — carry more speed` (amber)
  4. `apexMiss > 2 m` → `Missed the apex — aim for the inside kerb` (amber)
  5. else `Perfect corner` (green)
- **No report** for a corner when, during it: in the pit lane; the own car is a ghost and overlapping another car; a steward `hit`/`collision`/`incident` event for you arrived within the last 5 s; it is corner 0 on the first lap (race); the car entered the window already slower than 40 % of `vApex` (just rejoined / spun).
- **Help flag (shared sim):** `driveCar` sets `p.assistBrake = used !== input && used.brake > input.brake` (boolean, deterministic, no network field). The coach reads it from `predictor.car`.

## 2. Racecraft tips and nudges

- `tow` (predicted car) > 0.3 for 1 s → `In the tow — pull out and brake later to pass` (blue).
- Side by side into a braking zone: another car within 1.5 car lengths alongside (|ahead| < 1.5 × car length, lateral 1.5–5 m) while you are within 100 m before a corner's `brakeS`:
  - you are on the inside of that corner (the side the corner turns to, using the racing line's direction at `apexI`) → `Inside line — brake late, the corner is yours`;
  - outside → `Outside — leave room or tuck in behind`.
- `drsAvailable` and in a DRS zone and DRS not open → `DRS — press E`.
- 2 consecutive clean laps (every corner verdict on the lap is Perfect or none, no steward event) with braking help High → `Clean laps! Try Low braking help (Q) — it's faster`. Once per session.
- First race of the browser session with the coach on: `Coach on — C to turn off`, once.

## 3. UI, control, structure

- `#coach-line` (HUD, bottom centre above the cluster; 16 px gutter; no overlap with the tyre card, cluster, or steward card at 1280 and 390 px): one line, colour class `good` / `warn` / `bad` / `tip`, fades after 2.5 s.
- Key C toggles (`COACH: ON` / `COACH: OFF` banner via `showBanner`); lobby driver panel gets a "Coach" On/Off segment next to the help pickers; value stored in `lanrace.coach` (`'on'|'off'`, default on).
- Steward card shown → coach messages suppressed for 4 s.
- `public/js/coach.js` — pure, no DOM/three: `cornersOf(racingLine, track) → corners[]`; `createCoach(corners, track)` returns `{ update(frame) → message | null }` where `frame = { t, s, x, y, speed, brake, assistBrake, tow, inPit, ghostOverlap, drsAvailable, drsOpen, inDrsZone, lap, wide, nearCars, stewardAt, helpLevel }` and `message = { text, tone }`. All rate limits live inside it. `game3d.js` builds the frame each HUD tick and shows the message.

## Edge cases

- Spectating / finished / lobby: coach never runs.
- Track without a racing line: no corners → only racecraft tips.
- Reverse direction or spin: the window/entry-speed rule suppresses the report.
- Reconnect / new session: coach state resets with `initGameVisuals`.
- Quali out-lap and pit exit: corners still rated (practice), except in the pit lane.

## Testing

- `cornersOf` on all 14 circuits: corners non-empty, ordered by `brakeS`, chicanes merged (no two corners < 60 m apart), every corner has `brakeS < apex < endS`.
- Verdicts from synthetic frame sequences along a corner: perfect (on line, brake at `brakeS`, line speed); early by 30 m → "Braked 30 m early"; slow (0.7 × vApex) → slow; 3 m off at apex → missed apex; wide → too fast; help-braked early → not "brake later".
- Rate limits: two verdicts 2 s apart → second dropped; a tip shown 3 times then never; 3 perfects on a corner → quiet; steward suppression 4 s.
- Suppression: pit lane, recent contact, first-lap corner 0, slow entry.
- Shared sim: `p.assistBrake` set only when the help braked harder than the driver; predictor parity test still passes.
- Real game in a browser: drive a few corners (bot input via keys) and see reports; tips and toggle; layout at 1280 and 390 px.

## Out of scope

Voice/audio coaching, a separate driving-school mode, a lobby "how to race" page, replays, per-corner names, AI demo laps.
