# LanRace AAA Netcode — Design Spec

Date: 2026-10-02
Status: Approved in chat (parts 1–3), pending written-spec review
Builds on: `2026-10-01-graphics-perf-netsync-design.md` (snapshot buffer, compact packets), the WebRTC UDP transport, `src/game/Game.js` `drive()`

## Problem

On WiFi with everyone on High graphics, players see all three symptoms at once:
- **Input lag:** your own car reacts after a full round trip to the server, then is projected forward.
- **Remote cars jitter:** they are drawn 50 ms behind with linear blending. WiFi timing spikes beyond 50 ms show as stutter.
- **Frame stutter:** objects are created in hot loops, so garbage collection pauses; and the server tick is uneven (17.1 ms on average).

## Goal

Use the techniques AAA multiplayer games use (Valve Source, Overwatch, Rocket League), so that on a typical WiFi LAN:
- your own car responds with zero input delay and never shakes from network jitter;
- other cars move smoothly through WiFi spikes and short packet loss;
- frame pacing is smooth on High.

Each player can see why it lags through a stats overlay.

## 1. Shared simulation and client-side prediction

### Shared modules (`public/js/sim/`, ES modules)
- `carphysics.js`: today's `src/game/CarPhysics.js` (`C`, `step`), unchanged maths.
- `assist.js`: today's `src/game/Assist.js` (`safeSpeeds`, `brakeAssist`, constants).
- `geometry.js`: the parts of `src/game/Physics.js` that `drive` needs (`nearestOnTrack`, `nearestOnPath`, `crossWall`, `wallOverlap`, `carReach`, car-box constants).
- `drive.js`: `driveCar(car, input, track, dt)`, the body of today's `Game.drive()`:
  - assist, grass detection, `CarPhysics.step`;
  - pit wall and pit-entry barrier;
  - run-off and barrier pushback with `bounce`;
  - pit-lane state and the speed limiter.

  It returns the nearest-track result the server still needs for track limits and lap progress.

The server `require`s these ES modules (Node 24 supports `require(esm)`), and `src/game/*.js` re-export them so existing imports keep working. `Game.drive()` becomes a call to `driveCar()`, plus the server-only parts:
- track limits;
- lap and sector progress;
- DRS and slipstream rules (they set `car.drs` and `car.tow`, which feed `dragMul`).

### Inputs
- The client samples input every simulation step (60 Hz):
  - shape: `{ seq, steer, throttle, brake, drs }`, where `seq` is an increasing integer per session;
  - it applies the input to its predicted car immediately;
  - it sends the newest input plus the previous 5 (redundancy), as `{ type: 'INPUT', inputs: [...] }` over UDP, or Socket.IO `input` as the fallback.
- The server keeps a per-player input queue:
  - new `seq` values are appended; duplicates and old values are ignored;
  - each tick consumes exactly one input;
  - an empty queue repeats the last input (counted as starvation);
  - a queue longer than 4 drops its oldest extras, so it catches up after a burst.
- `Game` tracks `p.lastSeq`, the sequence number of the input applied this tick.
- The existing 300 ms silence timeout still releases the controls.

### Server answer
Each car entry in the fast packet gains these fields:
- `vx`, `vy` (velocity, 0.1 precision), needed to replay sliding exactly;
- `tow` (0.01);
- `lastSeq`.

The packet shape becomes `[idx, x, y, angle, speed, steer, flags, vx, vy, tow, lastSeq]`. The size target is ≤ 75 bytes per car.

### Reconciliation (`public/js/predict.js`, pure, tested)
- The predicted car state (`x, y, angle, vx, vy, speed, steer, inPit, limiter`) advances by `driveCar` once per client step, with `dragMul` from the latest server DRS flag and `tow`.
- On each fast packet:
  1. Drop inputs with `seq` ≤ `lastSeq` from the pending list.
  2. Reset the predicted state to the server's own-car entry.
  3. Replay the pending inputs.
  4. The difference between the old and new predicted position becomes a visual offset:
     - under 5 m: the offset decays smoothly to zero over about 100 ms (exponential, 1/e at 33 ms);
     - 5 m or more: no offset (snap: resets, teleports).
- Car-to-car contact, timing, penalties, DRS rules and slipstream stay on the server. Prediction only drives your own car's motion.
- During the countdown the server keeps simulating, so jump starts still creep. The client predicts the same way.

