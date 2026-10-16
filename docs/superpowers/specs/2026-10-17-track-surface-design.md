# Track surface and construction: real circuits, real materials (design)

Date: 2026-10-17. First of three projects toward the F1 23 look (1 track surface and construction, 2 trackside world, 3 day and
night lighting). Projects 2 and 3 get their own designs later.

Research behind this document (committed next to it): `docs/superpowers/research/2026-10-17-track-surface/`
- `standards-and-rendering.md`: FIA dimensions (Appendix O, kerb types, fences, barriers), how real asphalt and rubber look,
  rFactor 2's road shader model, three.js r186 techniques, CC0 texture picks with ids.
- `circuits-a.md` (monza spa silverstone suzuka sakhir), `circuits-b.md` (interlagos cota zandvoort spielberg montreal),
  `circuits-c.md` (hungaroring monaco imola buddh): corner-by-corner run-off, kerbs, barriers, fences, pit entry and exit,
  FIA 2022–2026 "changes to the circuit", OpenStreetMap coverage per circuit.
- `geometry-audit.md`: eleven defects in today's track geometry, with causes (file:line) and screenshots.

## Intent

The user wants the track to look and feel like F1 23 and like the real circuit as it is today: a real, well-maintained F1
track. What they look at most is the ground the car drives on, so that comes first: the asphalt, the track limits, the
grass, the gravel and sand, the walls, and how it is all built together. Their words: "I want perfection on track looks
and want it to look and feel exactly like real track that currently is right now. No gap between two joints, curves need
to be perfect smooth, no gap between pitlane and the race track, the pit entry and exit angle."

The reference look is the user's F1 23 / F1 25 screenshots (repo root, `image copy 6.png`, `image.png`): clean light-grey
asphalt, a racing line only slightly darker down the middle, crisp white lines, red/white kerbs, tidy grass, barriers and
fences close behind. "It looks so beautiful and perfect."

## Decided by the user

- Order: this project (surface and construction) first, then the trackside world, then lighting.
- Photo-scanned CC0 textures are added to the repo (budget given: about 20–40 MB). Realism beats a light download.
- **Real width and real barrier positions, exactly like the real track.** The 2× road (`WIDTH_MULT`) goes. Barriers stand
  where the real ones are, per section and per side, and the physics walls go with them. Tighter racing is accepted.
- Each circuit is built as it really is: its own barrier types (concrete, Armco, tyre walls, TecPro), fence heights, kerb
  styles and colours, run-off (asphalt, gravel, grass, painted), pit entry and exit, from research done before building.
- Rubber: the racing line darkens as laps are driven, and cars leave skid marks where they brake hard, lock up or run wide.
  Both subtle: "not too dark that it looks ugly".
- **Monza is the reference circuit.** It is built to perfection first and judged by the user before the other 13 follow.
- **Surfaces drive as they are:** asphalt run-off and escape roads grip like asphalt; gravel slows the car hard and takes
  grip away; grass stays as today's grass; each kerb has its real width in the sim (today a fixed `KERB_M` 1.5 m). Sausage
  kerbs, negative kerbs, bollards and polystyrene blocks are drawn only (no physics) in this project.
- **The real current track wins** where it and the reference screenshots disagree. Monza, fully resurfaced in 2024, has
  darker, fresher asphalt than the light aged grey of the Suzuka and Imola shots; each circuit gets its own asphalt age and
  tone from its research (resurfacing dates are in the circuit files). Same rule for kerb colours and layouts changed
  after F1 23. What carries over from the shots is the quality: clean, crisp, well kept, rubber subtle relative to the
  asphalt around it.

## Designer's calls (not asked of the user; checked against the research and the code)

- **Barriers are wall polylines in the sim,** not one distance per centreline point: `public/js/sim/physics.js`
  `crossWall` / `wallOverlap` already take polylines. So escape roads (Rettifilo, Roggia, Monaco T1/T5/T10, Zandvoort)
  are drivable, with their end barriers where they really stand, and roads that rejoin further on do.
- **Barrier accuracy about ±1 m:** OpenStreetMap barrier lines where mapped (they are traced off imagery); sections it
  lacks (Monza: Ascari, Roggia, Lesmo) traced from aerial imagery (Esri World Imagery, as `scripts/survey-track.js`
  reads it) and checked by eye on overlay crops. The research tables' distances are a sanity check, not the source.
- **Frame-rate check:** headless High on Monza stays at least 120 fps (`scripts/browser-check.mjs --fps`), and the user
  confirms 60+ fps at High on their Retina Mac at the Monza review.

## Goals

1. **Real geometry.** Each track at its real width (the survey's per-point edges: the white lines are the real track
   limits), its real asphalt run-off where there is some, and its barriers at their real distances per side and section,
   as the physics walls too.
