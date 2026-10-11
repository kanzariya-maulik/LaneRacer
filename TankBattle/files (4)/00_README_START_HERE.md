# BATTLE CITY (NES / "Tank 1990") — Full Reproduction Spec Pack
### For the AI coding agent rebuilding the LAN tank game

You are rebuilding the classic 1985 Namco **Battle City** (Famicom/NES; known in many regions as **Tank 1990**, **Battle Tank**, etc.) as a browser game with **LAN multiplayer**. The goal is the **full authentic 1990-era experience**: same grid, same pixel proportions, same rules, same enemy waves, same HUD, same screens, same chiptune feel.

> NOTE: "Tank Battalion" (1980) is a *different*, earlier Namco arcade game. "Tank Force" (1991) is a later Namco arcade sequel. This pack is about **Battle City / Tank 1990** (the game in the reference screenshot: 13×13 field, eagle base at the bottom, gray border, enemy-reserve icons on the right, `IP 3` lives, stage flag).

## How to use this pack
1. Read files **in numeric order**. Each file is self-contained but builds on the previous ones.
2. Do **not** skip to code. The old build failed because it invented its own proportions and rules. Every number here is deliberate.
3. Implement using `12_IMPLEMENTATION_STEPS.md` as your task list. After each step run its **acceptance test** before moving on.
4. When any value is tagged **[TUNE]**, implement it as a named constant in one `constants.js` file so it can be adjusted by feel.

### Confidence tags used in these files
| Tag | Meaning |
|---|---|
| **[EXACT]** | Well-documented original behaviour/number. Implement exactly. |
| **[APPROX]** | Faithful to the feel of the original, but exact original value is uncertain. Implement as given, expose as a constant. |
| **[TUNE]** | Judgement call. Playtest and adjust against the "feel checklist" in file 13. |
| **[OURS]** | Our own addition for LAN play (not in the original). |

## File index
| # | File | What it covers |
|---|---|---|
| 00 | `00_README_START_HERE.md` | This file + audit of the previous (bad) build |
| 01 | `01_GAME_OVERVIEW_AND_FEEL.md` | What the game is, core loop, design pillars, what "authentic" means |
| 02 | `02_DISPLAY_AND_UI.md` | Resolution, layout in pixels, palette, font, HUD, every screen (title, stage intro, pause, game over, score tally) |
| 03 | `03_MAP_TILES_AND_STAGES.md` | Grid model, tile types, brick quarter-cells, base fortress, stage data format, Stage 1 layout, stage authoring rules |
| 04 | `04_TANKS_AND_MOVEMENT.md` | Tank sizes, speeds, grid-snap turning, collision, ice, spawning, shields, player upgrades |
| 05 | `05_BULLETS_AND_COMBAT.md` | Bullet rules, destruction algorithm, bullet-vs-bullet, friendly fire, eagle |
| 06 | `06_ENEMIES_AND_AI.md` | 4 enemy types, wave composition, spawn timing, AI behaviour |
| 07 | `07_POWERUPS_AND_SCORING.md` | All 6 powerups, durations, scores, extra lives, hi-score |
| 08 | `08_GAME_FLOW_STATE_MACHINE.md` | Every game state, transitions, timers |
| 09 | `09_SPRITES_AND_ANIMATION.md` | How to draw all sprites procedurally (no ripped assets), frame timings |
| 10 | `10_AUDIO.md` | Sound event list + Web Audio chiptune recipes |
| 11 | `11_LAN_MULTIPLAYER_ARCHITECTURE.md` | Authoritative server, determinism, protocol, co-op + versus modes |
| 12 | `12_IMPLEMENTATION_STEPS.md` | Step-by-step build order with acceptance tests |
| 13 | `13_TESTING_AND_FEEL_CHECKLIST.md` | Golden numbers, regression tests, "does it feel like Battle City?" checklist |

---

## AUDIT: What was wrong with `battle_tanks_lan_architecture.md`
The previous document reads like Battle City but gets the fundamentals wrong. These are the reasons the result feels bad. **Do not carry any of these over.**

