# Circuits B: Interlagos, COTA, Zandvoort, Spielberg, Montreal (trackside detail research)

Compiled 2026-10-17. The most authoritative sources are the **FIA Race Director's event/competition notes** for the latest event at each circuit: 2025 São Paulo, 2025 United States (the 2026 races have not run yet), 2026 Austrian, 2026 Dutch and 2026 Canadian. I also used the "Changes to the Circuit" sections from the 2023–2025 notes, the FIA pit lane drawings (I rendered them and read them visually), and a fresh OpenStreetMap Overpass pull (mail.ru mirror).

Confidence tags:
- **[FIA]** is quoted or paraphrased from an FIA document.
- **[OSM]** is measured from OpenStreetMap geometry.
- **[web]** comes from a press or circuit source.
- **[unconf]** is from memory or inference, or comes from sources that conflict. Check these against onboard footage or aerials before building.

Raw material is kept beside this file:
- `research/osm/*.json`: Overpass dumps, with bounding boxes listed below.
- `research/osm/fia/*.pdf|txt`: FIA notes and maps.
- `research/osm/fia/img/pit*.png`: pit lane drawings.
- `research/osm/corners.txt`: every OSM barrier and gravel way, with its nearest corner and its distance from the centreline.
- The scripts are `near.py`, `corner.py`, `side.py` (per-corner left/right ray casts), `pit.py` and `chain.py`.

How the OSM distances work: `side.py` casts perpendicular rays from the OSM raceway centreline every ~15 m. It reports the nearest barrier on each side, minus an assumed half-width (Interlagos 6.5, COTA 7.5, Zandvoort 6, Spielberg 6.5, Montreal 6 m). The result is an *approximate distance from the track edge*. OSM centrelines are hand-drawn, so expect ±3 m error.

---

## 0. OSM data availability: verdict per circuit

Overpass bounding boxes (S,W,N,E):
- interlagos: -23.712,-46.706,-23.694,-46.689
- cota: 30.124,-97.646,30.146,-97.624
- zandvoort: 52.382,4.534,52.396,4.552
- spielberg: 47.214,14.756,47.230,14.773
- montreal: 45.494,-73.534,45.514,-73.516

Every count below is filtered to within 80–120 m of the circuit raceway ways.

| Circuit | Gravel / run-off polygons | Barrier lines | Kerbs | Pit lane | Verdict |
|---|---|---|---|---|---|
| **Interlagos** | **None.** There are no gravel, sand or surface areas. There are 36 `landuse=grass` polygons, plus one `area:highway=raceway` multipolygon (an outline of the track surface). | 63 `barrier=fence` (13.8 km; these are probably the debris fences, sample 189535494, 189535514). 7 `barrier=wall` (1.2 km, e.g. 191577961 on the Curva do Sol to Reta Oposta, 16258555 behind the main straight). **No guard_rail or tyre tags.** | none | way 33779109 (1379 m including the entry and exit roads) | **Poor.** You cannot place gravel automatically. The fence lines can stand in for the barrier line, but they are untyped. Corner ways are well named and numbered (`raceway:corner_number` 1–15). Run-off needs manual authoring. |
| **COTA** | 16 `area=yes surface=gravel` + 1 `natural=sand surface=gravel` (6.5 km of perimeter, ids 460658869–460658885). They all carry a fixme: "was previously tagged natural=shingle". | 58 `barrier=guard_rail` (11.9 km, e.g. 460666309, 460683348). The tag is undifferentiated: it is probably used for all barrier lines, walls included. 1 `barrier=wall` (460666308, 430 m, the pit wall). 13 fences (6.1 km). | none | way 514836373 (950 m) | **Usable with review.** The gravel polygons and barrier lines exist for every corner, but they date from about 2017. They do **not** reflect: the narrower Turn 2 gravel (2023), the resin-bound gravel at Turn 11 (2024), the 1.5 m asphalt and synthetic turf verges at Turns 6, 13, 14 and 15 (2024), or the new TecPro (2024). Some polygons, such as the one near Turn 12, may be wrong today, because the Turn 12 run-off is asphalt [web 2025]. |
| **Zandvoort** | 8 `natural=shingle` = gravel traps (2.8 km, e.g. 473906388 Tarzan, 484350710 Scheivlak, 484397692 Turn 13). There are also `natural=sand` areas (dunes). | 17 `barrier=guard_rail material=tyres` (2.8 km, e.g. 1318064312 Hugenholtz, 1318983056 Luyendyk). 2 `barrier=tyres area=yes`. 1 concrete wall (1030809336, 459 m, the pit wall). 45 fences (9.7 km), some tagged `material=steel` or `fence_type=guard_rail`. | **29 `barrier=kerb kerb=sloped material=concrete` (1.47 km)**, e.g. 1318064314 at Hugenholtz and 1318852318 at the Hans Ernst chicane. These are real race kerbs. | way 38144527 (759 m) | **Best of the five.** The data is recent (way ids from 2024) and covers gravel, tyre barriers and kerb polylines. It is suitable for automatic placement. |
| **Spielberg** | 13 `natural=shingle` = gravel (5.1 km, e.g. 822592394, 604635634, 1186028535). | 47 `barrier=wall` (6.8 km, e.g. 1187843395 = pit wall, 667 m, and 1187843363 on the T3–T4 straight). 25 `barrier=tyres` (2.3 km, e.g. 1187845209, 1187843397). 1 fence `height=2.5`. | none | way 289111668 (1000 m) | **Good.** Walls, tyre rows and gravel are recent (2024 ids). The 2024 2.5 m gravel strips behind the T9 and T10 exit kerbs are probably missing, so add them by hand. Some corner names are old sponsor names (see §4). |
| **Montreal** | Correctly almost no gravel. There are 17 grass polygons (e.g. 433296936) and a beach area. | **23 `barrier=jersey_barrier material=concrete` (5.1 km)** + 12 `barrier=yes` (1.4 km), e.g. 1203890651 (731 m) and 1182298209. They sit about 0–3 m from the track edge, covering 86% of the left side and 70% of the right. 1 `guard_rail material=concrete` (1203890645). Fences 2.3 km. | 15 `barrier=kerb kerb=rolled` ways, but these are **road kerbs** (tagged `tactile_paving`), not race kerbs. | way 413000959 (827 m) | **Good for walls; nothing else.** The whole circuit is a single raceway way (136717490), so it has no corner split. Use the concrete barrier lines directly. The run-off is grass or asphalt by default. |

