# LanRace Racing Line — Design Spec

Date: 2026-10-02
Status: Approved in chat (parts 1–2), pending written-spec review
Builds on: `2026-10-01-graphics-perf-netsync-design.md`; Full assist for everyone

## Goal

An F1-game-style driving line on every track. It shows the fast path (out-in-out) and, by colour, where to brake, lift or go flat out. The colour reacts to your own speed. Every player can choose Off, Corners only or Full in the lobby, and switch it during a session with a key or gamepad button.

## Decisions

| Topic | Decision |
|---|---|
| Modes | Off / Corners only / Full; lobby option per player, default Corners only |
| In-session toggle | R key, gamepad X (button 2): steps Off → Corners → Full → Off |
| How the line is made | Computed from the track shape and the car physics at server start (no recordings, no hand drawing) |
| Colours | Green flat out, yellow lift, red brake; recoloured from your speed within 250 m ahead |
| Controls | Visual guide only: the braking assist is unchanged. The line's target speeds are capped to what the assist allows, so its colours match what the car really does (chosen 2026-10-02, to keep racing challenging) |

## 1. Computing the line (server, `src/game/RacingLine.js`)

`compute(track)` returns `{ offset: number[], speed: number[], phase: number[] }`, with one entry per centreline point:
- `offset`: sideways offset from the centreline, in world units. Positive values follow the convention of `offsetPoints` in `game3d.js`: `(x − ty·o, y + tx·o)`, where `t` is the unit tangent from the previous point to the next.
- `speed`: target speed, in m/s.
- `phase`: 0 flat out, 1 lift, 2 brake.

### Path (minimum curvature)
- Start from offset 0. Iterate (about 300 passes) moving each point toward the midpoint of its neighbours' positions, so total bending shrinks.
- Clamp each offset to `±(width/2 − 1.5 m·scale)`.
- Near the pit entry closure (on the pit side, from 60 m before `pit.closeS` to the pit-wall start), also clamp the pit-side offset to `width/2 − 3 m·scale`, so the line stays clear of the closure barrier.
- The result goes wide before a corner, clips the apex and runs out wide on exit.

### Speed profile
- Use the constants from `CarPhysics.C`, with the assist's cornering grip included, since everyone drives with Full assist:
  - cornering acceleration: `(1 + ASSIST_GRIP·k(v)) · LAT_ASSIST · MU · (g + DOWN·v²)`, where `k` is the assist factor (1 below 150 km/h, 0 above 250 km/h);
  - braking: `MU · (g + DOWN·v²)` plus aero drag;
  - drive: `min(POWER / v, TRACTION·grip) / MASS` minus drag.
- Step 1, corner speed: the curvature of the *line* (three-point circle, spanning ±2 points) gives a grip limit for every point, capped at `MAX_SAFE`. `vmax[i]` is the lower of that and `safeSpeed[i] × 0.95`, the speed the Full braking assist holds the car to (`Assist` AIM).
- Step 2, forward pass, run twice around the loop so the lap wraps: `v[i+1] = min(vmax[i+1], sqrt(v[i]² + 2·a_drive·ds))`. The drive force is reduced by the friction circle: `a_drive · sqrt(1 − (a_lat / a_lat_max)²)`.
- Step 3, backward pass, run twice around the loop: `v[i] = min(v[i], sqrt(v[i+1]² + 2·a_brake·ds))`, reduced by the friction circle in the same way. `a_brake` uses `BRAKE_MARGIN` (0.7) × grip. Then each point is also held to the braking assist's own rule: for every point j within braking reach, `v[i] ≤ sqrt(s_j² + 2·BRAKE_MARGIN·MU·(g + DOWN·s_j²)·d_ij)`, where `s_j = safeSpeed[j] × AIM` and `d_ij` is the centreline distance. So at the line's speed the assist never needs to brake, and red appears exactly where it would.
- **Phase:**
  - `brake` where the backward pass limited the speed and the speed falls by more than 1 m/s over the next point;
  - `lift` where `v` is within 3% of a corner-limited `vmax` (not the straight-line speed cap) or the speed falls by up to 1 m/s;
  - otherwise `flat`.

