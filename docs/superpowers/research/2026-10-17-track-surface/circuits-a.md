# LanRace circuit research A: Monza, Spa, Silverstone, Suzuka, Sakhir

Researched 2026-10-17. Target configuration: the layout as raced in the 2026 season (Bahrain: 2025, because the 2026 Bahrain GP was cancelled, per Wikipedia).

## Confidence tags

| Tag | Meaning |
|---|---|
| **[FIA]** | Confirmed from an FIA Race Director event/competition-notes PDF (text or photo). |
| **[SRC]** | Confirmed by a secondary source (press, Wikipedia). |
| **[OSM]** | Measured from OpenStreetMap (Overpass, fetched 2026-10-17). |
| **[K]** | General circuit knowledge or onboard/aerial recollection. **UNCONFIRMED**: check against imagery before building geometry from it. |

Barrier distances marked [OSM] are the **median distance from the OSM raceway centreline** to the nearest barrier way on each side, in the way's direction (that is, the racing direction, since the ways are `oneway=yes`). To get the distance from the track edge, subtract about 6 to 7 m (half the track width). Where OSM maps walls as closed rings around the whole site, the nearest wall can be the perimeter rather than the trackside barrier. Treat these numbers as an order of magnitude, not survey data.

Pit lane speed limit: F1 uses the 80 km/h default from the F1 Sporting Regulations at all five venues. The FIA F1 notes do not restate it. F2 and F3 run 60 km/h **[FIA]** (F2 notes, Monza 2025, Spa 2024, Silverstone 2025).

**Common FIA pit-line conventions** (Appendix L, Ch. IV, Art. 4 and 6), stated in every set of notes **[FIA]**:
- At pit entry, a **bollard at Safety Car Line 1** marks the split. Passing to the right of it counts as entering the pits.
- A **dotted white line** across the pit entry and the pit exit marks the track-edge line.
- A **solid white line** separates the pit exit road from the circuit, from SC2 to its end. Drivers leaving the pits must stay on the pit side of it.
- In the pit lane, a solid white line separates the fast lane from the inner (working) lane.
- **Blue lines** painted behind the white track-limit line at corner exits: this is the 2024–26 FIA standard, a visual warning band at about 1–2 m.
- **Fluorescent orange panels or paint** on barriers mark the places where cars can be removed. **White boards with a red extinguisher** symbol are fixed to the debris fences.
- In all five pit lanes the **garages are on the right-hand side** in the direction of travel [OSM side test + FIA maps]. All five pit lanes are on the right of the main straight.

---

## OSM data availability (Overpass, mail.ru mirror; overpass-api.de refused connections)

Raw data: `scratchpad/research/osm2/{circuit}.json`. Summaries: `osm2/summary.txt` and `osm2/near.txt`. Scripts: `scratchpad/scripts/`.

"Coverage" is the share of 10 m samples along the main raceway ways that have a barrier, or a run-off polygon edge (sand, shingle, gravel, landuse=grass, area:highway), within 35 m.

| Circuit | Barrier ways within 150 m | Barrier coverage | Run-off/grass polygon coverage | Gravel-trap polygons | Pit lane way | Verdict |
|---|---|---|---|---|---|---|
| Monza | wall 7 (5.0 km), fence 14, guard_rail 7 | **35%** | 64% | `natural=sand` ×10 (e.g. 231025694, 231025696, 231026021). Mostly gravel traps, untagged as such | 38168747 `name=Pit Lane`, 743 m | **Partial.** Grass and sand polygons are usable as a gravel/grass mask. Barrier lines are missing around Ascari, Roggia and Lesmo, so they need procedural fill. |
| Spa | wall 70 (13.7 km), fence 70 (22.7 km), guard_rail 5, retaining_wall 5 | **100%** | 98% | `natural=shingle`+`surface=gravel`+`note=Run-off area` ×19 (175370760, 175398622, 175404078); landuse=grass ×63 | 323851541 `Pit Lane`, 720 m; 126807525 `Support Pit Lane` | **Good.** Best of the five. Gravel traps are explicitly tagged and wall plus fence lines are continuous (wall material=concrete on 126871646). Usable automatically. |
| Silverstone | fence 183 (29 km), wall 79 (9.8 km), guard_rail 3, `barrier=kerb` 2 (1040353580; 1215286608 `kerb=raised`) | 55%* | 58%* | `natural=sand` ×18 (559446514, 605759139, 605760825), shingle ×3; landuse=grass ×221 | 227902927 `International pit lane` (`raceway=pit_lane`), 1129 m. Also 227838385 National pit lane | **Partial to good.** Gravel traps are mapped as sand polygons and grass is abundant. Many "fence" ways are spectator or perimeter fences, so they need filtering by distance (under 40 m from the edge). *Coverage figures are diluted by the National/International loops. |
| Suzuka | wall 71 (13.1 km), fence 57; tyre walls as `area=yes barrier=wall name=タイヤバリア` (467219893, 468778567 `name:en=Tire barrier`) | 55%* | 46%* | `natural=sand` ×24 (467152471, 467386916, 467386919); landuse=grass ×50; one `area:highway=raceway` outline (775428456) | 120917578 `Pit Lane`, 889 m | **Partial.** Tyre-barrier areas and gravel (sand) polygons are a nice bonus. Barrier lines at Spoon, 130R and Degner are present (see distances). *Some figures are diluted by South-course ways. |
| Sakhir | wall 108 (13.8 km), fence 26 | **77%** | 33% | `natural=sand` ×24 (14.9 km). This is mostly **desert, not gravel traps**; shingle ×3 (881756724) | 187123422 `Pit Lane`, 777 m | **Barriers good, run-off poor.** Wall lines are usable. The asphalt run-off and gravel beds are not mapped (no `area:highway`, no gravel), so procedural run-off is needed. |

