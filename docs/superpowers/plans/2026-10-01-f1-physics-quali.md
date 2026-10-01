# LanRace F1 Physics, Hitbox & Qualifying Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F1-style server-side handling, a true 5.6 × 2.0 m car hitbox, and a timed qualifying session feeding an F1 start-light race with live timing.

**Architecture:** Pure modules first (`Physics` SAT hitbox, `CarPhysics` handling model, `lobby` sanitisers, browser `input.js` shaping), then `Game` grows `quali`/`race` modes with timing, then `socketManager` orchestrates LOBBY → QUALIFYING → QUALI_RESULTS → COUNTDOWN (lights) → RACE → FINISHED, then the client HUD.

**Tech Stack:** Node 24 (`node:test`, mock timers), Socket.io 4, Three.js 0.186, browser Gamepad API.

**Spec:** `docs/superpowers/specs/2026-10-01-f1-physics-quali-design.md`

## Global Constraints

- Server authoritative; physics in SI inside `CarPhysics`, world units = metres × `track.scale` (6).
- Car constants: mass 798 kg, power 750 kW, CdA 1.4, ClA 3.5, ρ 1.225, μ 1.6, traction share 0.6, wheelbase 3.6 m, max steer 0.35 rad (fading with speed), grass μ 0.6 + 0.25 g rolling, reverse cap 20 km/h, wall keeps 40%.
- Hitbox: oriented rectangle 5.6 m × 2.0 m, SAT, restitution 0.3, broad phase 6 m, each pair once, no collisions in qualifying, finished race cars excluded.
- Statuses: `LOBBY → QUALIFYING → QUALI_RESULTS (8 s) → COUNTDOWN → RACE → FINISHED → LOBBY`; qualiMinutes 0 = off (straight to COUNTDOWN).
- Settings: `{trackId, maxLaps, qualiMinutes}`; qualiMinutes integer 0–10, default 3. `maxSpeedKmh` removed.
- Lights: `lights {count}` 1..5 at 1 s intervals, `{count: 0}` 0.5–2.5 s after the fifth.
- Quali cutoff 150 s after the flag. Results screen 8 s.
- Input: `{throttle 0..1, brake 0..1, steer -1..1}`, ≤ 30 Hz, legacy `{up,down,left,right}` still accepted.
- Keyboard ramps: steer 5/s in, 8/s back to centre; throttle 5/s up and down; brake 20/s. Gamepad dead zone 0.1.
- No new runtime dependencies. Folder is not a git repo: no commit steps.
- Blender assets and track data unchanged.

## Review Focus

1. A racer disconnects during QUALI_RESULTS → not on the race grid; race still starts with the rest (Task 4 test `disconnect during results drops driver from the grid`).
2. Nobody sets a qualifying time → grid in join order, race starts normally (Task 4 test `no quali times → join-order grid`).
3. Idle gamepad plugged in → keyboard still drives (Task 5 test `idle pad returns null`).
4. Car shoved past the wall at 300 km/h → ends inside the wall line, finite state, slowed (Task 3 test `wall hit at speed`).
5. Old client sends boolean input → still drives (Task 2 test `sanitizeInput legacy booleans`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/game/Physics.js` | modify | + `nearestOnTrack`, `carOverlap`, `resolveCarCollision`; − `checkCarCollision` |
| `src/game/CarPhysics.js` | create | F1 handling model `step(car, input, dt, scale, offTrack)` |
| `src/game/Player.js` | delete | replaced by CarPhysics |
| `src/lobby.js` | modify | analog `sanitizeInput`, `qualiMinutes` in `sanitizeSettings` |
| `src/game/Game.js` | rewrite | modes, freeze/release, wall, collisions, timing, gaps, quali classification |
| `src/socketManager.js` | rewrite | session orchestration, lights, results, timers |
| `public/js/package.json` | create | `{"type":"module"}` so node tests can import `input.js` |
| `public/js/input.js` | create | pure keyboard/gamepad shaping |
| `public/js/game3d.js` | modify | analog input loop, steer wheels, ghosts, HUD (lights, session bar, timing tower, lap times, quali results) |
| `public/js/socket.js` | modify | `lights`, `session`, `quali_results`, `timing` handlers |
| `public/js/app.js` | modify | quali setting, new statuses |
| `public/index.html`, `public/css/style.css` | modify | HUD elements, quali select |
| `test/physics.test.js`, `test/carPhysics.test.js`, `test/input.test.js` | create | |
| `test/lobby.test.js`, `test/game.test.js`, `test/socketManager.test.js` | modify | |

---

### Task 1: Rectangle hitbox (SAT) in Physics.js

**Files:**
- Modify: `src/game/Physics.js` (add functions; `checkCarCollision` stays until Task 3)
- Create: `test/physics.test.js`

**Interfaces:**
- Produces (static methods on `Physics`):
  - `nearestOnTrack(x, y, track) → { dist, px, py }` (world units)
  - `carOverlap(a, b, scale) → null | { nx, ny, depth }` — `a`, `b` have `{x, y, angle}`; normal points from b to a
  - `resolveCarCollision(a, b, scale) → boolean` — also needs `{vx, vy}`; mutates positions and velocities
  - constants `CAR_HALF_LENGTH_M = 2.8`, `CAR_HALF_WIDTH_M = 1.0` exported as `Physics.CAR_HALF_LENGTH_M` etc.

- [ ] **Step 1: Write the failing test** — `test/physics.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const Physics = require('../src/game/Physics');

const S = 6;
const car = (x, y, angleDeg = 0, vx = 0, vy = 0) =>
    ({ x: x * S, y: y * S, angle: (angleDeg * Math.PI) / 180, vx: vx * S, vy: vy * S });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('side by side 2.3 m apart does not collide (old 3 m circle did)', () => {
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(0, 2.3), S), null);
    assert.ok(2.3 * S < 2 * 18, 'old circle hitbox (radius 18) would have reported a hit');
});

test('nose to tail 5.4 m apart collides along the length axis', () => {
    const hit = Physics.carOverlap(car(0, 0), car(5.4, 0), S);
    assert.ok(hit);
    close(hit.depth, 0.2 * S);
    close(hit.nx, -1);
    close(hit.ny, 0);
});

test('car rotated 90°: collides at 3.5 m, clear at 3.9 m', () => {
    const hit = Physics.carOverlap(car(0, 0), car(3.5, 0, 90), S);
    assert.ok(hit);
    close(hit.depth, 0.3 * S);
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(3.9, 0, 90), S), null);
});

test('car rotated 45°: SAT separates at 5.3 m even though x-extents overlap', () => {
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(5.3, 0, 45), S), null);
    const hit = Physics.carOverlap(car(0, 0), car(4.9, 0, 45), S);
    assert.ok(hit);
    // min overlap is on b's sideways axis: 2.8·√½ + 1·√½ + 1 − 4.9·√½
    close(hit.depth, (2.8 * Math.SQRT1_2 + Math.SQRT1_2 + 1 - 4.9 * Math.SQRT1_2) * S);
});

test('resolve separates the cars', () => {
    const a = car(0, 0), b = car(5, 0.5, 10);
    assert.ok(Physics.resolveCarCollision(a, b, S));
    const after = Physics.carOverlap(a, b, S);
    assert.ok(after === null || after.depth < 1e-6);
});

test('rear-ender: front car speeds up, rear car slows, momentum kept', () => {
    const a = car(0, 0, 0, 30, 0);   // behind, faster
    const b = car(5.4, 0, 0, 20, 0); // in front
    Physics.resolveCarCollision(a, b, S);
    assert.ok(b.vx > 20 * S);
    assert.ok(a.vx < 30 * S);
    close(a.vx + b.vx, 50 * S);
});

