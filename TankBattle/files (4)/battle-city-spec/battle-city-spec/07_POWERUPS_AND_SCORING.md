# 07 — Power-ups, Scoring, Lives

## 1. Power-up delivery [EXACT]
- When a **carrier (flashing red) enemy is hit**, it stops flashing and a power-up **appears at a random location** on the playfield (16×16 tile-aligned **[APPROX]**; avoid solid cells, avoid tank positions).
- The item **blinks** (visible 8 ticks / hidden 8 ticks) and stays **until picked up** (or the stage ends). If a second carrier is hit while one exists, the old item is replaced.
- Picking up: any **player tank** whose 16×16 box overlaps the item. **Enemies cannot pick up.**
- On pickup: effect + **+500 points** to that player + a floating `500` popup for ~ 40 frames + pickup chime.
- Items are drawn **above terrain, below tanks** (below trees).

## 2. The six power-ups [EXACT effects, APPROX durations]
| Icon (16×16) | Name | Effect | Duration |
|---|---|---|---|
| ⭐ star | **Star** | +1 star level (max 3). | permanent until death |
| 🪖 helmet | **Helmet** | Invincibility shield on the player. | ~**10 s** (600 f) |
| ⏰ clock | **Clock / Timer** | **Freeze all enemies** (no movement/fire). | ~**10 s** (600 f) |
| 🛠 shovel | **Shovel** | Base walls become **steel**; flash then revert to **fresh bricks**. | ~**20 s** (1200 f), flash last ~3 s |
| 💣 grenade | **Grenade** | **Destroys all enemies** currently on the field. | instant |
| 🚗 tank | **Tank / 1UP** | **+1 life.** | instant |
Optional [APPROX, appears in some versions like "Tank 1990"]: **Gun/Pistol** — immediately sets player to star 3. Implement behind a flag `ENABLE_GUN`, default off.

Random selection: uniform among the 6 (grenade slightly less likely is acceptable). **[APPROX]**

### Details
- **Helmet** refreshes (does not stack) if you already have a shield.
- **Clock** and **Shovel** are *global timers* in the server state.
- **Grenade** kill scoring: score as normal for the picker **[APPROX; make it a flag]**. Explosions drawn at each enemy.
- Shovel only affects the 5 fortress tiles (tile-level); restore bricks at full strength regardless of damage.
- If **Eagle already destroyed** nothing happens (game over).

## 3. Icons — draw procedurally (16×16)
- Original power-ups are small colourful symbols on a plain tile. We draw:
  - background: transparent, 14×14 with a 1-px dark outline.
  - Star: gold 5-point star; Helmet: dome + visor, blue/gray; Clock: round clock face white + red/black hands; Shovel: brown handle + gray blade; Grenade: dark green/black bomb with fuse; Tank: tiny yellow tank icon.
Draw these with small bitmap strings in `sprites.js` (file 09).

## 4. Scoring [EXACT]
| Event | Points |
|---|---|
| Basic tank | 100 |
| Fast tank | 200 |
| Power tank | 300 |
| Armor tank (on final kill) | 400 |
| Power-up pickup | 500 |
- Hits on armor that don't kill: **0 points**.
- **Extra life every 20,000 points** (player gets +1 reserve when crossing each multiple of 20,000) [EXACT-ish].
- Points per player are tracked separately; **Hi-score** = max single-player score. Persist hi-score: server file `hiscore.json` or `localStorage`.
- In co-op each player scores their own kills.

## 5. Per-stage statistics (for the tally screen)
Per player track `kills = {basic, fast, power, armor}`; tally rows show `count × points`. Reset every stage.
