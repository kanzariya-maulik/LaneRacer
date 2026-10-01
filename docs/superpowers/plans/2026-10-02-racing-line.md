# Racing Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An F1-game-style racing line on every track: a minimum-curvature path drawn as coloured chevrons (green flat out, yellow lift, red brake). The colours react to your own speed. Modes are Off, Corners only and Full, chosen in the lobby and stepped with R or gamepad X.

**Architecture:**
- **Server:** `src/game/RacingLine.js` computes the path (offsets from the centreline) and a speed/phase profile once per track in `Track.load`, so it reaches clients in `game_init` as `track.racingLine`.
- **Client:**
  - a pure module `public/js/racingline.js` holds the colour, mask, index and mode rules, tested in Node;
  - `game3d.js` builds one chevron mesh per world and recolours it at 15 Hz.
- The braking and steering assists are unchanged; the line is visual only.

**Tech Stack:** Node 24, `node:test`, Three.js 0.186 (importmap), Socket.IO payload.

**Spec:** `docs/superpowers/specs/2026-10-02-racing-line-design.md`

## Global Constraints

- Visual only: the braking and steering assists are unchanged. Target speeds are capped to `safeSpeed × 0.95` (Assist AIM). The backward pass brakes at `BRAKE_MARGIN` (0.7) × grip.
- Line clamp: `|offset| ≤ width/2 − 1.5 m·scale`. Near the closed pit entry (60 m before the closure point), pit side `≤ width/2 − 3 m·scale`.
- Modes: `off | corners | full`; lobby default `corners`; storage key `lanrace.line` via `window.lanraceMem` fallback.
- Toggle: R key, gamepad X (button 2), edge-triggered; ignored in the lobby and while typing in chat.
- Colours: base by phase beyond 250 m; within 250 m red if needed deceleration > 0.6·MU·g, yellow if > 0, else green.
- Draw cost: +1 draw call. Commits per task, no trailers, branch `feature/3d-f1`.

## Review Focus

1. Lap wrap: a corner just after the start line while the car is just before it must be "ahead", not 5 km away. Test in Task 3 (`aheadM`).
2. Track crossover (Suzuka figure-8): the car's track index must not jump to the other leg, or the colours flip. Test in Task 3 (`trackIndex`).
3. A corner mask run that wraps past index 0 must stay contiguous. Test in Task 3 (`cornerMask`).
4. Spectator / no own car: base colours, no crash. Test in Task 3 (`segmentColor` with null distance).
5. A track without pit data must still get a line. Test in Task 1.

---

### Task 1: Server — compute the racing line per track

**Files:**
- Create: `src/game/RacingLine.js`
- Modify: `src/game/Assist.js` (export `AIM`, `BRAKE_MARGIN`)
- Modify: `src/game/Track.js` (attach `racingLine` after the pit is built)
- Test: `test/racingLine.test.js`

**Interfaces:**
- Consumes:
  - `CarPhysics.C`;
  - `Assist.DOWN`, `Assist.MAX_SAFE`, `Assist.AIM`, `Assist.BRAKE_MARGIN`;
  - track fields `path`, `cum`, `scale`, `width`, `safeSpeed`, `startS`, `pit` (`path`, `cum`, `closeS`, or null).
- Produces:
  - `RacingLine.compute(track) → { offset: number[], speed: number[], phase: number[] }`: offset in world units, speed in m/s, phase 0 flat, 1 lift, 2 brake; one entry per path point;
  - `RacingLine.linePoints(path, offset) → {x,y}[]`;
  - `RacingLine.curvatures(points, scale) → number[]` (1/m);
  - `RacingLine.latMax(v) → m/s²`;
  - `RacingLine.profile(points, scale, cap) → { speed, phase, vmax, lap }`;
  - `track.racingLine` on every loaded track.

