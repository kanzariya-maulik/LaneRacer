# Graphics, Performance & Network Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lag-free LAN racing (compact 60 Hz updates, interpolated cars) that runs smoothly on integrated-GPU laptops (Low/Medium/High, adaptive resolution, fewer draw calls) and looks nicer (scenery, glossy cars, textured track).

**Architecture:**
- **Server (`Game`):** sends a compact fast update every tick plus a change-only info update at 10 Hz.
- **Client (pure ES modules, tested in Node like `input.js`):**
  - `public/js/netsync.js` buffers and interpolates the fast updates;
  - `public/js/quality.js` holds the quality presets and the adaptation rules;
  - `public/js/scenery.js` places scenery deterministically.
- **`game3d.js`:** wires them into rendering.

**Tech Stack:** Node 24, `node:test`, Three.js 0.186 (`three/addons`: `RoomEnvironment`, `BufferGeometryUtils.mergeGeometries`), WebRTC DataChannel / Socket.IO.

**Spec:** `docs/superpowers/specs/2026-10-01-graphics-perf-netsync-design.md`

## Global Constraints

- Weakest target: office laptops with integrated GPUs.
- Fast update `{ s, t, c: [[idx, x, y, angle, speed, steer, flags], ...] }`, ≤ 60 bytes per car.
  - `flags`: `inPit 1, limiter 2, drs 4, drsAvailable 8, finished 16, lapValid 32, ghost 64`.
- Info update `game_meta`: at most 10 Hz, only changed fields; the first one is full.
  - Fields: lap, checkpoint, rank, gap, lapsDown, lastLap, bestLap, lapStart, bestLapSectors, lastValid, penalty.
- Interpolation 50 ms behind server time. Extrapolation capped at 100 ms, then hold. Own car: newest update projected forward, capped at 100 ms.
- Quality levels exactly as in the spec table. Auto-pick: start Medium; > 22 ms per frame → Low; < 11.8 ms with dpr ≥ 1 → High.
- Adaptive resolution: < 50 fps → −0.1; > 58 fps for 3 s → +0.05; clamped to the level's range.
- Draw calls on Medium with 20 cars ≤ 150.
- Scenery beyond `width/2 + WALL_OFFSET + 3 m` of every track part, and beyond `pit.width/2 + 6 m` of the pit lane. Generic billboard text, no real brands. Gravel is visual only.
- No new npm dependencies. Every texture is generated in the browser. Commit per task on `feature/3d-f1`; no trailers.

### Deviations from the spec (decided while planning)

1. **Event names stay `game_state` (Socket.IO) and `STATE` (DataChannel)**, carrying the new compact packet, instead of a new `gs` event. Fewer moving parts in the WebRTC code your teammate wrote.
2. **No forced page reload when changing graphics.** The Graphics choice applies from the next race; anti-aliasing (High) after the next page load. A reload in the lobby would kick the player out of the lobby.
3. **No satin "carbon" wing material.** `car.glb` has a single livery material for the whole body (the dark parts are painted into the livery texture). Cars get the environment reflection and gloss; tyres and rims keep their own materials.
4. **Extra draw-call work** to reach ≤ 150 calls with 20 cars:
   - grid bars, garage buildings and box marks become `InstancedMesh`;
   - grid numbers and garage signs become single merged meshes on a canvas atlas;
   - wheels of cars more than 300 m from the camera are hidden.

## Review Focus

1. A late joiner or spectator must see cars move smoothly, even though they missed earlier info updates (`game_init` carries full player objects). Tested in Task 1.
2. A UDP packet arriving late or out of order must never make a car jump backwards. Tested in Task 2.
3. Disconnecting players leave gaps in car indices; the remaining cars must still render. Tested in Task 2.
4. `localStorage` blocked (private window) must not break graphics selection. Covered in Task 5 code and the manual check.
5. Scenery must never be placed where the track doubles back near itself (Suzuka crossover, Spa). Tested in Task 7 on all circuits.

---

### Task 1: Server — compact fast updates and change-only info updates

**Files:**
- Modify: `src/game/Game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Produces:
  - `Game.FLAGS` = `{ inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 }`
  - `Game.META_FIELDS` (array of field names)
  - `game.index` = `{ [playerId]: idx }`, also sent in `initPayload()` as `index`
  - `game.seq` (tick counter)
  - `game.fastPacket()` → `{ s, t, c }`
  - `game.metaDiff()` → `{ [id]: { field: value } }`, possibly `{}`
- Produces events:
  - fast packet via `net.broadcastGameState(packet, io)`, or `io.volatile.emit('game_state', packet)`
  - `io.emit('game_meta', diff)` when the diff is non-empty and `seq % 6 === 1`

- [ ] **Step 1: Write the failing tests.** In `test/game.test.js`, delete the tests `game_state fields` and `game_state carries inPit and limiter`, then append:

```js
test('fast update: compact per-car arrays with flags, at most 60 bytes per car', () => {
    let pkt = null;
    const io2 = { emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkt = d; } } };
    const g = new Game(io2, [lp('a'), lp('b', 'haas')], monza, QUALI, () => {}, 'quali');
    g.update();
    assert.strictEqual(pkt.s, 1);
    assert.strictEqual(typeof pkt.t, 'number');
    assert.strictEqual(pkt.c.length, 2);
    const a = pkt.c.find(e => e[0] === g.index.a);
    assert.strictEqual(a.length, 7);
    const F = Game.FLAGS;
    assert.strictEqual(a[6] & (F.inPit | F.limiter | F.ghost), F.inPit | F.limiter | F.ghost, 'garage car: in pit, limiter, ghost');
    for (const e of pkt.c) assert.ok(JSON.stringify(e).length <= 60, `${JSON.stringify(e).length} bytes`);
    assert.deepStrictEqual(g.initPayload().index, g.index);
});

