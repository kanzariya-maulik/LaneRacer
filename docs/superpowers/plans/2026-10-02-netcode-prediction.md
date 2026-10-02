# AAA Netcode (Prediction, Reconciliation, Adaptive Interpolation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zero-input-delay own car, smooth remote cars through WiFi jitter and loss, and smooth frame pacing on High, with a stats overlay and a network simulator to prove it.

**Architecture:**
- **Shared simulation:** the car simulation (`CarPhysics`, `Assist`, `Physics`, and the movement half of `Game.drive`) moves to ES modules in `public/js/sim/`. The server `require`s them (Node 24 `require(esm)`); the browser imports the same files.
- **Prediction:** the client predicts its own car with sequenced inputs and reconciles against the server's `lastSeq`.
- **Remote cars:** drawn with an adaptive interpolation delay (time dilation), Hermite curves and dead reckoning.
- **Server timing:** a fixed-step hrtime loop; `NET_SIM` fakes bad WiFi.

**Tech Stack:** Node 24 (`node:test`, `require(esm)`), Socket.IO, node-datachannel (WebRTC UDP), Three.js 0.186 client.

**Spec:** `docs/superpowers/specs/2026-10-02-netcode-prediction-design.md`

**Deviations from spec (deliberate):**
- `Physics.js` moves whole to `sim/physics.js` rather than being split into a `geometry.js`. The car-vs-car code is small and harmless in the browser, and one file means one shim.
- Server tick time and starvation go in their own 1 Hz `net_stats` event, not inside `game_meta`. They are per-second numbers, and `game_meta` is a 10 Hz diff.

## Global Constraints

- Physics behaviour must not change. `driveCar` must reproduce today's `Game.drive` motion bit-for-bit, against a golden trace taken before any refactor.
- Fast packet car entry: `[idx, x, y, angle, speed, steer, flags, vx, vy, tow, lastSeq]`, ≤ 75 bytes per car.
- Inputs: `{ seq, steer, throttle, brake, drs }` at 60 Hz. Each send carries the newest plus the previous 5. The server queue applies one input per tick and is capped at 4.
- Reconciliation: under 5 m the correction blends out (exponential, τ = 33 ms); at 5 m or more it snaps.
- Interpolation delay: `clamp(2×16.7 ms + 2×jitterP95, 35 ms, 150 ms)`. Time dilation stays within 0.95–1.05. Dead reckoning lasts at most 250 ms, and recovery blends over 100 ms.
- Server loop: 16.667 ms fixed step, at most 4 catch-up ticks.
- Legacy single-input clients (bots, old tabs) keep working.
- Commit per task, no trailers, branch `feature/3d-f1`. Never commit `refs/` or `image*.png`.

## Review Focus

1. **Session changes** (quali → race, new `game_init`): the predictor must restart from the new grid, never carry the old car or old pending inputs. Test in Task 5.
2. **Countdown and finished cars:** the server keeps simulating during the countdown (jump starts) and stops moving finished cars. The client must not predict a finished car forward. Test in Task 5.
3. **Spectators and late joiners** have no own car: there is no predictor and remote interpolation is unchanged. Covered in Task 7 code, and in the headless check in Task 9.
4. **Duplicate and old inputs** (UDP redundancy, a TCP copy during the handshake) must never be applied twice or out of order. Test in Task 3.
5. **Tab hidden or long stall:** the render clock must re-sync, not crawl at 1.05× for seconds, and the predictor must not replay hundreds of inputs. Test in Task 6 (clock snap) and Task 5 (pending cap).

---

### Task 1: Golden trace, then move the simulation into shared ES modules

**Files:**
- Create: `test/fixtures/make-drive-golden.js`, `test/fixtures/drive-golden.json`, `test/simGolden.test.js`
- Move: `src/game/CarPhysics.js` → `public/js/sim/carphysics.js`; `src/game/Assist.js` → `public/js/sim/assist.js`; `src/game/Physics.js` → `public/js/sim/physics.js`
- Create shims: `src/game/CarPhysics.js`, `src/game/Assist.js`, `src/game/Physics.js`

**Interfaces:**
- Produces:
  - `public/js/sim/carphysics.js`: `export { C, step }`.
  - `public/js/sim/assist.js`: `export { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN, safeSpeeds, brakeAssist }`.
  - `public/js/sim/physics.js`: `export default Physics` (class with the same statics, plus `CAR_HALF_LENGTH_M`, `CAR_CENTER_OFFSET_M`, `CAR_HALF_WIDTH_M`).
  - The old `require('./CarPhysics')`, `require('./Assist')` and `require('./Physics')` paths keep working.

- [ ] **Step 1: Write the golden-trace generator** — `test/fixtures/make-drive-golden.js`:

```js
// Records today's car motion so the shared-simulation refactor can prove it changed nothing.
// Run once BEFORE moving any physics code: node test/fixtures/make-drive-golden.js
const fs = require('fs');
const path = require('path');
const Game = require('../../src/game/Game');
const Track = require('../../src/game/Track');

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const io = { emit() {}, volatile: { emit() {} } };

function trace() {
    const out = {};
    for (const id of Track.TRACK_IDS) {
        const t = Track.load(id), rand = rng(1234 + id.length);
        const g = new Game(io, [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 99, qualifying: false }, () => {});
        g.frozen = false;
        const p = g.players.a, rows = [];
        for (let k = 0; k < 2000; k++) {
            if (k % 30 === 0) p.input = { steer: rand() * 2 - 1, throttle: rand() < 0.75 ? 1 : 0, brake: rand() < 0.15 ? 1 : 0, drs: rand() < 0.3 };
            g.drive(p);
            if (k % 100 === 99) rows.push([p.x, p.y, p.vx, p.vy, p.angle, p.speed, p.steer, !!p.inPit, !!p.limiter]);
        }
        out[id] = rows;
    }
    return out;
}

module.exports = { trace };
if (require.main === module) {
    fs.writeFileSync(path.join(__dirname, 'drive-golden.json'), JSON.stringify(trace()));
    console.log('wrote drive-golden.json');
}
```

- [ ] **Step 2: Record the golden trace from today's code**

Run: `node test/fixtures/make-drive-golden.js`
Expected: `wrote drive-golden.json` (5 tracks × 20 rows).

- [ ] **Step 3: Write the golden test** — `test/simGolden.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const golden = require('./fixtures/drive-golden.json');
const { trace } = require('./fixtures/make-drive-golden');

test('car motion is bit-identical to the recorded trace (10,000 random inputs over 5 tracks)', () => {
    const now = trace();
    for (const id of Object.keys(golden)) assert.deepStrictEqual(now[id], golden[id], `${id} motion changed`);
});
```

Run: `node --test test/simGolden.test.js`
Expected: PASS (same code that recorded it). From here on it guards every refactor.

- [ ] **Step 4: Move the three modules and convert them to ES modules**

```bash
mkdir -p public/js/sim
git mv src/game/CarPhysics.js public/js/sim/carphysics.js
git mv src/game/Assist.js public/js/sim/assist.js
git mv src/game/Physics.js public/js/sim/physics.js
```

Then edit:
- `public/js/sim/carphysics.js`: replace the last line `module.exports = { C, step };` with `export { C, step };`.
- `public/js/sim/assist.js`:
  - replace `const { C } = require('./CarPhysics');` with `import { C } from './carphysics.js';`;
  - replace `module.exports = { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN, safeSpeeds, brakeAssist };` with `export { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN, safeSpeeds, brakeAssist };`.
- `public/js/sim/physics.js`: replace `module.exports = Physics;` with `export default Physics;`. Keep the `Physics.CAR_* = …` lines above it.

- [ ] **Step 5: Add the CommonJS shims** (the server and tests keep their `require` paths):

`src/game/CarPhysics.js`:
```js
// Shared with the browser (client-side prediction): the simulation lives in public/js/sim
module.exports = require('../../public/js/sim/carphysics.js');
```

`src/game/Assist.js`:
```js
// Shared with the browser (client-side prediction): the simulation lives in public/js/sim
module.exports = require('../../public/js/sim/assist.js');
```