- [ ] **Step 1: Write the failing tests** — `test/racingLine.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const RL = require('../src/game/RacingLine');
const { AIM } = require('../src/game/Assist');

const tracks = Track.loadAll();
const idxAt = (t, s) => t.cum.findIndex((c) => c >= s);

for (const id of Track.TRACK_IDS) {
    test(`${id}: racing line stays on track, within grip and the assist's speeds`, () => {
        const t = tracks[id], rl = t.racingLine, n = t.path.length;
        assert.ok(rl && rl.offset.length === n && rl.speed.length === n && rl.phase.length === n);
        const lim = t.width / 2 - 1.5 * t.scale + 0.06; // + rounding
        rl.offset.forEach((o, i) => assert.ok(Math.abs(o) <= lim, `point ${i} offset ${o} past ${lim}`));
        const k = RL.curvatures(RL.linePoints(t.path, rl.offset), t.scale);
        rl.speed.forEach((v, i) => {
            assert.ok(v * v * k[i] <= RL.latMax(v) * 1.01 + 0.5, `point ${i}: ${v} m/s needs more grip than the car has`);
            assert.ok(v <= t.safeSpeed[i] * AIM + 0.06, `point ${i}: ${v} m/s faster than the braking assist allows`);
        });
        const centre = RL.profile(t.path, t.scale, t.safeSpeed.map((s) => s * AIM));
        const line = RL.profile(RL.linePoints(t.path, rl.offset), t.scale, t.safeSpeed.map((s) => s * AIM));
        assert.ok(line.lap <= centre.lap + 0.05, `line ${line.lap.toFixed(1)} s slower than centreline ${centre.lap.toFixed(1)} s`);
        assert.ok(rl.phase.includes(0) && rl.phase.includes(1) && rl.phase.includes(2), 'flat, lift and brake all present');
    });
}

for (const id of ['monza', 'spa']) {
    test(`${id}: a brake zone before the first slow corner`, () => {
        const t = tracks[id], n = t.path.length, s0 = idxAt(t, t.startS || 0);
        let m = s0;
        for (let k = 0; k < n; k++) {
            const i = (s0 + k) % n;
            if (((t.cum[i] - t.cum[s0] + t.cum[n]) % t.cum[n]) / t.scale > 1000) break;
            if (t.safeSpeed[i] < t.safeSpeed[m]) m = i;
        }
        let braking = false;
        for (let k = 1; k <= n; k++) {
            const i = (m - k + n) % n;
            if (((t.cum[m] - t.cum[i] + t.cum[n]) % t.cum[n]) / t.scale > 250) break;
            if (t.racingLine.phase[i] === 2) braking = true;
        }
        assert.ok(braking, `no brake zone in the 250 m before point ${m}`);
    });
}

test('pit side keeps clear of the closed pit entry', () => {
    for (const id of Track.TRACK_IDS) {
        const t = tracks[id];
        if (!t.pit) continue;
        const { side, idx } = RL.pitWindow(t);
        const lim = t.width / 2 - 3 * t.scale + 0.06;
        for (const i of idx) assert.ok(side * t.racingLine.offset[i] <= lim, `${id} point ${i} too close to the pit entry`);
    }
});

