# 04 — Tanks, Movement, Collision, Upgrades

## 1. Tank basics [EXACT]
- Size **16×16 px**. Collision box = full 16×16.
- 4 facing directions: UP, RIGHT, DOWN, LEFT. Sprite is rotated per direction (file 09).
- **Players die in one hit.** No health bars.
- Position stored in **fixed-point 1/16 px** integers (`x16 = px*16`) for deterministic sub-pixel speed (see file 11). Rendering uses `x16 >> 4`.

## 2. Speeds (px per frame @ 60 Hz) [APPROX — expose all as constants]
| Tank | Speed (px/frame) | px/second | Feel |
|---|---|---|---|
| Player (any star level) | **0.75** | 45 | crosses field in ~4.6 s |
| Enemy **Basic** | 0.50 | 30 | slow |
| Enemy **Fast** | 1.00 | 60 | faster than player — scary |
| Enemy **Power** | 0.50 | 30 | normal speed, fast bullets |
| Enemy **Armor** | 0.50 | 30 | 4 HP |
> **[TUNE]** If the player feels sluggish, raise to 0.9. Never exceed Fast enemy speed (1.0). Player should be slower than a Fast tank.

## 3. Movement & turning rules [EXACT — most important feel rule]
1. **Only 4-way movement.** One direction at a time.
2. While a direction key is held, the tank moves in that direction each frame at its speed *if the destination is free*.
3. **Turn snapping (grid alignment):**
   - If the tank **changes axis** (horizontal ↔ vertical), first **snap the coordinate on the *new perpendicular* axis to the nearest multiple of 8 px**, then start moving.
     - Turning from moving LEFT/RIGHT to UP/DOWN → snap **x** to nearest multiple of 8.
     - Turning from UP/DOWN to LEFT/RIGHT → snap **y** to nearest multiple of 8.
   - Reversing (UP↔DOWN or LEFT↔RIGHT) **does not snap**.
   - Rounding: `snapped = Math.round(v / 8) * 8` (round half up). If the snapped position collides, **cancel the snap** and keep the old position (the tank just turns in place).
4. The tank **can turn in place** even if blocked (changes facing; only movement is blocked).
5. If blocked while moving, the tank stops (does not slide along walls).
6. Tanks block each other: movement into another tank's rect is refused (no pushing).
7. **No acceleration/deceleration** (except on ice).
8. The tread animation advances only while the tank actually moves.

```js
function tryTurn(t, newDir) {
  const axisChange = (isHoriz(t.dir) !== isHoriz(newDir));
  if (axisChange) {
    let nx = t.px, ny = t.py;
    if (isHoriz(newDir)) ny = Math.round(t.py / 8) * 8;   // moving to LEFT/RIGHT: align y
    else                 nx = Math.round(t.px / 8) * 8;   // moving to UP/DOWN:   align x
    if (canOccupy(nx, ny, t)) { t.px = nx; t.py = ny; }
  }
  t.dir = newDir;
}
```

## 4. Collision with terrain [EXACT]
A tank at `(x,y)` can occupy the position iff its 16×16 rect:
- is fully inside the 208×208 playfield,
- does not overlap any **steel** cell, **water** tile, **Eagle**, any remaining **brick quarter**,
- does not overlap another tank rect.
Trees and ice never block.

## 5. Ice [APPROX]
- If a tank's **center tile** is ice and the move key is **released**, the tank **continues to slide** in its facing direction for about **16–24 frames** at its normal speed, then stops (`ICE_SLIDE_FRAMES = 20`).
- While on ice, normal input still works immediately (you can steer out).
- Sliding stops immediately on collision.
- Applies to all tanks (enemies too).

## 6. Spawning (star animation) [EXACT]
- Every tank (players at stage start/respawn, enemies at gates) first shows a **spawn star**: a 16×16 four-pointed star that cycles through ~4 sizes, flickering, for about **~60 frames (≈ 1 s)**. During this the tank is **not collidable**, cannot move/shoot, cannot be hit.
- After the star, the real tank appears. Players get a **spawn shield** (below).
- Spawn star frame sequence (size shrink/grow): `S3, S2, S1, S2, S3, S2, S1, …` change every 4 ticks.

## 7. Shield (helmet) [EXACT behaviour, APPROX duration]
- Visual: a flickering **dotted/dashed bubble outline** around the tank, alternating 2 frames every ~ 2 ticks.
- **Spawn shield** for players: **~ 3 s (180 frames)**.
- **Helmet powerup shield:** **~ 10 s (600 frames)**.
- Shielded tank takes **no damage** from bullets (bullets still disappear). A shield also blocks the friendly-fire freeze.
- Implementation: `tank.shieldFrames` counter decremented per tick (never use `Date.now()`).

## 8. Player lives & death [EXACT concept, APPROX details]
- HUD shows the **reserve lives** number next to the `IP` label. A new game starts with **3 reserve lives** (HUD `3`) plus the tank you are currently driving.
- On death: if `reserve > 0` → `reserve--`, respawn; if `reserve == 0` → that player is **out**.
- **On death:** big explosion, lose all star upgrades (**back to star 0**), respawn after ~60 frames at the spawn point with star animation, then spawn shield. If the spawn point is occupied by a tank, wait.
- **Extra life:** every **20,000 points** → +1 reserve (file 07), and via the Tank power-up. Max displayed 9.

## 9. Player upgrades — stars [EXACT]
| Star level | Visual | Bullet speed | Max bullets on screen | Brick damage | Steel |
|---|---|---|---|---|---|
| **0** (start) | plain tank | **slow** | **1** | 4 px slice | blocked |
| **1** (1 star) | small marking | **fast** | 1 | 4 px slice | blocked |
| **2** (2 stars) | double marking | fast | **2** | 4 px slice | blocked |
| **3** (3 stars) | heavy tank, big gun | fast | 2 | **8 px (whole cell)** | **destroys steel** |
- Star powerup: `+1` level, capped at 3.
- Death: reset to 0.
- Stage clear: **upgrades persist** to the next stage (they reset only on death).
- Visual differences per level are described in file 09.

## 10. Frozen state (friendly fire) [EXACT]
If a player's bullet hits the other player: **no damage**, bullet disappears, victim is **frozen ~ 2–3 s (≈ 150 frames)** — can't move or shoot; tank flashes. (Shielded players are immune.) In LAN versus mode this is replaced with real damage (file 11).

## 11. Data structure
```js
tank = {
  id, team: 'player'|'enemy', kind: 'P1'|'P2'|'basic'|'fast'|'power'|'armor',
  x16, y16, dir,                 // fixed-point position, 0=UP 1=RIGHT 2=DOWN 3=LEFT
  moving: false, treadFrame: 0,
  stars: 0,                       // player only
  hp: 1,                          // armor: 4
  shield: 0, frozen: 0, spawnFrames: 0, slideFrames: 0,
  bullets: [],                    // live bullet ids
  carrier: false, flashPhase: 0,
  lives: 3                        // player reserve
};
```