`src/game/Physics.js`:
```js
// Shared with the browser (client-side prediction): the simulation lives in public/js/sim
module.exports = require('../../public/js/sim/physics.js').default;
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all pass, including the golden test. The browser bundle is unaffected: nothing imports `sim/` yet.

- [ ] **Step 7: Commit**

```bash
git add test/fixtures test/simGolden.test.js public/js/sim src/game/CarPhysics.js src/game/Assist.js src/game/Physics.js
git commit -m "Share the car simulation with the browser; golden trace guards it"
```

---

### Task 2: Extract `driveCar` (movement half of `Game.drive`) into `public/js/sim/drive.js`

**Files:**
- Create: `public/js/sim/drive.js`
- Modify: `src/game/Game.js` (`bounce`, `pitAlong`, constants, `drive`, `updatePit`)
- Test: `test/simGolden.test.js` (unchanged, must stay green), `test/drive.test.js`

**Interfaces:**
- Consumes: Task 1 modules.
- Produces:
  - `driveCar(car, input, track, dt) -> near`, where `near` is the `nearestOnTrack` result after the move;
  - `updatePitState(car, track, near, nearPit)`, `bounce(car, nx, ny)`, `pitAlong(pit, n)`;
  - constants `WALL_OFFSET`, `PIT_RUNOFF_M`, `KERB_M`, `PIT_LIMIT_KMH`, `DRS_DRAG`.
  - `driveCar` reads `car.assist`, `car.inPit`, `car.drs`, `car.tow`, `car.limiter` and `car.lastSafeX/Y`, and writes the motion fields and `inPit`/`limiter`/`pitS`/`dragMul`.

- [ ] **Step 1: Write the failing test** — `test/drive.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');

let D;
before(async () => { D = await import('../public/js/sim/drive.js'); });
const io = { emit() {}, volatile: { emit() {} } };

test('driveCar moves a car exactly like Game.drive', () => {
    const t = Track.load('monza');
    const g = new Game(io, [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 9, qualifying: false }, () => {});
    const p = g.players.a, q = JSON.parse(JSON.stringify(p));
    p.input = q.input = { steer: 0.3, throttle: 1, brake: 0, drs: false };
    for (let k = 0; k < 300; k++) { g.drive(p); D.driveCar(q, q.input, t, 1 / 60); }
    for (const f of ['x', 'y', 'vx', 'vy', 'angle', 'speed', 'steer']) assert.strictEqual(q[f], p[f], f);
});
```

Run: `node --test test/drive.test.js`
Expected: FAIL — cannot find `public/js/sim/drive.js`.

- [ ] **Step 2: Create `public/js/sim/drive.js`** (today's `Game.drive` movement, `updatePit` state and `bounce`, unchanged maths):

```js
// The car's own motion for one tick: assist, tyres, pit wall, barriers, pit lane limiter.
// Shared: the server runs it for every car, the browser runs it to predict its own car.
import { C, step } from './carphysics.js';
import Physics from './physics.js';
import { brakeAssist } from './assist.js';

export const WALL_OFFSET = 80;     // world units past the track edge; Track.js checkpoints use the same
export const PIT_RUNOFF_M = 2;     // barrier this far outside the pit lane edge
export const KERB_M = 1.5;         // kerbs past the track edge drive like asphalt
export const PIT_LIMIT_KMH = 80;
export const DRS_DRAG = 0.85;      // drag with the flap open (~+15 km/h top speed)

// Distance along the pit lane of a nearestOnPath result
export const pitAlong = (pit, n) => pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);

// Barrier response: n points from the barrier back toward the car
export function bounce(p, nx, ny) {
    const vn = -(p.vx * nx + p.vy * ny); // speed into the barrier
    const v = Math.hypot(p.vx, p.vy);
    if (vn > 0) { p.vx += vn * nx; p.vy += vn * ny; }
    // Speed loss scales with how square-on the hit is: head-on keeps WALL_KEEP, a graze keeps almost all
    const impact = v > 0 ? Math.max(0, vn) / v : 0;
    const keep = 1 - (1 - C.WALL_KEEP) * impact;
    p.vx *= keep;
    p.vy *= keep;
    p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
}

// In the pit lane = on pit asphalt and off the track's (where they overlap, it's track); limiter caps speed
export function updatePitState(p, t, near, nearPit) {
    const pit = t.pit;
    p.pitS = pitAlong(pit, nearPit);
    p.inPit = nearPit.dist <= pit.width / 2 && near.dist > t.width / 2 && p.pitS >= pit.closeS; // closed entry isn't pit lane
    p.limiter = p.inPit && p.pitS >= pit.limStart && p.pitS <= pit.limEnd;
    if (p.limiter) {
        const max = (PIT_LIMIT_KMH / 3.6) * t.scale, v = Math.hypot(p.vx, p.vy);
        if (v > max) {
            p.vx *= max / v;
            p.vy *= max / v;
            p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
        }
    }
}

export function driveCar(p, input, t, dt) {
    const scale = t.scale, pit = t.pit;
    const x0 = p.x, y0 = p.y;
    const nearPit = (x, y) => (pit ? Physics.nearestOnPath(x, y, pit.path, false) : null);
    const before = Physics.nearestOnTrack(p.x, p.y, t), beforePit = nearPit(p.x, p.y);
    const grass = before.dist > t.width / 2 + KERB_M * scale && !(beforePit && beforePit.dist <= pit.width / 2 && pitAlong(pit, beforePit) >= pit.closeS);
    const used = p.assist === 'full' && !p.inPit ? brakeAssist(p, input, t, before) : input;
    p.dragMul = (p.drs ? DRS_DRAG : 1) * (1 - (p.tow || 0));
    step(p, used, dt, scale, grass, p.assist);

    // Pit wall: a move across it is undone
    const hit = pit && (Physics.crossWall(x0, y0, p.x, p.y, pit.wall) || Physics.crossWall(x0, y0, p.x, p.y, pit.closeWall));
    if (hit) {
        p.x = x0 + hit.nx * 0.5;
        p.y = y0 + hit.ny * 0.5;
        bounce(p, hit.nx, hit.ny);
    }
    // …and the pit entry barrier stops the whole car body, not just its centre
    // ponytail: the pit wall stays centre-only — on the 1.5×-wide tracks it sits ~0.6 m past the line, inside the kerb
    const o = pit && Physics.wallOverlap(p, pit.closeWall, scale);
    if (o) { p.x += o.nx * o.depth; p.y += o.ny * o.depth; bounce(p, o.nx, o.ny); }

    // Barrier: outside both the track's run-off and the pit lane's
    const wallDist = t.width / 2 + WALL_OFFSET;
    const pitDist = pit && pit.width / 2 + PIT_RUNOFF_M * scale;
    const after = Physics.nearestOnTrack(p.x, p.y, t), afterPit = nearPit(p.x, p.y);
    // The pit lane upstream of the closure barrier is off-limits (no pit stops)
    const afterS = afterPit && pitAlong(pit, afterPit);
    const overTrack = after.dist - wallDist, overPit = afterPit && afterS >= pit.closeS ? afterPit.dist - pitDist : Infinity;
    if (overTrack > 0 && overPit > 0) {
        const [near, lim] = overPit < overTrack ? [afterPit, pitDist] : [after, wallDist];
        const nx = (p.x - near.px) / near.dist, ny = (p.y - near.py) / near.dist;
        p.x = near.px + nx * (lim - 1);
        p.y = near.py + ny * (lim - 1);
        bounce(p, -nx, -ny);
    }
    // Barrier stops the car body: pull the centre in by how far the rectangle reaches toward it
    const edge = Physics.nearestOnTrack(p.x, p.y, t), edgePit = nearPit(p.x, p.y);
    const reach = (n) => n.dist > 1e-9 ? Physics.carReach(p, (p.x - n.px) / n.dist, (p.y - n.py) / n.dist, scale) : 0;
    const inTrack = edge.dist + reach(edge) <= wallDist;
    const inPitLane = edgePit && pitAlong(pit, edgePit) >= pit.closeS && edgePit.dist + reach(edgePit) <= pitDist;
    if (!inTrack && !inPitLane && edge.dist <= wallDist && !(edgePit && edgePit.dist <= pitDist && pitAlong(pit, edgePit) >= pit.closeS)) {
        const nx = (p.x - edge.px) / edge.dist, ny = (p.y - edge.py) / edge.dist;
        const lim = wallDist - reach(edge);
        p.x = edge.px + nx * lim; p.y = edge.py + ny * lim;
        bounce(p, -nx, -ny);
    }

    if (pit) updatePitState(p, t, after, afterPit);

    if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
        p.lastSafeX = p.x;
        p.lastSafeY = p.y;
    } else {
        p.x = p.lastSafeX; p.y = p.lastSafeY;
        p.vx = p.vy = p.speed = 0;
        if (!Number.isFinite(p.angle)) p.angle = 0;
    }
    return after;
}
```

- [ ] **Step 3: Make `Game.drive` and `Game.updatePit` use it**

In `src/game/Game.js`:
1. Add `const Drive = require('../../public/js/sim/drive.js');` under the other requires.
2. Delete the constants `WALL_OFFSET`, `PIT_LIMIT_KMH`, `PIT_RUNOFF_M`, `KERB_M`, `DRS_DRAG`, the `pitAlong` arrow function and the `bounce` function. Replace them with:
   ```js
   const { WALL_OFFSET, PIT_RUNOFF_M, pitAlong, bounce } = Drive;
   ```
   Keep whatever other code in `Game.js` still uses these names.
3. Replace the whole `drive(p) { … }` method with:
   ```js
   // Motion is shared with the browser (driveCar); the rest is the referee's job
   drive(p) {
       const t = this.track, wasLimited = p.limiter;
       const after = Drive.driveCar(p, p.input, t, this.dt);
       if (this.mode === 'quali' && p.limiter && !wasLimited) p.lapStart = p.sectorStart = null; // crossing the pit entry line ends a timed lap
       this.checkLimits(p, after);
       const total = t.cum[t.path.length];
       const lapS = (((t.cum[after.i] + after.t * (t.cum[after.i + 1] - t.cum[after.i]) - t.startS) % total) + total) % total;
       this.updateDrs(p, p.lapS ?? lapS, lapS);
       p.lapS = lapS;
   }
   ```
4. Replace the `updatePit(p, near = …, nearPit = …) { … }` body with the following, keeping the same signature and defaults:
   ```js
       const wasLimited = p.limiter;
       Drive.updatePitState(p, this.track, near, nearPit);
       // Crossing the pit entry line ends a timed lap
       if (this.mode === 'quali' && p.limiter && !wasLimited) p.lapStart = p.sectorStart = null;
   ```

Order note: today the NaN guard ran after `updateDrs`. It now runs inside `driveCar`, before it. It only touches motion fields, so the golden trace proves the move changes nothing.

- [ ] **Step 4: Run the tests**

Run: `node --test test/drive.test.js test/simGolden.test.js && npm test`
Expected: all pass. The golden trace is identical.

- [ ] **Step 5: Commit**

```bash
git add public/js/sim/drive.js src/game/Game.js test/drive.test.js
git commit -m "Extract the shared driveCar step from Game.drive"
```

---

### Task 3: Sequenced inputs, server input queue, richer fast packet

**Files:**
- Modify: `src/lobby.js` (`sanitizeInputs`), `src/game/Game.js` (queue, `lastSeq`, `starve`, `fastPacket`), `src/socketManager.js`, `src/webrtcManager.js`
- Test: `test/lobby.test.js`, `test/game.test.js`

**Interfaces:**
- Produces:
  - `lobby.sanitizeInputs(payload) -> Array<{seq, steer, throttle, brake, drs}> | null`. It returns `null` when the payload is a legacy single input.
  - `Game.handleInputs(id, list)`;
  - `p.lastSeq` (−1 until the first sequenced input), `p.starve` (ticks with an empty queue);
  - fast packet entry `[idx, x, y, angle, speed, steer, flags, vx, vy, tow, lastSeq]`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lobby.test.js`:
