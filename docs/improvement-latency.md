# 🏎️ LaneRacer Netcode & Latency Optimization Specification
**Exhaustive Research, Bottleneck Analysis, and Technical Blueprint for Zero-Visual-Latency LAN & Online Play**

---

## 1. Executive Summary & Problem Statement

In real-time multiplayer racing games, players expect **instant response times** and **silky smooth opponent motion**. On a Local Area Network (LAN), physical round-trip time (RTT) is typically sub-5ms. However, players may still experience micro-stuttering, input lag, visual hitching, or rubber-banding.

This document breaks down:
1. How AAA multiplayer titles (e.g., *Rocket League*, *iRacing*, *TrackMania*, *Counter-Strike 2*, *GGPO*) achieve sub-millisecond perceived latency.
2. A deep engineering audit of LaneRacer’s existing netcode (`src/ticker.js`, `src/webrtcManager.js`, `public/js/netsync.js`, `public/js/predict.js`, `public/js/game3d.js`).
3. Concrete, actionable technical improvements to achieve zero-latency performance in LaneRacer across all subsystems (Physics, Network Transport, Binary Protocol, AudioWorklet, and Frame Pacing).

---

## 2. Benchmark Study: How Top Online & LAN Games Eliminate Latency

Modern multiplayer games achieve seamless zero-latency visuals using five core architectural pillars:

### A. Deterministic Client-Side Prediction & Rewind-Replay (*Rocket League*, *Overwatch*)
* **Mechanism**: When the local player accelerates, steers, or brakes, the client executes vehicle physics **instantly** without waiting for server confirmation.
* **Reconciliation**: Inputs are stamped with a sequence number (`seq`). When an authoritative server state snapshot arrives, the client compares its predicted state against the server state. If a drift exists, the client **rewinds** to the server snapshot and **replays** all unacknowledged inputs instantly within a single frame.

### B. High-Precision Engine Ticking & Sub-Tick Input (*Counter-Strike 2*, *Valorant*)
* **Mechanism**: Standard OS timers (like Windows default timer resolution of 15.6 ms) cause tick drift and micro-bursting. AAA games set Windows multimedia timer resolution to 1 ms (`timeBeginPeriod(1)`) and run high-frequency event loops using high-resolution hardware counters (`QueryPerformanceCounter` / `process.hrtime.bigint()`).
* **Sub-Tick Sampling**: Inputs sample exact sub-frame timestamps (e.g. key pressed 4.2 ms into a 16.6 ms frame) so the physics engine evaluates inputs at exact continuous fractional times rather than quantized grid lines.

### C. Binary State Packing & Delta Compression (*iRacing*, *TrackMania*)
* **Mechanism**: JSON or string-based serialization introduces massive network packet overhead and triggers JavaScript V8 garbage collection (GC) pauses during parsing.
* **Binary Streams**: Games send compact, fixed-width byte arrays (`ArrayBuffer` / `DataView`). Vectors are packed into 16-bit fixed-point integers, flags into bitmasks, reducing state updates to **~28-36 bytes per vehicle**.

### D. Unordered, Unreliable UDP Transport (*GGPO*, WebRTC DataChannels)
* **Mechanism**: TCP (and Socket.IO over HTTP/WebSocket) enforces in-order delivery and automatic retransmissions. If a single packet drops, **Head-of-Line (HoL) Blocking** stalls all subsequent packets until the dropped packet is retransmitted.
* **UDP Semantics**: Real-time position updates use unordered, unreliable DataChannels (`maxRetransmits: 0`). A dropped position update is immediately superseded by the next arriving frame, eliminating latency spikes.

### E. Adaptive Snapshot Interpolation & Dead Reckoning (*Battlefield*, *Halo*)
* **Remote Opponents**: Opponent cars are rendered using a combination of **Hermite/Bézier curve interpolation** over a small adaptive jitter buffer (for smooth motion) or **Dead-Reckoning (Arc Projection)** for present-time alignment.

---

## 3. Engineering Audit of LaneRacer's Netcode Architecture

A detailed inspection of LaneRacer’s codebase reveals **5 primary latency & stutter bottlenecks**:

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │                            LANERACER BOTTLENECK MAP                              │
 ├───────────────────┬──────────────────────────────────┬───────────────────────────┤
 │ Subsystem         │ Source Code Location             │ Primary Latency Vulnerability │
 ├───────────────────┼──────────────────────────────────┼───────────────────────────┤
 │ 1. Server Loop    │ src/ticker.js                    │ Windows 15.6ms timer drift│
 │ 2. Network Format │ socketManager.js / webrtcManager │ JSON.stringify overhead   │
 │ 3. Transport      │ public/js/socket.js              │ Socket.IO TCP fallback    │
 │ 4. Client Pred.   │ public/js/predict.js             │ Exponential error blend   │
 │ 5. Render Pacing  │ public/js/game3d.js              │ Frame/tick decoupler      │
 └───────────────────┴──────────────────────────────────┴───────────────────────────┘