What is missing at all five:
- No kerb geometry (barring two Silverstone `barrier=kerb` ways).
- No `area:highway` run-off asphalt polygons, except the one Suzuka site outline.
- No catch-fence heights. The only exception is Monza: 243090140 `height=3`, plus guard rail 243090139 `height=1.2` and wall 243090150 `height=1.3`.
- No barrier type finer than wall, fence or guard_rail. TecPro and tyre walls are not distinguished, except Suzuka's `タイヤバリア` areas.

**Conclusion:** OSM can drive automatic placement of gravel/grass masks at Spa, Silverstone and Suzuka, and barrier lines at Spa and Sakhir (Suzuka mostly). Kerbs, run-off paint and fence heights must come from the per-corner tables below.

---

## 1. Monza (Autodromo Nazionale Monza), 5.793 km, 11 turns, clockwise

**Recent changes:**
- **2024:** full resurfacing; kerbs at Rettifilo, Roggia and Ascari flattened (the old "drain" kerb at Ascari is gone); narrow **gravel strips added behind the kerbs at the first and second chicanes** [SRC the-race.com, planetf1].
- **2025** [FIA F1 notes 2025]:
  - New gate in the pit wall in front of garage 32.
  - Bitumen asphalt repair at T1 and T4.
- **2026** [FIA F1 notes 2026]:
  - New asphalt patch at T2.
  - **New wall and debris fence on the LEFT of the main straight.**
  - **New "negative" (recessed) kerbs** from the 100 m board before T1 (left), before T4 (right) and before T8 (right).
  - First part of the T5 left-hand gravel bed replaced by asphalt.
  - **Natural grass at the T9 apex (right).**
  - New fences on the left between T10 and T11.
  - Pit exit white line shortened so that it ends at SC2.

**Turns:**

| # | Name | Outside run-off | Inside | Kerbs | Barrier | Barrier dist. | Catch fence | Notes |
|---|---|---|---|---|---|---|---|---|
| 1–2 | Variante del Rettifilo (R-L) | **Asphalt escape road** straight on, with **4 rows of polystyrene blocks** [FIA]; grass alongside | Grass + narrow gravel strip behind exit kerb (2024) [SRC] | Red/white flat kerbs (flattened 2024); low yellow sausages behind the apex were historically present [K]; negative kerb on the left from 100 m (2026) [FIA] | Armco + tyre bundles at the end of the escape road; concrete + fence along the straight [K] | [OSM] escape-road side 35–49 m, other side 27 m (from centreline) | Yes, ~4 m debris fence [K] | Grandstands on the outside. Painted red/white kerb strips are visible in FIA aerials [FIA photo] |
| 3 | Curva Grande / Curva Biassono (long R) | Asphalt run-off strip, then gravel, then grass; trees beyond [K] | Grass | Red/white flat kerb on exit [K] | Armco (2–3 rails) + fence [K] | [OSM] left (outside) ~51 m | Yes ~4 m | OSM way name "Curva Biassono" (179968220) |
| 4–5 | Variante della Roggia (L-R) | **Gravel trap** outside T4. Escape road to the right of the gravel: stay right of the **yellow line and yellow bollard**, rejoin at the far end of the T5 asphalt run-off [FIA] | Flat kerb, then a **thin concrete strip, then gravel** (2024) [SRC Ricciardo]. The first part of the T5 left gravel is now asphalt (2026) [FIA] | Red/white plus **green/white** sections (Italian tricolour); the FIA diagram shows red-white-green kerbs at T4/5 [FIA image]. Negative kerb before T4 (right) | Tyre wall + Armco; concrete wall + fence by the grandstand [K] | [OSM] 68 m L / 85 m R | Yes | Heineken-branded painted asphalt run-off seen in the FIA aerial [FIA photo] |
| 6 | Lesmo 1 (R) | **Gravel** outside (narrow asphalt strip at the edge, then gravel) [K] | Grass | Red/white flat (apex + exit) [K] | Tyre wall + Armco, trees close [K] | [OSM] ~59 m L | Yes | |
| 7 | Lesmo 2 (R) | **Gravel** outside [K] | Grass | Red/white flat [K] | Armco + tyres [K] | [OSM] ~59 m L | Yes | Serraglio straight follows, passing under the old banking bridge (Sopraelevata, OSM 19982933) |
| 8–10 | Variante Ascari (L-R-L) | **Gravel** outside T8 entry and outside T10 exit; grass [K]. Negative kerb before T8 (right) from 100 m (2026) [FIA] | Grass; natural grass at the T9 apex (2026) [FIA] | Flattened in 2024 (the old 10 cm "drain" kerb removed) [SRC]; red/white flat [K] | Armco + tyres [K] | [OSM] **no barriers mapped within 120 m** | Yes | Biggest OSM gap |
| 11 | Curva Alboreto (ex-Parabolica, R) | **Asphalt run-off since 2014, with a strip of gravel left right beside the track edge** [SRC grandprix.com 2014]. Track limits on entry and exit invalidate the lap and the next lap [FIA] | Grass | Red/white flat kerb at exit; old exit sausage removed after the 2019 Peroni crash [SRC]. **Green/white/red painted band at the exit, next to the 50/100/150 boards** [FIA photo 2025] | Concrete + fence on the outside (~3–4 m), Armco + tyres at the end of the run-off [K/OSM] | [OSM] outside ~82 m (min 10), inside 14 m | Yes ~4 m | New fences on the left between T10 and T11 (2026) [FIA] |

