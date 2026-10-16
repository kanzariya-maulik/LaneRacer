# Circuit research C: Hungaroring, Monaco, Imola, Buddh

Researched 2026-10-17. Configuration = most recent F1 one (Hungaroring 2026, Monaco 2026, Imola 2025 = last F1 race, F1 left Imola after 2025; Buddh 2013 F1 layout in its current, post-MotoGP-2023 state).

Evidence legend:
- **[FIA]** FIA Race Director event/competition notes ("Changes to the Circuit", pit lines) — primary, confirmed.
- **[SAT]** my reading of Esri World Imagery (z17/z18, ~0.4 m/px). Imagery date unknown (Hungaroring tiles show the pit building mid-rebuild, i.e. ~spring 2025; Buddh tiles appear pre-MotoGP-2023 because the 2023 gravel is not visible). Distances from imagery are ±30 %.
- **[OSM]** OpenStreetMap via Overpass (kumi.systems / maps.mail.ru mirrors; overpass-api.de returned 406 to the default curl user agent).
- **[WEB]** press/guides. **(unconfirmed)** = inference or single weak source.

Raw files: OSM dumps `research/osm/c_<id>.json`, FIA PDFs `research/fia_c/*.pdf`, imagery mosaics `research/sat_c/*.jpg` (all under the scratchpad folder).

---

## 0. OSM data availability (summary)

| Circuit | Raceway centreline | Pit lane way | Gravel/run-off polygons | Barrier lines along track | Kerbs | Verdict |
|---|---|---|---|---|---|---|
| Imola | 36 `highway=raceway` ways, most with corner `ref` + `name` | w196368195 "Pit Lane", 1 024 m | **14 `natural=sand`** polygons covering every trap (Tamburello, Villeneuve, Tosa, Piratella, Acque Minerali, Variante Alta, Rivazza, Variante Bassa) | ~40 `barrier=wall` ways ringing the track (w1462300893…w1462300985 series, w487236329-334, w1023653991, w1155766251-253), 3 `barrier=wall`+`wall=tire_barrier` areas (w487413769 Variante Alta, w487542306 + w487545310 Acque Minerali), 98 `barrier=fence` (w487236315… series = trackside debris fences, untagged height) | none on track (only street `kerb=lowered` nodes) | **GOOD**: gravel polygons and barrier lines can be placed automatically. Wall material (Armco vs concrete) and fence height are not tagged: assign them by hand per section. |
| Hungaroring | 2 main ways (w231328650, w1333262244 `width=15`) + karting/drift tracks (filter `sport=karting`, the "Cselőtei Speed Zone") | w231417580 "Bokszutca" (Pit Lane), 1 184 m, T14 inside to after T1 | only 2 `natural=shingle` (w823170832 = T11 outside gravel, w823170833 ≈ T4/T5); 8 `landuse=grass` (not run-off specific) | 6 `barrier=wall` areas + 3 `barrier=guard_rail` only around T1–T3 (w503185881/884, w503197019, w503235497/500, guard rails w503197020, w503224081, w503224084), 1 wall `height=3 material=concrete` (w787670300). The other 19 fences are perimeter/campsite | none | **PARTIAL/POOR**: centreline and pit lane are fine. Run-off and barriers have to come from imagery plus FIA notes. |
| Monaco | 10 raceway ways "Circuit de Monaco" (incl. tunnel w1470365907 `tunnel=yes layer=-1`) | w850261588 "Voie des stands" 369 m (43.73238,7.42298 → 43.73526,7.42124) + w1388331347 "Sortie des stands" 78 m (→43.73702,7.42212); the stretch along the start straight is missing | n/a (street) | Temporary Armco/fences **not mapped**. Only permanent walls (w1288539981… harbour/Rascasse area, w1528483284 `height=2.5` near the tunnel exit), 2 guard rails (w943191878 Pont Ste-Dévote, w161748269) | 411 crossing nodes/ways (zebra crossings), 25 `kerb=lowered`, 83 `surface=paving_stones` pavements, pool `leisure=swimming_pool`, 27 `man_made=pier` | **POOR for barriers, GOOD for street dressing.** Place the barrier at a fixed offset (project uses `barrierM 1.5`). OSM crossings, pavements, piers and the pool can be used to dress the scene. |
| Buddh | 13 raceway ways, `raceway:corner_number` only on T1–T3 | w188019426 (pit lane) | none | 5 perimeter `barrier=fence` only | none | **POOR**: use the project's own survey plus imagery. |

