# LanRace Driver Help (Assists) & Real-Limit Racing Line — Design Spec

Date: 2026-10-09
Status: Approved in chat (sections 1–2), pending written-spec review
Part A of three (A: driver help + racing line, B: fair racing rules, C: teaching). B and C get their own specs.
Builds on: `2026-10-02-racing-line-design.md`, `2026-10-01-quali-sectors-limits-assists-design.md`, `2026-10-09-tyres-pitstops-design.md` (branch `feature/tyres-pitstops`, which this work starts from)

## Goal

Help that keeps beginners on the track without making the car feel slow, and never makes anyone faster than driving well. A beginner on full help gets round every corner and is only a little slower (2–4 % per lap) than a driver who follows the racing line and brakes late. The racing line's colours show the real braking point, so following them teaches late braking. For serious races the host can give everyone the same help.

## Why the current help feels wrong

- `brakeAssist` (`public/js/sim/assist.js`) judges corners from `safeSpeed`: the *centreline* radius (tighter than the racing line), aimed at 95 % (`AIM`) and braking at 70 % of grip (`BRAKE_MARGIN`). Assisted cars brake early and corner slowly.
- The steering slider also adds up to +30 % cornering grip below 150 km/h (`ASSIST_GRIP` in `carphysics.js`): a hidden speed advantage.
- The racing line's speeds are capped to that assist (`RacingLine.js`), so its red zones show the cautious braking point, not the real one.

## Decisions

| Topic | Decision |
|---|---|
| Braking help | Off / Low / High (replaces the 0–100 % brake slider) |
| Steering help | Off / On (replaces the 0–100 % steer slider); keeps extra lock and slide control, no extra grip |
| Corner speeds for help | From the racing line at real grip (no assist grip, no assist cap) |
| Host control | Lobby setting "Driver help: Each driver chooses / Same for all"; with "Same for all" the host picks both levels for every car |
| Racing line | Unchanged modes and keys; colours from the real limit |
| Visibility | Tower and results show **B** (braking help Low/High) and **S** (steering help On) badges |

## 1. Help levels (shared sim)

### Wire format
Unchanged string `'steer,brake'` in percent, parsed by `parseAssist`. Levels: steering Off = 0, On = 100; braking Off = 0, Low = 50, High = 100. `lobby.sanitizeAssist` snaps any other value to the nearest level (steer: < 50 → 0 else 100; brake: < 25 → 0, < 75 → 50, else 100), so old saved slider values and old clients keep working. `parseAssist` then returns `{ steer: 0|1, brake: 0|0.5|1 }`.

### Steering help (`carphysics.js`)
- Remove the extra cornering grip: `latAccel` no longer includes `(1 + ASSIST_GRIP·k)`; delete `ASSIST_GRIP`. Every car corners on the same grip.
- Keep the extra lock (`ASSIST_STEER`) and the existing slide control, still blended out between `ASSIST_FULL_KMH` and `ASSIST_OFF_KMH`.

### Corner speed table (`src/game/RacingLine.js` → track data)
- Racing-line corner limit per centreline point: `lineLimit[i]` (m/s) = grip limit from the line's own curvature at real grip `LAT_ASSIST · MU · (g + DOWN·v²)` (no assist grip, no assist cap, crest unloading included as `safeSpeeds` does today), capped at `MAX_SAFE`.
- Sent with the track (as `safeSpeed` is today) so the client predictor runs the same help. `safeSpeed` stays only where other code needs it.
- Tyre grip: the help reads the car's `tyreGrip` and scales the limit by `sqrt(tyreGrip)`, so worn tyres get braked for earlier.