test('nearestOnTrack finds the closest point on the loop', () => {
    const track = { path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const n = Physics.nearestOnTrack(50, -20, track);
    close(n.dist, 20);
    close(n.px, 50);
    close(n.py, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "is not a function|ℹ (pass|fail)"`
Expected: FAIL — `Physics.carOverlap is not a function`

- [ ] **Step 3: Implement** — add inside `class Physics` in `src/game/Physics.js` (after `distSquared`), and constants at the top of the file:

At top of file:

```js
const CAR_HALF_LENGTH_M = 2.8; // car.glb body: front wing tip to rear wing
const CAR_HALF_WIDTH_M = 1.0;
const RESTITUTION = 0.3;
```

Methods:

```js
    static nearestOnTrack(x, y, track) {
        const path = track.path;
        let best = { d2: Infinity, px: x, py: y };
        for (let i = 0; i < path.length; i++) {
            const v = path[i], w = path[(i + 1) % path.length];
            const l2 = this.distSquared(v, w);
            let t = l2 ? ((x - v.x) * (w.x - v.x) + (y - v.y) * (w.y - v.y)) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = v.x + t * (w.x - v.x), py = v.y + t * (w.y - v.y);
            const d2 = (x - px) ** 2 + (y - py) ** 2;
            if (d2 < best.d2) best = { d2, px, py };
        }
        return { dist: Math.sqrt(best.d2), px: best.px, py: best.py };
    }

    // Separating-axis test for two oriented car rectangles; normal points from b to a
    static carOverlap(a, b, scale) {
        const hl = CAR_HALF_LENGTH_M * scale, hw = CAR_HALF_WIDTH_M * scale;
        const dx = a.x - b.x, dy = a.y - b.y;
        const reach = 2 * Math.hypot(hl, hw); // ~6 m: further apart can't touch
        if (dx * dx + dy * dy > reach * reach) return null;
        const radius = (c, n) => {
            const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
            return hl * Math.abs(fx * n.x + fy * n.y) + hw * Math.abs(-fy * n.x + fx * n.y);
        };
        let best = null;
        for (const c of [a, b]) {
            const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
            for (const n of [{ x: fx, y: fy }, { x: -fy, y: fx }]) {
                const dist = dx * n.x + dy * n.y;
                const depth = radius(a, n) + radius(b, n) - Math.abs(dist);
                if (depth <= 0) return null;
                if (!best || depth < best.depth) {
                    const s = dist < 0 ? -1 : 1;
                    best = { nx: n.x * s, ny: n.y * s, depth };
                }
            }
        }
        return best;
    }

    static resolveCarCollision(a, b, scale) {
        const hit = this.carOverlap(a, b, scale);
        if (!hit) return false;
        const { nx, ny, depth } = hit;
        a.x += (nx * depth) / 2; a.y += (ny * depth) / 2;
        b.x -= (nx * depth) / 2; b.y -= (ny * depth) / 2;
        const vRel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vRel < 0) { // closing: equal masses swap part of their speed along the normal
            const j = (-(1 + RESTITUTION) * vRel) / 2;
            a.vx += j * nx; a.vy += j * ny;
            b.vx -= j * nx; b.vy -= j * ny;
        }
        return true;
    }
```

After the class, before `module.exports`:

```js
Physics.CAR_HALF_LENGTH_M = CAR_HALF_LENGTH_M;
Physics.CAR_HALF_WIDTH_M = CAR_HALF_WIDTH_M;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)"`
Expected: PASS (35 existing + 7 new = 42)

---

### Task 2: F1 handling model + analog input / quali settings sanitisers

**Files:**
- Create: `src/game/CarPhysics.js`, `test/carPhysics.test.js`
- Modify: `src/lobby.js` (`sanitizeInput`, `sanitizeSettings`), `test/lobby.test.js`

**Interfaces:**
- Produces:
  - `CarPhysics.C` (constants listed in Global Constraints, plus `ROLL_G 0.015`, `REVERSE_FORCE 6000`, `STEER_FADE 40`, `WALL_KEEP 0.4`)
  - `CarPhysics.step(car, input, dt, scale, offTrack = false)` mutates `car {x, y, angle, vx, vy, speed, steer}`; `speed` = forward speed in world units/s; `steer` = wheel angle (rad)
  - `lobby.sanitizeInput(any) → {throttle, brake, steer}`
  - `lobby.sanitizeSettings(current, incoming, trackIds) → {trackId, maxLaps, qualiMinutes}`

- [ ] **Step 1: Write the failing physics test** — `test/carPhysics.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { step, C } = require('../src/game/CarPhysics');

const DT = 1 / 60, S = 6;
const mk = (v = 0) => ({ x: 0, y: 0, angle: 0, vx: v * S, vy: 0, speed: v * S, steer: 0 });
const kmh = (c) => (c.speed / S) * 3.6;
const FULL = { throttle: 1, brake: 0, steer: 0 };
const BRAKE = { throttle: 0, brake: 1, steer: 0 };
const COAST_LOCK = { throttle: 0, brake: 0, steer: 1 };

test('launch: 0-100 km/h in 2.6–3.4 s, 0-200 under 7 s, top speed 320–360 km/h', () => {
    const c = mk();
    let t = 0, t100 = null, t200 = null;
    while (t < 120) {
        step(c, FULL, DT, S);
        t += DT;
        if (t100 === null && kmh(c) >= 100) t100 = t;
        if (t200 === null && kmh(c) >= 200) t200 = t;
    }
    assert.ok(t100 >= 2.6 && t100 <= 3.4, `0-100 ${t100}`);
    assert.ok(t200 < 7, `0-200 ${t200}`);
    assert.ok(kmh(c) >= 320 && kmh(c) <= 360, `vmax ${kmh(c)}`);
});

test('braking 300→0 km/h stops in 90–140 m and does not roll backwards', () => {
    const c = mk(300 / 3.6);
    for (let i = 0; i < 600 && c.speed > 0; i++) step(c, BRAKE, DT, S);
    const metres = c.x / S;
    assert.ok(metres >= 90 && metres <= 140, `${metres} m`);
    assert.strictEqual(c.speed, 0);
});

test('cornering grip matches μ(g + downforce/m) within 15%', () => {
    for (const v of [20, 50, 80]) {
        const c = mk(v);
        for (let i = 0; i < 12; i++) step(c, COAST_LOCK, DT, S);
        const vNow = c.speed / S;
        const measured = vNow * (c.angle / (12 * DT));
        const formula = C.MU * (C.G + (0.5 * C.RHO * C.CLA * vNow * vNow) / C.MASS);
        assert.ok(Math.abs(measured - formula) / formula < 0.15, `v=${v}: ${measured} vs ${formula}`);
    }
});

test('too fast for a 50 m corner: the car runs wide', () => {
    const c = mk(70);
    for (let i = 0; i < 60; i++) step(c, COAST_LOCK, DT, S);
    const radius = (c.speed / S) / c.angle; // average path radius over 1 s
    assert.ok(radius > 75, `radius ${radius} m`);
});

test('brake at standstill reverses, capped at 20 km/h', () => {
    const c = mk();
    for (let i = 0; i < 600; i++) step(c, BRAKE, DT, S);
    assert.ok(kmh(c) < -19 && kmh(c) >= -20.0001, `${kmh(c)} km/h`);
});

test('grass slows the car at least 0.25 g', () => {
    const c = mk(30);
    for (let i = 0; i < 60; i++) step(c, { throttle: 0, brake: 0, steer: 0 }, DT, S, true);
    assert.ok((30 - c.speed / S) / C.G >= 0.25);
});

test('state stays finite with extreme inputs', () => {
    const c = mk(90);
    for (let i = 0; i < 300; i++) step(c, { throttle: 1, brake: 1, steer: i % 2 ? 1 : -1 }, DT, S);
    assert.ok([c.x, c.y, c.vx, c.vy, c.angle, c.speed].every(Number.isFinite));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test 2>&1 | grep -E "Cannot find module|ℹ (pass|fail)"`
Expected: FAIL — `Cannot find module '../src/game/CarPhysics'`

- [ ] **Step 3: Implement** — `src/game/CarPhysics.js`

```js
// F1-style handling model. SI units inside; world units = metres × scale.
// Tuned against the tests in test/carPhysics.test.js (0-100 ≈ 2.9 s, vmax ≈ 343 km/h, 300→0 ≈ 112 m).
const C = {
    MASS: 798,             // kg, 2023 minimum incl. driver
    POWER: 750000,         // W (~1000 hp)
    CDA: 1.4,              // drag area, m²
    CLA: 3.5,              // downforce area, m²
    RHO: 1.225,            // air density, kg/m³
    G: 9.81,
    MU: 1.6,               // tyre grip on asphalt
    TRACTION: 0.6,         // share of load on the driven (rear) tyres
    WHEELBASE: 3.6,        // m
    MAX_STEER: 0.35,       // rad of wheel angle at standstill
    STEER_FADE: 40,        // m/s: max steer halves by this speed
    ROLL_G: 0.015,         // rolling resistance on asphalt, in g
    GRASS_MU: 0.6,
    GRASS_ROLL_G: 0.25,
    REVERSE_FORCE: 6000,   // N
    REVERSE_MAX: 20 / 3.6, // m/s
    WALL_KEEP: 0.4,        // share of speed kept after hitting the barrier
};

function step(car, input, dt, scale, offTrack = false) {
    const mu = offTrack ? C.GRASS_MU : C.MU;
    const roll = (offTrack ? C.GRASS_ROLL_G : C.ROLL_G) * C.G;

    let vx = car.vx / scale, vy = car.vy / scale;
    let fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    let vf = vx * fx + vy * fy;
    const v = Math.hypot(vx, vy);
    const downforce = 0.5 * C.RHO * C.CLA * v * v;
    const grip = mu * (C.MASS * C.G + downforce);

    // Longitudinal tyre force: traction/power-limited drive, grip-limited brakes, slow reverse
    let ft = 0;
    if (vf >= -0.5) {
        ft += input.throttle * Math.min(C.POWER / Math.max(vf, 1), C.TRACTION * grip);
        if (vf > 0.5) ft -= input.brake * grip;
        else if (input.brake > 0 && input.throttle === 0) ft -= input.brake * C.REVERSE_FORCE;
    } else if (input.throttle > 0) {
        ft += input.throttle * grip; // throttle while rolling backwards acts as a brake
    } else if (input.brake > 0) {
        ft -= input.brake * C.REVERSE_FORCE;
    }
    ft = Math.max(-grip, Math.min(grip, ft));

    // Friction circle: what braking/drive uses is not available for cornering
    const latAccel = Math.sqrt(Math.max(0, grip * grip - ft * ft)) / C.MASS;

    // Steering (bicycle model), yaw capped by available grip → understeer when overdriven
    car.steer = (input.steer * C.MAX_STEER) / (1 + Math.abs(vf) / C.STEER_FADE);
    let yaw = (vf / C.WHEELBASE) * Math.tan(car.steer);
    const yawMax = latAccel / Math.max(Math.abs(vf), 1);
    yaw = Math.max(-yawMax, Math.min(yawMax, yaw));
    car.angle += yaw * dt;

    // Re-project velocity onto the new heading; tyres cancel sideways slide up to their grip
    fx = Math.cos(car.angle); fy = Math.sin(car.angle);
    vf = vx * fx + vy * fy;
    let vl = -vx * fy + vy * fx;
    vl -= Math.sign(vl) * Math.min(Math.abs(vl), latAccel * dt);

    const drag = 0.5 * C.RHO * C.CDA * v * v;
    const before = vf;
    vf += (ft / C.MASS - (drag / C.MASS + roll) * Math.sign(vf)) * dt;
    if (input.brake > 0 && before > 0.5 && vf < 0) vf = 0;                                   // brakes stop, don't reverse
    if (input.throttle === 0 && input.brake === 0 && Math.sign(vf) !== Math.sign(before)) vf = 0; // coasting stops at zero
    if (vf < -C.REVERSE_MAX) vf = -C.REVERSE_MAX;

    vx = vf * fx - vl * fy;
    vy = vf * fy + vl * fx;
    car.vx = vx * scale;
    car.vy = vy * scale;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.speed = vf * scale;
}

module.exports = { C, step };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)"`
Expected: PASS (49)

- [ ] **Step 5: Update lobby tests (failing first)** — in `test/lobby.test.js`, change `DEFAULTS` and replace the `sanitizeSettings` and `sanitizeInput` tests:

```js
const DEFAULTS = { trackId: 'monza', maxLaps: 3, qualiMinutes: 3 };
```

```js
test('sanitizeSettings clamps and ignores garbage', () => {
    assert.deepStrictEqual(lobby.sanitizeSettings(DEFAULTS, null, TRACK_IDS), DEFAULTS);
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'monaco', maxLaps: '7', qualiMinutes: 99, maxSpeedKmh: 300, evil: 1 }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 3, qualiMinutes: 10 },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'spa', maxLaps: 0, qualiMinutes: -2 }, TRACK_IDS),
        { trackId: 'spa', maxLaps: 1, qualiMinutes: 0 },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { maxLaps: 4.6, qualiMinutes: NaN }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 5, qualiMinutes: 3 },
    );
});

test('sanitizeInput clamps analog values', () => {
    assert.deepStrictEqual(lobby.sanitizeInput({ throttle: 2, brake: -1, steer: -3 }), { throttle: 1, brake: 0, steer: -1 });
    assert.deepStrictEqual(lobby.sanitizeInput({ throttle: 0.5, brake: NaN, steer: '1' }), { throttle: 0.5, brake: 0, steer: 0 });
    assert.deepStrictEqual(lobby.sanitizeInput(null), { throttle: 0, brake: 0, steer: 0 });
});

test('sanitizeInput legacy booleans', () => {
    assert.deepStrictEqual(lobby.sanitizeInput({ up: true, left: 1 }), { throttle: 1, brake: 0, steer: -1 });
    assert.deepStrictEqual(lobby.sanitizeInput({ down: true, right: true }), { throttle: 0, brake: 1, steer: 1 });
});
```

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)"`
Expected: FAIL in the three changed tests.

- [ ] **Step 6: Implement in** `src/lobby.js` — replace `sanitizeSettings` and `sanitizeInput`:

```js
function sanitizeSettings(current, incoming, trackIds) {
    if (!incoming || typeof incoming !== 'object') return current;
    const next = { ...current };
    if (trackIds.includes(incoming.trackId)) next.trackId = incoming.trackId;
    if (Number.isFinite(incoming.maxLaps)) next.maxLaps = clamp(Math.round(incoming.maxLaps), 1, 50);
    if (Number.isFinite(incoming.qualiMinutes)) next.qualiMinutes = clamp(Math.round(incoming.qualiMinutes), 0, 10);
    return next;
}

const num = (v, min, max) => (Number.isFinite(v) ? clamp(v, min, max) : 0);

function sanitizeInput(input) {
    const i = input && typeof input === 'object' ? input : {};
    if ('throttle' in i || 'brake' in i || 'steer' in i) {
        return { throttle: num(i.throttle, 0, 1), brake: num(i.brake, 0, 1), steer: num(i.steer, -1, 1) };
    }
    // Legacy on/off keys from older clients
    return { throttle: i.up ? 1 : 0, brake: i.down ? 1 : 0, steer: (i.right ? 1 : 0) - (i.left ? 1 : 0) };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)"`
Expected: PASS (all lobby + physics tests). `test/game.test.js` / `test/socketManager.test.js` still pass (Game still uses `Player.js` until Task 3; `maxSpeedKmh` in the old settings default is now dropped by the sanitiser only when changed).

---

### Task 3: Game modes, physics wiring, timing

**Files:**
- Rewrite: `src/game/Game.js`
- Rewrite: `test/game.test.js`
- Delete: `src/game/Player.js`; remove `checkCarCollision` from `src/game/Physics.js`

**Interfaces:**
- Consumes: `CarPhysics.step`, `CarPhysics.C.WALL_KEEP` (Task 2); `Physics.nearestOnTrack`, `Physics.resolveCarCollision` (Task 1); `Track` shape (unchanged).
- Produces:
  - `new Game(io, players, track, settings, onFinish, mode = 'race')` — `players` in grid order; `settings {maxLaps, qualiMinutes}`; quali `onFinish(results)` with `results = [{id, bestLap}]` in classification order; race `onFinish()`.
  - `game.start()` (emits `game_init {players, track, mode}`; quali also emits `session {phase:'QUALIFYING', endsInMs}`), `game.stop()`, `game.release()` (race: lights out), `game.update()`, `game.handleInput(id, input)`, `game.removePlayer(id)`, `game.initPayload()`, `game.checkLapProgress(p)`, `game.updateRanks()`
  - `game.time` (session seconds), `game.flagAt`, `game.dt`
  - `Game.rankPlayers(players, checkpoints)`, `Game.qualiOrder(players)`
  - Emits `timing {id, lap, lapTime, bestLap}` per completed lap; quali emits `session {phase:'QUALI_FLAG', endsInMs:150000}` once when the flag falls.
  - `game_state[id] = {x, y, angle, speed, steer, lap, checkpoint, rank, finished, gap, lapsDown, lastLap, bestLap, curLap, ghost}`

- [ ] **Step 1: Write the failing tests** — replace `test/game.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

const io = { emit() {}, volatile: { emit() {} } };
const monza = Track.load('monza');
const lp = (id, teamId = 'ferrari') => ({ id, username: id.toUpperCase(), teamId });
const RACE = { maxLaps: 3, qualiMinutes: 0 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

// Teleport p through checkpoints in order; each call to lap() ends on the start line
function crossLine(g, p, t) {
    g.time = t;
    const cp = g.track.checkpoints[0];
    p.x = cp.x; p.y = cp.y;
    g.checkLapProgress(p);
}
function lap(g, p, startTime, seconds) {
    const cps = g.track.checkpoints;
    for (let k = 1; k <= cps.length; k++) {
        const target = (p.checkpoint + 1) % cps.length;
        g.time = startTime + (seconds * k) / cps.length;
        p.x = cps[target].x; p.y = cps[target].y;
        g.checkLapProgress(p);
    }
}

test('rankPlayers: finished by finish order, then lap, checkpoint, distance to next', () => {
    const cps = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
    const players = [
        { id: 'a', lap: 0, checkpoint: 1, x: 150, y: 0, finished: false },
        { id: 'b', lap: 1, checkpoint: 0, x: 0, y: 0, finished: false },
        { id: 'c', lap: 0, checkpoint: 1, x: 110, y: 0, finished: false },
        { id: 'd', lap: 3, checkpoint: 0, x: 0, y: 0, finished: true, finishOrder: 2 },
        { id: 'e', lap: 3, checkpoint: 0, x: 0, y: 0, finished: true, finishOrder: 1 },
    ];
    assert.deepStrictEqual(Game.rankPlayers(players, cps).map(p => p.id), ['e', 'd', 'b', 'a', 'c']);
});

test('players start on grid slots at rest', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    assert.strictEqual(g.players.a.x, monza.startPositions[0].x);
    assert.strictEqual(g.players.b.y, monza.startPositions[1].y);
    assert.strictEqual(g.players.a.angle, monza.startPositions[0].angle);
    assert.strictEqual(g.players.a.vx, 0);
    assert.strictEqual(g.players.a.teamId, 'ferrari');
});

test('race cars stay put before lights out even at full throttle, then drive', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const a = g.players.a, x0 = a.x, y0 = a.y;
    g.handleInput('a', { throttle: 1, brake: 0, steer: 0 });
    for (let i = 0; i < 60; i++) g.update();
    assert.strictEqual(a.x, x0);
    assert.strictEqual(a.y, y0);
    g.release();
    for (let i = 0; i < 60; i++) g.update();
    assert.ok(Math.hypot(a.x - x0, a.y - y0) > 3 * monza.scale, 'should launch > 3 m in 1 s');
});

test('removing last unfinished racer ends race', () => {
    let finishedCalls = 0;
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => finishedCalls++);
    g.release();
    g.players.a.finished = true;
    g.update();
    assert.strictEqual(finishedCalls, 0);
    g.removePlayer('b');
    g.update();
    assert.strictEqual(finishedCalls, 1);
});

test('game_state fields', () => {
    let sent = null;
    const spyIo = { emit() {}, volatile: { emit: (ev, data) => { if (ev === 'game_state') sent = data; } } };
    const g = new Game(spyIo, [lp('a')], monza, RACE, () => {});
    g.update();
    assert.deepStrictEqual(Object.keys(sent.a).sort(),
        ['angle', 'bestLap', 'checkpoint', 'curLap', 'finished', 'gap', 'ghost', 'lap', 'lapsDown', 'lastLap', 'rank', 'speed', 'steer', 'x', 'y']);
    assert.strictEqual(sent.a.rank, 1);
    assert.strictEqual(sent.a.ghost, false);
});

test('initPayload carries players, track and mode', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {}, 'quali');
    const p = g.initPayload();
    assert.strictEqual(p.track.id, 'monza');
    assert.strictEqual(p.mode, 'quali');
    assert.ok(p.players.a);
});

test('quali cars are ghosts; race cars collide; finished race cars are not pushed', () => {
    for (const [mode, expectMoved] of [['quali', false], ['race', true]]) {
        const g = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 1, qualiMinutes: 1 }, () => {}, mode);
        g.release();
        const { a, b } = g.players;
        b.x = a.x + 1; b.y = a.y; b.angle = a.angle;
        const bx = b.x;
        g.update();
        assert.strictEqual(Math.abs(b.x - bx) > 1e-6, expectMoved, mode);
    }
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    const { a, b } = g.players;
    b.x = a.x + 1; b.y = a.y; b.angle = a.angle; b.finished = true;
    const bx = b.x;
    g.update();
    assert.strictEqual(b.x, bx);
});

test('wall hit at speed: car ends inside the wall line, finite, slowed', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const a = g.players.a;
    const wall = monza.width / 2 + 80;
    // Put the car just past the wall, heading straight out at 300 km/h
    const n = Physics.nearestOnTrack(a.x, a.y, monza);
    const dirX = -Math.sin(a.angle), dirY = Math.cos(a.angle);
    a.x = n.px + dirX * (wall + 5); a.y = n.py + dirY * (wall + 5);
    a.vx = dirX * (300 / 3.6) * monza.scale; a.vy = dirY * (300 / 3.6) * monza.scale;
    g.update();
    const after = Physics.nearestOnTrack(a.x, a.y, monza);
    assert.ok(after.dist <= wall, `${after.dist} > ${wall}`);
    assert.ok([a.x, a.y, a.vx, a.vy].every(Number.isFinite));
    assert.ok(Math.hypot(a.vx, a.vy) < 0.5 * (300 / 3.6) * monza.scale);
});

test('race lap times are recorded from lights out', () => {
    const events = [];
    const spyIo = { emit: (ev, d) => { if (ev === 'timing') events.push(d); }, volatile: { emit() {} } };
    const g = new Game(spyIo, [lp('a')], monza, RACE, () => {});
    g.release();
    const a = g.players.a;
    lap(g, a, 0, 85);
    close(a.lastLap, 85);
    lap(g, a, 85, 82);
    close(a.bestLap, 82);
    assert.deepStrictEqual(events.map(e => e.lap), [1, 2]);
});

test('race gap = time difference at the last checkpoint both passed; lapped cars show laps down', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c')], monza, { maxLaps: 5, qualiMinutes: 0 }, () => {});
    const { a, b, c } = g.players;
    Object.assign(a, { lap: 1, checkpoint: 3, progress: 19, passTimes: { 18: 96, 19: 100 } });
    Object.assign(b, { lap: 1, checkpoint: 2, progress: 18, passTimes: { 18: 97.5 } });
    Object.assign(c, { lap: 0, checkpoint: 2, progress: 2, passTimes: { 2: 20 } });
    g.updateRanks();
    assert.deepStrictEqual([a.rank, b.rank, c.rank], [1, 2, 3]);
    assert.strictEqual(a.gap, null);
    close(b.gap, 1.5);
    assert.strictEqual(c.lapsDown, 1);
    assert.strictEqual(c.gap, null);
});

test('quali: best lap sets order, no-time drivers last in join order', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c'), lp('d')], monza, { maxLaps: 3, qualiMinutes: 3 }, () => {}, 'quali');
    const P = g.players;
    crossLine(g, P.a, 10); lap(g, P.a, 10, 95); lap(g, P.a, 105, 92);
    crossLine(g, P.b, 12); lap(g, P.b, 12, 90);
    assert.deepStrictEqual(Game.qualiOrder(Object.values(P)).map(p => p.id), ['b', 'a', 'c', 'd']);
    close(P.a.bestLap, 92);
    g.updateRanks();
    close(P.a.gap, 2);
});

test('quali: lap started before the flag counts, then that car is done', () => {
    const g = new Game(io, [lp('a')], monza, { maxLaps: 3, qualiMinutes: 1 }, () => {}, 'quali'); // flag at 60 s
    const a = g.players.a;
    crossLine(g, a, 5);
    lap(g, a, 5, 50);          // ends at 55 s, before the flag
    assert.strictEqual(a.finished, false);
    lap(g, a, 55, 40);         // started before the flag, ends at 95 s
    close(a.lastLap, 40);
    assert.strictEqual(a.finished, true);
    lap(g, a, 95, 30);         // after taking the flag nothing is timed
    close(a.bestLap, 40);
});

test('quali ends when everyone has taken the flag, or 150 s after it', () => {
    let results = null;
    const g = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 3, qualiMinutes: 1 }, (r) => { results = r; }, 'quali');
    g.players.a.finished = true;
    g.players.b.checkpoint = 7; // grid slots sit inside checkpoint 0's radius; keep b mid-lap so it doesn't take the flag
    g.time = 100;
    g.update();
    assert.strictEqual(results, null);
    g.time = 60 + 150 - g.dt / 2;
    g.update();
    assert.deepStrictEqual(results.map(r => r.id), ['a', 'b']);

    let all = null;
    const g2 = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 3, qualiMinutes: 1 }, (r) => { all = r; }, 'quali');
    g2.players.a.finished = true;
    g2.players.b.finished = true;
    g2.update();
    assert.ok(all);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test 2>&1 | grep -E "ℹ (pass|fail)"`
Expected: FAIL (e.g. `g.release is not a function`)

- [ ] **Step 3: Rewrite** `src/game/Game.js`

```js
const CarPhysics = require('./CarPhysics');
const Physics = require('./Physics');

const TICK_RATE = 60;
const WALL_OFFSET = 80;     // world units past the track edge; Track.js checkpoints use the same
const QUALI_CUTOFF_S = 150; // after the flag, laps in progress get this long to finish

class Game {
    constructor(io, players, track, settings, onFinish, mode = 'race') {
        this.io = io;
        this.track = track;
        this.settings = settings;
        this.onFinish = onFinish;
        this.mode = mode;
        this.dt = 1 / TICK_RATE;
        this.time = 0;                     // session clock (s); race clock starts at lights out
        this.frozen = mode === 'race';     // race cars wait for lights out
        this.flagAt = mode === 'quali' ? settings.qualiMinutes * 60 : Infinity;
        this.flagShown = false;
        this.loopPath = null;
        this.winnerCount = 0;

        const cpCount = track.checkpoints.length;
        this.players = {};
        players.forEach((p, index) => {
            const slot = track.startPositions[index % track.startPositions.length];
            this.players[p.id] = {
                id: p.id,
                username: p.username,
                teamId: p.teamId,
                x: slot.x, y: slot.y, angle: slot.angle,
                vx: 0, vy: 0, speed: 0, steer: 0,
                lastSafeX: slot.x, lastSafeY: slot.y,
                lap: 0,
                // Race cars sit behind the line having "passed" checkpoint 0; quali cars must cross it to start a lap
                checkpoint: mode === 'quali' ? cpCount - 1 : 0,
                progress: 0,
                passTimes: { 0: 0 },
                lapStart: mode === 'race' ? 0 : null,
                lastLap: null,
                bestLap: null,
                finished: false,
                finishOrder: 0,
                rank: index + 1,
                gap: null,
                lapsDown: 0,
                joinOrder: index,
                input: { throttle: 0, brake: 0, steer: 0 }
            };
        });
    }

    static rankPlayers(players, checkpoints) {
        const distToNext = (p) => {
            const cp = checkpoints[(p.checkpoint + 1) % checkpoints.length];
            return Math.hypot(p.x - cp.x, p.y - cp.y);
        };
        return [...players].sort((a, b) => {
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            if (a.finished) return a.finishOrder - b.finishOrder;
            if (a.lap !== b.lap) return b.lap - a.lap;
            if (a.checkpoint !== b.checkpoint) return b.checkpoint - a.checkpoint;
            return distToNext(a) - distToNext(b);
        });
    }

    static qualiOrder(players) {
        return [...players].sort((a, b) => {
            if (a.bestLap === null || b.bestLap === null) {
                if (a.bestLap === b.bestLap) return a.joinOrder - b.joinOrder;
                return a.bestLap === null ? 1 : -1;
            }
            return a.bestLap - b.bestLap;
        });
    }

    initPayload() {
        return { players: this.players, track: this.track, mode: this.mode };
    }

    handleInput(id, input) {
        if (this.players[id]) this.players[id].input = input; // kept while frozen, applies at lights out
    }

    removePlayer(id) {
        delete this.players[id];
    }

    start() {
        this.io.emit('game_init', this.initPayload());
        if (this.mode === 'quali') this.io.emit('session', { phase: 'QUALIFYING', endsInMs: this.flagAt * 1000 });
        this.loopPath = setInterval(() => this.update(), 1000 / TICK_RATE);
    }

    stop() {
        if (this.loopPath) clearInterval(this.loopPath);
        this.loopPath = null;
    }

    release() {
        this.frozen = false;
        this.time = 0;
    }

    drive(p) {
        const t = this.track, scale = t.scale;
        const before = Physics.nearestOnTrack(p.x, p.y, t);
        CarPhysics.step(p, p.input, this.dt, scale, before.dist > t.width / 2);

        const wallDist = t.width / 2 + WALL_OFFSET;
        const after = Physics.nearestOnTrack(p.x, p.y, t);
        if (after.dist > wallDist) {
            const nx = (p.x - after.px) / after.dist, ny = (p.y - after.py) / after.dist;
            p.x = after.px + nx * (wallDist - 1);
            p.y = after.py + ny * (wallDist - 1);
            const vn = p.vx * nx + p.vy * ny;
            if (vn > 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
            p.vx *= CarPhysics.C.WALL_KEEP;
            p.vy *= CarPhysics.C.WALL_KEEP;
            p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
        }

        if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
            p.lastSafeX = p.x;
            p.lastSafeY = p.y;
        } else {
            p.x = p.lastSafeX; p.y = p.lastSafeY;
            p.vx = p.vy = p.speed = 0;
            if (!Number.isFinite(p.angle)) p.angle = 0;
        }
    }

    update() {
        const ids = Object.keys(this.players);
        if (!this.frozen) {
            this.time += this.dt;
            for (const id of ids) {
                const p = this.players[id];
                if (this.mode === 'race' && p.finished) continue;
                this.drive(p);
                this.checkLapProgress(p);
            }
            if (this.mode === 'race') {
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        const a = this.players[ids[i]], b = this.players[ids[j]];
                        if (!a.finished && !b.finished) Physics.resolveCarCollision(a, b, this.track.scale);
                    }
                }
            }
        }

        if (this.mode === 'quali' && !this.flagShown && this.time >= this.flagAt) {
            this.flagShown = true;
            this.io.emit('session', { phase: 'QUALI_FLAG', endsInMs: QUALI_CUTOFF_S * 1000 });
        }

        this.updateRanks();

        const stateSync = {};
        for (const id in this.players) {
            const p = this.players[id];
            stateSync[id] = {
                x: p.x, y: p.y, angle: p.angle, speed: p.speed, steer: p.steer,
                lap: p.lap, checkpoint: p.checkpoint, rank: p.rank, finished: p.finished,
                gap: p.gap, lapsDown: p.lapsDown, lastLap: p.lastLap, bestLap: p.bestLap,
                curLap: p.lapStart === null || p.finished ? null : this.time - p.lapStart,
                ghost: this.mode === 'quali'
            };
        }
        this.io.volatile.emit('game_state', stateSync);

        const active = ids.filter(id => !this.players[id].finished).length;
        const over = this.mode === 'race'
            ? active === 0
            : active === 0 || this.time >= this.flagAt + QUALI_CUTOFF_S;
        if (over) {
            this.stop();
            if (this.mode === 'quali') {
                this.onFinish(Game.qualiOrder(Object.values(this.players)).map(p => ({ id: p.id, bestLap: p.bestLap })));
            } else {
                this.onFinish();
            }
        }
    }

    updateRanks() {
        const list = Object.values(this.players);
        if (!list.length) return;
        const ranked = this.mode === 'quali' ? Game.qualiOrder(list) : Game.rankPlayers(list, this.track.checkpoints);
        const leader = ranked[0];
        const cpCount = this.track.checkpoints.length;
        ranked.forEach((p, i) => {
            p.rank = i + 1;
            if (this.mode === 'quali') {
                p.lapsDown = 0;
                p.gap = i > 0 && p.bestLap !== null && leader.bestLap !== null ? p.bestLap - leader.bestLap : null;
            } else {
                p.lapsDown = Math.floor((leader.progress - p.progress) / cpCount);
                const mine = p.passTimes[p.progress], theirs = leader.passTimes[p.progress];
                p.gap = i > 0 && p.lapsDown === 0 && mine !== undefined && theirs !== undefined ? mine - theirs : null;
            }
        });
    }

    recordLap(p) {
        const lapTime = this.time - p.lapStart;
        p.lastLap = lapTime;
        if (p.bestLap === null || lapTime < p.bestLap) p.bestLap = lapTime;
        p.lapStart = this.time;
        this.io.emit('timing', { id: p.id, lap: p.lap, lapTime, bestLap: p.bestLap });
    }

    checkLapProgress(p) {
        const cps = this.track.checkpoints;
        const target = (p.checkpoint + 1) % cps.length;
        const cp = cps[target];
        if (Math.hypot(p.x - cp.x, p.y - cp.y) >= cp.radius) return;

        p.checkpoint = target;
        p.progress++;
        p.passTimes[p.progress] = this.time;
        if (target !== 0) return;

        // Crossed the start/finish line
        if (this.mode === 'race') {
            p.lap++;
            this.recordLap(p);
            if (p.lap >= this.settings.maxLaps) {
                p.finished = true;
                this.winnerCount++;
                p.finishOrder = this.winnerCount;
                this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username} finished P${p.finishOrder}!` });
            }
            return;
        }
        if (p.finished) return; // already took the chequered flag
        if (p.lapStart !== null) {
            p.lap++;
            this.recordLap(p);
        }
        if (this.time >= this.flagAt) {
            p.finished = true;     // chequered flag: session over for this car
            p.lapStart = null;
            return;
        }
        p.lapStart = this.time;
    }
}