```js
test('sanitizeInputs: batches of sequenced inputs, clamped; legacy single inputs return null', () => {
    const L = require('../src/lobby');
    assert.deepStrictEqual(L.sanitizeInputs({ inputs: [{ seq: 5, steer: 3, throttle: 1, brake: 0, drs: true }, { seq: 'x', steer: 0 }] }),
        [{ seq: 5, steer: 1, throttle: 1, brake: 0, drs: true }]);
    assert.strictEqual(L.sanitizeInputs({ throttle: 1, brake: 0, steer: 0 }), null);
    assert.strictEqual(L.sanitizeInputs({ inputs: new Array(50).fill({ seq: 1, steer: 0, throttle: 0, brake: 0 }) }).length, 8, 'at most 8 per packet');
});
```

Append to `test/game.test.js`:
```js
test('input queue: one input per tick in order, duplicates and old ones ignored, capped at 4, starvation repeats', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    const a = g.players.a, inp = (seq, steer) => ({ seq, steer, throttle: 1, brake: 0, drs: false });
    g.handleInputs('a', [inp(2, 0.2), inp(1, 0.1), inp(3, 0.3)]);   // out of order
    g.handleInputs('a', [inp(1, 0.9), inp(2, 0.9), inp(3, 0.9)]);   // redundant resend: ignored
    g.update();
    assert.strictEqual(a.lastSeq, 1);
    assert.strictEqual(a.input.steer, 0.1);
    g.update(); g.update();
    assert.strictEqual(a.lastSeq, 3);
    const s0 = a.starve;
    g.update();
    assert.strictEqual(a.lastSeq, 3, 'empty queue: last input repeats');
    assert.strictEqual(a.starve, s0 + 1);
    g.handleInputs('a', [4, 5, 6, 7, 8, 9, 10].map((s) => inp(s, 0)));
    g.update();
    assert.strictEqual(a.lastSeq, 7, 'queue capped at 4: oldest extras dropped, then one applied');
});

test('fast update carries velocity, tow and the last applied input for reconciliation', () => {
    let pkt = null;
    const io2 = { emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkt = d; } } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    g.handleInputs('a', [{ seq: 7, steer: 0, throttle: 1, brake: 0, drs: false }]);
    for (let k = 0; k < 30; k++) g.update();
    const e = pkt.c[0];
    assert.strictEqual(e.length, 11);
    assert.ok(Math.abs(e[7]) + Math.abs(e[8]) > 0, 'velocity present');
    assert.strictEqual(e[10], 7);
    assert.ok(JSON.stringify(e).length <= 75, `${JSON.stringify(e).length} bytes`);
});
```

Run: `node --test test/lobby.test.js test/game.test.js`
Expected: FAIL. `sanitizeInputs` and `handleInputs` do not exist, and entries have 7 fields.

- [ ] **Step 2: Implement `sanitizeInputs`** in `src/lobby.js`, below `sanitizeInput`, and add it to `module.exports`:

```js
// Sequenced input batches from prediction clients: { inputs: [{ seq, steer, throttle, brake, drs }, …] } (newest + 5 resends)
function sanitizeInputs(payload) {
    if (!payload || !Array.isArray(payload.inputs)) return null;
    return payload.inputs.slice(0, 8)
        .filter((i) => i && Number.isInteger(i.seq) && i.seq >= 0)
        .map((i) => ({ seq: i.seq, ...sanitizeInput(i) }));
}
```

- [ ] **Step 3: Implement the queue in `src/game/Game.js`**
1. Add a constant: `const INPUT_QUEUE_MAX = 4; // inputs buffered per player; a burst beyond this drops its oldest`.
2. In the constructor's per-player object, add `queue: [], lastSeq: -1, starve: 0,`.
3. Add a method after `handleInput`:
   ```js
   // Prediction clients: each tick applies exactly one queued input, in sequence order
   handleInputs(id, list) {
       const p = this.players[id];
       if (!p) return;
       const top = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
       for (const i of list.slice().sort((a, b) => a.seq - b.seq)) if (i.seq > top && !p.queue.some((q) => q.seq === i.seq)) p.queue.push(i);
       p.queue.sort((a, b) => a.seq - b.seq);
       p.inputAt = this.clock;
   }
   ```
   (A batch whose newest is already queued adds nothing. `top` is read once, so a sorted batch can add several.)
4. In `update()`, inside the existing per-player timeout loop, right after the timeout line, add:
   ```js
                   if (p.queue.length) {
                       while (p.queue.length > INPUT_QUEUE_MAX) p.queue.shift();
                       p.input = p.queue.shift();
                       p.lastSeq = p.input.seq;
                   } else if (p.lastSeq >= 0) p.starve++;
   ```
5. In `fastPacket()`, replace the `c.push(…)` line with:
   ```js
               c.push([this.index[id], r1(p.x), r1(p.y), +p.angle.toFixed(4), r1(p.speed), +p.steer.toFixed(3), flags,
                       r1(p.vx), r1(p.vy), +(p.tow || 0).toFixed(2), p.lastSeq]);
   ```

- [ ] **Step 4: Route batches from both transports**

In `src/socketManager.js`, in both places that call `gameInstance.handleInput(…, lobby.sanitizeInput(inputData))` (the UDP callback in `net.setupPeer` and the `socket.on('input')` handler), replace the call with:
```js
            if (gameInstance) {
                const batch = lobby.sanitizeInputs(inputData);
                if (batch) gameInstance.handleInputs(ID, batch);
                else gameInstance.handleInput(ID, lobby.sanitizeInput(inputData));
            }
```
`ID` is `id` in the UDP callback and `socket.id` in the socket handler. Keep the surrounding `hasOpenChannel` check in the socket handler.

