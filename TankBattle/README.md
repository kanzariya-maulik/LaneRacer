# 2D Multiplayer LAN Tank Combat Game ("Battle Tanks LAN")

A fast-paced, authoritative 60 Hz 2D multiplayer tank action game inspired by the arcade classic **Battle City** (Namco 1985) and modern ultra-responsive network architectures.

---

## Key Features

1. **Authoritative 60 Hz UDP Networking**:
   - Zero-lag simulation running on a fixed 16.67 ms accumulator ticker.
   - Dual transport: **WebRTC DataChannel (`tankDataUDP`)** over UDP for 60 Hz inputs and state delta broadcasts, with automatic seamless **Socket.IO (TCP)** fallback.
   - Client-side prediction and smooth reconciliation.
2. **Sub-Tile Destructible Grid (Dual-Grid Model)**:
   - 26×26 macro blocks (32×32 px) subdivided into 52×52 micro-tiles (16×16 px).
   - 4-bit bitmask per brick block: shells carve out individual sub-tile quadrants, opening sniper slits and narrow breach tunnels.
3. **Heavy Demolition Bombs (`ENTER` Key)**:
   - Launch high-explosive bombs forward with `ENTER`.
   - 54 px AOE shockwave pulverizes brick blocks, shatters steel blocks, deflects projectiles, and deals heavy 2-life damage.
4. **Shell-on-Shell Mid-Air Collisions**:
   - Opposing projectiles cancel each other out in mid-air for defensive counter-firing.
5. **Diverse Tactical Terrain**:
   - **Water Moats**: Impassable to tanks, but shells fly over freely.
   - **Forest / Foliage**: Camouflage concealment for tanks inside.
   - **Ice Tracks**: Reduced friction creates high-speed momentum drifts.
   - **Eagle HQ**: Royal monument. 1 hit = team instant defeat!
6. **3 Custom Battlefield Arenas**:
   - **The Citadel**: Classic urban grid with fortified corridors.
   - **The Velocity Oval**: Stadium / pill arena with curved turnaround loops, sniper water straight, and ambush trench.
   - **The Orbital Ring**: Concentric colosseum with outer ice track, middle brick maze, inner core water moat, and 8 radial spoke gateways.
7. **Pure Web Audio API Sound Synthesizer**:
   - Procedural 8-bit chiptune sound synthesis with zero external mp3/wav files.
   - Dynamic engine hum, cannon blast, bomb detonation rumble, steel ricochets, and two-tone Eagle sirens.

---

## Quick Start

### 1. Install & Run
```bash
cd TankBattle
npm start
```

### 2. Connect
- **Host locally**: Navigate to `http://localhost:3333`
- **LAN Friends**: Navigate to `http://<HOST_IP>:3333` (displayed in server terminal output)

---

## Controls

- `W` / `A` / `S` / `D` or `Arrow Keys`: Maneuver Tank
- `ENTER`: **THROW BOMB** (Heavy Demolition Blast)
- `SPACE`: Cannon Shell

---

## Project Structure

```
TankBattle/
├── docs/
│   ├── architecture_blueprint.md    # Full technical architecture specification
│   ├── lan_multiplayer_guide.md     # LAN hosting, Wi-Fi, and firewall setup
│   ├── game_manual.md               # Combat controls and tactics
│   └── map_specifications.md        # Arena map layouts and geometry
├── src/
│   ├── Game.js                      # Authoritative 60 Hz game loop
│   ├── MapManager.js                # Sub-tile dual-grid physics & bitmasks
│   ├── Maps.js                      # Citadel, Velocity Oval, and Orbital Ring layouts
│   ├── ProjectileEngine.js          # Shells, bombs, and mid-air collisions
│   ├── TankPhysics.js               # Corner assist, ice drift, and collisions
│   ├── PowerupManager.js            # Tactical battlefield powerups
│   ├── webrtcManager.js             # WebRTC UDP DataChannel integration
│   ├── socketManager.js             # Lobby rooms, chat, and signaling
│   ├── lobby.js                     # Lobby rules and input sanitization
│   ├── ticker.js                    # Fixed-step 60 Hz ticker loop
│   └── logger.js                    # Server logging
├── public/
│   ├── index.html                   # Arcade UI & HUD
│   ├── css/style.css                # Retro-arcade military styles
│   └── js/
│       ├── app.js                   # Client coordinator
│       ├── socket.js                # WebRTC & Socket.IO network client
│       ├── input.js                 # Input sampler (WASD + ENTER bomb)
│       ├── predict.js               # Client prediction & reconciliation
│       ├── renderer.js              # Canvas 2D engine & particle effects
│       └── RetroTankAudio.js        # Pure Web Audio chiptune synthesizer
├── test/                            # Unit tests
├── server.js                        # Express & Socket.IO HTTP server entry
└── package.json                     # Standalone project definition
```