test('a track without pit data still gets a line', () => {
    const t = { ...tracks.monza, pit: null };
    const rl = RL.compute(t);
    assert.strictEqual(rl.offset.length, t.path.length);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/racingLine.test.js`
Expected: FAIL — `Cannot find module '../src/game/RacingLine'`.

- [ ] **Step 3: Export the assist constants** — in `src/game/Assist.js`, change the export line to:

```js
module.exports = { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN, safeSpeeds, brakeAssist };
```

- [ ] **Step 4: Implement** — create `src/game/RacingLine.js`:

```js
// Racing line: minimum-curvature path within the track edges, and the speed the car carries along it.
// Visual only: speeds are capped to what the Full braking assist allows, so the colours match what the car does.
const { C } = require('./CarPhysics');
const { DOWN, MAX_SAFE, AIM, BRAKE_MARGIN } = require('./Assist');

const PASSES = 2000;     // smoothing passes (prototype: ~50 ms per track; more passes don't make laps faster)
const MARGIN_M = 1.5;    // keep this far inside the track edge
const PIT_MARGIN_M = 3;  // ...and this far on the pit side before the closed pit entry
const PIT_RAMP_M = 60;   // matches Track.js CLOSE_RAMP_M

// Unit normals, same convention as offsetPoints in game3d.js: (x − ty·o, y + tx·o)
function normals(P) {
    const n = P.length;
    return P.map((_, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    });
}

function linePoints(P, offset) {
    const N = normals(P);
    return P.map((p, i) => ({ x: p.x + N[i].x * offset[i], y: p.y + N[i].y * offset[i] }));
}

// 1/R from the circle through points i−2, i, i+2 (metres)
function curvatures(L, scale) {
    const n = L.length;
    return L.map((_, i) => {
        const a = L[(i - 2 + n) % n], b = L[i], c = L[(i + 2) % n];
        const ab = Math.hypot(b.x - a.x, b.y - a.y) / scale, bc = Math.hypot(c.x - b.x, c.y - b.y) / scale, ca = Math.hypot(a.x - c.x, a.y - c.y) / scale;
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (scale * scale);
        return area2 > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0;
    });
}

// Cornering acceleration with the (always-on) steering assist's extra grip below 250 km/h
const assistK = (v) => Math.max(0, Math.min(1, (C.ASSIST_OFF_KMH - v * 3.6) / (C.ASSIST_OFF_KMH - C.ASSIST_FULL_KMH)));
const latMax = (v) => (1 + C.ASSIST_GRIP * assistK(v)) * C.LAT_ASSIST * C.MU * (C.G + DOWN * v * v);
const drag = (v) => (0.5 * C.RHO * C.CDA * v * v) / C.MASS + C.ROLL_G * C.G;

function cornerSpeed(k) {
    if (k * MAX_SAFE * MAX_SAFE <= latMax(MAX_SAFE)) return MAX_SAFE;
    let lo = 0, hi = MAX_SAFE;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (m * m * k <= latMax(m)) lo = m; else hi = m; }
    return lo;
}

// Speed along a line: corner limits, then forward (drive) and backward (brake) passes, twice round so the lap wraps
function profile(L, scale, cap) {
    const n = L.length, k = curvatures(L, scale);
    const vmax = k.map((x, i) => Math.min(cornerSpeed(x), cap ? cap[i] : Infinity));
    const v = vmax.slice();
    const ds = L.map((p, i) => Math.hypot(L[(i + 1) % n].x - p.x, L[(i + 1) % n].y - p.y) / scale);
    const rem = (i, vi) => Math.sqrt(Math.max(0, 1 - ((vi * vi * k[i]) / latMax(vi)) ** 2)); // friction circle
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, vi = v[i];
        const a = Math.min(C.POWER / (C.MASS * Math.max(vi, 1)), C.TRACTION * C.MU * (C.G + DOWN * vi * vi)) * rem(i, vi) - drag(vi);
        v[j] = Math.min(v[j], Math.sqrt(Math.max(0, vi * vi + 2 * a * ds[i])));
    }
    for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n, vj = v[j];
        const a = BRAKE_MARGIN * C.MU * (C.G + DOWN * vj * vj) * rem(j, vj) + drag(vj); // where the braking assist starts
        v[i] = Math.min(v[i], Math.sqrt(vj * vj + 2 * a * ds[i]));
    }
    const phase = v.map((vi, i) => {
        const drop = vi - v[(i + 1) % n];
        return drop > 1 ? 2 : vi >= 0.97 * vmax[i] || drop > 0 ? 1 : 0;
    });
    const lap = ds.reduce((s, d, i) => s + d / Math.max((v[i] + v[(i + 1) % n]) / 2, 0.1), 0);
    return { speed: v, phase, vmax, lap };
}