Overall: Zandvoort, Spielberg and Montreal are good enough to place barrier lines automatically, and Zandvoort and Spielberg also for gravel. COTA is usable after a manual pass, because its data is about 2017 vintage. Interlagos needs hand authoring.

---

## 1. Interlagos (Autódromo José Carlos Pace), São Paulo GP

- 4.309 km [FIA 2025 map], 15 turns, run anti-clockwise.
- Track: fully resurfaced in 2024 together with the pit lane [FIA 2024]. Partly resurfaced again in 2025, **T12→T1 and T3→T4**, with grooving at T2, from the pit exit road to T4, on the straight after T5, between T11 and T12, and from the start line to grid slot 21 [FIA 2025]. So in 2025/26 the asphalt is new and dark on the main straight and the Senna S, with visible drainage grooves.
- Kerbs: repainted for 2024 in **Brazilian-flag colours: blue, green and yellow, with white**. The sponsor Porto also painted some kerbs blue [web: f1mania 17 Oct 2024, otempo/exame Oct 2024]. Before that they were white/yellow/green in the Petrobras style. Which corner gets which colour is [unconf].
- Run-offs: repainted with anti-skid paint in 2024 [web: grandepremio]. All debris fencing on the main straight, from Junção to the Senna S, was replaced in 2024, with the opposite side due in 2025 [web]. There is a new debris fence between T13 and T14 on the left, and the T14→T1 fence was replaced [FIA 2024].

### Corner table
Names and numbers come from OSM and Wikipedia. Wikipedia puts Laranjinha at T8, while OSM tags T7 = Laranjinha and T8 = "Esse". OSM barrier distances are measured to the *fence* lines (the only barrier tagged on most of the lap).

| T | Name / dir | Outside run-off | Inside | Kerb | Barrier (OSM fence distance from edge) | Notes |
|---|---|---|---|---|---|---|
| 1 | S do Senna (L, downhill braking) | Asphalt run-off with gravel beyond and tyre wall/TecPro [unconf]. New opening in the T1 run-off (2024) [FIA]. | grass | Flat/serrated apex kerb, painted flag colours | fence about 14 m left, 33 m right [OSM] | A key overtaking spot. |
| 2 | S do Senna (R) | Grass/asphalt [unconf] | | Flat kerb. An FIA sausage kerb behind the apex at T2 is reported in an undated article [web, f1technical] [unconf current]. | about 20 m on both sides [OSM] | The pit exit road runs on the left (inside) of T1–T2. |
| 3 | Curva do Sol (L, flat-out) | Grass, with Armco + concrete wall on the right | | Flat | wall about 20 m right (way 191578626) [OSM] | Small run-off [web]. |
| – | Reta Oposta (back straight) | grass | grass | – | wall about 16 m right, fence 4 m left [OSM] | The pit exit merges on the left at the start of this straight [OSM, FIA]. |
| 4 | Descida do Lago (L, heavy braking) | **Large** run-off [web] (asphalt + gravel [unconf]) | | Serrated, with a sausage kerb at the apex [web, older] | fence about 12 m left, 39 m right | White line at the T4 exit realigned in 2025 [FIA]. |
| 5 | Descida do Lago (L) | grass/gravel [unconf] | | flat | fence about 4 m left, 25 m right | |
| 6 | Ferradura (R, fast, blind) | Gravel + tyre wall on the left [unconf] | | flat | wall about 66 m left; fence about 29 m left | |
| 7 | Laranjinha (R) | **Concrete** (the grass pavers on both sides were replaced with a concrete layer in 2024) [FIA] | concrete | flat | guardrail + tyre barrier on the left realigned in 2024 [FIA]; fence about 24 m left | |
| 8 | Laranja / "Esse" (L) | grass/gravel [unconf] | | Sausage kerb at the apex [web, older] | fence about 23 m left | |
| 9 | Pinheirinho (L) | gravel [unconf] | | flat | fence about 13 m right | |
| 10 | Bico de Pato (R hairpin) | Asphalt [unconf] | | **Very tall inside kerb** [web]; sausage behind the apex [web, older] | fence about 13 m left | Slowest corner. |
| 11 | Mergulho (L, downhill) | Gravel/grass on the right; drivers often run wide here [web] | | flat | fence about 22 m right | |
| 12 | Junção (L) | Asphalt run-off on the right [unconf] | | flat | fence about 11 m right | The exit is critical for the long run uphill to the line. |
| 13 | Café (L kink, uphill) | grass | | flat | fence about 16 m right | |
| 14 | Subida dos Boxes (L) | | | | wall about 50 m right; fence 5 m left | The **pit entry branches off on the left** here. |
| 15 | Arquibancadas (L curve onto the main straight) | Concrete wall + debris fence on the right, close to the edge | Pit wall on the left | – | wall about 48 m right; fence about 3 m right [OSM] | New opening on the right at T15 (2024) [FIA]. |