`src/webrtcManager.js` already forwards `data.payload` for `type === 'INPUT'`, so no change is needed there.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass.
- The golden trace still passes: `p.input` is set directly with no queue, so the last input repeats as before.
- The older packet test asserts 7 fields and ≤ 60 bytes. Update it to 11 fields and ≤ 75 bytes, and record that as a ruling. It describes the old format.

- [ ] **Step 6: Commit**

```bash
git add src/lobby.js src/game/Game.js src/socketManager.js test/lobby.test.js test/game.test.js
git commit -m "Sequenced input queue on the server and lastSeq/velocity in fast updates"
```

---

### Task 4: Fixed-step server loop, tick stats, network simulator

**Files:**
- Create: `src/ticker.js`, `src/netsim.js`
- Modify: `src/game/Game.js` (`start`/`stop`, tick timing, `net_stats`), `src/webrtcManager.js` (outgoing simulation), `src/socketManager.js` (incoming simulation)
- Test: `test/ticker.test.js`, `test/netsim.test.js`

**Interfaces:**
- Produces:
  - `new Ticker(stepMs, run, now?, maxCatchUp?)` with `.poll()`, `.start()` and `.stop()`;
  - `parseNetSim(str) -> {latency, jitter, loss} | null`;
  - `planDelivery(sim, rand) -> delayMs | null` (null means dropped);
  - `withNetSim(fn, sim)`, which returns a function that delivers later or drops;
  - the socket event `net_stats` `{ tickMs, starve: { id: n } }`, sent once a second.

- [ ] **Step 1: Write the failing tests**

`test/ticker.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const Ticker = require('../src/ticker');

test('ticker: exactly one step per 16.667 ms on an uneven poll schedule, catch-up capped at 4, resync after a stall', () => {
    let now = 0, runs = 0;
    const t = new Ticker(1000 / 60, () => runs++, () => now, 4);
    t.next = 0;
    for (now = 0; now <= 10000; now += 1 + (Math.floor(now) % 3)) t.poll();   // polls every 1–3 ms
    assert.strictEqual(runs, Math.floor(10000 / (1000 / 60)) + 1);
    runs = 0; now += 1000; t.poll();                                         // 1 s stall
    assert.strictEqual(runs, 4, 'no burst bigger than 4');
    runs = 0; now += 1000 / 60; t.poll();
    assert.strictEqual(runs, 1, 'back to one per step, not catching up the whole second');
});
```

`test/netsim.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNetSim, planDelivery } = require('../src/netsim');

test('NET_SIM parses latency,jitter,loss and plans delays inside latency ± jitter, dropping about loss %', () => {
    assert.deepStrictEqual(parseNetSim('30,20,2'), { latency: 30, jitter: 20, loss: 2 });
    assert.strictEqual(parseNetSim(''), null);
    let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sim = parseNetSim('30,20,2'); let dropped = 0;
    for (let i = 0; i < 10000; i++) {
        const d = planDelivery(sim, rand);
        if (d === null) { dropped++; continue; }
        assert.ok(d >= 10 && d <= 50, `${d}`);
    }
    assert.ok(dropped > 120 && dropped < 290, `${dropped} drops`);
});
```

Run: `node --test test/ticker.test.js test/netsim.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement `src/ticker.js`:**

```js
// Fixed-step game loop: hrtime accumulator, polled about every millisecond. setInterval(16.7) drifts and bunches ticks.
class Ticker {
    constructor(stepMs, run, now = () => Number(process.hrtime.bigint()) / 1e6, maxCatchUp = 4) {
        Object.assign(this, { stepMs, run, now, maxCatchUp, timer: null, next: 0 });
    }

    poll() {
        const now = this.now();
        let n = 0;
        while (now >= this.next && n < this.maxCatchUp) {
            this.run();
            this.next += this.stepMs;
            n++;
        }
        if (now - this.next > this.stepMs) this.next = now + this.stepMs; // a long stall: resync, don't burst
    }

    start() {
        this.next = this.now();
        this.timer = setInterval(() => this.poll(), 1);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = Ticker;
```

- [ ] **Step 3: Implement `src/netsim.js`:**

```js
// NET_SIM=latencyMs,jitterMs,lossPct fakes bad WiFi for tests and headless measurement. Off unless set.
function parseNetSim(str) {
    const m = /^(\d+),(\d+),(\d+(?:\.\d+)?)$/.exec(str || '');
    return m ? { latency: +m[1], jitter: +m[2], loss: +m[3] } : null;
}

function planDelivery(sim, rand = Math.random) {
    if (rand() * 100 < sim.loss) return null;
    return Math.max(0, sim.latency + (rand() * 2 - 1) * sim.jitter);
}

// fn delivered after a simulated delay (or dropped); with no simulation, called straight away
function withNetSim(fn, sim = parseNetSim(process.env.NET_SIM)) {
    if (!sim) return fn;
    return (...args) => {
        const d = planDelivery(sim);
        if (d !== null) setTimeout(() => fn(...args), d);
    };
}

module.exports = { parseNetSim, planDelivery, withNetSim };
```

- [ ] **Step 4: Use them**
1. **`src/game/Game.js`:**
   - Add `const Ticker = require('../ticker');`.
   - In `start()`, replace the `setInterval` line with:
     ```js
     this.ticker = new Ticker(1000 / TICK_RATE, () => this.timedUpdate());
     this.ticker.start();
     ```
   - In `stop()`, replace the body with `if (this.ticker) this.ticker.stop(); this.ticker = null;`.
   - Add a method:
     ```js
     // update() plus a tick-cost average and a once-a-second net_stats for the overlay
     timedUpdate() {
         const t0 = process.hrtime.bigint();
         this.update();
         const ms = Number(process.hrtime.bigint() - t0) / 1e6;
         this.tickMs = this.tickMs === undefined ? ms : this.tickMs + (ms - this.tickMs) * 0.05;
         if (this.seq % TICK_RATE === 0) {
             const starve = {};
             for (const id in this.players) { starve[id] = this.players[id].starve; this.players[id].starve = 0; }
             this.io.emit('net_stats', { tickMs: +this.tickMs.toFixed(2), starve });
         }
     }
     ```
   - Keep `this.loopPath` references working: search for `loopPath` and replace each with `ticker`.
2. **`src/webrtcManager.js`:**
   - Add `const { withNetSim } = require('./netsim');`.
   - In the constructor, add `this.sendLater = withNetSim((fn) => fn());`.
   - In `broadcastGameState`, wrap each send with `this.sendLater(() => …)`: the `peer.dc.sendMessage(payload)` call and each `sock.volatile.emit('game_state', stateSync)` call.
   - Keep the `viaUDP.add(id)` bookkeeping outside the wrapper.
3. **`src/socketManager.js`:** wrap both input entry points' bodies in a simulated delivery. Add `const { withNetSim } = require('./netsim');` and `const inputLater = withNetSim((fn) => fn());` at the top. Then call `inputLater(() => { … existing body … })` inside both input handlers.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass. Game tests call `update()` directly, so the Ticker isn't involved.

- [ ] **Step 6: Commit**

```bash
git add src/ticker.js src/netsim.js src/game/Game.js src/webrtcManager.js src/socketManager.js test/ticker.test.js test/netsim.test.js
git commit -m "Fixed-step server loop, tick stats and a NET_SIM network simulator"
```

---

### Task 5: Client predictor with reconciliation (`public/js/predict.js`)

**Files:**
- Create: `public/js/predict.js`
- Test: `test/predict.test.js`

**Interfaces:**
- Consumes: `driveCar` (Task 2); the packet entry layout (Task 3).
- Produces: `class Predictor(track)` with:
  - `.reset(entry)`;
  - `.step(input)`;
  - `.onServer(entry)`;
  - `.pose(alpha, out)`;
  - `.car`, `.pending`, `.lastError`.

  Also `STEP_S = 1/60`, `SNAP_M = 5`, `BLEND_TAU_S = 0.033`, `MAX_PENDING = 120`. Entry fields: `e[1]` x, `e[2]` y, `e[3]` angle, `e[4]` speed, `e[5]` steer, `e[6]` flags (inPit 1, limiter 2, drs 4, finished 16), `e[7]` vx, `e[8]` vy, `e[9]` tow, `e[10]` lastSeq.

- [ ] **Step 1: Write the failing tests** — `test/predict.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');

let P;
before(async () => { P = await import('../public/js/predict.js'); });
const io = { emit() {}, volatile: { emit() {} } };
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Server game + one predicting client over a simulated network (latency ± jitter, loss), 60 s of driving
function run({ latency = 30, jitter = 20, loss = 2, seconds = 60, track = 'monza', bump = null } = {}) {
    const t = Track.load(track), sc = t.scale, rand = rng(42);
    let pkt = null;
    const g = new Game({ emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkt = d; } } },
        [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 99, qualifying: false }, () => {});
    g.frozen = false;
    const pr = new P.Predictor(t);
    const events = [];                  // [time, fn]
    const at = (time, fn) => { if (rand() * 100 >= loss) events.push([time + (latency + (rand() * 2 - 1) * jitter) / 1000, fn]); };
    const serverPos = new Map(), clientPos = new Map();
    let seq = 0, sent = [], maxStep = 0, lastPose = null;
    for (let k = 0; k < seconds * 60; k++) {
        const now = k / 60;
        events.sort((a, b) => a[0] - b[0]);
        while (events.length && events[0][0] <= now) events.shift()[1]();
        // client: sample input (steer at a point ahead on the track), predict, send newest + 5
        if (!pr.car && pkt) pr.reset(pkt.c[0]);
        if (pr.car) {
            const n = Physics.nearestOnTrack(pr.car.x, pr.car.y, t), ah = t.path[(n.i + 3) % t.path.length];
            let d = Math.atan2(ah.y - pr.car.y, ah.x - pr.car.x) - pr.car.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            const input = { seq: ++seq, steer: Math.max(-1, Math.min(1, d * 2)), throttle: Math.abs(d) > 0.25 ? 0.4 : 1, brake: 0, drs: false };
            pr.step(input);
            clientPos.set(seq, [pr.car.x, pr.car.y]);
            sent = [...sent, input].slice(-6);
            const batch = sent.slice();
            at(now, () => g.handleInputs('a', batch));
            const pose = pr.pose(1, {});
            if (lastPose) maxStep = Math.max(maxStep, Math.abs(Math.hypot(pose.x - lastPose.x, pose.y - lastPose.y) - Math.abs(pr.car.speed) / 60));
            lastPose = pose;
        }
        // server tick
        if (bump && k === bump) { g.players.a.x += 2 * sc; }   // a collision the client could not foresee
        g.update();
        const a = g.players.a;
        serverPos.set(a.lastSeq, [a.x, a.y]);
        const snap = JSON.parse(JSON.stringify(pkt));
        at(now, () => pr.onServer(snap.c[0]));
    }
    const errs = [];
    for (const [s, sp] of serverPos) { const cp = clientPos.get(s); if (cp) errs.push(Math.hypot(cp[0] - sp[0], cp[1] - sp[1]) / sc); }
    errs.sort((a, b) => a - b);
    return { p95: errs[Math.floor(errs.length * 0.95)], maxStepM: maxStep / sc, pr, sc };
}

