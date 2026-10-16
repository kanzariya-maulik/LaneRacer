# LanRace track geometry audit (branch feature/render-pipeline, 7ece069)

Read-only audit. Screenshots: High, day, WebGPU, free camera (`window.lanraceDebug.freeCam`, `?stats=1`), taken with a throwaway
driver `scratchpad/shots.mjs` (copy of scripts/browser-check.mjs, own server on 3299). Numbers come from `scratchpad/analyse.mjs`,
`kinks.mjs`, `barriers.mjs`, `pituntangle.mjs` (same maths as game3d.js, run on the real track data, all 14 tracks);
raw output in `audit/numeric.jsonl`.

All paths below are under `/private/tmp/claude-501/-Users-apple-Nishchay-LanRace/a68adcaa-fbc2-4f7a-9892-043d4e2d2ce4/scratchpad/audit/`.

## What is fine (checked, no defect)

- **No cracks between consecutive segments** of road, white lines, kerbs, verge, gravel or barriers. `strip()` / `wall()`
  (game3d.js:555, :606) take both ends of every quad from one `offsetPoints()` array, and the road/verge/kerb seams are
  built from the same offset arrays, so their vertices are bit-identical. Nothing can open between quads.
- **The white lines run without a break** all the way round (built per rp point from `up(edgeR)`).
- **The road curve looks smooth** at medium and long range: the largest heading change per 2.5 m step is 6–11°, and
  14° at Monaco's hairpin. The images showed no faceting (monza-distance-low, montreal-hairpin-*, spa-eau-rouge-*).
- **Suzuka bridge**: the deck, the parapets, the cutting walls and the berms meet without visible gaps
  (suzuka/suzuka-bridge-low/top/under.png).
- **Kerb ends** are square and sit cleanly on the white line (monza-kerb-start-top.png).

## Defects, ranked by visibility

### 1. A strip of grass (or ground) between the pit lane and the track, at every pit mouth and along the whole pit straight. All 14 tracks.

- Screenshots: monza/monza-entry-taper-top.png, monza/monza-exit-taper-top.png, monza/monza-entry-high.png,
  monaco/monaco-entry-taper-top.png, monaco/monaco-exit-high.png, sakhir/sakhir-entry-taper-top.png,
  silverstone/silverstone-entry-high.png, interlagos/interlagos-entry-high.png,
  suzuka/suzuka-entry-sliver-low.png, suzuka/suzuka-exit-sliver-close.png, monaco/monaco-pitwall-low.png
- Measured gap between the drawn road edge and the lane's track-side edge:
  - In the taper it grows from 0 to 1.0–1.31 m over 20–48 m (Montreal 1.31, Monaco 1.26, Spa 1.21).
  - It then stays at a constant 1.0 m along the whole pit straight (`pitTaperGapMaxM`, `pitFullGapM`).
  - The ground in it is the terrain, sunk 0.6 m (TERRAIN_SINK_M), so from low angles it reads as a slot.
- Root cause (three parts):
  1. Track.js:177 sets `widthAt = full*c/room` with `room = full/2 + PIT_CLEAR_M` (Track.js:21, :110). The lane's
     track-side edge therefore always sits `c*PIT_CLEAR_M/room` off the road edge: by design 1 m on the straight, and a
     wedge in the taper.
  2. game3d.js:914 draws only the lane width. Nothing covers the gap between the road edge and the lane edge.
  3. The verge stops short of the lane. scenery.js:203 and :205 use `onPit()` (scenery.js:176–190), which tests against
     the **full** lane width `pit.width/2 + 0.5 m`, not `widthAt`. That cuts the verge to zero for about 15–30 raw points
     on the pit side of every track (`vergeZeroNearPit*`), and the 5-point min at scenery.js:228 widens the cut further.
     `skirtDepth` (scenery.js:241) also returns 0 there, so no skirt hides the 0.6 m step.
