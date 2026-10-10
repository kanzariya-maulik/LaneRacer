# LaneRacer `develop-op` Branch Documentation & Changelog

This document provides a comprehensive record of all features, enhancements, architecture changes, and bug fixes implemented in the **`develop-op`** branch.

---

## 1. Executive Summary

The `develop-op` branch brings major gameplay, visual, audio, networking, and UI modernizations to **LaneRacer**:
- **3 Experimental Circuits (`-x`)**: Precision mathematical geometry for `oval-x`, `ring-x`, and the symmetric 6-turn `track-x` (`bone-x`).
- **Dynamic Off-Screen Proximity Radar**: Real-time moving directional threat bubbles along screen boundaries with 100m range and automatic viewport occlusion filtering.
- **Driving Assist Modernization**: Locked 100% steering assist, instant `Q` toggle between saved brake percentage and 0%, and continuous hold-to-repeat `<` / `>` in-race adjustments (±10%).
- **Streamlined Lobby & Custom Circuit Selector**: Removed manual join barrier; automatic entry with default ready state, post-race ready retention, live profile syncing, and custom dropdown with monochrome minimap previews.
- **Visual & Immersion Upgrades**: FIA-style 3D DRS verge billboards, ghost-car proximity opacity fading, high-contrast minimap player dots, and sector/DRS track colorization.
- **Procedural Race Music & Audio Engine**: Built-in Web Audio procedural music generator with 5 selectable tracks and volume slider.
- **Retro 2D Battle Tanks LAN Specification**: Standalone architecture document for a networked 2D tank battle game based on retro classic mechanics.

---

## 2. Detailed Feature Breakdown

