# 03 — Map, Tiles, Base Fortress & Stage Data

## 1. Grid model [EXACT]
- Playfield = **208 × 208 px**.
- **Tile grid:** 13 × 13 tiles, each **16×16 px**. Tile `(tx, ty)` covers px `[tx*16, tx*16+16) × [ty*16, ty*16+16)` (playfield-local coordinates; add `(16, 8)` when drawing to the canvas).
- **Cell grid:** 26 × 26 cells, each **8×8 px**. Brick and steel live at **cell** granularity. One tile = 2×2 cells.
- Tanks are 16×16 = exactly one tile in size, but move pixel-by-pixel and are **not** locked to tiles.

```
 one 16×16 tile            cell indices inside it
 ┌────┬────┐               (0,0) (1,0)
 │ c0 │ c1 │               (0,1) (1,1)
 ├────┼────┤
 │ c2 │ c3 │
 └────┴────┘
```

## 2. Tile types [EXACT]
| Code | Name | Granularity | Tank | Bullet |
|---|---|---|---|---|
| `.` | Empty ground | tile | passes | passes |
| `B` | Brick | **cell + 4 quarters** | **blocked** | stops; destroys part of brick |
| `S` | Steel | cell | **blocked** | stops; destroyed only by star-3 bullets |
| `W` | Water | tile | **blocked** | **passes over** |
| `T` | Trees / forest | tile | passes (hidden beneath) | passes |
| `I` | Ice | tile | passes; **slides** | passes |
| `E` | Eagle (base) | tile (16×16 entity) | blocked | **any hit destroys it → game over** |

Notes:
- Map edge: tanks cannot leave; bullets that reach the edge **explode** (small explosion, no damage). Steel-style "ping" sound.
- Water, trees and ice are authored on a **tile** grid (full 16×16). Brick/steel can be authored at **cell** level (half-tiles) for detail.

## 3. Data model (implement exactly like this)
```js
// constants
const TILE = 16, CELL = 8, COLS = 13, ROWS = 13, CCOLS = 26, CROWS = 26;

// Terrain layers
cellType  = new Uint8Array(26*26);   // 0 empty, 1 brick, 2 steel   (indexed cy*26+cx)
brickBits = new Uint8Array(26*26);   // 4-bit mask per brick cell (1 = quarter present)
tileType  = new Uint8Array(13*13);   // 0 empty, 3 water, 4 trees, 5 ice
eagle     = { alive:true, x:96, y:192 };  // 16×16
```
**Quarter bits inside a cell** (each quarter is 4×4 px):
```
 bit0 = top-left   bit1 = top-right
 bit2 = bottom-left bit3 = bottom-right
 full brick cell = 0b1111
```
When `cellType==1 && brickBits==0` → set `cellType=0`.
Tank-vs-brick collision uses **any remaining quarter** ⇒ treat the whole 8×8 cell as solid while `brickBits != 0`? **No — [EXACT]: quarters are solid individually.** Test the tank's rect against each present quarter's 4×4 rect, otherwise slits narrower than a full cell would be unusable. *Simpler accepted approximation:* treat a cell as solid if `brickBits != 0`. Prefer the exact approach; it's cheap.

## 4. Player & enemy spawn points [EXACT]
In **tile coordinates** (px = tile*16):
| Entity | Tile (tx, ty) | Pixel (x, y) |
|---|---|---|
| Enemy spawn 1 (top-left) | (0, 0) | (0, 0) |
| Enemy spawn 2 (top-center) | (6, 0) | (96, 0) |
| Enemy spawn 3 (top-right) | (12, 0) | (192, 0) |
| **Eagle** | (6, 12) | (96, 192) |
| Player 1 spawn | (4, 12) | (64, 192) |
| Player 2 spawn | (8, 12) | (128, 192) |
| [OURS] Player 3 / 4 spawns | (2, 12) / (10, 12) | (32,192) / (160,192) |

In the reference screenshot the yellow P1 tank is just left of the Eagle — correct.
**Enemy spawn order:** cycle through the 3 gates in order left → center → right → left … **[APPROX]** (original picks in a fixed rotation).
Spawn tiles must be kept clear of terrain by stage design. If a tank or player is standing on the gate, delay that spawn until clear.