### Main straight
- The pit wall (concrete, topped with debris fence) is on the **left**. Garages are on the left. **Pole is on the right** [FIA 2025 pit drawing].
- The main grandstands (Arquibancadas) are on the right, behind a concrete wall and fence that were replaced in 2024.
- New opening on the right at start/finish (2024) [FIA].
- Start gantry over the straight [unconf position]. Car-number light panels are on the right of the grid [FIA 2025].
- The surface is the 2024 asphalt, reworked in 2025 from T12 to T1, with grooving from the start line to grid slot 21.

### Pit lane
- **Entry:** on the left on the climb of Subida dos Boxes (T14), after Café. Any car that passes left of the pit entry after **Safety Car Line 1** counts as entering. Drivers must keep **left of the solid white line** at pit entry, then pass **left of the 1st bollard and right of the 2nd bollard** on the entry road [FIA 2025]. That makes a slight chicane, which dates from the 2014 entry change [web].
- There is a light panel "PE" on the left before the entry road [FIA].
- **Lane:** about 1.38 km of OSM way including the exit road, which is one of the longest in F1 [web]. Speed limit 80 km/h [unconf: standard figure; the drawing does not state it].
- **Exit:** a long pit exit road runs along the left, inside the Senna S. Practice-start grid boxes are painted on the **left** of the exit road, with a guardrail on the left and marshals behind it.
- A blue-flag marshal stands at the end of the exit road. SC Line 2 is at the merge [FIA].
- The exit joins from the **left at the start of Reta Oposta, after Curva do Sol (T3)** [OSM: the way ends there; Wikipedia].
- The hatched zone between the pit exit road (on its right) and the track edge was **removed in 2025**, so a plain white separating line remains [FIA].
- In the project data, `limiterStartM` 60 and `limiterEndM` 808 are still marked unconfirmed in circuits.json.

---

## 2. COTA (Circuit of the Americas), United States GP

- 5.513 km [FIA 2025], 20 turns, anti-clockwise.
- Resurfacing history [FIA notes 2023–2025]:
  - 2022: large sections.
  - 2023: T12 entry to exit, and T14 to T16.
  - 2024: T16 entry to T3 entry (main straight), and T9 to T12 (back straight).
  - 2025: before T3 to before T7.
  - So by 2025 the whole lap is 2022–2025 asphalt, and the bumps have mostly gone.
- Kerbs: **red/white**, with **red-painted verges**. The large asphalt run-offs are painted in **red/white/blue "stars and stripes"** bands (5,000 US gallons of paint) [web: NASCAR/grid.life]. The exact stripe layout per corner is [unconf].

### Corner table
OSM barriers here are `guard_rail` (undifferentiated). The gravel column is the percentage of the corner with an OSM gravel polygon on that side.

| T | Dir | Outside run-off | Inside | Kerb | Barrier dist. from edge [OSM] | Notes |
|---|---|---|---|---|---|---|
| 1 | L, uphill hairpin | **Huge painted asphalt run-off** (red/white/blue) | grass/painted asphalt | Red/white flat kerb + red verge | about 29 m right, 69 m left | **New TecPro in the T1 run-off (2024)** [FIA]. The pit exit merges on the left here. |
| 2 | R | Gravel (the trap was **made narrower in 2023**, guardrail realigned) [FIA] | | | about 17 m right, 40 m left | New TecPro on the left (2024) [FIA]. |
| 3–5 | Esses R-L-R | Asphalt + gravel strips [OSM 460658870/871] | | Red/white; sausage kerbs [unconf] | 13–57 m | Resurfaced T3–T7 in 2025. |
| 6 | R | Gravel on the left | **1.5 m asphalt verge, then synthetic turf** at the apex (2024) [FIA/web] | | about 16 m right, 55 m left | New TecPro on the left (2024). |
| 7–8 | L-R | Gravel (54% on the left at T8) [OSM] | | | 21–40 m | New TecPro on the left at T8 (2024). Blue line at the T8 apex (2025) [FIA]. |
| 9 | L | Gravel (narrow trap at the exit, next to the stand) [web/OSM] | | **New kerbs on the right (2024)**. Historically the 100 mm "T9 kerb" [web 2016]. | about 25 m right | White line at the exit moved to **1.5 m from the back of the kerb** (2024). Track-limits corner. |
| 10 | R | gravel 37% right | | **New kerbs on the left (2024)** | about 6 m left, 14 m right | New TecPro on the right. Blue line at the exit (2025). |
| – | Back straight (T11→T12, about 1 km) | | | | about 5 m both sides | **Concrete walls realigned on the left between T11 and T12** (2024) [FIA]. |
| 11 | L hairpin | **Resin-bound "fake gravel" insert at the exit** in place of turtle bumps (2024) [web] | | | about 23 m right | White line at the exit doubled in width (2024). |
| 12 | L, heavy braking | **Asphalt run-off** (drivers asked for gravel; still asphalt in 2025) [web RaceFans] | | | about 21 m right, 33 m left | Bump at the entry removed (2024). White line at the exit doubled. |
| 13–15 | Stadium section | gravel on the left at T13/T14 [OSM]; sand polygon at T15 ("Runoff Corner", 460658882) | **1.5 m asphalt verge + synthetic turf at the apexes of T13, T14 and T15** (2024) | | 17–31 m | **New TecPro on the left from T13 to T15** (2024). Blue line at the T13 exit (2025). White line at the T15 exit doubled. |
| 16–18 | Multi-apex R (like Istanbul T8) | gravel on the right at T16 (56%); large trap from T17 to T18 (460658883, 1.2 km perimeter) | | **New kerbs on the right at T18 (2024)** | about 8 m right at T17/T18 | |
| 19 | L | **Gravel outside the exit**: Hamilton was beached there in the 2025 race, and Russell crashed at the same corner [web 2025] | | | about 21 m left, 32 m right | White line at the exit moved to 1.5 m from the back of the kerb (2024). |
| 20 | L hairpin onto the straight | Painted asphalt | | | about 36–41 m | **Track limits: missing T20 deletes that lap and the next one** [FIA 2025]. The pit entry is on the left before T20. |

