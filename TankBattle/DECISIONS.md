# Project Decisions Log

This file records architecture decisions, deviations, or interpretations of the Battle City specification.

---

### Step 0 Decisions
- **Module System**: Using ES Modules (`"type": "module"` in `package.json`) to allow seamless sharing of `/shared` code (`sim.js`, `constants.js`, `rng.js`, `collision.js`) across Node.js server, tests, and browser client.
- **Server Architecture**: Lightweight Node.js HTTP static server + native `ws` WebSocket server on port 3000. Serves `/client` at root and `/shared` at `/shared`.
- **Canvas Scaling**: Integer upscale (Math.floor(min(windowWidth/256, windowHeight/240))) with fallback to 1x. Off-screen buffer is exactly 256x240 px, drawn to on-screen canvas with `image-rendering: pixelated` and `ctx.imageSmoothingEnabled = false`. Letterboxed pure black.
- **Directory Structure**: Structured cleanly per 11_LAN_MULTIPLAYER_ARCHITECTURE.md §12:
  - `/server`: Node server and lobby management
  - `/shared`: Deterministic sim, constants, maps, collision, RNG
  - `/client`: HTML, canvas rendering, procedural sprites, font, audio, UI
  - `/test`: Headless sim and golden deterministic tests

---

### Step 1 Decisions
- **Offscreen Canvas & Pixel Scaling**: Created 256x240 off-screen rendering pipeline blitted to on-screen canvas using `Math.floor` integer scaling factor, centered and letterboxed in pure black.
- **Embedded Bitmap Font**: Created embedded 5x7 monospaced glyph table within 8x8 cells (`font.js`) for completely offline LAN rendering without web font network requests.
- **Palette**: Consolidated the entire NES color palette in `shared/constants.js`.

---

### Step 2 Decisions
- **Procedural Sprite Atlas**: Pre-rendered all assets at boot using ASCII bitmaps:
  - Tanks: 16x16 with 3px treads, centered 2px/3px barrels, generated facing UP and rotated 90°/180°/270°. Animated treads swap tread color shades on alternating frames.
  - Palettes generated for P1 (Yellow), P2 (Green), Basic (Gray), Fast, Power, Armor (4 HP recolor tiers: Green -> Yellow -> White -> Gray), and Carrier (flashing Red).
  - Terrain: Brick cell (8x8 with 4 pre-cut 4x4 quarters), Steel (8x8 bevelled), Water (16x16, 2-frame wave shimmer), Trees (16x16 canopy), Ice (16x16).
  - Entities: Eagle (spread-wing alive & ruined graveyard), Bullet (4x4), Explosions (small 3-frame, big 3-frame 32x32), Spawn Star (4 sizes S1-S4), Shield bubble (2 frames), 6 Power-ups (Star, Helmet, Clock, Shovel, Grenade, Tank), HUD mini-tanks and flag.
- **Debug Sheet**: Integrated a sprite atlas debug sheet togglable with Key `3`.

---

### Step 3 Decisions
- **Map Model & Cell Quarters**: Implemented `GameMap` with `cellType` (26x26), `brickBits` (26x26, 4-bit quarter mask), `tileType` (13x13), and Eagle entity.
- **Quarter Collision**: Implemented exact 4x4 quarter AABB testing against tanks for authentic gap navigation.
- **Layered Draw Pipeline**: Strict 10-layer rendering order implemented in `Renderer.renderScene`: Black background -> Ice -> Animated Water -> Bricks/Steel/Eagle -> Powerup -> Tanks -> Bullets -> Explosions -> Trees (drawn above tanks) -> HUD.
- **Stage 1 Layout**: Reconstructed Stage 1 in `shared/stages/stage01.json` matching the reference screenshot (`docs/assets/battle_city_1.png`) with brick columns, fortress bowl, center steel and edge steel blocks.
- **Interactive Inspection**: Added key toggles in `client/main.js` (`1` = Stage 1 scene, `2` = Stage curtain, `3` = Sprite debug sheet, `WASD/Arrows` = move test tank).

---

### Step 4 Decisions
- **Mulberry32 PRNG**: Implemented 32-bit stateful deterministic PRNG in `shared/rng.js`.
- **Fixed-point Math**: Used 1/16 px integer coordinates (`x16`, `y16`) with bitshift `>> 4` for pixel rendering, completely removing float precision drift across platforms.
- **State Hashing**: Created `hashState()` method in `shared/sim.js` computing a fast 32-bit avalanche hash across tick, tanks, bullets, eagle status, and brick masks to verify determinism in headless test suites.

---

