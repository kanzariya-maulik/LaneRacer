# LanRace Graphics, Performance & Network Smoothness — Design Spec

Date: 2026-10-01
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `2026-10-01-quali-sectors-limits-assists-design.md`, the WebRTC transport merged from `develop`

## Goal

The game looks nicer, runs smoothly on office laptops with integrated graphics, and feels instant on LAN:
- no visible car jitter
- no input delay
- no network choke with 20 players

## Decisions

| Topic | Decision |
|---|---|
| Weakest target | Office laptops with integrated GPUs (Intel UHD/Iris, older MacBook Air) |
| Visual upgrades | A: trackside scenery. B: better car materials. D: track surface detail. (No sky/post-processing work.) |
| Rendering | R1: Low/Medium/High levels, auto-picked by framerate, adaptive resolution, cheap draw paths; manual override in the lobby |
| Network | N1: compact 60 Hz fast updates + change-only info updates; 50 ms interpolation for other cars; latest state projected forward for own car |

## 1. Network smoothness (N1)

### Server
- **Fast update** (every tick, 60 Hz, UDP DataChannel; Socket.IO `gs` event until a peer's channel opens):
  - Shape: `{ s: seq, t: gameTimeS, c: [[idx, x, y, angle, speed, steer, flags], ...] }`.
  - `idx` is a stable small integer per player, assigned in `game_init` order and sent there as `index: { id: idx }`.
  - Rounding: x, y to 0.1 world unit; angle to 4 decimals; speed to 0.1; steer to 3 decimals.
  - `flags` is a bitfield: `inPit 1, limiter 2, drs 4, drsAvailable 8, finished 16, lapValid 32, ghost 64`.
  - Size target: ≤ 60 bytes per car.
- **Info update** (Socket.IO `game_meta`, at most 10 Hz, only changed fields): `{ id: { field: value, ... } }`.
  - Fields: lap, checkpoint, rank, gap, lapsDown, lastLap, bestLap, lapStart (game time, or null), bestLapSectors, lastValid, penalty.
  - The first send after `game_init` contains every field.
- `curLap` is no longer sent. The client computes it as `gameTime − lapStart`.
- Removed: the per-tick full `game_state` object.

### Client
- New ES module `public/js/netsync.js` (pure functions plus a small buffer class, tested in Node like `input.js`):
  - `SnapshotBuffer`: keeps about 1 s of fast updates ordered by `s`. Drops duplicates, and drops updates older than the newest by more than the buffer window.
  - `sample(buffer, renderT)`: per car, interpolates position, speed and steer linearly between the two updates around `renderT`, and the angle along the shortest arc. If `renderT` is past the newest update, it extrapolates along heading × speed for up to 100 ms, then holds.
  - `project(latest, dtS)`: own car only. Pushes the newest update forward by `min(dtS, 0.1)` along heading × speed.
- The server clock is estimated as `newest.t + (now − newestArrival)`. Other cars are drawn at server time − 50 ms; your own car at the server time "now".
- `clientState.gameState[id]` keeps the existing field names, so the HUD code is unchanged:
  - x, y, angle, speed, steer and the flags are filled from sampling;
  - the slow fields come from `game_meta`;
  - curLap is derived from the clock.
- The exponential smoothing in `updateCars` is removed. Cars render the sampled pose directly.

### Testing
- Server: fast-update shape and per-car size; meta only on change; first meta full.
- netsync: in-order and out-of-order updates, duplicates, lost updates (extrapolation, then hold), angle wrap at ±π, own-car projection capped at 100 ms.

## 2. Smooth on every machine (R1)

### Quality levels (`public/js/quality.js`, pure and tested)

| | Low | Medium | High |
|---|---|---|---|
| Pixel ratio (start / min / max) | 0.75 / 0.5 / 1 | 1 / 0.6 / 1 | min(dpr, 2) / 0.75 / min(dpr, 2) |
| Antialias (load-time) | off | off | on |
| Shadows | none; soft dark blob under each car | 1024 map, PCF, ±60 m frustum around own car | 2048 map, PCFSoft, ±60 m frustum |
| Scenery density | 0.3 | 0.6 | 1.0 |
| Camera far / fog end | 6000 / 6000 units | 12000 / 12000 | 20000 / 16000 |
| Car env reflections | off | on | on |
| Tyre marks | off | on | on |
| Texture anisotropy | 1 | 4 | 8 |

### Auto-pick
- With no saved choice, the game starts at Medium.
- It measures the average frame time over the first 5 s of driving (status RACE or QUALIFYING, own car moving):
  - more than 22 ms (below about 45 fps) steps down to Low;
  - less than 11.8 ms (above about 85 fps) on a device with dpr ≥ 1 steps up to High.
- The result is saved in `localStorage` (`lanrace.quality`, try/catch).
- The lobby gets **Graphics: Auto / Low / Medium / High**. A choice that changes antialias triggers a page reload, shown in a confirm-free banner ("Reloading to apply graphics…").

### Adaptive resolution
- Once a second the game measures average fps:
  - below 50: pixel ratio −0.1, down to the level's minimum;
  - above 58 for 3 consecutive seconds: +0.05, up to the level's maximum.
- `adaptStep(state, fps)` is a pure, tested function.

### Cheaper frames
- Scenery uses `THREE.InstancedMesh`, one per object type.
- Minimap and HUD DOM update at 15 Hz; the timing tower at 4 Hz.
- The sun's shadow camera follows your car (Medium and High).
- Generated textures are cached and shared.
- Draw-call target: ≤ 150 on Medium with 20 cars, read from `renderer.info.render.calls`.
- `?stats=1` shows an overlay with fps, draw calls, pixel ratio and level.

### Testing
- `quality.js`: level presets, the auto-pick thresholds, and `adaptStep` (down, up after 3 s, clamped).
- Browser: draw calls and fps per level, with screenshots.

## 3. Visual upgrades

### A. Trackside scenery (`public/js/scenery.js`)
- `placeScenery(track, density, seed)` is a pure, tested function. It returns object placements and is deterministic per track id.
- Every object lies beyond the barrier: more than `width/2 + WALL_OFFSET + 3 m` from the centreline, more than `pit.width/2 + 6 m` from the pit lane, and more than `width/2 + WALL_OFFSET + 3 m` from every part of the track (important where the track doubles back).
- **Grandstands:** along the main straight on the side opposite the pits, plus at the 3 lowest-`safeSpeed` corners on the outside. Stepped boxes with seat colours.
- **Trees:** two sizes, scattered between the barrier offset + 15 m and + 120 m, denser further away.
- **Billboards:** flat panels along straights facing the track, with generic text from a fixed list ("LAN RACE", "FULL SEND", "DRS ZONE", "BOX BOX") and team-colour stripes. No real brands.
- **Gravel traps:** a beige strip on the outside of corners with `safeSpeed < 150 km/h`, between the kerb edge and the barrier. Visual only; physics unchanged (grass).
- **Tyre walls:** at those same corners the outside barrier draws as black tyre stacks instead of red/white.
- Density scales the counts of trees and billboards; grandstands are always placed.

### B. Better cars (Medium/High)
- Paint: `MeshStandardMaterial` with an environment map, generated once with `PMREMGenerator` from a small sky-gradient scene; metalness 0.25, roughness 0.35.
- Wings, floor and halo (dark livery parts) use roughness 0.6 for a satin carbon look. Tyres use roughness 0.9.
- Low keeps the current materials.
- Every car gets a soft blob shadow on Low.

### D. Track surface
- `strip()` gains UVs (u across, v along distance). A generated 256×256 asphalt speckle texture tiles every 8 m.
- Tyre marks: on Medium/High, semi-transparent dark bands on the racing line through corners with `safeSpeed < 150 km/h` (apex and exit).
- Kerbs: the existing alternating segments, plus a thin dark outer edge.

### Testing
- `placeScenery`: no object on the track, in the pit lane, or inside the barrier; same output for the same seed; counts scale with density; grandstands present at every circuit.
- Browser screenshots per level.

## Out of scope

Sky and post-processing (bloom, clouds), weather, client-side physics prediction, binary packet encoding, mobile-specific tuning, real sponsor branding.