module.exports = Game;
```

Delete `src/game/Player.js`. In `src/game/Physics.js` delete the `checkCarCollision` method.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)"`
Expected: game tests PASS. `test/socketManager.test.js` FAILS (it still assumes the old 3-2-1 countdown) — fixed in Task 4. Also `grep -rn "Player'" src` → no matches.

---

### Task 4: Session orchestration (quali → results → lights → race)

**Files:**
- Rewrite: `src/socketManager.js`
- Rewrite: `test/socketManager.test.js`

**Interfaces:**
- Consumes: `Game` (Task 3), `lobby` (Task 2), `Track`.
- Produces events: `status_change` ∈ {QUALIFYING, QUALI_RESULTS, COUNTDOWN, RACE, FINISHED}; `lights {count}`; `session {phase, endsInMs}`; `quali_results [{id, bestLap, position}]`; existing lobby events. Removes `countdown`.

- [ ] **Step 1: Write the failing tests** — replace `test/socketManager.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const setupSocketManager = require('../src/socketManager');
const Track = require('../src/game/Track');

const monza = Track.load('monza');

function fakeIo() {
    const io = {
        handlers: {},
        sent: [],
        on(ev, fn) { this.handlers[ev] = fn; },
        emit(ev, data) { this.sent.push([ev, data]); },
        volatile: { emit() {} },
    };
    io.connect = (id) => {
        const s = {
            id,
            handlers: {},
            sent: [],
            on(ev, fn) { this.handlers[ev] = fn; },
            emit(ev, data) { this.sent.push([ev, data]); },
            broadcast: { emit() {} },
            fire(ev, data) { this.handlers[ev]?.(data); },
        };
        io.handlers.connection(s);
        return s;
    };
    io.events = (name) => io.sent.filter(([ev]) => ev === name).map(([, d]) => d);
    return io;
}

// Each test leaves the shared server state empty by disconnecting everyone
function join(io, id, teamId, qualiMinutes) {
    const s = io.connect(id);
    s.fire('join_lobby', { username: id.toUpperCase(), teamId });
    if (qualiMinutes !== undefined) s.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualiMinutes });
    else s.fire('toggle_ready', true);
    return s;
}

test('everyone leaving during countdown cancels it, so a new host gets exactly one race', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');
    t.mock.timers.tick(2000);
    a.fire('disconnect');

    const b = join(io, 'b', 'haas', 0);
    b.fire('start_game');
    t.mock.timers.tick(10000);
    assert.strictEqual(io.events('status_change').filter(s => s === 'RACE').length, 1, 'stale lights started a second race');
    b.fire('disconnect');
});

test('lights: 1..5 one per second, out 0.5–2.5 s later; cars held until then', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');
    a.fire('input', { throttle: 1, brake: 0, steer: 0 });
    const init = io.events('game_init').at(-1);
    const car = init.players.a, x0 = car.x;

    t.mock.timers.tick(5000);
    assert.deepStrictEqual(io.events('lights').map(l => l.count), [1, 2, 3, 4, 5]);
    t.mock.timers.tick(499);
    assert.ok(!io.events('lights').some(l => l.count === 0), 'lights out too early');
    assert.strictEqual(car.x, x0, 'car moved before lights out');
    t.mock.timers.tick(2001);
    assert.ok(io.events('lights').some(l => l.count === 0), 'lights never went out');
    assert.ok(io.events('status_change').includes('RACE'));
    t.mock.timers.tick(1000);
    assert.notStrictEqual(car.x, x0, 'held throttle should launch at lights out');
    a.fire('disconnect');
});

test('qualifying → results → race grid in best-lap order', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    assert.deepStrictEqual(io.events('status_change'), ['QUALIFYING']);
    const quali = io.events('game_init').at(-1);
    assert.strictEqual(quali.mode, 'quali');

    Object.assign(quali.players.a, { bestLap: 85, finished: true });
    Object.assign(quali.players.b, { bestLap: 80, finished: true });
    t.mock.timers.tick(50);
    assert.ok(io.events('status_change').includes('QUALI_RESULTS'));
    assert.deepStrictEqual(io.events('quali_results').at(-1).map(r => [r.id, r.position]), [['b', 1], ['a', 2]]);

    t.mock.timers.tick(8000);
    assert.strictEqual(io.events('status_change').at(-1), 'COUNTDOWN');
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(race.players.b.x, monza.startPositions[0].x);
    assert.strictEqual(race.players.a.x, monza.startPositions[1].x);
    a.fire('disconnect');
    b.fire('disconnect');
});

test('no quali times → join-order grid', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    t.mock.timers.tick((60 + 150) * 1000 + 100); // nobody ever crosses the line
    t.mock.timers.tick(8000);
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(race.players.a.x, monza.startPositions[0].x);
    assert.strictEqual(race.players.b.x, monza.startPositions[1].x);
    a.fire('disconnect');
    b.fire('disconnect');
});

test('disconnect during results drops driver from the grid', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    const quali = io.events('game_init').at(-1);
    Object.assign(quali.players.a, { bestLap: 85, finished: true });
    Object.assign(quali.players.b, { bestLap: 80, finished: true });
    t.mock.timers.tick(50);
    b.fire('disconnect');
    t.mock.timers.tick(8000);
    const race = io.events('game_init').at(-1);
    assert.deepStrictEqual(Object.keys(race.players), ['a']);
    assert.strictEqual(race.players.a.x, monza.startPositions[0].x);
    a.fire('disconnect');
});

test('late joiner during qualifying gets the running session', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io);
    const a = join(io, 'a', 'ferrari', 1);
    a.fire('start_game');
    const c = io.connect('c');
    c.fire('join_lobby', { username: 'C', teamId: 'haas' });
    assert.ok(c.sent.some(([ev, d]) => ev === 'game_init' && d.mode === 'quali'));
    a.fire('disconnect');
    c.fire('disconnect');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test 2>&1 | grep -E "ℹ (pass|fail)"`