2. **No seams, anywhere.** One continuous built surface: asphalt, lines, kerbs, verges, run-off, gravel, grass and pit
   lane meet edge to edge with no gaps, cracks, slivers or folds; curves smooth at any distance; hairpin apexes clean.
   Every defect in `geometry-audit.md` is fixed.
3. **The pit lane joins the track like a real one.** Shared edges with the track asphalt (no grass strip, no needle tips),
   a smooth curve (no polyline kinks), the real entry and exit angles, the painted lines, the gore and bollard as on the
   FIA drawings; a real pit wall with thickness, and the pit lane in its own asphalt.
4. **Built like the real circuit.** Per corner and side: kerb type (flat, serrated / Vallelunga, sausage, negative, double
   kerb), kerb colours, run-off surface (asphalt, gravel, grass, artificial grass, painted bands), barrier type, barrier
   height, debris fence height. From the circuit's research tables, OpenStreetMap where it is good, and aerial imagery
   where neither says.
5. **Real materials.** CC0 photo textures at their real-world size on every surface; no visible tiling; soft natural
   edges where grass meets gravel or a verge meets the asphalt run-off; asphalt that catches the sun.
6. **Living rubber.** A racing line that slowly darkens over a session, and faint skid marks laid by the cars as they drive,
   kept until the session ends.
7. **Monza first, then all 14.** Monza done and approved by the user, then the same pipeline and data for the other 13
   circuits, each checked against its research.

## Non-goals (this project)

- Grandstands, trees, buildings, billboards, gantries, horizon (project 2). Today's are kept as they are, only moved where
  the new barrier positions require it (nothing may stand inside the new run-off or on the track).
- Sky, sun, tone, night lighting (project 3). Materials must look right under today's lights; final grading comes later.
- The car model and car physics (engine, tyres, handling). Only the walls and the surfaces the car drives on change
  (asphalt, kerb, grass, gravel, as decided above).
- Weather and wet track.

## Anti-goals (failure even if it technically works)

- Rubber or skid marks that read as black stripes or dirty smears. Subtle and beautiful, as in the reference shots.
- Any visible gap, crack, z-fighting flicker, folded triangle or kink in the built surface, at any distance or view
  (chase, T-cam, cockpit).
- Visible texture repetition (a pattern you can see repeat down a straight).
- A surface that looks right but drives wrong: a wall drawn where the physics wall isn't, or the reverse.
- Frame rate on the user's Retina Mac at High below 60 fps (it is ~180 fps headless today, `docs/superpowers/baseline/fps.txt`),
  or Low/Medium losing their headroom.
- Made-up circuit details presented as real. Where the research couldn't confirm something it is marked unconfirmed in the
  research files; the builder uses the most likely answer and keeps the mark in the circuit data.

## Constraints

- three.js r186 `WebGPURenderer` with the WebGL2 fallback (including the log-depth path); plain ES modules served as is,
  no build step for the game. Node tooling in `scripts/` is fine for one-off asset and data preparation.
- The simulation (`public/js/sim/`) runs on the server and in the client's predictor; walls and track limits must be the
  same data on both. Netcode, prediction and replays depend on that.
- Tests must stay green (`npm test`, 968 passing today). The recorded physics trace (`test/fixtures/drive-golden.json`)
  and every width- or wall-sized test are re-recorded or re-tuned on purpose, not loosened.
- Track data stays reproducible: importers in `scripts/` regenerate `data/tracks/*.json` from sources; hand-authored per
  circuit facts live in data files with their sources, like `data/tracks/circuits.json` does today (sources + unconfirmed).
- Browser checks use `scripts/browser-check.mjs` on its own port (3299), never the user's live server on 3232.
- CC0 only (Poly Haven, ambientCG). No branded sponsor art (project 2 decides boards).

## What changes, by part

### 1. Real width and per-point barriers (data, sim, game)

