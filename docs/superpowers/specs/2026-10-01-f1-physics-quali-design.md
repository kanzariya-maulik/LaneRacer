# LanRace F1 Physics, Hitbox & Qualifying — Design Spec

Date: 2026-10-01
Status: Approved in chat (sections 1–4), pending written-spec review
Builds on: `docs/superpowers/specs/2026-10-01-3d-f1-design.md`

## Goal

Make driving feel like an F1 car (traction-limited launch, ~5 g braking, grip/downforce-limited cornering, sliding when overdriven), make collisions match the car's real footprint, and add a timed qualifying session that sets the race grid, with F1 start lights and live timing.

## Decisions

| Topic | Decision |
|---|---|
| Physics engine | Custom server-side vehicle model in plain JS. No Babylon.js / Havok (renderer rewrite; rigid-body engine doesn't give F1 handling; must run server-authoritative). |
| Hitbox | Oriented rectangle 5.6 m × 2.0 m (matches `car.glb` body), SAT collision. Replaces 3 m-radius circle. |
| Qualifying | One timed session (host sets 1–10 min, default 3, or off). Best lap sets grid. Ghost mode (no collisions). |
| Start | F1 start lights: 5 reds 1 s apart, lights out after random 0.5–2.5 s. Cars held until lights out. |
| Controls | Keyboard with smoothing + Gamepad API (analog) + touch joystick → analog `input {throttle, brake, steer}`. |
| Build order | 1 hitbox → 2 handling model → 3 sessions/qualifying/timing → 4 client input/HUD. |

## 1. Handling model — `src/game/CarPhysics.js` (replaces `src/game/Player.js`)

SI units internally (m, kg, s); world units = metres × `track.scale`. All tunables are named constants at the top of the file.

Car constants (2023-ish): mass 798 kg; power 750 kW; CdA 1.4 m²; ClA 3.5 m²; air density 1.225; tyre μ 1.6; rear traction share 0.6; wheelbase 3.6 m; max steer 0.35 rad at low speed, reduced with speed.

Per-car state: `x, y` (world), `heading`, `vx, vy` (world velocity), `steer` (current wheel angle, rad), plus existing lap/checkpoint fields.

Per tick (dt = 1/60):
1. Downforce = ½ρ·ClA·v²; grip force = μ·(m·g + downforce).
2. Drive force = throttle × min(P / max(v, 1 m/s), μ·tractionShare·(m·g + downforce)).
3. Brake force = brake × grip force (opposing forward velocity). Brake held at standstill (forward speed < 0.5 m/s) with no throttle → reverse drive, capped at 20 km/h.
4. Drag = ½ρ·CdA·v², opposing velocity. Top speed emerges (~340 km/h).
5. Steering: wheel angle = steer input × maxSteer(v); yaw rate = v_forward / wheelbase × tan(angle).
6. Friction circle: longitudinal force use reduces available lateral grip: `latAvail = sqrt(max(0, grip² − long²))`. Lateral velocity (in car frame) is cancelled each tick by at most `latAvail / m × dt`; leftover lateral velocity = slide / run wide. Unconditionally stable for any dt.
7. Off track (distance from centreline > width/2): μ 0.6 and rolling resistance 0.25 g.
8. Wall at width/2 + 80 world units (unchanged distance): push car back inside, remove velocity component into the wall, keep 40% of the remainder.

The host "Max speed" setting is removed.

## 2. Hitbox — `src/game/Physics.js`

- Car footprint: oriented rectangle 5.6 m × 2.0 m centred on car position, aligned to `heading`.
- Broad phase: skip pairs whose centres are > 6 m apart.
- Narrow phase: SAT on the 4 axes (2 per car). Minimum-penetration axis = contact normal.
- Response: separate by penetration along normal (half each); exchange velocity along normal with restitution 0.3 (equal masses). Lateral leftovers are handled by tyre grip next tick.
- Each pair checked once per tick (fixes current double application).
- No collisions in qualifying (ghost). Finished race cars excluded from collisions.

## 3. Sessions, qualifying, start lights, timing

Statuses: `LOBBY → QUALIFYING → QUALI_RESULTS (8 s) → COUNTDOWN (lights) → RACE → FINISHED → LOBBY`. Qualifying off → `LOBBY → COUNTDOWN` with join-order grid.

Settings: `{trackId, maxLaps, qualiMinutes}`; `qualiMinutes` ∈ {0 (off), 1–10}, default 3. Sanitised server-side (clamp, integer).

`Game` gains `mode: 'quali' | 'race'`:
- **Quali:** cars on grid slots, ghost. First start-line crossing starts lap timing; each later crossing records a lap. When the clock hits zero (flag): a lap in progress may finish; the next crossing ends that car's session (car keeps driving, no longer timed). Session ends when every car has taken the flag or 150 s after the clock hits zero. Result: classification by best lap; no-time drivers last in join order. Drivers who disconnect are not classified.
- **Race:** grid = quali classification (or join order). Lap times recorded too. Finish logic unchanged (maxLaps).

Start lights: server emits `lights {count: 1..5}` once per second, then `lights {count: 0}` (out) after uniform random 0.5–2.5 s, then status `RACE`. Cars cannot move before lights out (physics frozen in COUNTDOWN); inputs received are stored and apply at lights out.

Timing:
- Server tick clock (`tick / 60` s). Each car records the session time at each checkpoint crossing.
- Lap time = time between consecutive start-line crossings.
- Gap to leader = this car's time at the latest checkpoint index both have passed (same lap) minus the leader's time there; lapped cars show `+N L`.
- Events: `timing {id, lap, lapTime, bestLap}` per completed lap; `session {phase, endsInMs}` on phase changes; `quali_results [{id, bestLap, position}]` at QUALI_RESULTS.
- `game_state` per car adds `gap` (seconds or null), `steer` (rad), `ghost` (bool); `speed` stays (forward m/s × scale for compatibility).

Edge cases: late joiner during quali/race → spectator (as now). Everyone leaves → all session timers cleared (pattern from previous round's fix).

## 4. Client

- `public/js/input.js` (pure ES module, also imported by tests):
  - Keyboard: steer rate 5/s toward target, 8/s return to centre; throttle 0→1 in 0.2 s; brake 0→1 in 0.05 s; release ramps down at the same rates.
  - Gamepad (navigator.getGamepads): left stick X → steer (dead zone 0.1, rescaled), RT → throttle, LT → brake. Active pad overrides keyboard.
  - Touch joystick → same analog values.
  - Emits `input {throttle, brake, steer}` ≤ 30 Hz, only on change.
- Server input sanitiser: numbers clamped to [0,1], [0,1], [−1,1]; NaN → 0; legacy `{up,down,left,right}` booleans mapped to 1/1/±1.
- HUD: start-light gantry (5 red discs, top centre); session bar (`QUALIFYING 2:14` / `LAP 3/5`); timing tower replacing leaderboard (quali: pos, name, best, gap to P1; race: pos, name, gap to leader; purple = overall fastest lap, green = personal best); own current/last/best lap under the speedometer; 8 s quali results overlay.
- Visuals: front wheels yaw by `steer`; ghost cars rendered at 50% opacity; speedometer from physics.
- Lobby host settings: add Qualifying select (Off, 1–10 min); remove Max speed.

## Error handling

- All new socket payloads type-checked server-side (input numbers, settings).
- Session timers stored and cleared on reset.
- Physics guards: NaN/Infinity state → reset car to last safe position with zero velocity.

## Testing

`npm test` (node:test, no new deps). Pass criteria:
- Physics: 0–100 km/h 2.6–3.4 s; 0–200 km/h < 7 s; top speed 320–360 km/h; 300→0 km/h braking 90–140 m; full-lock steady state on 50 m radius within ±15% of grip formula; overspeed into a corner ends outside the radius; reverse capped at 20 km/h; off-track decel ≥ 0.25 g.
- Hitbox: side-by-side 2.3 m apart → no collision (old circle would collide); nose-to-tail 5.4 m apart → collision; no overlap after resolve; rear-ender transfers speed forward; rotated/diagonal cases match hand-computed corners.
- Sessions: quali order by best lap; no-time last; lap started before flag counts then session ends for that car; 150 s cutoff; lights out 0.5–2.5 s after fifth light; no movement before lights out with full throttle; gap to leader from a hand-built crossing sequence; timers cleared when everyone leaves.
- Input: key held 0.1 s → steer 0.5; release returns to 0; gamepad dead zone; legacy boolean mapping on server.
- Manual (browser + Node bots): qualifying session → results → lights → race on Monza; HUD timing tower; simulated gamepad values.

## Out of scope

Babylon.js/Havok, tyre wear/temperature, fuel, DRS, pit stops, penalties/track limits, damage, Q1/Q2/Q3 knockout, force feedback, elevation.