---

## 1. Hungaroring (2026 configuration)

### Recent changes (all [FIA] unless marked)
- **2024**: paddock fully rebuilt. Guard rail at **T2 RHS replaced by concrete wall + debris fence**. New **concrete walls + debris fence in the run-off of T4 and T12**, and at the **pit entry RHS**. Temporary concrete walls + fence on the LHS at T13/T14 around the pedestrian bridge. **2.5 m grass verge behind the T5 exit kerb (LHS)**. **2.5 m gravel strip at the T12 exit (LHS)**. New 14 m asphalt strip across the full track and pit lane at the race control tower and pit exit. White line moved closer to the kerb end at T4 RHS and T11 LHS. Tyre barriers renewed at T1, T2, T4, T7, T10, T12, T13 exit, T14 exit.
- **2025**: **main straight resurfaced** (8 866 m², 620 m [WEB budappest]). **T5 exit grass strip changed to gravel strip**. New concrete blocks with fences at T14 LHS up to the bridge. **Pit lane resurfaced**. White line realigned and a **blue line** added at the T7 exit.
- **2025-26 rebuild** [WEB]: new **36-garage pit building**, new race-control tower, **10 000-seat covered main grandstand** (old main grandstand demolished), wider paddock. Phase 2 started after the 2025 GP and was finished for the 40th-anniversary 2026 race.
- **Spring 2026 resurfacing**: T1, T2, T12, T13, T14 **and their run-off areas** (circuit statement via RacingNews365). Pirelli/FIA mention only "asphalt repairs approaching T1 and T12". Drivers complained about low grip at the final corner and a bump at T1. The main straight was re-heated with infrared and rolled overnight. Older sections stay rough and grey (2016 surface).

### Corner table
Distances are track edge → barrier, [SAT] estimates. Kerbs everywhere are red/white FIA flat kerbs; exit kerbs are often followed by a **green painted strip** [SAT]. Tyre walls carry **blue conveyor-belt facing** [SAT].

| Turn | Outside run-off | Inside | Kerb | Barrier (outside) | Dist. m | Catch fence | Notes |
|---|---|---|---|---|---|---|---|
| T1 (R hairpin, downhill braking) | Very large light-grey **asphalt** run-off, painted red/white stripes at the edge of the run-off | Grass. **Pit exit road runs along the inside** and merges after the apex | Red/white entry + apex | Tyre wall, blue belts, then concrete wall + fence | 50–60 | yes (~4 m, unconfirmed) | Resurfaced 2026. Bump complaints. |
| T1A (kink) | asphalt | grass | red/white | concrete + fence | 10–15 | yes | |
| T2 (L, long downhill) | **Dark asphalt run-off** | grass | red/white, long on RHS exit | **Concrete wall + debris fence RHS (2024, was Armco)** | 25–35 | yes | Resurfaced 2026 |
| T3 (R) | asphalt then grass, gravel beyond (unconfirmed) | grass | red/white | Armco/tyres (OSM guard_rail w503224081/084 near here) | 15–25 | yes | |
| T4 (L, fast, blind) | Grass + gravel (OSM shingle w823170833), new concrete wall in the run-off (2024) | grass | red/white, white line moved closer (2024) | tyre wall + concrete + fence | 20–30 | yes | |
| T5 (R, long) | Gravel + grass | **2.5 m gravel strip behind the exit kerb LHS (2025, was grass 2024)** | red/white | tyres + Armco | 25–40 | yes | |
| T6–T7 (R-L chicane) | asphalt | grass | red/white, sausage-style inside (unconfirmed) | tyre wall (T7) | 15–25 | yes | Blue line at the T7 exit (2025) |
| T8 (L) | gravel/grass | grass | red/white | Armco/tyres | 15–25 | yes | |
| T9 (R) | gravel/grass | grass | red/white | Armco/tyres | 15–25 | yes | |
| T10 (L, fast) | asphalt/grass | grass | red/white | tyres renewed 2024 | 15–25 | yes | |
| T11 (R, fast) | **Large gravel trap** (beige, [SAT] + OSM w823170832), blue-belted tyre wall behind it | green-painted strip at exit | red/white, white line moved (2024) | tyre wall + fence | 40–60 | yes | Popular overtaking-error corner |
| T12 (R, heavy braking) | **Asphalt** run-off with new concrete wall + fence (2024) | **2.5 m gravel strip at exit LHS (2024)** | red/white | concrete + fence, tyres | 30–40 | yes | Resurfaced 2026; new TSP 16 |
| T12A/T13 (L hairpin) | asphalt, green strip at exit [SAT] | grass | red/white | tyre wall, temporary concrete LHS | 20–30 | yes | |
| T14 (R, final, tightening) | **Large asphalt run-off** with blue-belted tyre wall, then grandstands | **Pit entry peels off on the inside (RHS)** | red/white | tyres + concrete + fence (new concrete blocks LHS 2025) | 25–40 | yes | Track limits enforced at the T14 exit. Resurfaced 2026. Grip complaints. |