Expected: FAIL (no `QUALIFYING`/`lights` events yet)

- [ ] **Step 3: Rewrite** `src/socketManager.js`

```js
const Game = require('./game/Game');
const Track = require('./game/Track');
const lobby = require('./lobby');

const TRACKS = Track.loadAll(); // throws at startup if track data is missing
const RESULTS_MS = 8000;
const FINISH_MS = 5000;

const state = {
    status: 'LOBBY', // LOBBY, QUALIFYING, QUALI_RESULTS, COUNTDOWN, RACE, FINISHED
    players: {},
    hostId: null,
    settings: { trackId: 'monza', maxLaps: 3, qualiMinutes: 3 }
};

let gameInstance = null;

// Every session timer goes through later() so an empty server can cancel them all at once
const timers = new Set();
function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
}
function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
}

function lobbySnapshot() {
    return { players: state.players, hostId: state.hostId, status: state.status, settings: state.settings };
}

function setStatus(io, status) {
    state.status = status;
    io.emit('status_change', status);
}

function setupSocketManager(io) {
    io.on('connection', (socket) => {
        console.log(`Player connected: ${socket.id}`);
        // Visitors see live team counts before they join
        socket.emit('lobby_state_sync', lobbySnapshot());

        socket.on('join_lobby', (data) => {
            if (state.players[socket.id]) return;
            const check = lobby.canJoinTeam(state.players, data && data.teamId);
            if (!check.ok) return socket.emit('join_error', check.reason);

            const isFirstPlayer = Object.keys(state.players).length === 0;
            state.players[socket.id] = {
                id: socket.id,
                username: lobby.sanitizeUsername(data.username),
                teamId: check.team.id,
                color: check.team.chatColor,
                isReady: false,
                isSpectating: state.status !== 'LOBBY'
            };
            if (isFirstPlayer) state.hostId = socket.id;

            // Everyone (visitors included) needs the new counts and the current host
            io.emit('lobby_state_sync', lobbySnapshot());
            socket.broadcast.emit('player_joined', state.players[socket.id]);

            // Late joiner: give them the running session so the spectator view has something to draw
            if (gameInstance && state.status !== 'LOBBY') socket.emit('game_init', gameInstance.initPayload());
        });

        socket.on('chat_msg', (msg) => {
            const player = state.players[socket.id];
            const clean = lobby.sanitizeChat(msg);
            if (!player || !clean) return;
            io.emit('chat_msg', { username: player.username, color: player.color, msg: clean });
        });

        socket.on('toggle_ready', (isReady) => {
            if (state.status !== 'LOBBY' || !state.players[socket.id]) return;
            state.players[socket.id].isReady = !!isReady;
            io.emit('player_ready_sync', { id: socket.id, isReady: !!isReady });
        });

        socket.on('update_settings', (settings) => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            state.settings = lobby.sanitizeSettings(state.settings, settings, Track.TRACK_IDS);
            io.emit('settings_updated', state.settings);
        });

        socket.on('start_game', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;

            const notReady = Object.values(state.players)
                .some(p => p.id !== state.hostId && !p.isReady && !p.isSpectating);
            if (notReady) {
                socket.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: 'Not all players are ready!' });
                return;
            }

            const { racers, overflow } = lobby.pickRacers(state.players);
            overflow.forEach((p) => { p.isSpectating = true; });
            if (overflow.length) io.emit('lobby_state_sync', lobbySnapshot());

            if (state.settings.qualiMinutes > 0) startQuali(io, racers);
            else startRace(io, racers);
        });

        socket.on('input', (inputData) => {
            // Accepted in every session phase; a frozen race keeps it until lights out
            if (gameInstance) gameInstance.handleInput(socket.id, lobby.sanitizeInput(inputData));
        });

        socket.on('disconnect', () => {
            console.log(`Player disconnected: ${socket.id}`);
            if (!state.players[socket.id]) return;

            delete state.players[socket.id];
            if (gameInstance) gameInstance.removePlayer(socket.id);
            io.emit('player_left', socket.id);

            if (socket.id === state.hostId) {
                const remaining = Object.keys(state.players);
                if (remaining.length > 0) {
                    state.hostId = remaining[0];
                    io.emit('lobby_state_sync', lobbySnapshot());
                } else {
                    state.hostId = null;
                    clearTimers();
                    if (gameInstance) {
                        gameInstance.stop();
                        gameInstance = null;
                    }
                    state.status = 'LOBBY';
                }
            }
        });
    });
}

function startQuali(io, racers) {
    setStatus(io, 'QUALIFYING');
    gameInstance = new Game(io, racers, TRACKS[state.settings.trackId], state.settings, (results) => {
        setStatus(io, 'QUALI_RESULTS');
        io.emit('quali_results', results.map((r, i) => ({ id: r.id, bestLap: r.bestLap, position: i + 1 })));
        io.emit('session', { phase: 'QUALI_RESULTS', endsInMs: RESULTS_MS });
        later(() => {
            // Drivers who left during the results screen aren't on the grid
            const grid = results.map(r => state.players[r.id]).filter(Boolean);
            startRace(io, grid);
        }, RESULTS_MS);
    }, 'quali');
    gameInstance.start();
}

function startRace(io, grid) {
    setStatus(io, 'COUNTDOWN');
    const race = new Game(io, grid, TRACKS[state.settings.trackId], state.settings, () => finishRace(io), 'race');
    gameInstance = race;
    race.start(); // cars are drawn on the grid, frozen until lights out

    for (let n = 1; n <= 5; n++) later(() => io.emit('lights', { count: n }), n * 1000);
    later(() => {
        io.emit('lights', { count: 0 });
        race.release();
        setStatus(io, 'RACE');
        io.emit('session', { phase: 'RACE', endsInMs: null });
    }, 5000 + 500 + Math.random() * 2000);
}

function finishRace(io) {
    setStatus(io, 'FINISHED');
    later(() => {
        state.status = 'LOBBY';
        for (const id in state.players) {
            state.players[id].isReady = false;
            state.players[id].isSpectating = false;
        }
        io.emit('lobby_state_sync', lobbySnapshot());
        gameInstance = null;
    }, FINISH_MS);
}

module.exports = setupSocketManager;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)"`
Expected: all PASS. Then `node -e "require('./src/socketManager'); console.log('ok')"` → `ok`.