- Drop `WIDTH_MULT` from the importers and `src/game/Track.js`; the drawn asphalt is the real surface.
- The track limits are the survey's per-point edges as they are (no 4/3 `LIMIT_MULT`).
- Barriers become wall polylines where the real barriers stand (see Designer's calls) instead of the scalar
  `wallOffset` / `WALL_OFFSET = 80` / Monaco's `barrierM`. `public/js/sim/drive.js` collides against them; checkpoints,
  scenery clearance, pit layout, medians, bridges and tunnels use them.
- Surface bands (asphalt run-off, kerb widths, grass, gravel) are sim data, the same on server and client predictor:
  `drive.js` looks up the surface under each wheel instead of "within road + `KERB_M`, else grass". Gravel needs a drag
  and grip model, and the AI must recover from it. The golden trace is re-recorded.
- Knock-on work, mapped site by site (about 70 code sites, about 20 tests): grid slots (`startPositions`), racing line
  bounds, AI lane margins and pass/defend offsets (`src/game/bots/driver.js`), track-limit checks, pit lane placement
  (`PIT_CLEAR_M`), elevation importer (`realHalf`), coach side choice. The AI must still race a full grid cleanly at real
  width; the bot tests prove it.

### 2. Per-circuit construction data

A data file per circuit describing, by lap-distance range and side: kerb type and colours, run-off surface bands (with
widths), barrier type, height and distance, fence height, and point features (gore, bollards, painted bands, escape roads
with their blocks). Generated where OpenStreetMap is good (Monza's grass and gravel areas, partial barriers), filled from the
research tables and aerial imagery (the measuring approach of `scripts/survey-track.js`) where it isn't (Monza: barriers at
Ascari, Roggia, Lesmo). Each entry keeps its source and an unconfirmed mark where needed.

Monza today (2026, from `circuits-a.md`): resurfaced 2024; recessed (negative) kerbs before T1, T4, T8; red/white kerbs with
green/white/red sections at the chicanes; gravel strips behind the chicane kerbs; Rettifilo escape road with polystyrene
block rows; gravel at Roggia, both Lesmos and Ascari; T5 gravel partly asphalt (2026); natural grass at the T9 apex;
Alboreto asphalt run-off with a gravel strip at the track edge and the tricolour band at the exit; new wall and debris fence
on the left of the main straight; pit lane right, entry after Alboreto with a blue gore and yellow bollard, exit white line
ending at SC2.

Stale facts the research found in `data/tracks/circuits.json`, fixed with this data: Zandvoort `pitLimitKmh` 60 (80 since
2025); Spielberg pit limiter lines (moved about 18 m and 23 m earlier for 2026); Monaco's `barrierM` note.

### 3. Seamless geometry (render)

Every defect in `geometry-audit.md` fixed at its root:
- The pit lane meets the track asphalt with shared vertices (apron across today's grass strip); lane tips blend into the
  track edge; the lane centreline smoothed like the track's; the pit wall a real wall with thickness.
- Hairpin apexes: inner edges that don't collapse, kerb stripes that don't fan, no radial seams.
- Terrain pressed along the same smooth curve the verge is drawn on (no grass spikes or ridges in infields and gravel); no
  saw-tooth banks at distance.
- Barriers only where the physics barrier is (no orphan stubs); tunnel walls on the same curve as the barriers.
- Smooth shading where surfaces are meant to be smooth.

### 4. Materials

Textures (ids checked in `standards-and-rendering.md`): asphalt `asphalt_track` (main), `clean_asphalt` (patches),
`asphalt_pit_lane` (pit lane); kerb paint `painted_concrete_02`; grass ambientCG `Grass004`, `grass_ground` for worn edges;
gravel `dry_river_pebbles` / ambientCG `Gravel038`; concrete `concrete_wall_004`; debris fence ambientCG `Fence006` (alpha);
sand `aerial_sand`. Artificial grass is procedural (no CC0 source). Real-world size (asphalt chips 6–10 mm; kerb stripe
about 1 m, not today's 2.5 m), anisotropic filtering, tiling broken up (macro noise and a second rotated sample, stronger
methods if that isn't enough), soft noisy edges between surfaces.

Shipped compressed (the 2k JPGs are 3–6 MB each; WebP via `cwebp` is installed, KTX2 if the builder adds the tool) and
inside the 20–40 MB budget. Lower levels may load smaller mips or sizes.

### 5. Rubber and skid marks

- **Rubbered line:** darker and slightly glossier along the racing line (`track.racingLine`), strongest in braking zones and
  at apexes, fading out off-line; one rubber level that rises with laps driven in the session, from a faint start. Marbles
  (a light dusting off-line on corner exits) are allowed if they stay subtle.
- **Skid marks:** laid by every car the client draws, where it locks up, brakes very hard or slides; faint streaks that fade
  in, never blacker than the rubbered line's darkest. Kept for the session, cleared at the next session.
- Render only: no effect on grip or physics in this project.

## Left to the builder

- The data file format for per-circuit construction, and how importers merge OSM, imagery and the research tables.
- Shader techniques (texture bombing vs hex tiling, track-space skid render target vs decal ribbons, edge blending).
- Texture resolution per level, compression format, mip handling.
- How the geometry is meshed (one cross-section ribbon generator or several), as long as goal 2 holds.
- Kerb 3D profile (raised geometry vs normal map) at each level.
- Test strategy for the geometry (numeric seam and fold checks over all 14 tracks, as the audit's scripts did) and visual
  checks (browser-check screenshots at the audit's spots).

## Done when

- Monza: the user has seen it and approved it against the reference shots and the real circuit.
- Then each of the other 13 circuits: built from its research, no geometry defects (numeric checks over all tracks, and
  screenshots at pit entry, pit exit, hairpins, bridges and tunnels), walls in the sim where they are drawn.
- `npm test` green, with re-recorded goldens; High ≥ 60 fps on the user's Retina Mac; WebGL2 fallback renders correctly.
