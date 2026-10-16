# LanRace track surface: FIA standards, real-circuit look, F1 23 / sim rendering, three.js techniques, CC0 textures

Researched 2026-10-17. Legend: **[C]** = confirmed in the cited source; **[U]** = unconfirmed / from footage, forums or general knowledge; treat as a starting value to tune by eye.

Project context checked (read-only): three.js **0.186.1** in `node_modules`; the track today uses procedural `CanvasTexture`s (`public/js/game3d.js` `asphaltTexture()` ~l.577, `grassTexture()` ~l.621), the road strip at `repeatM: 8` (l.1501), kerbs 1.5 m × ~2.5 m stripes red `#d62828` / white `#f2f2f2` (l.1510-1551), gravel on slow corners, a 3 m catch fence at 0.22 opacity. **The road is drawn 2× real width (`WIDTH_MULT = 2`, `src/game/Track.js` l.13) and white lines at 4/3 (`LIMIT_MULT`)**: every real-world dimension below must be multiplied by `scale` and textures sized in real metres, or aggregate/kerb sizes will look wrong.

---

## 1. FIA circuit construction standards

### 1.1 Primary documents
- FIA ISC **Appendix O** (2022), PDF: https://www.fia.com/sites/default/files/appendix_o_2022_published_30.09.2022.pdf (text extracted with pdftotext, quoted below).
- FIA **Circuit Drawing Format** (18/12/12), defines the official kerb types: https://www.fia.com/file/2900/download?token=7ZCYPbld
- FIA **Artificial Grass Guidelines** (Issue 01, 29 Nov 2011): https://www.fia.com/sites/default/files/regulation/file/Guidelines_Artif%20Grass_DRAFT_2011.pdf
- FIA **Standard 3503-2019, Paints for Motor Racing Circuits** (water-based only): https://www.fia.com/sites/default/files/fia_standard_3503-2019_paints_for_motor_racing_circuits.pdf ; homologated paints list (Technical List 78: Swarco Limboroute Circuitline, Geveko Raceline, Colsam Samoline, Mapei TNS Race Track): https://www.fia.com/sites/default/files/technical_list_ndeg78_-_paints_homologated_manufacturers_v.4.pdf
- FIA Standard 3501 (barriers, TecPro listed in Technical List 71): https://www.fia.com/sites/default/files/technical_list_ndeg71_-_safety_barriers_homologated_manufacturers.pdf ; Standard 3502-2018 (debris fences).
- The detailed kerb / gravel-bed construction drawings are referenced in Appendix O ("Construction specifications of kerb designs, guardrails, concrete walls ... debris fences") but are **not public**; numbers below come from the drawing-format doc, FIA event notes and press.

### 1.2 Track, white lines, verges, run-off (Appendix O §7.3–7.7) [C]
| Item | Value |
|---|---|
| Track width (new permanent circuit) | ≥ **12 m**; width changes ≤ 1 m per 20 m |
| Starting grid width | ≥ **15 m**, kept to the exit of T1 |
| Grid length per car | ≥ 6 m; **8 m for F1** (i.e. staggered 2-wide, same-column slots 16 m apart) |
| Start line → first corner | preferably ≥ 250 m |
| Start/finish straight gradient | ≤ 2 % |
| Camber on straights | 1.5 %–3 % (drainage) |
| Banking in curves | ≤ 10 % |
| **Edge lines** | "continuous white lines ... in **anti-skid paint, minimum 10 cm wide**" on both sides; white lines are part of the track, kerbs are not (F1 sporting regs) |
| Verges | compact, **1–5 m wide**, even, no step from the track ("continuation of the transversal profile") |
| Run-off slope | ≤ 25 % up (not gravel beds), ≤ 3 % down |
| Pit lane | ≥ **12 m** wide, separated from the straight by a **pit wall and signalling platform** |
| Signs near track | ≥ 3 m from edge, no metal, expanded polystyrene ≤ 100 mm thick |
| Advertising on walls | painted or vinyl, vinyl lengths ≤ 4 m with the split on the concrete block joint; panels ≤ 150 cm long |
| Maintenance (§12) | grass trimmed, no vegetation in gravel; **gravel turned over and topped up so it sits on the same plane as the surrounding land**; repaint kerbs/lines without paint build-up; guardrail gaps rail-to-ground and rail-to-rail ≤ **4 cm**; tyres bolted tightly in piles |

Real F1 white lines are visibly wider than 10 cm at many tracks (≈ 15–20 cm [U]). The paint is a gritted, matte, slightly raised film; in wet it is lower-grip (rFactor 2 docs recommend modelling it as a separate decal 1 mm above the asphalt).