---

### Task 5: Analog input on the client (keyboard smoothing, gamepad, touch)

**Files:**
- Create: `public/js/package.json`, `public/js/input.js`, `test/input.test.js`
- Modify: `public/js/game3d.js` (input section, `initGameVisuals`, `frame`)

**Interfaces:**
- Produces (`public/js/input.js`, ES module): `RATES`, `DEAD_ZONE`, `approach(cur, target, rate, dt)`, `keyboardStep(prev, keys, dt) → {throttle, brake, steer}`, `deadZone(v, dz)`, `gamepadInput(pad) → {throttle, brake, steer} | null`, `changed(a, b) → boolean`.
- Socket: emits `input {throttle, brake, steer}` (Task 2 sanitiser accepts it).

- [ ] **Step 1: Create** `public/js/package.json`

```json
{ "type": "module" }
```

- [ ] **Step 2: Write the failing test** — `test/input.test.js`

```js
const { test, before } = require('node:test');
const assert = require('node:assert');

let input;
before(async () => { input = await import('../public/js/input.js'); });

const DT = 1 / 60;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const hold = (keys, seconds, start = { throttle: 0, brake: 0, steer: 0 }) => {
    let s = start;
    for (let i = 0; i < Math.round(seconds / DT); i++) s = input.keyboardStep(s, keys, DT);
    return s;
};

test('steer held 0.1 s reaches 0.5, full lock by 0.2 s', () => {
    close(hold({ right: true }, 0.1).steer, 0.5);
    close(hold({ left: true }, 0.2).steer, -1);
});

test('releasing steer returns to centre within 0.1 s', () => {
    const s = hold({ right: true }, 0.1);
    close(hold({}, 0.1, s).steer, 0);
});

test('throttle ramps in 0.2 s, brake in 0.05 s', () => {
    close(hold({ up: true }, 0.1).throttle, 0.5);
    close(hold({ up: true }, 0.2).throttle, 1);
    close(hold({ down: true }, 0.05).brake, 1);
});

test('gamepad: dead zone and trigger mapping', () => {
    close(input.deadZone(0.05), 0);
    close(input.deadZone(0.55), 0.5);
    close(input.deadZone(-1), -1);
    const pad = { axes: [0.55, 0], buttons: Object.assign(new Array(8).fill({ value: 0 }), { 6: { value: 0.25 }, 7: { value: 0.75 } }) };
    const g = input.gamepadInput(pad);
    close(g.steer, 0.5);
    close(g.throttle, 0.75);
    close(g.brake, 0.25);
});

test('idle pad returns null so the keyboard keeps working', () => {
    const idle = { axes: [0.04, 0], buttons: new Array(8).fill({ value: 0 }) };
    assert.strictEqual(input.gamepadInput(idle), null);
    assert.strictEqual(input.gamepadInput(undefined), null);
});

test('changed() ignores tiny jitter', () => {
    const a = { throttle: 0.5, brake: 0, steer: 0.2 };
    assert.strictEqual(input.changed(a, null), true);
    assert.strictEqual(input.changed(a, { throttle: 0.505, brake: 0, steer: 0.2 }), false);
    assert.strictEqual(input.changed(a, { throttle: 0.6, brake: 0, steer: 0.2 }), true);
});
```