// Track points in the 60 m before the closed pit entry, and which offset sign faces the pit lane
function pitWindow(t) {
    const P = t.path, n = P.length, pit = t.pit, total = t.cum[n];
    let pk = 0;
    for (let k = 0; k < pit.path.length; k++) if (pit.cum[k] <= pit.closeS) pk = k;
    const q = pit.path[pk];
    let c = 0, best = Infinity;
    P.forEach((p, i) => { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < best) { best = d; c = i; } });
    const N = normals(P)[c];
    const side = Math.sign((q.x - P[c].x) * N.x + (q.y - P[c].y) * N.y) || 1;
    const idx = [];
    for (let k = -1; k < n; k++) {
        const i = (c - k + n) % n;
        if (((t.cum[c] - t.cum[i] + total) % total) / t.scale > PIT_RAMP_M) break;
        idx.push(i);
    }
    return { side, idx };
}

function compute(t) {
    const P = t.path, n = P.length, N = normals(P), lim = t.width / 2 - MARGIN_M * t.scale;
    const lo = new Array(n).fill(-lim), hi = new Array(n).fill(lim);
    if (t.pit) {
        const { side, idx } = pitWindow(t), pl = t.width / 2 - PIT_MARGIN_M * t.scale;
        for (const i of idx) { if (side > 0) hi[i] = Math.min(hi[i], pl); else lo[i] = Math.max(lo[i], -pl); }
    }
    // Minimum curvature: pull each point toward the 4th-order smooth of its neighbours, along its normal
    const o = new Array(n).fill(0);
    for (let pass = 0; pass < PASSES; pass++) {
        const L = P.map((p, i) => ({ x: p.x + N[i].x * o[i], y: p.y + N[i].y * o[i] }));
        for (let i = 0; i < n; i++) {
            const g = (d) => L[(i + d + n) % n];
            const tx = (-g(-2).x + 4 * g(-1).x + 4 * g(1).x - g(2).x) / 6, ty = (-g(-2).y + 4 * g(-1).y + 4 * g(1).y - g(2).y) / 6;
            const want = (tx - P[i].x) * N[i].x + (ty - P[i].y) * N[i].y;
            o[i] = Math.max(lo[i], Math.min(hi[i], o[i] + 0.5 * (want - o[i])));
        }
    }
    const offset = o.map((x) => Math.round(x * 10) / 10);
    const prof = profile(linePoints(P, offset), t.scale, t.safeSpeed.map((s) => s * AIM));
    return { offset, speed: prof.speed.map((v) => Math.floor(v * 10) / 10), phase: prof.phase };
}

module.exports = { compute, profile, linePoints, curvatures, latMax, pitWindow };
```

(`Math.floor` on speed keeps the rounded value under both caps.)

- [ ] **Step 5: Attach to every track** — in `src/game/Track.js`, add `const RacingLine = require('./RacingLine');` under the `Assist` require. Then in `build`, replace:

```js
    if (raw.pit) track.pit = buildPit(raw, circuit, track);
    return track;
```

with:

```js
    if (raw.pit) track.pit = buildPit(raw, circuit, track);
    track.racingLine = RacingLine.compute(track); // visual guide, sent to clients in game_init
    return track;
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/racingLine.test.js && npm test`
Expected: all pass (the prototype gave lines 4–7 s faster than the centreline, uncapped; capped they must be no slower).

- [ ] **Step 7: Commit**

```bash
git add src/game/RacingLine.js src/game/Assist.js src/game/Track.js test/racingLine.test.js
git commit -m "Compute a racing line and speed profile for every track"
```

---

### Task 2: The line is drivable with the game physics

**Files:**
- Test: `test/racingLine.test.js` (append)

**Interfaces:**
- Consumes: `track.racingLine` (Task 1), `RL.linePoints`, `RL.profile`, `Game`, `Physics.nearestOnTrack`.
- Produces: none (verification only).

- [ ] **Step 1: Write the test** — append:

```js
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');
const quietIo = { emit() {}, volatile: { emit() {} } };

