# Track Surface and Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every circuit drawn and driven at its real width, with its real barriers, kerbs and run-off surfaces, seamless geometry, CC0 photo materials and subtle live rubber, Monza first.

**Architecture:** One per-circuit *build* data file (`data/tracks/<id>.build.json`: surface polygons, kerbs, barrier polylines, features, all in track coordinates) feeds both sides. The shared sim (`public/js/sim/surface.js`, `public/js/sim/walls.js`) rasterizes the surfaces into a 0.5 m grid and indexes the barriers; `drive.js` asks them what is under each car and what it hits, so what is drawn is what is driven. The renderer draws the road, lines, kerbs and pit lane as ribbons with shared vertices and world-space UVs (new `public/js/trackMesh.js`), the ground beyond as one terrain splatted from the same surface grid (`public/js/trackMaterials.js`), barriers and fences from the same polylines (`public/js/barriers.js`), and rubber and skids as layers on the asphalt (`public/js/rubber.js`). Circuits without a build file yet get a generated one that reproduces today's barrier rule at real width, so all 14 keep working until each gets its real data.

**Tech Stack:** three r186 (`three/webgpu`, `three/tsl` node materials), plain ES modules shared by the browser and Node (CommonJS server `require`s nothing from `public/js/sim` except via dynamic `import()` as the tests do; `src/game/Track.js` already loads `public/js/sim/elevation.js`), `node --test`, Overpass API (mail.ru mirror: `https://maps.mail.ru/osm/tools/overpass/api/interpreter`), Esri World Imagery tiles, `cwebp` (installed at `/opt/homebrew/bin/cwebp`), headless Chrome via `scripts/browser-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-17-track-surface-design.md` (research: `docs/superpowers/research/2026-10-17-track-surface/`)

## Global Constraints

