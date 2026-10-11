# Battle Tanks LAN — Architectural Blueprint & Technical Implementation

## 1. System Overview
Battle Tanks LAN is a 2D multiplayer combat game inspired by **Battle City** (Namco 1985) and modern LAN action engines. It delivers an authoritative 60 Hz simulation with dual-transport networking:
- **Socket.IO (TCP)**: Lobby handshakes, chat, room state, team selection, and WebRTC ICE signaling.
- **WebRTC DataChannel (UDP)**: High-frequency 60 Hz sequenced client inputs and server delta snapshot broadcasts via `node-datachannel`.

```
+-----------------------------------------------------------+
|                       BROWSER CLIENT                      |
|  - HTML5 Canvas 2D (832x832 px)                           |
|  - Web Audio API (procedural chiptune sound synthesis)     |
|  - Client-side prediction & smooth reconciliation         |
|  - Input sampler: WASD (move), ENTER (bomb), SPACE (shell)|
+-----------------------------------------------------------+
          | (TCP: Lobby & Signaling)    | (UDP: 60 Hz State & Inputs)
          v                             v
+-----------------------------------------------------------+
|                 AUTHORITATIVE NODE.JS SERVER              |
|  - Fixed-step 60 Hz ticker (16.67 ms accumulator)         |
|  - Dual-Grid sub-tile destruction bitmask engine          |
|  - Corner assist & grid snapping                          |
|  - Projectile & Heavy Bomb AOE engine                     |
|  - Shell-on-shell mid-air collision cancellation          |
|  - Multi-team Eagle base victory evaluations              |
+-----------------------------------------------------------+
```

---

## 2. Dual-Grid Resolution Model

The arena operates on a dual-grid resolution to provide micro-destruction without computational lag:
- **Macro Grid**: 26×26 blocks (each block is 32×32 screen pixels, total arena size 832×832 px).
- **Sub-Tile Micro Grid**: Each macro block is subdivided into a 2×2 grid of 16×16 sub-tiles (total 52×52 micro-tiles).

### Brick Sub-Tile Bitmask
Each brick macro block stores a 4-bit bitmask:
```
Sub (0,0) [Bit 0 = 0b0001] | Sub (1,0) [Bit 1 = 0b0010]
---------------------------+---------------------------
Sub (0,1) [Bit 2 = 0b0100] | Sub (1,1) [Bit 3 = 0b1000]
```
When a tank shell strikes, only the impacted 16×16 quadrant is cleared (`mask &= ~bit`). When `mask === 0`, the block is converted to empty ground (`0`). Tanks can maneuver through partially carved brick blocks if their bounding box does not overlap any remaining intact sub-tiles.

---

## 3. Terrain Specifications

| Tile ID | Name | Tank Interaction | Shell Interaction | Bomb Interaction |
| :---: | :--- | :--- | :--- | :--- |
| `0` | Empty Ground | Free movement | Passes through | Passes through |
| `1` | Brick Wall | Blocked by intact sub-tiles | Carves out 16×16 quadrant | Completely obliterated |
| `2` | Steel Block | Blocked | Deflects (pierced by Tier 4) | Shattered by blast |
| `3` | Water Moat | Blocked | Flies over freely | Flies over freely |
| `4` | Forest / Bush | Conceals tank (alpha reduction) | Passes through | Cleared if in blast |
| `5` | Ice Track | Low-friction momentum slide | Passes through | Passes through |
| `9` | Eagle HQ | Blocked | **1 Hit = Instant Team Loss** | **1 Hit = Instant Team Loss** |
| `10` | Destroyed Eagle | Solid obstacle | Solid obstacle | Solid obstacle |

---

## 4. Weapons & Projectiles

### Standard Cannon Shell (`SPACE`)
- Speed: 6.0 pixels per tick.
- Mid-air collision: opposing shells cancel each other out on contact.
- Pierces steel if tank has reached Tier 4.

### Thrown Demolition Bomb (`ENTER`)
- Key: Triggered directly by the `ENTER` key.
- Trajectory: Lobs forward with a timed fuse.
- Blast Radius: 54 pixels (approx. 3.5 tile radius).
- Damage: Pulverizes brick walls, shatters steel blocks, detonates enemy shells, and deals 2-life damage to tanks caught in the blast wave.
- Screen Shake: Triggers dynamic radial screen shake on all clients.

---

## 5. Network Delta Serialization

The server broadcasts authoritative snapshots at 60 Hz over the WebRTC UDP DataChannel:
```json
{
  "seq": 1042,
  "time": 17.36,
  "tanks": [
    { "id": "p1", "x": 128.0, "y": 256.0, "dir": "UP", "moving": true, "alive": true, "tier": 2, "bombReady": true }
  ],
  "shells": [
    { "id": 51, "x": 128.0, "y": 210.0, "dir": "UP", "pierce": false }
  ],
  "bombs": [
    { "id": 12, "x": 130.0, "y": 180.0, "radius": 54, "fuse": 15 }
  ],
  "eagles": [
    { "teamId": "team-red", "col": 12, "row": 24, "alive": true }
  ],
  "gridDiffs": [
    { "idx": 142, "type": 1, "mask": 3 }
  ],
  "events": [
    { "type": "BOMB_BLAST", "x": 130.0, "y": 180.0, "radius": 54 }
  ]
}
```
Client inputs send redundant batches (`[newest, seq-1, seq-2, ...]`) so a dropped UDP packet incurs zero latency.
