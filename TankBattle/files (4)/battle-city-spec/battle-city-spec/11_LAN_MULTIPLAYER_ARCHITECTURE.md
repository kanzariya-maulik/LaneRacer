# 11 — LAN Multiplayer Architecture

## 1. Goals
- 1–4 humans on the same LAN play the **classic co-op rules** (files 03–08) against server-controlled AI enemies.
- Optional **Versus** mode [OURS].
- Results must look/feel identical to the single-player original.

## 2. Recommended stack
| Layer | Choice | Why |
|---|---|---|
| Server | Node.js + `ws` (plain WebSocket) | A LAN has < 5 ms latency; 208×208 px world with ≤ ~30 entities. WebRTC/UDP is **not needed**. |
| Client | HTML5 Canvas 256×240 logical | See file 02 |
| Discovery | Host shows `http://<LAN-IP>:3000`; others open the URL. Optional UDP broadcast not needed. | Simple |
| Lobby | Same WebSocket, JSON messages | |
The existing LaneRacer WebRTC/Socket.IO code may be **kept if it already works**, but the protocol below is transport-agnostic. Do not spend time on UDP.

## 3. Authoritative deterministic simulation
- Server runs the **entire game** (`sim.js`) at **fixed 60 Hz**, using **frame counters only** (no `Date.now()` inside the sim).
- Use **integer / fixed-point** math: positions in **1/16 px** units (`x16`), speeds as integers (`0.75 px/f = 12 units/f`, `0.5 = 8`, `1.0 = 16`, bullets `3 px/f = 48`, `6 px/f = 96`).
- Single seeded PRNG (`mulberry32(seed)`) used for **all** randomness (AI, drops, spawns). Same seed + same inputs ⇒ same game. This makes tests and replays possible.
- `sim.js` must be **pure** (no I/O, no DOM) and import-able by both server and a headless test runner (and by the client in single-player mode).

```
sim.step(inputsByPlayer) → events[]       // advance exactly 1 tick
sim.snapshot() → state                    // full state
sim.diff(prev) → delta                    // optional
```

## 4. Input protocol
Client → server, every tick (or on change + 20 Hz keep-alive):
```json
{ "t":"in", "seq": 4812, "dir": 0|1|2|3|-1, "fire": true }
```
- `dir`: held direction (`-1` = none). **Server applies the latest received input each tick.**
- Buffer 2 ticks of input on the server to smooth jitter (**input delay 2 ticks = 33 ms**, imperceptible on LAN).
- Client **predicts only its own tank movement** (optional). Because tank speed is slow (0.75 px/f) and the world is tiny, prediction is **optional**; plain interpolation of server snapshots is fine on LAN.

## 5. Server → client messages
### 5.1 Snapshot (30 Hz recommended; 60 Hz OK)
```json
{ "t":"snap", "tick": 9021,
  "tanks":[ {"id":1,"k":"P1","x":64,"y":192,"d":0,"m":1,"st":0,"sh":120,"fz":0,"tr":0,"hp":1,"c":0} ],
  "bullets":[ {"id":77,"x":72,"y":150,"d":0,"o":1,"s":0} ],
  "item": {"type":"star","x":96,"y":80} ,
  "eagle": 1, "clock": 0, "shovel": 0,
  "hud": { "reserve":[3,2], "score":[1200,0], "enemiesLeft": 14 },
  "events":[ {"e":"fire","by":1}, {"e":"brick","cx":12,"cy":10,"bits":3}, {"e":"boom","x":100,"y":50,"big":0} ] }
```
(Positions are **integer px**, derived from fixed-point.)
### 5.2 Full map (on join/new stage)
```json
{ "t":"stage", "n":1, "cellType":"<base64 676B>", "brickBits":"<base64 676B>", "tileType":"<base64 169B>", "enemyList":"B*18,F*2" }
```
Tile changes are sent as **events** (`brick`, `steel_removed`, `shovel_on/off`). Client applies them to its local copy.
### 5.3 Lobby / control (JSON)
`hello`, `lobby_state`, `ready`, `start`, `pause`, `resume`, `stage_clear`, `tally`, `game_over`, `player_left`.

## 6. Lobby flow
1. Host runs `node server.js`; prints LAN URL.
2. Players open URL → enter name → pick colour/slot (P1 yellow, P2 green, P3 blue, P4 red).
3. Host selects **mode** (Co-op default, Versus), starting stage, and presses START.
4. Everyone sees the **STAGE N curtain** simultaneously (server drives timing).
5. Mid-game join: not supported (late joiners spectate) [OURS].
6. Disconnect: the player's tank is removed, reserve lives kept 30 s for reconnect; else counted as out.

## 7. Co-op rules for N players [OURS scaling]
| Rule | 1P | 2P (classic) | 3P | 4P |
|---|---|---|---|---|
| Max enemies alive | 4 | 6 | 8 | 8 |
| Spawn delay | 190−4s | −20 | −40 | −60 |
| Friendly fire | freeze (classic) | freeze | freeze | freeze |
| Shared base | yes | yes | yes | yes |
Spawn positions in file 03. Enemy list stays at 20 for N ≤ 2; for N ≥ 3 use **30** enemies [OURS] to keep the game long enough (`enemiesPerStage = 20 + 5*(N-2)` for N>2; carriers indices scale proportionally).

## 8. Versus mode [OURS, optional]
- Each player has their own Eagle (positions per file 03 variants) **or** shared arena with team Eagles.
- Real damage between players (no freeze). Bullets never cancel across teams? **They do cancel** (same rule as player-vs-enemy bullets).
- Keep **no enemy AI** in this mode; powerups from random timed drops (every 25 s).
Treat Versus as v2; **do not build until co-op is perfect**.

## 9. Client rendering loop
```
requestAnimationFrame:
   - read keyboard/gamepad → send input if changed
   - take latest snapshot(s); interpolate positions between snapshot[n-1], snapshot[n] (render delay ≈ 50 ms) 
   - render to 256×240 offscreen → integer-scale to screen
   - audio: play from events[] only (never from local guesses)
```
Interpolate **positions only**; snap tile changes immediately. Round to integer px when drawing.

## 10. Single-player mode
Run `sim.js` **in the browser** with the same code (local input), no network. This gives the same behaviour, great for testing and offline play.

## 11. Anti-cheat / robustness (light)
- Server ignores any input fields other than `dir` and `fire`.
- Rate limit to ≤ 120 msgs/s per client.
- Validate `seq` monotonic; drop old.

## 12. File layout
```
/server  server.js  lobby.js
/shared  sim.js  constants.js  rng.js  stages/*.json  collision.js  ai.js
/client  index.html  main.js  render.js  sprites.js  font.js  audio.js  ui_screens.js  input.js  net.js
/test    sim.test.js  golden.test.js
```