### Main straight
- Length ~620 m, **resurfaced 2025** (fresh dark black asphalt, distinctly darker than the rest of the lap), re-rolled 2026.
- **Pit wall on the RHS** with garages behind it on the right. New 36-garage pit building and race-control tower (2025-26).
- Opposite (LHS): new covered 10 000-seat main grandstand plus "Grid 1/2/3", "Podium", "Club", "Grand Prix 1/2", "Apex 1/2" bleachers (OSM w1085151668 etc.).
- Debris fence on both sides. Start gantry over the track near the timing line. **Grid panels on the RHS**. 14 m full-width asphalt strip at race control (2024). Grid boxes 1–28. Pole on the LHS.

### Pit lane
- **Entry**: SC1 line and **bollard at the entry of T14 on the RHS**. Any car passing right of the bollard counts as entering. The entry road splits from the inside of T14 and curves round the inside of the hairpin (helipad area). Since 2024 there is a concrete wall + debris fence on its RHS.
- **Pit lane**: OSM length 1 184 m. Fast lane plus inner working lane separated by a solid white line. Garages on the **RHS** (in the direction of travel), Red Bull nearest the entry.
- **Exit**: a long pit exit road continues past the end of the pit lane along the inside (right) of the straight and around T1. It is separated from the track by a **continuous white line that drivers must respect even after the SC2 line**. A **dotted white line where the pit exit road meets the track** marks the track edge. Merging is effectively after T1, on the run to T2. Practice-start boxes are painted on the RHS of the pit exit road.
- Speed limit **80 km/h**. Width est. 12–14 m including the working lane (unconfirmed).

### Kerb scheme
Red/white. Green painted strips behind several exit kerbs. Blue track-limit line at the T7 exit. Gravel strips behind kerbs at the T5 and T12 exits.

---

## 2. Monaco (2026 configuration, 3.337 km, 19 turns)

FIA numbering: T1 Sainte-Dévote, T2 Beau Rivage (kink), T3 Massenet, T4 Casino, T5 Mirabeau Haute, T6 Grand Hotel (Fairmont) hairpin, T7 Mirabeau Bas, T8 Portier, T9 tunnel (flat curve), T10–T11 Nouvelle Chicane, T12 Tabac, T13–T14 Piscine 1 (Louis Chiron), T15–T16 Piscine 2, T17 kink before Rascasse, T18 Rascasse, T19 Anthony Noghes.

### Recent changes [FIA]
- **2026**: track resurfaced **T19 → T1** (start straight) and **T7 → tunnel entry**, plus pit entry, pit exit and the **T5 run-off**. Debris fences extended or added at: the pit exit RHS, T1 LHS, T3 LHS, between T4–T5 RHS, the T5 run-off, a new fence at T6 RHS, and both sides of T10. Guard rail realigned and extended at T3 LHS and extended at T6 LHS. At T10 the guard rail was extended (**escape-road opening reduced**), and it was also extended from T11 to T12. An **additional line of guard rail at the pit entry**. **TecPro replaced by a tyre barrier at T4 LHS**. Smoother kerb starts at T6 LHS and T7 LHS. **Sausage kerb height reduced at T10 and T16**. Smoother kerb end at the T19 exit RHS. TSP 12 moved higher inside the tunnel. Grid entry gate moved to grid slot 5.
- **2025**: resurfaced T12 → T3. **Painted flat kerb sections removed** at T1 (behind the temporary apex kerb), T4, T10 (before the temporary kerb, and between the T10 and T11 apex kerbs), T12, T13, T14 and T15. Apexes are now the temporary raised kerb with plain asphalt or road around it. Guard rail realigned at T3 LHS. Two-stop rule (sporting only).
- 2019: high-grip surface laid on the chicane escape road [WEB motorsport.com]. 2017: guard rail inside T13 raised to 3 rows + debris fence, TecPro upgraded at T1, T4, T11, T12, T15, new swimming-pool kerbs [WEB].