### Step 5 Decisions
- **Grid Snap on Axis Change**: When changing direction from horizontal to vertical, `x` is snapped to `Math.round(x / 8) * 8` if the destination is unblocked. When changing vertical to horizontal, `y` is snapped. Reversing along the same axis preserves continuous position.
- **Ice Physics**: When a tank is on ice and direction input is released, the tank continues sliding for 20 frames (`ICE_SLIDE_FRAMES = 20`) at normal speed unless obstructed.
- **Corridor Navigation**: Tank collision strictly evaluates 4x4 brick quarters, allowing tanks to fit through 16px gaps and blocking 8px gaps.

---

### Step 6 Decisions
- **Synchronous 1-px Sub-Stepping**: Bullets advance 1 px at a time up to their velocity (3 px/f or 6 px/f), testing terrain, eagle, other bullets, and tanks at each step. This completely prevents tunneling through 4px brick slices and ensures head-on bullet collisions cancel properly.
- **Brick Erosion**: Weak bullets strip the first facing quarter-row (4px depth), taking 2 hits to clear an 8px cell and 4 hits to clear a 16px tile. Star-3 bullets strip full 8px cells and destroy steel blocks.
- **Interactive Controls**: Mapped fire to `Enter`, `Space`, and `KeyJ`. Mapped `KeyT` to toggle player star tiers (0..3) for instant live testing.

---

### Step 7 Decisions
- **Eagle Vulnerability**: Any bullet (player or enemy) destroying the Eagle base sets `eagle.alive = false`, creates a large explosion, sets state to `GAME_OVER_ANIM`, and freezes gameplay while keeping particle explosions running.
- **Player Elimination**: Dying with `lives === 0` removes the player; when all players are eliminated, state transitions to `GAME_OVER_ANIM`.

---

### Step 8 Decisions
- **Wave Pacing**: 20 enemies spawn in the exact authored order (Stage 1: 18 Basic, 2 Fast) cycling across the 3 top gates (left -> center -> right) with interval `max(60, 190 - (stage-1)*4 - (players-1)*20)` ticks, capped at 4 simultaneous active enemies for 1 player.
- **Carrier Flagging**: Spawn indices 3, 10, and 17 (the 4th, 11th, and 18th enemy) are flagged as carriers and render flashing red. Hitting them removes the carrier status and triggers a random powerup drop.
- **Enemy AI State Machine**: Enemies move with randomized move timers (30-120 ticks; 20-80 for Fast) and weighted base-seeking direction choice (bias toward DOWN and toward Eagle's X coordinate). If blocked for > 8 ticks, a new direction is chosen. Enemies intelligently fire shells when facing obstacles, aligned with the player, or facing the Eagle base.

---

### Step 9 Decisions
- **Powerup Mechanics**:
  - Star: Upgrades star tier (0..3), increasing bullet speed, max bullets (2 at tier 2+), and steel destruction at tier 3.
  - Helmet: Grants 600 frames (10s) of invulnerability shield bubble.
  - Clock: Freezes enemy movement and firing for 600 frames (10s).
  - Shovel: Converts the 5 fortress tiles into steel for 1200 frames (20s) before restoring full fresh bricks.
  - Grenade: Destroys all active on-field enemies immediately with explosions (spawning stars spared).
  - Tank: Awards +1 reserve life.
- **Scoring & Extra Lives**:
  - Kill values: Basic 100, Fast 200, Power 300, Armor 400 (final kill only). Powerup pickup awards 500 points.
  - Crossing any 20,000 point boundary automatically grants +1 reserve life.

---

### Step 10 Decisions
- **Complete Game State Machine**:
  - `TITLE`: Renders animated logo, hi-score, 1P/2P/CONSTRUCTION menu, animated tank cursor.
  - `STAGE_INTRO`: Full-screen gray curtain with centered `STAGE N` that slides open after ~60 frames.
  - `PLAYING`: Active gameplay with HUD panel tracking remaining enemy silhouettes, lives, and flag.
  - `PAUSED`: Triggered by `P` / `Escape`, freezing sim and blinking `PAUSE` overlay.
  - `STAGE_CLEAR_WAIT`: Runs for 190 frames after the 20th enemy dies to allow explosions to clear.
  - `TALLY`: Ticks up kill counts row-by-row for each enemy type, displays PTS, total kills, then advances to next stage curtain.
  - `GAME_OVER_ANIM`: Red `GAME OVER` text rises from bottom (`y = 216`) to center (`y = 104`) at 0.5 px/f.
  - `GAME_OVER_SCREEN`: Centered `GAME OVER` screen, saves hi-score in `localStorage`, returns to `TITLE`.



