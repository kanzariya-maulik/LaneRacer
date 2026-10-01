# LanRace Real Grids, Pit Lanes & Garages — Design Spec

Date: 2026-10-01
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `2026-10-01-3d-f1-design.md`, `2026-10-01-f1-physics-quali-design.md`

## Goal

Each of the five circuits (Monza, Spa, Silverstone, Suzuka, Sakhir) gets its real pit lane, a race grid at the real start line on the real pole side, and 11 team garages. Qualifying starts from the garages, with an automatic 80 km/h pit limiter; the pit lane is usable (entry and exit) in qualifying and the race.

## Decisions

| Topic | Decision |
|---|---|
| Pit lane geometry | Imported once from OpenStreetMap, aligned to TUMFTM track data, stored in `data/tracks/<id>.json`. No runtime internet. |
| Missing facts (start line, pole side, garage side, limiter lines) | Hand-researched per circuit in `data/tracks/circuits.json`, with sources; unconfirmed values flagged. |
| Pit usage | Exit and entry, quali and race. No pit stops. |
| Speed limit | Automatic limiter, 80 km/h, all circuits. No penalties. |
| Garages | 11 (10 teams in 2022 constructors' order + Suzuka special last), 2 boxes each. |
| Quali start | From own garage box; out-lap; first line crossing after pit exit starts timing. Entering pits cancels the current timed lap. |

## Feasibility (verified 2026-10-01)

OSM API (`/api/0.6/map?bbox=…`) returned raceway ways for all five circuits. Robust ICP (trimmed, median metric) aligned OSM to TUMFTM centrelines:

| Circuit | OSM pit way | Median fit | Length | Distance to TUMFTM row 0 |
|---|---|---|---|---|
| Monza | 38168747 "Pit Lane" | 1.41 m | 737 m | 18 m |
| Spa | 323851541 "Pit Lane" | 1.75 m | 717 m | 15 m |
| Silverstone | 227902927 "International pit lane" | 1.94 m | 1125 m | 28 m |
| Suzuka | 120917578 "Pit Lane" | 1.20 m | 886 m | 14 m |
| Sakhir | 187123422 "Pit Lane" | 1.97 m | 771 m | 16 m |

TUMFTM frames are north-up (fitted rotations within ±2.1°). Silverstone needs translation grid search for the initial guess (many overlapping layouts in OSM).

## 1. Data

### `scripts/import-pits.js` (one-off, outputs committed)
1. Fetch OSM map data per circuit bbox (bboxes stored in the script).
2. Robust ICP alignment (trimmed Procrustes, median distance); fail if median > 5 m.
3. Select the pit way by OSM id (table above).
4. Orient entry→exit using driving direction (pit lane direction must agree with the nearest track segment's direction).
5. Resample every 5 m, convert to game units (× SCALE, y flipped as in `import-tracks.js`), write `pit: { path, width }` into the track JSON. `width` = 12 m × SCALE.
6. Attribution: `"attribution": "Pit lane © OpenStreetMap contributors (ODbL)"` in each track JSON.

### `data/tracks/circuits.json`
Per track id: `{ startLineM, poleSide: 'left'|'right', garageSide: 'left'|'right', limiterStartM, limiterEndM, sources: [..], unconfirmed: [..] }`.
- `startLineM`: distance along the TUMFTM centreline from row 0 (m, may be negative).
- `poleSide`: side of pole position facing the start direction.
- `garageSide`: side of the pit lane (facing pit exit) the garages are on.
- `limiterStartM/EndM`: distances along the pit path (m) of the pit entry and pit exit speed-limit lines.
- Researched from F1.com circuit maps / Wikipedia / FIA documents; anything not confirmed is listed in `unconfirmed` and reported to the user.

### `src/game/Track.js` derivations
- `startS` = startLineM × scale along the loop; checkpoint 0 and lap timing at `startS` (other checkpoints evenly spaced from it).
- Grid: 20 slots at `startS − (i+1)·8 m`, alternating starting from `poleSide`, lateral offset ±width/4.
- Garages: 11 garages along the garage side of the pit path, centred on the pit point nearest the start line, 18 m pitch; each with 2 boxes (`{x, y, angle, teamId}`), angle = pit direction. Order: redbull, ferrari, mercedes, alpine, mclaren, alfaromeo, astonmartin, haas, alphatauri, williams, redbull-suzuka.
- Limiter zone: pit path indices covering `[limiterStartM, limiterEndM]`.
- Pit wall: the track-side edge of the pit path within the limiter zone.

## 2. Server behaviour

- **Surface:** on asphalt if within width/2 of the centreline OR within pitWidth/2 of the pit path. Off-track (grass) otherwise.
- **Wall:** outside if beyond the run-off corridor of the centreline AND beyond pitWidth/2 + 2 m of the pit path → existing wall response.
- **Pit wall:** within the limiter zone, a car crossing the pit path's track-side edge (from either side) is pushed back to the side it came from, with the existing wall response (velocity component into the wall removed, impact-angle speed loss).
- **Limiter:** inside the limiter zone, forward speed clamped to 80 km/h every tick. `game_state` gains `inPit` (bool) and `limiter` (bool).
- **Quali:** cars spawn at their team's garage box (box 0/1 by join order within team), at rest, facing pit exit. `checkpoint` state such that checkpoint 0 is the next target; while `inPit`, crossing checkpoint 0 does not start or record a lap; entering the pit lane during a timed lap sets `lapStart = null` (lap cancelled). First crossing after leaving the pit starts timing.
- **Race:** grid from `Track.startPositions` (now real). Pit lane open; laps count when crossing checkpoint 0 in the pit lane. Collisions apply in the pit lane.

## 3. Client

- Pit lane strip (asphalt + white edges), entry/exit painted lines, PIT IN / PIT OUT boards, limiter-zone boards, grey pit wall.
- Garage buildings (18 × 5 m, open front, team-colour façade, text sign with team name, 2 box markings each).
- Grid boxes with position numbers; start line at the real position.
- HUD: "PIT LIMITER 80" badge when `limiter`; minimap draws pit lane; session bar shows "OUT LAP" in quali before the first timed lap.

## Testing

`npm test` (node:test):
- Track data: every pit path lies parallel to and within 40 m of the start straight's centreline over the limiter zone, ends connect to the track (within width/2 + 15 m of the centreline), median OSM fit ≤ 5 m recorded at import.
- Grid: 20 slots behind the start line, first slot on `poleSide`, alternating, ≥ 2× car length apart in each column, all on asphalt.
- Garages: 22 boxes, all within the pit area, in team order along the pit path, inside the limiter zone.
- Behaviour: limiter clamps to 80 km/h at full throttle; off after pit exit; pit lane is not grass; pit wall blocks a shortcut from the straight; quali car starts at its garage box at rest; first timed lap starts after pit exit; entering pits cancels the timed lap; race lap counts through the pit lane.
- Manual (browser): quali start from garages and race grid on all 5 circuits, screenshots.

## Out of scope

Pit stops, tyres, penalties, pit-lane speeding detection beyond the limiter, real garage buildings/branding, Monaco or other circuits.