- World scale: 1 m = `track.scale` = 6 world units. Build files store **metres** in the TUMFTM frame of the track JSON (x east, y north, before the `×scale` and y flip `scripts/import-tracks.js` applies); `Track.js` converts once.
- No new npm dependency. CC0 assets only (Poly Haven, ambientCG), each listed with id, URL and licence in `public/textures/manifest.json`.
- Texture budget: everything under `public/textures/` ≤ 40 MB total.
- The sim is shared: anything that changes where a car can drive or how it grips lives in `public/js/sim/` and in the `track` object sent in `game_init`, never in render-only code.
- Surface kinds (exact strings, used everywhere): `'road'`, `'kerb'`, `'asphalt'` (run-off), `'grass'`, `'gravel'`, `'astroturf'`, `'paint'` (painted asphalt run-off). Sim grip: `road`/`kerb`/`asphalt`/`paint`/`astroturf` drive as asphalt; `grass` as today (`C.GRASS_*`); `gravel` with new `C.GRAVEL_MU = 0.55`, `C.GRAVEL_DRAG = 0.35` (1/s), `C.GRAVEL_DRIVE_G = 0.15`.
- Barrier kinds: `'concrete'`, `'armco'`, `'tyres'`, `'tecpro'`, `'wall'` (pit wall / buildings). Each barrier `{ kind, h (m), fence (m, 0 none), pts: [[x, y], ...] (metres), src }`.
- Kerb styles: `'flat'`, `'serrated'`, `'sausage'`, `'negative'`, `'double'`. Kerb stripe length 1.0 m. White edge line width 0.15 m (unconfirmed: FIA minimum 0.10 m; mark in data).
- Real current track wins over the reference screenshots (spec, decided by the user).
- Browser checks: port **3299** only (never 3232, the user's live server), `--mute-audio`, kill only PIDs you started, check `lsof -iTCP:3299 -sTCP:LISTEN` first. `scripts/browser-check.mjs` already does this.
- Frame-rate gate: headless High on Monza ≥ 120 fps (`node scripts/browser-check.mjs --track monza --level high --fps 10`).
- `npm test` green at the end of every task. Goldens (`test/fixtures/drive-golden.json`) re-recorded only in Task 5 and Task 6, on purpose, with the reason in the commit message.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A gap in the barriers.** Real OSM barrier lines have openings (gates, the pit lane, missing data); a car through one drives off the world. Expected: no reachable path from the track to the edge of the surface grid. Pinned by `test/build.test.js` "walls contain the track" (Task 4), run for every circuit (generated builds too).
2. **A fast car tunnelling a barrier** (300 km/h ≈ 14 units a tick, barrier segments a few metres). Expected: bounced, never through, including at the joint between two segments and at a polyline's end cap. Pinned by `test/walls.test.js` (Task 3).
3. **A car or bot in gravel at low speed.** Expected: it can always crawl out (equilibrium speed > 0 with throttle) and bots rejoin. Pinned by `test/surface.test.js` "gravel never traps" (Task 2) and `test/botDriver.test.js` "bot rejoins from the Ascari gravel" (Task 7).
4. **A client that rasterizes the surfaces differently from the server** (float order, polygon winding). Expected: identical grids, so prediction never fights the server. Pinned by `test/surface.test.js` "raster is deterministic and winding-independent" (Task 2) and the re-recorded golden (Task 6).
5. **Pit lane mouth at real width.** With the road narrower, the lane taper, the limiter and pit assist could now start on grass or across the kerb. Expected: the lane meets the asphalt edge with zero gap, the car drives in and out on asphalt, the limiter zone unchanged in metres. Pinned by `test/pitGeometry.test.js` (Task 8).

---

### Task 1: CC0 textures, fetched, compressed, listed

**Files:**
- Create: `scripts/fetch-textures.js`, `public/textures/manifest.json`, `public/textures/*.webp`
- Test: `test/textures.test.js`

**Interfaces:**
- Produces: `public/textures/manifest.json` = `{ "<name>": { "src": "polyhaven:asphalt_track" | "ambientcg:Grass004", "url", "licence": "CC0", "sizeM": [w, h] (real-world metres one tile covers), "maps": { "diff": "<name>_diff_<res>.webp", "nor": ..., "rough": ..., "ao"?: ... , "alpha"?: ... }, "res": [512, 1024, 2048] } }`. Names: `asphalt` (asphalt_track), `asphalt_patch` (clean_asphalt), `asphalt_pit` (asphalt_pit_lane), `kerb_paint` (painted_concrete_02), `grass` (ambientCG Grass004), `grass_worn` (grass_ground), `gravel` (dry_river_pebbles), `concrete` (concrete_wall_004), `fence` (ambientCG Fence006, alpha), `sand` (aerial_sand).
- Each map at 512, 1024 and 2048 px (`<name>_<map>_<res>.webp`), normal maps OpenGL convention (`nor_gl`).

- [ ] **Step 1: Write the failing test** `test/textures.test.js`: for every manifest entry, `licence === 'CC0'`, `sizeM` two positive numbers, every listed file exists for every `res`; the sum of all file sizes under `public/textures/` is ≤ 40 * 1024 * 1024.
- [ ] **Step 2: Run** `node --test test/textures.test.js` — Expected: FAIL (no manifest).
- [ ] **Step 3: Implement `scripts/fetch-textures.js`** (`node scripts/fetch-textures.js`): Poly Haven files from `https://api.polyhaven.com/files/<id>` (2k JPG/PNG of diff, nor_gl, rough, ao), ambientCG from `https://ambientcg.com/get?file=<id>_2K-JPG.zip`; downloads into a cache under `data/tracks/source/textures/` (gitignored), resizes with `cwebp -resize`, quality 85 colour / lossless normals, writes the manifest. `sizeM` from each asset's published dimensions (Poly Haven `dimensions` mm → m).
- [ ] **Step 4: Run** the script, then `node --test test/textures.test.js` — Expected: PASS; print the total MB.
- [ ] **Step 5: Commit** `git add scripts/fetch-textures.js public/textures test/textures.test.js .gitignore && git commit -m "CC0 track textures: asphalt, kerb paint, grass, gravel, concrete, fence, sand as WebP at 512/1k/2k, manifest with sources"`

### Task 2: Shared surface grid

**Files:**
- Create: `public/js/sim/surface.js`
- Modify: `public/js/sim/carphysics.js:21-23,47-68` (surface instead of the `offTrack` boolean)
- Test: `test/surface.test.js`

**Interfaces:**
- Produces (ES module, browser and Node):
  - `export const KINDS = ['grass', 'road', 'kerb', 'asphalt', 'paint', 'astroturf', 'gravel']` — the grid stores the index; 0 (`grass`) is the default for any cell no polygon covers.
  - `export const CELL_M = 0.5`
  - `export function rasterize(surfaces, bounds, scale) -> { x0, y0, w, h, cell, data: Uint8Array }` — `surfaces`: `[{ kind, poly: [{x, y}, ...] (world units) }]` painted in array order (later wins); `bounds`: `{ minX, minY, maxX, maxY }` world units; cell = `CELL_M * scale`. Scanline fill on cell centres, even-odd rule, integer-exact bounds, no dependence on winding.
  - `export function surfaceAt(grid, x, y) -> kind string` (outside the grid: `'grass'`).
  - `export const GRIP = { road: null, kerb: null, asphalt: null, paint: null, astroturf: null, grass: { mu: C.GRASS_MU, drag: C.GRASS_DRAG, driveG: C.GRASS_DRIVE_G }, gravel: { mu: C.GRAVEL_MU, drag: C.GRAVEL_DRAG, driveG: C.GRAVEL_DRIVE_G } }` (null = the tyre's own grip).
- Modifies: `step(car, input, dt, scale, ground = null, assist = 'off')` in `carphysics.js` — `ground` is a `GRIP` entry or null (was `offTrack` boolean; `true` callers pass `GRIP.grass`).

- [ ] **Step 1: Write the failing tests** in `test/surface.test.js`:
  - `rasterize paints later polygons over earlier ones`: a 20×20 m grass square then a 10×10 m gravel square inside → `surfaceAt` at the centre `'gravel'`, at a corner `'grass'`.
  - `raster is deterministic and winding-independent`: same polygon clockwise and anticlockwise → identical `data` (byte compare); two runs → identical.
  - `cell centre rule`: a polygon edge exactly on a cell boundary covers the cells whose centres are inside, none twice.
  - `gravel never traps`: `step` from v = 1 m/s on `GRIP.gravel`, full throttle, 10 s at `1/60` → speed rises above 3 m/s; from 60 m/s, 2 s → speed below 40 m/s.
- [ ] **Step 2: Run** `node --test test/surface.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `surface.js` and the `carphysics.js` change (`C.GRAVEL_MU = 0.55`, `C.GRAVEL_DRAG = 0.35`, `C.GRAVEL_DRIVE_G = 0.15`; the three `offTrack ?` uses read `ground.mu` / `ground.drag` / `ground.driveG`). `drive.js:226` passes `grass ? GRIP.grass : null` for now (behaviour unchanged until Task 6).
- [ ] **Step 4: Run** `npm test` — Expected: PASS (golden unchanged: grass behaves exactly as before).
- [ ] **Step 5: Commit** `git commit -m "Shared surface grid (0.5 m) and per-surface grip: gravel slows hard but never traps"`

### Task 3: Shared barrier index

**Files:**
- Create: `public/js/sim/walls.js`
- Test: `test/walls.test.js`

**Interfaces:**
- Produces:
  - `export function wallIndex(walls, scale) -> index` — `walls`: `[{ kind, pts: [{x, y}] (world units), level?: { i } }]` (`level`: bridge walls, only for cars on that road, as `drive.js` does today). Uniform grid, cell `20 * scale`, each cell lists the segments passing through it.
  - `export function collideWalls(p, x0, y0, index, scale, roadI?) -> boolean` — the move (x0, y0) → (p.x, p.y): first crossed segment undone as `drive.js` does today (`Physics.crossWall` semantics, `bounce`), then the car rectangle pushed out of every overlapping segment (`Physics.wallOverlap` semantics); returns whether anything was hit. Segments tested: the cells the move's bounding box (grown by the car's reach) touches.
  - `export function rayToWall(index, x, y, nx, ny, maxDist) -> distance | Infinity` — first wall along a ray (used for per-point barrier distances).

- [ ] **Step 1: Write the failing tests** in `test/walls.test.js`:
  - `a 300 km/h car hits, never passes`: straight wall, car moving 14 units/tick square on, 200 ticks of re-aim at it → never on the far side.
  - `the joint between two segments holds`: a V of two segments, car aimed exactly at the vertex at 300 km/h → stays on the near side.
  - `end caps`: car aimed along the wall's line past its end → passes (no phantom wall beyond the end), car aimed just inside the end → stopped.
  - `same result as the linear scan`: 1,000 random moves near a 200-segment polyline → `collideWalls` outcome equals a brute-force loop over all segments.
  - `rayToWall`: square ray to a wall 10 m away → 10 m ± 1e-6 (world units: `10 * scale`).
- [ ] **Step 2: Run** `node --test test/walls.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `walls.js` (import `Physics` and `bounce` from `./physics.js` / `./drive.js` helpers; move `bounce` into `physics.js` as `Physics.bounce` and re-export it from `drive.js` so existing imports keep working).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Shared barrier index: grid-hashed wall polylines, crossing and overlap as before, ray distance"`

### Task 4: Build data: format, importer, generated default, validation

**Files:**
- Create: `scripts/import-build.js`, `scripts/build-overlay.js`, `public/js/sim/build.js`
- Modify: `scripts/import-pits.js` (export the OSM→TUM fit), `data/tracks/*.json` (add `osmFit`)
- Test: `test/build.test.js`

**Interfaces:**
- Build file `data/tracks/<id>.build.json` (metres, TUM frame):
  ```
  { "id", "asphalt": { "tone": 0..1 (0 fresh dark, 1 aged light), "resurfaced": year, "patches": [{ "poly": [[x,y]...] }] },
    "surfaces": [{ "kind", "poly": [[x,y]...], "paint"?: ["#hex", ...] (bands for kind "paint"), "src" }],
    "kerbs": [{ "side": "R"|"L", "fromM", "toM" (metres past the start line), "style", "colors": ["red","white"] | ["green","white","red"], "w": metres, "src" }],
    "barriers": [{ "kind", "h", "fence", "pts": [[x,y]...], "src" }],
    "features": [{ "type": "gore"|"bollard"|"blocks"|"line", "pts" | "at", "color"?, "src" }],
    "sources": [...], "unconfirmed": [...] }
  ```
- `scripts/import-pits.js` exports `async function osmFit(id) -> { lat0, theta, tx, ty }` (the transform it already computes in `importPit`); `node scripts/import-pits.js` also writes it to `data/tracks/<id>.json` as `osmFit`.
- `scripts/import-build.js <id>`: Overpass query of the circuit bbox (`barrier=*` ways, `natural=sand|shingle`, `surface=gravel|sand|grass|asphalt` areas, `landuse=grass`, `area:highway`, `raceway=*` areas) cached in `data/tracks/source/osm/`, converted with `osmFit`, merged with `data/tracks/source/<id>.build.hand.json` (same schema; hand entries win; `"drop": ["osm:<wayId>"]` removes OSM entries), written to `data/tracks/<id>.build.json`.
- `public/js/sim/build.js`:
  - `export function defaultBuild(track) -> build` (metres): no surface polygons (all beyond the kerb is grass), kerbs where today's `KERB_TURN` rule puts them (`flat`, red/white, 1.5 m), barriers = today's rule at real width — offset polylines at the real edge + 13.3 m (`WALL_OFFSET / scale`) each side, split where today's `openWalls` marks open; `src: "generated"`.
  - `export function toWorld(build, scale) -> build` (world units, y flipped as the importer does; every `[x, y]` becomes `{ x, y }`, the shape `walls.js` and `surface.js` take).
- `scripts/build-overlay.js <id> --out <dir>`: Esri imagery crops every 200 m (as `scripts/survey-track.js` fetches them) with surfaces, kerbs, barriers drawn on, for checking by eye.

- [ ] **Step 1: Write the failing tests** in `test/build.test.js`, for every id in `Track.TRACK_IDS` (build file if present, else `defaultBuild`):
  - `schema`: kinds, styles and barrier kinds within the Global Constraints sets; every polygon ≥ 3 points; kerb `fromM < toM` or wrapping; every OSM- or hand-made entry has `src`.
  - `walls contain the track`: rasterize the barriers (and pit walls) into a 1 m grid over the track bounds + 500 m, flood-fill from the start line → the fill never reaches the grid border.
  - `no barrier on the road`: no barrier point within the real edges (`edges` from the track JSON) of any centreline point.
- [ ] **Step 2: Run** `node --test test/build.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `build.js`, the `osmFit` export, `import-build.js`, `build-overlay.js`.
- [ ] **Step 4: Run** `node scripts/import-pits.js && npm test` — Expected: PASS for all 14 on `defaultBuild`; track JSONs gain `osmFit` only (diff shows no other change).
- [ ] **Step 5: Commit** `git commit -m "Per-circuit build data: format, OSM importer with hand overrides, generated default at today's rule, containment check"`

### Task 5: Real width in the track model

**Files:**
- Modify: `scripts/import-tracks.js:10,49,81`, `scripts/import-pits.js:5,143,157-166`, `scripts/import-elevation.js:9,83`, `src/game/Track.js:13-16,21,110-205,274,300,339-367,390`, `data/tracks/*.json` (regenerated), `data/tracks/circuits.json` (drop Monaco `barrierM` and its note)
- Test: `test/track.test.js`, `test/import.test.js`

**Interfaces:**
- `track` gains (sent in `game_init`): `build` (world units, `toWorld`), `surfaceGrid` is **not** sent (each side rasterizes from `build`: Task 6), `walls` (`[{ kind, h, fence, pts }]` world units, from `build.barriers` + medians), `barrierR` / `barrierL` (per centreline point, `rayToWall` square to the road, capped at 400 m × scale), `kerbR` / `kerbL` (per point, kerb width in world units, 0 none).
- `track.width` stays a scalar: **the median real width** (`edges` sum) × scale, for the places that need one size (pit layout, nearest-point hint window). Per-point edges `edgeR` / `edgeL` = the survey's `edges` × scale exactly (no `LIMIT_MULT`, no clamp).
- Removed: `WIDTH_MULT`, `LIMIT_MULT`, `track.wallOffset`, `track.openWall`, `track.limit` (callers move to `edgeR`/`edgeL`).
- Checkpoint `radius` = max(`barrierR[i]`, `barrierL[i]`) + 10 m × scale at its point.

- [ ] **Step 1: Update the failing tests**: `test/import.test.js:21` Monza `width` = real median × 6 (from the CSV: assert within 1 unit of `Math.round(median(w_r + w_l) * 6)`); `test/track.test.js`: edges equal `raw.edges × scale`; every `startPositions` slot lies between the edges; checkpoint radius > both barrier distances; `walls` non-empty for every track.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL on those.
- [ ] **Step 3: Implement**: importers without `WIDTH_MULT` (`node scripts/import-tracks.js && node scripts/import-pits.js && node scripts/import-elevation.js`), `Track.build` loads `<id>.build.json` or `defaultBuild`, computes the new fields; `buildMedians` uses real width and returns walls into `track.walls`.
- [ ] **Step 4: Run** `npm test` — Expected: all pass except sim/AI/game tests owned by Tasks 6–7 (list them in the commit message); no test outside those lists fails.
- [ ] **Step 5: Commit** `git commit -m "Real track width: survey edges as the track limits, median real width, per-point barrier and kerb widths, build data in the track"`

### Task 6: The sim drives the build

**Files:**
- Modify: `public/js/sim/drive.js:9-12,215-226,266-300`, `public/js/predict.js` (rasterize once per track), `src/game/Game.js` (rasterize once per track, `Game.js:217,511`)
- Regenerate: `test/fixtures/drive-golden.json` via `node test/fixtures/make-drive-golden.js`
- Test: `test/drive.test.js`, `test/simGolden.test.js`

**Interfaces:**
- Consumes: `rasterize`, `surfaceAt`, `GRIP` (Task 2); `wallIndex`, `collideWalls` (Task 3); `track.build`, `track.walls`, `track.kerbR/kerbL`, `track.edgeR/edgeL` (Task 5).
- Produces: `export function prepareTrack(t)` in `drive.js` — idempotent, caches on a `WeakMap` keyed by `t`: `{ grid, walls: wallIndex(t.walls) }`; called by `driveCar` on first use, so server and predictor build the same thing from the same `track`.
- `driveCar` surface: within the edge on that side → `'road'`; within edge + kerb width → `'kerb'`; else `surfaceAt(grid, x, y)`; on the pit lane asphalt (today's `pitHalf` test) → `'road'`. Grip from `GRIP[kind]`.
- Barriers: `collideWalls` replaces `wallDist`/`overTrack`/`inTrack`/`open()`; the pit lane's outer barrier becomes a wall polyline built in `Track.buildPit` (offset `width/2 + PIT_RUNOFF_M × scale` on the garage side along the full-width stretch) appended to `track.walls`; pit wall and bridge walls unchanged.
- Removed exports: `WALL_OFFSET`, `KERB_M` (callers: `scenery.js`, `game3d.js`, `pitLayout.js` move to `track.barrierR/L`, `track.kerbR/L`).

- [ ] **Step 1: Write the failing tests** in `test/drive.test.js`:
  - `asphalt run-off drives like asphalt`: Monza, car placed in the Alboreto run-off polygon (from `monza.build.json` once Task 9 lands; until then a synthetic track with an `asphalt` surface beside the road) at 50 m/s, 1 s coasting → same speed as on the road ± 0.5 %.
  - `gravel slows hard`: same in a `gravel` polygon → slower than on grass after 1 s.
  - `the drawn wall stops the car`: car aimed square at a `track.walls` segment at 80 m/s → stopped on the near side.
  - `server and predictor agree`: 600 ticks of the golden inputs on Monza through `Game` and through `Predictor` → identical positions (bitwise).
- [ ] **Step 2: Run** `node --test test/drive.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the `drive.js` changes and `prepareTrack`; update `scenery.js`/`game3d.js`/`pitLayout.js` imports.
- [ ] **Step 4: Re-record** the golden (`node test/fixtures/make-drive-golden.js`), then `npm test` — Expected: PASS except Task 7's AI/game tests (listed in the commit).
- [ ] **Step 5: Commit** `git commit -m "Sim drives the build: surface under each car from the shared grid, barriers as wall polylines; golden re-recorded (real width, new walls)"`

### Task 7: Game rules and AI at real width

**Files:**
- Modify: `src/game/Game.js:818-832` (limits), `src/game/RacingLine.js:6,73,96-101`, `src/game/bots/driver.js:12,23,30,67-69,121-144,192`, `public/js/coach.js:43-46,112`, `src/game/Track.js:376-381` (grid)
- Test: `test/game.test.js`, `test/racingLine.test.js`, `test/botDriver.test.js`, `test/fairRacing.test.js`, `test/help.test.js`, `test/socketManager.test.js`, `test/track.test.js`

**Interfaces:**
- Consumes: Task 5's `edgeR/edgeL`, `kerbR/kerbL`, `barrierR/L`; Task 6's surfaces.
- Racing line: may use the kerb (`hi = edgeR + kerbR × 0.5 − margin`), `MARGIN_M` stays 1.5 from the white line where there is no kerb.
- Bot lane constants rescaled to the real width: `PASS_M`, `DEFEND_M`, `BLUE_M`, `ROOM_M` = today's value × (real median half-width / today's drawn half-width), floored at 2.2 m (a car width plus 0.2 m). `EDGE_M` 1.0.
- Grid: slots at the centre of each half of the real road (as today, real edges), stagger `GRID_GAP_M` 8 m unchanged.

- [ ] **Step 1: Update the failing tests** to real-width values (Monza edges, wall distances from `track.barrierR/L` instead of `width/2 + 80`), and add `test/botDriver.test.js` `bot rejoins from the Ascari gravel`: a bot placed in Monza's T8 gravel polygon at 10 m/s → back on the road within 15 s, no reversing into a barrier.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL on the updated tests.
- [ ] **Step 3: Implement** the changes.
- [ ] **Step 4: Run** `npm test` — Expected: PASS, all. A 20-bot 5-lap Monza race in `test/botSession.test.js` (existing) finishes with every bot classified.
- [ ] **Step 5: Commit** `git commit -m "Game rules and AI at real width: limits on the real lines, racing line uses the kerbs, bot lane moves rescaled, bots leave gravel"`

### Task 8: Pit lane geometry that joins the track

**Files:**
- Modify: `src/game/Track.js:21-26,109-206` (`buildPit`), `scripts/import-pits.js:157-166,241` (clear the real road)
- Test: `test/pitGeometry.test.js` (new), `test/pitLayout.client.test.js`, `test/pitstop.test.js`, `test/boxCall.test.js`

**Interfaces:**
- `PIT_CLEAR_M` = 0 against the real road edge (the apron, Task 10, fills between lane and track; the lane edge may touch the road edge).
- The rebuilt lane `pit.path` is smoothed (Catmull-Rom through the joined connector + lane points, resampled at `PIT_STEP_M` 4 m) so the heading changes ≤ 3° between consecutive segments.
- Each mouth's first/last point lies **on** the road edge (lateral offset = the real edge on that side), tangent to the road within 2°; `widthAt` 0 there, full within `TAPER_MAX_M` 60 m.
- `pit.mouths = { entry: { s, side, angleDeg }, exit: { … } }` (lap distance, side, angle between lane and road 20 m in), for the renderer and the data check.
- Limiter (`limStart`/`limEnd`) and garages: same metres along the surveyed lane as today.

- [ ] **Step 1: Write the failing tests** in `test/pitGeometry.test.js`, every track with a pit: max heading change between consecutive lane segments ≤ 3°; mouth points' distance to the road edge ≤ 0.05 m; mouth tangent within 2°; no lane point inside the road (beyond the mouth's first 1 m); limiter length within 1 m of today's (computed before the change and hard-coded per track in the test).
- [ ] **Step 2: Run** `node --test test/pitGeometry.test.js` — Expected: FAIL (today: 26° kinks at Spielberg, tips 0.2–0.76 m off).
- [ ] **Step 3: Implement** `buildPit` changes; `import-pits.js` clearance against the real road.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Pit lane joins the track: smooth lane, mouths on the real road edge and tangent to it, entry/exit angles recorded"`

### Task 9: Monza's real build data

**Files:**
- Create: `data/tracks/source/monza.build.hand.json`, `data/tracks/monza.build.json` (generated)
- Modify: `data/tracks/circuits.json` (Monza sources)
- Test: `test/build.test.js` (Monza-specific block)

**Interfaces:**
- Consumes: `import-build.js`, `build-overlay.js` (Task 4). Content from `docs/superpowers/research/2026-10-17-track-surface/circuits-a.md` §1 (Monza), OSM (grass and gravel areas, partial barriers), Esri imagery traced where OSM lacks (Ascari, Roggia, Lesmo barriers; the Rettifilo escape road and its block rows; the Alboreto asphalt run-off and its edge gravel strip; the tricolour band at the Alboreto exit).
- Monza facts to encode (2026): asphalt `tone` 0.25, `resurfaced` 2024, patches at T1, T2, T4; negative kerbs from the 100 m board before T1 (L), T4 (R), T8 (R); red/white flat kerbs, green/white/red sections at the chicanes (T1–2, T4–5); gravel strips behind the chicane kerbs; gravel at Roggia, Lesmo 1 and 2, Ascari; T5's first left gravel now asphalt; natural grass at the T9 apex; wall + debris fence on the left of the main straight; new fences left between T10 and T11; pit entry after Alboreto on the right with the blue gore and yellow bollard; pit exit white line ending at SC2. Each with its research tag (`FIA`, `SRC`, `OSM`, `K` = unconfirmed general knowledge kept in `unconfirmed`).

- [ ] **Step 1: Write the failing test** block `monza build matches the research`: gravel polygons exist outside T4, T6, T7, T8 and T10 (point-in-polygon at points 25 m outside each apex; apex lap distances hard-coded in the test, measured once as the curvature peaks of `Track.load('monza')` and checked against the turn order in `circuits-a.md`); an `asphalt` polygon covers the Alboreto outside; kerbs with `style: 'negative'` start 100 m before T1, T4, T8; a barrier with `fence ≥ 3` runs along the left of the main straight; a `gore` feature at the pit entry.
- [ ] **Step 2: Run** `node --test test/build.test.js` — Expected: FAIL (Monza on `defaultBuild`).
- [ ] **Step 3: Author** `monza.build.hand.json`, run `node scripts/import-build.js monza`, then `node scripts/build-overlay.js monza --out <scratchpad>/monza-overlay` and check every crop by eye; fix and repeat until barriers sit on the imagery's barriers (±1 m) and surfaces on the imagery's surfaces.
- [ ] **Step 4: Run** `npm test` — Expected: PASS (Monza now on real data; Task 6/7 tests that named Monza still pass; if a golden depends on Monza's walls, re-record it and say so in the commit).
- [ ] **Step 5: Commit** `git commit -m "Monza as built in 2026: OSM surfaces and barriers, imagery-traced Ascari/Roggia/Lesmo barriers, kerbs, escape road, Alboreto run-off, pit gore"`

### Task 10: Seamless track mesh

**Files:**
- Create: `public/js/trackMesh.js`
- Modify: `public/js/game3d.js:519-573` (`offsetPoints`, `strip` move into `trackMesh.js`), `game3d.js:908-1016` (`buildPit`), `game3d.js:1346-1612` (`buildWorld` road, lines, kerbs, verge, gravel, racing-line patches, barriers removed from here), `public/js/scenery.js:189-252,306-367` (verge reach and terrain press from `barrierR/L` and the smooth curve)
- Test: `test/trackMesh.client.test.js` (new)

**Interfaces:**
- Consumes: Task 5 track fields, Task 8 `pit.mouths`, `smoothPath`, `untangle`.
- Produces (`trackMesh.js`, pure geometry, no three.js imports so Node can test it): `export function buildTrackGeometry(track, opts) -> { road, lines, kerbs: [{ style, colors, pos, uv, stripe }], pit: { lane, apron, wall }, verge }` — each a `{ position: Float32Array, normal, uv, track: Float32Array (lap metres, lateral metres per vertex), index: Uint32Array }`.
  - Every ribbon is one indexed mesh along the smooth curve: consecutive cross-sections share their vertex row; adjacent ribbons share their boundary column (road edge = kerb inner edge = line outer edge positions bit-identical).
  - World-space UVs (x, z in metres) on asphalt, so the road, the run-off on the ground and the pit lane continue one texture with no seam.
  - Inner edge of tight corners: cross-section offsets clamped to 95 % of the local radius and the vertex row welded where the offset line folds (replaces the kerb fan and radial seams at Fairmont, Sakhir T10, COTA T11, Buddh).
  - Kerb stripes 1.0 m by arc length along the kerb's own outer edge (not per curve step); kerb profile per style: `flat` 0, `serrated` 0.05 m ridges in the normal map, `sausage` 0.05 m raised half-cylinder, `negative` −0.05 m, `double` two rows.
  - Pit apron: a ribbon from the road edge to the pit lane edge between the mouths, sharing vertices with both; pit wall a closed box section (0.6 m thick, 1.0 m tall, `track.walls` pit wall line).
- `game3d.js` turns these into `THREE.Mesh`es with Task 11's materials.

- [ ] **Step 1: Write the failing tests** in `test/trackMesh.client.test.js`, all 14 tracks: no triangle with area < 1e-4 m² or flipped normal (y < 0); road edge vertices equal kerb/line boundary vertices exactly; the apron's track-side vertices equal road-edge vertices and its lane-side vertices equal lane-edge vertices; consecutive kerb stripe boundaries 1.0 m ± 0.05 m apart; max angle between neighbouring road cross-sections ≤ 5°.
- [ ] **Step 2: Run** `node --test test/trackMesh.client.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `trackMesh.js` and wire it into `game3d.js`; terrain pressed along `rp` (smooth curve) out to `barrierR/L`.
- [ ] **Step 4: Run** `npm test`, then `node scripts/browser-check.mjs --track monza --level high --views chase,tcam,cockpit --out <scratchpad>/t10` and the audit's spots (`docs/superpowers/research/2026-10-17-track-surface/geometry-audit.md`: pit entry/exit on monza, silverstone, sakhir, montreal, interlagos, monaco; Fairmont, Montreal T10, La Source; Suzuka bridge) — Expected: tests PASS; every audit defect gone in the screenshots, judged by eye.
- [ ] **Step 5: Commit** `git commit -m "Seamless track mesh: shared-vertex ribbons, world-space asphalt UVs, folded apexes welded, 1 m kerb stripes, pit apron and a real pit wall"`

### Task 11: Track materials and ground splat

**Files:**
- Create: `public/js/trackMaterials.js`, `public/js/barriers.js`
- Modify: `public/js/game3d.js:575-636` (canvas asphalt and grass removed), `game3d.js:1547-1594` (barriers from `track.walls`), `public/js/quality.js` (texture `res` per level)
- Test: `test/quality.test.js`, `test/barriers.client.test.js` (new)

**Interfaces:**
- Consumes: Task 1 manifest, Task 2 `rasterize` (client grid → an `R8` `DataTexture`, nearest filter, 0.5 m cells), Task 10 geometry.
- `quality.js` `LEVELS[*].texRes`: low 512, medium 1024, high 2048, ultra 2048; `anisotropy` high/ultra 16.
- `trackMaterials.js`:
  - `export async function loadTrackTextures(renderer, level) -> textures` (from the manifest, at `texRes`).
  - `export function asphaltMaterial(textures, build) -> MeshStandardNodeMaterial` — world-space UV at `sizeM`; anti-tiling (macro noise brightness ±6 %, second sample rotated 37° and scaled 0.71, blended by low-frequency noise); `build.asphalt.tone` sets albedo between the fresh and aged ends (fresh: albedo ×0.6, aged ×1.15 of the texture); patches lighter/darker by polygon.
  - `export function groundMaterial(textures, grid) -> MeshStandardNodeMaterial` — per fragment the surface kind from the grid texture; neighbouring kinds blended over 0.4–1.2 m by noise and the gravel/grass height maps (no straight hard edge); `asphalt` and `paint` use the asphalt material's UVs and tone so road and run-off continue seamlessly; `paint` bands colour from `build.surfaces[].paint`; `astroturf` procedural (dense green blade noise, 1.8 m strips); `grass` with mown stripes 5 m along the track direction at ±4 % brightness.
  - `export function kerbMaterial(textures, style, colors)`, `export function lineMaterial(textures)` (paint with slight wear).
- `barriers.js`: `export function buildBarriers(walls, textures, scale) -> THREE.Group` — per kind: `concrete` 1.0 m (or `h`) block section with the concrete texture; `armco` three rails 0.31 m deep profile on posts every 2 m; `tyres` stacked tyre cylinders (instanced) with a conveyor-belt face; `tecpro` 1.5 × 1.2 × 0.6 m blocks (instanced, blue/red alternating, unconfirmed colours); debris fence (`fence` m) with posts every 4 m and the alpha fence texture; one draw call per kind.

- [ ] **Step 1: Write the failing tests**: `test/quality.test.js` `texRes per level` (values above); `test/barriers.client.test.js` with a stub three-free counter (`buildBarriers` accepts an injected factory in tests): Monza produces exactly one instanced batch per kind present and the fence posts every 4 m ± 0.1 m.
- [ ] **Step 2: Run** them — Expected: FAIL.
- [ ] **Step 3: Implement**; delete the canvas asphalt/grass textures and the old barrier `wall()` calls.
- [ ] **Step 4: Run** `npm test`, browser-check Monza day at high and low, and `--webgl` and `--logdepth` — Expected: PASS; screenshots show photo asphalt with no visible repeat down the main straight, gravel/grass edges soft, barriers per kind; WebGL2 paths render the same materials; fps gate ≥ 120 headless High.
- [ ] **Step 5: Commit** `git commit -m "Photo track materials: world-space asphalt with anti-tiling and per-circuit tone, ground splat from the surface grid with soft edges, barriers and fences per kind"`

### Task 12: Rubber and skid marks

**Files:**
- Create: `public/js/rubber.js`
- Modify: `public/js/trackMaterials.js` (asphalt reads the rubber inputs), `public/js/game3d.js:1533-1541` (old rubber patches removed), `game3d.js:1732-1794` (`updateCars` feeds skids)
- Test: `test/rubber.client.test.js` (new)

**Interfaces:**
- Consumes: Task 10 per-vertex `track` attribute (lap metres, lateral metres), `track.racingLine.offset`, `track.safeSpeed`.
- `rubber.js`:
  - `export function rubberProfile(track) -> Float32Array` — per smooth-curve point: racing-line lateral offset (m) and weight 0..1 (1 in braking zones, where `safeSpeed` drops ≥ 15 % within 150 m, and at apexes; 0.5 elsewhere).
  - `export function rubberLevel(lapsDriven) -> 0..1` — `0.15 + 0.85 × (1 − e^(−lapsDriven / 25))`; `lapsDriven` = sum over cars of laps this session.
  - Asphalt darkening at most −22 % albedo and +0.12 smoothness at level 1 on the line's 1.6 m-wide core, Gaussian falloff (σ 0.9 m), never darker than the skid layer's cap.
  - `export class SkidLayer { constructor(renderer, track); stamp(x, y, angle, strength); texture; dispose() }` — a track-space atlas render target (lateral 0.1 m × along 0.25 m per texel, the lap split into 4096-texel columns), drawn into without clearing; strength 0..1 from the car's lock-up (deceleration > 4.5 g or the own car's brake with `slip` > 0.25) or slide (`slip` > 0.12 rad at > 20 m/s); per stamp darkening 2 %, capped at −30 % albedo total; cleared at session start.
- `updateCars` stamps each drawn car's four contact patches when its strength > 0 (pose history gives deceleration and slip for other cars).

- [ ] **Step 1: Write the failing tests** in `test/rubber.client.test.js`: `rubberLevel(0) === 0.15`, `rubberLevel(1000) > 0.99`, monotonic; `rubberProfile(monza)` weight 1 in the 150 m before T1 and < 1 in mid-straight; the skid cap: 1,000 stamps on one texel → darkening exactly 30 %.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm test`, browser-check Monza 5 laps with bots (`--eval` to run time forward) — Expected: PASS; screenshots at T1 braking show a faint darker line and light streaks, nothing near black.
- [ ] **Step 5: Commit** `git commit -m "Living rubber: racing line darkens with laps driven, faint skid marks where cars lock up and slide, capped so they stay subtle"`

### Task 13: Scenery out of the run-off, Monza review gate

**Files:**
- Modify: `public/js/scenery.js:92,372-487` (clearance per point from `barrierR/L`), `public/js/game3d.js:1065-1148` (tunnel walls on the smooth curve, `buildTunnels`)
- Test: `test/scenery.test.js`

**Interfaces:**
- `safeDist(t)` replaced by `clearAt(t, i, side) = (side > 0 ? t.barrierR[i] : t.barrierL[i]) + 3 × t.scale`.

- [ ] **Step 1: Update** `test/scenery.test.js:13,244` to `clearAt`; add: no object inside any `build.surfaces` polygon of kind `gravel`/`asphalt`/`paint`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm test`; browser-check Monza day and night at low, medium, high, ultra, views chase/tcam/cockpit, plus the fps gate. Write a contact sheet (the existing review-package style) to the scratchpad.
- [ ] **Step 5: Commit** `git commit -m "Scenery stays behind the real barriers; tunnel walls follow the smooth curve"`
- [ ] **Step 6: STOP — user review of Monza.** Show the contact sheet, the fps numbers, and ask the user to drive Monza at High on their Retina Mac (60+ fps) and compare with the real circuit. Do not start Task 14 until they approve; their fixes go in as new steps here.

### Task 14: The other 13 circuits

One task per circuit, in this order: silverstone, spa, suzuka, sakhir, zandvoort, spielberg, imola, montreal, cota, hungaroring, interlagos, monaco, buddh. Each follows Task 9's steps exactly with its own research section (`circuits-a.md`, `circuits-b.md`, `circuits-c.md`) and its own `test/build.test.js` research block (gravel, run-off, kerbs, barriers and pit features its research lists), then the Task 10 audit-spot screenshots for that circuit, `npm test`, and its own commit (`"<Circuit> as built in <year>: …"`).

Circuit-specific additions:
- **zandvoort:** `circuits.json` `pitLimitKmh` 80 (FIA 2026 drawing); banking at Hugenholtz and Arie Luyendyk from the elevation data.
- **spielberg:** limiter lines 18 m (entry) and 23 m (exit) earlier, per the FIA 2026 notes; gravel strips at the T9/T10 exits.
- **monaco:** barriers at the street edge from imagery (OSM has none); escape roads at Ste Devote, Mirabeau and the Nouvelle Chicane drivable; tunnel walls on the smooth curve (Task 13); medians at Fairmont from `track.walls`.
- **interlagos, buddh:** surfaces traced from imagery (OSM poor); Buddh's sunburst painted run-offs as `paint` polygons with their colours.
- **montreal:** concrete walls at 0–3 m from the edge from OSM `barrier=jersey_barrier`.

After the last circuit: `npm test`, the fps gate on Spa (largest) and Monaco (densest), and a whole-branch review.
