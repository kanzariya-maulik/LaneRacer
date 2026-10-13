# LanRace Onboard Cameras (T-cam + Cockpit) — Design Spec

Date: 2026-10-13
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `develop` at `5339a1c` (AI drivers, quali, box call)

## Goal

Race in first person like real F1 onboards and the F1 games: a T-cam above the driver's head and a cockpit view from the driver's eyes, with the halo, a working steering wheel and its display, and sharp shadows up close. Cycled with one key alongside the existing chase camera.

## What exists today

- Camera (`game3d.js` `updateCamera`): one chase camera 10 m back, 4 m up, heading smoothed; a TV pit camera blends in during your own service. `PerspectiveCamera(60, …, near 2, far Q.far)`; 1 m = 6 world units, so near ≈ 0.33 m and far up to 20 000 units.
- Car (`carShape.js` → `carModel.js`): procedural surfaces painted off-thread. Already has the halo (tube, 40 segments), helmet ellipsoid at (0.18, 0, 0.74), a flat carbon cockpit lid at z 0.628, mirrors on stalks at (0.74, ±0.56, 0.68), and the T-camera pod on the airbox at x 0.08…−0.02, z 0.955…0.985. No steering wheel.
- Shadows: one sun shadow map, box ±360 units (±60 m) round the followed car, moved in whole texels (`snapLight`); off on the Low level. Every car also has a blob contact shadow.
- Keys: `V` toggles "your car / watching" after you finish. `C` coach, `T` tower, `R` racing line, `Q` assist, `B` box, `M` mute, `1/2/3` tyres.

## Decisions

| Topic | Decision |
|---|---|
| Views | Chase → T-cam → Cockpit, cycled by one key; banner names the view (`CAMERA: COCKPIT`) |
| Key | `V` cycles the camera everywhere. The after-finish "your car / watching" swap moves from `V` to `F` |
| Touch | A camera button by the tyre card cycles the same views |
| Memory | Last view kept in `lanraceMem` (like the coach switch) |
| T-cam pose | Fixed to the car on the airbox pod (car frame ≈ (0.03, 0, 1.02)), looking forward and slightly down; follows the car's pitch and roll, no smoothing |
| Cockpit pose | Driver's eye ≈ (0.20, 0, 0.68) in car frame; FOV 75° (chase and T-cam keep 60°) |
| Followed car | Views apply to whichever car the camera follows (own car, spectated car, after-finish watch) |
| Pit stops | The TV pit camera blends in during service from any view, then hands back |
| Steering wheel | New three.js group in `carModel.js`: rectangular F1 rim with grips, ~0.27 m wide, at ≈ (0.45, 0, 0.66), face tilted back to the driver; turns with steering input, ±90° at full lock; two team-colour gloves on the grips |
| Wheel display | Canvas texture on the wheel face: gear (large), speed, rev-light strip, DRS lamp; redrawn at the HUD's 15 Hz |
| One instance | One wheel exists, parented to the followed car in cockpit view, hidden otherwise. Other cars unchanged |
| Helmet | Hidden for the followed car in cockpit view only (the eye is inside it); visible in T-cam |
| Close-up detail | Halo tube 40 → 64 segments; mirror faces get a dark glass material (no live reflection) |
| Depth | Two-pass "viewmodel" render in onboard views (below); chase unchanged |
| Shadows | Onboard views shrink the sun shadow box to ±120 units (±20 m), same map size; `snapLight` step follows; bias retuned once if the halo or wheel shows acne |
| HUD | Cockpit: `body.view-cockpit` hides the dash card's gear/speed/rev lights (the wheel shows them); lap times, tower, map, messages, coach, tyre card stay. T-cam: full HUD |

## Two-pass render (onboard views)

1. Pass 1: the scene with the main camera, as today (near 2 units). Shadow map updates here.
2. `renderer.clearDepth()`.
3. Pass 2: the scene with a second camera that copies the main camera's pose, FOV and aspect, near 0.06 units (1 cm), far 60 units (10 m), `layers` = 1 only. The followed car's meshes, the steering wheel and the lights (sun, hemisphere) are enabled on layer 1 (and stay on layer 0, so the car still casts its shadow and draws in pass 1). `renderer.shadowMap.autoUpdate` is off for pass 2, so it reuses pass 1's map.

Nothing can be between the driver's eye and their own car, so drawing it last over the world is always correct. Layer 1 is cleared from the old car when the followed car changes.

`renderer.autoClear` is turned off and the frame cleared explicitly once, before pass 1.

## Pure module: `public/js/views.js`

Shared by `game3d.js` and the node tests.

- `VIEWS = ['chase', 'tcam', 'cockpit']`, `nextView(v)` (unknown → `'chase'`).
- `onboardPose(view, car)`: car `{ x, y, z, heading, pitch, roll }` (world units, radians), returns `{ pos, fwd, up }`: the view's car-frame eye offset (× scale) turned into world space.
- `wheelAngle(steer)`: steering input −1…1 → wheel rotation, ±π/2 at full lock.
- `shadowHalf(view)`: 360 for chase, 120 for onboard views.
- `VIEW_FOV`: `{ chase: 60, tcam: 60, cockpit: 75 }`.

## Edge cases

- Low graphics level (no shadows): both onboard views still work, with only the blob shadow.
- Spectator joins or the followed car changes: the wheel and layer 1 move to the new car; the helmet of the previous car shows again.
- Car not yet built (`carTemplate` missing, box fallback): onboard views fall back to chase.
- Finished and watching: `V` cycles the view for the watched car; `F` swaps between your car and watching.
- Lobby / results screens: `V` does nothing.

## Testing

- Node tests for `views.js`: cycle order and unknown input; `onboardPose` at heading 0 and π/2, with pitch and roll, puts the eye at the right world point and the forward vector along the car; `wheelAngle` limits and sign; `shadowHalf` per view.
- Headless Chrome from the CLI (not the browser extension) against a local race: a screenshot in each view, with the halo, wheel and its display visible and unclipped, and no console errors.
- Full suite stays green.

## Out of scope

Live mirror reflections, camera shake and head movement under g, nose cam, adjustable seat position or FOV.