test('info update: everything first, then only what changed, at most 10 Hz', () => {
    const metas = [];
    const io2 = { emit(ev, d) { if (ev === 'game_meta') metas.push(d); }, volatile: { emit() {} } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.release();
    g.update();
    assert.strictEqual(metas.length, 1);
    assert.deepStrictEqual(Object.keys(metas[0].a).sort(), [...Game.META_FIELDS].sort());
    for (let k = 0; k < 5; k++) g.update();
    assert.strictEqual(metas.length, 1, 'nothing changed: no update');
    g.players.a.penalty = 5;
    g.update(); // seq 7: due
    assert.deepStrictEqual(metas[1], { a: { penalty: 5 } });
});

test('late joiners get every field from game_init', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.initPayload().players.a;
    for (const f of Game.META_FIELDS) assert.ok(f in p, `${f} missing from game_init`);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/game.test.js`
Expected: FAIL. `pkt.s` is undefined, since today's payload is the full state object.

- [ ] **Step 3: Implement** in `src/game/Game.js`. After the constants:

```js
const FLAGS = { inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 };
const META_FIELDS = ['lap', 'checkpoint', 'rank', 'gap', 'lapsDown', 'lastLap', 'bestLap', 'lapStart', 'bestLapSectors', 'lastValid', 'penalty'];
const META_EVERY = 6; // ticks: info updates at 10 Hz
const r1 = (v) => Math.round(v * 10) / 10;
```

In the constructor:
- after `this.players = {};` add `this.index = {}; this.seq = 0; this.sentMeta = {};`
- inside `players.forEach((p, index) => {` add `this.index[p.id] = index;`

Change `initPayload()` to `return { players: this.players, track: this.track, mode: this.mode, index: this.index };`.

Add the methods:

```js
    // 60 Hz: only what moves, packed small
    fastPacket() {
        const c = [];
        for (const id in this.players) {
            const p = this.players[id];
            const flags = (p.inPit && FLAGS.inPit) | (p.limiter && FLAGS.limiter) | (p.drs && FLAGS.drs)
                | (p.drsAvailable && FLAGS.drsAvailable) | (p.finished && FLAGS.finished)
                | (p.lapValid && FLAGS.lapValid) | (this.mode === 'quali' && FLAGS.ghost);
            c.push([this.index[id], r1(p.x), r1(p.y), +p.angle.toFixed(4), r1(p.speed), +p.steer.toFixed(3), flags]);
        }
        return { s: this.seq, t: +this.time.toFixed(3), c };
    }

    // Slow fields, only those that changed since the last info update
    metaDiff() {
        const diff = {};
        for (const id in this.players) {
            const p = this.players[id], sent = this.sentMeta[id] || (this.sentMeta[id] = {});
            for (const f of META_FIELDS) {
                const v = JSON.stringify(p[f] ?? null);
                if (sent[f] === v) continue;
                sent[f] = v;
                (diff[id] || (diff[id] = {}))[f] = p[f] ?? null;
            }
        }
        return diff;
    }
```

In `update()`, replace the whole `const stateSync = {}; … else this.io.volatile.emit('game_state', stateSync);` block with:

```js
        this.seq++;
        const packet = this.fastPacket();
        if (this.net) this.net.broadcastGameState(packet, this.io); // UDP, Socket.IO until a peer's channel opens
        else this.io.volatile.emit('game_state', packet);
        if (this.seq % META_EVERY === 1) {
            const diff = this.metaDiff();
            if (Object.keys(diff).length) this.io.emit('game_meta', diff);
        }
```

Export the constants: `Game.FLAGS = FLAGS; Game.META_FIELDS = META_FIELDS;` before `module.exports = Game;`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS. If another test read `game_state` payload fields (`sent.a.x` etc.), switch it to `pkt.c` and record a ruling.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/game.test.js
git commit -m "Send compact 60 Hz car updates and change-only info updates"
```

---

### Task 2: Client snapshot buffer and interpolation (`netsync.js`)

**Files:**
- Create: `public/js/netsync.js`
- Test: `test/netsync.test.js`

**Interfaces:**
- Produces (ES module):
  - `INTERP_S = 0.05`, `EXTRAP_MAX_S = 0.1`, `BUFFER_S = 1`, `FLAGS`
  - `decodeFlags(f) → { inPit, limiter, drs, drsAvailable, finished, lapValid, ghost }`
  - `class SnapshotBuffer { push(pkt, arrivalS) → bool; serverNow(nowS) → s; latest() → snap | null }`, where a snap is `{ s, t, cars: Map<idx, entry> }`
  - `sample(buf, renderT, idx) → pose | null`, where pose is `{ x, y, angle, speed, steer, flags }`
  - `project(entry, dtS) → pose`

- [ ] **Step 1: Write the failing tests** — `test/netsync.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');

let N;
before(async () => { N = await import('../public/js/netsync.js'); });
const car = (idx, x, angle = 0, speed = 0) => [idx, x, 0, angle, speed, 0, 0];
const pkt = (s, t, cars) => ({ s, t, c: cars });

test('buffer keeps order and drops duplicates', () => {
    const b = new N.SnapshotBuffer();
    assert.ok(b.push(pkt(2, 0.2, [car(0, 20)]), 10));
    assert.ok(b.push(pkt(1, 0.1, [car(0, 10)]), 10.01), 'late but recent packet is kept, in order');
    assert.ok(!b.push(pkt(2, 0.2, [car(0, 20)]), 10.02), 'duplicate dropped');
    assert.deepStrictEqual(b.snaps.map(x => x.s), [1, 2]);
    assert.strictEqual(b.latest().s, 2);
});

test('a late packet never moves the newest snapshot backwards', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(5, 0.5, [car(0, 50)]), 1);
    b.push(pkt(3, 0.3, [car(0, 30)]), 1.1);
    assert.strictEqual(b.latest().s, 5);
    assert.ok(Math.abs(b.serverNow(1.2) - 0.7) < 1e-9, 'clock follows the newest arrival only');
});

test('sample interpolates between snapshots and takes angles the short way round', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0, 3.1)]), 0);
    b.push(pkt(2, 0.1, [car(0, 10, -3.1)]), 0.1);
    const p = N.sample(b, 0.05, 0);
    assert.ok(Math.abs(p.x - 5) < 1e-9);
    assert.ok(Math.abs(Math.abs(p.angle) - Math.PI) < 0.01, `angle ${p.angle} went the long way`);
});

test('sample extrapolates up to 100 ms past the newest snapshot, then holds', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0, 0, 100)]), 0);
    assert.ok(Math.abs(N.sample(b, 0.05, 0).x - 5) < 1e-9);
    assert.ok(Math.abs(N.sample(b, 0.5, 0).x - 10) < 1e-9, 'capped at 100 ms');
});

test('missing car indices and unknown cars are handled', () => {
    const b = new N.SnapshotBuffer();
    b.push(pkt(1, 0, [car(0, 0), car(2, 5)]), 0);
    b.push(pkt(2, 0.1, [car(2, 15)]), 0.1);  // car 0 left
    assert.ok(Math.abs(N.sample(b, 0.05, 2).x - 10) < 1e-9);
    assert.strictEqual(N.sample(b, 0.05, 7), null);
    assert.ok(N.sample(b, 0.05, 0), 'last known pose kept for a car that left');
});

test('project pushes the own car forward along its heading, capped at 100 ms', () => {
    const e = [0, 0, 0, Math.PI / 2, 60, 0, 0];
    assert.ok(Math.abs(N.project(e, 0.05).y - 3) < 1e-9);
    assert.ok(Math.abs(N.project(e, 1).y - 6) < 1e-9);
});

test('decodeFlags', () => {
    assert.deepStrictEqual(N.decodeFlags(1 | 4 | 64), { inPit: true, limiter: false, drs: true, drsAvailable: false, finished: false, lapValid: false, ghost: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/netsync.test.js`
Expected: FAIL with `Cannot find module …/public/js/netsync.js`.

- [ ] **Step 3: Implement** `public/js/netsync.js`:

```js
// Snapshot buffer + interpolation for the 60 Hz fast updates. Pure, shared by game3d.js and the node tests.
// Packet: { s: seq, t: game time (s), c: [[idx, x, y, angle, speed, steer, flags], ...] }
export const INTERP_S = 0.05;     // other cars are drawn this far behind server time
export const EXTRAP_MAX_S = 0.1;  // past the newest snapshot, coast at most this long, then hold
export const BUFFER_S = 1;
export const FLAGS = { inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 }; // matches Game.FLAGS

export function decodeFlags(f) {
    const o = {};
    for (const k in FLAGS) o[k] = (f & FLAGS[k]) !== 0;
    return o;
}

const toSnap = (pkt) => ({ s: pkt.s, t: pkt.t, cars: new Map(pkt.c.map((e) => [e[0], e])) });
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const pose = (e) => ({ x: e[1], y: e[2], angle: e[3], speed: e[4], steer: e[5], flags: e[6] });

export class SnapshotBuffer {
    constructor() {
        this.snaps = [];     // ordered by seq
        this.newestAt = 0;   // arrival time (s) of the newest snapshot
    }

    push(pkt, arrivalS) {
        const newest = this.snaps.at(-1);
        if (this.snaps.some((x) => x.s === pkt.s)) return false;
        if (newest && pkt.s < newest.s) {
            if (pkt.t < newest.t - BUFFER_S) return false;
            const i = this.snaps.findIndex((x) => x.s > pkt.s);
            this.snaps.splice(i, 0, toSnap(pkt));
        } else {
            this.snaps.push(toSnap(pkt));
            this.newestAt = arrivalS;
        }
        while (this.snaps.length > 2 && this.snaps.at(-1).t - this.snaps[0].t > BUFFER_S) this.snaps.shift();
        return true;
    }

    serverNow(nowS) {
        const n = this.snaps.at(-1);
        return n ? n.t + (nowS - this.newestAt) : 0;
    }

    latest() {
        return this.snaps.at(-1) || null;
    }
}

// Car idx at server time renderT: interpolated between snapshots, briefly extrapolated past the newest
export function sample(buf, renderT, idx) {
    const S = buf.snaps;
    for (let k = S.length - 1; k >= 0; k--) {
        const a = S[k].cars.get(idx);
        if (!a || S[k].t > renderT) continue;
        for (let j = k + 1; j < S.length; j++) {
            const b = S[j].cars.get(idx);
            if (!b) continue;
            const f = (renderT - S[k].t) / (S[j].t - S[k].t);
            return {
                x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, angle: lerpAngle(a[3], b[3], f),
                speed: a[4] + (b[4] - a[4]) * f, steer: a[5] + (b[5] - a[5]) * f, flags: f < 0.5 ? a[6] : b[6],
            };
        }
        return project(a, renderT - S[k].t);
    }
    for (const s of S) { const a = s.cars.get(idx); if (a) return pose(a); } // renderT before every snapshot
    return null;
}

export function project(e, dtS) {
    const dt = Math.max(0, Math.min(dtS, EXTRAP_MAX_S));
    return { x: e[1] + Math.cos(e[3]) * e[4] * dt, y: e[2] + Math.sin(e[3]) * e[4] * dt, angle: e[3], speed: e[4], steer: e[5], flags: e[6] };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add public/js/netsync.js test/netsync.test.js
git commit -m "Add snapshot buffer and interpolation for car updates"
```

---

### Task 3: Client wiring — interpolated cars, meta updates, own-car projection

**Files:**
- Modify: `public/js/socket.js`, `public/js/game3d.js`

**Interfaces:**
- Consumes: Task 1 packets, `game_meta`, `game_init.index`; Task 2 `netsync.js`.
- Produces: `clientState.netIn` (queue of `[packet, arrivalS]`) and `clientState.netIndex`. `clientState.gameState[id]` keeps its field names (x, y, angle, speed, steer, inPit, limiter, drs, drsAvailable, finished, lapValid, ghost, curLap plus the meta fields).

- [ ] **Step 1: `socket.js`**
- In `clientState` add `netIn: [], netIndex: {},`.
- Replace `mergeGameState` with:

```js
// Fast updates are queued; game3d.js drains them into its snapshot buffer every frame
function onFastPacket(pkt) {
    if (pkt && Array.isArray(pkt.c)) clientState.netIn.push([pkt, performance.now() / 1000]);
}
```

- In the DataChannel `STATE` branch use `onFastPacket(msg.data);`. In the Socket.IO fallback: `socket.on('game_state', (pkt) => { if (!udpReady) onFastPacket(pkt); });`.
- In `game_init` add `clientState.netIndex = data.index || {}; clientState.netIn = [];`.
- Add:

```js
socket.on('game_meta', (diff) => {
    for (const id in diff) if (clientState.gameState && clientState.gameState[id]) Object.assign(clientState.gameState[id], diff[id]);
});
```

- [ ] **Step 2: `game3d.js`**
- Import: `import { SnapshotBuffer, sample, project, decodeFlags, INTERP_S } from './netsync.js';`
- Delete the `CAR_SMOOTH` constant. Add `let netBuf = new SnapshotBuffer();`.
- Add before `// ---------- camera ----------`:

```js
// Pose every car from the snapshot buffer: others 50 ms behind (smooth), own car projected to "now" (instant)
function applyNet(nowS) {
    for (const [pkt, at] of clientState.netIn.splice(0)) netBuf.push(pkt, at);
    const latest = netBuf.latest(), gs = clientState.gameState;
    if (!latest || !gs) return;
    const serverT = netBuf.serverNow(nowS);
    for (const id in gs) {
        const i = clientState.netIndex[id];
        if (i === undefined) continue;
        const own = id === clientState.me && latest.cars.has(i);
        const pose = own ? project(latest.cars.get(i), serverT - latest.t) : sample(netBuf, serverT - INTERP_S, i);
        if (!pose) continue;
        const p = gs[id];
        Object.assign(p, { x: pose.x, y: pose.y, angle: pose.angle, speed: pose.speed, steer: pose.steer }, decodeFlags(pose.flags));
        p.curLap = p.lapStart === null || p.lapStart === undefined || p.finished ? null : Math.max(0, serverT - p.lapStart);
    }
}
```

- In `updateCars`, replace the smoothing lines (`const a = 1 - Math.exp(-CAR_SMOOTH * dt);` through the `r.rotation.y += …` line) with:

```js
        r.position.x = s.x;
        r.position.z = s.y;
        r.rotation.y = -s.angle;
```

- In `frame`, call `applyNet(now / 1000);` right before `updateCars(dt);`.
- In `window.initGameVisuals`, add `netBuf = new SnapshotBuffer();` before `buildWorld(...)`.

- [ ] **Step 3: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/socket.js && npm test`
Expected: no syntax errors; all tests pass.

Manual (browser, `npm start`, two tabs or two machines on the LAN): other cars move smoothly with no stutter, your own car responds instantly, and the lap timer counts up normally. In DevTools → Network → WS, `game_state` frames are under 1.5 KB with 20 cars. Over UDP, check the DataChannel message sizes in `chrome://webrtc-internals`.

- [ ] **Step 4: Commit**

```bash
git add public/js/socket.js public/js/game3d.js
git commit -m "Draw cars from interpolated snapshots and apply info updates"
```

---

### Task 4: Quality presets and adaptation rules (`quality.js`)

**Files:**
- Create: `public/js/quality.js`
- Test: `test/quality.test.js`

**Interfaces:**
- Produces (ES module):
  - `LEVELS` (presets)
  - `ratioRange(level, dpr) → { start, min, max }`
  - `resolveLevel(choice, autoResult) → 'low'|'medium'|'high'`
  - `autoPick(avgFrameMs, current, dpr) → level`
  - `adaptStep(state, fps) → state`, where state is `{ ratio, min, max, good }`

- [ ] **Step 1: Write the failing tests** — `test/quality.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');

let Q;
before(async () => { Q = await import('../public/js/quality.js'); });

test('presets follow the spec table', () => {
    assert.deepStrictEqual(Object.keys(Q.LEVELS), ['low', 'medium', 'high']);
    assert.strictEqual(Q.LEVELS.low.shadows, 0);
    assert.strictEqual(Q.LEVELS.medium.shadows, 1024);
    assert.strictEqual(Q.LEVELS.high.antialias, true);
    assert.deepStrictEqual([Q.LEVELS.low.scenery, Q.LEVELS.medium.scenery, Q.LEVELS.high.scenery], [0.3, 0.6, 1]);
});

test('ratioRange caps High at the screen and at 2', () => {
    assert.deepStrictEqual(Q.ratioRange('low', 2), { start: 0.75, min: 0.5, max: 1 });
    assert.deepStrictEqual(Q.ratioRange('high', 1), { start: 1, min: 0.75, max: 1 });
    assert.deepStrictEqual(Q.ratioRange('high', 3), { start: 2, min: 0.75, max: 2 });
});

test('resolveLevel: manual choice wins, auto uses the measured level, else Medium', () => {
    assert.strictEqual(Q.resolveLevel('low', 'high'), 'low');
    assert.strictEqual(Q.resolveLevel('auto', 'high'), 'high');
    assert.strictEqual(Q.resolveLevel('auto', null), 'medium');
    assert.strictEqual(Q.resolveLevel('garbage', 'nope'), 'medium');
});

test('autoPick: slow → Low, fast → High, otherwise unchanged', () => {
    assert.strictEqual(Q.autoPick(25, 'medium', 1), 'low');
    assert.strictEqual(Q.autoPick(10, 'medium', 1), 'high');
    assert.strictEqual(Q.autoPick(16, 'medium', 1), 'medium');
});

test('adaptStep: drops fast, recovers only after 3 good seconds, stays in range', () => {
    let st = { ratio: 1, min: 0.6, max: 1, good: 0 };
    st = Q.adaptStep(st, 40);
    assert.strictEqual(st.ratio, 0.9);
    for (let i = 0; i < 10; i++) st = Q.adaptStep(st, 30);
    assert.strictEqual(st.ratio, 0.6);
    st = Q.adaptStep(st, 60); st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.6, 'not after 2 s');
    st = Q.adaptStep(st, 60);
    assert.strictEqual(st.ratio, 0.65);
    st = { ratio: 1, min: 0.6, max: 1, good: 5 };
    assert.strictEqual(Q.adaptStep(st, 60).ratio, 1, 'never above max');
    assert.strictEqual(Q.adaptStep({ ratio: 0.8, min: 0.6, max: 1, good: 2 }, 55).good, 0, '50–58 fps resets the streak');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/quality.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `public/js/quality.js`:

```js
// Graphics levels and the rules that pick and adapt them. Pure, shared by game3d.js and the node tests.
export const LEVELS = {
    low:    { ratio: [0.75, 0.5, 1], antialias: false, shadows: 0,    softShadows: false, scenery: 0.3, far: 6000,  fog: 6000,  envMap: false, tyreMarks: false, anisotropy: 1 },
    medium: { ratio: [1, 0.6, 1],    antialias: false, shadows: 1024, softShadows: false, scenery: 0.6, far: 12000, fog: 12000, envMap: true,  tyreMarks: true,  anisotropy: 4 },
    high:   { ratio: [2, 0.75, 2],   antialias: true,  shadows: 2048, softShadows: true,  scenery: 1,   far: 20000, fog: 16000, envMap: true,  tyreMarks: true,  anisotropy: 8 },
};

export function ratioRange(level, dpr) {
    const [start, min, max] = LEVELS[level].ratio;
    const cap = level === 'high' ? Math.min(dpr, max) : max;
    return { start: Math.min(start, cap), min: Math.min(min, cap), max: cap };
}

export function resolveLevel(choice, autoResult) {
    if (choice in LEVELS) return choice;
    return autoResult in LEVELS ? autoResult : 'medium';
}

// After 5 s of driving on Medium: under ~45 fps steps down, over ~85 fps steps up
export function autoPick(avgFrameMs, current, dpr) {
    if (avgFrameMs > 22) return 'low';
    if (avgFrameMs < 11.8 && dpr >= 1) return 'high';
    return current;
}

// Once a second: below 50 fps drop resolution 0.1; above 58 fps for 3 s raise it 0.05
export function adaptStep(st, fps) {
    const round = (v) => Math.round(v * 100) / 100;
    if (fps < 50) return { ...st, ratio: Math.max(st.min, round(st.ratio - 0.1)), good: 0 };
    if (fps <= 58) return { ...st, good: 0 };
    const good = st.good + 1;
    if (good >= 3 && st.ratio < st.max) return { ...st, ratio: Math.min(st.max, round(st.ratio + 0.05)), good: 0 };
    return { ...st, good };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add public/js/quality.js test/quality.test.js
git commit -m "Add graphics quality levels, auto-pick and adaptive resolution rules"
```

---

### Task 5: Renderer uses the quality level; HUD throttling; stats; lobby Graphics setting

**Files:**
- Modify: `public/js/game3d.js`, `public/index.html`, `public/js/app.js`, `public/css/style.css`

**Interfaces:**
- Consumes: Task 4 `quality.js`.
- Produces in `game3d.js`:
  - `let level`, `let Q` (the current preset)
  - `applyLevel(level)`, called from `buildWorld`
  - `function blobShadow()` → a Mesh used under cars on Low
  - `window.lanraceQuality = { choice, level }`, for the stats overlay
- Produces: lobby `#graphics-select` saved to `localStorage` key `lanrace.quality` (`auto|low|medium|high`); auto result in `lanrace.quality.auto`.

- [ ] **Step 1: Renderer setup** (`game3d.js`, the `// ---------- renderer / scene ----------` block). Replace the renderer, shadow, fog and camera lines with:

```js
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: not remembered */ } },
};
const choice = store.get('lanrace.quality') || 'auto';
let level = resolveLevel(choice, store.get('lanrace.quality.auto'));
let Q = LEVELS[level];
window.lanraceQuality = { choice, level };

// Antialias is fixed for the page's lifetime: it follows the level chosen at load
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
let res = { ...ratioRange(level, window.devicePixelRatio), good: 0 };
res.ratio = res.start;
renderer.setPixelRatio(res.ratio);

const SKY = 0x9cc8ef;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
const camera = new THREE.PerspectiveCamera(60, 1, 2, Q.far);
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x4f7a2a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
Object.assign(sun.shadow.camera, { left: -360, right: 360, top: 360, bottom: -360, near: 10, far: 4000 }); // ±60 m around your car
scene.add(sun, sun.target);

// Shadows, fog, draw distance and resolution limits for a level (applied when a track is built)
function applyLevel(l) {
    level = l;
    Q = LEVELS[l];
    window.lanraceQuality.level = l;
    renderer.shadowMap.enabled = Q.shadows > 0;
    renderer.shadowMap.type = Q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    sun.castShadow = Q.shadows > 0;
    if (Q.shadows) sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    scene.fog = new THREE.Fog(SKY, 3000, Q.fog);
    camera.far = Q.far;
    camera.updateProjectionMatrix();
    res = { ...ratioRange(l, window.devicePixelRatio), good: 0, ratio: Math.min(res.ratio, ratioRange(l, window.devicePixelRatio).max) };
    renderer.setPixelRatio(res.ratio);
}
applyLevel(level);
```

Add `import { LEVELS, ratioRange, resolveLevel, autoPick, adaptStep } from './quality.js';` at the top.

- [ ] **Step 2: Level per session and blob shadows.**
- In `buildWorld`, first line: `applyLevel(resolveLevel(store.get('lanrace.quality') || 'auto', store.get('lanrace.quality.auto')));`
- After `nameTag`, add:

```js
// Low quality: a soft dark patch instead of real shadows
let blobTex = null;
function blobShadow() {
    if (!blobTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
        grad.addColorStop(0, 'rgba(0,0,0,0.55)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        blobTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4 * scale, 2.8 * scale), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 1;
    return m;
}
```

- In `makeCar`, before `return { root, … }`: `if (!Q.shadows) root.add(blobShadow());`

- [ ] **Step 3: Frame loop — auto-pick, adaptive resolution, throttled HUD, stats.** Replace `frame` with:

```js
let last = performance.now();
let fpsFrames = 0, fpsSince = performance.now(), lastHud = 0, lastTower = 0;
let autoMs = 0, autoFrames = 0; // auto-pick: frame time while driving
const stats = new URLSearchParams(location.search).has('stats') ? Object.assign(document.createElement('div'), { id: 'stats' }) : null;
if (stats) document.body.appendChild(stats);

function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (clientState.status === 'LOBBY') return;
    pollInput(dt, now);
    if (!world || !clientState.gameState) return;
    applyNet(now / 1000);
    updateCars(dt);
    updateCamera(dt);
    renderer.render(scene, camera);

    if (now - lastHud > 66) { // HUD and minimap at 15 Hz, timing tower at 4 Hz
        updateHUD(now - lastTower > 250);
        if (now - lastTower > 250) lastTower = now;
        drawMinimap();
        lastHud = now;
    }

    fpsFrames++;
    const me = clientState.gameState[clientState.me];
    if (choice === 'auto' && !store.get('lanrace.quality.auto') && me && Math.abs(me.speed) > 0) {
        autoMs += dt * 1000;
        autoFrames++;
        if (autoMs > 5000) {
            const picked = autoPick(autoMs / autoFrames, level, window.devicePixelRatio);
            store.set('lanrace.quality.auto', picked); // used from the next race
        }
    }
    if (now - fpsSince >= 1000) {
        const fps = (fpsFrames * 1000) / (now - fpsSince);
        const next = adaptStep(res, fps);
        if (next.ratio !== res.ratio) renderer.setPixelRatio(next.ratio);
        res = next;
        if (stats) stats.textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.calls} calls · ${res.ratio.toFixed(2)}× · ${level}${choice === 'auto' ? ' (auto)' : ''}`;
        fpsFrames = 0;
        fpsSince = now;
    }
}
```

In `updateHUD`, change the signature to `function updateHUD(withTower = true) {` and wrap the timing-tower section (from `// Timing tower` to the end of the `forEach`) in `if (withTower) { … }`.

- [ ] **Step 4: Lobby Graphics setting.** In `index.html`, in the profile panel after the team picker:

```html
                    <label class="graphics-picker">Graphics:
                        <select id="graphics-select">
                            <option value="auto" selected>Auto</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                        <small id="graphics-note"></small>
                    </label>
```

In `app.js`, under the element lookups:

```js
const graphicsSelect = document.getElementById('graphics-select');
try { graphicsSelect.value = localStorage.getItem('lanrace.quality') || 'auto'; } catch (e) { /* storage blocked: Auto */ }
if (!graphicsSelect.value) graphicsSelect.value = 'auto';
graphicsSelect.addEventListener('change', () => {
    try { localStorage.setItem('lanrace.quality', graphicsSelect.value); } catch (e) { /* not remembered */ }
    document.getElementById('graphics-note').textContent = graphicsSelect.value === 'high' || window.lanraceQuality?.level === 'high'
        ? ' Applies next race (anti-aliasing after a page reload)' : ' Applies next race';
});
```

In `style.css` append:

```css
.graphics-picker { display: block; margin: 10px 0; }
#graphics-note { color: #94a3b8; }
#stats { position: fixed; left: 8px; bottom: 8px; z-index: 50; background: rgba(0, 0, 0, 0.6); color: #a7f3d0; font: 12px monospace; padding: 4px 8px; border-radius: 4px; }
```

- [ ] **Step 5: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/app.js && npm test`
Expected: no syntax errors; all tests pass.

Manual: open `http://localhost:3232/?stats=1` and race on each Graphics level. The overlay shows the level and the resolution drops when fps falls. With `localStorage` blocked (private window) the game still starts on Medium.

- [ ] **Step 6: Commit**

```bash
git add public/js/game3d.js public/index.html public/js/app.js public/css/style.css
git commit -m "Pick graphics level automatically, adapt resolution, throttle HUD"
```

---

### Task 6: Draw-call reductions

**Files:**
- Modify: `public/js/game3d.js`

**Interfaces:**
- Produces:
  - `atlasPlanes(items, w, h, bg, fg) → Mesh`: one mesh for many text planes; items are `{ text, x, y, angle, upright }` with optional `bg`
  - `instanced(geometry, material, placements) → InstancedMesh`: placements are `{ x, y, z, angle, sx?, sy?, sz?, color? }`

- [ ] **Step 1: Helpers** — add after `flat`:

```js
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'; // (move to the top with the other imports)

// Many copies of one mesh in one draw call; p: { x, y (height), z, angle, sx, sy, sz, color }
function instanced(geometry, material, placements) {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
    const o = new THREE.Object3D();
    placements.forEach((p, i) => {
        o.position.set(p.x, p.y ?? 0, p.z);
        o.rotation.set(0, p.angle ?? 0, 0);
        o.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (p.color) m.setColorAt(i, new THREE.Color(p.color));
    });
    m.count = placements.length;
    return m;
}

// Many text planes, one texture atlas, one draw call; items: { text, x, y (height), z, rotY, flat, bg }
function atlasPlanes(items, w, h, bg, fg = '#fff') {
    const cell = 64, cols = 8, rows = Math.ceil(items.length / cols), aspect = w / h;
    const c = document.createElement('canvas');
    c.width = cols * cell * aspect; c.height = rows * cell;
    const g = c.getContext('2d');
    items.forEach((it, i) => {
        const cx = (i % cols) * cell * aspect, cy = Math.floor(i / cols) * cell;
        g.fillStyle = it.bg || bg; g.fillRect(cx, cy, cell * aspect, cell);
        g.fillStyle = fg; g.font = `bold ${cell * 0.6}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(it.text, cx + (cell * aspect) / 2, cy + cell / 2, cell * aspect * 0.9);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geos = items.map((it, i) => {
        const geo = new THREE.PlaneGeometry(w, h);
        const u0 = (i % cols) / cols, v1 = 1 - Math.floor(i / cols) / rows, du = 1 / cols, dv = 1 / rows;
        const uv = geo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * du, v1 - dv + uv.getY(k) * dv);
        if (it.flat) geo.rotateX(-Math.PI / 2);
        geo.rotateY(it.rotY);
        geo.translate(it.x, it.y, it.z);
        return geo;
    });
    return new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
}
```

- [ ] **Step 2: Grid boxes as two draws.** Replace `gridBoxes` with:

```js
function gridBoxes(slots) {
    const bars = [], nums = [];
    slots.forEach((g, i) => {
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        bars.push({ x: g.x + fx * 3 * scale, y: 0.9, z: g.y + fy * 3 * scale, angle: -g.angle });
        nums.push({ text: String(i + 1), x: g.x + fx * 4.6 * scale, y: 0.95, z: g.y + fy * 4.6 * scale, rotY: facing(g.angle), flat: true });
    });
    const barGeo = new THREE.PlaneGeometry(0.4 * scale, 2.6 * scale);
    barGeo.rotateX(-Math.PI / 2);
    world.add(instanced(barGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), bars));
    world.add(atlasPlanes(nums, 1.6 * scale, 1.6 * scale, 'rgba(0,0,0,0)'));
}
```

- [ ] **Step 3: Garages as three draws.** In `buildPit`, replace the `for (const g of pit.garages) { … }` loop with:

```js
    const buildings = [], signs = [], marks = [];
    for (const g of pit.garages) {
        const info = teamInfo[g.teamId] || { name: g.teamId, chatColor: '#888888' };
        const c = side(g, g.angle, -s * (back + 2.5 * scale));
        buildings.push({ x: c.x, y: 3 * scale, z: c.y, angle: -g.angle });
        const f = side(g, g.angle, -s * (back - 0.1 * scale));
        signs.push({ text: info.name.toUpperCase(), x: f.x, y: 5 * scale, z: f.y, rotY: s > 0 ? -g.angle : Math.PI - g.angle, bg: info.chatColor });
        for (const b of g.boxes) marks.push({ x: b.x, y: 0.8, z: b.y, angle: -b.angle, color: info.chatColor });
    }
    const bGeo = new THREE.BoxGeometry(18 * scale, 6 * scale, 5 * scale);
    const garagesMesh = instanced(bGeo, new THREE.MeshStandardMaterial({ color: 0x2b2f36 }), buildings);
    garagesMesh.castShadow = true;
    world.add(garagesMesh);
    world.add(atlasPlanes(signs, 17 * scale, 1.6 * scale, '#888888'));
    const mGeo = new THREE.PlaneGeometry(6 * scale, 2.6 * scale);
    mGeo.rotateX(-Math.PI / 2);
    world.add(instanced(mGeo, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45 }), marks));