### Main straight
- Pit wall on the left: a concrete wall of about 430 m (OSM 460666308) with debris fence. Garages are on the left. **Pole is on the right** [FIA 2025].
- The main grandstand is on the right.
- The straight climbs steeply up to T1. Grid boxes run up the hill, and the grid line sits about 290 m from the timing line (circuits.json `gridLineM` 297).
- The asphalt dates from 2024 (T16→T3).

### Pit lane
- **Entry:** on the left, between T19 and T20. Any car that passes **left of the bollard at the pit entry** counts as entering [FIA 2025]. SC Line 1 is just before T20, and the entry road runs inside T20 [FIA drawing].
- **Lane:** 950 m (OSM). Speed limit 80 km/h [unconf: standard].
- **Exit:** the road runs inside (left of) T1 up the hill. Practice starts are done in the **merging lane to the left of the fast lane** using painted grid boxes [FIA 2025]. The exit joins from the left at the T1 exit (SC Line 2), on the run toward T2.

---

## 3. Zandvoort (CM.com Circuit Zandvoort), Dutch GP

- 4.259 km [FIA 2026], 14 turns, clockwise.
- Full rebuild in 2019–2020 by Dromo: new asphalt, banked corners and new fences to the FIA debris-fence standard 3502-2018 [web: Geobrugg].
- Bumps on the straight before T1, and between T5 and T6, were removed in 2023 [FIA].
- The **last F1 race here was 2026** (the contract ended after 2026) [web].
- The circuit **kept its gravel traps right next to the track edge**, at FOM's request [web 2019].
- The pit lane limit was raised from **60 to 80 km/h from 2025** [web F1.com; the FIA 2026 drawing shows an "80" sign]. **The project's `circuits.json` still has `pitLimitKmh: 60`, which is out of date.**
- The **2026 FIA drawing confirms 80 km/h.**

### Corner table
Per-corner features come from circuitzandvoort.nl/en/corners plus FIA notes. Distances are [OSM] from the edge. Barriers are `guard_rail material=tyres`, i.e. Armco faced with tyres.