| # | Previous design | Problem | Correct (this pack) |
|---|---|---|---|
| 1 | Map = **26×26 blocks of 32 px** (832 px world), "16×16 sub-tiles" | Wrong scale. Tanks/bullets/corridors feel huge and sparse. | Playfield is **208×208 logical px** = **13×13 tiles of 16 px**, built from **26×26 cells of 8 px**. Tank = 16×16 px. (File 03) |
| 2 | Brick = 4 quadrants, one shell kills **one quadrant** | Wrong granularity; walls can't be carved the classic way. | Each 8×8 cell has 4 quarter-bits (4×4 px). A hit removes a 4 px-deep slice across the touched cells. Power-3 bullets remove whole 8 px cells. (File 05) |
| 3 | **PvP deathmatch only** (teams, FFA, circular arenas) | Not Battle City. The real game is **co-op vs. 20-tank enemy waves** defending the Eagle. | Main mode = 1–4 players co-op vs AI waves. PvP is an *optional* extra mode [OURS]. (Files 06, 11) |
| 4 | No enemy AI, no waves, no 4 enemy types, no flashing power-up carriers | Missing the heart of the game. | 20 enemies/stage, 4 types, flashing carriers, spawn timing. (File 06) |
| 5 | Tank has `lives` hit points; shield via `Date.now()` | Player dies in **one hit** in the original; wall-clock time breaks the deterministic 60 Hz sim. | One hit = death; lose a life; respawn with shield. Use **frame counters** only. (Files 04, 11) |
| 6 | Player tiers 0–4 w/ "tier ≥ 4 pierces steel" | Original has **star levels 0–3**; level 3 breaks steel. | Stars 0–3. (File 04/05) |
| 7 | Shells all `6 px/tick`, fire rate unlimited | Original: slow vs fast bullets, **max bullets on screen** limits fire rate. | File 05 |
| 8 | Smooth free movement + "corner assist" nudging up to 6 px | Original snaps to the **8 px grid on the perpendicular axis when you change axis**. | File 04 |
| 9 | Ice = "momentum vector" slide | Original ice: tank keeps sliding briefly in its facing direction after input stops. | File 04 |
| 10 | Missing: title screen, stage curtain, pause, game-over text rise, score tally screen, HUD enemy icons, flag counter | These screens ARE the 1990 experience. | File 02, 08 |
| 11 | Missing: powerups (helmet, clock, shovel, star, grenade, tank), scoring | File 07 |
| 12 | Bushes: "tank becomes hidden" but no draw-order spec | Trees draw **above** tanks and bullets. | File 02/09 |
| 13 | WebRTC + Socket.IO hybrid recommended as a requirement | Over-engineered for a 208×208 px, ≤ ~30 entity game on a LAN. Plain WebSocket is enough. | File 11 |
| 14 | Visual: smooth high-res assets/images | Should be **256×240 logical canvas**, integer-scaled, nearest-neighbour, NES palette. | File 02, 09 |

## Golden rules for the agent
1. **Logical resolution is 256×240.** Render to an off-screen canvas of exactly that size, then scale up by an *integer* factor with `image-rendering: pixelated`. Never anti-alias.
2. **Everything is on the 8 px grid** except moving things. Tanks are 16×16. Bullets are small (≈ 4×4 collision).
3. **Fixed 60 Hz simulation. Frame counters, not milliseconds.** Same inputs ⇒ same result.
4. **No invented mechanics.** If this pack doesn't say it, ask: "did original Battle City do this?" If not, don't add it (unless tagged [OURS]).
5. **One hit kills players.** Armor tanks take 4 hits. Eagle dies to any bullet (even yours).
6. **The player is weak and the base is fragile** — that tension is the game.
7. Keep all tunables in `constants.js`.

## Legal / naming note
Battle City is © Namco. This is a personal, non-commercial fan recreation. Do **not** use ripped ROM sprites/audio (we draw everything procedurally — see files 09/10). If you ever publish it, rename it (e.g. "Battle Tanks LAN") and drop the Namco copyright text on the title screen.