test('prediction tracks the server within 5 cm (p95) over 60 s of 30±20 ms, 2% loss WiFi', () => {
    const r = run();
    assert.ok(r.p95 < 0.05, `p95 ${r.p95.toFixed(3)} m`);
    assert.ok(r.maxStepM < 0.10, `largest per-step correction ${r.maxStepM.toFixed(3)} m`);
});

test('an unforeseen server-side shove blends out instead of snapping, < 1 cm left after 200 ms', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t), sc = t.scale;
    const e = [0, t.path[10].x, t.path[10].y, 0, 0, 0, 0, 0, 0, 0, 3];
    pr.reset(e);
    pr.onServer([0, e[1] + 0.5 * sc, e[2], 0, 0, 0, 0, 0, 0, 0, 3]);         // server says 0.5 m further
    const p0 = pr.pose(1, {});
    assert.ok(Math.abs(p0.x - e[1]) < 1e-6, 'no visible jump at the moment of correction');
    for (let k = 0; k < 12; k++) pr.step({ seq: 4 + k, steer: 0, throttle: 0, brake: 0, drs: false });
    const p1 = pr.pose(1, {});
    assert.ok(Math.abs(p1.x - pr.car.x) < 0.01 * sc, `offset left ${(p1.x - pr.car.x) / sc} m`);
});