```

- [ ] **Step 4: Far cars without wheels.** In `updateCars`, after setting the position:

```js
        const far = camera.position.distanceTo(r.position) > 300 * scale; // wheels unreadable that far: 4 fewer draws per car
        for (const w of car.wheels) w.visible = !far;
```

- [ ] **Step 5: Verify**

Run: `node --check public/js/game3d.js && npm test`
Expected: no syntax errors; all tests pass.

Manual: `?stats=1`, Medium, a full grid. Fill the grid with about 20 Socket.IO bot clients (a throwaway script in the scratchpad, like the DRS race check) and check the calls figure is ≤ 150 on the grid. Garages show team-colour signs; the grid numbers still read correctly.

- [ ] **Step 6: Commit**

```bash
git add public/js/game3d.js
git commit -m "Cut draw calls: instanced grid and garages, text atlases, far-car wheels"
```

---

### Task 7: Scenery placement (`scenery.js`)

**Files:**
- Create: `public/js/scenery.js`
- Test: `test/scenery.test.js`

**Interfaces:**
- Produces (ES module): `WALL_OFFSET = 80` and `placeScenery(track, density, seed) → { grandstands, trees, billboards, slowCorners }`:
  - `grandstands`: `[{ x, y, angle, len }]`
  - `trees`: `[{ x, y, size }]`, with size 1 or 2
  - `billboards`: `[{ x, y, angle, side, text }]`
  - `slowCorners`: `[{ from, to, side }]` (path index ranges; side ±1 in `offsetPoints` convention)
- Also `seedOf(trackId) → int` and `safeDist(track)` (the clearance in world units).

- [ ] **Step 1: Write the failing tests** — `test/scenery.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