### Delivery
- `Track.load` stores `track.racingLine = RacingLine.compute(track)` (computed once per track at server start), so it reaches clients in `game_init`.
- Values are rounded: offset 0.1, speed 0.1. The target is about 3 KB per track.

### Testing (`test/racingLine.test.js`)
- Per track:
  - the line stays within the edges (`|offset| ≤ width/2 − 1.5 m·scale`);
  - at every point, `speed² × curvature` stays within the assisted cornering grip (+1%);
  - a lap following the line is no slower in time than the centreline lap at its own speed profile;
  - no target speed exceeds `safeSpeed × 0.95`.
- Monza: a brake zone sits before the first chicane. Spa: a brake zone sits before La Source. Both are found as the lowest `safeSpeed` point near the start.
- Simulation: a car driven by the existing physics (`Game`, Full assist), steering toward the line about 25 m ahead and using throttle/brake from the target speed, completes a lap on every track with no wall hits, within 8 s of the profile's lap time (that allowance covers the standing start).

## 2. Showing the line (client)

### New pure module `public/js/racingline.js` (tested in Node)
- `segmentColor(phase, targetHere, mySpeed, distAhead)`:
  - If `distAhead` is null or more than 250 m, return the base colour for `phase`.
  - Otherwise compute the deceleration needed to go from `mySpeed` to `targetHere` within `distAhead`, `need = (mySpeed² − target²) / (2·max(d, 1))`:
    - **red** if `need > 0.6 · MU·g` (about 9.4 m/s²);
    - **yellow** if `need > 0`;
    - **green** otherwise.
  - Returns `'green' | 'yellow' | 'red'`.
- `cornerMask(phase)`: returns a boolean array marking points shown in Corners-only mode. A point is marked when it is in a brake or lift phase, from 30 m before it to 50 m after the last such point of the run.
- `nextMode(mode)`: steps `off → corners → full → off`.

### Drawing (`game3d.js`)
- One mesh per world, built in `buildWorld` from `track.racingLine.offset`:
  - a ribbon 1 m wide at y 0.75, made of chevrons, one per path segment, pointing in the driving direction;
  - `MeshBasicMaterial` with vertex colours, transparent, opacity 0.75, `depthWrite: false`.
- Corners-only mode: the geometry holds every segment. Hidden segments get zero-size triangles in the position attribute, rewritten only when the mode changes.
- Colour update (with the HUD at 15 Hz, own car only):
  - recolour the segments within 250 m ahead of the car using `segmentColor`;
  - give every other segment its base colour;
  - write the colour attribute and set `needsUpdate`.
- Hidden when the own car is in the pit lane, for spectators in Off mode, and when the track has no `racingLine`.

### Mode and controls
- Lobby: a `Racing line: Off / Corners only / Full` select beside Graphics, stored in `lanrace.line` through the same storage fallback as graphics (`window.lanraceMem`). Default: `corners`.
- During a session:
  - **R** key, or **X** on a gamepad (button 2, edge-triggered in `pollInput`), steps the mode;
  - a short banner confirms each change ("RACING LINE: CORNERS");
  - in-session changes last until the next `game_init`, which resets the mode to the lobby choice.
- Typing in chat does not toggle the line (chat-input focus check, as for other keys).

### Testing
- Node (`test/racingline.client.test.js`):
  - `segmentColor`: too fast near a slow corner gives red earlier; slower than the target gives green; base colours apply beyond 250 m;
  - `cornerMask`: covers brake zones and exits, and excludes long straights;
  - `nextMode` cycles.
- Headless: screenshots of Off, Corners and Full on Monza and Spa. The racing line adds 1 draw call; fps stays at 60 on Medium.

## Out of scope

Changing the braking or steering assist, AI or ghost cars following the line, per-player braking-point coaching messages, adapting the line to car damage or tyres (neither exists), 3D floating arrows.