- Fix direction:
  - Build the mouth as one surface. Take the road's rp edge vertices (`offsetPoints(rp, ±half)`) between the mouth and
    the full-width point, and the lane's track-side edge vertices. Triangulate an asphalt apron between those two
    polylines, at road height, so the two meshes share vertices.
  - Along the straight, draw a 1 m concrete or grass strip (the pit-wall base) from the road edge to the lane edge.
  - In `vergeReach`/`onPit`, test against `widthAt/2` (or the apron polygon) instead of the full width.

### 2. Lane tips are spikes, and the first and last lane segments are never drawn

- Screenshots: monza/monza-entry-tip-top.png, monaco/monaco-entry-high.png (spike near 800,490),
  silverstone/silverstone-exit-high.png, spa/spa-entry-high.png
- Root cause:
  - game3d.js:911 `inner = i >= 1 && i <= n-3` skips segment 0 and segment n-2, because `offsetPoints` wraps the end
    normals. The drawn lane therefore starts 0.17–0.76 m off the road edge (`entryTipGapM`/`exitTipGapM`; Silverstone
    exit 0.76, Montreal exit 0.74).
  - Combined with a width ramp that reaches 0 at the mouth, the junction reads as a needle, not a lane leaving the road.
- Fix direction:
  - Give `offsetPoints` an open-path mode: clamp prev/next at the ends instead of wrapping, and skip `untangle`'s wrap
    segment. Then draw every segment.
  - Make the mouth part of the apron from defect 1, so the lane has real width where it leaves the road.

### 3. Free-standing barrier stubs in the grass, mostly between the pit lane and the track

- Screenshots: montreal/montreal-stub-near-pit.png (two fenced pieces, clearest), montreal/montreal-entry-high.png
  (about 880–905, 260–350), spa/spa-entry-high.png (about 925–975, 370–490), silverstone/silverstone-exit-high.png
  (about 680–700, 380–690)
- `barriers.mjs` finds kept barrier runs shorter than 25 m on every track:
  - Near the pit: Montreal 11 m and 18 m, Spielberg 15, 6 and 17 m, Spa 10 m, Monaco 9 m, Silverstone 5 m, Buddh 17 m.
  - Elsewhere (insides of corners): 0–22 m pieces at COTA (9 stubs), Imola (7), Buddh (7), Silverstone (8).
- Root cause: game3d.js:1560–1567 judges `ok[]` point by point. The pit exclusion (`< pit.width/2 + 4 m`, :1563) and
  the "own stretch" test leave isolated runs that pass, and `keep` (:1574) draws any run of 1 or more segments.
- Fix direction: after computing `keep`, drop runs shorter than about 30 m (or join gaps shorter than about 10 m). Near
  the pit, end the barrier where the pit wall starts, or bridge the gap to it.

### 4. Hairpin apex: the inner road edge collapses to a point, the kerb fans into slivers, and radial seams cross the asphalt

- Screenshots: monaco/monaco-hairpin-top.png and monaco/monaco-hairpin-oblique.png (Fairmont: fan of thin red/white
  wedges at the apex, faint radial lines across the asphalt), sakhir/sakhir-hairpin-top.png (fan at 720–760, 520–550,
  dark radial seam from the apex outwards)
- Measured: the inner road edge folds (points moved by `untangle`) at Monaco (4 and 15 points), Sakhir (4 and 6),
  COTA (10) and Buddh (3).
- Root cause:
  - The road is drawn about 2x the real width (Track.js), so at these apexes `half` is larger than the curve radius.
  - `untangle` (scenery.js:66) collapses the inner offset points to a single crossing. Every road triangle of the
    hairpin then fans from that one vertex, with a sheared UV (u 0→1 across, v by centreline distance) and flat face
    normals (`computeVertexNormals` on non-indexed geometry, game3d.js:543). That gives the visible spokes.
  - Kerbs alternate colour per rp step (game3d.js:1516, `alternate`), so on the inside, where the arc length per step is
    about 0, the stripes become needles. Their inner and outer edges are also untangled separately.