### Corner table
Barrier = triple-height Armco (guard rail) bolted into permanent sockets unless noted. Debris fence ~3–4 m above the Armco on posts (unconfirmed height). Barrier distance = the road's own pavement width.

| Turn | Outside | Inside | Kerb | Barrier | Dist. m | Fence | Notes |
|---|---|---|---|---|---|---|---|
| T1 Ste-Dévote (R, uphill) | **Short escape road straight on** (asphalt) ending in **TecPro** | Temporary raised apex kerb (painted flat section removed 2025) | red/white | Armco + TecPro head-on | 0.5–2 sides, escape ~25–35 straight on (unconfirmed) | yes, extended LHS 2026 | Chapel of Ste Dévote behind. Pit exit merges on the RHS just after. |
| T2 Beau Rivage (climb, kink L) | none | none | painted white edge lines | Armco both sides | 0.5–1.5 | yes | Steep 3-lane avenue. Pavement behind the Armco. |
| T3 Massenet (L, long) | none | pavement | red/white | Armco realigned/extended LHS 2025-26 | 0.5–1.5 | yes, extended LHS 2026 | Hôtel de Paris side |
| T4 Casino (R) | Casino Square, open paved area, small run-off | planted island | flat paint removed 2025 | **Tyre barrier LHS (was TecPro until 2025)** + Armco | 1–3 | yes | Square normally a car park. Fountain (OSM barrier=kerb w572935479). |
| T5 Mirabeau Haute (R, downhill braking) | **Escape road / run-off straight on**, resurfaced 2026 | pavement | red/white | Armco, TecPro at the end of the run-off (unconfirmed) | escape ~20–30 | yes, extended 2026 | |
| T6 Grand Hotel hairpin (L) | none | permanent **red/white apex** (never removed) | red/white, smoother start LHS 2026 | Armco extended LHS 2026, new fence RHS | 0.5–1 | yes | Slowest corner in F1 |
| T7 Mirabeau Bas (R) | none | pavement | red/white, smoother entry 2026 | Armco | 0.5–1.5 | yes | |
| T8 Portier (R) | none | none | red/white | Armco, sea wall behind | 0.5–1 | yes | Leads onto the seafront |
| T9 Tunnel (R curve) | none, walls | — | none, painted edge lines | concrete tunnel walls + Armco | 0.5–1 | n/a | Lit (OSM `lit=yes`). Hotel/Grimaldi Forum above. Steep drop at the exit. |
| T10–T11 Nouvelle Chicane (L-R) | **Escape road straight on** with high-grip surface. Rejoin only on the marshal-operated green light. Opening reduced 2026 | **Yellow sausage kerb** at the T10 apex (lowered 2026) (colour unconfirmed) | red/white, flat sections removed 2025 | Armco extended both sides, TecPro at the end | escape ~50–70 | yes, extended 2026 | Harbour edge metres away |
| T12 Tabac (L) | none | — | red/white flat removed 2025 | Armco + TecPro outside | 0.5–1.5 | yes | Grandstand K. Quai des États-Unis. |
| T13–T14 Piscine 1 (L-R) | — | 3-row Armco + fence inside T13 | temporary raised kerbs, red/white | Armco/TecPro | 0.5–2 | yes | Stade Nautique Rainier III pool beside |
| T15–T16 Piscine 2 (R-L) | small paved area | **sausage at T16** (height reduced 2026), low speed-bump kerb along the exit wall | red/white | **TecPro** at the exit | 1–3 | yes | |
| T17 (kink) | — | — | — | Armco | 0.5–1 | yes | |
| T18 La Rascasse (R) | — | pit entry branches on the right before the corner | red/white | Armco + extra pit-entry guard rail (2026) | 0.5–1.5 | yes | Restaurant behind |
| T19 Anthony Noghes (R) | — | — | red/white, smoother exit end 2026 | Armco | 0.5–1.5 | yes | DRS activation 20 m after |