for (const id of Track.TRACK_IDS) {
    test(`${id}: a car following the line at its speeds laps cleanly with Full assist`, () => {
        const t = tracks[id], n = t.path.length, sc = t.scale, rl = t.racingLine;
        const L = RL.linePoints(t.path, rl.offset);
        const lap = RL.profile(L, sc, t.safeSpeed.map((s) => s * AIM)).lap;
        const g = new Game(quietIo, [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 1, qualifying: false }, () => {});
        g.frozen = false;
        const p = g.players.a;
        let time = 0, walls = 0;
        while (time < 200 && !p.finished) {
            const i = Physics.nearestOnTrack(p.x, p.y, t).i, aim = L[(i + 3) % n];
            let d = Math.atan2(aim.y - p.y, aim.x - p.x) - p.angle;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            const v = p.speed / sc, target = rl.speed[(i + 1) % n];
            p.input = { steer: Math.max(-1, Math.min(1, d * 3)), throttle: v < target ? 1 : 0, brake: v > target + 1 ? 1 : 0 };
            const v0 = p.speed;
            g.update();
            time += g.dt;
            if (v0 / sc > 15 && p.speed < v0 * 0.7) walls++;
        }
        assert.ok(p.finished, `${id}: no lap in 200 s`);
        assert.strictEqual(walls, 0, `${id}: ${walls} wall hits`);
        assert.ok(time <= lap + 8, `${id}: ${time.toFixed(1)} s vs profile ${lap.toFixed(1)} s`);
    });
}
```

- [ ] **Step 2: Run it**

Run: `node --test test/racingLine.test.js`
Expected: PASS. The prototype ran Monza 85.6 s against a profile of 79.5 s, Spa 99.7/95.3, Silverstone 88.7/84.3, Suzuka 86.8/81.4 and Sakhir 92.9/87.0, with 0 walls. A failure here means Task 1 drifted from the prototype. Debug before relaxing the limit.

- [ ] **Step 3: Commit**

```bash
git add test/racingLine.test.js
git commit -m "Prove the racing line is drivable on every track"
```

---

### Task 3: Client rules — colours, corner mask, index, modes

**Files:**
- Create: `public/js/racingline.js`
- Test: `test/racingline.client.test.js`

**Interfaces:**
- Consumes: none.
- Produces (ES module):
  - `MODES = ['off','corners','full']`, `NEAR_M = 250`;
  - `segmentColor(phase, targetMs, mySpeedMs, distAheadM|null) → 'green'|'yellow'|'red'`;
  - `cornerMask(phase, cum, scale) → boolean[]`;
  - `aheadM(cum, from, to, scale) → metres`;
  - `trackIndex(path, x, y, last|null) → index`;
  - `nextMode(mode) → mode`.

- [ ] **Step 1: Write the failing tests** — `test/racingline.client.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');

let R;
before(async () => { R = await import('../public/js/racingline.js'); });
const ring = (n, step = 10) => { const cum = []; for (let i = 0; i <= n; i++) cum.push(i * step); return cum; };

test('segmentColor: base colours far ahead or without a car', () => {
    assert.strictEqual(R.segmentColor(0, 80, 80, null), 'green');
    assert.strictEqual(R.segmentColor(1, 60, 80, null), 'yellow');
    assert.strictEqual(R.segmentColor(2, 30, 80, 400), 'red');
});

test('segmentColor: too fast turns red earlier, slow is green', () => {
    // 80 m/s toward a 30 m/s corner: 200 m out needs 13.75 m/s² (> 0.6·1.6·9.81 ≈ 9.42) → red
    assert.strictEqual(R.segmentColor(2, 30, 80, 200), 'red');
    // the same corner 240 m out at 60 m/s needs 5.6 m/s² → yellow
    assert.strictEqual(R.segmentColor(2, 30, 60, 240), 'yellow');
    // already slower than the target → green, even in a brake zone
    assert.strictEqual(R.segmentColor(2, 30, 25, 50), 'green');
});

test('aheadM wraps across the start line', () => {
    const cum = ring(100); // 1000 m lap
    assert.strictEqual(R.aheadM(cum, 98, 3, 1), 50);
    assert.strictEqual(R.aheadM(cum, 3, 98, 1), 950);
});