let S;
before(async () => { S = await import('../public/js/scenery.js'); });
const tracks = Track.loadAll();

for (const id of Track.TRACK_IDS) {
    test(`${id}: scenery stays clear of the track and pit lane`, () => {
        const t = tracks[id], out = S.placeScenery(t, 1, S.seedOf(id));
        const clear = t.width / 2 + 80 + 3 * t.scale;
        for (const o of [...out.grandstands, ...out.trees, ...out.billboards]) {
            assert.ok(Physics.nearestOnTrack(o.x, o.y, t).dist > clear, `${id}: object on or near the track at ${o.x},${o.y}`);
            if (t.pit) assert.ok(Physics.nearestOnPath(o.x, o.y, t.pit.path, false).dist > t.pit.width / 2 + 6 * t.scale, `${id}: object in the pit lane`);
        }
        assert.ok(out.grandstands.length >= 2, 'grandstands at the main straight and slow corners');
        assert.ok(out.trees.length > 50 && out.billboards.length > 3);
        assert.ok(out.slowCorners.length >= 2);
    });
}

test('scenery is deterministic and scales with density', () => {
    const t = tracks.monza;
    assert.deepStrictEqual(S.placeScenery(t, 0.6, 42), S.placeScenery(t, 0.6, 42));
    const lo = S.placeScenery(t, 0.3, 42), hi = S.placeScenery(t, 1, 42);
    assert.ok(lo.trees.length < hi.trees.length * 0.5);
    assert.strictEqual(lo.grandstands.length, hi.grandstands.length, 'grandstands always placed');
    assert.notStrictEqual(S.seedOf('monza'), S.seedOf('spa'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/scenery.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** `public/js/scenery.js`:

```js
// Deterministic trackside scenery from the circuit's own shape. Pure, shared by game3d.js and the node tests.
export const WALL_OFFSET = 80;          // world units past the track edge (src/game/Game.js)
const SLOW_MS = 150 / 3.6;              // corners slower than this get gravel, tyre walls, a grandstand
const TEXTS = ['LAN RACE', 'FULL SEND', 'DRS ZONE', 'BOX BOX', 'LIGHTS OUT', 'PUSH PUSH'];

export function seedOf(id) {
    let h = 2166136261;
    for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
}

function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function heading(path, i) {
    const n = path.length, a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
    return Math.atan2(b.y - a.y, b.x - a.x);
}
const offset = (p, angle, off) => ({ x: p.x - Math.sin(angle) * off, y: p.y + Math.cos(angle) * off });

function distTo(path, x, y, closed = true) {
    let best = Infinity;
    for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + t * (b.x - a.x)), y - (a.y + t * (b.y - a.y))));
    }
    return best;
}

export const safeDist = (t) => t.width / 2 + WALL_OFFSET + 3 * t.scale;

export function placeScenery(t, density, seed) {
    const P = t.path, n = P.length, sc = t.scale, rand = rng(seed);
    const clear = safeDist(t) + 0.5 * sc; // a little margin over the tested clearance
    const ok = (x, y) => distTo(P, x, y) > clear && !(t.pit && distTo(t.pit.path, x, y, false) <= t.pit.width / 2 + 7 * sc);

    // Slow corners: runs of points under SLOW_MS, extended to the exit; side = outside of the turn
    const slowCorners = [];
    for (let i = 0; i < n; i++) {
        if (t.safeSpeed[i] >= SLOW_MS || (t.safeSpeed[(i - 1 + n) % n] < SLOW_MS && i > 0)) continue;
        let j = i;
        while (j - i < n && t.safeSpeed[(j + 1) % n] < SLOW_MS) j++;
        const mid = (i + j) >> 1;
        let d = heading(P, (mid + 1) % n) - heading(P, mid);
        d = Math.atan2(Math.sin(d), Math.cos(d));
        slowCorners.push({ from: (i - 3 + n) % n, to: (j + 5) % n, side: d > 0 ? -1 : 1, apex: mid % n });
    }

    // Grandstands: main straight opposite the pits, plus the outside of the 3 slowest corners
    const grandstands = [];
    const stand = (i, side, back) => {
        const h = heading(P, i);
        for (let extra = 0; extra < 60 * sc; extra += 10 * sc) {
            const q = offset(P[i], h, side * (back + extra));
            if (ok(q.x, q.y)) return grandstands.push({ x: q.x, y: q.y, angle: h, len: 60 * sc });
        }
    };
    const startIdx = t.cum ? t.cum.findIndex((c) => c >= (t.startS || 0)) : 0;
    stand(Math.max(0, startIdx), t.pit ? t.pit.trackSide : 1, clear + 8 * sc);
    [...slowCorners].sort((a, b) => t.safeSpeed[a.apex % n] - t.safeSpeed[b.apex % n]).slice(0, 3)
        .forEach((c) => stand(c.apex % n, c.side, clear + 10 * sc));

    // Trees: beyond the barrier, denser further out
    const trees = [];
    const want = Math.round(n * 0.6 * density);
    for (let k = 0; k < want * 3 && trees.length < want; k++) {
        const i = Math.floor(rand() * n), side = rand() < 0.5 ? -1 : 1;
        const q = offset(P[i], heading(P, i), side * (clear + (15 + 105 * Math.sqrt(rand())) * sc));
        if (ok(q.x, q.y)) trees.push({ x: q.x, y: q.y, size: rand() < 0.7 ? 1 : 2 });
    }

    // Billboards along flat-out straights, facing the track
    const billboards = [];
    const every = Math.max(10, Math.round(15 / density)); // path points (~10 m each)
    for (let i = 0, k = 0; i < n; i += every, k++) {
        if (t.safeSpeed[i] < 100) continue;
        const side = k % 2 ? 1 : -1, h = heading(P, i);
        const q = offset(P[i], h, side * (clear + 1 * sc));
        if (ok(q.x, q.y)) billboards.push({ x: q.x, y: q.y, angle: h, side, text: TEXTS[k % TEXTS.length] });
    }

    return { grandstands, trees, billboards, slowCorners };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all. If a circuit has fewer than 2 slow corners or grandstands, check the `SLOW_MS` runs for that track and record a ruling. Do not weaken the clearance test.

- [ ] **Step 5: Commit**

```bash
git add public/js/scenery.js test/scenery.test.js
git commit -m "Place trackside scenery deterministically from each circuit's shape"
```

---

### Task 8: Draw the scenery, gravel and tyre walls

**Files:**
- Modify: `public/js/game3d.js`

**Interfaces:**
- Consumes: Task 7 `placeScenery`, `seedOf`; Task 6 `instanced`, `atlasPlanes`; `Q.scenery`.

- [ ] **Step 1: Implement.**
- Import: `import { placeScenery, seedOf } from './scenery.js';`
- In `buildWorld`, after the kerbs and before the barriers:

```js
    const scen = placeScenery(t, Q.scenery, seedOf(t.id));
    const onSlow = (side) => {
        const mark = new Array(n).fill(false);
        for (const c of scen.slowCorners) if (c.side === side) for (let i = c.from; i !== c.to; i = (i + 1) % n) mark[i] = true;
        return mark;
    };
    const slowOut = { 1: onSlow(1), [-1]: onSlow(-1) };
    // Gravel traps on the outside of slow corners, between the kerb and the barrier (visual only)
    for (const dir of [1, -1]) {
        const from = dir > 0 ? half + kerbW : -(half + WALL_OFFSET - 1 * scale), to = dir > 0 ? half + WALL_OFFSET - 1 * scale : -(half + kerbW);
        world.add(strip(path, from, to, 0.4, (i) => slowOut[dir][i], solid('#cdb98f')));
    }
```

- Change the barrier `wall(...)` colour argument so tyre walls replace red/white on slow corners:

```js
        const redWhite = alternate('#d62828', '#f2f2f2'), tyre = solid('#1b1b1b');
        world.add(wall(path, dir * wallOff, 1 * scale, (i) => ok[i] && ok[(i + 1) % n], (i) => (slowOut[dir][i] ? tyre(i) : redWhite(i))));
```

- Then add the scenery meshes (after the barriers):

```js
    // Trees: trunk + crown, two sizes, one draw each
    const trunks = [], crowns = [];
    for (const tr of scen.trees) {
        const k = tr.size === 2 ? 1.6 : 1;
        trunks.push({ x: tr.x, y: 2 * scale * k, z: tr.y, sx: k, sy: k, sz: k });
        crowns.push({ x: tr.x, y: 7 * scale * k, z: tr.y, sx: k, sy: k, sz: k });
    }
    world.add(instanced(new THREE.CylinderGeometry(0.4 * scale, 0.5 * scale, 4 * scale, 6), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 }), trunks));
    world.add(instanced(new THREE.ConeGeometry(3 * scale, 9 * scale, 7), new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 1 }), crowns));

    // Grandstands: stepped stand + coloured seats
    const stands = [], seats = [];
    for (const g of scen.grandstands) {
        stands.push({ x: g.x, y: 4 * scale, z: g.y, angle: -g.angle });
        seats.push({ x: g.x, y: 8.2 * scale, z: g.y, angle: -g.angle });
    }
    world.add(instanced(new THREE.BoxGeometry(60 * scale, 8 * scale, 12 * scale), new THREE.MeshStandardMaterial({ color: 0x9aa0a6 }), stands));
    world.add(instanced(new THREE.BoxGeometry(58 * scale, 0.6 * scale, 10 * scale), new THREE.MeshStandardMaterial({ color: 0x1e5bd8 }), seats));

    // Billboards: one atlas, facing the track
    const boards = scen.billboards.map((b) => ({
        text: b.text, x: b.x, y: 2.5 * scale, z: b.y, rotY: b.side > 0 ? -b.angle : Math.PI - b.angle,
        bg: ['#d62828', '#1e5bd8', '#2a9d3f', '#111827'][b.text.length % 4],
    }));
    if (boards.length) world.add(atlasPlanes(boards, 12 * scale, 3 * scale, '#111827'));