**Main straight (Rettifilo Centrale):**
- Pit lane and garages on the right. The pit wall is concrete with Pirelli/500GP yellow branding and a tall debris fence on top [FIA photo].
- Grandstand on the left (main tribuna). From 2026 there is a new wall and debris fence on the left [FIA].
- Start gantry over the track. The famous podium overhangs the pit straight [K].
- Surface: dark, fresh asphalt, **fully resurfaced in 2024** [SRC].
- Grid on the right-hand side? The FIA says only the "car number light panels are on the right-hand side of the grid".

**Pit lane:**
- **Entry:** right side, immediately after the Alboreto exit. A gentle diverge, then a **blue-painted gore triangle with a yellow bollard** at SC1 [FIA photo]. The dotted white line runs along the entry.
- **Exit:** the pit exit road runs on the right alongside the straight. A continuous white line separates it from the track after SC2 [FIA 2025]. From 2026 the white line ends at SC2 [FIA]. Practice-start boxes are on the right of the pit exit road before the end of the pit wall [FIA].
- **Merge:** blends with the track in the run to the T1 braking zone [FIA diagram].
- **Length:** OSM pit way 743 m (38168747).
- **Width:** about 12–14 m (fast lane + working lane) [K].

**Kerb colour scheme:**
- Red/white is standard.
- Italian green/white/red sections at the chicanes [FIA images].
- Tricolour painted run-off band at the Alboreto exit [FIA photo].
- Yellow sausages are historical and largely replaced by gravel strips (2024) [SRC/K].

---

## 2. Spa-Francorchamps, 7.004 km, 19 turns, clockwise

**Recent changes:**
- **2022 (€25 m, winter 2021/22)** [SRC racingnews365, Wikipedia]:
  - **Gravel traps reinstated or added** at La Source, Raidillon, Les Combes/Malmedy, Pouhon, Stavelot, Blanchimont and Speaker's Corner.
  - Raidillon run-off enlarged on both sides; the barrier at the top moved back; a new sausage kerb keeps the corner profile.
  - Full resurface after the floods.
  - New 4,600-seat grandstand at the top of Raidillon.
- **2024** [FIA F2 notes 2024]:
  - New asphalt from the T17 exit to the T2 entry, including the F1 pit lane fast lane; from the T4 exit to the T8 entry; and from the T14 entry to the T15 exit.
  - New combination kerb at T9 (left).
  - Guardrail replaced by **concrete wall + FIA fence** at MP4C (100 m), MP5 (120 m), MP7B (100 m), MP13 (100 m), MP14 (210 m) and MP15 (450 m).
  - New concrete wall at the T12 entry (left).
  - White lines moved closer to the kerb ends at T1 L, T7 L, T9 R, T13 R, T14 L and T15 L.
- **2025** [FIA F1 notes 2025]:
  - Racing line resurfaced from the 50 m board to the T1 exit.
  - New T3 apex kerb.
  - Asphalt ground down from the endurance pit lane to T2.
  - Bump after T15 resurfaced.
- **2026** [FIA F1 notes 2026]:
  - New gate in the pit exit road (right).
  - **Wall extended on the right approaching T2.**
  - **Rain grooves cut into the Kemmel straight.**
  - T14 ground down to remove a bump.
  - Grasscrete behind the T5 apex kerb replaced by asphalt.
  - Start of the T19 apex kerb smoothed.
  - Asphalt repairs approaching T1, T14 and T17.

**Turns** (numbering per FIA notes; corner names per OSM):

