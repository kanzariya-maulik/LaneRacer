# 09 — Sprites & Animation (procedural, no ripped assets)

All art is generated from **tiny ASCII bitmaps** at boot into off-screen canvases (an atlas). This keeps the build asset-free, authentic, and easy for an AI agent to edit.

## 1. Sprite pipeline
```js
// sprites.js
function bitmapToCanvas(rows, palette) {         // rows: array of equal-length strings
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1); } }));
  return c;
}
function rotate(canvas, quarterTurns) { /* draw rotated copy onto new 16×16 canvas */ }
```
- Author each tank **facing UP** only; generate RIGHT/DOWN/LEFT by rotation at boot (cache them).
- Generate per-tank-type × colour variant × tread frame (2) × direction (4).

## 2. Tank sprite seed (16×16, facing UP)
Legend: `.` transparent · `x`/`y` = tread rows (alternate shades, **swap x↔y for frame 2** to animate) · `B` body · `b` body shade · `h` turret highlight · `G` barrel · `k` outline.
```
.......GG.......
.......GG.......
xxx...kGGk...xxx
yyy..kBGGBk..yyy
xxx..kBBBBk..xxx
yyy.kBhhhhBk.yyy
xxx.kBhhhhBk.xxx
yyy.kBhhhhBk.yyy
xxx.kBBBBBBk.xxx
yyy.kBBBBBBk.yyy
xxx.kBBBBBBk.xxx
yyy.kBBBBBBk.yyy
xxx.kBbbbbBk.xxx
yyy.kBbbbbBk.yyy
xxx..kkkkkk..xxx
yyy..........yyy
```
It's a *seed*: the agent should refine it (add bolts, shading, 1-px highlights) so that it reads like the reference screenshot tanks, but **keep: 3-px-wide treads on both sides, centred barrel 2 px wide, 16×16 bounds**.
Palette mapping examples:
| Variant | `x` | `y` | `B` | `b` | `h` | `G` |
|---|---|---|---|---|---|---|
| P1 yellow | `#885800` | `#E4A000` | `#E4A000` | `#885800` | `#FCD848` | `#FCD848` |
| P2 green | `#005800` | `#00A800` | `#00A800` | `#005800` | `#80D010` | `#80D010` |
| Basic enemy | `#747474` | `#BCBCBC` | `#BCBCBC` | `#747474` | `#FCFCFC` | `#FCFCFC` |
| Carrier flash | alternate Basic ↔ `ENEMY_RED` palette every 8 ticks |

### Type differences (silhouette cues)
| Type | Distinguishing feature |
|---|---|
| Basic | as seed |
| Fast | narrower hull (cols 5–10), treads with extra stripe, sleeker front |
| Power | **thicker barrel** (3 px wide) + extra turret block |
| Armor | **wider/taller body** (hull cols 3–12), extra turret ring; colour by HP |
### Player star levels (silhouette)
| Level | Change |
|---|---|
| 0 | seed |
| 1 | barrel lengthened by 1 px + small chevron on turret |
| 2 | second chevron, barrel 3 px wide? (keep 2 px but lighter) |
| 3 | **heavy tank**: double barrel base, extra side armor plates, bigger turret |

## 3. Tread animation
- 2 frames. Toggle `treadFrame` **every 2–3 ticks while the tank moves** (`TREAD_TOGGLE_TICKS = 2`). Don't animate when stationary.

## 4. Terrain tiles (draw each 8×8 cell or 16×16 tile into a pre-rendered atlas)
**Brick (8×8 cell):** two courses of bricks, mortar black, offset joints:
```
rrrrrrr.
rrrrrrr.     r = BRICK_MAIN, l = BRICK_LIGHT (top-left pixels), . = mortar (black)
l.rrrrrr     Row layout: rows 0-2 brick, row 3 mortar, rows 4-6 brick offset 4 px, row 7 mortar
........
rrr.rrrr
rrr.rrrr
lrr.rrrr
........
```
Draw a **quarter** as its 4×4 sub-rect of that bitmap so partial destruction looks natural.

**Steel (8×8 cell):** light-gray square with white highlight in the top-left 2×2 and dark-gray bottom/right edges (bevel). A full steel tile = 2×2 of these.

**Water (16×16, 2 frames):** blue base with lighter wavy highlights, frame B shifts waves by 4 px.

**Trees (16×16):** dark/light green checker blobs with black gaps (draw with a fixed pseudo-random pattern, 4-px speckles).

**Ice (16×16):** white/very light gray with a few gray 2×2 speckles and 1-px diagonal highlights.

## 5. Eagle (16×16)
- Alive: a stylised gray/white eagle with spread wings, small red/orange highlights; wings fill most of the 16 px width. (Reference screenshot: gray eagle at bottom.)
- Destroyed: darker, broken, wings collapsed ("graveyard" look: gray/dark rubble pile with a small flag/cross). Swap on `eagle.alive=false`.

## 6. Power-up icons (16×16) — see file 07 §3.

## 7. Spawn star (16×16, 4 sizes)
A white/gray four-pointed star, scales through sizes S1(6px)→S4(16px). Animation order and timing in file 04 §6. Draw as a plus-shaped diamond with a bright center.

## 8. Bullet
- 4×4 (draw 3×4 or 4×3 depending on direction): white core, 1-px gray tail. Bullets of strong tanks look identical.

## 9. Explosions
| Kind | Frames | Visual |
|---|---|---|
| Small | 3 × ~3 ticks | orange/yellow/white burst 8→16 px |
| Big | 3 × ~6 ticks (+ final 2) | orange/white starburst 16→32 px, centered on the tank |
Draw procedurally: filled circle/diamond rings with palette `#FCFCFC, #F8B800, #D82800`.

## 10. Shield bubble
Two alternating frames of a dotted rectangular ring slightly larger than the tank (18×18), drawn over the tank, in white/light blue. Toggle every 2 ticks.

## 11. Frozen tank
While frozen (friendly fire), blink the tank (visible 4 / hidden 4) or shift to a lighter palette.

## 12. HUD icons
- Enemy-reserve icon: 8×8 mini silhouette (black).
- Player life icon: 8×8 yellow (P1) / green (P2) tank facing up.
- Flag: 16×16 pole + triangular flag in dark red/orange.

## 13. Text/number popup
`500` pickup popup: white 8×8 digits rising 1 px per 4 ticks for 40 ticks.

## 14. Atlas & render budget
- Pre-render everything at boot; per frame only `drawImage` from the atlas to the 256×240 canvas.
- Never create objects per frame in the render loop.
