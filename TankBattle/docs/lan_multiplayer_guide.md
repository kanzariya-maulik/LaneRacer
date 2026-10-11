# Battle Tanks LAN — Multiplayer Setup & Networking Guide

This guide covers setting up, hosting, and connecting to Battle Tanks across a Local Area Network (LAN), Wi-Fi, or direct hotspot.

---

## 1. Starting the Host Server

### Prerequisites
- Node.js (version 18 or newer recommended, tested on Node v22.17.0).
- Open terminal inside the `TankBattle` directory:
```bash
cd D:\LaneRacer\TankBattle
npm start
```

### Server Startup Output
When the server boots, it queries the machine's network interfaces and outputs:
```
======================================================
       2D MULTIPLAYER LAN BATTLE TANKS ENGINE         
======================================================
> Local Play:      http://localhost:3333
> LAN Friends:     http://192.168.1.45:3333
> Protocol:        WebRTC DataChannel (UDP 60Hz) + Socket.IO
======================================================
```

---

## 2. Connecting Client Machines

1. **Host Computer**:
   - Open browser and navigate to: `http://localhost:3333`

2. **Friends on the Same Wi-Fi / LAN / Hotspot**:
   - Open any modern browser (Chrome, Firefox, Edge, Safari) and navigate to the Host's LAN IP:
     `http://<HOST_IP>:3333` (e.g. `http://192.168.1.45:3333`)
   - No external downloads, plugins, or software installations are required.

---

## 3. Windows Firewall Configuration

If players on other computers cannot load the page:
1. Open Windows Firewall Settings.
2. Ensure inbound connections on TCP port `3333` (and UDP for WebRTC) are allowed for Node.js.
3. Quick test via PowerShell (Admin):
```powershell
New-NetFirewallRule -DisplayName "Battle Tanks LAN" -Direction Inbound -LocalPort 3333 -Protocol TCP -Action Allow
```

---

## 4. WebRTC UDP vs TCP Fallback

- The engine prioritizes **WebRTC DataChannels** (`tankDataUDP`) with `ordered: false` and `maxRetransmits: 0`. This replicates raw UDP behavior, eliminating head-of-line blocking.
- The top-right HUD badge displays the active network transport:
  - `UDP (WebRTC) | 8ms` : Direct low-latency UDP active.
  - `TCP (Socket.IO) | 16ms` : Fallback mode active while UDP channel negotiates ICE candidates or if UDP is blocked by a strict router.
