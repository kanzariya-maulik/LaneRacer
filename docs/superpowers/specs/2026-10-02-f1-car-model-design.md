# LanRace F1 Car Model — Design Spec

Date: 2026-10-02
Status: Approved in chat (look, approach, parts 1–2), pending written-spec review
Builds on: `scripts/build-car.py`, `scripts/paint-liveries.py`, `scripts/car_parts.py`, and the wheel batch and quality levels in `public/js/game3d.js`

## Goal

Replace the boxy car with one that reads as a modern (2022+, ground-effect era) F1 car. All 11 liveries repaint automatically, and 20 cars still run at 60 fps on integrated graphics. This is a visual change only: physics, collisions and the network stay the same.

## Decisions

| Topic | Decision |
|---|---|
| Look | Modern F1, 2022+ ground-effect era |
| How it's built | Rebuilt procedurally in the same Blender script (`npm run build:car`), with the same 15 part names, so `paint-liveries.py` repaints every team |
| Budget | At most 8,000 body triangles per car. Wheels stay as the two shared instanced batches (tyre and rim) |
| Size | Same footprint as now: about 5.6 m × 2.0 m, under 1.05 m tall. Wheel centres and the 0.36 m radius are unchanged |

## 1. Geometry (`scripts/build-car.py`)

Axes as now: X forward, Y left, Z up, metres; origin at the centre between the axles at ground level.

A new helper, `section_loft(part, sections)`, builds a solid by lofting a list of cross-sections along X. Each section is `(x, [(y, z) …])`, a closed profile with the same vertex count for every section, mirrored in Y. It is used for the curved parts. Flat aero elements use a new `wing(part, …)` helper: a cambered aerofoil profile extruded along Y, with optional sweep and twist toward the tips.

Parts:

| Part | Shape |
|---|---|
| `nose` | Narrow, rounded profile (8–10 point sections) from the chassis bulkhead at x 1.35 down to a tip at x 2.72, about 0.10 m wide, dropping onto the front wing |
| `chassis` | Cockpit tub: a rounded top, a cockpit opening cut-out (an inset dark lip, as geometry, not a boolean), and a higher sidewall rim at the driver |
| `sidepods` | Lofted per side: inlet at x 0.55 (tall, narrow mouth), an undercut that tucks the lower edge inward, and a downwash ramp sloping to the floor by x −1.2 |
| `engine` | Engine cover lofted from the airbox (above the helmet, roll hoop with intake) narrowing to a slim tail at x −1.75; gearbox and crash structure behind |
| `fin` | Thin shark fin along the engine cover spine |
| `floor` | Plank-level floor with a raised outer edge (edge wing) and a diffuser rising at the rear; front and rear wishbone arms as thin tapered struts to each wheel |
| `halo` | Smooth tube: two side arms curving over the cockpit into a centre pillar on the chassis (swept circle, about 14 sections) |
| `helmet` | Sphere (16×10) with a darker visor band, painted by the livery |
| `fw_main`, `fw_flap` | 4 elements total (main plane plus 3 flaps), cambered, stepping up and back, curling up toward the endplates |
| `fw_end` | Curved endplates joining the element tips |
| `rw_main`, `rw_flap` | Upper rear wing (main plane plus DRS flap) with a spoon-shaped centre, and a beam wing below it |
| `rw_end` | Rear endplates curving into the upper wing tips |
| `rw_pillar` | Single swan-neck pillar from the crash structure to the main plane |
| Mirrors | Two small mirror pods on short stalks beside the cockpit, tagged `chassis` so the livery paints them |

Wheels (unchanged contract; `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`, origin at the tyre centre):
- **Tyre:** a 32-segment cylinder with a rounded shoulder (bevelled), low-profile 18-inch proportions, front width 0.30 m and rear 0.40 m. Sub-mesh order stays tyre then rim, because the wheel batch in `game3d.js` depends on it.
- **Rim:** a flat wheel-cover disc (2022 style), slightly inset, with the same `rim` material.

Smoothing:
- An angle-limited bevel, as now.
- Shade smooth with auto-smooth at 35°, so curved parts read as curved without extra triangles.
- No subdivision surface modifier (the triangle budget).

## 2. Liveries (`scripts/paint-liveries.py`)

- The painting logic is unchanged: masks by part id and position bands.
- Position bands tuned to the old shapes (for example stripe heights on the engine cover, or nose tip ranges) are re-checked against the previews. Only values are adjusted; there are no new painting features.
- The bake's sanity mask in `build-car.py` (`|x| < 2.95`, `|y| < 1.0`, `0 < z < 1.05`) still holds for the new geometry.

## 3. Checks

`npm run build:car` exits non-zero if:
- body triangles exceed 8,000;
- any part id from `PARTS` is missing from the bake (as now);
- the body's bounding box exceeds X ±2.95, Y ±1.0, Z 0–1.05 m;
- a wheel origin moves from (±1.60 / −1.85, ±0.80 / ±0.78, 0.36) by more than 1 mm, or the radius changes.

`npm run build:liveries` writes previews to `refs/renders/` (front, side, top and three-quarter per team) for the user to review before the model ships.

In-game (headless, `?stats=1`):
- Medium and High with 20 cars: 60 fps, draw calls within ±2 of before.
- No console errors.
- Ghost transparency in qualifying, blob shadows on Low, and the wheel batch all still work.

The existing `npm test` suite keeps passing. No test relies on the mesh itself; `test/assets.test.js` checks that the files exist.

## Out of scope

Level-of-detail models, team-specific body shapes (every team shares one body, as now), cockpit interior, animated suspension, real team logos or sponsor branding, and driver arms or steering wheel.