### 1.3 Kerbs
Official FIA kerb types (Circuit Drawing Format 2012) [C]:
| Type | Name | Profile |
|---|---|---|
| 1 | **"Vallelunga"** positive | progressive, **wide-ribbed** apex kerb, rising to **5 cm or 10 cm** above track level at the rear |
| 2 | **"Melbourne" / negative** | progressive wide-ribbed kerb **sinking to 5 cm (or 2.5 cm) below** track level at the rear, for corner exits |
| 3 | Bevelled | smooth incline, flat rear **5 cm** above track, apexes |
| 4 | Combination | smooth profile **80 cm wide rising to 12 cm**, installed **behind** a 5 cm Type 1 or Type 3 kerb |
| – | Kerbs "shall be outside the track edges" | |

Other kerb numbers:
- Width: typical **1.0–1.5 m**; Misano-type FIM/F1 kerb 1.5 m, with **-50 mm** negative drop at its outer end (GPOne 2023: https://www.gpone.com/en/2023/08/25/motogp/end-of-controversy-over-the-green-new-kerbs-at-marco-simoncelli-and-jerez.html ) [C-press]. A 2015 FIA proposal: upper step 25 mm below track, lower step 50 mm below (two-tier negative kerb) [C-press, via Charlie Whiting quotes].
- Forum (unverified) rule of thumb: apex kerb rises 0 → 50 mm over the first 400 mm then flat; exit kerbs 50–100 mm "ripple"; negative kerbs 25–50 mm ripple (TenTenths thread https://tentenths.com/forum/showthread.php?t=122999 ) [U].
- **Sausage kerbs**: ~**50 mm** tall bolted rounded humps (Yas Marina T20 2018 "50mm high kerb"; Spa Eau Rouge 50 mm steel "Abu Dhabi" kerb behind a 50 mm positive kerb; Sochi domed 50 mm sections) — https://us.motorsport.com/f1/news/paint-crumbling-kerb-abu-dhabi/4304505/ ; usually **yellow** (Paul Ricard T2 exit "yellow sausage kerbs": https://the-race.com/formula-1/fia-rejects-requests-to-remove-controversial-french-gp-kerb/ ) [C]. Length per element ≈ 1–2 m, laid in a dashed row [U].
- **Double kerb + gravel strip** (the post-2023 track-limits fix): Red Bull Ring 2024 — **2.5 m gravel strip directly behind the exit kerb** at T9/T10, white lines moved so line→gravel < 2 m (1.8 m at T1/3/4/6). A **blue line** next to the white line for camera AI. https://www.fia.com/news/f1-ringing-changes-how-fia-finding-limit-red-bull-ring-thanks-key-circuit-updates [C]. Monza 2024 added "combination" raised kerbs at T1/2/4/5 and narrow gravel strips beyond (RaceFans, The Race) [C].
- Qatar 2023: kerb inner edges ~50 mm sharp points, later shaved flatter (motorsport.com) [C].
- Stripe/block length: red/white blocks are typically ~1 m long at modern tracks (the current game uses ~2.5 m) [U — measure from a reference photo; F1 23 shows ~1 m blocks at most tracks].
- Kerb surface: painted concrete (FIA definition "a concrete form") with gritted anti-skid FIA-3503 paint; edges get black tyre-rubber smears and paint chips on the inner edge; serrations/ribs read as dark lines in the paint [C definition / U appearance].
- Colours by circuit [mostly U, from broadcast footage; verify per track]: red/white is the default (Monza confirmed by Mark Hughes: "red and white stripey kerbs, green grasscrete just beyond, rubbered-in black line on dark grey asphalt" https://www.autosport.com/motorsport/feature/1262/mark-hughes-f1-inside-line [C]); **yellow** for sausage / secondary deterrent kerbs [C]; **orange** kerb element at Paul Ricard (FIA 2019 event notes) [C]; green/white used for the painted pit-entry area at Jeddah (FIA event notes) [C]; Lusail 2024 repainted kerbs/run-off in "Sadu-inspired" colours (Mapei project page) [C]; national-flag colours at some tracks (e.g. green/white/red Monza-style or Mexico) [U]; Silverstone changed its kerb colours in 2016 (Codemasters had to update at the last minute: https://gamedeveloper.com/design/q-a-building-tracks-and-tracking-tires-in-i-f1-2016-i- ) [C that it changed].

### 1.4 Run-off surfaces
- **Asphalt run-off** (most common modern style), often **painted** in bands. **Paul Ricard**: blue zone = asphalt + tungsten, abrasive; red zone = deeper, more abrasive, high grip / extreme tyre wear — https://en.wikipedia.org/wiki/Circuit_Paul_Ricard [C]. Blue/red diagonal stripe bands are ~2–4 m wide [U].
- **Green-painted asphalt / grasscrete** beyond kerbs (Monza "green grasscrete" [C]); FIA drawing layers include `F1_VERGE_GRASSCRETE` and `F1_VERGE_ARTIFICIAL_GRASS` [C].
- **Artificial grass (Astroturf)** strip behind kerbs (FIA guideline) [C]:
  - polyethylene blades on polyester scrim, rolls ≥ **0.9 m** wide; **≥ 68 000 blades/m²**; blade height **17–22 mm**;
  - laid width ≥ **1.8 m**; on ≥ **15 cm poured concrete**, top set **±5 mm below** the adjacent track edge / kerb so a wheel never catches the leading edge; glued (2-part PU) and rolled.
  - Look: uniform saturated green (more blue-green and more even than real grass), very low specular, visible roll seams every ~0.9–4 m [U].
  - Spa removed all astroturf in 2020 (replaced with asphalt) [C, RaceFans].
- **Gravel traps**: no public FIA grading found. Vehicle-arrester research: best = **rounded, uncrushed, single-size ~5–10 mm** gravel (rounded river gravel decelerates more than crushed) — https://www.codot.gov/programs/research/reports/2008/arresterbeds.pdf [C for road arrester beds; U for F1]. F1 traps look like **rounded pea gravel, 5–16 mm, beige / light grey / off-white** (Monza, Silverstone light beige-grey; Bahrain/Abu Dhabi near white; Suzuka & Spa grey-beige) [U]. Depth commonly quoted ~250–300 mm [U]. Edges: gravel meets grass or asphalt in a slightly raised, wavy lip; raked surface with tyre furrows where cars went through; stones scattered onto the asphalt 1–3 m from the edge [U, footage]. Maintained level with the surrounding land [C §12.12].
- **Grass verges**: mown turf, typically striped by the mower in 1–3 m bands (alternating light/dark) [U]; kept trimmed, no dry grass [C].

### 1.5 Barriers and fences
| Barrier | Numbers |
|---|---|
| **Concrete wall** (`F1_WALL`) | precast blocks; joints define the 4 m max vinyl advert lengths [C]; height ~1.0–1.2 m (street circuits), often with debris fence on top [U] |
| **Guardrail / Armco** (`F1_GUARDRAIL`) | W-beam rail **310 mm** tall per beam (product listing https://firstfence.co.uk/3200-armco-kit ); double or **triple** stacked, **≤ 4 cm** gaps rail-to-rail and rail-to-ground [C App O §12.3] → triple rail ≈ 0.95–1.0 m tall; galvanised grey, often wrapped in advertising vinyl that follows the corrugations [C]; metal posts mandatory on circuits licensed from 2019 [C] |
| **Tyre wall** | touring-car tyres of uniform diameter, stacked ≥ **1 m** high, bolted into **5- or 6-tyre packs**, strapped to a wall/guardrail; F1: **conveyor belt across the face** (black rubber, often with sponsor wrap), belt buried ~**8 in (200 mm)** into the ground so cars can't dive under — ASN bulletin https://aimss.com.au/news/asn-safety-bulletin-41-tyre-barriers ; https://islandmotorsportcircuit.com/the-track/safety-requirements/ [C]. FIA layers: 1 row / 2 rows / + tube inserts / + belt |
| **TecPro** | modules ~**1.5 m long × 1.2 m high × 0.6 m deep, 120 kg** (TecPro brochure / grandprix.com 2006: https://www.grandprix.com/news/new-barriers-used-at-monza.html ); Wikipedia says 1.2 m high × 1 m wide. HDPE shell + foam core, linked by straps/couplers [C]. Colour: **not documented** — commonly blue, red, white and yellow blocks, often wrapped in circuit/sponsor livery (F1 23 renders them with branding) [U] |
| SAFER barrier | steel tube face + foam, ovals (Indianapolis); not typical at F1 road courses except Indy history [U] |
| **Debris / catch fence** | typically **3.5 m** tall; posts at max **4 m** spacing; FIA-homologated Geobrugg fence **6 m** tall, posts at 6 m, **16 mm** cables, wider cable spacing above 3 m (Standard 3502-2018) — https://www.planetf1.com/news/fia-circuit-safety-change-f1-2025-season ; https://pmw-magazine.com/news/safety/new-track-debris-fencing-gets-fia-approval.html [C]. Look: galvanised posts (often curved inward at top), 3–5 horizontal tension cables, fine diamond/ring mesh nearly invisible at distance |
| **Pit wall** | concrete wall + signalling platform (gantries for team stands) with a debris fence on top [C structure, U height: wall ~1.0–1.2 m, fence to ~3–4 m] |

### 1.6 Pit and grid markings
- Pit exit: **solid white line**; no part of the car may cross it; side varies per event. Pit entry: **bollard** (keep on its side) or solid white line; the **painted area between pit entry and track** is red/white (most events) or green/white (Jeddah 2022) hatched; **dotted lines across pit entry/exit mouths** mark the track edge. FIA event notes, e.g. https://www.fia.com/sites/default/files/decision-document/2022%20Bahrain%20Grand%20Prix%20-%20Event%20Notes.pdf [C].
- Pit lane: ≥ 12 m [C]; surface often different asphalt or concrete, lighter grey, with a white fast lane / working lane division line, yellow speed-limit lines at the limiter start/end and painted garage boxes [U appearance].
- Grid: 8 m per car staggered [C]; each slot painted as a white "bracket" (front bar + short side arms) with the position number on the tarmac; the start line is a full-width white line, often with a chequered pattern for the finish line [U appearance]. Track width at the start line ≥ 15 m [C].

---

## 2. How real F1 asphalt looks

- **Mix**: stone-mastic / polymer-modified asphalt with high-PSV aggregate, **6 mm or 10 mm nominal** stones (Breedon Track: https://www.breedongroup.com/content/dam/breedon/corporate/documents/products-services/gb/asphalt-2025/breedon-track.pdf.downloadasset.pdf ) [C]. Macrotexture ~**0.7 ± 0.3 mm** (generic surfacing standard) [C/U]. Visual: grey-white stone chips (granite, porphyry, greywacke, basalt) in a dark binder; from 2+ m away it reads as a fine salt-and-pepper speckle.
- **Colour**: fresh asphalt is **darker and smoother** with bitumen/oil on top (Pirelli: "darker in colour", track temps past 50 °C; Paul Ricard new patch "more bitumen and more oil, less grippy") — https://f1technical.net/news/25352 , https://au.motorsport.com/f1/news/pirelli-new-track-surface-speed-gains/4340294/ [C]. Aged asphalt (2–5 years, sun-oxidised binder, exposed aggregate) is **mid-to-light grey** (albedo ≈ 0.12–0.20 vs 0.05–0.08 fresh) [U, typical pavement albedo]. Off-line asphalt is lighter and dustier than the line.
- **Patch seams**: resurfaced sections end in straight cross-track joints or longitudinal paver joints (lanes ~4–6 m wide); repaired patches are rectangles of darker, smoother asphalt; sealed cracks show as thin dark tar lines [U, footage]. Monza 2021 pit-straight resurfacing made the main straight a different colour/texture to the rest [C, motorsport.com].
- **Rubbered racing line**: one or two dark bands about a car-track wide (F1 track width ≈ 1.6 m front / per-tyre bands ≈ 0.3–0.4 m), darkest and widest **in braking zones** (heavy deposition from locked/slipping tyres) and **at apexes/corner exits** (wheelspin, lateral slip). On straights the line fades to two faint tyre-width tracks [U]. Rubber deposits as thin layers; thick layers crack and peel; rubber bonds poorly to concrete — https://buildingspeed.org/2016/08/05/how-tracks-take-and-lose-rubber/ [C]. The line is also **polished**: smoother → different specular (rFactor 2: groove texture alpha drives specular) [C].
- **Marbles**: pellets of rubber 1–10 mm thrown **off line, on the outside of corners and on exits**, building through the race; matte black dots/clumps; cars on the line keep it clean [C mechanism, U sizes]. Rain physically scrubs rubber off [C].
- **Skid / lock-up marks**: long dark streaks parallel to the direction of travel **into braking zones** (lock-up flat-spot streaks, often single-wheel, 5–40 m long, start sharp and fade); curved black arcs at apexes/exits (wheelspin, slides); "doughnut" circles near the finish/pit exit from celebrations [U, footage]. rFactor 2 bakes these as "horizontal lines" in its RaceGroove texture mapped along the racing-line spline [C].
- Other surface stuff: oil-dry (white cement dust) patches after a car drops oil, gravel/dirt dragged onto the track at exits of gravel traps, painted sponsor logos on run-off, the DRS detection/activation lines (white cross lines) [U].

---

## 3. How F1 23 (and other sims) render it

**F1 23 / EGO** — public info is thin; no GDC talk on track surfaces exists. What is confirmed:
- EGO 4.0 engine; PBR + image-based lighting for tracks since F1 2018 (GTPlanet dev diary https://www.gtplanet.net/f1-2018-final-pre-release-dev-diary-focuses-on-audio-and-visual/ ); F1 2019 introduced scan-based tarmac that "improved light response" [C].
- F1 23 PC: ray-traced shadows, reflections, AO and DDGI (https://overclock3d.net/reviews/software/f1_23_pc_performance_review_and_optimisation_guide/ ) [C]; F1 25 added path tracing (GDC 2026 "EA Sports F1 25: Path Tracing at 200mph", https://gdcvault.com/play/1035693/EA-Sports-F1-25-Path ) [C].
- Track capture: photographers shoot circuits, FOM/circuit CAD gives widths, kerb positions etc. (F1 2016 Q&A link above); F1 22 rebuilt Melbourne from LiDAR; F1 25 rebuilt Bahrain, Miami, Melbourne, Suzuka, Imola from FOM LiDAR (https://www.gtplanet.net/f1-25-lidar-scanned-tracks-reverse-circuits-new-customization-features-audio-upgrades/ ) [C].
- Earlier Codemasters description of their track-surface module: "rubber from the tyres, occasional stones, marbles, water (from standing water through to a drying track) and all the associated properties of grip and heat" (Guru3D, undated) [C text, U which game].
- F1 23 game files are ERP archives (Ego ERP Archiver) [C]; no public documentation of the track material layers found.

Observed F1 23 look (from gameplay/replays) [U]:
1. Base asphalt: photo-scanned, mid grey, fine aggregate, **strong micro-normal sparkle in low sun**, roughness ~0.6–0.75 dry; a large-scale (tens of metres) tonal variation layer kills tiling.
2. A baked, hand-authored **racing-line groove** decal layer (darker, slightly glossier) with tyre streaks along the line, heaviest in braking zones; brake/lock-up streaks baked as decals.
3. Off-line dust/marbles layer; marbles appear dynamically through a race as dark specks outside the line.
4. Patch / seam decals, sealed cracks, painted logos, paint decals for lines with worn edges and tyre-rubber overrun on the inner edge of white lines and kerbs.
5. Wet: puddle mask + reflection; a **dry line** appears along the racing line as rain stops.
6. Kerbs are real modelled geometry with ribbed profiles and dirt/rubber on the inner edge; astroturf strips have a fine fibre normal map and are distinctly blue-green.

**rFactor 2 RealRoad** (best public documentation of a sim road shader) — https://www.studio-397.com/wp-content/uploads/2016/12/rF2_Track_Technologyv3.pdf [C]:
| Stage | Map | UV | Role |
|---|---|---|---|
| 1 | diffuse (with alpha) | ch1 | road texture; **alpha = specular amount, inverted alpha = wetness (cracks fill with water first)** |
| 2 | detail ("multi") map | ch2 | asphalt detail, **tiling ~2 m × 2 m** |
| 3 | normal | ch1 | **keep subtle**: bumps look like mountains in low sun; blur larger dips |
| 4 | **RaceGroove** | ch3 (spline-mapped along the racing line) | rubber laid by track activity, revealed by grip level; **multiplicative RGB (don't go too dark), alpha = specular**; contains skid marks as lines |
| 5 | specular | ch2 | pronounces detail map in sun |
| 6 | **Marbles** | ch2 | rubber bits/debris off line |
| 7 | reflection | live | wet reflection |
Also: painted lines as separate decal meshes 1 mm above the road (different wet grip); terrain blending between materials via **vertex alpha lerp** of two textures + shared detail maps.

**ACC (UE4)**: track evolves with car count, rubber & marbles increase; wet fully dynamic; **ideal line dries faster**; marbles have visual and audio cues; SSR for wet — https://www.unrealengine.com/en-US/developer-interviews/assetto-corsa-competizione-leans-into-realism-to-create-the-ultimate-racing-sim [C].
**iRacing**: dynamic track (rubber, marbles, temperature) is simulated but visually only marbles are clearly shown; rubber line is largely baked [U].

Takeaway for LanRace: real sims use **(a) baked groove texture in racing-line space + (b) a scalar "rubber/grip level" that fades it in**, not a fully painted per-lap accumulation. Dynamic marks (skids) are separate decals.

---

## 4. Rendering techniques for three.js r186 WebGPU (TSL)

All the following TSL functions exist in local three 0.186.1 (`node_modules/three/src/Three.TSL.js`): `texture`, `textureBicubic`, `triplanarTexture(s)`, `positionWorld`, `normalMap`, `bumpMap`, `parallaxUV`, `mx_noise_float`, `mx_fractal_noise_float`, `mx_worley_noise_float`, `hash`, `rand`, `remap`, `smoothstep`, `storageTexture`, `textureStore`, `textureLoad`. `examples/jsm/geometries/DecalGeometry.js` is present. TSL docs: https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language

**4.1 Tiling removal** (needed: the asphalt sits under a low camera across kilometres)
- **Macro/detail blend** (cheapest, biggest win): sample the asphalt at 2–4 m repeat; multiply albedo by a low-frequency world-space noise (`mx_fractal_noise_float(positionWorld.xz / 40, 3)` remapped to 0.85–1.15) and lerp roughness ±0.08. Add a second sample of the same texture at ~0.37× scale rotated 30°, blended 30–50 %, to break the grid at distance.
- **Inigo Quilez "technique 3"** (noise-indexed offsets, 2 texture reads + 1 noise): https://iquilezles.org/articles/texturerepetition/ — use a small noise texture or `mx_noise_float`; compute derivatives from the unperturbed UV (`textureGrad` / `.grad()`) to keep mips correct. Lygia port: `sample/untile`.
- **Hex-tiling** (Mikkelsen 2022, "Practical Real-Time Hex-Tiling", JCGT 11(3)) — 3 reads, best quality: https://jcgt.org/published/0011/03/05/paper.pdf ; Heitz & Neyret histogram-preserving blending (2018) is the original.
- Fade detail and normal intensity with distance (`smoothstep(30, 150, distance)`) to avoid moiré/sparkle; at far distance use the 1k mip and macro noise only.

**4.2 UVs**
- Road/kerb/verge strips: **track-space UVs** (u = lateral metres from centreline, v = lap distance metres, both ÷ real scale). The strip already follows `rp`; this enables kerb stripes, racing-line groove, skid layers with zero projection cost. Watch v seams at the lap wrap; use `fract(v / L)` only for the groove lookup.
- Open ground (grass, gravel, run-off): **world-space planar** `positionWorld.xz / tileM`; triplanar only on banks/cuttings (`triplanarTexture`, 3× cost) — flat ground doesn't need it.

**4.3 Seam-free edges (asphalt / kerb / astroturf / grass / gravel)**
- Keep the geometric strips but **blend in the shader** using a distance-to-edge value (from track-space u) perturbed by noise: `mask = smoothstep(edge-0.15, edge+0.15, u + 0.3*noise(worldXZ*0.5))`.
- **Height-based blend** (gravel stones poke over grass): `blend = saturate((hA - hB + mask*2-1) / 0.1)` using each material's displacement map. Classic UE/Unity terrain trick.
- Add a dirt/dust ring: 0.5–2 m of darker brown on grass next to gravel, lighter dust on asphalt beside gravel exits; scattered stone decals on the asphalt near gravel.
- rFactor 2 used vertex-alpha lerp for the same; works in three via a vertex colour attribute.

**4.4 Racing-line rubber (groove)**
- Data already exists: `track.racingLine` (sent in `game_init`) and per-point safe speeds. Build a 1-D **DataTexture along lap distance** (e.g. 4096 × 1, RG = line lateral offset, intensity) where intensity = f(braking decel, lateral g). In the road shader: `g = exp(-pow((u - lineU(v)) / w, 2))` with w ≈ 0.6–1.2 m (two tyre bands: offset ±0.8 m), modulated by a streaky noise stretched 20:1 along v. Effect: albedo × (1 − 0.35·g), roughness −0.1·g (rubber polish), normal intensity −30 %·g.
- "Build-up over laps": one uniform `rubberLevel` 0..1 rising with total laps driven in the session (cheap, matches what sims show).
- Marbles: `(1-g) * outsideOfCorner * worleyNoise` dark dots, growing with race distance.

**4.5 Persistent dynamic skid marks**
- Option A (recommended, scales to a full race): a **track-space render target** e.g. 8192 × 128 (lap length × road width; for a 5.8 km lap ≈ 0.7 m/px along, ~0.25 m/px across — tile it: 4× 4096×256 or use a 2-D wrap of the lap into rows). Each frame stamp short quads for any sliding wheel with an orthographic camera into the RT with `autoClear = false` (WebGL2 and WebGPU both support this; no ping-pong needed for additive/alpha-over blending). Road shader samples it in track UV. In WebGPU, a compute pass with `textureStore` into a `storageTexture` is the alternative. MonoGame discussion of the same pattern: https://community.monogame.net/t/solved-leaving-footprints-and-wheel-tracks/8147
- Option B: **instanced ribbon decals** (pooled, ring buffer of N≈2–4k segments, laid 1–2 cm above the road, `polygonOffset`). Simpler, fine for short sessions; fade oldest.
- `DecalGeometry` (examples/jsm/geometries/DecalGeometry.js, demo https://threejs.org/examples/webgl_decals.html ) is for projecting onto arbitrary meshes — overkill for a flat road; use it only for one-off decals on walls/kerbs.

**4.6 Filtering, normals, sun glint**
- `texture.anisotropy = renderer.getMaxAnisotropy()` (16 on most GPUs) on every ground texture — the single most important setting for grazing-angle asphalt; currently `Q.anisotropy` (asphalt) and fixed 8 (grass).
- Mip bias: slightly negative (−0.25 to −0.5) on asphalt albedo only if it looks blurry at grazing angles with 16× AF; otherwise leave 0. In TSL: `texture(t, uv).bias(-0.3)`.
- **Asphalt normal map** at 0.4–0.7 strength with roughness 0.55–0.75: gives the glittering sun-glint "sheen" toward the sun seen in F1 23. Fight specular aliasing with roughness from normal variance (Toksvig) or simply raise roughness with distance. Rubbered line slightly lower roughness.
- Line paint: roughness ~0.5, slightly brighter specular, gritted normal; wet = darker, glossier.
- **Parallax for gravel**: `parallaxUV(uv, scale)` (cheap single-step offset) with the gravel displacement, scale ≈ 0.02–0.04; full POM is too costly for big areas. Better value: height-blend at edges + a good normal + AO map.
- Bicubic (`textureBicubic`) only for low-res data textures (groove/skid RT) to avoid blocky texels.

**4.7 Asset delivery**
- Poly Haven 2k JPGs are 3–6 MB each (max-quality). Re-encode to **KTX2/Basis (UASTC for normals, ETC1S for albedo)** with `KTX2Loader` (`examples/jsm/loaders/KTX2Loader.js`) or WebP at 1k–2k; use the packed **ARM** map (AO/Rough/Metal in RGB) to cut fetches. Budget: asphalt 2k (diff, nor, arm), everything else 1k.

---

## 5. CC0 texture picks (all CC0; Poly Haven ids verified via api.polyhaven.com, ambientCG via its v2 API)

Poly Haven URLs: page `https://polyhaven.com/a/<id>`; files `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/<res>/<id>/<id>_<map>_<res>.jpg` with map ∈ `diff, nor_gl, rough, ao, disp, arm` (verified for `asphalt_track`). Real-world size in `dimensions` (mm). Licence CC0: https://polyhaven.com/license
ambientCG: page `https://ambientcg.com/a/<id>`, zip `https://ambientcg.com/get?file=<id>_2K-JPG.zip` (verified redirect); maps Color, NormalGL, Roughness, AmbientOcclusion, Displacement (+Opacity for fences); licence CC0 https://docs.ambientcg.com/license/

| Use | Pick (id) | Res | Maps | Real size | Why |
|---|---|---|---|---|---|
| **Race asphalt (main)** | PH `asphalt_track` | 1k–8k | diff, nor_gl, rough, ao, disp, arm | 2 × 2 m | tagged "race track"; fine-grained tarmac, subtle aggregate, low gloss, weathered; diff 2k 3.8 MB |
| Light grey aged asphalt | PH `asphalt_02` | 1k–8k (also rough_ao) | diff, nor_gl, rough, ao, disp, arm | 3 × 3 m | weathered grey gritty aggregate; good for older circuits/run-off; has tar cracks (mask them out or use as variation) |
| Light grey alt. | aCG `Asphalt031` | 1k–8k | Color, NormalGL, Roughness, AO, Disp | n/a | "grey, light, stone": light aged look |
| Fresh/dark asphalt, patches | PH `clean_asphalt` | 1k–8k | full set | 2.1 × 2.1 m | clean dark grey fine grain, even tone (has a faint seam line: use as patch) |
| Pit lane | PH `asphalt_pit_lane` | 1k–8k | full set | 2 × 2 m | literally a pit-lane tarmac scan with subtle tyre wear |
| Worn/rubbered asphalt | PH `road_damaged_clean` (dark, pitted) or tint `asphalt_track` in-shader | 1k–8k | full set | 2.2 × 2.2 m | better to derive the groove procedurally (sec. 4.4); no CC0 "rubbered line" texture exists |
| Wet asphalt reference | aCG `Asphalt025C` | 1k–8k | std | – | wet/rain variant for tuning |
| Painted line wear | aCG `Road007` (dashed lane markings on asphalt) | 1k–8k | Color, NormalGL, Roughness, Disp | 7.5 × 7.5 m | crop its line as a wear mask; or Poly Haven `concrete_floor_painted` / `painted_concrete_02` roughness+normal for gritted paint |
| **Kerb paint on concrete** | PH `painted_concrete_02` (16k max) or `concrete_floor_painted` | 1k–16k | full set | 4 m / 2 m | worn painted concrete: use its normal/rough/AO, multiply albedo by red/white stripe mask; chips reveal concrete |
| **Grass (mown turf, top-down)** | aCG `Grass004` (dense lawn, short) | 1k–8k | Color, NormalGL, Rough, AO, Disp | 1.4 m | clean lawn; best for verges. Alt aCG `Grass001`/`Grass005` |
| Grass, worn near gravel | PH `grass_ground` (16k) / `sparse_grass` | 1k–16k | full set (+Mask) | 2.5 m / 2 m | soil showing through: use at edges / dirt ring |
| **Artificial turf** | none on either site as true astroturf; use aCG `Grass004` normal at 2× tiling, desaturate+shift to blue-green (#2f7d4f-ish), roughness 0.85, plus a fibre stripe noise | – | – | – | FIA: 17–22 mm blades, very uniform; procedural is fine |
| **Gravel trap (rounded, beige/grey)** | PH `dry_river_pebbles` | 1k–8k | full set | 2 × 2 m | "rounded stones and gravel beige to charcoal, dusty matte": closest to F1 pea gravel. Scale down ~0.5× so stones read 5–15 mm |
| Gravel, light beige | aCG `Gravel038` ("beige, light") / `Gravel023` ("bright, white pebbles") | 1k–8k | std + AO | 1.5 m | Bahrain/Abu Dhabi light traps |
| Gravel, grey | PH `gravel_floor_02` / aCG `Gravel035` (grey riverbed) | 1k–8k | full | 2 m / 1.9 m | European grey-beige traps (Spa, Suzuka) |
| **Concrete wall/barrier** | PH `concrete_wall_004` (worn painted concrete wall) | 1k–8k | full | 2 × 2 m | dry flat surface, mottled stains — street-circuit blocks; alt aCG `Concrete034` (light smooth, 1k–16k) |
| **Tyre rubber** (tyre walls, belt) | aCG `Rubber004` (black rubber) or PH `rubberized_track` normal+rough (ignore its red-brown albedo) | 1k–8k | full | 0.75 m / 2 m | grain for the conveyor belt; tyre sidewalls better as a simple procedural |
| **Chain-link / debris fence (alpha)** | aCG `Fence006` / `Fence003` (wire mesh) | 1k–8k | Color, NormalGL, Rough, Metalness, **Opacity** | – | real alpha mesh; use alphaTest + mip-preserving coverage (or `alphaToCoverage: true` with MSAA) to avoid it vanishing at distance |
| **Sand** (Bahrain, Jeddah, desert run-off) | PH `aerial_sand` (15 m × 15 m, rippled) / aCG `Ground054`, `Ground080` | 1k–8k | full | 15 m | large real size = little tiling |
| Guardrail metal | PH `blue_metal_plate` / `metal_plate` for normals/roughness; galvanised albedo procedural | 1k–16k | full | – | Armco is best as a modelled W-profile with a galvanised colour + vinyl texture |

Notes:
- All JPG sizes above are high (diff 2k ≈ 3–5 MB). Convert to KTX2/WebP before shipping (sec. 4.7).
- Poly Haven `nor_gl` = OpenGL convention (what three.js expects); avoid `nor_dx`.
- Tile with real size: `repeat = trackMetres / dimensionsMetres`, then multiply by `scale` for LanRace world units.

---

## 6. Prioritised recommendations (for the implementer)

1. Replace the canvas asphalt with `asphalt_track` (2k diff/nor_gl/arm) in a node material, world/track-space UV at its true 2 m size, **anisotropy 16**, plus macro noise + a second rotated sample (sec. 4.1). Biggest visual gain.
2. Racing-line groove from the existing racing line + braking intensity (sec. 4.4); a session `rubberLevel` uniform. Darker + slightly glossier, streaky along v; strongest in braking zones and apexes.
3. Kerbs: real profiles (Type 1 positive 50 mm ribbed at apexes, Type 2 negative at exits), **~1 m red/white blocks**, painted-concrete normal/rough, rubber smears on the inner edge; yellow 50 mm sausage elements at chicanes; white edge line ≥10 cm (draw ~15–20 cm), gritted paint roughness ~0.5.
4. Beyond the kerb: 1.8–2.5 m astroturf or green-painted strip at selected corners, then asphalt run-off (optionally Paul Ricard blue/red stripes) or a 2.5 m gravel strip (Austria-style) or full gravel trap with height-blended, noise-perturbed edges and stones scattered on the asphalt.
5. Barriers per FIA: triple-rail Armco ≈ 1 m tall (3 × 310 mm, ≤4 cm gaps), tyre walls ≥1 m in bolted packs with a black conveyor-belt face, TecPro 1.5 × 1.2 × 0.6 m blocks in colour/livery, concrete walls with joints every ~4 m (ads split on joints), debris fence 3.5 m (6 m at high-risk), posts ≤ 4 m apart, 3–5 cables + alpha mesh.
6. Persistent skid marks in a track-space render target (sec. 4.5); marbles as a noise layer off-line that grows with race distance.
7. Grid: 8 m stagger, white bracket slots, 15 m+ wide start area; pit lane 12 m, solid white exit line, pit entry painted hatch, dotted lines across the mouths.