test('cornerMask covers 30 m before and 50 m after a lift/brake run, also across index 0', () => {
    const n = 100, cum = ring(n), phase = new Array(n).fill(0);
    phase[0] = 2; phase[1] = 1;  // corner straddling the start line
    phase[50] = 2;
    const m = R.cornerMask(phase, cum, 1);
    for (const i of [97, 98, 99, 0, 1, 2, 6]) assert.ok(m[i], `point ${i} should show`);
    assert.ok(!m[96] && !m[7], 'beyond 30 m before / 50 m after');
    assert.ok(m[47] && m[55] && !m[46] && !m[56]);
    assert.ok(!m[25], 'straight stays hidden');
});

test('trackIndex stays on its own leg where the track crosses itself', () => {
    // figure-8 at 2 m spacing: leg 1 and leg 3 both pass (50, 0)
    const path = [];
    for (let i = 0; i <= 50; i++) path.push({ x: i * 2, y: 0 });             // 0..50, (50,0) is index 25
    for (let i = 1; i <= 50; i++) path.push({ x: 100, y: i * 2 });           // 51..100
    for (let i = 1; i <= 100; i++) path.push({ x: 100 - i, y: 100 - 2 * i }); // 101..200, (50,0) is index 150
    for (let i = 1; i <= 49; i++) path.push({ x: 0, y: -100 + i * 2 });      // 201..249, back toward the start
    assert.strictEqual(R.trackIndex(path, 50.5, 0, 24), 25, 'kept on the first leg');
    assert.strictEqual(R.trackIndex(path, 50.5, 0, 148), 150, 'kept on the second leg');
    assert.strictEqual(R.trackIndex(path, 100.5, 0.2, null), 50, 'full search without history');
});