| # | Name | Outside run-off | Inside | Kerbs | Barrier | Barrier dist. [OSM] | Catch fence | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | La Source (R hairpin) | Asphalt run-off, extended, **+ gravel trap outside** (2022) [SRC] | Asphalt/painted apron | Red/white; white line on the left moved toward the kerb end (2024) [FIA] | Concrete wall + fence | ~20 m L / 16 m R | Yes ~4 m | Pit exit road passes on the right [FIA] |
| 2 | Eau Rouge (L) | Armco moved back (2022) [SRC]; wall extended on the right (2026) [FIA] | Grass | Red/white flat | Armco + concrete wall (right) | 21 m L / 6 m R | Yes | Track compression at the bottom; resurfaced 2022 |
| 3 | Raidillon (R, uphill) | **Large asphalt run-off on the left, then gravel**; 4,600-seat grandstand at the top on the left [SRC] | — | Red/white; **new sausage kerb** [SRC]; new apex kerb (2025) [FIA] | Guard rail (OSM) + tyre/TecPro wall [K] | 33 m L / 22 m R | Yes | |
| 4 | Raidillon top (L, onto Kemmel) | **Enlarged asphalt run-off on the right** [SRC] | — | Red/white | Concrete wall | — | Yes | |
| — | Kemmel straight | Grass both sides | | | Concrete walls both sides | 9 m L / 10 m R | Yes | Rain grooves (2026) |
| 5–6 | Les Combes (R-L) | **Gravel replaced asphalt** (2022) [SRC]; barrier moved back. Escape road along the front of the tyre barrier, rejoining at T7 [FIA] | Grasscrete replaced by asphalt at the T5 apex (2026) [FIA] | Red/white | **Tyre barrier** at the escape [FIA] + concrete | 44 m L / 17 m R | Yes | |
| 7 | Malmedy (R) | Gravel [SRC]; white line on the left moved (2024) [FIA] | | Red/white | Concrete wall | 18 m / 15 m | Yes | |
| 8 | Bruxelles / Rivage (R hairpin) | Asphalt run-off + gravel [K] | | Red/white | Concrete wall | 31 m L / 11 m R | Yes | |
| 9 | Speaker's Corner / Jacky Ickx (L) | **Gravel at track-limit border** (2022) [SRC]; white line on the right moved (2024) [FIA] | Motorcycle bypass section built on the inside (2022) [SRC] | **Combination kerb (2024) on the left** [FIA] | Concrete + fence | 32 m / 14 m | Yes | Numbering note: Wikipedia calls the Jacky Ickx corner "T11"; the FIA notes use T9 for this corner. UNCONFIRMED |
| 10–11 | Pouhon / Double Gauche (fast double L) | **Gravel extended** on the outside (right) (2022) [SRC] | Grass | Red/white | Concrete wall right, fence left | 11 m L / 42 m R | Yes | |
| 12–13 | Fagnes (R-L) | Gravel + asphalt [K]; new concrete wall at the T12 entry (left) (2024) [FIA] | | Red/white; T13 R white line moved | Concrete wall | 30 m / 13 m | Yes | |
| 14 | Campus / Stavelot (R) | **Gravel added** (2022) [SRC]; white line L moved (2024) [FIA] | | Red/white | Concrete wall + fence | 23 m / 12 m | Yes | |
| 15 | Courbe Paul Frère (R) | Gravel/asphalt; white line L moved [FIA] | | Red/white | Concrete wall + fence | 36 m / 13 m | Yes | |
| 16–17 | Blanchimont (fast L) | **Increased run-off with gravel outside (right)** (2022) [SRC]; MP14/MP15 rail replaced by concrete + fence (2024) [FIA] | | Red/white | Concrete wall + FIA fence | 11 m L / 27 m R | Yes ~4 m | |
| 18–19 | Bus Stop chicane (R-L) | Asphalt run-off [K]. **T19 track limits invalidate the lap and the next lap** [FIA] | | **Red/yellow/white** kerbs seen in FIA photos [FIA photo, colours UNCONFIRMED]; T19 apex kerb start smoothed (2026) | Concrete wall | 23 m / 45 m | Yes | Pit entry splits here |

**Main straight:**
- Pit lane and garages on the right. The pit wall is concrete with a debris fence.
- Grandstands on the left.
- Gantry at the start.
- **Grid gate at grid position 1** [FIA].
- Car number light panels on the left of the grid [FIA F2 2024].
- Surface: T17 to T2 relaid in 2024; the T1 racing line in 2025 [FIA].

**Pit lane:**
- **Entry:** a gentle diverge to the right **just after the Bus Stop exit (T19)**, bollard at SC1 [FIA photo 2026].
- **Exit:** runs past La Source on the right and continues as a separate pit exit road down toward Eau Rouge. **Practice starts are on the right of the pit exit road after T1 and before SC2** [FIA]. The exit area has red/white painted stripes and a blue grandstand behind [FIA photo 2026].
- **Merge:** on the right, after SC2 on the run toward Eau Rouge (exact point UNCONFIRMED).
- **Length:** OSM 720 m (323851541); a fan guide gives 653 m [SRC oversteer48].
- **Endurance (support) pit lane:** separate (126807525, 1203 m), joined at the T1 exit.

**Kerb colour scheme:**
- Red/white.
- Yellow outer kerb elements at some corners [FIA photo].
- A light-green painted band beyond the white lines is visible in FIA aerials of T5–T7 and in the pit-exit photo. UNCONFIRMED whether it is paint or turf.

---