| T | Name / dir | Outside run-off | Inside | Kerb | Barrier | Notes |
|---|---|---|---|---|---|---|
| 1 | Tarzanbocht (R hairpin, gently banked) | **Gravel** on the left (70% of the corner) [OSM 473906388], with **asphalt run-off in line with the braking zone** (2020) [web] | Pit exit road on the inside (right) | Red/white [unconf] | Tyres about 28 m left; concrete wall about 4 m right (pit side) | **Escape road along the front of the tyre barrier**, rejoining at the T1 exit [FIA]. Modified in 2026 [web race24]. |
| 2 | Gerlachbocht (R) | **Gravel box on the left** (2020) | | **Special double kerb on the left** [web] | Tyres about 13–21 m left | Barriers on the left realigned (2024) [FIA]. |
| 3 | Hugenholtzbocht (L hairpin, **banked up to 18–19°**, progressive) | **Asphalt run-off** on the outside [web] | | New kerbstones; OSM sloped concrete kerbs 1318064314 and 1318429923 | Tyres about 5 m right (OSM; looks too close), fence 8 m | Banking is higher on the outside. |
| 4 | Hunserug (R, crest, uphill) | grass | | | New FIA fences on the right; fence about 4 m from the edge [OSM] | Very narrow, with fences right at the edge. |
| 5 | Rob Slotemakerbocht (L kink, over the crest, sloping) | Gravel mostly replaced with grass; the last section paved [web] | | | fence about 4 m | |
| 6–7 | Scheivlak (R, fast, downhill, off-camber) | **Redesigned gravel box** on the left (95% of the corner) [OSM 484350710] | | Kerbs replaced; T6 apex kerb end reprofiled (2025) [FIA] | FIA fences on the left; crash barrier partly replaced by **a wall with tyre stacks** [web]; tyres about 112 m right | Barriers on the right at T6 realigned (2024). |
| 8 | Mastersbocht (R) | **New asphalt run-off at the exit** + gravel 65% [OSM] | | **Sausage kerb inside** (replaced the metal kerb); **double kerb at the exit**; smoother start of the apex kerb (2026) [FIA] | Tyres about 28 m left | **Escape road to T9** along the tyre barrier [FIA]. New FIA fence on the right (2023). |
| 9 | (unnamed, ex-Renaultbocht) (R) | gravel about 49% left [OSM 484350716] | | The Masters double kerb ends near the entry | Tyres about 17 m left | |
| 10 | (ex-Vodafone / CM.com bocht) (L) | gravel 60% right [OSM 484636472] | | **New double kerb at the exit** (2020) | Tyres about 22 m right | **New concrete walls with FIA fence between T10 and T11 on the right** (2024) [FIA]. |
| 11–12 | Hans Ernst chicane (L-R) | **Gravel box renewed**, asphalt run-off in line with the braking zone [web]; gravel 59% left [OSM 1069289277] | | **Sausage kerb** [web]; OSM concrete kerbs 1318852311/18 | Tyres about 8–11 m; tyre blocks 1318852316/7 | **Escape road from T11 to T12** [FIA]. **Blue line at the T11 apex and the T12 exit** (2026) [FIA]. New FIA fence in the T12 run-off (2023). |
| 13 | (ex-Kumhobocht) (R, fast) | **Gravel** 81–100% left [OSM 484397692] | | New kerbstones inside and at the exit; **double kerb at the exit** | **Tyres on the outside + TecPro at the high-speed impact spot**; FIA fencing on both sides [web]; tyres about 20–25 m left | Light panels around T11 and T13 changed (2026) [web]. |
| 14 | Arie Luyendykbocht (R, **banked about 18°**, 32% max gradient) | **Gravel box removed**; **SAFER barrier** on the outside [web] | **Pit entry** on the inside (right) | | SAFER/tyre about 2–4 m from the edge [OSM] | Slingshot onto the straight. Track limits are watched here. |

### Main straight
- **Pit wall on the right**: a 459 m concrete wall (OSM 1030809336) with debris fence. Garages are on the right; the pit building was extended by 6 garages in 2024 [FIA].
- On the left: fence and spectator banking in the dunes.
- `poleSide: left` in the project.
- Asphalt from 2020; the bump before T1 was removed in 2023.
- Kerbs in 2025/26 are red/white [unconf]. The OSM kerb polylines are concrete with a sloped profile.

### Pit lane
- **Entry:** on the inside (right) of the banked T14. Any car **passing right of the bollard at SC Line 1** counts as entering [FIA 2026]. The entry is on the flat inside edge of the banking.
- **Lane:** 759 m (OSM). The 80 km/h sign comes just after the pit entry [FIA drawing].
- **Exit:** the pit exit road runs on the inside (right) of Tarzan.
- An **extra light panel on the pit exit road** warns of obstacles "around the corner leading to the pit exit" [FIA].
- Practice starts use a painted box on the **right** of the exit road. Cars not doing a practice start must cross the white line onto the track as early as possible [FIA].
- The exit merges on the right **after Tarzan, before Gerlach** [OSM: the way ends there; web: "pit exit after Tarzan"].
- A blue-flag marshal stands at the exit.

---

## 4. Spielberg (Red Bull Ring), Austrian GP

- 4.326 km [FIA 2026], 10 turns, clockwise. Pits are on the right.
- 2025: resurfaced from T2 to the T3 exit [FIA 2025]. The rest of the asphalt is older [unconf].
- Kerbs: **red/white, about 2 m wide, almost flat in the first part** [web F1.com / FIA 2024], with **yellow sausage kerbs** behind (named at T1 and T3) [FIA 2024].
- Since 2024–25, a **light-blue line runs behind the white line** at the exits of T1, T3, T4, T6 and T8 and at the T7 entry [FIA 2025]. That makes the edge read as white line, then blue line, then red/white kerb.

### Corner table
FIA names (2026): T1 Niki Lauda, T2 Münzer, T4 Rauch, T7 Graz, T9 Jochen Rindt. OSM still uses older sponsor names (Schlossgold = T4, Rauch = T6, Würth = T7, Red Bull Mobile = T10). Turn direction comes from OSM geometry.

