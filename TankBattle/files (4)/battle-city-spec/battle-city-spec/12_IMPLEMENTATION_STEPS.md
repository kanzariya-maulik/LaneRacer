# 12 — Implementation Steps (do in order; each has an acceptance test)

> Rule: finish and verify each step before starting the next. Commit after each step. Keep `constants.js` as the single home for tunables.

## Step 0 — Project skeleton
- Create folders per file 11 §12. Node 18+, `ws` dependency. `npm start` serves `/client` and opens the WS server.
- ✅ Accept: opening the page shows a black canvas scaled to fit with integer scaling and gray border/panel layout from file 02 (no gameplay yet).

## Step 1 — Rendering framework & palette
- Off-screen 256×240 canvas, integer upscale, `pixelated`. Palette object. Font atlas + `drawText`.
- ✅ Accept: draws `STAGE 1` centered on gray; text is crisp at 3× and 4×.

## Step 2 — Sprite atlas
- Implement `bitmapToCanvas`, tank seed (all 4 dirs × 2 tread frames × P1/P2/enemy palettes), terrain tiles, eagle (alive/ruins), bullet, explosions, spawn star, shield, power-ups.
- ✅ Accept: a debug page ("sprite sheet") shows every sprite 4× upscaled; tanks look like the reference.

## Step 3 — Map & terrain rendering
- Implement data model (file 03), JSON stage loader, expand `map13` → cells/quarters, draw layering (file 02 §5).
- ✅ Accept: Stage 1 rendered at the playfield position; compare side-by-side to the reference screenshot: same silhouette, eagle fortress in place. Water animates; trees draw above a test tank.

## Step 4 — Deterministic sim core (headless)
- `sim.js` with fixed-point positions, PRNG, tick loop, state.
- ✅ Accept: `node test/sim.test.js` runs 600 ticks with scripted inputs twice and produces identical state hashes.

## Step 5 — Player tank movement
- Movement, 4-way input priority, **axis-change grid snap**, terrain collision (quarter-level), tank-vs-tank, bounds, ice sliding.
- ✅ Accept (unit tests): (a) tank at x=67 turning UP snaps x→64; (b) reversing doesn't snap; (c) cannot enter water/steel/brick quarter; (d) fits through a 16-px gap and **cannot** pass an 8-px gap; (e) ice slide ≈ 20 ticks.

## Step 6 — Bullets & wall destruction
- Fire rule (max bullets), speeds, sub-stepping, brick quarter erosion, steel rules, bullet-vs-bullet, edge explosions.
- ✅ Accept: (a) shooting a full brick tile head-on takes exactly **2 shots to clear one cell-depth (8 px)**, 4 shots for 16 px; (b) star-3 clears 8 px per shot; (c) bullet vs steel leaves it intact (star 0–2) and removes it (star 3); (d) two opposing player/enemy bullets cancel; (e) fast bullet never tunnels through a 4-px wall.

## Step 7 — Eagle & game over conditions
- Eagle hit = loss (even from own bullet). Destroyed sprite. Lives=0 for all players = loss.
- ✅ Accept: shooting your own base ends the game; `GAME_OVER_ANIM` triggers.

## Step 8 — Enemies: spawn, types, AI
- Stage enemy list, 3 gates rotation, spawn delay formula, max alive, spawn star, 4 types (HP/speed/bullet), carriers at index 3/10/17, AI per file 06.
- ✅ Accept: Stage 1 spawns exactly 20 (18 B, 2 F), ≤ 4 at once, intervals ≈ 190 ticks; carriers flash; armor takes 4 hits; HUD icons decrement.

## Step 9 — Power-ups & scoring
- Six powerups, durations, shovel fortress swap & flash, clock freeze, grenade, tank, helmet, star; scoring table; 20k extra life.
- ✅ Accept: scripted tests for each effect; score values 100/200/300/400/500.

## Step 10 — Game flow & screens
- Title, stage curtain, HUD with live data, pause, stage-clear wait, **tally screen animation**, game over text rise, hi-score persistence.
- ✅ Accept: play stage 1 → clear → tally → stage 2 curtain; die → GAME OVER text rises to center → title.

## Step 11 — Audio
- Implement file 10 events.
- ✅ Accept: each event audible once, no clicks, engine loop switches idle/moving, muted toggle works.

## Step 12 — Single-player complete
- Wire sim into the client locally. Author/import stages 1–10 minimum.
- ✅ Accept: complete play-through of stage 1–3 feels like Battle City using file 13 checklist.

## Step 13 — LAN server
- WebSocket server hosting `sim.js`, lobby, input messages, snapshots (30 Hz), events, stage messages.
- ✅ Accept: two browser tabs on the same machine, then two machines, can co-op a stage; no desync, input delay unnoticeable.

## Step 14 — Net polish
- Interpolation, reconnect handling, host pause, player-left handling, 3–4 player scaling.
- ✅ Accept: unplug client mid-game → game continues; reconnect within 30 s restores control.

## Step 15 — Content & extras
- More stages (to 35), CRT toggle, gamepad, construction mode, Versus mode (optional).

## Step 16 — Hardening
- Run the whole file 13 checklist; fix discrepancies; profile (should use < 3 % CPU).

---

## Working method for the agent
1. Before each step, re-read the relevant spec file(s).
2. Write the unit tests **first** for sim steps (4–9).
3. If the spec says [TUNE], implement the value and move on; tuning happens in Step 16.
4. After each step, produce a 5-line summary: what was done, tests passed, open questions.
5. If something in the spec seems impossible/ambiguous, choose the simplest authentic-feeling option and note it in `DECISIONS.md`.