### Braking help (`assist.js` `brakeAssist`)
Same scan ahead as today, judged against `lineLimit` instead of `safeSpeed`:
- **High** (`brake = 1`): target `0.95 × limit`; brake (full brake, throttle cut) when reaching the target needs more than `0.9` of the braking grip available at the target speed. Smooth, early enough to never miss a corner.
- **Low** (`brake = 0.5`): target `0.90 × limit`; brake only when reaching that target needs more than `1.0` of the braking grip available at the target speed, i.e. at the last possible moment with the car's full braking. Stateless (no memory between ticks, so the client predictor matches). Does nothing until the driver could no longer make the corner, then brakes hard and leaves the car 10 % under the corner speed: a safety net that costs time when it triggers.
- **Off**: no intervention.
- Driver braking harder than the help, steering, and the pit lane (help off in the lane) behave as today. Grade (uphill/downhill) is accounted for as today.
- Tuning constants (`HIGH_AIM 0.95`, `HIGH_MARGIN 0.9`, `LOW_AIM 0.90`, `LOW_MARGIN 1.0`) are named at the top of `assist.js`; the lap-time test below pins their effect.

### Host "Same for all" (`lobby.js`, `socketManager.js`, `Game.js`)
- New setting `help: { mode: 'choose' | 'fixed', steer: 0|100, brake: 0|50|100 }`, default `{ mode: 'choose', steer: 100, brake: 100 }`, sanitised in `lobby.js`.
- `fixed`: every car's `assist` is set from the setting at session start and whenever the host changes it; `set_assist` from drivers is ignored (the server answers with the enforced value so the client shows it).
- `choose`: as today, each driver's own choice.

## 2. What drivers see

- **Lobby, My settings:** two button groups replace the sliders: Braking Off / Low / High, Steering Off / On, each with a one-line hint ("High: brakes for you, about 2–3 % slower a lap", "Low: catches you if you'd miss a corner, costs time", "Off: fastest if you brake late"). Greyed with "set by host" when the host chose "Same for all". Saved per browser as today (`lanrace.assist`).
- **Lobby, Race settings (host):** "Driver help: Each driver chooses / Same for all", and with "Same for all" the two level pickers. Non-hosts see it read-only like other settings.
- **Q key in a session** (today it cycles Full → Steer only → Brake only → Off): steps braking help Off → Low → High → Off with a banner "BRAKING HELP: LOW"; does nothing (banner "SET BY HOST") when fixed.
- **Racing line:** `RacingLine.compute` speed profile uses real grip (no assist grip, no assist cap), so its red zones start at the real-limit braking point. Modes, R key and recolouring from the player's own speed are unchanged.
- **Tower and results:** `B` badge when braking help is Low or High, `S` when steering help is On, from each lobby player's `assist` (`clientState.players[id].assist`, already re-sent in `lobby_state_sync` whenever it changes).

## 3. Edge cases

- A car off the racing line (tighter radius) can still run wide on High; the help does not steer. Accepted: High keeps such a car slow enough that it stays on the road on the test circuits (tested).
- Mid-session change of help: takes effect on the next tick (as today).
- Reconnect: the player's saved choice is restored, unless fixed.
- Qualifying: same help rules; the badges show on the quali results too.
- Golden physics trace: re-recorded once after removing `ASSIST_GRIP` and switching the help to `lineLimit`, after confirming the divergence comes from those changes.
- Tyre calibration (`LOAD_TYPICAL`): re-checked with `scripts/calibrate-tyres.js` since corner speeds change; update if outside ±5 %.

## Testing

- `assist.test.js` (or the existing assist tests): level parsing and snapping; Low does nothing below the limit and brakes when the corner can't be made; High brakes earlier than Low; Off never brakes.
- Lap-time test (bot following the racing line with full throttle and steering on the line, at Monza, Monaco and Spa): High laps 2–4 % slower than an "Off at the limit" bot that brakes at 1.0 × limit; neither leaves the track. Low with a driver who never brakes: stays on the track every corner and laps slower than High.
- Fairness: steering help On vs Off at the same input gives the same cornering grip (same max lateral acceleration).
- Host fixed mode: `set_assist` ignored, every car gets the host's levels at start and on change.
- Shared-sim parity: client and server `driveCar` stay bit-identical with `lineLimit`.
- Real game in a browser: lobby buttons, host lock, Q banner, badges, a lap on High and on Off.

## Out of scope

First-lap and contact rules (part B), coaching and overtaking hints (part C), ABS/traction control as separate assists, gearbox assists.
