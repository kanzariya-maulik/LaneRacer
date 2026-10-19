# Real F1 cars: each team's own 2023 car, real liveries

Date: 2026-10-19. Status: draft for approval.

## Intent

LanRace's cars are drawn from our own procedural shape (`carShape.js` → `carModel.js`), one body for every team with a
painted livery. The user wants the grid to look like the real thing: every constructor racing its own real car shape in
its real livery, as in F1 23, without giving up any playing experience or graphics quality. It is a private game, played
by the user and friends on a LAN, never sold or published.

## Goals

- Each of the ten teams in `public/teams.json` races its own real car model, from free Sketchfab downloads, in its real
  livery. The eleventh entry (`redbull-suzuka`) is the Red Bull car in its own special livery.
- The models look as detailed in the game as they do on Sketchfab at the distances the game shows them (chase, T-cam,
  cockpit, the grid, the pit lane).
- Tyres from a real F1 tyre model, showing the compound (Soft / Medium / Hard markings) the car is on.
- A driver in every cockpit: helmet and shoulders, the helmet in the team's colours.
- Playing is unchanged: the same physics, handling, collisions, network, camera positions and HUD.

## Non-goals

- Pit crew models: no free usable F1 pit crew exists; the crew stays our own models (in team colours).
- Buying models (the user chose free only).
- Real driver names, numbers or helmets per real driver: the drivers are the players and bots.
- Damage, moving suspension, animated drivers.

## Anti-goals (a failure even if it works)

- Any frame-rate loss that shows: High must still hold the 120 Hz display (M1 Pro MacBook Pro) as it does now.
- A longer wait before a session's world appears than today (~1 s on Monza).
- Cars that look worse than the Sketchfab originals (blurry liveries, faceted bodies, missing wings).
- Using models ripped from EA's F1 games (Sketchfab uploads named `unpacked-*_lod_a`): not used, whatever their licence says.

## Constraints

- Free downloads only. Licences: CC Attribution or CC Attribution-NonCommercial(-ShareAlike) are fine for this private,
  non-commercial use; every model's author and licence goes on a credits screen in the game.
- Downloading: the Sketchfab API key is stored in the user's Blender ("MCP for Blender" add-on preferences); a headless
  Blender reads it from there. The key is never printed, logged, written to the repo or sent anywhere but Sketchfab.
