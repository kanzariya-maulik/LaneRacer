# 01 — Game Overview & The "Feel" of Battle City

## 1. One-paragraph summary
You command a small yellow tank (Player 2 is green) in a top-down 13×13-tile arena. At the bottom center sits your **Eagle (base)** wrapped in brick. From three spawn gates at the top, the enemy releases **20 tanks per stage** (never more than 4 on the field at once). You must destroy all 20 without losing the Eagle and without running out of lives. Walls can be shot away (by you *and* by the enemy), power-ups drop from flashing red tanks, and there are **35 hand-designed stages**.

## 2. Design pillars (what makes it feel right)
1. **Tight grid, tiny arena.** 208×208 px playfield. Everything is close. Danger is always 1–2 seconds away.
2. **Fragile player, fragile base.** Player dies in one hit. The Eagle dies in one hit from *anyone*. Walls are the only defence and they erode.
3. **Bullets are the main verb.** You can have only 1 bullet in flight (2 after upgrade). You must aim by *facing*, there is no free aiming. Bullet-on-bullet collisions cancel — a core defensive trick.
4. **Pressure from waves.** Enemies keep coming on a timer. They are semi-random and drift toward the base. You can't turtle forever.
5. **Upgrade ladder.** Collecting 3 stars turns a weak tank into a steel-breaking monster. Dying resets it. This risk/reward loop drives the whole game.
6. **Retro presentation.** NES palette, chunky pixels, square-wave beeps, noise explosions, curtain-style stage intro, red GAME OVER text sliding up.
7. **Co-op by default.** Two players share the base, share the danger, and can accidentally freeze each other with friendly fire.

## 3. Core loop (single stage)
```
STAGE CURTAIN → map drawn → players + first enemies spawn (star animation)
   ↓
 PLAY: kill 20 enemies | pick power-ups | protect Eagle | don't lose all lives
   ↓
 last enemy dead → ~3 s pause → SCORE TALLY → next stage
 (or) Eagle destroyed / lives = 0 → GAME OVER text rises → title / hi-score
```

## 4. Inputs (original: NES pad) → our mapping
| NES | Action | Player 1 default | Player 2 default |
|---|---|---|---|
| D-pad | Move (4-way only, no diagonals) | `W A S D` or arrows | `I J K L` (or second gamepad) |
| A / B | Fire | `Space` / `J`-style key (one key is enough) | `Enter` / `;` |
| Start | Pause (and confirm menu) | `Enter` / `P` | – |
| Select | Menu cursor: 1 PLAYER / 2 PLAYERS / CONSTRUCTION | `↑/↓` | – |

Rules:
- **4-way only.** If two direction keys are held, use the **most recently pressed** one (the original prioritises by last press; if unsure, keep the previously active direction until released).
- **Fire is edge-triggered or hold-to-repeat?** Original: pressing fire shoots if allowed (bullet count < max). Holding fire auto-repeats whenever a bullet slot frees up **[APPROX]** — implement hold = repeat, because it feels better on keyboard.
- Gamepad API support is nice-to-have.

## 5. Modes
| Mode | Original? | Notes |
|---|---|---|
| 1 Player | yes | Classic. |
| 2 Players (co-op, same screen) | yes | On LAN: each human controls one tank over the network. |
| Construction (map editor) | yes | Optional [OURS]: simple editor that saves stage JSON. Low priority. |
| 3–4 player co-op | no | [OURS] Extend: more enemies on field (see file 06). Extra players: P3 = blue, P4 = red/purple. |
| Versus (players shoot each other) | no | [OURS] Optional extra, off by default. See file 11. |

## 6. What "authentic" means for acceptance
The agent's output is acceptable when a person who played Battle City as a kid:
- recognises the **screens** instantly (title, curtain, HUD, tally, game over),
- finds the **tank handling** familiar (snap-to-grid turns, no sliding except on ice),
- finds **wall carving** satisfying (shoot slits in brick, 4-hit depth),
- feels the **panic** when the Eagle's walls get shot out,
- hears the right **beeps**.
Use file 13's checklist to verify.

## 7. Glossary
| Term | Meaning |
|---|---|
| **px** | Logical pixel on the 256×240 canvas. |
| **Tile** | 16×16 px. Playfield = 13×13 tiles. |
| **Cell** | 8×8 px (half-tile). Brick/steel exist at cell granularity. Map = 26×26 cells. |
| **Quarter** | 4×4 px piece of a brick cell (4 per cell). |
| **Star level / tier** | Player upgrade 0–3. |
| **Carrier** | Flashing red enemy that drops a power-up when hit. |
| **Frame / tick** | 1/60 s simulation step. |