**Street furniture visible** ([SAT], OSM, [WEB] monacolife; colours partly unconfirmed):
- Raised granite **pavement kerbs** behind or under the Armco. Paving-stone pavements (OSM 83 ways).
- The Armco socket holes stay in the road all year.
- Permanent **white lane lines and dashed centre lines** stay on public stretches, e.g. Bd Albert 1er and Avenue d'Ostende. The resurfaced sections are a darker black than the ordinary roads.
- OSM maps 411 crossing features. Most **zebra crossings** remain painted on the surface. Their exact anti-slip treatment for the race is unconfirmed.
- **Manhole covers** are in the racing surface and are secured (welded or bolted) for the event (unconfirmed, standard practice).
- Bollards mark the Ste-Dévote roundabout on normal days. Fountains and flower beds at Casino Square.
- Harbour pontoons with yachts on the left from Tabac to Rascasse. Piers (OSM 27). The swimming-pool complex. Grandstands on both sides of the harbour.
- Tunnel beneath the Fairmont/Grimaldi structure.

### Main straight (Bd Albert 1er)
- Curved straight with **pit lane and temporary garages to the RHS** (harbour side). Pole box on the RHS.
- Concrete pit wall with a fence. Grid painted on public road and removed at the February resurfacing.
- Grandstands on both sides, Tribune T/A near Ste-Dévote (names unconfirmed). Start gantry at the start line.
- Surface fully resurfaced 2026 (T19→T1), fresh dark asphalt. Cars are removed from the grid via the pit exit.

### Pit lane
- **Entry**: on the **right on the approach to La Rascasse (T18)**. The OSM lane leaves the road at ~85°, very sharp. An additional line of guard rail was added at the pit entry in 2026. The lane runs behind Rascasse along the quay (OSM w850261588 starts at 43.73238,7.42298).
- **Lane**: alongside the start straight on the right. **Narrow**: the FIA has a special "narrow pit lane" blending rule. Width est. 8–10 m (unconfirmed). Garages on the RHS, Red Bull nearest the entry (2023 order).
- **Exit**: "Sortie des stands" (w1388331347, 43.73656,7.42142 → 43.73702,7.42212) rejoins **on the RHS just after T1 Ste-Dévote**, climbing Beau Rivage, behind a solid white line. Cars not doing a practice start cross that line on the LHS at the earliest opportunity. A practice start (recon laps only) uses the pit exit road at the 100 m board and rejoins after T1. No practice starts otherwise. Debris fence extended on the pit exit RHS in 2026.
- Speed **60 km/h**.

### Kerb scheme
- Red/white painted kerbs. Flat painted extensions largely removed since 2025.
- Temporary raised apex kerbs at T1, T10, T13–T16.
- Sausage kerbs at T10 and T16, lowered 2026. Yellow (unconfirmed).

---

## 3. Imola – Autodromo Enzo e Dino Ferrari (2025 configuration, last F1)

FIA numbering 1–19: T1 kink, T2–T4 Variante Tamburello, T5–T6 Variante Villeneuve, T7 Tosa, T8 kink, T9–T10 Piratella, T11–T13 Acque Minerali, T14–T15 Variante Alta, T16 kink, T17–T18 Rivazza, T19 Variante Bassa/Traguardo. OSM refs run to 21: it splits Variante Bassa into 20/21.

### Recent changes [FIA]
- **2022**: bollard behind the T14 combination kerb. Double kerb at the T19 exit extended. Green painted area between the pit entry and the track; crossing it after committing to the pits is prohibited.
- **2024**: **new "double kerbs"** (second, raised kerb behind the apex/exit kerb) at T2 LHS, T3 RHS, T4 LHS, T5 LHS, T6 RHS, T9 LHS, T11 RHS, T12 RHS, T15 exit RHS, T19 LHS. Asphalt patch at the start of the T6 kerb. French drain between T7 and T8. **Asphalt run-off reduced → gravel at the T9 exit RHS (Piratella), between T12–T13 LHS (Acque Minerali), at T15 RHS (Variante Alta)**. Press reports barriers removed and gravel added at Variante Alta [WEB gpblog/f1technical].
- **2025**: track-limit white line plus a **blue line behind it, 1.5 m from the kerb/gravel/grass**, realigned at T4 apex/exit, T6 apex/exit, T7 exit (grass), T9 exit, T11 exit, T12 apex, T12 exit/T13 apex, T15 exit, T17 exit, T18 exit. T14 apex white line and bollard realigned. T19 apex white line set 1.5 m from the wall.
- **2026**: no F1 race (dropped from the calendar). Physical state as of 2025.