```

### Bottleneck 1: Windows OS Timer Quantization (`src/ticker.js`)
* **Problem**: `Ticker.poll()` relies on `setInterval(() => this.poll(), 1)`. On Windows Node.js, `setInterval` defaults to a system timer resolution of **15.625 ms**.
* **Impact**: Instead of polling every 1 ms, Node wakes up every 15.6 ms. The server ticker executes 0 ticks, then bursts 2 ticks simultaneously. This creates periodic packet delivery micro-bursts and engine tick jitter on Windows hosts.

### Bottleneck 2: JSON Payload Serialization Overhead
* **Problem**: Fast 60 Hz game updates serialize position, velocity, speed, steer, flags, and timing into nested JSON objects (`JSON.stringify({ type: 'STATE', data: ... })`).
* **Impact**: At 60 Hz with multiple cars, JSON stringification generates string garbage in V8, increasing frame times and producing network payload sizes of ~300-600 bytes per tick instead of ~30 bytes.

### Bottleneck 3: Socket.IO TCP Fallback & ICE STUN Latency
* **Problem**: When a client joins, WebRTC DataChannel negotiation requires signaling over Socket.IO. If ICE candidate gathering stalls (e.g. waiting for Google STUN servers on offline LANs), the client falls back to Socket.IO.
* **Impact**: Socket.IO runs over TCP HTTP WebSockets with Nagle's algorithm enabled by default, causing 20ms - 100ms buffering delays and TCP HoL retransmission stalls on packet drop.

### Bottleneck 4: Fixed Interpolation Delay on Low-Ping LANs (`public/js/netsync.js`)
* **Problem**: `SnapshotBuffer.targetDelayS()` sets a minimum interpolation floor of `MIN_DELAY_S = 0.035` (35 ms).
* **Impact**: On a 1 ms LAN network, remote cars are rendered 35 ms in the past when using smooth interpolation mode.

### Bottleneck 5: Client Input Sampling & Frame Pacing (`public/js/game3d.js`)
* **Problem**: Client inputs are polled inside `requestAnimationFrame` using a time accumulator `simAcc`. On high refresh rate monitors (120Hz, 144Hz) or low FPS frames, step timing can jitter if `simAcc` accumulates fractional tick remainders.

---

## 4. Technical Blueprint & Actionable Implementation Plan

To eliminate latency and guarantee sub-5ms responsiveness on LAN and smooth online play, we recommend implementing the following optimizations in LaneRacer when ready:

### Phase 1: High-Precision Node.js Server Ticker (`src/ticker.js`)
Replace `setInterval(..., 1)` with a high-resolution loop using `process.hrtime.bigint()` and recursive `setImmediate` or `setTimeout(0)` with a microsecond-busy spin:

```javascript
// High-precision node ticker avoiding 15.6ms Windows resolution timer floor
class HighResTicker {
    constructor(stepMs, run) {
        this.stepNs = BigInt(Math.round(stepMs * 1e6));
        this.run = run;
        this.running = false;
        this.nextNs = 0n;
    }

    start() {
        this.running = true;
        this.nextNs = process.hrtime.bigint();
        const loop = () => {
            if (!this.running) return;
            const now = process.hrtime.bigint();
            let count = 0;
            while (now >= this.nextNs && count < 4) {
                this.run();
                this.nextNs += this.stepNs;
                count++;
            }
            if (now - this.nextNs > this.stepNs * 5n) {
                this.nextNs = now + this.stepNs; // resync on severe stall
            }
            setImmediate(loop);
        };
        setImmediate(loop);
    }

