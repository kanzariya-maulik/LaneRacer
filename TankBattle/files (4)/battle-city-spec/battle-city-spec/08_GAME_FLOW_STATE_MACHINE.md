# 08 — Game Flow & State Machine

## 1. Top-level states
```
BOOT → TITLE → [MENU choice] → STAGE_INTRO → PLAYING ⇄ PAUSED
                                   ↑              │
                                   │       win ───┤──► STAGE_CLEAR_WAIT → TALLY → (next stage) STAGE_INTRO
                                   │     lose ────┘──► GAME_OVER_ANIM → GAME_OVER_SCREEN → TITLE
```

| State | Duration | Entry actions | Exit |
|---|---|---|---|
| `BOOT` | 1 frame | init audio on first user gesture | → TITLE |
| `TITLE` | until Start | logo scroll, cursor | Start on item |
| `STAGE_INTRO` | ~ 120–180 f | gray screen with `STAGE N`, jingle, curtain open | auto → PLAYING |
| `PLAYING` | until win/lose | spawn players, run sim | win/lose/pause |
| `PAUSED` | until Start | freeze sim, PAUSE text | Start → PLAYING |
| `STAGE_CLEAR_WAIT` | ~ 190 f (≈3 s) | all enemies killed; sim keeps running (bullets/explosions finish, players may still move) | → TALLY |
| `TALLY` | ~ 5–8 s | animate counts | Start/timeout → STAGE_INTRO(next) |
| `GAME_OVER_ANIM` | ~ 180–240 f | red text rises, sim frozen except effects | → GAME_OVER_SCREEN |
| `GAME_OVER_SCREEN` | ~ 200 f | black + big `GAME OVER`, save hi-score | → TITLE |

## 2. PLAYING sub-timeline
```
t=0           stage map loaded, HUD drawn full (20 icons)
t≈0           P1 (and P2) spawn star, 60 f → tank + 180 f shield
t≈0..60       first enemy gate star
every spawnDelay f   next enemy spawn if alive<maxAlive and spawned<20
...
last enemy dies && spawned==20 → STAGE_CLEAR_WAIT
Eagle destroyed → GAME_OVER_ANIM (immediately)
all players out of reserve & dead → GAME_OVER_ANIM
```

## 3. Per-frame update order (server-side) [EXACT order matters for determinism]
```
1. read inputs for this tick (per player)
2. update timers (shield, frozen, clock, shovel, powerup blink, spawnDelay)
3. spawn enemies if due
4. update spawn-star tanks (decrement; activate)
5. move players (turn/snap, move, ice)
6. enemy AI decisions + move
7. firing (create bullets)
8. move bullets (sub-steps), resolve terrain/bullet/tank hits
9. powerup pickup checks
10. death/respawn handling, score, lives
11. win/lose checks → state transitions
12. build snapshot / events
```

## 4. Lives & respawn flow
- Player destroyed → explosion → `respawnTimer = 60` → if reserve>0: reserve--, spawn star at spawn point → shield → control.
- If reserve==0 → player is out (tank gone; keeps spectating). Other player continues.
- All players out → GAME_OVER.
- Starting values: reserve = 3 [EXACT per HUD "3"], stars = 0.

## 5. Stage clear details
- When the 20th enemy dies: wait ~190 frames (so you can still pick up an item? In the original items vanish; **ours: remove items**).
- Persist: players' star level, reserve lives, score → next stage. Reset: shields (give a fresh spawn shield), timers (clock/shovel), items.
- Shovel/Clock active timers are cleared.

## 6. Game start
- Choosing `1 PLAYER` → stage 1, score 0, lives 3, stars 0.
- `2 PLAYERS` → both. In LAN: lobby decides number of players (file 11).

## 7. Hi-score
- Compare at game over; persist when higher. Display on title and tally.

## 8. Frame pacing
- Fixed timestep 60 Hz with accumulator; render with `requestAnimationFrame`. If tab hidden, pause (host) or catch up max 5 steps.