## 3. Silverstone (Arena GP), 5.891 km, 18 turns, clockwise

**Recent changes:**
- **2019:** full resurface by Tarmac [SRC]. A partial resurface is not confirmed since then.
- **2024** [SRC motorsport.com]: Austria-style track-limits package:
  - **Stowe outside gravel moved 6–8 m closer to the track**, with the white line moved on the exit kerb.
  - Copse white line moved, without adding gravel.
- **2025** [FIA F1 + F2 notes 2025]:
  - Kerb on the left of the T1 run-off removed.
  - Red kerb elements replaced by flat elements: T1 apex (1), T6 apex (2), T7 apex (1), T9 apex (3).
  - **T18 exit gravel changed to a lighter-coloured material.**
  - T18 sausage kerb removed.
- **2026** [FIA F1 notes 2026]:
  - **Blue lines** at the exits of T1, 5, 6, 7, 8, 9, 13, 15, 17 and 18, plus the T8 apex.
  - T3 exit grass replaced by tarmac.
  - T4 left barrier extended.
  - Drainage between T8 and T9.
  - Tarmac strip behind the kerb at the T15 entry (left).
  - **Red sausage behind the kerbs at the T17 and T18 apexes removed.**

**Turns:**

| # | Name | Outside run-off | Inside | Kerbs | Barrier | Barrier dist. [OSM] | Catch fence | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Abbey (fast R) | Large **asphalt** run-off [K]; kerb on the left of the run-off removed (2025) | Grass | Red/white with red raised secondary elements; apex element now flat (2025) [FIA] | Concrete + tyre/TecPro [K] | 39 m L / 21 m R | Yes | Pit exit runs to the right here |
| 2 | Farm (fast L) | Asphalt + grass [K] | | Red/white | Fence/wall | 68 m / 54 m | Yes | |
| 3 | Village (R) | Asphalt run-off; **T3 exit grass replaced by tarmac (2026)** [FIA] | | Red/white | Fence/wall | 42 m / 72 m | Yes | |
| 4 | The Loop (L hairpin) | Asphalt [K]; **left barrier extended (2026)** [FIA] | | Red/white | Wall + fence | 76 m / 50 m | Yes | |
| 5 | Aintree (L) | Asphalt/grass [K] | | Red/white; blue line at exit (2026) | Wall | 35 m / 51 m | Yes | Wellington Straight (DRS) follows |
| 6 | Brooklands (L) | Asphalt + gravel [K] | | Red/white, 2 apex elements flattened (2025) | Wall + fence | 44 m / 34 m | Yes | |
| 7 | Luffield (long R) | Asphalt [K] | | Red/white, 1 apex element flattened (2025) | Wall | 34 m / 62 m | Yes | |
| 8 | Woodcote (R) | Asphalt/grass; drainage T8–9 (2026) | | Red/white; blue line at the apex (2026) | Wall + fence | 39 m / 15 m | Yes | National pit straight; support pit lane exit at T8 [FIA F2] |
| 9 | Copse (fast R) | **Gravel trap** outside [K]; white line moved in 2024 without new gravel [SRC] | Grass | Red/white, 3 apex elements flattened (2025) | Tyre wall + conveyor belt, concrete [K] | 39 m L / 19 m R | Yes | |
| 10–13 | Maggotts / Becketts (L-R-L-R) | **Gravel** outside at Maggotts and Becketts; grass [K] | Grass | Red/white; T13 exit blue line | Tyre walls + concrete | Maggotts 18 m / 52 m; Becketts 82 m / 36 m | Yes | |
| 14 | Chapel (L) | Grass/asphalt [K] | | Red/white | Wall | 53 m / 81 m | Yes | Hangar Straight follows (DRS) |
| 15 | Stowe (R) | **Gravel moved 6–8 m closer (2024)** [SRC]; tarmac strip behind the kerb at the entry (left) (2026) [FIA] | Grass | Red/white | Tyre/TecPro + wall [K] | — (OSM "Stowe Circuit" ways excluded) | Yes | |
| 16 | Vale (L) | Asphalt + gravel [K] | | Red/white | Wall | 49 m / 46 m | Yes | Pit entry diverges after Vale |
| 17–18 | Club (R-R) | **T18 exit gravel, light-coloured material (2025)** [FIA]. T18 track limits invalidate the lap and the next lap [FIA] | | Red/white; T18 sausage removed (2025); red sausages behind the T17/T18 apexes removed (2026) | Wall + fence, guard rail | 33 m / 51 m | Yes | |

**Main straight (Hamilton Straight, International Pit Straight, Wing complex):**
- Pit lane and garages on the right (the Wing).
- Pit wall concrete with debris fence; pit wall gates at grid positions 1 and 12 [FIA].
- Grandstands opposite.
- Start gantry; car number panels on the right of the grid [FIA F2].
- Surface relaid 2019 [SRC].