Run: `npm test 2>&1 | grep -E "Cannot find|ℹ (pass|fail)"`
Expected: FAIL — cannot find `public/js/input.js`

- [ ] **Step 3: Implement** — `public/js/input.js`

```js
// Pure input shaping, shared by game3d.js and the node tests.
export const RATES = { steerIn: 5, steerOut: 8, throttle: 5, brake: 20 }; // units per second
export const DEAD_ZONE = 0.1;

export function approach(cur, target, rate, dt) {
    const stepSize = rate * dt;
    return Math.abs(target - cur) <= stepSize ? target : cur + Math.sign(target - cur) * stepSize;
}

// keys: { up, down, left, right } booleans
export function keyboardStep(prev, keys, dt) {
    const steerTarget = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    return {
        steer: approach(prev.steer, steerTarget, steerTarget === 0 ? RATES.steerOut : RATES.steerIn, dt),
        throttle: approach(prev.throttle, keys.up ? 1 : 0, RATES.throttle, dt),
        brake: approach(prev.brake, keys.down ? 1 : 0, RATES.brake, dt),
    };
}

export function deadZone(v, dz = DEAD_ZONE) {
    const a = Math.abs(v);
    return a < dz ? 0 : (Math.sign(v) * (a - dz)) / (1 - dz);
}

// Standard mapping: left stick X steers, RT (button 7) throttle, LT (button 6) brake
export function gamepadInput(pad) {
    if (!pad) return null;
    const steer = deadZone(pad.axes[0] || 0);
    const throttle = pad.buttons[7]?.value || 0;
    const brake = pad.buttons[6]?.value || 0;
    if (Math.abs(steer) < 0.01 && throttle < 0.05 && brake < 0.05) return null; // idle pad doesn't override the keyboard
    return { steer, throttle, brake };
}

export function changed(a, b) {
    return !b
        || Math.abs(a.steer - b.steer) > 0.01
        || Math.abs(a.throttle - b.throttle) > 0.01
        || Math.abs(a.brake - b.brake) > 0.01;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "✖|ℹ (pass|fail)|Warning"`
