# 02 — Display, Layout, Palette, Font & Every Screen

## 1. Logical resolution & scaling [EXACT]
- **Logical canvas: 256 × 240 px** (NES native). All game logic and drawing coordinates use this space.
- Render everything to an **off-screen canvas 256×240**, then draw it to the visible canvas scaled by the **largest integer factor that fits** the window (e.g. 3× → 768×720, 4× → 1024×960). Center it, letterbox with black.
- CSS: `canvas { image-rendering: pixelated; image-rendering: crisp-edges; }` and `ctx.imageSmoothingEnabled = false`.
- Optional toggle (default OFF): CRT scanline overlay (1-px dark line every 2nd scaled row at 25% alpha) and slight vignette.
- Never use sub-pixel draw positions: `Math.floor` all draw coords.

## 2. Screen layout (256×240) [EXACT / APPROX]
```
x:  0        16                          224      256
y:0 ┌─────────┬───────────────────────────┬────────┐
    │  GRAY   │                           │  GRAY  │
  8 │ border  ├───────────────────────────┤ panel  │
    │         │                           │        │
    │         │   PLAYFIELD  208 × 208    │ enemy  │
    │         │   (black background)      │ icons  │
    │         │   13 × 13 tiles of 16px   │ IP/life│
    │         │                           │ flag   │
216 │         └───────────────────────────┤ stage# │
    │                                     │        │
240 └─────────────────────────────────────┴────────┘
```
- **Playfield rect:** `x=16, y=8, w=208, h=208`. Background **pure black**.
- **Everything else** (border + right panel): **solid gray `#636363`**.
- In the reference screenshot the gray border is thick on all four sides and the side panel is on the right — match that.

### Right HUD panel (all inside x 224–256) [APPROX positions; keep relative arrangement]
| Element | Position (top-left) | Detail |
|---|---|---|
| **Enemy reserve icons** | starts `(232, 16)` | 2 columns × 10 rows of **8×8** mini-tank icons (black silhouette on gray) = 20 slots. Column spacing 8 px, row spacing 8 px. One icon is **removed each time an enemy spawns** (remove from the last slot first: bottom-right → up). |
| **`IP`** label | `(232, 136)` | Text "IP" in black (Player 2 shows "IIP" below, in a second block). |
| **Life icon + number** | `(232, 144)` | 8×8 yellow tank icon (P1) then lives count digit to its right (e.g. `3`). The number shows **remaining lives** (starts at 3 → shown "3"; when you respawn it decrements). When 0, shows 0. |
| **Stage flag** | `(232, 176)` | 16×16 flag icon (red-ish flag on black pole). |
| **Stage number** | `(240, 192)` | Black digits, 1–2 digits, e.g. `1`, `35`. |

2-player: add a second `IIP` block with green icon under the first, shifting the flag down if needed (keep inside the panel).

## 3. Palette [APPROX — NES-like]
Define a single palette object; never hard-code colours elsewhere.
| Name | Hex | Use |
|---|---|---|
| `GRAY_BG` | `#636363` | Border, panel, stage-curtain background |
| `BLACK` | `#000000` | Playfield, text shadow |
| `WHITE` | `#FCFCFC` | Text, steel highlight |
| `BRICK_MAIN` | `#B53121` | Brick faces (orange-red) |
| `BRICK_LIGHT` | `#E7745A` | Brick top/left highlight pixels |
| `BRICK_DARK` / mortar | `#000000` or `#5C0F00` | Mortar lines |
| `STEEL_MAIN` | `#BCBCBC` | Steel |
| `STEEL_LIGHT` | `#FCFCFC` | Steel highlight |
| `STEEL_DARK` | `#747474` | Steel shade |
| `WATER_A` / `WATER_B` | `#3CBCFC` / `#0058F8` | Water, 2-frame shimmer |
| `TREE_MAIN` | `#00A800` | Forest |
| `TREE_DARK` | `#005800` | Forest speckle |
| `ICE_MAIN` | `#FCFCFC` | Ice base |
| `ICE_SHADE` | `#BCBCBC` | Ice speckle |
| `P1_YELLOW` | `#E4A000` (body) / `#FCD848` (light) / `#885800` (dark) | Player 1 |
| `P2_GREEN` | `#00A800` / `#80D010` / `#005800` | Player 2 |
| `ENEMY_GRAY` | `#BCBCBC` / `#FCFCFC` / `#747474` | Basic enemy |
| `ENEMY_RED` | `#D82800` / `#FC7460` / `#881400` | Flash colour for carriers |
| `TEXT_ORANGE` | `#E4A000` | Score numbers on tally screen |
| `TEXT_RED` | `#D82800` | "HI-SCORE", "I-PLAYER", GAME OVER |

## 4. Font [EXACT style]
- 8×8 pixel monospaced bitmap font, uppercase + digits + a few symbols (`- . © ← ⇒`).
- **Do not load web fonts** (LAN may be offline). Embed a 5×7-in-8×8 bitmap table in `font.js` and draw glyph pixels with `fillRect`, or pre-render to an atlas canvas at boot.
- All text is drawn at integer positions, multiples of 8 px in x for menu/tally alignment.

## 5. Draw order (layering) inside the playfield [EXACT]
From back to front:
1. Black background
2. **Ice** (ground)
3. **Water** (animated, 2 frames, swap every ~32 frames [APPROX])
4. **Brick** & **Steel** & **Eagle**
5. **Power-up** item (blinking)
6. **Tanks**
7. **Bullets**
8. **Explosions**
9. **Trees / Bushes** ← drawn **above** tanks and bullets so they hide them. (Explosions over trees is acceptable.)
10. UI text overlays (PAUSE, GAME OVER)

