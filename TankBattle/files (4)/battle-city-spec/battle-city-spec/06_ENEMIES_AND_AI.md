# 06 — Enemies, Waves, Spawning & AI

## 1. The four enemy types [EXACT types, APPROX numbers]
| Type | Code | Look | Speed | Bullet | HP | Score |
|---|---|---|---|---|---|---|
| **Basic** | `B` | Gray, simple tank | slow (0.5) | slow | 1 | **100** |
| **Fast** | `F` | Gray/lighter, sleeker (faster treads) | **fast (1.0)** | slow | 1 | **200** |
| **Power** | `P` | Gray, thicker barrel | slow (0.5) | **fast** | 1 | **300** |
| **Armor** | `A` | Bulky; colour changes with HP | slow (0.5) | slow | **4** | **400** |

Armor colour by remaining HP [APPROX]: 4 = green-ish, 3 = yellow/gold, 2 = light gray/white, 1 = normal gray. Each hit recolours it. Carrier flash overrides colours (alternates red ↔ current colour).

Enemy bullets **cannot break steel**, cannot hurt other enemies, and break bricks as weak bullets (4 px slice).

## 2. Wave composition [EXACT]
- **20 enemies per stage**, spawned in the order listed in the stage's `enemies` string.
- **Max simultaneously alive:** **4** for 1 player; **6** for 2 players **[APPROX — community-reported]**. LAN rule [OURS]: `maxAlive = 4 + 2*(numPlayers-1)`, but cap at 8.
- **Total spawned counter** drives the HUD icons: each spawn removes one icon.
- **Carriers:** spawn index 3, 10, 17 (0-based) → flashing red. When hit once: stop flashing and spawn a power-up (file 07).
- Stage clear when **all 20 are spawned and all dead**.

Example compositions (design guidance for authored stages):
| Stage band | Mix per 20 |
|---|---|
| 1–2 | 18 B, 2 F (stage 1 is exactly this) |
| 3–6 | mostly B + several F, a couple P |
| 7–15 | B/F/P mix, 1–3 A near the end |
| 16–25 | many P and A, F frequent |
| 26–35 | heavy P/A, F often; last 6 usually armor/power |
Put tougher tanks **later** in the list.

## 3. Spawn timing [EXACT formula, APPROX constants]
Enemy spawn interval (frames between spawn attempts):
```
spawnDelay = 190 − (stage − 1) × 4 − (numPlayers − 1) × 20      // frames
spawnDelay = max(spawnDelay, 60)
```
- Stage 1, 1 player → 190 frames ≈ 3.2 s between spawns.
- Spawn only when `aliveEnemies < maxAlive` and the next gate is clear.
- First spawn happens right after the stage curtain opens (initial counter starts near 0 so the first enemy arrives within ~1 s). Then every `spawnDelay` frames.
- When an enemy dies, **do not** spawn immediately; the timer still governs.
- Gates rotate: left (0,0) → center (6,0) → right (12,0).
- A gate is **blocked** if any tank overlaps the 16×16 spawn area → wait and retry each frame.
- Each spawn plays the **spawn-star** (~60 frames) before the tank becomes active (file 04). It counts as "alive" immediately (so max-alive counts spawning enemies).

## 4. Enemy AI [APPROX — behaviour-level spec, tune by feel]
The original AI is simple, semi-random with a bias toward the player's base. Implement this state machine **per enemy**:

### 4.1 Movement
```
state: dir, moveTimer, blockedTicks
each tick (if active, not frozen by Clock):
  if moveTimer <= 0 or blockedTicks > N:
      pickNewDirection()
      moveTimer = random(30, 120)        // 0.5 – 2 s
  attempt move in dir at speed
  if blocked: blockedTicks++ ; if blockedTicks > 8 → pickNewDirection()
  moveTimer--
```
`pickNewDirection()` weighted random:
| Direction | Weight (default) |
|---|---|
| DOWN (toward base) | **40** |
| toward Eagle horizontally (LEFT if eagle.x < me.x else RIGHT) | **25** |
| toward nearest player horizontally/vertically | **15** |
| random other | **10 each** |
- Exclude the direction that is immediately blocked by solid terrain/water/steel (but **do not exclude bricks** — enemies shoot bricks away).
- Enemies also **turn at 8 px-aligned positions** (same snap rule as players). Prefer to change direction when aligned on a tile centre `(x%16==0 or y%16==0)` to look "intentional".
- Fast enemies: lower `moveTimer` range (20–80) so they zig-zag.
- Enemy never stops moving long; if stuck facing a brick wall it **shoots** it (see firing).

### 4.2 Firing
```
each tick, if bulletsInFlight < 1 and not spawning/frozen:
    p = baseFireChance
    if facing a brick/steel wall within 1 tile: p = 0.12 (to clear the way)
    if aligned with Eagle and facing it (same column/row, line clear of steel): p = 0.30   // aggressive on base
    if aligned with a player and facing: p = 0.20
    else p = 0.012                      // ≈ 0.7 shots/s random
    if random() < p: fire()
```
- Power tanks: same chances but their bullets are fast.
- **Armor** tanks: slightly lower random fire (0.008).
- This makes enemies shoot walls near the base. That's the iconic "Eagle gets sniped" threat.

### 4.3 Base-seeking [EXACT concept]
Enemies are drawn toward the bottom/center. Over time (≥ 5 s after spawn) bias DOWN weight by +15 to raise pressure. Do **not** implement pathfinding; randomness + bias is the authentic feel.

### 4.4 Interaction rules
- Enemies cannot pass each other or players; they re-pick direction when blocked by a tank.
- Enemies ignore trees (no concealment AI) [EXACT — they just don't care].
- Enemies on **ice** slide like players.
- Clock powerup: all enemies **frozen for ~10 s** (no move, no fire); they can still be shot; carrier flashing continues.
- Grenade: destroys all on-field enemies instantly with explosions (spawning ones also?). Spawning stars are **not** killed; **[APPROX]** only fully spawned ones die.

## 5. Difficulty scaling [OURS knobs]
| Knob | Default | Effect |
|---|---|---|
| `enemyFireScale` | 1.0 | multiply all fire chances |
| `spawnDelayScale` | 1.0 | multiply spawn delay |
| `maxAliveOverride` | auto | override max alive |
Keep defaults equal to original; knobs only for LAN balance (e.g., 4 players).

## 6. Enemy data
```js
enemy = { ...tank, kind:'basic', hp:1, speed:0.5, bulletSpeed:3, carrier:false,
          moveTimer:0, blocked:0, spawnIndex:0 }
```