Expected: PASS, no `MODULE_TYPELESS_PACKAGE_JSON` warning.

- [ ] **Step 5: Wire into** `public/js/game3d.js`

Add after the existing `GLTFLoader` import:

```js
import { keyboardStep, gamepadInput, changed } from './input.js';
```

Replace everything from `// ---------- input ----------` up to (not including) `// ---------- track geometry ----------` with:

```js
// ---------- input ----------
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
let input = { throttle: 0, brake: 0, steer: 0 };
let touchInput = null;
let lastSent = null, lastSentAt = 0;
let spectateIndex = 0;

function isSpectator() {
    return !!clientState.players[clientState.me]?.isSpectating || !clientState.gameState?.[clientState.me];
}

function onKey(e, down) {
    if (document.activeElement === chatInput) return;
    const key = e.key.toLowerCase();
    if (down && clientState.status !== 'LOBBY' && isSpectator()) {
        if (key === 'arrowleft') spectateIndex--;
        if (key === 'arrowright') spectateIndex++;
    }
    const k = KEYMAP[key];
    if (!k) return;
    // Presses are ignored in the lobby (typing a name), releases always count so no key stays stuck
    if (down && clientState.status === 'LOBBY') return;
    keys[k] = down;
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));

function sendInput(now, force = false) {
    if (!force && (now - lastSentAt < 33 || !changed(input, lastSent))) return; // ≤ 30 Hz, only on change
    socket.emit('input', input);
    lastSent = { ...input };
    lastSentAt = now;
}

function pollInput(dt, now) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const pad = gamepadInput(pads.find(Boolean));
    input = pad || touchInput || keyboardStep(input, keys, dt);
    sendInput(now);
}

// Virtual joystick for touch devices
const joyZone = document.getElementById('joystick-zone');
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');
let isTouching = false;
const joyCenter = { x: 0, y: 0 };
const JOY_MAX = 50;

if ('ontouchstart' in window) joyZone.style.display = 'block';

joyBase.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = joyBase.getBoundingClientRect();
    joyCenter.x = rect.left + rect.width / 2;
    joyCenter.y = rect.top + rect.height / 2;
    isTouching = true;
    updateJoystick(e.touches[0]);
}, { passive: false });

joyBase.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (isTouching) updateJoystick(e.touches[0]);
}, { passive: false });

joyBase.addEventListener('touchend', (e) => {
    e.preventDefault();
    isTouching = false;
    joyKnob.style.transform = 'translate(-50%, -50%)';
    touchInput = null;
}, { passive: false });

function updateJoystick(touch) {
    let dx = touch.clientX - joyCenter.x;
    let dy = touch.clientY - joyCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_MAX) { dx = (dx / dist) * JOY_MAX; dy = (dy / dist) * JOY_MAX; }
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    touchInput = {
        steer: dx / JOY_MAX,
        throttle: Math.max(0, -dy / JOY_MAX),
        brake: Math.max(0, dy / JOY_MAX),
    };
}
```

Replace the `// ---------- loop ----------` section (from that comment to the end of the file) with:

```js
// ---------- loop ----------
let last = performance.now();
function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (clientState.status === 'LOBBY') return;
    pollInput(dt, now);
    if (!world || !clientState.gameState) return;
    updateCars(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    updateHUD();
    drawMinimap();
}

window.initGameVisuals = () => {
    buildWorld(clientState.trackData);
    sendInput(performance.now(), true); // resend what's held when a new session starts
};
renderer.setAnimationLoop(frame);
// game_init may have arrived while this module (and three.js) was still loading
if (clientState.trackData) window.initGameVisuals();
```

- [ ] **Step 6: Verify**

Run: `npm test 2>&1 | grep -E "ℹ (pass|fail)"` → PASS.
Run: `curl -s -o /dev/null -w "%{http_code}\n" localhost:3232/js/input.js` with the server running → `200`.

---

### Task 6: HUD — lights, session bar, timing tower, lap times, quali results, steering wheels, ghosts

**Files:**
- Modify: `public/index.html`, `public/css/style.css`, `public/js/socket.js`, `public/js/app.js`, `public/js/game3d.js`

**Interfaces:**
- Consumes: server events `lights`, `session`, `quali_results`, `timing`, `status_change` (Task 4); `game_state` fields (Task 3).
- Produces: `clientState.session {phase, endsAt}`, `clientState.qualiResults`, `clientState.lastTiming`; window hooks `handleLights(count)`, `showQualiResults(list)`.

- [ ] **Step 1: HTML** — in `public/index.html`:

Replace the Max Speed `<label>` (and its input) in host settings with:

```html
                            <label>Qualifying:
                                <select id="setting-quali">
                                    <option value="0">Off</option>
                                    <option value="1">1 min</option>
                                    <option value="2">2 min</option>
                                    <option value="3" selected>3 min</option>
                                    <option value="4">4 min</option>
                                    <option value="5">5 min</option>
                                    <option value="6">6 min</option>
                                    <option value="7">7 min</option>
                                    <option value="8">8 min</option>
                                    <option value="9">9 min</option>
                                    <option value="10">10 min</option>
                                </select>
                            </label>
```

Inside `<div id="hud">`, after the `<canvas id="minimap" …>` line, add:

```html
            <div id="session-bar"></div>
            <div id="lights" class="hidden">
                <span class="light"></span><span class="light"></span><span class="light"></span><span class="light"></span><span class="light"></span>
            </div>
```

Change the leaderboard heading `<h3>Standings</h3>` to `<h3>Timing</h3>`.

Replace `<div id="hud-bottom"> … </div>` with:

```html
            <div id="hud-bottom">
                <div id="lap-times">
                    <div>LAP <span id="lt-current">--</span></div>
                    <div>LAST <span id="lt-last">--</span></div>
                    <div>BEST <span id="lt-best">--</span></div>
                </div>
                <div class="hud-speedometer"><span id="hud-speed">0</span> KM/H</div>
            </div>
```

After `<div id="spectator-overlay" …> … </div>` add:

```html
        <div id="quali-results" class="hidden">
            <h2>QUALIFYING RESULTS</h2>
            <ol id="quali-results-list"></ol>
        </div>
```

- [ ] **Step 2: CSS** — append to `public/css/style.css`:

```css
#session-bar {
    position: absolute;
    top: 20px; left: 50%;
    transform: translateX(-50%);
    background: #0f172a;
    border: 4px solid #fff;
    border-radius: 40px;
    padding: 8px 24px;
    font-weight: 900;
    font-size: 1.3rem;
    letter-spacing: 1px;
}
#session-bar:empty { display: none; }

#lights {
    position: absolute;
    top: 80px; left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 14px;
    background: #111;
    padding: 14px 20px;
    border-radius: 14px;
    border: 3px solid #333;
}
#lights .light {
    width: 44px; height: 44px;
    border-radius: 50%;
    background: #2a0505;
    box-shadow: inset 0 0 8px #000;
}
#lights .light.on { background: #ff1e1e; box-shadow: 0 0 18px #ff1e1e; }

#lap-times {
    margin-bottom: 10px;
    background: rgba(15, 23, 42, 0.85);
    border: 3px solid #fff;
    border-radius: 16px;
    padding: 8px 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
}
#lap-times span { display: inline-block; min-width: 90px; }
.t-purple { color: #c084fc; }
.t-green { color: #4ade80; }
.t-flash { animation: lapflash 1s ease-out 3; }
@keyframes lapflash { 50% { color: #fde047; } }

#leaderboard-list { font-variant-numeric: tabular-nums; }
#leaderboard-list li { display: flex; gap: 10px; }
#leaderboard-list .tt-name { flex: 1; }

#quali-results {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.75);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
}
#quali-results h2 { font-size: 2.5rem; letter-spacing: 3px; }
#quali-results-list {
    columns: 2;
    column-gap: 40px;
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;
}
#quali-results-list li { margin-bottom: 6px; break-inside: avoid; }
```

- [ ] **Step 3: socket.js handlers** — in `public/js/socket.js`:

Add to the `clientState` object (after `trackData`):

```js
    session: null,      // { phase, endsAt } — endsAt in local ms, null for open-ended
    qualiResults: null,
    lastTiming: null,
```

Delete the `socket.on('countdown', …)` handler. Add:

```js
socket.on('lights', ({ count }) => {
    if (window.handleLights) window.handleLights(count);
});

socket.on('session', ({ phase, endsInMs }) => {
    clientState.session = { phase, endsAt: endsInMs === null ? null : Date.now() + endsInMs };
});

socket.on('quali_results', (list) => {
    clientState.qualiResults = list;
    if (window.showQualiResults) window.showQualiResults(list);
});

socket.on('timing', (t) => {
    clientState.lastTiming = t;
    if (t.id === clientState.me) {
        const el = document.getElementById('lt-last');
        el.classList.remove('t-flash');
        void el.offsetWidth; // restart the animation
        el.classList.add('t-flash');
    }
});
```

In the `lobby_state_sync` handler's `if (state.status === 'LOBBY')` block, also add `clientState.session = null;`.

- [ ] **Step 4: app.js** — in `public/js/app.js`:

Replace `const setSpeed = document.getElementById('setting-speed');` with `const setQuali = document.getElementById('setting-quali');`.