- Fix direction:
  - Clamp the inner offset per point to about 0.9 × the local radius before offsetting. The edge then rounds the apex
    instead of folding.
  - Colour the kerbs by arc length along the kerb's own edge, not by rp index.
  - Use indexed geometry (or `mergeVertices`) so normals are smooth.

### 5. Jagged grass wedges and terrain ridges inside hairpins and between gravel traps

- Screenshots: spa/spa-hairpin-oblique.png (dark green triangle rising through the La Source infield),
  spa/spa-entry-high.png (spiky grass "starburst" through the gravel at about 290–400, 450–500),
  suzuka/suzuka-hairpin-oblique.png (dark ridge in the infield), monza/monza-hairpin-top.png (grass spike into the
  gravel at about 680,160, polygonal gravel outer edge)
- Root cause:
  - The verge and gravel stop where another leg is nearer (`vergeReach`, scenery.js:192–229, bisected per raw point and
    min-filtered over ±2 points). The edge (`rreach = up(reach)`) therefore steps every 10 m.
  - The terrain grid shows through between the legs. Its cells are about 8–9 m (384 cells over bounds + 8000 wu,
    game3d.js:436, :1446) and it is pressed only out to `carveReach` along the **raw polyline normals**
    (scenery.js:335–343), while the verge is drawn along the Catmull-Rom curve (up to 0.6–0.75 m off the polyline,
    `rpDevM`).
  - Where the two legs are at different heights, `terrainGround` keeps the higher one, so whole cell triangles stand up
    as spikes.
- Fix direction:
  - In a hairpin infield, fill the region between the legs with one verge or gravel polygon (both legs' reach edges
    joined) instead of leaving terrain.
  - Or press the terrain to the minimum of both legs inside the infield.
  - Press the terrain along the same rp offsets that are drawn.
  - Smooth `reach` along the lap (a moving average, not a min) so the edge doesn't step.

### 6. The pit lane centreline and edges are a raw polyline: visible corners in pit bends and a kink where the taper ends

- Screenshots: monza/monza-entry-taper-top.png (outer white line kinks at about 560,530 / 650,495 / 840,440, and a jog
  at 1030–1070 where the width reaches full), monza/monza-exit-taper-top.png, interlagos/interlagos-entry-high.png
  (wobble in the lane edge near the tip)
- Measured (`kinks.mjs`): the lane is drawn on `pit.path` exactly as built, with 4–5 m points and no smoothing. The
  largest per-point heading changes are:
  - Spielberg 25.8° at 822 m
  - Spa 18.7° at 581 m
  - Interlagos 17.8° at 665 m
  - COTA 17.9° at 124 m
  - Zandvoort 17° at 436 m
  - Lane edge kinks up to 30° (Spielberg)

  The taper adds about 2 m of width per 4 m segment and then jumps straight to full width, which puts a corner in the
  outer edge (`widthAt`, Track.js:177).

  At Spa a 0.4 m segment where the connector meets the surveyed lane (Track.js:174 concatenates `en.C` + `lane.slice`)
  makes the inner edge step backwards (a tiny bow-tie at about 20 m).
- Fix direction:
  - Resample `pit.path` with the same Catmull-Rom as `smoothPath` (open-ended) at about 2 m before drawing (game3d.js
    buildPit).
  - Ease `widthAt` along arc length (smoothstep from mouth to full width) instead of following the raw clearance.
  - Drop points closer than about 1 m when joining the connectors to the lane.

### 7. The pit lane surface does not match the road (an untextured flat colour), so every junction reads as a seam

- Screenshots: monza/monza-entry-high.png, monaco/monaco-entry-taper-top.png
- Root cause:
  - game3d.js:914 uses `solid('#3a3f47')` with no `map`/`roughnessMap`. The road uses `asphaltTexture()` (:1501).
  - The lane is drawn at y 0.55 against the road's 0.6, from smoothed `pathHeights` against the road's `up(z)`.
    The measured step at the tips is 0.00–0.03 m, so the heights are fine.