### Corner table
[SAT] + OSM sand polygons. Kerbs are red/white; the "double kerb" is the raised second kerb behind them. Green painted strips/areas appear at Variante Alta and Variante Bassa, with a blue track-limit line.

| Turn | Outside run-off | Inside | Kerb | Barrier | Dist. m | Fence | Notes |
|---|---|---|---|---|---|---|---|
| T1 kink (L) | grass/asphalt | — | red/white | concrete wall + fence (pit-exit side RHS) | 10–20 | yes | |
| T2–T4 Tamburello (L-R-L) | **Large gravel** outside T2/T3 (OSM w487223632, w487240179), asphalt strip before the gravel | grass + double kerbs | red/white + double kerbs (2024) | tyre wall + concrete wall (Santerno river behind) | 40–70 | yes | Senna memorial park inside |
| T5–T6 Villeneuve (L-R) | gravel (OSM w487223620, w487226212) | grass | red/white + double kerbs | tyres + wall | 25–40 | yes | Blue lines 1.5 m from gravel (2025) |
| T7 Tosa (L hairpin, heavy braking) | **Big gravel trap** outside (w487240175), grass at the exit | grass | red/white | tyre wall + concrete + fence, Tribuna P behind | 50–70 | yes | Exit line 1.5 m from the grass |
| T8 (kink) | grass | — | — | Armco/wall | 10–20 | yes | |
| T9–T10 Piratella (L, blind crest) | **Gravel replaced the asphalt run-off at the exit RHS (2024)** (w487240174) | grass | red/white + double kerb T9 | tyres + wall | 20–40 | yes | Unforgiving |
| T11–T13 Acque Minerali (R-R-L, downhill/uphill) | **Gravel** (w487240173), **tyre walls** (OSM tire_barrier w487542306, w487545310), gravel between T12–T13 LHS (2024) | grass | red/white + double kerbs T11/T12 | tyre wall + concrete + fence | 15–35 | yes | Grandstands D/E/F |
| T14–T15 Variante Alta / Gresini (L-R chicane) | **Gravel** at T15 RHS (2024, w487240172). Tyre-wall area w487413769 | Bollard behind the T14 kerb. Green and blue painted areas [SAT] | red/white + double kerb at the T15 exit | tyres + wall + noise barrier (w1462300985) | 15–30 | yes | Sausage/bollard to stop cutting |
| T16 (kink) | grass | — | — | wall | 10–20 | yes | |
| T17–T18 Rivazza (L-L, downhill braking) | **Large gravel** (w487240167, w487240168, w487240169) | grass | red/white | tyre walls + concrete (w1155766251-253) | 50–80 | yes | Exit lines 1.5 m from gravel |
| T19 Variante Bassa (R-L flick) | gravel (w487240162/163/165) + green paint | **wall 1.5 m from the apex line** | red/white + extended double kerb at the exit | concrete wall | 2–10 | yes | Pit entry bypasses it on the right |

### Main straight
- Runs E→W from Variante Bassa to Tamburello. **Pit building and garages on the RHS** (north, river side). Pole on the LHS.
- Concrete pit wall with a debris fence.
- Grandstands: Tribuna A "Partenza" (3 047 seats, OSM w59374219), M and I at Variante Bassa / Box / Podio.
- Green painted run-off at Variante Bassa [SAT]. Start gantry near the timing line.
- Surface uniform mid-grey (last full resurface year unconfirmed).

### Pit lane
- **Entry**: SC1 line with a **bollard; keep right of it**. The entry goes off to the right before Variante Bassa (OSM pit way starts 44.34480,11.72331, at the Rivazza exit) and bypasses the chicane. Green-painted hatched area between the pit entry and the track; crossing it after committing to the pits is prohibited.
- **Lane**: 1 024 m (OSM) including the exit road. Garages on the RHS, Red Bull nearest the entry. Fast lane plus working lane. Width est. ~12 m (unconfirmed).
- **Exit**: long exit road on the RHS behind a **solid white line no part of the car may cross**. Recon laps are the exception. It ends at 44.34442,11.71057, merging on the RHS **just before the Tamburello braking zone** (after T1).
- Speed **80 km/h**.