test('nextMode cycles off → corners → full → off', () => {
    assert.strictEqual(R.nextMode('off'), 'corners');
    assert.strictEqual(R.nextMode('corners'), 'full');
    assert.strictEqual(R.nextMode('full'), 'off');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/racingline.client.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `public/js/racingline.js`:

```js
// Racing line rules on the client. Pure, shared by game3d.js and the node tests.
export const MODES = ['off', 'corners', 'full'];
export const NEAR_M = 250;                 // segments this close ahead react to your speed
const RED_DECEL = 0.6 * 1.6 * 9.81;        // m/s²: more than this to make the corner = brake now (CarPhysics MU 1.6)
const BASE = ['green', 'yellow', 'red'];   // by phase: flat, lift, brake
const BEFORE_M = 30, AFTER_M = 50;         // corners-only: shown around each lift/brake run
const SEARCH_BACK = 5, SEARCH_AHEAD = 30;  // points searched around the last index

export function segmentColor(phase, target, mySpeed, distAhead) {
    if (distAhead === null || distAhead === undefined || distAhead > NEAR_M) return BASE[phase];
    const need = (mySpeed * mySpeed - target * target) / (2 * Math.max(distAhead, 1));
    return need > RED_DECEL ? 'red' : need > 0 ? 'yellow' : 'green';
}

// Metres along the lap from point `from` forward to point `to`
export function aheadM(cum, from, to, scale) {
    const total = cum[cum.length - 1];
    return ((((cum[to] - cum[from]) % total) + total) % total) / scale;
}

export function cornerMask(phase, cum, scale) {
    const n = phase.length, mark = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
        if (phase[i] === 0) continue;
        for (let k = 0; k < n; k++) { const j = (i - k + n) % n; if (aheadM(cum, j, i, scale) > BEFORE_M) break; mark[j] = true; }
        for (let k = 0; k < n; k++) { const j = (i + k) % n; if (aheadM(cum, i, j, scale) > AFTER_M) break; mark[j] = true; }
    }
    return mark;
}

// Nearest path point, searched near the last one so a crossover can't jump to the other leg
export function trackIndex(path, x, y, last) {
    const n = path.length;
    const from = last === null || last === undefined ? 0 : last - SEARCH_BACK;
    const count = last === null || last === undefined ? n : SEARCH_BACK + SEARCH_AHEAD + 1;
    let best = 0, bd = Infinity;
    for (let k = 0; k < count; k++) {
        const i = (((from + k) % n) + n) % n, d = (path[i].x - x) ** 2 + (path[i].y - y) ** 2;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

export function nextMode(mode) {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/racingline.client.test.js && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add public/js/racingline.js test/racingline.client.test.js
git commit -m "Add racing line colour, corner mask, index and mode rules"
```

---

### Task 4: Draw the line, recolour it, lobby option and R / X toggle

**Files:**
- Modify: `public/js/game3d.js` (import; state; `buildRacingLine`, `applyLineMode`, `colourLine`, `toggleLine`; hooks in `buildWorld`, `onKey`, `pollInput`, the HUD block of `frame`)
- Modify: `public/index.html` (lobby select)
- Modify: `public/js/app.js` (select handler)

**Interfaces:**
- Consumes:
  - Task 1 `track.racingLine`;
  - Task 3 `MODES`, `segmentColor`, `cornerMask`, `aheadM`, `trackIndex`, `nextMode`;
  - existing `store`, `world`, `scale`, `isSpectator()`, `window.showBanner`, `clientState`.
- Produces: none for later tasks.

- [ ] **Step 1: Import and state** — in `game3d.js`, under the `timing.js` import:

```js
import { MODES, segmentColor, cornerMask, aheadM, trackIndex, nextMode } from './racingline.js';
```

Below `let towerMode …` and `toggleTower` add:

```js
// Racing line: one chevron mesh per world, recoloured with the HUD
let line = null, lineIdx = null, padX = false;
const lineChoice = () => { const v = store.get('lanrace.line'); return MODES.includes(v) ? v : 'corners'; };
let lineMode = lineChoice();
function toggleLine() {
    lineMode = nextMode(lineMode);
    applyLineMode();
    colourLine();
    window.showBanner?.(`RACING LINE: ${lineMode.toUpperCase()}`, true);
}
```

`store` is declared earlier in the file, near the renderer. If `lineChoice()` runs before `store` exists, move these lines below `store`.

- [ ] **Step 2: Key and pad** — in `onKey`, next to the T line:

```js
    if (down && key === 'r' && !e.repeat && clientState.status !== 'LOBBY') toggleLine();
```

In `pollInput`, after `const pad = …`:

```js
    const x = !!pads.find(Boolean)?.buttons[2]?.pressed; // gamepad X / Square
    if (x && !padX && clientState.status !== 'LOBBY') toggleLine();
    padX = x;
```

- [ ] **Step 3: Build, show and colour** — add these functions after `buildWorld`:

```js
const LINE_RGB = { green: new THREE.Color('#22c55e'), yellow: new THREE.Color('#facc15'), red: new THREE.Color('#ef4444') };

function buildRacingLine(t) {
    line = null;
    lineIdx = null;
    lineMode = lineChoice(); // each session starts from the lobby choice
    const rl = t.racingLine;
    if (!rl) return;
    const P = t.path, n = P.length, w = 0.5 * scale, y = 0.75;
    const L = P.map((p, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: p.x - ((b.y - a.y) / len) * rl.offset[i], y: p.y + ((b.x - a.x) / len) * rl.offset[i] };
    });
    // One chevron per segment, pointing along the lap: 4 triangles = 12 vertices
    const pos = new Float32Array(n * 36);
    for (let i = 0; i < n; i++) {
        const a = L[i], b = L[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
        const at = (f, s) => ({ x: a.x + tx * len * f - ty * w * s, y: a.y + ty * len * f + tx * w * s });
        const BL = at(0, 1), BR = at(0, -1), NOTCH = at(0.35, 0), FL = at(0.6, 1), FR = at(0.6, -1), TIP = at(0.95, 0);
        [BL, FL, NOTCH, FL, TIP, NOTCH, TIP, FR, NOTCH, FR, BR, NOTCH].forEach((p, v) => {
            const k = i * 36 + v * 3;
            pos[k] = p.x; pos[k + 1] = y; pos[k + 2] = p.y;
        });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 36), 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 1;        // over the tyre marks
    mesh.frustumCulled = false;  // hidden segments collapse to the origin, so the bounds are meaningless
    world.add(mesh);
    line = { mesh, full: pos, mask: cornerMask(rl.phase, t.cum, scale), rl, n };
    applyLineMode();
    colourLine();
}

// Corners-only hides segments by collapsing them; rewritten only when the mode changes
function applyLineMode() {
    if (!line) return;
    const p = line.mesh.geometry.attributes.position;
    for (let i = 0; i < line.n; i++) {
        const show = lineMode === 'full' || (lineMode === 'corners' && line.mask[i]);
        for (let k = i * 36; k < i * 36 + 36; k++) p.array[k] = show ? line.full[k] : 0;
    }
    p.needsUpdate = true;
}

// Base colours by phase; within 250 m ahead, from your own speed
function colourLine() {
    if (!line) return;
    const gs = clientState.gameState, me = gs && gs[clientState.me], racing = !!me && !isSpectator();
    line.mesh.visible = lineMode !== 'off' && !(racing && me.inPit);
    if (!line.mesh.visible) return;
    const t = clientState.trackData, rl = line.rl, c = line.mesh.geometry.attributes.color;
    let from = null, v = 0;
    if (racing) {
        lineIdx = trackIndex(t.path, me.x, me.y, lineIdx);
        from = lineIdx;
        v = Math.abs(me.speed) / scale;
    }
    for (let i = 0; i < line.n; i++) {
        const col = LINE_RGB[segmentColor(rl.phase[i], rl.speed[i], v, from === null ? null : aheadM(t.cum, from, i, scale))];
        for (let k = i * 36; k < i * 36 + 36; k += 3) { c.array[k] = col.r; c.array[k + 1] = col.g; c.array[k + 2] = col.b; }
    }
    c.needsUpdate = true;
}
```

In `buildWorld`, right after the two "Thin dark outer edge" kerb strips:

```js
    buildRacingLine(t);
```

In `frame`, inside the `if (now - lastHud > 66)` block, after `drawMinimap();`:

```js
        colourLine();
```

- [ ] **Step 4: Lobby option** — in `public/index.html`, after the Graphics `</label>`:

```html
                    <label class="graphics-picker">Racing line:
                        <select id="line-select">
                            <option value="off">Off</option>
                            <option value="corners" selected>Corners only</option>
                            <option value="full">Full</option>
                        </select>
                        <small>R / gamepad X during a race</small>
                    </label>
```

In `public/js/app.js`, after the graphics handler:

```js
const lineSelect = document.getElementById('line-select');
try { lineSelect.value = localStorage.getItem('lanrace.line') || 'corners'; } catch (e) { /* storage blocked: default */ }
if (!lineSelect.value) lineSelect.value = 'corners';
lineSelect.addEventListener('change', () => {
    (window.lanraceMem ||= {})['lanrace.line'] = lineSelect.value; // applies even when storage is blocked
    try { localStorage.setItem('lanrace.line', lineSelect.value); } catch (e) { /* not remembered */ }
});
```

- [ ] **Step 5: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/app.js && npm test`
Expected: no syntax errors; all tests pass.

Headless (`scratchpad/cdp/shot.mjs`, `?stats=1`, solo race, Medium):
- Monza and Spa in each of Off, Corners and Full: set `lanrace.line` through `PRE`.
- **Expected:**
  - Full shows chevrons the whole lap;
  - Corners shows them only around braking zones;
  - Off shows none;
  - draw calls rise by exactly 1 over Off;
  - 60 fps;
  - no console exceptions.
- R key (`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))`) shows the "RACING LINE: …" banner and switches mode.
- Take one screenshot near a braking zone (Monza turn 1) to confirm the red chevrons before the chicane.

- [ ] **Step 6: Commit**

```bash
git add public/js/game3d.js public/index.html public/js/app.js
git commit -m "Draw the racing line with speed-reactive colours, lobby option and R / X toggle"
```
