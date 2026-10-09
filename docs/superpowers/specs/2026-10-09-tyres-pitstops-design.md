# LanRace Tyres, Pit Stops & Pit Lane Rebuild — Design Spec

Date: 2026-10-09
Status: Approved in chat (sections 1–4), pending written-spec review
Builds on: `2026-10-01-pitlane-grid-design.md`, `2026-10-01-f1-physics-quali-design.md`, `2026-10-02-netcode-prediction-design.md`

## Goal

Races where strategy matters: drivers choose tyre compounds, tyres lose grip as they wear, and drivers decide when to pit. One stop is the expected strategy and two stops on softs is viable, whatever the lap count. Pit stops are real: drive into the pit lane, the car is guided into the team's box, tyres are changed, the car is released. The pit lane on all 14 circuits is rebuilt so it never overlaps the racing surface, looks smooth, and costs no more to run or draw than today.

## Decisions

| Topic | Decision |
|---|---|
| Tyre depth | F1-lite: Soft / Medium / Hard; grip falls with wear (cliff near the end); no temperature, no per-wheel wear |
| Wear rate | Auto-scaled to race length: a soft lasts ~40 %, a medium ~65 %, a hard ~90 % of the race. Host setting `tyreWear: true / false` (default true) |
| Compound rule | Races of ≥ 2 laps: a finisher who used only one compound gets +22 s (about one stop's time loss) |
| Pit stop control | Driver drives into the lane; limiter automatic; near the team box the car is guided in, held 2.5 s (+0–0.4 s) while tyres change, then released |
| Tyre physics location | Shared simulation (`public/js/sim/`), so the server and the client prediction compute identical grip |
| Pit lane geometry | Real garage lane kept; entry and exit rebuilt in `Track.build` as smooth connectors that only touch the road at its edge; continuous pit wall between lane and track |
| Pit entry barrier | Removed (pit lane open in race and qualifying) |

## 1. Tyre model (`public/js/sim/tyres.js`, new, pure)

- `COMPOUNDS = { S: { grip: 1.06, life: 0.40 }, M: { grip: 1.00, life: 0.65 }, H: { grip: 0.95, life: 0.90 } }`. `grip` multiplies `C.MU`; `life` is the share of race distance one set lasts at a typical racing pace.
- Wear `w` ∈ [0, 1] per stint. Grip from wear: `gripOf(compound, w) = compound.grip × (1 − 0.0375 × min(w, 0.8) − cliff)`, where `cliff = 0.09 × ((w − 0.8) / 0.2)²` for w > 0.8, giving −3 % at 0.8 and −12 % at 1.0. Wear is clamped at 1.
- Wear per tick: `dw = |v| dt / lifeM × load`, where `lifeM = life × raceDistanceM` and `load = 1 + 0.6 (a_lat / a_lat,max)² + 0.4 (brake) + 0.8 (slip)`. Slip is the existing slide / wheelspin measure in `carphysics.js`. `load` is normalised by `LOAD_TYPICAL`, a constant calibrated so a racing-line lap averages `load / LOAD_TYPICAL = 1`.
- `raceDistanceM = maxLaps × lap length`. In qualifying the same per-metre rate as the race is used (same `maxLaps`). With `tyreWear: false`, `dw = 0`.
- `carphysics.step` multiplies its grip constant by `p.tyreGrip` (1 when absent, so tests and old callers are unchanged). `drive.js` updates `p.wear` and `p.tyreGrip` each tick from `p.compound`.

## 2. Pit stop flow

State per car: `compound`, `nextCompound`, `wear`, `stops`, `compoundsUsed` (set), `stop` = `null | { phase: 'guide' | 'service' | 'hold', t }`, `servicedLap` (lap of the last stop).

1. **Entry:** the closing barrier and the "PIT CLOSED" board are removed. On the lane, the existing `updatePitState` applies: the limiter is engaged between the limiter boards.
2. **Guide:** when a car on the lane, not finished, with `servicedLap !== lap`, is within 12 m (along the lane) before its team box and the driver is braking (brake > 0.2) or below 40 km/h, `stop.phase = 'guide'`. Steering and braking come from a shared function `guideToBox(p, box)`: follow the lane, turn into the box, stop on its mark in ~1 s. Driver inputs are ignored.
3. **Service:** stationary on the mark → `phase = 'service'`, `t = 2.5 + rng × 0.4` s (server rng, value sent to clients). At the end: `compound = nextCompound || next harder (S→M→H→M)`, `wear = 0`, `stops++`, `compoundsUsed.add(compound)`, `servicedLap = lap`.
4. **Hold / release:** `phase = 'hold'` while another car is in the lane within 10 m behind the box and moving (unsafe release), at most 0.5 s extra, then `stop = null` and the driver has control at zero speed.
5. **Drive-through:** passing the box without braking (at the limiter speed) starts no guide: no service, the driver simply loses time.
6. **Lap progress:** unchanged. `trackPos` already maps lane positions onto the lap, so gaps, ranks and the line crossing work in the lane.
7. **Qualifying:** entering the pits cancels the current timed lap (unchanged). A stop in the box services the car exactly as in a race (new set of `nextCompound`, `wear = 0`); the next run starts with the out-lap from the pit exit as today.
8. **Penalty:** at the finish, a race with `maxLaps ≥ 2` and `tyreWear` on adds 22 s to any finisher with `compoundsUsed.size < 2` (applied through the existing `penalty` field, announced in chat like track-limit penalties).
9. **Edge cases:** finished cars are not serviced; a disconnected car mid-stop stays parked as today; a car can't be serviced twice on the same lap.

Inputs: a new client message field `next: 'S' | 'M' | 'H'` (sanitised in `lobby.js`), sent on keys 1 / 2 / 3 (Q is the assist toggle, W throttle, E DRS) or on a HUD tap; the start compound is chosen in the lobby (default M).

## 3. Pit lane geometry (`src/game/Track.js` `buildPit`)

- **Garage lane:** the stored lane (`raw.pit.path`) between the points where it first and last runs clear of the drawn road edge by `PIT_CLEAR_M` (wall + 1 m). The stretch alongside the garages is unchanged.
- **Connectors:** entry and exit are each a cubic Bézier from a point on the drawn road edge (heading = the track's, at the lane's real branch-off lap distance) to the garage lane's first / last clear point (heading = the lane's), with handle lengths chosen so the minimum radius is ≥ 30 m. The lane width tapers from 0 to full over the first 20 m of the connector, so the asphalt joins the road along its edge only. If a candidate curve comes within `PIT_CLEAR_M` of the road anywhere but its first / last 20 m, the branch-off point moves further from the garages (5 m steps) until it doesn't.
- **Result:** `pit.path` (connector + lane + connector, every ~5 m, smooth), `pit.widthAt[]` (taper), plus the existing `entryS`, `exitS`, `cum`, garages, boxes and limiter. `closeS` / `closeWall` are removed.
- **Walls:** `pit.wall` covers the whole track side of the lane except the two taper zones; drive.js stops cars crossing it either way (as the pit wall today). The outer wall stays.
- **Physics:** "on the lane" = within `widthAt/2` of `pit.path`; the road keeps priority in the taper zones only. Grass never applies on the lane.
- **Speed:** `nearestOnPath` on the lane gets a hint (search ±10 points around the car's last lane index, full search as fallback), as the track already has.
- **Rendering (`game3d.js buildPit`):** one merged mesh each for the lane asphalt, its painted lines (edges, blend lines, box marks), walls and boards; garages stay instanced. Same draw-call count as today.

## 4. Network & HUD

- **Fast packet:** per car `+ wear (0–255)` and `+ stop code` (0 none, 1 guide, 2 service, 3 hold) with service time left in 0.1 s. The predictor loads `wear` / `compound` like position, so predicted grip matches the server.
- **Meta (on change):** `compound`, `nextCompound`, `stops`, `compoundsUsed`.
- **HUD:** compound chip (S red, M yellow, H white) and wear bar (red past 80 %) beside the gear panel; "NEXT: M" under it; "BOX — 2.4 s" countdown and "GO" during stops; compound letter and stop count in the timing tower.
- **Lobby:** host setting "Tyre wear: On / Off"; each driver's start compound.

## Testing

- `tyres.test.js`: grip curve (−3 % at 0.8, −12 % at 1.0), compound order, auto-scaled life (a soft driven on the racing line lasts 40 ± 5 % of the race for 3, 10 and 30 laps), slides wear faster than clean driving, `tyreWear: false` means no wear.
- Shared-sim parity: `driveCar` with tyre state on server and client copies stays bit-identical (existing JSON round-trip test extended).
- Pit flow, every circuit: a scripted car enters the lane, is guided into its box, serviced (compound and wear change, ~2.5–2.9 s stationary), released and exits back onto the track; lap counting stays correct; a drive-through gets no service; the one-compound penalty applies or not.
- Geometry, every circuit: no lane point within the road except the taper zones; connector minimum radius ≥ 30 m; the lane never crosses itself or another stretch of track; every box is on the lane; the pit wall covers everything but the mouths.
- Golden physics trace re-recorded once (grip factor 1.0 for a fresh medium), after confirming the change against it.
- Real game in a browser on two circuits: enter, stop, exit, HUD.

## Out of scope

Tyre temperature, per-wheel wear, punctures, refuelling, team strategy calls, AI cars, pit-crew animation.