### Kerb scheme
- Red/white kerbs, with raised double kerbs behind them (2024).
- Green painted areas at the chicanes and pit entry. Blue line 1.5 m behind the white track-limit line (2025).

---

## 4. Buddh International Circuit (F1 2013 layout, current state)

### Status / changes
- Last F1 race 2013 (5.125 km, 16 turns).
- **MotoGP Bharat 2023** used a 4.96 km, 13-turn variant: the **T5–T7 chicane bypassed** and the **T10–T11 parabolic shortened/inner line** [WEB desiracingco/honda]. FIM Grade A homologation in Sept 2023 [WEB driven-international].
- The FIM asked for **less asphalt, more gravel at T1, 2, 3, 4, 5, 7, 13, 14**, with T3, T13 and T14 reworked to widen their run-off. **Homologated air fences and foam** were added, about 1 800 m of new barriers. Car-oriented kerbs were softened. Partial resurfacing [WEB motogp.com FIM safety officer, motoringworld, gpone].
- MotoGP did not return in 2024–25; a 2026 return was announced but I found no confirmation it happened. FIA F4/Indian Racing Festival rounds are scheduled for Oct–Nov 2026 ("first FIA-level racing in 13 years"). Ownership dispute (YEIDA/Jaypee) unresolved in sources.
- For an F1 rendition, use the F1 layout with the 2023 gravel and air-fence additions (air fences may be removed between events; unconfirmed).
- 2012 FIA preview: grass right of the track before T5 and T16 replaced by asphalt. Extra kerbs behind the apex kerbs at T6, T7, T8 lengthened by 5 m each end.

### Corner table
[SAT] imagery appears to be F1-era, before the 2023 gravel. Both states are given.

| Turn | Outside run-off (imagery) | 2023 change | Kerb | Barrier | Dist. m | Fence | Notes |
|---|---|---|---|---|---|---|---|
| T1 (R, after main straight) | Wide asphalt run-off with **red/white sunburst painted stripes** | gravel added | red/white | concrete wall + tyres, air fence 2023 | 40–60 | yes | Approached from the left of the straight |
| T2 (L kink) | asphalt | gravel added | red/white | wall | 20–30 | yes | |
| T3 (R hairpin, uphill) | asphalt run-off with **teal/green painted stripes** | gravel added, run-off widened | red/white | tyres + concrete | 30–50 | yes | Start of the 1.06–1.2 km back straight |
| T4 (R hairpin, end of back straight, heaviest braking) | big asphalt run-off with **green/white striped paint and a "Buddh International Circuit" logo**, grandstand behind | gravel added | red/white with yellow edge lines (unconfirmed) | tyres + concrete + fence | 40–60 | yes | Lake inside |
| T5–T7 (chicane) | asphalt (ex-grass) | gravel at T5/T7; bypassed by MotoGP | red/white + extended inner kerbs | wall | 15–30 | yes | |
| T8–T9 (L-R) | grass/asphalt | — | red/white | wall | 15–25 | yes | |
| T10–T11 (long banked R, multi-apex) | huge asphalt run-off with **orange/yellow/white sunburst paint** | inner MotoGP line | red/white, yellow/orange inner band [SAT] | tyres + concrete, grandstands | 40–70 | yes | Turkey-T8-like but tightening |
| T12–T13 (L-R) | asphalt | gravel at T13, widened | red/white | wall | 20–30 | yes | |
| T14–T15 | asphalt | gravel at T14, widened | red/white | wall | 20–30 | yes | |
| T16 (R, onto main straight) | asphalt (ex-grass right before T16) | — | red/white | wall + pit entry | 15–25 | yes | |

### Main straight
- Runs north from T16 to T1. **Pit building with 41 garages** on the RHS, plus 18 team buildings. Pit lane ~600 m (official site); the "longest pit lane on the calendar" in 2011.
- Large main grandstand opposite on the LHS. The chequered finish board is painted on the pit wall; no line across the track [project survey].
- Surface original 2011 grey, partially resurfaced 2023.

### Pit lane
- **Entry** before or at T16 on the right. **Exit** rejoins on the right towards T1. Exact geometry is unconfirmed. Project lane: OSM w188019426, 913 m surveyed.
- Speed **80 km/h** (2013 FIA preview via F1Technical).

### Kerb scheme
- Red/white kerbs.
- Run-off painted in large "sunburst" stripes: red/white at T1, teal/green at T3, green/white at T4, orange/yellow/white at T10–11.
- Yellow lines on some track edges (unconfirmed).