## 5b. Entity visuals summary
Full detail in file 09. Quick sizes: tank 16×16; bullet ≈ 4×4 drawn (3×4); eagle 16×16; power-ups 16×16; spawn star 16×16; small explosion 16×16; big explosion 32×32.

---

## 6. SCREENS

### 6.1 Title Screen [EXACT layout idea]
- Background **black**.
- Top-left: `I-  00` (score label, red) and top-center `HI- 20000` (hi-score, red label/orange value) — small 8×8 text.
- **Logo "BATTLE CITY"**: giant brick-textured letters (each letter built from the same brick pattern/colours), two lines or one wide line, centered around y≈ 56–104. On entering the screen the logo **scrolls up from below** (~ 2 s) and stops; pressing Start during the scroll skips it.
- **Menu** (white text, 8×8 font), centered, spaced 16 px apart starting y≈ 144:
  ```
  1 PLAYER
  2 PLAYERS
  CONSTRUCTION
  ```
- **Cursor:** a small **yellow tank sprite facing right** to the left of the selected item; its **treads animate** (alternate frames every 4 frames).
- Bottom: `© 1980 1985 NAMCO LTD.` and `ALL RIGHTS RESERVED` (white, small). **For our own build, replace with `BATTLE TANKS LAN` + `FAN RECREATION`.**
- Input: Up/Down move cursor, Start/Fire selects. In LAN build the menu becomes: `1 PLAYER`, `LAN HOST`, `LAN JOIN`, `CONSTRUCTION` (see file 11).
- If idle on title ~ 10–20 s you may show a demo (optional, skip).

### 6.2 Stage Curtain / "STAGE N" Screen [EXACT]
- Whole 256×240 canvas filled **`GRAY_BG`**.
- Center text in black: **`STAGE 1`** (number = current stage), at roughly `(96, 112)`.
- **Curtain open/close animation:** upon starting, the gray screen is initially full; after ~ 1 s the **top and bottom halves slide away** towards the edges revealing the black playfield + HUD (the playfield "opens" like stage curtains), ~ 30–40 frames. Conversely when a stage starts the curtain *closes* then opens. Implement as two gray rectangles shrinking from center to edges at ~ 4 px/frame.
- Play the **stage-start jingle** (file 10) during this.
- Total stage-intro time ≈ 2–3 s before enemies start spawning.

### 6.3 Gameplay HUD [EXACT]
As in section 2. During play also:
- Flashing carrier tanks (red↔gray alternate every ~ 8 frames).
- Power-up item blinking (alternate visible/hidden every 8 frames).
- No score on the playfield during play (score only shown on tally screen) [EXACT]. *(You may show a small unobtrusive score under the lives panel as [OURS] toggle, default off.)*

### 6.4 Pause [EXACT]
- Pressing Start/P: freeze simulation, play pause beep (file 10), draw **`PAUSE`** text blinking (visible 32 f / hidden 32 f) centered over the playfield (`x ≈ 88, y ≈ 108`). Draw in **red/white**. Any Start press resumes.
- In LAN: pause only available to host and pauses everyone; show "PAUSED BY <name>" [OURS].

### 6.5 Game Over [EXACT]
Triggered by: Eagle destroyed, **or** all players out of lives.
- Eagle sprite switches to **destroyed eagle (ruins/flag-less graveyard)**; play eagle explosion.
- Text **`GAME OVER`** (red) appears **below the playfield bottom** and **rises upward** at ~ 1 px every 2–3 frames until its vertical center is centered in the playfield (y≈ 104), then holds ~ 2 s. Gameplay is frozen except for the rising text/explosions.
  - In the original, if the Eagle is destroyed the text rises *from the bottom of the playfield*; if lives ran out the same text appears. Implement identically for both.
- Afterwards: the original does **not** show the tally after a loss. Cut to a **black screen with a big red `GAME OVER`** centered on the whole canvas for ~3-4 s, then return to the title. If score > hi-score, save it.

### 6.6 Score Tally Screen (after clearing a stage) [EXACT layout idea]
Black background, text 8×8, centered column:
```
              HI-SCORE   20000        ← "HI-SCORE" red, number orange
                  STAGE  1            ← white
              I-PLAYER                ← red
                  4500                ← orange (running total score)
        12  PTS   1200  ◄ [basic icon]
         4  PTS    800  ◄ [fast icon]
         2  PTS    600  ◄ [power icon]
         1  PTS    400  ◄ [armor icon]
        ────────────
        TOTAL  19                      ← total kills
```
Behaviour:
- Rows reveal **one enemy type at a time**: the kill count **ticks up** from 0 to N (one increment every ~ 4–6 frames with a short blip sound), then the points for that row, then next row. After all rows, show `TOTAL`.
- **Perfect/bonus:** if one player killed ≥ 20 etc. there is `BONUS!` (+1000) in some versions [APPROX]; **optional** — implement only if everything else is done.
- Hold ~ 2 s, then go to the next stage curtain. (Skip with Start.)
- 2 players: two columns, `I-PLAYER` left and `II-PLAYER` right (II-PLAYER in green/red tone).

### 6.7 "Stage Select" / Construction [low priority]
- Construction mode: black 13×13 grid, cursor = tank sprite; Fire cycles tile types (empty → brick-left-half, brick-top-half, brick-full, steel…, water, trees, ice); Start saves/exits. Not required for v1.

---

## 7. Transitions summary
| From | To | Effect |
|---|---|---|
| Title → game | curtain closes (gray) → `STAGE N` | ~ 1.5 s |
| Stage intro → play | curtain opens | ~ 0.6 s |
| Win → tally | immediate cut to black | after ~ 3 s hold |
| Tally → next stage | curtain closes → `STAGE N+1` | |
| Game over → title | cut | after 3–4 s |