| T | Dir | Outside run-off | Inside | Kerb | Barrier dist. [OSM] | Notes |
|---|---|---|---|---|---|---|
| 1 Niki Lauda | R, uphill | **Asphalt run-off**, then gravel (white line about 1.8 m from the gravel) | | Red/white + **yellow sausage**; white line moved left (2024); blue line (2025) | Concrete wall about 4–5 m both sides at the corner (run-off wall further out) | **The opening on the right at T1 was closed (2026).** **New fences from T1 to T2 on both sides** to protect the advertising bridge (2026) [FIA]. The pit exit merges on the right after T1. |
| 2 Münzer | L kink (flat) | gravel 26–32% [OSM] | | | Wall about 10–16 m | **Extra double tyre row + TecPro on the right (2026)**. New verge between T2 and T3 on both sides (2023). Resurfaced in 2025. |
| 3 Remus (uphill R hairpin) | R | **Large asphalt run-off** + gravel; the MotoGP chicane and long-lap loop sit alongside (OSM 1077423714, 823820476) | | **Yellow sausage**; **inner high kerb at the apex removed (2026)** | Wall about 19 m; tyres about 29 m | Blue line at the exit (2025). |
| – | Back straight T3→T4 | | | | Concrete walls about 4–6 m both sides [OSM 822592398] | Downhill. |
| 4 Rauch (OSM "Schlossgold") | R, downhill braking | **Gravel** on the left (75%); white line **1.8 m from the gravel** | | Red/white, effectively shortened by the white line | Tyres about 29 m left; wall about 6 m right | **Safety devices extended on the right (2026).** **Improved barrier at the shortcut from T2 to T7 (2026).** |
| 5 | R (60° in OSM) | gravel 84% left | | | Wall about 41 m left, 6 m right | Direction is [unconf]. |
| 6 (OSM "Rauch") | L | **Gravel** on the right (63%); white line 1.8 m from the gravel (2024) | | Blue line at the exit (2025) | Walls about 43–45 m | |
| 7 Graz (OSM "Würth") | L | Gravel on the right (81%) | | White line realigned + blue line at the entry (2025) | Tyres about 37 m right | |
| 8 | R | Gravel 32–43%; the verge behind the 2nd kerb at the apex on the right was shortened (2023), then the verge behind the kerb removed (2024) | | Temporary kerbs removed (2023) | Wall about 4–10 m; fence 15 m left | Blue line at the exit (2025). |
| 9 Jochen Rindt | R, fast downhill | Asphalt + **2.5 m gravel strip directly behind the exit kerb on the left (2024)**; white line **1.5 m from the gravel** | | Red/white 2 m | Wall about 27 m left, 4 m right | The pit entry branches on the right after T9. **Smoother transition from T9 to T10 on the right, off track (2026).** |
| 10 (ex-Red Bull Mobile) | R onto the main straight | Asphalt + **2.5 m gravel strip behind the exit kerb on the left (2024)** | Pit entry road on the right | **Inner high kerb at the apex removed (2026)** | Tyres about 25 m left; wall about 7 m right | **Track limits: missing T10 deletes that lap and the next one** [FIA 2026]. Background: about 1,200 track-limit reports in 2023, mostly at T9/T10. The gravel reinstated in 2024 largely fixed it [web]. |

### Main straight
- **Pit wall on the right.** OSM 1187843395 is 667 m of concrete. The pit wall was **extended at the start of the straight (2026)** [FIA].
- Main grandstand on the left.
- Uphill to T1. The straight has concrete walls about 3 m from the edge on both sides (OSM 822592410).
- `poleSide: left`.
- Cars can be removed from the grid through gates at the start line and the finish line [FIA].

### Pit lane
- **Entry:** cars committed to the pits must stay **right of the white line that starts at the 50 m brake board** before the entry. Crossing the **dashed line with all four tyres** counts as entering. A yellow flag on the left of the entry road warns of incidents in the entry road only [FIA 2026].
- The entry leaves on the right between T9 and T10 and runs inside T10 [OSM, FIA drawing]. Pit entry status panels sit before SC Line 1.
- **Lane:** 1.0 km (OSM). Speed limit 80 km/h [FIA drawing].
- In 2026 the **pit entry speed-limit line moved about 18 m earlier** and the **pit exit speed-limit line about 23 m earlier** [FIA]. The project's limiter values (`limiterStartM` 158 / `limiterEndM` 932) are marked unconfirmed, so they may need shifting.
- **Exit:** practice starts are **not** allowed at the pit exit (2026). Cars use the exit road and must not cross the white line between the exit road and the track. Cars not doing a practice start must cross at the earliest opportunity and must not cross back [FIA].
- The exit merges on the right **after T1, on the climb to T3** (SC Line 2) [OSM, FIA drawing].

---

## 5. Montreal (Circuit Gilles Villeneuve), Canadian GP

- 4.361 km [FIA 2026], 14 turns.
- **Fully resurfaced in 2024**, and all kerbs were replaced to the same specification [FIA 2024]. In 2025 a bump at T12 was ground off [FIA]. So 2025/26 asphalt is fresh and dark.
- **All walls were realigned in 2024 to a guaranteed 1.0 m height.** Light panels (TSP) are at least 2.5 m high [FIA 2024].
- **TecPro** has replaced the old tyre barriers since 2017 [web Wikipedia].
- OSM: concrete jersey/wall lines are typically **0–3 m from the track edge** almost all the way round.

### Corner table