---

## Sources
- FIA 2026 Hungarian GP Competition Notes: https://www.fia.com/system/files/decision-document/2026_hungarian_grand_prix_-_race_directors_competition_notes.pdf
- FIA 2025 Hungarian GP Event Notes: https://www.fia.com/system/files/decision-document/2025_hungarian_grand_prix_-_race_directors_event_notes_.pdf
- FIA 2024 Hungarian GP Event Notes V2 + Pit Lane Drawing: https://fia.com/sites/default/files/decision-document/2024%20Hungarian%20Grand%20Prix%20-%20Race%20Director's%20Event%20Notes%20V2.pdf , https://www.fia.com/sites/default/files/decision-document/2024%20Hungarian%20Grand%20Prix%20-%20Event%20Notes%20-%20Circuit%20Map,%20Pit%20Lane%20Drawing%20and%20Red%20Zones.pdf
- RacingNews365 (2026 resurfacing): https://racingnews365.com/hungaroring-and-fia-confirm-overnight-track-repairs-after-f1-drivers-voice-concerns
- F1/Pirelli 2026 Hungary preview: https://www.formula1.com/en/latest/article/what-tyres-will-the-teams-and-drivers-have-for-the-2026-hungarian-grand-prix.RikSxOCPXMkPloK0RRmqQ
- Hungaroring rebuild: https://www.blackbookmotorsport.com/news/hungaroring-renovation-facilities-2026-f1-season , https://budappest.com/hungaroring-receives-international-praise-as-f1-officials-tour-renovated-facilities/ , https://www.f1technical.net/news/25198
- FIA 2026 Monaco GP Competition Notes + Circuit Map: https://www.fia.com/system/files/decision-document/2026_monaco_grand_prix_-_race_directors_competition_notes.pdf , https://www.fia.com/system/files/decision-document/2026_monaco_event_-_circuit_map_-_monaco_2026.pdf
- FIA 2025 Monaco GP Event Notes: https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_race_directors_event_notes.pdf
- Monaco chicane high-grip surface: https://us.motorsport.com/f1/news/monaco-gp-escape-road-chicane/4393845/ ; 2017 changes: https://www.planetf1.com/news/changes-to-monaco-include-swimming-pool-kerb , https://www.fia.com/sites/default/files/formula_one_monaco_grand_prix_2017_document_-_doc_2.pdf ; walk: https://monacolife.net/formula-one-walking-the-monaco-grand-prix-circuit/
- FIA 2025 Emilia Romagna GP Event Notes: https://www.fia.com/system/files/decision-document/2025_emilia_romagna_grand_prix_-_race_directors_event_notes.pdf
- FIA 2024 Emilia Romagna GP Event Notes: https://www.fia.com/sites/default/files/decision-document/doc_4_-_2024_emilia_romagna_grand_prix_-_race_directors_event_notes.pdf
- FIA 2022 Emilia Romagna GP Event Notes: https://www.fia.com/sites/default/files/decision-document/2022%20Emilia%20Romagna%20Grand%20Prix%20-%20Race%20Director's%20Event%20Notes.pdf
- Imola gravel 2024: https://www.gpblog.com/en/news/275982/changes-to-imola-circuit-with-more-gravel-beds.html , https://f1technical.net/news/24551 , https://www.gpfans.com/en/f1-news/1050030/f1-imola-grand-prix-2025-track-changes
- Buddh: https://www.motogp.com/en/news/2023/08/20/indian-gp-track-updates-from-the-fim-safety-officer/476264 , https://driven-international.com/buddh-international-circuit , https://motoringworld.in/?p=66082 , https://m.gpone.com/en/2023/03/14/motogp/motogp-wants-to-arrive-in-india-but-the-circuit-isnt-ready.html , https://desiracingco.substack.com/p/motogp-drcs-bharat-gp-preview , https://www.fia.com/news/indian-gp-race-preview , https://www.buddhinternationalcircuit.in/?p=11 , https://en.wikipedia.org/wiki/Buddh_International_Circuit , https://www.evoindia.com/motorsport/motorsport-news/indian-racing-festival-returns-to-buddh-international-circuit-587790
- OpenStreetMap contributors (ODbL), Overpass mirrors overpass.kumi.systems and maps.mail.ru, OSM API v0.6. Esri World Imagery tiles.