```

`kerbW` is already defined above in `buildWorld`. Make sure the gravel block comes after it.

- [ ] **Step 2: Verify**

Run: `node --check public/js/game3d.js && npm test`
Expected: no syntax errors; all tests pass.

Manual, on all 5 circuits at High and Low:
- trees, grandstands and billboards stand outside the barriers;
- gravel and tyre walls appear at the slow corners;
- draw calls stay within the Task 6 budget, with scenery adding about 7.

- [ ] **Step 3: Commit**

```bash
git add public/js/game3d.js
git commit -m "Draw trackside scenery, gravel traps and tyre walls"
```

---

### Task 9: Glossy cars and track surface detail

**Files:**
- Modify: `public/js/game3d.js`

**Interfaces:**
- Consumes: `Q.envMap`, `Q.tyreMarks`, `Q.anisotropy`; Task 7 `scen.slowCorners` (from `buildWorld`).
- Produces: `strip(path, from, to, y, keep, colorAt, opts)`, where `opts` is `{ map, repeatM, opacity }` (it emits UVs); `envTexture()`.

- [ ] **Step 1: Env reflections for cars.**
- Import: `import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';`
- Add near `makeCar`:

```js
// Generated once: a soft studio reflection for car paint (Medium/High)
let envTex = null;
function envTexture() {
    if (!envTex) envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    return envTex;
}
```