- Blender 5.2.2 is installed at `/Applications/Blender.app`; the pipeline is a Blender Python script run headless.
- three.js r186 WebGPU renderer with WebGL2 fallback; the game's car frame: x forward, y left, z up, metres, origin
  between the axles on the ground (`carShape.js`); wheel centres and radius from `carShape.js` `WHEELS`, `WHEEL_RADIUS`
  (0.36 m), wheelbase 3.6 m, track 1.6 m (the sim's contact patches).
- Up to 22 cars on track at once.

## The models (decided)

| Team (`teams.json` id) | Model | Sketchfab uid | Licence | Faces |
|---|---|---|---|---|
| redbull, redbull-suzuka | Oracle Red Bull RB19 2023 | e4afe46f3aab4b23a418da06fc163821 | CC BY | 675k |
| mercedes | Mercedes F1 W14 [FREE!!] | 26fda66f3e8a48d5a636056f8a64e299 | CC BY | 232k |
| ferrari | Scuderia Ferrari F1 SF23 2023 | ecb0f812bc454331bbe721655b0780ec | CC BY | 713k |
| mclaren | McLaren MCL60 F1 2023 | 8340e27c325345e4aa92a6a31cc34b1e | CC BY | 742k |
| astonmartin | Aston Martin AMR23 S3 2023 (vecarz) | 4aff0e5da09c413d92a01a8f45a445ff | CC BY-NC | 253k |
| alpine | Alpine A523 2023 | e97c2bb620d8461c92a03d007d63188c | CC BY | 648k |
| alphatauri | AlphaTauri AT04 2023 | a8003f86f7a24dfbad6cbc1c90069eaf | CC BY | 691k |
| alfaromeo | AlfaRomeo F1 Team KICK C43 #24 | 6be2b9c98a9a4534b197c13dba9eeff6 | CC BY | 873k |
| williams | Williams FW46 (2024: no clean 2023 model) | 52418bf2132a4dc6b85aac0846630fc2 | CC BY | 694k |
| haas | 2026 Haas VF-26 (no clean free VF-23) | 1f41e03886724bc6acd16c92402989bc | CC BY | 276k |

Tyres: "F1 TYRES PACK 2022 - HARD - MEDIUM - SOFT" (307a0557dde44cf1a7f6f2d1958c383d, CC BY). Helmet: a free CC BY F1 helmet (e.g. "F1 Helmet
ZhouGuanyu 24", 1124fa1f754645d7b9d54de84009d463), repainted per team.

## Liveries (decided)

Keep each model's real livery. In Blender, repaint where the downloaded paint isn't the team's real 2023 livery:
Williams (2024 car → 2023 FW45 colours), Haas (2026 car → 2023 VF-23 colours), and the Red Bull Suzuka special. The
user also wants liveries made "original" in Blender where that makes them more realistic: authentic to the real team,
not invented designs.

## How (decided)

- A headless Blender script per model: download (the user's key), import, find the body parts and the four wheels,
  orient and scale to the game's car frame and real dimensions (wheel centres onto `WHEELS`), separate the four wheels as
  `wheel_FL/FR/RL/RR` (they spin and steer; the shared wheel batches draw them), repaint where needed, reduce the
  polygon count with the original's detail baked into normal maps, and export a GLB per team into the repo.
- Detail by distance (LODs): a near model for the close cameras and a far one for the rest of the grid; the game already
  switches detail by distance (`buildCar(detail, lodM)`, `CAR_LOD_M`).
- The game loads the team's GLB (three.js `GLTFLoader`) in place of the procedural body; the procedural car stays as the
  fallback when a GLB is missing or fails to load.
- Credits screen listing every model, author and licence.

## Calls made for the user (not their decisions; flagged for review)

1. **Proportions:** each model is scaled evenly (its real shape kept) so its wheelbase is real for its year; it stands
   on its own wheels on the ground at the game's origin (between the axles). The drawn wheels stay where the model has
   them; the physics contact patches (`WHEELS`, 3.6 m wheelbase, 1.6 m track) don't move. A few centimetres between
   drawn and physics wheels are invisible; a stretched body is not. The 2026 Haas stays shorter, as it really is.
2. **Budget versus detail:** the 8.3 ms gate wins, at the same detail on screen. Full detail for cars close to the
   camera (your own car and the few around you), the far version for the rest of the grid, chosen by distance, as the
   game does today. If that still misses the gate, the near distance shrinks before the near polygon count does.
3. **Livery scope:** repaints for Williams (2023 FW45 colours), Haas (2023 VF-23 colours) and the Suzuka special
   (the white and red Honda-tribute colours already in `carShape.js`). Any other livery that is obviously wrong for 2023
   in the screenshots gets fixed too and is listed. The user signs off on the liveries at the screenshot review.
4. **Cameras:** the same view of each real car, not the same numbers. Each GLB carries an eye marker at its driver's
   head; T-cam and cockpit use the team's own marker, and the in-game steering wheel follows the same way.
5. **A model that can't be used** (download disabled, an EA rip, beyond repair): find a replacement under the same rules
   (free, CC licence, not a rip), shown to the user at the review; until then the team keeps the procedural car.

## Measured gates

- Performance: Monza, High, 21 bots, headless (`scripts/browser-check.mjs --bots 21`): frame p95 at most 8.3 ms
  (today 7.4 ms), same procedure as the last optimisation.
- Load: session start to first drawn world on Monza no longer than today (~1 s headless).
- Looks: side-by-side screenshots of every car (chase, T-cam, cockpit, close orbit) against the Sketchfab original.

## Left to the builder

Polygon budgets per LOD, texture sizes and compression (KTX2/WebP), how textures are shared, how model files are stored
(repo size: the user accepted 20–40 MB of textures before), the loading strategy (all teams up front vs the teams on the
grid), the helmet/shoulders geometry, how the tyre compound markings are shown, and the credits screen's place in the UI.