    stop() { this.running = false; }
}
```

### Phase 2: Binary Packet Serialization Protocol (`src/socketManager.js` & `public/js/netsync.js`)
Convert 60 Hz fast update packets into compact binary `ArrayBuffer` format:

#### Snapshot Binary Layout (32 bytes per car):
| Offset | Type | Field | Description |
|---|---|---|---|
| 0 | `Uint32` | `seq` | Server snapshot sequence number |
| 4 | `Float32` | `serverTime` | Session clock time (seconds) |
| 8 | `Uint8` | `carIndex` | Player car index (0-19) |
| 9 | `Uint8` | `flags` | Bitmask (inPit, limiter, drs, ghost, etc.) |
| 10 | `Uint16` | `lastSeq` | Unacknowledged client input sequence |
| 12 | `Float32` | `posX` | World X coordinate |
| 16 | `Float32` | `posY` | World Y coordinate |
| 20 | `Int16` | `angle` | Rotation angle scaled (`rad * 10000`) |
| 22 | `Int16` | `speed` | Vehicle speed scaled (`m/s * 100`) |
| 24 | `Int16` | `steer` | Steering angle scaled (`rad * 10000`) |
| 26 | `Int16` | `velX` | Velocity X scaled (`m/s * 100`) |
| 28 | `Int16` | `velY` | Velocity Y scaled (`m/s * 100`) |
| 30 | `Uint16` | `tow` | Slipstream value |

*Result*: Payload size decreases from **~400 bytes to 32 bytes per car**, eliminating JSON parse latency and network bandwidth overhead.

### Phase 3: Immediate Local ICE Candidate Gathering & Direct UDP Fast-Path
1. Add `host` ICE candidate generation immediately on local network interfaces without waiting for external STUN server resolution timeouts.
2. In `webrtcManager.js`, set WebRTC DataChannel configuration explicitly to `{ ordered: false, maxRetransmits: 0 }` and enable TCP `noDelay: true` on Socket.IO fallback sockets (`socket.conn.transport.socket.setNoDelay(true)`).

### Phase 4: Dynamic LAN/WAN Interpolation Tuning (`public/js/netsync.js`)
Adapt `targetDelayS()` dynamically based on network jitter and RTT:
* **LAN Mode (RTT < 10ms, Jitter < 2ms)**: Reduce `MIN_DELAY_S` from `0.035s` (35ms) to `0.012s` (12ms ~ 0.7 frames delay).
* **WAN Mode (Internet Play)**: Keep adaptive jitter buffer scaling (`2 * TICK_S + 2 * jitterP95`).

### Phase 5: Client Sub-Tick Prediction & Exponential Error Decoupling (`public/js/predict.js`)
1. **Sub-Tick Input Timestamps**: Capture continuous input timestamps (`performance.now()`) to accurately evaluate physical acceleration across variable monitor refresh rates.
2. **Smooth Visual Blending**: On client prediction reconciliation, if position error is small (< 15 cm), blend position errors exponentially over **30ms** (`BLEND_TAU_S = 0.033`) without snapping, rendering the local car completely smooth even under minor packet loss.

### Phase 6: WebAudio AudioWorklet Low-Latency Buffer Alignment (`public/js/audio/v8-worklet.js`)
1. Align WebAudio AudioWorklet buffer render blocks (128 samples) with system hardware audio quantum sizes (2.67ms at 48kHz).
2. Schedule engine pitch & RPM parameter changes (`AudioParam.setValueAtTime`) using exact audio context hardware timestamps (`audioCtx.currentTime`) rather than main-thread JS timers to prevent engine audio pitch stuttering during heavy visual frames.

### Phase 7: Delta State Compression (Bitpacking & XOR Encoding)
1. For stationary or smoothly cruising remote cars, transmit only delta changed fields (XOR masks) rather than full 32-byte snapshots every tick.
2. Skip sending redundant static flags when state remains unchanged between ticks.

### Phase 8: High-Hz Monitor Render Frame Pacing (`public/js/game3d.js`)
1. Decouple `requestAnimationFrame` render rate (60Hz, 120Hz, 144Hz, 240Hz) from the fixed 60Hz physics step rate.
2. Calculate fractional frame alpha `t_alpha = simAcc / STEP_S` and interpolate car visual transforms smoothly across high refresh rate displays.

---

## 5. Summary of Recommended Action Items

| Priority | Feature / Refactor | Files to Modify | Expected Performance Gain |
| :--- | :--- | :--- | :--- |
| **P0** | High-precision `hrtime` server loop | [src/ticker.js](file:///D:/LaneRacer/src/ticker.js) | Eliminates 15.6ms Windows tick jitter & micro-bursting |
| **P0** | Disable TCP Nagle algorithm on Socket.IO fallback | [src/socketManager.js](file:///D:/LaneRacer/src/socketManager.js) | Reduces fallback transport latency by 10-40ms |
| **P1** | Compact Binary `ArrayBuffer` Serialization | [src/game/Game.js](file:///D:/LaneRacer/src/game/Game.js), [public/js/netsync.js](file:///D:/LaneRacer/public/js/netsync.js) | Cuts payload size by 90%, eliminates V8 GC pauses |
| **P1** | LAN-optimized low-delay interpolation (12ms floor) | [public/js/netsync.js](file:///D:/LaneRacer/public/js/netsync.js) | Reduces opponent render delay on LAN from 35ms to 12ms |
| **P2** | Sub-Tick input sampling & high-Hz frame pacing | [public/js/predict.js](file:///D:/LaneRacer/public/js/predict.js), [public/js/game3d.js](file:///D:/LaneRacer/public/js/game3d.js) | Silky smooth local driving response on high-Hz monitors |
| **P2** | AudioWorklet `currentTime` param scheduling | [public/js/audio/v8-worklet.js](file:///D:/LaneRacer/public/js/audio/v8-worklet.js) | Prevents V8 audio pitch stutter under frame drops |
| **P3** | Delta State Compression (Bitpacking) | [src/socketManager.js](file:///D:/LaneRacer/src/socketManager.js) | Optimizes network bandwidth for 10+ car lobbies |

---

*This document serves as the foundational engineering reference for optimizing LaneRacer's real-time netcode and visual responsiveness.*