- In `makeCar`'s traverse, after the livery branch:

```js
            if (Q.envMap) {
                o.material.envMap = envTexture();
                o.material.envMapIntensity = 0.6;
                if (o.material.name === 'livery') { o.material.metalness = 0.25; o.material.roughness = 0.35; }
            }
```

- In `liveryTexture`, use `tex.anisotropy = Q.anisotropy;`.

- [ ] **Step 2: Strips with UVs and an asphalt texture.** Replace `coloredMesh` and `strip` with:

```js
function coloredMesh(pos, col, uv = null, opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, map: opts.map || null,
        transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthWrite: opts.opacity === undefined,
    }));
    m.receiveShadow = true;
    return m;
}

// Flat band between two sideways offsets, only on segments where keep(i); opts.map tiles every opts.repeatM metres
function strip(path, from, to, y, keep, colorAt, opts = {}) {
    const a = offsetPoints(path, from), b = offsetPoints(path, to);
    const pos = [], col = [], uv = [];
    const rep = (opts.repeatM || 8) * scale;
    let along = 0;
    for (let i = 0; i < path.length; i++) {
        const j = (i + 1) % path.length;
        const seg = Math.hypot(path[j].x - path[i].x, path[j].y - path[i].y);
        if (keep(i)) {
            const c = colorAt(i), v0 = along / rep, v1 = (along + seg) / rep;
            pos.push(a[i].x, y, a[i].y, b[i].x, y, b[i].y, b[j].x, y, b[j].y,
                     a[i].x, y, a[i].y, b[j].x, y, b[j].y, a[j].x, y, a[j].y);
            uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
            for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
        }
        along += seg;
    }
    return coloredMesh(pos, col, uv, opts);
}

// Grey speckle, tiled along the track
let asphaltTex = null;
function asphaltTexture() {
    if (!asphaltTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d'), rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
        g.fillStyle = '#d8d8d8';
        g.fillRect(0, 0, 256, 256);
        for (let k = 0; k < 9000; k++) {
            const v = 150 + Math.floor(rand() * 105);
            g.fillStyle = `rgb(${v},${v},${v})`;
            g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
        }
        asphaltTex = new THREE.CanvasTexture(c);
        asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
        asphaltTex.colorSpace = THREE.SRGBColorSpace;
    }
    asphaltTex.anisotropy = Q.anisotropy;
    return asphaltTex;
}
```