## 5. Base fortress [EXACT]
The Eagle (tile 6,12) is protected by brick on 3 sides, at **cell** level (cells are 8 px):
```
 cell coords (cx,cy) → bricks (full 0b1111) at:
   (10,22) (11,22) (12,22) (13,22) (14,22) (15,22)   ← top wall row, 6 cells = 3 tiles wide (tiles 5–7), row y=176..192
   (10,23) (10,24) (10,25)   ← left wall column  (tile 5 rows 11–12 → cells x=10..11)
   (15,23) (15,24) (15,25)   ← right wall column
 Eagle occupies cells (12..13, 24..25)
```
Equivalently at tile level: brick tiles at `(5,11) (6,11) (7,11) (5,12) (7,12)` and the Eagle at `(6,12)`.
In the screenshot you can see this as the brick "bowl" around the eagle at bottom center. **Use the tile-level version for v1** (5 full brick tiles).

### Shovel fortress swap (file 07)
When Shovel is picked: replace those 5 brick tiles with **steel** for ~20 s, flash alternate steel/brick the last ~3–4 s, then restore **full fresh bricks** (not the damaged state).

## 6. Stage file format [OURS format, EXACT content semantics]
Store each stage as JSON (`stages/stage01.json`) or a JS module:
```json
{
  "stage": 1,
  "enemies": "B*18,F*2",
  "map13": [
    ".............",
    ".B.B.B.B.B...",
    ".B.......B.B.",
    ".B.B.BSB.B.B.",
    ".B.B.B.B.B.B.",
    ".B.B.....B.B.",
    "S..BB....BB.S",
    ".............",
    ".....BBB.....",
    ".B.B.B.B.B.B.",
    ".B.B.B.B.B.B.",
    ".B.B.BBB.B.B.",
    ".....BEB....."
  ],
  "overrides": []
}
```
- `map13`: 13 strings × 13 chars, one char per **tile**, legend: `. B S W T I E`.
- `B`/`S` expand to **all 4 cells** of that tile (full).
- `overrides`: optional cell-level patches for half-tiles: `{ "cx":4, "cy":3, "type":"brick", "bits":3 }` (bits = quarter mask) or `{ "type":"steel" }` / `{ "type":"empty" }`.
- `enemies`: run-length list, **in spawn order**: `B`=basic, `F`=fast, `P`=power, `A`=armor. Must total **20**. Carrier flags are **position-based** (see below), not in the string.
- **Carriers (flashing red):** the **4th, 11th, and 18th** enemy spawned in a stage **[EXACT]** (indices 3, 10, 17). In later stages fewer-than-20 enemies may be used; keep these indices.

### 6.1 Stage 1 layout — reconstruction from the reference screenshot [APPROX]
The `map13` above is a faithful *reconstruction* of the screenshot (brick columns at tiles 1,3,5,7,9,11; steel at left & right edges mid-height; centre steel block; a brick "arch" above the eagle fortress). The agent **must visually compare** its rendering of Stage 1 against the screenshot and fix mismatches using `overrides` (e.g. partial staircase bricks at rows 6 and the notches in column 1). In the screenshot there are some half-height pieces: top of columns 3/5/7 at row 1 are **half tiles** (top half only) — use `overrides`.

### 6.2 The other 34 stages
The original has **35 stages**. We don't have the exact data reproduced here. Two options:
1. **Author them** yourself following the "Stage design rules" below (acceptable for v1; ship 10–15 stages, then expand).
2. Provide a loader so the user can drop in stage JSONs.

**Stage design rules (to feel like the originals):**
1. Always keep the **Eagle fortress** (5 bricks) and the three spawn gates + P1/P2 spawns clear.
2. Symmetry is common but not required; early stages are mostly brick lanes with a few steel blocks.
3. Stage progression: 1–6 brick-heavy, open; 7–15 introduce **water** moats and **trees** patches; 16–25 introduce **ice** fields and steel mazes; 26–35 dense steel, narrow corridors, hard to defend.
4. There must always be a **path from every enemy gate to the Eagle** (through bricks/steel counts as blocked for pathing, but bricks can be shot) — never fully enclose the base with steel.
5. Dead-end pockets near the top are *good* (they funnel enemies).
6. Don't place more than ~35% of tiles as solid.

### 6.3 After stage 35
Loop back to stage 1 **[APPROX]** (original loops with slightly different behaviour; v1: loop and keep going, difficulty constant).

## 7. Terrain animation
- Water: toggle between 2 frames every 32 ticks [APPROX].
- Trees/ice: static.
- Brick: no animation. Eagle: static (destroyed variant on loss).

## 8. Helper functions the agent must implement
```js
tankCanOccupy(x, y)         // 16×16 rect at (x,y) vs: map bounds, bricks (quarter-level), steel, water, eagle, other tanks
getCellsInRect(x,y,w,h)     // iterate 8×8 cells overlapped
isOnIce(tank)               // center tile is ice
isUnderTrees(x,y)           // for render/AI hiding only; no gameplay effect except visibility
```