**Pit lane** [FIA F2 2025 pit map]:
- **Entry:** diverges right **after Vale (T16), before Club**. A long curving entry road runs inside Club. Red/white bollard at the SC1 split, white gore hatching and a dotted white line [FIA photo].
- **Exit:** the exit road runs on the right past Abbey (T1), separated from the circuit by **grass** and a dotted white line. SC2 is on the exit road [FIA map]. No practice starts at the pit exit (2025).
- **Merge:** after Abbey (exact point UNCONFIRMED).
- **Length:** OSM 1129 m (227902927, tagged `raceway=pit_lane`), including the long entry and exit roads.
- **Width:** working lane 5.0 m from the pit-lane line to the F1 equipment line, plus the fast lane [FIA F2 pit-stop drawing]. Total about 12 m [K].

**Kerb colour scheme:**
- Red/white flat kerbs.
- **Red raised "double kerb"/secondary elements**, progressively replaced by flat elements (2025).
- Red sausages, removed at T17/T18 (2026).
- Yellow sausages at chicanes historically [K].
- Asphalt run-offs are mostly unpainted grey [FIA photos].

---

## 4. Suzuka, 5.807 km, 18 turns, figure-of-eight

**Recent changes:**
- **2025** [FIA F1 notes 2025]:
  - **Resurfaced from T1 to the T8 entry.**
  - **Gravel brought right to the back of the double kerb at T2, T8 and T9.**
  - **New double kerb at T9.**
  - Marshal posts protected with debris fences.
  - White line realigned and **blue line added** at the exits of T1, 2, 8, 9, 14 and 15.
  - Extinguisher signs on plastic posts.
- **2026** [FIA F1 notes 2026]:
  - **Resurfaced from T7 to T17** (so the whole lap is now 2025–26 asphalt).
  - **New debris fence at T13 on the right.**
- **2025:** grass fires caused red flags [SRC]. Run-offs include large areas of natural grass.

**Turns** (numbering per FIA 2023 circuit map):

| # | Name | Outside run-off | Inside | Kerbs | Barrier | Barrier dist. [OSM] | Catch fence | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | First Curve (R) | Gravel + grass [K]; artificial-grass strips claimed [SRC forum, UNCONFIRMED] | | Red/white; blue exit line (2025) | Tyre wall + Armco | 23 m / 14 m | Yes | |
| 2 | Second Curve (R) | **Gravel up to the back of the double kerb (2025)** [FIA] | | Red/white double kerb | Tyre wall + Armco | 38 m / 32 m | Yes | |
| 3–6 | S Curves (L-R-L-R) | Gravel + grass alternating [K] | | Red/white | Armco + tyres | 14–107 m (varies) | Yes | |
| 7 | Dunlop / Gyaku (L) | Run-off doubled from 12 m to 25 m (2002) [SRC] | | Red/white | Tyre wall; post-Bianchi revisions [SRC] | 44 m / 29 m | Yes | |
| 8 | Degner 1 (R) | **Gravel to the back of the double kerb (2025)** [FIA] | | Red/white double kerb | Armco + tyres | Degner 1: wall 4 m left (the inside) / 53 m right | Yes | Gravel FP2 off (2025) [SRC] |
| 9 | Degner 2 (R) | **Gravel to the double kerb; new double kerb (2025)** [FIA] | | Red/white double kerb | Armco + tyres | 24 m / 55 m | Yes | Passes under the crossover bridge |
| 10 | (R kink before hairpin) | Grass [K] | | | | | | |
| 11 | Hairpin, NISSIN Brake (L) | Asphalt + gravel [K] | | Red/white | Tyre wall | 29 m / 18 m | Yes | |
| 12 | 200R (R) | Grass/gravel [K] | | | Armco | | Yes | |
| 13–14 | Spoon Curve (L-L) | **Large gravel trap** outside [K]; **new debris fence at T13 on the right (2026)** [FIA]; blue line at the T14 exit | | Red/white | Tyre wall + Armco | 55–88 m L / 33–40 m R | Yes | |
| 15 | 130R (fast L) | Tarmac run-off (2002) + gravel [SRC/K]; blue line at exit | | Red/white | Fence + concrete wall (tyre wall at the end) | 20 m L / 35 m R | Yes | |
| 16–17 | Casio Triangle / Hitachi Astemo chicane (R-L) | Asphalt + gravel [K] | | Red/white | Tyre wall | 13–39 m | Yes | Pit entry at the exit of the chicane |
| 18 | Final curve (R) | Grass/asphalt | | Red/white | Wall | | Yes | |

**Main straight:**
- Pit lane and garages on the right [OSM]. The pit wall is concrete with a red/white (Lenovo-branded) wall face and a tall debris fence [FIA photo].
- Main grandstand opposite on the left.
- Start gantry with timing tower [FIA photo].
- Grid gates at grid positions 5 and 22 [FIA].

**Pit lane** [FIA 2023 pit drawing + 2025 photos]:
- **Entry:** the pit entry bollard and SC1 are **at the exit of the Casio chicane**. The pit road then curves gently right, inside the final curve, and runs parallel to the straight. The split is fairly sharp because it starts in the chicane exit [FIA photo].
- **Exit:** the exit road runs on the right alongside the straight past the end of the garages. **Yellow chevron hatching** on the gore where the exit road separates from the fast lane [FIA photo]. The dotted white line marks the track edge.
- **Merge:** SC2 and the **pit exit line end at the 50 m board before T1** [FIA 2023 map].
- **Length:** OSM 889 m (120917578).
- Practice starts on the RHS of the fast lane at the pit exit, in painted grid boxes [FIA].