- In `buildWorld`, change the main asphalt line to:

```js
    world.add(strip(path, -half, half, 0.6, all, solid('#4a505a'), { map: asphaltTexture(), repeatM: 8 }));
```

- [ ] **Step 3: Tyre marks and kerb edges.** In `buildWorld`, after the gravel block:

```js
    // Rubbered-in racing line through slow corners: inside at the apex, drifting out on exit (Medium/High)
    if (Q.tyreMarks) {
        for (const c of scen.slowCorners) {
            const inside = -c.side; // the outside is c.side
            world.add(strip(path, inside * half * 0.15, inside * half * 0.55, 0.62, (i) => {
                const len = (c.to - c.from + n) % n, k = (i - c.from + n) % n;
                return k < len;
            }, solid('#1a1c20'), { opacity: 0.35 }));
        }
    }
    // Thin dark outer edge on the kerbs so they read at speed
    world.add(strip(path, half + kerbW - 0.2 * scale, half + kerbW, 0.72, (i) => curvy[i], solid('#5a1414')));
    world.add(strip(path, -half - kerbW, -half - kerbW + 0.2 * scale, 0.72, (i) => curvy[i], solid('#5a1414')));
```

- [ ] **Step 4: Verify**

Run: `node --check public/js/game3d.js && npm test`
Expected: no syntax errors; all tests pass.

Manual:
- Medium/High: the cars show reflections, the asphalt is speckled, tyre marks sit through slow corners and the kerbs have a dark edge.
- Low: the cars stay plain and there are no tyre marks; the speckle stays, since it's one shared texture.
- Take a screenshot per level, and with `?stats=1` record calls (≤ 150 on Medium with 20 cars) and fps on the slowest laptop available.

- [ ] **Step 5: Commit**

```bash
git add public/js/game3d.js
git commit -m "Add glossy car paint, asphalt texture, tyre marks and kerb edges"
```
