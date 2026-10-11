# 13 — Testing & "Does It Feel Like Battle City?" Checklist

## A. Golden numbers (copy into `constants.js` and unit-test)
| Name | Value |
|---|---|
| Logical canvas | 256×240 |
| Playfield rect | x16 y8 w208 h208 |
| Tile / Cell | 16 / 8 px |
| Tank size | 16×16 |
| Player speed | 0.75 px/f |
| Enemy speeds | basic 0.5 · fast 1.0 · power 0.5 · armor 0.5 |
| Bullet speeds | slow 3 · fast 6 px/f |
| Enemies per stage | 20 (max alive 4 / 6 for 2P) |
| Carriers | spawn index 3, 10, 17 |
| Spawn delay | 190 − 4·(stage−1) − 20·(players−1) |
| Armor HP | 4 |
| Scores | 100 / 200 / 300 / 400 · pickup 500 |
| Extra life | every 20 000 |
| Start lives | 3 |
| Spawn shield | ~180 f · Helmet ~600 f · Clock ~600 f · Shovel ~1200 f |
| Freeze (friendly fire) | ~150 f |
| Spawn star | ~60 f |
| Player death | reset stars to 0 |
| Eagle | 16×16 at tile (6,12); dies to any bullet |

## B. Automated tests (headless `sim.js`)
1. **Determinism**: same seed+inputs ⇒ identical hash after 3600 ticks.
2. **Snap turning** (file 04).
3. **Gap test**: tank passes 16-px gap, blocked by 8-px gap.
4. **Brick erosion** (file 05) all four directions, weak vs strong.
5. **Steel**: weak blocked, strong destroys.
6. **Bullet cancel** player↔enemy yes, enemy↔enemy no.
7. **Friendly fire** freeze, no damage, no kill.
8. **Eagle** destroyed by own bullet.
9. **Spawn**: 20 enemies, ≤ max alive, carriers correct, gate rotation.
10. **Armor**: 4 hits; carrier armor loses flash on first hit & drops item once.
11. **Powerups**: each effect and duration; shovel restores fresh bricks.
12. **Scoring/lives**: 20k boundary; death resets stars; reserve decrement.
13. **State machine**: win → tally → next stage; lose → game over.
14. **Network**: serialize/deserialize snapshot round-trip; client applies tile events to match server hash of map.

## C. Manual "feel" checklist (play for 10 minutes)
**Visual**
- [ ] Pixel-crisp at every scale; no blur, no sub-pixel jitter.
- [ ] Gray border + right panel exactly like the reference; enemy icons in 2×10 grid shrinking.
- [ ] Bricks red-orange with mortar, steel bevelled, water shimmers, trees hide tanks.
- [ ] Eagle looks like an eagle; ruined variant on loss.
- [ ] Spawn stars flicker before tanks appear.
- [ ] Carriers flash red.

**Handling**
- [ ] Tank stops *instantly* when key released (except on ice).
- [ ] Turning at a corridor entrance auto-aligns so you slide into 16-px corridors easily.
- [ ] You cannot squeeze through half-tile gaps.
- [ ] Fast enemy is clearly faster than you.

**Combat**
- [ ] Only one bullet at a time at star 0; you *feel* the wait.
- [ ] Shooting a wall carves it in 4-px steps.
- [ ] Shooting down an enemy bullet works.
- [ ] Armor tanks visibly change colour per hit.
- [ ] Enemies shoot the walls around the Eagle; the base falls if ignored.

**Flow**
- [ ] STAGE N gray curtain → opens to black playfield.
- [ ] Enemy trickle ~ every 3 s on stage 1.
- [ ] Clear → short wait → tally counts up with ticks.
- [ ] Game over text rises from the bottom and settles center.
- [ ] Pause blinks.

**Audio**
- [ ] Engine drone changes when moving; shots, explosions, pickups all distinct and 8-bit-ish; no music during play.

**LAN**
- [ ] 2+ players see the same events; no rubber-banding.
- [ ] Friendly-fire freeze feels the same for both.

## D. Common failure modes to avoid
| Symptom | Likely cause |
|---|---|
| Game feels huge/floaty | using 32 px tiles or smooth movement — must be 16 px tiles, 0.75 px/f |
| Walls vanish in one hit | brick granularity wrong (file 05) |
| Can't enter corridors | missing axis-change snap |
| Boring | no waves/AI, enemies not shooting walls |
| Unfair deaths | bullets tunnelling or hit boxes larger than 4×4 |
| Desync | non-deterministic sim (`Date.now`, `Math.random`, float accumulation) |
| Blurry | non-integer scaling / smoothing on |