**Kerb colour scheme:**
- Red/white flat kerbs, with **double kerbs** (flat + raised inner element) at T2, T8 and T9.
- Gravel traps are brown/grey; large natural grass areas.
- Tyre barriers are covered with conveyor belts [K].
- OSM maps several tyre-barrier areas (`タイヤバリア`).

---

## 5. Sakhir (Bahrain International Circuit, GP layout), 5.412 km, 15 turns, clockwise

**Status:** the **2026 Bahrain GP was cancelled** (Middle East conflict) [SRC Wikipedia], so the 2025 configuration is current.

**Recent changes:**
- **2020–21:** after Grosjean's crash, the T3-exit Armco was replaced by concrete wall [SRC ESPN]. A kerb between T8 and T9 on the Outer layout was removed [SRC].
- **2024:** a loose drain cover before T10/11 red-flagged testing; the drain was filled with concrete and painted in kerb colours [SRC the-race].
- **2025** [FIA F1 + F2 notes 2025]:
  - **T4 exit gravel bed extended.**
  - U-drains near the racing line closed with cement and moved into the run-offs.
  - Bumps repaired on the start straight and at T9.
  - Kerb at T3 RHS (other layout) removed.
  - Start and finish platform glass replaced.
  - **Blue line** behind the white line at the T4 and T6 entries and at the exits of T2, 4, 10, 11, 13, 14 and 15.
- **Surface:** graywacke aggregate from a Shropshire quarry, very abrasive [SRC Wikipedia]. Last full resurface UNCONFIRMED.

**Turns:**

| # | Name | Outside run-off | Inside | Kerbs | Barrier | Barrier dist. [OSM] | Catch fence | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Michael Schumacher (R hairpin) | Huge asphalt run-off, **sand/beige coloured** [K/FIA photo] | | Red/white | Concrete + TecPro [K] | | Yes | |
| 2 | (L) | Asphalt; blue exit line (2025) | | Red/white | Concrete | | Yes | |
| 3 | (R kink) | Asphalt | | Red/white; RHS kerb of other layout removed | **Concrete wall at the exit** (post-2020) | | Yes | Grosjean crash site |
| 4 | (R) | **Exit gravel bed extended (2025)** [FIA]; asphalt before it; blue lines at entry and exit | | Red/white; extra kerb proposed (2021) [SRC] | Concrete + tyres | | Yes | |
| 5–7 | Esses (L-R-L) | Asphalt; blue line at the T6 entry | | Red/white | Concrete | | Yes | |
| 8 | (R hairpin) | Asphalt | | Red/white | Concrete + TecPro | | Yes | |
| 9–10 | (L, L, tight braking) | Asphalt; bump repaired at T9 | | Red/white; ex-drain painted in kerb colour (2024) | Concrete | | Yes | |
| 11 | (L) | Asphalt; blue exit line | | Red/white | Concrete | | Yes | |
| 12 | (fast R) | Asphalt/sand | | Red/white | Concrete | | Yes | |
| 13 | (R) | Asphalt; blue exit line | | Red/white | Concrete | | Yes | Back straight (DRS) follows |
| 14 | (R) | **Sand-coloured asphalt run-off with red/white painted zones** at the 100 m boards [FIA photo] | | Red/white | **Red/white TecPro blocks** [FIA photo] | | Yes | |
| 15 | (R, final) | Asphalt; **track limits at the T15 entry and exit invalidate the lap and the next lap** [FIA] | | Red/white | Concrete | | Yes | Pit entry |

The whole GP loop is OSM ways 4818385 and 881756728. The median barrier distance is 26–34 m from the centreline, with a minimum of 11–13 m [OSM].

**Main straight:**
- Pit lane and garages on the right.
- Pit wall concrete with **red/white painted kerb-style stripes on the pit-wall side apron** [FIA photo].
- Main grandstand on the left; the 8-storey "Sakhir Tower" behind the pits [K].
- Grid gates at grid positions 6 and 18, and garage 30 [FIA F2].
- Car number panels on the right of the grid.
- Floodlit (night race) [K].

**Pit lane** [FIA F2 2025 pit map]:
- **Entry:** diverges right **after T15 (the final corner)**. A gentle diverge onto a straight entry road, with SC1 at the split.
- **Exit:** the pit lane end is marked by **red/white and blue/white painted stripes** on the run-out [FIA photo]. The exit road runs on the right alongside the main straight. Practice starts on the **concrete apron on the RHS of the fast lane** [FIA]. A dotted white line across the exit.
- **Merge:** after SC2, before T1 (exact point UNCONFIRMED). A green painted strip is visible at the exit line edge [FIA photo].
- **Length:** OSM 777 m (187123422).

