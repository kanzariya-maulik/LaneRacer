# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Friends racing together on one local network: one laptop runs the Node server and hosts, everyone else opens it in a
desktop browser (laptops and desktops only; keyboard or gamepad). They sit in the same room or on the same WiFi and
want to get from "open the link" to "lights out" quickly, then race again.

## Product Purpose
LAN Race is a multiplayer F1 racing game for a LAN party: real 2023 cars and liveries, real circuits, qualifying, tyre
strategy, pit stops, AI drivers to fill the grid. Success is a session where everyone joins, picks a team, the host
sets the race and starts it, and no one waits on a slow machine or a confusing screen.

## Positioning
A console-style F1 race weekend that runs in the browser on your own network: no install, no accounts, no internet.
The host's laptop is the server; the lobby is the paddock where the group gathers.

## Operating Context
- The host chooses track, time of day, laps, qualifying format, collisions, AI drivers and level, tyre wear, driver
  help; everyone else sees the settings and readies up. Only the host can start.
- 11 team entries (10 teams + the Red Bull Suzuka special), 2 seats each, 22 grid slots shared by humans and AI.
- Each driver keeps personal settings: graphics level, racing line, braking/steering help, coach, other-car smoothing,
  volume, start tyre, engine sound.
- Lobby chat for the group; ping shown because the network matters.
- Weak laptops are common at LAN parties: load time and GPU cost are real constraints (see Capabilities).

## Capabilities and Constraints
- Plain HTML/CSS/JS served by Express; three.js (WebGPU with WebGL2 fallback) for 3D; Socket.IO for lobby state.
- Per-team car GLB models (meshopt-compressed) and liveries already load in the browser for the race.
- Lobby must stay light on slow laptops: anything heavy (a live 3D scene) needs a cheap fallback on Low graphics.
- The game is LAN-only and will never be published online: no credits screen, no accounts, no store presence.

## Brand Commitments
- Name: LAN Race.
- Real F1 2023 team names, team colours and car names (RB19 etc.) are used as game content.

## Evidence on Hand
- Team data: `public/teams.json`; car models: `public/models/cars/*.glb`; liveries: `public/liveries/`.
- 14 circuits with real layouts (`setting-track` options in `public/index.html`).
- No screenshots, trailers or marketing assets exist; nothing to fabricate.

## Product Principles
1. Lights out fast: every screen shortens the path from joining to racing.
2. The host is in control; everyone else always knows what the host chose and who is ready.
3. Feels like a real F1 game weekend, not a web form.
4. Runs on the weakest laptop in the room.