| T | Dir | Outside run-off | Inside | Kerb | Barrier | Notes |
|---|---|---|---|---|---|---|
| 1 | L (after a right kink) | Asphalt run-off; the concrete wall in the T1 run-off was realigned and extended (2023), then shortened by one element (2023) | Grass replaced by **concrete behind the kerb** (2024) | Red/white; **smoother apex kerb (2026)** | Concrete wall | Missing T1 means rejoining via the marked run-off route [FIA]. |
| 2 | R hairpin (Virage Senna) | Grass/asphalt; **white line 1.8 m from the wall between T2 and T3 on the left** (2024) | | Drainage cuts in the T2 kerbs (2025); drainage grooves cut in the T2 apex kerb (2026) | Concrete wall on the left | The **pit exit runs around the outside (left)** of T1–T2. The opening before T2 on the left at the pit exit was moved downstream (2024). |
| 3 | L | **Run-off enlarged (2023)**; concrete behind the kerb (2024) | | | Wall | |
| 4 | R | | | | **Concrete wall** outside; white line 1.8 m from the wall (2025) | |
| 5 | kink | Access road asphalted (2024) | | | Wall | |
| 6 | R | | **Concrete behind the kerb** (2024) | | **Wall on the right realigned + new opening on the left (2026)**; post MP12.8 moved to make an opening | |
| 7 | L | Walls realigned (2023); access road asphalted (2024); **white line 1.8 m from the wall between T7 and T8 on the left** (2024) | | | Wall | The track was lowered between T7 and T8 to give 4.0 m clearance under the **Concorde Bridge** [FIA 2024]. |
| 8 | R (chicane entry) | **Run-off rebuilt with asphalt + grass, walls realigned (2024)** | | Drainage cuts (2025) | Wall; white line 1.8 m (2025) | |
| 9 | L (chicane exit) | Run-off behind the T8/T9 apex regraded + paved path (2025) | | **Orange apex kerb.** Passing fully left of it means staying left and rejoining at the far end of the asphalt run-off [FIA] | **Concrete wall outside T9** [web] | Orange kerb at the T9 entry on the left was removed (2023). |
| 10 | Hairpin (L'Épingle) | **Asphalt run-off** [web] | | Drainage cuts (2025) | **Concrete wall on the right extended (2025)** | Safety Car resumption point before T8 [FIA 2026]. |
| 11–12 | Kink onto the Casino straight | | | | **Debris fence on the left after T11 raised to 3.5 m (2024)** | The longest straight. |
| 13 | R (chicane) | Asphalt run-off, with the wall on the right realigned (2026); **orange line/paint** on the run-off; the end of the orange paint blacked out at the rejoin (2025) | **Pit entry on the left**: go straight instead of turning right | **Orange apex kerb.** Track limits at **T13/T14: that lap and the next are deleted** [FIA 2026] | | Missing T13 means staying left of the orange line and rejoining at the end of the asphalt run-off. |
| 14 | L (chicane exit) | **"Wall of Champions"**: a concrete wall on the right about 1.8 m from the white line (2025), plus a blue line | | Orange kerbs at the T14 entry and exit on the left removed (2023) | The wall angle was changed in 2017 [web]; "Bienvenue au Québec" (Tourisme Québec) branding | The wall was realigned where cars rejoin at T14 (2026). |

### Main straight
- Pit wall on the left: concrete with debris fence. **The openings in the pit wall debris fencing now have gates (2026)** [FIA].
- The concrete wall at the end of the pit wall was **extended by 106 m (2023)** [FIA].
- Garages are on the left (`garagesFrom: exit` in the project, i.e. team order starts from the exit end). `poleSide: left`.
- In Montreal the **grid sits before the control line** (`gridLineM` -21).
- Grandstands on the right. Concrete walls are 0–3 m from the edge on both sides [OSM].
- Surface: 2024 asphalt.

### Pit lane
- **Entry:** on the **left before T13**. Instead of turning right into the chicane, cars keep left and run straight into the pit entry road. **Crossing the blue-highlighted white line in the entry road counts as entering.** Drivers must stay **left of the solid white line on the right** of the entry road [FIA 2026; web].
- Pit entry width was **reduced to 4.5 m** in 2023 [FIA]. Pit entry status panels sit before SC Line 1.
- **Lane:** 827 m (OSM); web sources say 741 m. Speed limit 80 km/h [FIA drawing].
- **Exit:** the road stays **left of the solid white line on its right**. It runs along the outside (left) of T1 and around the outside of the T2 hairpin.
- Practice starts use painted boxes on the **left after the pit exit** [FIA].
- The exit walls on the left were realigned (2024). A blue-flag marshal stands at the merge.
- The exit joins the track on the left **after T2**, on the run to T3 [FIA drawing, OSM, web]. Exiting cars carry more speed than cars coming out of T1 [web].

---

## 6. Kerb and colour schemes

| Circuit | Kerbs | Lines / paint | Run-off paint |
|---|---|---|---|
| Interlagos | **Blue / green / yellow (+ white)** Brazilian-flag scheme since Oct 2024 [web]; the per-corner pattern is [unconf] | White track-edge lines | Anti-skid painted run-offs (2024); colour [unconf] |
| COTA | **Red / white** | **Red-painted verge** beyond the kerb; doubled-width white lines at the exits of T11, T12, T15 and T20 (2024); **blue lines** at the T8 apex and the T10 and T13 exits (2025) | **Red/white/blue stripe bands** on the large asphalt run-offs; synthetic turf (colour [unconf], likely green) behind 1.5 m verges at T6 and T13–T15 |
| Zandvoort | Red / white [unconf]; concrete sloped profile; **double kerbs** at T2, T8, T10 and T13 exits; **sausages** at T8 inside and T11/12 | **Blue lines** at the T11 apex and the T12 exit (2026) | Little painted run-off; gravel right at the edge |
| Spielberg | **Red / white, 2 m wide**, + **yellow sausage kerbs** behind (T1, T3, ...) | White line moved onto the kerb, **light-blue line behind it** at T1, T3, T4, T6, T7 and T8 (2025) | Asphalt run-offs (painted pattern [unconf]); 2.5 m gravel strips at the T9 and T10 exits |
| Montreal | **Red / white**, with **orange apex kerbs at T9 and T13** | White lines 1.8 m from the walls at T2–3, T4, T7–8, T8 and T14; blue line at T14 | **Orange line** on the T13 run-off |

---

## 7. Notes for LanRace

1. **Zandvoort `pitLimitKmh: 60` in `data/tracks/circuits.json` is wrong for 2025/26.** It should be 80 km/h [F1.com 2025; FIA 2026 drawing].
2. **The Spielberg limiter lines moved in 2026.** The entry line is about 18 m earlier and the exit line about 23 m earlier, so `limiterStartM`/`limiterEndM` should move if the project targets 2026.
3. Pit sides from OSM (`pit.py`) match the FIA drawings:
   - Interlagos: left, pole right.
   - COTA: left, pole right.
   - Zandvoort: right.
   - Spielberg: right.
   - Montreal: left.
4. The pit lane OSM ways the project already uses (`pit.osmWay`) are the same ways analysed here. Their full lengths include the entry and exit roads: 1379, 950, 759, 1000 and 827 m.
5. For an automatic build:
   - Zandvoort: shingle polygons, tyre-barrier polylines and kerb polylines.
   - Spielberg: walls, tyres and shingle.
   - Montreal: jersey barriers.
   - COTA: gravel and guard_rail, then hand-fix T2, T11, T12 and the turf verges at T6 and T13–T15.
   - Interlagos: author by hand. The fence polylines give a rough barrier envelope.

## Sources
- FIA decision documents, downloaded to `research/osm/fia/`:
  - 2025 São Paulo GP Race Director's Event Notes, plus the circuit map and pit lane drawing.
  - 2025 United States GP notes (v2), plus the map and drawing.
  - 2026 Austrian, Dutch and Canadian GP Race Director's Competition Notes, plus maps and pit lane drawings.
  - 2023, 2024 and 2025 notes for all five events ("Changes to the Circuit").
  - Index: https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2026-2072 and https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2025-2071
- https://www.planetf1.com/news/fia-reveal-13-track-changes-canadian-grand-prix (Montreal 2024)
- https://www.formula1.com/en/latest/article/explained-how-key-changes-to-the-red-bull-ring-look-to-avoid-last-years.2ubjMYkbT3HHpwuEJ7PoHw
- https://www.fia.com/news/f1-ringing-changes-how-fia-finding-limit-red-bull-ring-thanks-key-circuit-updates
- https://www.racefans.net/2023/07/02/put-the-gravel-back-fia-tells-red-bull-ring-after-20-track-limits-penalties-in-race/
- https://www.racefans.net/2016/06/30/new-kerbs-address-track-limits-concerns-austria/
- https://www.gpfans.com/en/f1-news/1032655/fia-statement-major-us-gp-track-changes-cota/
- https://www.thedrive.com/news/cota-adds-gravel-to-crack-down-on-f1-track-limits-violations
- https://x.com/racefansdotnet/status/1979240105102475672 (COTA T12 still asphalt)
- https://www.formula1.com/en/latest/article/watch-hamilton-brings-out-the-safety-car-after-spinning-and-beaching-his-car.DWBiX4pfp8i2yaHNrLTBK (COTA T19 gravel)
- NASCAR COTA paint: https://www.nascar.com/?p=424633 ; grid.life verge note: https://www.grid.life/cota-drivers-resources-1
- https://www.circuitzandvoort.nl/en/corners/ (per-corner gravel, kerbs, barriers)
- https://www.gpfans.com/en/f1-news/42388/f1-drivers-get-their-way-over-zandvoort-hazards (gravel kept)
- https://www.geobrugg.com/zh/Circuit-Zandvoort-119642.html (FIA debris fence)
- https://www.formula1.com/en/latest/article/what-tyres-will-the-teams-and-drivers-have-for-the-2025-dutch-grand-prix.67BZ3TKXXRXKVATns2bhni (pit limit 80)
- https://www.race24.asia/en-us/articles/43033 (2026 Zandvoort changes)
- https://grandepremio.com/br/f1/do-novo-asfalto-zebras-mais-coloridas-que-muda-interlagos-para-f1-2024/
- https://www.f1mania.net/f1/f1-interlagos-traz-nova-pintura-de-zebras-com-azul-verde-e-amarelo/ (403 on fetch; snippet only)
- https://www.otempo.com.br/autotempo/2024/10/29/porto-pinta-zebras-de-azul-em-interlagos-e-homenageia-pilotos-br
- https://en.wikipedia.org/wiki/Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace ; https://en.wikipedia.org/wiki/Circuit_Gilles_Villeneuve
- https://www.motorpasion.com/formula1/asi-es-el-circuito-de-interlagos (pit entry and exit)
- https://oversteer48.com/montreal-grand-prix-track-layout/ ; https://www.planetf1.com/canadian-grand-prix/canadian-grand-prix-wall-of-champions-explained
- OpenStreetMap contributors (ODbL), via https://maps.mail.ru/osm/tools/overpass/api/interpreter