### 2.1. Experimental Circuits (`-x` Series)
Implemented mathematical track generators in [`scripts/create-custom-tracks.js`](file:///D:/LaneRacer/scripts/create-custom-tracks.js):
- **`oval-x` (Speedway Oval - X)**: High-speed oval with two long parallel straights ($9600\text{ m}$) connected by two banked semicircular hairpins ($R = 1800\text{ m}$).
- **`ring-x` (The Ring - X)**: Perfect circular speed ring ($R = 3000\text{ m}$) designed for constant high-speed cornering and slipstream battles.
- **`track-x` / `bone-x` (6-Turn Dogbone - X)**:
  - **Flipped Upside Down**: Longest straight (`Lan 1`, $7200\text{ m}$) placed at the top ($y = -2160$); shorter straight (`Lan 2`, $4800\text{ m}$) placed at the bottom ($y = +2160$).
  - **Clockwise Traversal**: Starts on top straight heading East ($+x$) and turns clockwise.
  - **Vertical Mirror Symmetry**: Left and right flanks are symmetric ($x \leftrightarrow -x$).
  - **Identical Turn Radii**: All 6 semicircles share an identical $R = 720$ ($120\text{ m}$) radius for full-speed F1 apex turning.
- **Testing**: Added [`test/customTracks.test.js`](file:///D:/LaneRacer/test/customTracks.test.js) with 12 tests verifying track geometry, apex alignment, symmetry, and simulation stability.

### 2.2. In-Race Assist Controls & Driving Mechanics
- **Steering Assist Locked to 100%**: The steering assist slider was removed from the lobby UI and locked permanently to 100% full assist for consistent handling.
- **Q Toggle (Brake Assist On / Off)**:
  - Toggles brake assist between **OFF (0%)** and **ON** (restores pre-race or saved percentage, default 100%).
  - HUD banner confirms: `BRAKE ASSIST: ON (100%)` or `BRAKE ASSIST: OFF (0%)`.
- **In-Race `<` and `>` Incremental Adjustments**:
  - Pressing `<` or `,`: Decreases brake assist by **-10%** (clamped to 0%).
  - Pressing `>` or `.`: Increases brake assist by **+10%** (clamped to 100%).
  - **Hold-to-Repeat**: Keeping `<` or `>` pressed down automatically steps by 10% every **120ms** after an initial 280ms threshold, eliminating the need to press and release repeatedly.
- **Release W to Brake Toggle**: Added `autobrake-select` option in My Settings (`on` = lift W triggers brake proportional to assist; `off` = coast).

### 2.3. Dynamic Off-Screen Proximity Radar
- **Viewport Occlusion Filtering**: If an opponent car is in front of the camera and visible inside the screen viewport, **no indicator bubble is shown**, keeping the view clean.
- **100m Range**: Tracks trailing or alongside cars within 100 meters.
- **Real-Time Edge Clamping**:
  - Smoothly raycasts to the screen bounding box in real time (60 FPS) based on the camera-relative direction vector.
  - If a car is behind on the left, the bubble sits at the bottom-left edge; as the car moves center or right, the bubble smoothly glides across the bottom boundary.
  - If an opponent pulls alongside outside the camera's FOV, the bubble slides up the side edge.
- **Indicator Visuals**:
  - Circular badge with border in that opponent's **team color** (`--team-color`).
  - 3-letter driver code in bold uppercase (e.g., `HAM`, `VER`, `NOR`) plus distance in meters.
  - Sharp directional pointer triangle revolving around the circle pointing toward the car's relative position.
  - **Danger State**: When an opponent is within 12m, the bubble pulses red (`.danger`).

### 2.4. Lobby Modernization & Custom Track Dropdown
- **Auto-Join Lobby**: Removed manual "Join ▶" requirement. Players enter the room immediately upon opening the page/socket connection with saved name and chosen team.
- **Default Ready State**: Drivers enter with `isReady: true` (`amReady: true`), displaying the green **"Unready"** button.
- **Post-Race Ready Retention**: Returning to lobby after a race automatically resets all players to ready by default on both server and client.
- **Live Debounced Profile Syncing**: Editing your name in the input box auto-saves and syncs to the server via debounced `update_profile` without needing a "Save" button.
- **Lobby Track Card**: Displays a dedicated canvas minimap of the currently selected track and circuit title above the session panel.
- **Custom Interactive Track Dropdown**: Replaced the native `<select>` with a custom dropdown featuring monochrome canvas thumbnails of each circuit layout (clean white line, start dot, no sector clutter).
- **Track Preview Data**: Created [`scripts/build-track-previews.js`](file:///D:/LaneRacer/scripts/build-track-previews.js) to generate [`public/tracks-preview.json`](file:///D:/LaneRacer/public/tracks-preview.json) containing layout vectors for all 20 circuits.

### 2.5. Minimap & 3D Visual Upgrades
- **Minimap Player Visibility**: Multi-pass rendering ensures opponent discs have high-contrast dark outlines, while the focus car has a soft glow, white ring, team fill, and directional heading chevron.
- **3D DRS Billboards**: Verge-mounted FIA-style 3D DRS boards placed at each DRS activation line facing oncoming cars.
- **No-Collision Ghost Car Fading**: In ghost mode (`collisions: false`), overlapping nearby cars fade smoothly down to 12% opacity when under 10m to prevent visual clumping.
- **Minimap Sector & DRS Overlay**: Sector 1, 2, 3, and DRS zones colored cleanly on the full minimap canvas.

### 2.6. Procedural Race Music Engine
- Created [`public/js/audio/music.js`](file:///D:/LaneRacer/public/js/audio/music.js) using the Web Audio API (zero external audio files needed).
- 5 procedural tracks:
  1. *Synthwave Velocity* (128 BPM retro arpeggios)
  2. *Eurobeat Rush* (155 BPM high-tempo bassline)
  3. *Cyberpunk Overdrive* (135 BPM dark synth chords)
  4. *8-Bit Arcade Sprint* (144 BPM chiptune pulse waves)
  5. *Sunset Cruise* (108 BPM lofi chill chords)
- Independent music volume slider and track selector in player settings.

### 2.9. In-Race Reconnection & Browser Restart Persistence (P0)
- **Session ID Persistence**: Generates and preserves a persistent unique `lanrace.sessionId` in client `localStorage`.
- **60-Second In-Race Grace Period**: If a player accidentally refreshes, disconnects, or restarts their browser mid-race (`RACE` or `QUALIFYING`), their car slot, grid position, and lap progress are held in `gameInstance` for 60 seconds with neutral controls (`disconnected: true`).
- **Seamless Resume**: On reconnect, `join_lobby` matches incoming `sessionId` to the existing driver entry, remaps socket IDs across `state.players`, `gameInstance.players`, `gameInstance.index`, and `gameInstance.roster`, and immediately emits `game_init` allowing instant resumption of racing.
- **Explicit Race Abandonment (ESC Menu)**: Added a "Leave Race (Abandon)" action (`#btn-leave-race` in `#session-panel`) sending `abandon_race`. This immediately retires the player as permanent DNF, prevents rejoining the race, and moves them to spectator mode.

### 2.10. Turn Arrow Indicators Removed (Per User Preference)
- **Complete Removal**: In response to user feedback, all turn arrow / chevron indicators along track curves have been completely removed from `public/js/game3d.js` to preserve clean circuit visibility without visual clutter.
- **Clean Horizon & Apex Sightlines**: Drivers have unobstructed sightlines to track apexes, curbing, and verge markers.


### 2.11. Hidden Penalties Host Setting (P3)
- **Host Toggle**: Added `hidePenaltiesDuringRace` setting (default: `false`) in lobby host controls and backend settings.
- **In-Race Concealment**: When enabled, time penalty additions (+5s, +10s) are masked from the driver's HUD and timing tower (`+Xs pen` hidden) so drivers stay focused on racing.
- **Investigation Alerts**: Critical incident warnings are preserved in all modes (track limits cuts, jump starts, collisions) displaying neutral FIA-style banners ("INCIDENT UNDER INVESTIGATION / INCIDENT NOTED").
- **Final Classification Reveal**: Complete time penalties are applied and revealed in full on the post-race classification screen.

### 2.12. Compact Top-Row Lobby Track Minimap (P2)
- **Header Placement**: Relocated the large central track preview card to the top row header alongside host settings (`.lobby-track-card-compact`).
- **96x58 Canvas Preview**: Sleek compact canvas preview with track name badge, maintaining clean information hierarchy in the lobby.

### 2.13. Off-Screen Proximity Radar Enhancements (P2)
- **Extended 200m Range**: Tracks trailing and alongside opponent cars up to 200 meters.
- **Interpolation Smoothing**: Exponential lerping applied to screen boundary coordinates (`x`, `y`), rotation angle, and scale factor to eliminate edge jitter.
- **Far-Distance Pips (105m–200m)**: Renders as a compact glowing dot (`.bubble-dot`) without driver code or distance text, keeping the viewport uncluttered.
- **Dynamic Scale Growth**: Smoothly scales up to **1.35x** when opponents are within 25m, triggering pulsing red danger rings when within 12m.

### 2.14. 3D Car Visual Upgrades: Suspension, DRS, Tire Smoke & Shadow Clean (P3)
- **Eliminated Black Under-Car Sheet**: Removed legacy `blobShadow` plane geometry that previously became an opaque black rectangular sheet due to material traversal opacity flags.
- **Dynamic Suspension Pitch & Roll**:
  - Acceleration squat (rear compresses, nose pitches up $+z$).
  - Braking dive (front dips down $-z$).
  - Centripetal body roll leaning away from turns based on steering angle and lateral velocity.
- **Articulated DRS Rear Wing**:
  - Rear wing flap (`rw_flap`) separated into an independent Three.js mesh group (`drsWing`) pivoting at `[-2.25, 0.91, 0]`.
  - Flap physically rotates and snaps open horizontally when DRS is active (`s.drs`).
- **Instanced Tire Smoke System (Fixed & Enhanced)**:
  - Fixed camera frustum culling (`frustumCulled = false`) so particles render reliably across the circuit.
  - Increased particle pool to 140 billboarded instances with a dense 128px soft radial texture.
  - Responsive slip triggers:
    - Standing launch / hard acceleration burnout from rear tires.
    - Turning tire slip and drift slides (emits from both rear wheels and outer front wheel during hard cornering).
    - Heavy braking lockups (emits from front wheels).
    - Handbrake drift slides.

### 2.15. Host Editable Max Speed & Acceleration Controls (Host-Only)
- **Host-Only Writable Inputs**: Added dedicated numeric inputs in `#host-settings` inside `#lobby-panel` allowing the room host to specify custom **Max Speed (100–600 km/h, default 340)** and **Acceleration (20–500%, default 100%)**.
- **Host Security Enforcement**:
  - Inputs are only visible and editable when `clientState.isHost` is true; hidden for guest racers.
  - Server verifies `socket.id === state.hostId` in `update_settings` and rejects updates from non-host clients.
  - Settings are live-synced to all lobby participants in the read-only settings list (`settings-view`) and `#session-summary` banner chips.
- **Physics Integration**:
  - `carphysics.js`: Scales engine power and tyre traction proportionally with `accelMul` (`accel / 100`) while preserving balanced lateral grip on the friction circle.
  - Aerodynamic drag dynamically scales (`(340 / targetMaxKmh)^3`) for target speeds above 340 km/h to allow natural top speed attainment up to 600 km/h, with a strict top speed governor ceiling.
  - Seamlessly synced with client-side prediction (`Predictor`) so custom acceleration and vmax execute without network jitter or snap corrections.
  - Fully tested: 0-100 km/h accelerates in ~1.4s at 200% power, reaches 500+ km/h when uncapped, or caps cleanly when low vmax is chosen.

### 2.16. In-Lobby Engine Sound & Music Play/Test Controls
- **Engine Sound Style Preview**: Added a `▶ Test` button beside the engine style dropdown (`#engine-type-select`).
  - Triggers a realistic 2.6-second live engine rev simulation showcasing the selected profile (`v8`, `v6`, `muscle`, `screamer`, `rotary`):
    - 4,500 RPM idle rumble.
    - Full throttle acceleration climbing to 17,500 RPM.
    - Rev limiter stutter and exhaust pop.
    - Throttle lift deceleration with overrun crackle.
  - Clicking again stops the rev early; button dynamically toggles between `▶ Test` and `■ Stop`.
- **Background Music Preview**: Added a `▶ Test` button beside the Race Music dropdown (`#music-select`).
  - Plays the selected procedural soundtrack in real-time (`synthwave`, `eurobeat`, `cyberpunk`, `arcade`, `lofi`).
  - Seamlessly switches tracks when changing the dropdown during playback.
  - Toggles between `▶ Test` and `■ Stop` (`.playing` indicator).
- **Simultaneous Test Capability**: Both engine sound and background music can be tested simultaneously to audition acoustic balance before launching into a race.

---

## 3. File Map & Key Changes

| File | Type | Changes Description |
|---|---|---|
| [`public/index.html`](file:///D:/LaneRacer/public/index.html) | Markup | Compact top-row lobby track card, hidden penalties host select, leave race abandon button. |
| [`public/css/style.css`](file:///D:/LaneRacer/public/css/style.css) | Styles | Compact lobby track preview styling, radar dot and 1.35x scaling styles, abandon race button. |
| [`public/js/app.js`](file:///D:/LaneRacer/public/js/app.js) | Frontend Logic | Host hidden penalties toggle sync, persistent sessionId generation, leave race event trigger. |
| [`public/js/socket.js`](file:///D:/LaneRacer/public/js/socket.js) | Socket Client | Sends sessionId on join, handles hidden penalty banner notices, abandon race dispatch. |
| [`public/js/carShape.js`](file:///D:/LaneRacer/public/js/carShape.js) | 3D Geometry | Separates `rw_flap` from body mesh; exports `drsFlapArrays` with pivot offset. |
| [`public/js/carModel.js`](file:///D:/LaneRacer/public/js/carModel.js) | 3D Car Model | Builds `drsWing` group with `drsFlapGeometry` mounted to root. |
| [`public/js/game3d.js`](file:///D:/LaneRacer/public/js/game3d.js) | 3D Engine | LED turn chevron boards, instanced tire smoke system, suspension pitch/roll, DRS animation, radar smoothing/scaling. |
| [`src/lobby.js`](file:///D:/LaneRacer/src/lobby.js) | Backend Lobby | Added `hidePenaltiesDuringRace` setting sanitization and defaults. |
| [`src/socketManager.js`](file:///D:/LaneRacer/src/socketManager.js) | Server Sockets | In-race reconnect grace period, sessionId matching & socket remapping, abandon race handling. |
| [`src/game/Game.js`](file:///D:/LaneRacer/src/game/Game.js) | Physics & Rules | Hidden penalty mode investigation broadcasts for track limits, jump start, collisions. |
| [`test/socketManager.test.js`](file:///D:/LaneRacer/test/socketManager.test.js) | Unit Tests | Added unit test verifying in-race reconnection with sessionId and race abandonment. |

---

## 4. Verification & Test Results

- **Unit Test Suite**: Ran `npm test` across all 35 test files.
- **Pass Rate**: **686 passing, 0 failing, 0 regressions** (`1..686`).
- **Syntax Validation**: Checked all JavaScript files with `node -c` (exit code 0).

---

## 5. Recommended Git Commit Message

```git
feat: add experimental tracks, off-screen radar, assist controls, lobby auto-join and music

- Tracks:
  - Add oval-x, ring-x, and symmetric 6-turn track-x (bone-x) with clockwise traversal
  - Build scripts/create-custom-tracks.js and public/tracks-preview.json
  - Add 12 unit tests in test/customTracks.test.js verifying geometry and physics

- In-Race Assists & Controls:
  - Lock steering assist to 100% and streamline lobby assist slider
  - Implement Q toggle to switch brake assist between saved value and 0%
  - Implement < and > key controls with hold-to-repeat (10% step per 120ms)
  - Add release W autobrake toggle in player settings

- Off-Screen Proximity Radar:
  - Replace static bottom radar with dynamic real-time edge-tracking bubbles (100m range)
  - Filter out cars visible within camera viewport
  - Render circular avatar with team color border, 3-letter driver code, and directional pointer

- Lobby & UI Modernization:
  - Remove manual join button; auto-join on load and set ready by default
  - Preserve ready state when returning to lobby post-race
  - Debounce driver profile updates live to server
  - Add lobby selected track canvas card and custom dropdown with track previews
  - Enhance minimap player dots contrast and add 3D verge DRS billboards

- Audio & Standalone Specs:
  - Implement procedural Web Audio music engine with 5 tracks and volume control
  - Add docs/plan/battle_tanks_lan_architecture.md for 2D retro tank game
```