Replace `emitSettings` and its listeners with:

```js
function emitSettings() {
    socket.emit('update_settings', {
        trackId: setTrack.value,
        maxLaps: parseInt(setLaps.value, 10),
        qualiMinutes: parseInt(setQuali.value, 10)
    });
}
setTrack.addEventListener('change', emitSettings);
setLaps.addEventListener('change', emitSettings);
setQuali.addEventListener('change', emitSettings);
```

In `window.updateSettingsUI` replace the `setSpeed` line with `setQuali.value = clientState.settings.qualiMinutes;`.

Replace `window.handleStatusChange` with:

```js
window.handleStatusChange = (status) => {
    const cdOverlay = document.getElementById('countdown-overlay');
    const spOverlay = document.getElementById('spectator-overlay');
    const results = document.getElementById('quali-results');
    const lights = document.getElementById('lights');

    if (status === 'LOBBY') {
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        [cdOverlay, spOverlay, results, lights].forEach(el => el.classList.add('hidden'));
        return;
    }

    const me = clientState.players[clientState.me];
    if (!me) return; // visitors who haven't joined stay in the lobby

    screenLobby.classList.add('hidden');
    screenGame.classList.remove('hidden');
    spOverlay.classList.toggle('hidden', !me.isSpectating);
    cdOverlay.classList.add('hidden');
    results.classList.toggle('hidden', status !== 'QUALI_RESULTS');

    if (status === 'COUNTDOWN') {
        lights.classList.remove('hidden');
        lights.querySelectorAll('.light').forEach(l => l.classList.remove('on'));
    } else if (status === 'FINISHED') {
        cdOverlay.classList.remove('hidden');
        document.getElementById('countdown-text').innerText = 'FINISH!';
    }
};
```

- [ ] **Step 5: game3d.js HUD + visuals** — in `public/js/game3d.js`:

In `makeCar`, change the traverse so every material is per-car (needed for ghost opacity) — replace the `model.traverse(...)` block with:

```js
        model.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.material = o.material.clone();
            if (o.material.name === 'livery') {
                o.material.map = map;
                o.material.color.set(0xffffff);
                o.material.needsUpdate = true;
            }
        });
```

and change the return to `return { root, wheels, teamId: lp.teamId, ghost: false };`.

In `updateCars`, after the wheel spin line, add:

```js
        car.wheels[0] && (car.wheels[0].rotation.y = s.steer || 0); // wheel_FL
        car.wheels[1] && (car.wheels[1].rotation.y = s.steer || 0); // wheel_FR
        const ghost = !!s.ghost && id !== clientState.me;
        if (ghost !== car.ghost) {
            car.ghost = ghost;
            car.root.traverse((o) => {
                if (!o.material || o.isSprite) return;
                o.material.transparent = ghost;
                o.material.opacity = ghost ? 0.5 : 1;
            });
        }
```

Replace the whole `// ---------- HUD + minimap ----------` section's `kmh`, `lapLabel` and `updateHUD` (keep `drawMinimap`) with:

```js
// ---------- HUD + minimap ----------
const kmh = (speed) => Math.round((Math.abs(speed) / scale) * 3.6);
const lapLabel = (lap) => Math.min(lap + 1, clientState.settings.maxLaps);
const $ = (id) => document.getElementById(id);

function fmtTime(s) {
    if (s === null || s === undefined) return '--';
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}
function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

window.handleLights = (count) => {
    const el = $('lights');
    el.classList.remove('hidden');
    el.querySelectorAll('.light').forEach((l, i) => l.classList.toggle('on', i < count));
    if (count === 0) setTimeout(() => el.classList.add('hidden'), 1500);
};

window.showQualiResults = (list) => {
    const ol = $('quali-results-list');
    ol.innerHTML = '';
    const pole = list[0]?.bestLap;
    for (const r of list) {
        const lp = clientState.players[r.id];
        const li = document.createElement('li');
        const gap = r.position > 1 && r.bestLap !== null && pole !== null ? `  +${(r.bestLap - pole).toFixed(3)}` : '';
        li.textContent = `P${r.position}  ${lp ? lp.username : '—'}  ${r.bestLap === null ? 'no time' : fmtTime(r.bestLap)}${gap}`;
        ol.appendChild(li);
    }
};

function updateHUD() {
    const gs = clientState.gameState;
    const me = gs[clientState.me];
    const racing = me && !isSpectator();
    const fastest = Math.min(...Object.values(gs).map(p => (p.bestLap === null ? Infinity : p.bestLap)));

    $('hud-total').innerText = Object.keys(gs).length;
    $('hud-rank').innerText = racing ? me.rank : '--';
    $('hud-lap').innerText = racing ? lapLabel(me.lap) : '--';
    $('hud-speed').innerText = racing ? kmh(me.speed) : '--';

    // Own lap times: purple = fastest overall, green = personal best
    $('lt-current').innerText = racing ? fmtTime(me.curLap) : '--';
    const lastEl = $('lt-last');
    lastEl.innerText = racing ? fmtTime(me.lastLap) : '--';
    lastEl.classList.toggle('t-purple', !!racing && me.lastLap !== null && me.lastLap === fastest);
    lastEl.classList.toggle('t-green', !!racing && me.lastLap !== null && me.lastLap === me.bestLap && me.lastLap !== fastest);
    $('lt-best').innerText = racing ? fmtTime(me.bestLap) : '--';

    // Session bar
    const sess = clientState.session;
    let bar = '';
    if (clientState.status === 'QUALIFYING' && sess) {
        bar = sess.phase === 'QUALI_FLAG' ? 'CHEQUERED FLAG' : `QUALIFYING ${fmtClock(sess.endsAt - Date.now())}`;
    } else if (clientState.status === 'RACE' || clientState.status === 'FINISHED') {
        const leader = Object.values(gs).find(p => p.rank === 1);
        const lap = racing ? me.lap : leader ? leader.lap : 0;
        bar = `LAP ${lapLabel(lap)}/${clientState.settings.maxLaps}`;
    }
    $('session-bar').textContent = bar;

    // Timing tower
    const quali = Object.values(gs).some(p => p.ghost);
    const ol = $('leaderboard-list');
    ol.innerHTML = '';
    Object.entries(gs).sort((a, b) => a[1].rank - b[1].rank).slice(0, 10).forEach(([id, p]) => {
        const lp = clientState.players[id];
        if (!lp) return;
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'tt-name';
        name.textContent = `${p.rank}. ${lp.username}`;
        const time = document.createElement('span');
        if (quali) {
            time.textContent = p.rank === 1 ? fmtTime(p.bestLap) : p.gap === null ? fmtTime(p.bestLap) : `+${p.gap.toFixed(3)}`;
            if (p.bestLap !== null && p.bestLap === fastest) time.className = 't-purple';
        } else if (p.finished && p.rank === 1) {
            time.textContent = 'WINNER';
        } else {
            time.textContent = p.rank === 1 ? 'LEADER' : p.lapsDown > 0 ? `+${p.lapsDown} L` : p.gap === null ? '' : `+${p.gap.toFixed(3)}`;
        }
        li.append(name, time);
        ol.appendChild(li);
    });
}
```

- [ ] **Step 6: Verify**

Run: `npm test 2>&1 | grep -E "ℹ (pass|fail)"` → PASS.
Start the server (`npm start`, background). In Chrome automation open `http://localhost:3232`, join, set Qualifying 1 min, start solo: expect session bar `QUALIFYING 0:59`, ghost-free own car, timing tower `1. NAME --`. `read_console_messages` pattern `error|LanRace` → none. Stop the server.

---

### Task 7: End-to-end verification

**Files:** none in the project (bot script lives in the session scratchpad).

- [ ] **Step 1: Full test run**

Run: `npm test 2>&1 | tail -8` → all pass; record the counts.

- [ ] **Step 2: Update the scratchpad bot** for analog input — replace the `s.emit('input', …)` line in `<scratchpad>/bots/bot.js` with:

```js
    const steer = Math.max(-1, Math.min(1, diff * 3));
    const tooFast = Math.abs(diff) > 0.35 && p.speed / track.scale > 40;
    s.emit('input', { throttle: tooFast ? 0 : 1, brake: tooFast ? 0.6 : 0, steer });
```

and in its `lobby_state_sync` host branch replace the `update_settings` call with:

```js
        s.emit('update_settings', { trackId: 'monza', maxLaps: Number(laps), qualiMinutes: 1 });
```

- [ ] **Step 3: Quali → results → lights → race at Monza**

Start the server; run two bots (`Max redbull 1 1`, `Lewis mercedes 0 1`); open the browser tab, join as Ferrari mid-quali (spectator).
Expected in bot logs: `status QUALIFYING` → (after ~60 s + laps in progress) `status QUALI_RESULTS` → `status COUNTDOWN` → `status RACE` → both finish → `status FINISHED`. In the browser: session bar counts down, cars are translucent ghosts in quali, results overlay lists both with lap times, lights gantry fills 1→5 and goes out, timing tower shows gaps in the race. Screenshots of quali, results, lights, race.

- [ ] **Step 4: Grid order matches qualifying**

From the `quali_results` order in the bot logs (add `s.on('quali_results', r => log('quali', JSON.stringify(r)))` to the bot), check the race `game_init` positions: P1 on `startPositions[0]`.

- [ ] **Step 5: Handling feel in the browser**

Solo race (qualifying off) in the browser tab, hold W: speed climbs past 300 km/h on the Monza main straight; tap S at 300 km/h: speed drops to ~80 km/h within ~2 s; steer with A/D: wheels turn visibly. Simulate a gamepad by stubbing `navigator.getGamepads = () => [{ axes: [0.5, 0], buttons: Object.assign(new Array(8).fill({ value: 0 }), { 7: { value: 1 } }) }]` in the console: car accelerates and turns right.

- [ ] **Step 6: Report** — test counts, screenshots, deviations, known limits (bot driving is crude; no tyre wear, DRS, penalties).