## 2. Remote cars

- **Server fixed-step loop.** Ticks run on `process.hrtime` with an accumulator (set to about 1 ms of slack, then catch up). There is exactly one tick per 16.667 ms, and at most 4 catch-up ticks after a stall. Each packet keeps `s` (the tick number) and `t` (session clock).
- **Adaptive interpolation delay** (`netsync.js`):
  - jitter is a rolling estimate of arrival-time deviation (an RFC 3550-style smoothed mean of `|Δarrival − Δsend|`) plus a p95 over the last 2 s;
  - the target delay is `clamp(2 × 16.7 ms + 2 × jitterP95, 35 ms, 150 ms)`;
  - the render clock reaches the target through time dilation: it plays back at 0.95–1.05× speed and never jumps.
- **Cubic Hermite interpolation** between snapshots. Tangents come from each snapshot's velocity (`vx`, `vy`); angle and steer are blended along the short arc.
- **Dead reckoning.** When there is no newer snapshot, the car is extrapolated along a constant-curvature arc using speed, heading and steer-derived yaw rate, for up to 250 ms, then held. When data returns, the car blends from the extrapolated pose to the interpolated one over about 100 ms.
- **Transport.** Fast packets go over UDP whenever the channel is live (the existing liveness rule). The overlay shows UDP or TCP per player.

## 3. Frame pacing, garbage-free hot paths, stats overlay, network simulator

- **Fixed-step prediction plus render interpolation.** The client simulation runs at 60 Hz from an accumulator. Each frame renders the own car at `lerp(prev, current, alpha)` plus the reconciliation offset. The chase camera follows that rendered pose.
- **No allocations per frame per car** in `applyNet`, `sample`, `decodeFlags`, the wheel batch or `colourLine`. They use preallocated pose objects and arrays.
- **Packets decoded once.** Duplicates (the same `s` arriving over both UDP and TCP) are dropped before parsing their car arrays into snapshots.
- **Stats overlay** (F3 toggles it; `?stats=1` shows it at load). It shows:
  - fps and frame time p95/max over 2 s;
  - ping, measured by a UDP `PING`/`PONG` every second (Socket.IO when there is no UDP);
  - jitter and loss % (gaps in `s`);
  - the interpolation delay;
  - prediction error (cm, the size of the last correction);
  - input queue starvation per second (reported by the server in `game_meta` for each player);
  - the link (UDP or TCP) and the server tick time (ms, in `game_meta`).
- **Network simulator.** The env var `NET_SIM=latencyMs,jitterMs,lossPct` (for example `30,20,2`) makes the server delay, jitter and randomly drop both outgoing fast packets and incoming inputs. It is off by default and used for tests and headless measurement only.

## Testing

**Node:**
- **Shared step:** over 10,000 random inputs on every track, `driveCar` gives bit-identical state to today's `Game.drive` maths. This is captured before the refactor as a golden trace.
- **Input queue:** in-order application, duplicate and old drops, redundancy recovers 1–3 lost packets, starvation repeats the last input, the queue is capped at 4.
- **Reconciliation:**
  - with 30 ms latency, 20 ms jitter and 2% loss simulated over a 60 s drive, the predicted and server positions differ by < 5 cm at the 95th percentile and a correction is never visibly snapped (largest per-frame correction < 10 cm) except over 5 m;
  - after a server-side collision, the offset decays to < 1 cm within 200 ms.
- **Adaptive delay:** jitter 0 gives about 35 ms; jitter 40 ms gives about 113 ms; it stays clamped; time dilation stays within 0.95–1.05 and the render clock never goes backwards.
- **Hermite and dead reckoning:** they pass through the snapshots exactly. Extrapolation on a constant arc matches the true arc within 5 cm at 250 ms, and recovery has no step bigger than the blend allows.
- **Server loop:** over 10 s, tick spacing has a mean of 16.667 ms ± 0.05 and no catch-up bursts larger than 4.

**Headless** (20 cars, `NET_SIM=30,20,2`, High): measure own-car and remote-car per-frame step evenness and long frames, before and after. Expected: no frames > 25 ms from the game, and own-car step error p95 below the current 5–13%.

## Out of scope

- Lag compensation for car-to-car contact (rewinding other cars).
- Peer-to-peer play.
- Rollback for remote cars.
- Binary packet encoding.
- Changing physics behaviour or game rules.