- Fix direction: use the same asphalt material and tiling on the lane (and on the apron from defect 1).

### 8. The pit wall is present but almost invisible: zero thickness, no top, and the same tone as the lane

- Screenshots: suzuka/suzuka-wall-side.png against suzuka/suzuka-wall-side-nowall.png. The wall only shows up by being
  hidden; with it, the grey band reads as more asphalt. Also monza/monza-pitwall-low.png.
- Root cause: game3d.js:935 builds the wall as a single vertical plane (`wall()`, 1 m), #9aa0a6, next to the light lane
  edge line. Because it has no top face or thickness, from the chase camera the lane and the track look unseparated.
  This adds to how visible defect 1 is.
- Fix direction: give it about 0.5 m of thickness with a top cap, a contrasting colour or a stripe, and stand it in the
  1 m strip between the road edge and the lane (the space PIT_CLEAR_M reserves for it).

### 9. Terrain faceting and saw-tooth banks at distance

- Screenshot: spa/spa-distance-low.png (right: a vertical green "cliff" with a saw-tooth top along the Kemmel side)
- Root cause: the ground grid is about 8–9 m per cell (game3d.js:436) and the banks are BANK = 1.5 m across per m of
  height (scenery.js), so steep banks are one or two cells wide. Grass skirts (game3d.js:1480–1493) hang 3 m or more
  straight down from the verge edge. Flat normals on the skirts make each 2.5 m panel a different shade.
- Fix direction: a finer grid near the track (or a separate bank strip mesh along the verge edge sloping down at BANK,
  instead of a vertical skirt), with smooth normals.

### 10. Tunnel and barrier tessellation mismatch (found in code; Monaco tunnel only looked at once)

- Screenshot: monaco/monaco-tunnel-mouth.png (red/white barrier continuing into the tunnel beside the tunnel wall)
- Root cause:
  - `buildTunnels` (game3d.js:1187–1210) builds the walls, roof and lamps on the raw `path` at `half + wallOffset`.
  - The run-off barriers (:1550–1580) are drawn on the smooth `rp` at the same offset and are not suppressed inside
    tunnels.
  - The two polylines differ by up to about 0.6 m on bends, so the barrier and the tunnel wall cross each other (z-fight
    or poke-through), and the roof edge is faceted at 10 m.
- Fix direction: build the tunnels on `rp` with `up(inside)`, and skip barriers where `inside` (or put them flush,
  slightly inside the wall).

### 11. Smaller items

- **Flat shading everywhere** (game3d.js:538–543): `computeVertexNormals` on non-indexed triangles gives per-face
  normals. Barriers and skirts shade panel by panel on curves, and road quads on curved slopes show a diagonal crease.
  Fix: index the strips (share vertex i between quads) or `mergeVertices` before computing normals.
- **Gravel strips can invert**: `edge = rreach - dir*scale` (game3d.js:1528) is inside `roadTo` wherever the verge reach
  collapses to the road edge (pit side, infields), so a 1 m gravel band is drawn under the asphalt (0.4 vs 0.6). It is
  hidden today, but it is a potential depth-fight at distance. Fix: clamp `edge` to at least `roadTo`.
- **The rubbered racing-line patch** (game3d.js:1536–1543, 0.35 alpha) starts and stops with square ends across the
  road (monza-kerb-start-top.png). Fade it in and out over a few steps.
- **Pit entry and exit angles**: the connectors are tangent to the road edge, and the first drawn segment is 2–19° off
  the road (Montreal entry 19.1°, Spa entry 15.7°, the rest 6–12°). The angle itself is plausible. What looks wrong is
  that the mouth is at the **drawn** edge (2x real width, outside the white line and the run-off asphalt) and is
  needle-thin (defects 1 and 2). At Silverstone's exit the mouth lands across a kerb (silverstone-exit-high.png). Fix:
  start the apron at the white line, and suppress kerbs (`rc`) across the mouth.