test('corrections of 5 m or more snap (teleport, reset)', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t), sc = t.scale;
    pr.reset([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    pr.onServer([0, 10 * sc, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    assert.strictEqual(pr.pose(1, {}).x, 10 * sc);
});

test('finished cars are not predicted; pending inputs are capped after a stall', () => {
    const t = Track.load('monza'), pr = new P.Predictor(t);
    pr.reset([0, t.path[10].x, t.path[10].y, 0, 50, 0, 16, 50, 0, 0, 1]);    // finished flag
    const x0 = pr.car.x;
    pr.step({ seq: 2, steer: 0, throttle: 1, brake: 0, drs: false });
    assert.strictEqual(pr.car.x, x0, 'finished: holds the server pose');
    pr.reset([0, t.path[10].x, t.path[10].y, 0, 0, 0, 0, 0, 0, 0, 1]);
    for (let k = 0; k < 500; k++) pr.step({ seq: 2 + k, steer: 0, throttle: 0, brake: 0, drs: false });
    assert.ok(pr.pending.length <= P.MAX_PENDING);
});
```

Run: `node --test test/predict.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `public/js/predict.js`:**

```js
// Client-side prediction for your own car: run the shared simulation on your inputs straight away,
// then reconcile with the server (rewind to its state, replay unacknowledged inputs, blend out the difference).
import { driveCar } from './sim/drive.js';

export const STEP_S = 1 / 60;
export const SNAP_M = 5;              // corrections this big snap (reset, teleport)
export const BLEND_TAU_S = 0.033;     // smaller ones decay exponentially: ~100 ms to vanish
export const MAX_PENDING = 120;       // 2 s of unacknowledged inputs at most (tab stall)

const FIN = 16;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Predictor {
    constructor(track) {
        this.track = track;
        this.car = null;
        this.prev = { x: 0, y: 0, angle: 0 };
        this.pending = [];
        this.off = { x: 0, y: 0, angle: 0 };
        this.lastError = 0;
        this.finished = false;
    }

    // Server entry → simulation state
    load(e) {
        const c = this.car;
        c.x = e[1]; c.y = e[2]; c.angle = e[3]; c.speed = e[4]; c.steer = e[5];
        c.inPit = !!(e[6] & 1); c.limiter = !!(e[6] & 2); c.drs = !!(e[6] & 4);
        c.vx = e[7] ?? Math.cos(e[3]) * e[4]; c.vy = e[8] ?? Math.sin(e[3]) * e[4]; c.tow = e[9] || 0;
        c.lastSafeX = c.x; c.lastSafeY = c.y;
        this.finished = !!(e[6] & FIN);
    }

    reset(e) {
        this.car = { assist: 'full' };
        this.load(e);
        this.prev = { x: this.car.x, y: this.car.y, angle: this.car.angle };
        this.pending = [];
        this.off = { x: 0, y: 0, angle: 0 };
    }

    step(input) {
        if (!this.car) return;
        this.prev.x = this.car.x; this.prev.y = this.car.y; this.prev.angle = this.car.angle;
        const k = Math.exp(-STEP_S / BLEND_TAU_S);
        this.off.x *= k; this.off.y *= k; this.off.angle *= k;
        if (this.finished) return;                        // the server parks finished cars
        this.pending.push(input);
        if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
        driveCar(this.car, input, this.track, STEP_S);
    }

    onServer(e) {
        if (!this.car) { this.reset(e); return; }
        const lastSeq = e[10];
        if (lastSeq !== undefined && lastSeq >= 0) while (this.pending.length && this.pending[0].seq <= lastSeq) this.pending.shift();
        const bx = this.car.x, by = this.car.y, ba = this.car.angle;
        this.load(e);
        if (!this.finished) for (const input of this.pending) driveCar(this.car, input, this.track, STEP_S);
        const dx = bx - this.car.x, dy = by - this.car.y, err = Math.hypot(dx, dy);
        this.lastError = err;
        if (err < SNAP_M * this.track.scale) {
            this.off.x += dx; this.off.y += dy;
            this.off.angle += Math.atan2(Math.sin(ba - this.car.angle), Math.cos(ba - this.car.angle));
        } else {
            this.off.x = this.off.y = this.off.angle = 0;
            this.prev.x = this.car.x; this.prev.y = this.car.y; this.prev.angle = this.car.angle;
        }
    }

    // Render pose between the last two steps (alpha 0..1) plus the decaying correction; written into out
    pose(alpha, out) {
        const c = this.car;
        out.x = this.prev.x + (c.x - this.prev.x) * alpha + this.off.x;
        out.y = this.prev.y + (c.y - this.prev.y) * alpha + this.off.y;
        out.angle = lerpAngle(this.prev.angle, c.angle, alpha) + this.off.angle;
        out.speed = c.speed;
        out.steer = c.steer;
        return out;
    }
}
```

- [ ] **Step 3: Run the tests**

Run: `node --test test/predict.test.js && npm test`
Expected: all pass.
- If the 5 cm p95 fails, measure first, before changing the threshold. The likely cause is the 0.1-unit rounding of x and y in the packet (0.1 world unit ≈ 1.7 cm).
- If rounding is the cause, raise x/y precision in `fastPacket` to 0.01 for all cars and re-check the 75-byte budget.
- Record any change as a ruling.

- [ ] **Step 4: Commit**

```bash
git add public/js/predict.js test/predict.test.js
git commit -m "Client-side prediction with server reconciliation and smooth corrections"
```

---

### Task 6: Adaptive interpolation, Hermite curves, dead reckoning (`public/js/netsync.js`)

**Files:**
- Modify: `public/js/netsync.js`
- Test: `test/netsync.test.js` (update the 100 ms extrapolation test to 250 ms; add new tests)

**Interfaces:**
- Produces:
  - `SnapshotBuffer` gains `.jitterS` (smoothed), `.jitterP95S`, `.targetDelayS()`, `.received` and `.expected` (for loss %).
  - `RenderClock` with `.advance(dtS, serverNowS, targetDelayS) -> renderT` and `.rate`.
  - `sample(buf, renderT, idx, out?, state?)` returns the pose (Hermite inside, dead reckoning past the newest snapshot, recovery blend via `state`).
  - `decodeFlags(f, out?)`.
  - Constants `TICK_S`, `MIN_DELAY_S = 0.035`, `MAX_DELAY_S = 0.15`, `DILATION = 0.05`, `EXTRAP_MAX_S = 0.25`, `RECOVER_S = 0.1`.

- [ ] **Step 1: Write the failing tests** — append to `test/netsync.test.js`, and change the existing extrapolation test's `0.5` expectation to the 250 ms cap (`x = 25` at 100 m/s):

```js
test('adaptive delay: calm network ≈ 35 ms, jittery ≈ 2 ticks + 2×p95, clamped', () => {
    const calm = new N.SnapshotBuffer(), wild = new N.SnapshotBuffer();
    let seed = 3; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
        calm.push(pkt(k + 1, k / 60, [car(0, k)]), 1 + k / 60);
        wild.push(pkt(k + 1, k / 60, [car(0, k)]), 1 + k / 60 + rand() * 0.04);
    }
    assert.ok(Math.abs(calm.targetDelayS() - 0.035) < 0.002, `${calm.targetDelayS()}`);
    const w = wild.targetDelayS();
    assert.ok(w > 0.08 && w <= 0.15, `${w}`);
});

test('render clock eases to the target with ≤5% time dilation, never runs backwards, resyncs after a stall', () => {
    const clock = new N.RenderClock();
    let t = clock.advance(0, 10, 0.05), last = t;
    for (let k = 0; k < 120; k++) {                      // target suddenly 50 ms further back
        t = clock.advance(1 / 60, 10 + (k + 1) / 60, k < 60 ? 0.05 : 0.10);
        assert.ok(t >= last, 'never backwards');
        assert.ok(clock.rate >= 0.95 - 1e-9 && clock.rate <= 1.05 + 1e-9);
        last = t;
    }
    t = clock.advance(1 / 60, 60, 0.05);                 // tab was hidden for ~48 s
    assert.ok(Math.abs(t - (60 - 0.05)) < 1e-9, 'snaps instead of crawling');
});

test('Hermite interpolation passes through snapshots and follows the velocity between them', () => {
    const b = new N.SnapshotBuffer();
    // car on a circle of radius 100: positions and velocities at t=0 and t=0.1 (ω = 1 rad/s, v = 100)
    const at = (t) => [0, 100 * Math.sin(t), 100 - 100 * Math.cos(t), t, 100, 0, 0, 100 * Math.cos(t), 100 * Math.sin(t), 0, 0];
    b.push({ s: 1, t: 0, c: [at(0)] }, 0);
    b.push({ s: 2, t: 0.1, c: [at(0.1)] }, 0.1);
    const mid = N.sample(b, 0.05, 0), truth = at(0.05);
    assert.ok(Math.hypot(mid.x - truth[1], mid.y - truth[2]) < 0.01, 'on the arc, not the chord');
    const end = N.sample(b, 0.1, 0);
    assert.ok(Math.abs(end.x - at(0.1)[1]) < 1e-9);
});

test('dead reckoning follows the arc for 250 ms, then holds; recovery blends instead of popping', () => {
    const b = new N.SnapshotBuffer(), WB = 3.6 * 6;          // wheelbase in world units at scale 6
    const steer = Math.atan(WB / 300);                        // radius 300 world units
    b.push({ s: 1, t: 0, c: [[0, 0, 0, 0, 60, steer, 0, 60, 0, 0, 0]] }, 0);
    const p = N.sample(b, 0.25, 0, {}, {}, 6), w = 60 / 300 * 0.25;
    assert.ok(Math.hypot(p.x - 300 * Math.sin(w), p.y - 300 * (1 - Math.cos(w))) < 0.3, 'on the arc');
    const held = N.sample(b, 0.6, 0, {}, {}, 6);
    assert.ok(Math.abs(held.x - p.x) < 1e-9, 'holds after 250 ms');
    const st = {}, out = {};
    N.sample(b, 0.2, 0, out, st, 6);                          // extrapolating
    const before = { x: out.x, y: out.y };
    b.push({ s: 2, t: 0.1, c: [[0, 5.5, 0, 0, 60, 0, 0, 60, 0, 0, 0]] }, 0.2);   // reality: went straight
    b.push({ s: 3, t: 0.3, c: [[0, 17.5, 0, 0, 60, 0, 0, 60, 0, 0, 0]] }, 0.31);
    const after = N.sample(b, 0.2 + 1 / 60, 0, out, st, 6);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 60 / 60 * 1.5, 'no pop on recovery');
});
```

Run: `node --test test/netsync.test.js`
Expected: FAIL. `targetDelayS`, `RenderClock` and the Hermite/arc behaviour are missing.

- [ ] **Step 2: Implement in `public/js/netsync.js`:**

1. Replace `export const EXTRAP_MAX_S = 0.1;` with:
   ```js
   export const EXTRAP_MAX_S = 0.25;  // past the newest snapshot, dead-reckon on the arc this long, then hold
   export const TICK_S = 1 / 60;
   export const MIN_DELAY_S = 0.035, MAX_DELAY_S = 0.15;  // adaptive interpolation delay range
   export const DILATION = 0.05;      // render clock may run 5% fast or slow to reach the target delay
   export const RECOVER_S = 0.1;      // blend from a dead-reckoned pose back to real data over this long
   const WHEELBASE_M = 3.6;           // CarPhysics.C.WHEELBASE
   ```
2. In `SnapshotBuffer`:
   - The constructor adds `this.jitterS = 0; this.dev = []; this.lastTransit = null; this.received = 0; this.expected = 0; this.firstS = null;`.
   - In `push`, in the "newest" branch (where `offset` is updated), add:
     ```js
                 const transit = arrivalS - pkt.t;
                 if (this.lastTransit !== null) {
                     const d = Math.abs(transit - this.lastTransit);
                     this.jitterS += (d - this.jitterS) / 16;               // RFC 3550 smoothed jitter
                     this.dev.push([arrivalS, d]);
                     while (this.dev.length && this.dev[0][0] < arrivalS - 2) this.dev.shift();
                 }
                 this.lastTransit = transit;
     ```
   - On every accepted push, add: `this.received++; if (this.firstS === null) this.firstS = pkt.s; this.expected = Math.max(this.expected, pkt.s - this.firstS + 1);`.
   - Add methods:
     ```js
         get jitterP95S() {
             if (!this.dev.length) return 0;
             const d = this.dev.map((x) => x[1]).sort((a, b) => a - b);
             return d[Math.floor((d.length - 1) * 0.95)];
         }

         targetDelayS() {
             return Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, 2 * TICK_S + 2 * this.jitterP95S));
         }
     ```
   - In the session-reset branch (`NEW_SESSION_GAP`), also reset `jitterS`, `dev`, `lastTransit`, `received`, `expected` and `firstS`.
3. Add the render clock:
   ```js
   // Render time for remote cars: eases toward (server now − target delay) by stretching time ±5%, never jumping back
   export class RenderClock {
       constructor() { this.t = null; this.rate = 1; }

       advance(dtS, serverNowS, targetDelayS) {
           const want = serverNowS - targetDelayS;
           if (this.t === null || Math.abs(want - this.t) > 0.5) { this.t = want; this.rate = 1; return this.t; }   // start / stall: resync
           const err = want - this.t;
           this.rate = 1 + Math.max(-DILATION, Math.min(DILATION, err * 2));
           this.t += dtS * this.rate;
           return this.t;
       }
   }
   ```
4. Replace `sample`, `project` and `decodeFlags` with:
   ```js
   export function decodeFlags(f, out = {}) {
       for (const k in FLAGS) out[k] = (f & FLAGS[k]) !== 0;
       return out;
   }

   // Straight-line projection (kept for callers that want it) along heading × speed, capped
   export function project(e, dtS) {
       const dt = Math.max(0, Math.min(dtS, EXTRAP_MAX_S));
       return { x: e[1] + Math.cos(e[3]) * e[4] * dt, y: e[2] + Math.sin(e[3]) * e[4] * dt, angle: e[3], speed: e[4], steer: e[5], flags: e[6] };
   }

   // Constant-curvature dead reckoning: yaw rate from speed and steer (bicycle model)
   function arc(e, dtS, scale, out) {
       const dt = Math.max(0, Math.min(dtS, EXTRAP_MAX_S)), v = e[4];
       const w = (v / (WHEELBASE_M * scale)) * Math.tan(e[5] || 0), a = e[3];
       if (Math.abs(w) < 1e-6) { out.x = e[1] + Math.cos(a) * v * dt; out.y = e[2] + Math.sin(a) * v * dt; out.angle = a; }
       else {
           out.x = e[1] + (v / w) * (Math.sin(a + w * dt) - Math.sin(a));
           out.y = e[2] - (v / w) * (Math.cos(a + w * dt) - Math.cos(a));
           out.angle = a + w * dt;
       }
       out.speed = v; out.steer = e[5]; out.flags = e[6];
       return out;
   }

   // Cubic Hermite between snapshot entries a (time ta) and b (tb), tangents from their velocities
   function hermite(a, b, ta, tb, renderT, out) {
       const h = tb - ta, f = (renderT - ta) / h, f2 = f * f, f3 = f2 * f;
       const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
       const avx = a[7] ?? Math.cos(a[3]) * a[4], avy = a[8] ?? Math.sin(a[3]) * a[4];
       const bvx = b[7] ?? Math.cos(b[3]) * b[4], bvy = b[8] ?? Math.sin(b[3]) * b[4];
       out.x = h00 * a[1] + h10 * h * avx + h01 * b[1] + h11 * h * bvx;
       out.y = h00 * a[2] + h10 * h * avy + h01 * b[2] + h11 * h * bvy;
       out.angle = lerpAngle(a[3], b[3], f);
       out.speed = a[4] + (b[4] - a[4]) * f;
       out.steer = a[5] + (b[5] - a[5]) * f;
       out.flags = f < 0.5 ? a[6] : b[6];
       return out;
   }

   // Car idx at render time: Hermite between snapshots; past the newest, dead-reckon; coming back from that, blend.
   // out/state are per-car objects the caller keeps (no allocation per frame); scale = world units per metre.
   export function sample(buf, renderT, idx, out = {}, state = null, scale = 6) {
       const S = buf.snaps;
       let found = false;
       for (let k = S.length - 1; k >= 0 && !found; k--) {
           const a = S[k].cars.get(idx);
           if (!a || S[k].t > renderT) continue;
           for (let j = k + 1; j < S.length; j++) {
               const b = S[j].cars.get(idx);
               if (!b) continue;
               hermite(a, b, S[k].t, S[j].t, renderT, out);
               found = true;
               if (state && state.extrap) { state.extrap = false; state.blend = RECOVER_S; state.from = { x: state.lx, y: state.ly, angle: state.la }; }
               break;
           }
           if (!found) {
               arc(a, renderT - S[k].t, scale, out);
               found = true;
               if (state) state.extrap = true;
           }
       }
       if (!found) {
           for (const s of S) { const a = s.cars.get(idx); if (a) { arc(a, 0, scale, out); found = true; break; } }
           if (!found) return null;
       }
       if (state) {
           if (state.blend > 0) {
               const dt = state.lt === undefined ? 0 : Math.max(0, renderT - state.lt);
               state.blend = Math.max(0, state.blend - dt);
               const k = state.blend / RECOVER_S;
               out.x += (state.from.x - out.x) * k; out.y += (state.from.y - out.y) * k;
               out.angle += Math.atan2(Math.sin(state.from.angle - out.angle), Math.cos(state.from.angle - out.angle)) * k;
           }
           state.lt = renderT; state.lx = out.x; state.ly = out.y; state.la = out.angle;
       }
       return out;
   }
   ```
   Delete the old `pose` helper if nothing uses it any more.

- [ ] **Step 3: Run the tests**

Run: `node --test test/netsync.test.js && npm test`
Expected: all pass. The old interpolation test still passes: Hermite matches linear when the velocity agrees with the motion, and that fixture's speeds are zero. If it fails, set its velocity fields accordingly and record a ruling.

- [ ] **Step 4: Commit**

```bash
git add public/js/netsync.js test/netsync.test.js
git commit -m "Adaptive interpolation delay with time dilation, Hermite curves and dead reckoning"
```

---

### Task 7: Wire prediction and adaptive interpolation into the client

**Files:**
- Modify: `public/js/game3d.js` (input loop, prediction, `applyNet`, own pose), `public/js/socket.js` (input batches, ping/pong, net stats state)
- Modify: `src/socketManager.js` (`net_ping` ack)

**Interfaces:**
- Consumes:
  - `Predictor`, `STEP_S` (Task 5);
  - `SnapshotBuffer.targetDelayS`, `RenderClock`, `sample(buf, t, idx, out, state, scale)`, `decodeFlags(f, out)` (Task 6);
  - server input batches (Task 3).
- Produces: `clientState.net = { rttMs, link, tickMs, starve }` for Task 8. The globals `window.lanraceNet` (overlay readings) and `window.sendUDPInput(batch)` take `{ inputs: [...] }`.

- [ ] **Step 1: `public/js/socket.js`:**
1. In `clientState`, add `net: { rttMs: null, link: 'TCP', tickMs: null, starve: {} },`.
2. Change `window.sendUDPInput`:
   - Rename its parameter to `batch`.
   - Send `JSON.stringify({ type: 'INPUT', payload: batch })` over UDP.
   - Keep the 500 ms quiet rule.
   - Make the fallback call `socket.emit('input', batch)`.
3. In `rtcDataChannel.onmessage`, add a branch: `else if (msg.type === 'PONG') clientState.net.rttMs = performance.now() - msg.clientTime;`.
4. Add a 1 Hz ping:
   ```js
   setInterval(() => {
       const t = performance.now();
       if (udpReady && rtcDataChannel && rtcDataChannel.readyState === 'open' && performance.now() - lastUdpRx < 500) {
           clientState.net.link = 'UDP';
           try { rtcDataChannel.send(JSON.stringify({ type: 'PING', clientTime: t })); } catch (e) { /* next second */ }
       } else {
           clientState.net.link = 'TCP';
           socket.emit('net_ping', t, (back) => { clientState.net.rttMs = performance.now() - back; });
       }
   }, 1000);
   ```
5. Add `socket.on('net_stats', (s) => { clientState.net.tickMs = s.tickMs; clientState.net.starve = s.starve || {}; });`.

- [ ] **Step 2: `src/socketManager.js`:** inside `io.on('connection')`, add:
```js
        socket.on('net_ping', (t, ack) => { if (typeof ack === 'function') ack(t); }); // RTT for the stats overlay (TCP link)
```

- [ ] **Step 3: `public/js/game3d.js`, the fixed-step input and prediction loop**
1. Imports: change the `netsync.js` import to `import { SnapshotBuffer, RenderClock, sample, decodeFlags } from './netsync.js';`. Add `import { Predictor, STEP_S } from './predict.js';`.
2. State near the input variables:
   ```js
   let predictor = null, simAcc = 0, inputSeq = 0, sentInputs = [];   // client-side prediction (own car)
   const renderClock = new RenderClock(), carPose = new Map(), carState = new Map(); // remote cars: reused objects
   const ownPose = {};
   ```
3. Replace `sendInput(now, force)` and `pollInput(dt, now)` with:
   ```js
   // 60 Hz fixed steps: sample controls, predict own car, send newest + 5 previous (a lost UDP packet costs nothing)
   function simStep() {
       const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
       const pad = gamepadInput(pads.find(Boolean));
       input = pad || touchInput || keyboardStep(input, keys, STEP_S);
       const stamped = { seq: ++inputSeq, steer: input.steer, throttle: input.throttle, brake: input.brake, drs: !!input.drs };
       if (predictor && predictor.car) predictor.step(stamped);
       sentInputs.push(stamped);
       if (sentInputs.length > 6) sentInputs.shift();
       window.sendUDPInput({ inputs: sentInputs });
   }

   function pollInput(dt) {
       const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
       const x = !!pads.find(Boolean)?.buttons[2]?.pressed; // gamepad X / Square
       if (x && !padX && clientState.status !== 'LOBBY') toggleLine();
       padX = x;
       simAcc = Math.min(simAcc + dt, 0.25);                // a long stall doesn't fire a burst of steps
       while (simAcc >= STEP_S) { simStep(); simAcc -= STEP_S; }
   }

   function sendInput() { window.sendUDPInput({ inputs: sentInputs }); } // releaseKeys / session start resend
   ```
   In `releaseKeys()`, after zeroing `input`, call `simStep();` instead of `sendInput(performance.now(), true);`.
4. In `frame(now)`, change `pollInput(dt, now);` to `pollInput(dt);`.
5. In `window.initGameVisuals`, after `netBuf = new SnapshotBuffer();`, add:
   ```js
       predictor = isSpectator() ? null : new Predictor(clientState.trackData);
       sentInputs = []; carPose.clear(); carState.clear(); renderClock.t = null;
   ```
   Replace its `sendInput(performance.now(), true);` with `sendInput();`.

- [ ] **Step 4: `applyNet` with prediction for your own car and adaptive interpolation for the rest** (no per-frame allocations). Replace the whole function:
```js
// Own car: predicted (zero input delay). Others: adaptive interpolation delay, Hermite curves, dead reckoning.
function applyNet(nowS, dt) {
    for (const [pkt, at] of clientState.netIn.splice(0)) {
        if (!netBuf.push(pkt, at)) continue;                 // duplicate / stale: decoded once, dropped
        const myIdx = clientState.netIndex[clientState.me];
        if (predictor && myIdx !== undefined && pkt.s === netBuf.latest().s) {
            const mine = netBuf.latest().cars.get(myIdx);
            if (mine) predictor.onServer(mine);
        }
    }
    const latest = netBuf.latest(), gs = clientState.gameState;
    if (!latest || !gs) return;
    const serverT = netBuf.serverNow(nowS);
    const renderT = renderClock.advance(dt, serverT, netBuf.targetDelayS());
    const gameT = netBuf.gameTime(serverT);
    for (const id in gs) {
        const i = clientState.netIndex[id];
        if (i === undefined) continue;
        const p = gs[id];
        let pose;
        if (id === clientState.me && predictor && predictor.car) {
            pose = predictor.pose(simAcc / STEP_S, ownPose);
            const e = latest.cars.get(i);
            if (e) decodeFlags(e[6], p);
        } else {
            let out = carPose.get(i), st = carState.get(i);
            if (!out) { out = {}; st = {}; carPose.set(i, out); carState.set(i, st); }
            pose = sample(netBuf, renderT, i, out, st, scale);
            if (!pose) continue;
            decodeFlags(pose.flags, p);
        }
        p.x = pose.x; p.y = pose.y; p.angle = pose.angle; p.speed = pose.speed; p.steer = pose.steer;
        p.curLap = p.lapStart === null || p.lapStart === undefined || p.finished ? null : Math.max(0, gameT - p.lapStart);
    }
    window.lanraceNet = { delayMs: netBuf.targetDelayS() * 1000, jitterMs: netBuf.jitterS * 1000,
        lossPct: netBuf.expected ? Math.max(0, 100 * (1 - netBuf.received / netBuf.expected)) : 0,
        predErrCm: predictor ? (predictor.lastError / scale) * 100 : null };
}
```
In `frame`, change `applyNet(now / 1000);` to `applyNet(now / 1000, dt);`.

- [ ] **Step 5: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/socket.js && npm test`
Expected: no syntax errors; all tests pass.

Headless smoke test (CDP harness, solo race, then 19 bots):
- the own car drives with keys;
- no console errors;
- `window.lanraceNet` shows `delayMs` ≈ 35, with `predErrCm` small;
- remote bots move smoothly;
- a spectator page (joining mid-race) renders cars.

- [ ] **Step 6: Commit**

```bash
git add public/js/game3d.js public/js/socket.js src/socketManager.js
git commit -m "Predict your own car and render others with adaptive interpolation"
```

---

### Task 8: Network stats overlay (F3) and frame-time stats

**Files:**
- Modify: `public/index.html` (overlay element), `public/css/style.css`, `public/js/game3d.js`

**Interfaces:**
- Consumes: `window.lanraceNet` and `clientState.net` (Task 7); the existing `stats` fps counter.
- Produces: none.

- [ ] **Step 1: Markup and style.** In `index.html`, next to `#session-bar`, add:
```html
            <pre id="netstats" class="hidden"></pre>
```
In `style.css`, add:
```css
#netstats { position: absolute; bottom: 10px; left: 10px; margin: 0; padding: 8px 10px; background: rgba(0,0,0,0.65); color: #d1fae5; font: 12px/1.45 ui-monospace, monospace; border-radius: 6px; pointer-events: none; z-index: 5; }
```

- [ ] **Step 2: Frame times and overlay** in `game3d.js`:
1. State: `const frameMs = []; let netstatsOn = new URLSearchParams(location.search).has('stats'); let lastNetstats = 0;`. Initialise the element's visibility from `netstatsOn`.
2. In `onKey`, add: `if (down && e.key === 'F3') { e.preventDefault(); netstatsOn = !netstatsOn; document.getElementById('netstats').classList.toggle('hidden', !netstatsOn); }`.
3. In `frame`, after `last = now;`, add: `frameMs.push(dt * 1000); if (frameMs.length > 120) frameMs.shift();`.
4. In `frame`, after the HUD block, add:
```js
    if (netstatsOn && now - lastNetstats > 250) {
        lastNetstats = now;
        const f = [...frameMs].sort((a, b) => a - b), n = window.lanraceNet || {}, net = clientState.net;
        const p95 = f[Math.floor((f.length - 1) * 0.95)] || 0, worst = f[f.length - 1] || 0;
        const fmt = (v, d = 0, u = '') => (v === null || v === undefined ? '—' : v.toFixed(d) + u);
        document.getElementById('netstats').textContent =
            `fps ${fmt(1000 / (f.reduce((a, b) => a + b, 0) / (f.length || 1)))}  frame p95 ${fmt(p95, 1, 'ms')}  max ${fmt(worst, 1, 'ms')}\n` +
            `ping ${fmt(net.rttMs, 0, 'ms')}  jitter ${fmt(n.jitterMs, 1, 'ms')}  loss ${fmt(n.lossPct, 1, '%')}  link ${net.link}\n` +
            `interp delay ${fmt(n.delayMs, 0, 'ms')}  prediction error ${fmt(n.predErrCm, 1, 'cm')}\n` +
            `server tick ${fmt(net.tickMs, 2, 'ms')}  input starvation ${net.starve?.[clientState.me] ?? 0}/s`;
    }
```

- [ ] **Step 3: Verify**

Run: `node --check public/js/game3d.js && npm test`
Expected: pass.

Headless: open `?stats=1` and read `#netstats`. Expected:
- every line is filled;
- ping is a number;
- link is `UDP` after the handshake;
- the delay is about 35 ms on localhost;
- the server tick is under 1 ms.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/css/style.css public/js/game3d.js
git commit -m "Add the F3 network and frame stats overlay"
```

---

### Task 9: Measure under simulated bad WiFi and with a full grid

**Files:** none expected. Fix only with a ruling.

**Interfaces:**
- Consumes: everything above; `NET_SIM` (Task 4); the CDP harness and bots in the scratchpad.
- Produces: none.

- [ ] **Step 1: Baseline vs new, under `NET_SIM=30,20,2`, 20 cars, High**

- Start the server with `NET_SIM=30,20,2 PORT=3333 node server.js`. Use a port other than 3232, so a teammate's running game isn't disturbed.
- Run 19 bots (`scratchpad/bots/fill.mjs` pointed at 3333), plus the headless page driving with keys.
- Measure for 12 s:
  - frame times (fps, p99, frames > 25 ms);
  - own-car per-frame step evenness;
  - one remote car's per-frame step evenness (the same `smooth.js` approach, applied to a bot's `gameState`);
  - the overlay readings.
- Expected:
  - 60 fps and no frame over 25 ms;
  - own-car step error p95 below the 5–13% measured before this plan;
  - remote steps without spikes larger than 2× the median;
  - interpolation delay 80–150 ms;
  - prediction error a few cm.

- [ ] **Step 2: Clean localhost (no NET_SIM)**

Expected:
- delay ≈ 35 ms;
- prediction error < 2 cm;
- 60 fps.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: all pass. Nothing to commit unless a fix was needed.
