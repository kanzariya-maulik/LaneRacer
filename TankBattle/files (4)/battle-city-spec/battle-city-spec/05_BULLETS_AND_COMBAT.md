# 05 — Bullets, Destruction & Combat Rules

## 1. Bullet basics [EXACT]
- A bullet spawns at the tank's **muzzle** (the middle of the front edge), travels **straight** in the tank's facing direction, never turns.
- Collision size ≈ **4×4 px** (draw 3×4 or 4×4 white/gray pixel blob).
- Bullet **speed** [APPROX/TUNE]: **slow = 3 px/frame (180 px/s)**, **fast = 6 px/frame (360 px/s)**.
- **Max bullets in flight per tank:** players 1 (stars 0–1) or 2 (stars 2–3); **every enemy: 1**.
- Firing is blocked while `liveBullets >= maxBullets`. This is the **only** fire-rate limiter.
- A bullet disappears when it hits anything: wall, steel, brick, eagle, tank, other bullet, or the map edge. It spawns a **small explosion** (8×8–16×16) at the impact point except when killing a tank (then the tank's big explosion).
- Muzzle position: UP → `(cx-2, y-4)` etc. Spawn the bullet so its leading edge is at the tank's front edge (`y` for UP). Do not spawn inside a wall: if the muzzle cell is already solid, resolve the hit immediately on the same tick.

## 2. Per-tick bullet order (deterministic) [EXACT order]
```
1. Move every bullet by its speed (in 1-px sub-steps so fast bullets can't tunnel).
2. For each sub-step: test terrain hits (brick/steel/eagle/edge).
3. Test bullet ↔ bullet.
4. Test bullet ↔ tank.
5. Remove dead bullets, spawn explosions, apply damage, send events.
```
Use **sub-stepping**: for a 6 px/frame bullet do 6 steps of 1 px; stop at the first hit.

## 3. Bullet ↔ terrain [EXACT concept, APPROX constants]
Bullet center `(bx, by)` moving in `dir`.

**Lateral cells touched** — bullet is ~4 px wide, so it touches 1 or 2 cells perpendicular to travel:
- For UP/DOWN: cells at `cx1 = floor((bx-2)/8)` and `cx2 = floor((bx+1)/8)`.
- For LEFT/RIGHT: cells at `cy1 = floor((by-2)/8)` and `cy2 = floor((by+1)/8)`.
The **front cell row/col** is the cell containing the bullet's leading edge.

For each touched front cell:
- **Empty / water / trees / ice** → ignore (bullet passes).
- **Steel**:
  - star < 3 bullet → bullet stops, small explosion, **steel stays**; play "steel ping".
  - star 3 → **steel cell removed**, bullet stops.
  - Enemy bullets: **never** break steel (even Power tanks).
- **Brick** (with `brickBits`):
  - Determine the **front quarter row** facing the bullet:
    - travelling **UP** → hits the **bottom** quarters (bits 2,3) first; if both gone → then top quarters (0,1).
    - **DOWN** → top (0,1) then bottom (2,3).
    - **LEFT** → right quarters (1,3) then left (0,2).
    - **RIGHT** → left (0,2) then right (1,3).
  - Weak bullet (stars 0–2, **and all enemy bullets**): remove **only the first remaining quarter-row** (2 quarters = 4 px deep × 8 px wide per touched cell). Bullet stops.
  - Strong bullet (star 3): remove **both** quarter-rows (whole 8×8 cell). Bullet stops.
  - If the cell had **no bits** in the layers the bullet is hitting (all quarters gone in that cell) the bullet continues into the next cell *in the same sub-step* only if the cell is empty.
- **Eagle:** any bullet (player, enemy) that overlaps the 16×16 eagle → `eagle.alive = false`, large explosion, state → GAME_OVER. **Players can destroy their own base.**
- **Map edge:** bullet stops with small explosion.

Resulting wall look: one shot makes a 4 px-deep notch up to 16 px wide (two cells). Four weak shots needed to clear a 16 px-thick brick tile in one lane (2 per cell-depth). This gives the classic stair-step erosion.

```js
function hitBrickCell(cx, cy, dir, strong) {
  let bits = brickBits[cy*26+cx];
  const order = { UP:[0b1100,0b0011], DOWN:[0b0011,0b1100], LEFT:[0b1010,0b0101], RIGHT:[0b0101,0b1010] }[dir];
  const first = order[0], second = order[1];
  if (bits & first)       bits &= ~(strong ? (first|second) : first);
  else if (bits & second) bits &= ~second;
  brickBits[cy*26+cx] = bits;
  if (bits === 0) cellType[cy*26+cx] = 0;
}
```
(`first` = the quarters facing the bullet.) Emit a `tile` event `{cx, cy, bits}` for the network.

> **[TUNE]** If wall erosion feels too slow/fast relative to reference footage, change the constants `BRICK_SLICE_QUARTER_ROWS_WEAK = 1`, `..._STRONG = 2`.

## 4. Bullet ↔ bullet [EXACT]
- **Player bullet vs enemy bullet** → both disappear (small explosion). This enables shooting down incoming fire.
- **Enemy bullet vs enemy bullet** → **pass through** each other (no collision).
- **Player bullet vs other player's bullet** → pass through (co-op).
- Collision test: AABB overlap of the two 4×4 boxes.

## 5. Bullet ↔ tank [EXACT]
| Shooter → Target | Result |
|---|---|
| Player → Enemy | Damage 1. If `hp==0` → destroyed: score, explosion. Basic/Fast/Power have 1 HP. **Armor 4 HP.** Armor flashes/changes colour per HP. |
| Player → Enemy **carrier** | The hit **removes the red flash** (becomes normal) **and drops a power-up** (appears at a random location); the tank still takes damage normally (armor carriers lose flash on first hit and need all hits). |
| Enemy → Player | **Player destroyed** (unless shielded). |
| Enemy → Enemy | **No effect**; bullet passes (enemy bullets ignore enemy tanks). |
| Player → Player | **No damage; target frozen** (~150 frames). Bullet removed. |
| any → shielded tank | bullet removed, no effect. |
| Bullets vs spawning (star) tank | ignored (pass). |

## 6. Explosions [APPROX visuals]
- **Small explosion** (bullet impact): 3 frames, ~ 16×16, ≈ 8 ticks total.
- **Big explosion** (tank death / eagle): 3 frames, 32×32 centered, ≈ 20 ticks. A 500-point style popup is **not** shown (points shown only on tally) except for powerup pickup (score number popup "500" for ~ 40 frames, white 8×8 text).
- Eagle destruction: big explosion, eagle sprite swaps to "ruins".

## 7. Combat events (send over network / audio)
`bullet_fired`, `brick_hit`, `steel_hit`, `tile_changed`, `tank_destroyed`, `eagle_destroyed`, `bullet_cancelled`, `player_frozen`, `powerup_spawned`, `powerup_picked`.

## 8. Edge cases (implement all)
1. A bullet spawned adjacent to a wall must hit it on its first tick.
2. A tank facing a wall point-blank: firing destroys quarter(s) immediately.
3. Two bullets passing each other head-on in the same tick (swapping positions) must still collide: test using swept positions (sub-stepping handles this).
4. Bullets and tank spawn stars: ignore during star animation.
5. Enemy bullet hitting the same cell as a shielded player: bullet removed, player safe.
6. Bullets destroying power-ups: **no** (powerups are only picked up by tank overlap).
7. Eagle hit takes priority over walls adjacent in the same sub-step.