**Kerb colour scheme:**
- Red/white.
- Run-offs: sand/beige-coloured asphalt with red/white painted bands; some green strips.
- "**Green-striped run-offs**" (from the brief) is **UNCONFIRMED**. FIA 2025 photos show beige run-offs and only a green line at the pit exit.

---

## Sources

FIA documents (text extracted with pdftotext; photos viewed):
- [2025 Italian GP RD event notes](https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_race_directors_event_notes_.pdf); [2026 Italian GP RD competition notes](https://www.fia.com/system/files/decision-document/2026_italian_grand_prix_-_race_directors_competition_notes.pdf); [2025 Monza F2 notes v2](https://www.fia.com/system/files/decision-document/2025_monza_event_-_f2_monza_event_notes_2025_v2.pdf)
- [2025 Belgian GP RD notes](https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_race_directors_event_notes_.pdf); [2026 Belgian GP RD notes](https://www.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_race_directors_competition_notes.pdf); [2024 Spa F2 notes v4](https://fia.com/sites/default/files/decision-document/2024%20Spa%20Francorchamps%20Event%20-%20F2%20Spa%20Event%20Notes%20v4.pdf)
- [2025 British GP RD notes](https://www.fia.com/system/files/decision-document/2025_british_grand_prix_-_race_directors_event_notes_.pdf); [2026 British GP RD notes](https://www.fia.com/system/files/decision-document/2026_british_grand_prix_-_race_directors_competition_notes.pdf); [2025 Silverstone F2 notes v2 (pit map)](https://www.fia.com/system/files/decision-document/2025_silverstone_event_-_f2_silverstone_event_notes_2025_v2.pdf)
- [2025 Japanese GP RD notes](https://fia.com/system/files/decision-document/2025_japanese_grand_prix_-_race_directors_event_notes_.pdf); [2026 Japanese GP RD notes](https://www.fia.com/system/files/decision-document/2026_japanese_grand_prix_-_race_directors_competition_notes_.pdf); [2023 Japanese GP circuit map & pit drawing](https://www.fia.com/sites/default/files/decision-document/2023%20Japanese%20Grand%20Prix%20-%20Event%20Notes%20-%20Circuit%20Map,%20Pit%20Lane%20Drawing%20and%20Red%20Zone.pdf)
- [2025 Bahrain GP RD notes](https://www.fia.com/system/files/decision-document/2025_bahrain_grand_prix_-_race_directors_event_notes_.pdf); [2025 Sakhir F2 notes v2 (pit map)](https://fia.com/system/files/decision-document/2025_sakhir_event_-_f2_bahrain_event_notes_2025_v2.pdf)

Press and reference:
- Monza 2024: [the-race.com](https://www.the-race.com/formula-1/unusual-problem-f1-drivers-monza-track-changes/), [planetf1](https://www.planetf1.com/news/monza-track-changes-2024-underway); Parabolica: [grandprix.com 2014](https://www.grandprix.com/ns/ns28665.html), [grandprix.com 2019](https://www.grandprix.com/news/f1-to-re-consider-gravel-for-parabolica.html)
- Spa 2022: [racingnews365](https://racingnews365.com/the-extensive-changes-made-to-spa-ahead-of-the-2022-f1-belgian-gp), [planetf1](https://www.planetf1.com/news/spa-francorchamps-revamp-gravel), [crash.net](https://crash.net/f1/news/995572/1/spa-reintroduces-gravel-circuit-developments-continue), [oversteer48 pit guide](https://oversteer48.com/spa-francorchamps-track-layout/)
- Silverstone: [motorsport.com Copse/Stowe](https://www.motorsport.com/f1/news/f1s-austria-track-limits-solution-deployed-at-silverstone-too/10631374/), [2019 resurfacing](https://www.thepitcrewonline.net/2019/03/10/silverstone-circuit-to-be-resurfaced-ahead-of-2019-british-grand-prix/), [BikeSocial](https://www.bennetts.co.uk/bikesocial/news-and-views/news/2019/july/2019-silverstone-resurfacing-success)
- Suzuka: [Wikipedia](https://en.wikipedia.org/wiki/Suzuka_International_Racing_Course), [grandprix247 Pirelli 2026 preview](https://www.grandprix247.com/formula-1-news/pirelli-previews-the-2026-japanese-grand-prix-at-suzuka), [Aston Martin 2025 debrief](https://astonmartinf1.com/en-GB/news/on-track/the-debrief-by-aramco-2025-japanese-grand-prix)
- Bahrain: [Wikipedia](https://en.wikipedia.org/wiki/Bahrain_International_Circuit), [tracinginsights 2025](https://tracinginsights.substack.com/p/all-you-need-to-know-2025-bahrain), [the-race drain cover](https://www.the-race.com/formula-1/bahrain-grand-prix-drain-cover-problem-fix/), [ESPN barrier](https://africa.espn.com/f1/story/_/id/30441993/fia-makes-changes-bahrain-barrier-grosjean-crash), [planetf1 T4 kerb](https://www.planetf1.com/news/extra-kerb-bahrain-turn-four)
- OSM: Overpass API via https://maps.mail.ru/osm/tools/overpass/api/interpreter (© OpenStreetMap contributors, ODbL)
