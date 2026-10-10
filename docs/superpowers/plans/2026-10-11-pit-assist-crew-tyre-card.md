# Pit Assist, Real Pit Crew & Tyre Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game drives every pit stop from the entry line into the box and out to the limiter end, with a 17-person crew at every stopping car, recessed garages, pit-wall stands, a TV pit camera, a one-button "perfect release", and a separate, simple tyre card.

**Architecture:** A stateless `pitAssist(p, t)` in the shared sim (`public/js/sim/drive.js`) drives the car in two new stop phases (`lane`, `out`), alongside the existing `guideToBox`; `Game.updateStop` becomes a phase machine (`lane → guide → service → hold → out`, quali `wait`) with release timing and stop time. Client placement stays in the pure `public/js/pitLayout.js` (node-tested); `game3d.js` draws garages, stands, marks, crews, the TV camera and the tyre card.

**Tech Stack:** Node.js (`node:test`), browser ES modules, three.js r186, Socket.IO.

**Spec:** `docs/superpowers/specs/2026-10-11-pit-assist-crew-tyre-card-design.md`

## Global Constraints

- Stop phases and packet codes: `guide` 1, `service` 2, `hold` 3, `lane` 4, `out` 5, `wait` 6 (quali car parked on its mark waiting for throttle). `predict.js` decodes `['', 'guide', 'service', 'hold', 'lane', 'out', 'wait']`.
- Driver inputs are ignored in every stop phase; `driveCar` drives `lane`/`out` with `pitAssist`, `guide` with `guideToBox`, and keeps `service`/`hold`/`wait` parked.
- `lane` hands over to `guide` at 12 m (along the lane) before the box, at ≤ 15 km/h. Guide timeout 6 s → `out` without service. `out` ends (`stop = null`) at `pitS ≥ pit.limEnd` (or when the car leaves the lane).
- Release: green at the end of service; throttle ≥ 0.5 within 0.2 s of green = `perfect`; no press → leaves 0.5 s after green (`auto`); a later press before 0.5 s leaves then (`auto`); throttle ≥ 0.5 during the last 1 s of service = `jumped`, +0.5 s before release. Unsafe-release hold (moving car within 10 m behind, ≤ 0.5 s) kept.
- Stop time = leaving `hold` − entering `service`; `p.lastStop = { s, release }` (meta, `s` to 0.01) and chat `PIT: <name> 2.41 s (perfect release)`.
- Quali: cars start in `wait`; after a quali stop the car returns to `wait`; throttle ≥ 0.5 in `wait` → `out`. `setNextCompound` "parked" = quali and `stop.phase === 'wait'`.
- Crew: 17 figures (gun/off/on ×4 wheels, jackF, jackR, stabL, stabR, lollipop), ≤ 200 triangles each, one instanced mesh per crew, ≤ 4 crews, shown for any car from pit entry until it leaves the lane.
- Tyre card: separate `#tyre-card` on the left; collapsed = circle + wear ring + `NEXT: X` / `NEXT: X (auto)`; open = three ≥ 44 px buttons; same `pickerOpen` rule (quali parked = `wait`); spectators see no card.
- Colours: S `#e10600`, M `#ffd12e`, H `#f2f2f2`; working-lane concrete `#8a8f96`.
- Never start/stop/touch a server on port 3232; browser checks use 3299 with a visible tab.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A car entering the pit lane at racing speed (≈ 250 km/h at the mouth) must still be slowed, kept off the pit wall and parked — pinned in Task 1 (entry at 70 m/s on every circuit).
2. A driver holding full throttle and steering the whole stop must not change what the assist does — pinned in Task 1 (input-ignored test).
3. Tests that drive cars along the pit lane for geometry/limiter checks must not be hijacked by the assist — pinned in Task 2 (those tests set `p.box = null`, assist needs a box).
4. Two cars stopping at neighbouring boxes at once must both be serviced and released (unsafe-release hold ≤ 0.5 s) — pinned in Task 2.
5. Spectators / late joiners must get no tyre card, no crew errors — pinned in Task 7 (`cardText`/visibility) and Task 8 (browser).

---

### Task 1: `pitAssist` in the shared sim

**Files:**
- Modify: `public/js/sim/drive.js` (new exports after `canStopOnMark`; `driveCar` stop branch at the top)
- Test: `test/pitassist.test.js` (new)

**Interfaces:**
- Produces: `ASSIST_HANDOVER_M = 12`, `ASSIST_ARRIVE_MS = 15 / 3.6`, `pointOnPath(pit, s)` → `{ x, y, angle }`, `pitAssist(p, t)` → `{ throttle, brake, steer, drs: false }`; `driveCar` drives phases `lane`/`out` with `pitAssist`, `guide` with `guideToBox`, parks `service`/`hold`/`wait`.

- [ ] **Step 1: Write the failing tests** — create `test/pitassist.test.js`:

```js
// Pit assist (drive.js): the game drives the car along the pit lane — in to its box, out to the limiter end
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');

let D;
before(async () => { D = await import('../public/js/sim/drive.js'); });
const io = { emit() {}, volatile: { emit() {} } };
const tracks = Track.loadAll();

function car(t, s, speedMs, phase) {
    const g = new Game(io, [{ id: 'a', username: 'a', teamId: 'ferrari', assist: '100,100' }], t, { maxLaps: 3, qualifying: false, rng: () => 0.5 }, () => {});
    const p = g.players.a, q = D.pointOnPath(t.pit, s), v = speedMs * t.scale;
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v, stop: { phase, t: 0, age: 0 } });
    return { g, p };
}
const tick = (p, t, input = { throttle: 0, brake: 0, steer: 0, drs: false }) => D.driveCar(p, input, t, 1 / 60);

for (const id of Track.TRACK_IDS) {
    test(`${id}: lane — from the pit mouth at 70 m/s to 12 m before the box at walking pace, never hitting a wall`, () => {
        const t = tracks[id], sc = t.scale, { p } = car(t, 5 * sc, 70, 'lane');
        let hits = 0, k = 0;
        for (; k < 60 * 90 && p.box.s - (p.pitS ?? 0) > D.ASSIST_HANDOVER_M * sc; k++) {
            const v0 = Math.hypot(p.vx, p.vy);
            tick(p, t);
            if (v0 / sc > 5 && Math.hypot(p.vx, p.vy) < v0 * 0.7) hits++;
        }
        assert.ok(k < 60 * 90, 'never reached the box');
        assert.strictEqual(hits, 0, `${hits} wall hits`);
        assert.ok(p.inPit, 'left the lane');
        assert.ok(Math.hypot(p.vx, p.vy) / sc <= D.ASSIST_ARRIVE_MS + 0.5, `${(Math.hypot(p.vx, p.vy) / sc).toFixed(1)} m/s at the hand-over`);
    });

    test(`${id}: out — from the box at rest to the limiter end, moving, inside the lane`, () => {
        const t = tracks[id], sc = t.scale, pit = t.pit, { p } = car(t, 0, 0, 'out');
        Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle });
        let k = 0, hits = 0;
        for (; k < 60 * 60 && (p.pitS ?? 0) < pit.limEnd; k++) {
            const v0 = Math.hypot(p.vx, p.vy);
            tick(p, t);
            if (v0 / sc > 5 && Math.hypot(p.vx, p.vy) < v0 * 0.7) hits++;
        }
        assert.ok(k < 60 * 60, 'never reached the limiter end');
        assert.strictEqual(hits, 0);
        assert.ok(p.inPit);
        const limit = (pit.limitKmh || D.PIT_LIMIT_KMH) / 3.6;
        assert.ok(Math.hypot(p.vx, p.vy) / sc > 0.8 * limit, 'crawling at the hand-back');
    });
}

test('the assist ignores the driver: full throttle and full lock change nothing', () => {
    const t = tracks.monza, sc = t.scale, a = car(t, 5 * sc, 40, 'lane').p, b = car(t, 5 * sc, 40, 'lane').p;
    for (let k = 0; k < 600; k++) { tick(a, t); tick(b, t, { throttle: 1, brake: 0, steer: 1, drs: true }); }
    assert.deepStrictEqual([b.x, b.y, b.angle], [a.x, a.y, a.angle]);
});

test('parked phases stay still whatever the driver does', () => {
    const t = tracks.monza;
    for (const phase of ['service', 'hold', 'wait']) {
        const { p } = car(t, 0, 0, phase);
        Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle });
        for (let k = 0; k < 60; k++) tick(p, t, { throttle: 1, brake: 0, steer: 1, drs: false });
        assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 1e-6, `${phase} moved`);
    }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/pitassist.test.js`
Expected: FAIL — `D.pointOnPath is not a function`.

- [ ] **Step 3: Implement** — in `public/js/sim/drive.js`, after `canStopOnMark`:

```js
// Pit assist (Game.updateStop phases 'lane' and 'out'): along the pit lane's centre line at up to the limiter speed. 'lane'
// slows to ASSIST_ARRIVE_MS by ASSIST_HANDOVER_M before the box (guideToBox parks from there); 'out' runs to the limiter
// end. Stateless — steering and speed from the car and the track alone, so the client predictor makes the same choice
export const ASSIST_HANDOVER_M = 12, ASSIST_ARRIVE_MS = 15 / 3.6;
const ASSIST_DEC = 7;          // m/s² planned braking (the car manages ~15)
const ASSIST_LOOK_S = 0.35, ASSIST_LOOK_MIN_M = 8;

// The lane centre this far along it (world units), carried straight on past the exit tip
export function pointOnPath(pit, s) {
    const P = pit.path, c = pit.cum, n = P.length;
    if (s >= c[n - 1]) {
        const a = P[n - 2], b = P[n - 1], ang = Math.atan2(b.y - a.y, b.x - a.x), over = s - c[n - 1];
        return { x: b.x + Math.cos(ang) * over, y: b.y + Math.sin(ang) * over, angle: ang };
    }
    let i = 0;
    while (i < n - 2 && c[i + 1] < s) i++;
    const a = P[i], b = P[i + 1], f = c[i + 1] > c[i] ? Math.max(0, (s - c[i]) / (c[i + 1] - c[i])) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export function pitAssist(p, t) {
    const pit = t.pit, sc = t.scale, v = p.speed / sc, s = p.pitS ?? 0;
    // Steering: pure pursuit onto the lane centre a moment ahead (pulls a car out of its box, too)
    const aim = pointOnPath(pit, s + Math.max(ASSIST_LOOK_MIN_M, ASSIST_LOOK_S * Math.abs(v)) * sc);
    const dx = (aim.x - p.x) / sc, dy = (aim.y - p.y) / sc, ld = Math.max(1, Math.hypot(dx, dy));
    const err = Math.atan2(Math.sin(Math.atan2(dy, dx) - p.angle), Math.cos(Math.atan2(dy, dx) - p.angle));
    const k = (2 * Math.sin(err)) / ld; // 1/m
    const lock = (1 + C.ASSIST_STEER * parseAssist(p.assist).steer) * C.MAX_STEER, lockNow = lock / (1 + Math.abs(v) / C.STEER_FADE);
    const steer = Math.max(-1, Math.min(1, Math.atan(k * C.WHEELBASE) / lockNow));
    // Speed: the limiter, slowed for the pit-entry board and (arriving) for the box
    const limit = (pit.limitKmh || PIT_LIMIT_KMH) / 3.6;
    let want = limit;
    if (s < pit.limStart) want = Math.max(limit, Math.sqrt(limit * limit + 2 * ASSIST_DEC * (pit.limStart - s) / sc));
    if (p.stop?.phase === 'lane') {
        const toGo = Math.max(0, (p.box.s - s) / sc - ASSIST_HANDOVER_M);
        want = Math.min(want, Math.sqrt(ASSIST_ARRIVE_MS * ASSIST_ARRIVE_MS + 2 * ASSIST_DEC * toGo));
    }
    const more = want - v;
    return { steer, throttle: Math.max(0, Math.min(1, more * 0.5)), brake: Math.max(0, Math.min(1, -more * 0.5)), drs: false };
}
```

Replace the stop branch at the top of `driveCar`:

```js
    // Pit stop (Game.updateStop): the game drives — along the lane (pitAssist), onto the mark (guideToBox), parked
    // while the tyres change or a quali car waits; the driver's input is ignored throughout
    const phase = p.stop?.phase;
    if (phase === 'service' || phase === 'hold' || phase === 'wait') {
        p.vx = p.vy = p.speed = 0; p.steer = 0;
        return Physics.nearestOnTrack(p.x, p.y, t, p.roadI);
    }
    if (phase && p.box) input = phase === 'guide' ? guideToBox(p, t) : pitAssist(p, t);
```

(Check the steering sign against `guideToBox`'s mapping, which uses the same `atan(k·WHEELBASE)/lockNow`; if the car turns away from the lane, flip `k`'s sign and say so in the report. The guided-reverse clamp stays as it is.) If an entry speed of 70 m/s at the mouth cannot be slowed before the first bend of a connector on some circuit, raise `ASSIST_DEC` up to 10 or start braking from the track before the mouth only if needed — report the numbers; don't weaken the tests.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pitassist.test.js` → PASS; `node --check public/js/sim/drive.js`. Then `npm test` — existing pit-stop tests may now fail because `lane`/`out` phases don't exist on the server yet; they are rewritten in Task 2. Record which fail and why; everything else must pass.

- [ ] **Step 5: Commit**

```bash
git add public/js/sim/drive.js test/pitassist.test.js
git commit -m "Pit assist in the shared sim: along the lane to the box, and out to the limiter end"
```

---

### Task 2: Server stop phases, release and stop time

**Files:**
- Modify: `src/game/Game.js` (constants ~lines 30–37, player init ~line 85, `updateStop` ~162, `setNextCompound`)
- Modify: `public/js/predict.js:38` (phase decode)
- Modify: `test/pitstop.test.js` (rewrite the stop tests), plus any test that drives in the pit lane for geometry/limiter reasons (`test/game.test.js`, `test/drive.test.js`)
- Test: `test/pitstop.test.js`

**Interfaces:**
- Consumes: `Drive.ASSIST_HANDOVER_M`, `pitAssist` via `driveCar` (Task 1).
- Produces: phases `lane | guide | service | hold | out | wait` in `p.stop.phase` and packet codes per Global Constraints; `p.lastStop = { s, release: 'perfect' | 'auto' | 'jumped' }` in META_FIELDS.

- [ ] **Step 1: Rewrite the stop tests** — in `test/pitstop.test.js`, delete every test whose setup relies on the driver braking to start a guide, on `canStopOnMark` gating, on `stopRetry`, or on the old "drive-through without braking" rule (keep the tyre-compound, penalty, unsafe-release, meta and `setNextCompound` tests, adapting them below). Add a helper and the new tests:

```js
// From just inside the pit mouth at racing speed, no driver input: the game does the rest
function enterPit(t, g, p, speedMs = 60, atM = 5) {
    const q = pitPoint(t, atM * t.scale), v = speedMs * t.scale;
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v });
    p.input = { throttle: 0, brake: 0, steer: 0, drs: false };
}
function runStop(t, g, p, onTick = () => {}) {
    const phases = [], sc = t.scale;
    let still = 0, k = 0;
    for (; k < 60 * 120; k++) {
        onTick(k);
        g.update();
        const ph = p.stop?.phase || null;
        if (phases[phases.length - 1] !== ph) phases.push(ph);
        if (ph === 'service') still++;
        if (ph === null && phases.includes('out')) break;
    }
    return { phases, still: still / 60, ticks: k };
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: pit assist — entry to the limiter end with no driver input: parked, serviced, handed back`, () => {
        const t = Track.load(id), sc = t.scale, g = start(t, [lp('a', 'ferrari')]), p = g.players.a;
        g.setNextCompound('a', 'H');
        enterPit(t, g, p);
        let parked = null;
        const r = runStop(t, g, p, () => { if (p.stop?.phase === 'service' && !parked) parked = Math.hypot(p.x - p.box.x, p.y - p.box.y); });
        assert.deepStrictEqual(r.phases.filter((x) => x), ['lane', 'guide', 'service', 'hold', 'out']);
        assert.ok(parked !== null && parked < 0.6 * sc, `parked ${(parked / sc).toFixed(2)} m off the mark`);
        assert.ok(r.still >= 2.5 && r.still <= 2.95, `${r.still.toFixed(2)} s stationary`);
        assert.strictEqual(p.compound, 'H');
        assert.strictEqual(p.stops, 1);
        assert.ok(p.pitS >= t.pit.limEnd - 1 * sc && p.inPit, 'handed back at the limiter end, in the lane');
        assert.ok(p.lastStop && p.lastStop.release === 'auto' && p.lastStop.s >= 3.0 && p.lastStop.s <= 3.5, JSON.stringify(p.lastStop));
    });
}

test('pit assist: the same circuit, the same pit-lane time (fair)', () => {
    const t = Track.load('spa'), times = [];
    for (let n = 0; n < 3; n++) {
        const g = start(t, [lp('a', 'ferrari')], { ...RACE, rng: () => 0 }), p = g.players.a;
        enterPit(t, g, p, 50 + n * 10);
        times.push(runStop(t, g, p).ticks / 60);
    }
    assert.ok(Math.max(...times) - Math.min(...times) <= 0.5, times.join(', '));
});

test('drive-through: a car that has already stopped this lap is driven straight through', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    p.servicedLap = p.lap;
    enterPit(t, g, p);
    const r = runStop(t, g, p);
    assert.deepStrictEqual(r.phases.filter((x) => x), ['out']);
    assert.strictEqual(p.stops, 0);
});

test('release: perfect within 0.2 s of green, auto at 0.5 s, jumped +0.5 s', () => {
    const t = Track.load('monza');
    const go = (pressAt) => {
        const g = start(t, [lp('a')]), p = g.players.a;
        enterPit(t, g, p);
        let greenAt = null, outAt = null, clock = 0;
        runStop(t, g, p, () => {
            clock += g.dt;
            if (p.stop?.phase === 'hold' && greenAt === null) greenAt = clock;
            if (p.stop?.phase === 'out' && outAt === null) outAt = clock;
            const svc = p.stop?.phase === 'service';
            p.input = { throttle: pressAt === 'early' ? (svc && p.stop.t < 0.8 ? 1 : 0) : greenAt !== null && clock - greenAt >= pressAt ? 1 : 0, brake: 0, steer: 0, drs: false };
        });
        return { wait: outAt - greenAt, release: p.lastStop.release };
    };
    const perfect = go(0.1), auto = go(Infinity), jumped = go('early');
    assert.strictEqual(perfect.release, 'perfect'); assert.ok(perfect.wait <= 0.15, `perfect left after ${perfect.wait}`);
    assert.strictEqual(auto.release, 'auto'); assert.ok(Math.abs(auto.wait - 0.5) <= 2 / 60, `auto left after ${auto.wait}`);
    assert.strictEqual(jumped.release, 'jumped'); assert.ok(jumped.wait >= 0.5 - 1 / 60, `jumped left after ${jumped.wait}`);
});

test('quali: starts waiting on its mark; stays until throttle; then driven out', () => {
    const t = Track.load('monaco'), g = new Game(io, [lp('a')], t, QUALI, () => {}, 'quali'), p = g.players.a;
    assert.strictEqual(p.stop?.phase, 'wait');
    p.input = { throttle: 0, brake: 0, steer: 0, drs: false };
    for (let k = 0; k < 180; k++) g.update();
    assert.strictEqual(p.stop?.phase, 'wait');
    assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.01 * t.scale);
    p.input = { throttle: 1, brake: 0, steer: 0, drs: false };
    const r = runStop(t, g, p);
    assert.deepStrictEqual(r.phases.filter((x) => x), ['out']); // the first tick with throttle leaves 'wait'
    assert.ok(p.pitS >= t.pit.limEnd - 1 * t.scale);
});

test('guide timeout: an unreachable mark falls back to the drive out, no service', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    enterPit(t, g, p);
    const r = runStop(t, g, p, () => { if (p.stop?.phase === 'guide' && !p.box.moved) { p.box = { ...p.box, x: p.box.x + 40 * t.scale, moved: true }; } });
    assert.ok(r.phases.includes('guide') && !r.phases.includes('service') && r.phases.includes('out'), r.phases.join(','));
    assert.strictEqual(p.stops, 0);
});

test('two cars stopping at neighbouring boxes are both serviced and released', () => {
    const t = Track.load('monza'), g = start(t, [lp('a', 'ferrari'), lp('b', 'ferrari')]), a = g.players.a, b = g.players.b;
    enterPit(t, g, a, 60, 25); enterPit(t, g, b, 60, 5); // b 20 m behind a
    for (let k = 0; k < 60 * 120 && !(a.stops && b.stops && !a.stop && !b.stop); k++) g.update();
    assert.strictEqual(a.stops, 1); assert.strictEqual(b.stops, 1);
});
```

Adapt the existing unsafe-release test to the new phases (the car must be in `hold`; a moving car 7 m behind delays release by ≤ 0.5 s; 14 m behind or stationary → no delay). Adapt the existing `setNextCompound` quali tests: "parked in the box" is now `stop.phase === 'wait'`; the "stopped off the mark" case becomes `p.stop = null` with the car moved 4 m (driving, not parked). For tests in `test/game.test.js` / `test/drive.test.js` that drive cars along the pit lane to check geometry, walls or the limiter (not stops), set `p.box = null` after constructing the Game, with the comment `// no box: pit assist off (this test drives the lane itself)`.

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/pitstop.test.js`
Expected: FAIL — no `lane`/`out` phases, no `lastStop`, quali cars start with `stop = null`.

- [ ] **Step 3: Implement** — in `src/game/Game.js`:

Constants (replace the `STOP_TRIGGER_M…` and `STOP_CODE` lines):

```js
const STOP_S = 2.5, STOP_SPREAD_S = 0.4, RELEASE_HOLD_S = 0.5, RELEASE_GAP_M = 10, PARK_M = 0.5, PARK_MS = 0.3;
const RELEASE_AUTO_S = 0.5, PERFECT_S = 0.2, JUMP_WINDOW_S = 1, JUMP_PENALTY_S = 0.5, RELEASE_THROTTLE = 0.5;
const GUIDE_MAX_S = 6; // not parked by then: the car is driven out without a service (never stranded)
const STOP_CODE = { guide: 1, service: 2, hold: 3, lane: 4, out: 5, wait: 6 };
```

Add `'lastStop'` to `META_FIELDS`. In the player init replace `stop: null` with `stop: mode === 'quali' && boxes ? { phase: 'wait', t: 0, age: 0 } : null` and add `lastStop: null`; remove `stopRetry`.

`setNextCompound`: replace the `parked` line with `const parked = this.mode === 'quali' && p.stop?.phase === 'wait';`.

Replace `updateStop` with:

```js
    // Pit assist: entering the lane hands the car to the game (drive.js) — along the lane, onto the mark, serviced, then out to
    // the end of the limiter zone. Quali cars wait on their mark for the throttle. Driver inputs are ignored (driveCar)
    updateStop(p) {
        const t = this.track, sc = t.scale;
        if (!t.pit || !p.box || p.finished) return;
        const entered = p.inPit && !p.wasInPit;
        if (entered) p.pitVisits++;
        p.wasInPit = p.inPit;
        const thr = (p.input.throttle || 0) >= RELEASE_THROTTLE;
        const go = (phase, extra = {}) => { p.stop = { phase, t: 0, age: 0, ...extra }; };
        if (!p.stop) {
            if (!entered) return;
            const due = this.mode === 'quali' ? p.servicedVisit !== p.pitVisits : p.servicedLap !== p.lap;
            return go(due ? 'lane' : 'out');
        }
        const st = p.stop;
        st.age += this.dt;
        if (st.phase === 'wait') { if (thr) go('out'); return; }
        if (st.phase === 'lane') { if (p.box.s - p.pitS <= Drive.ASSIST_HANDOVER_M * sc) go('guide'); return; }
        if (st.phase === 'guide') {
            if (Math.hypot(p.x - p.box.x, p.y - p.box.y) < PARK_M * sc && Math.hypot(p.vx, p.vy) < PARK_MS * sc) go('service', { t: STOP_S + this.rng() * STOP_SPREAD_S, parkedAt: this.clock });
            else if (st.age > GUIDE_MAX_S) go('out');
            return;
        }
        if (st.phase === 'service') {
            st.t -= this.dt;
            if (thr && st.t <= JUMP_WINDOW_S) st.jumped = true;
            if (st.t > 0) return;
            this.serviceTyres(p);
            if (this.mode === 'quali') { this.recordStop(p, st.parkedAt, 'auto'); return go('wait'); }
            return go('hold', { parkedAt: st.parkedAt, greenAt: this.clock, jumped: !!st.jumped, unsafe: 0 });
        }
        if (st.phase === 'hold') {
            // Unsafe release: a moving car in the lane just behind the box holds us (at most RELEASE_HOLD_S)
            const busy = Object.values(this.players).some((q) => q !== p && q.inPit && Math.hypot(q.vx, q.vy) > sc
                && q.pitS < p.box.s && p.box.s - q.pitS < RELEASE_GAP_M * sc);
            if (busy && st.unsafe < RELEASE_HOLD_S) { st.unsafe += this.dt; st.greenAt += this.dt; return; }
            const since = this.clock - st.greenAt - (st.jumped ? JUMP_PENALTY_S : 0);
            if (since < 0) return;
            const pressed = thr && !st.jumped;
            if (!pressed && since < RELEASE_AUTO_S) return;
            this.recordStop(p, st.parkedAt, st.jumped ? 'jumped' : pressed && since <= PERFECT_S ? 'perfect' : 'auto');
            return go('out');
        }
        if (st.phase === 'out' && (p.pitS >= t.pit.limEnd || !p.inPit)) p.stop = null;
    }

    // Stop time: parked on the mark to leaving the box; on the HUD (meta) and in chat
    recordStop(p, parkedAt, release) {
        p.lastStop = { s: Math.round((this.clock - parkedAt) * 100) / 100, release };
        const how = release === 'perfect' ? ' (perfect release)' : release === 'jumped' ? ' (jumped the release)' : '';
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#22c55e', msg: `PIT: ${p.username} ${p.lastStop.s.toFixed(2)} s${how}` });
    }
```

Remove the now-unused `STOP_TRIGGER_M`, `STOP_SLOW_KMH`, `STOP_BRAKE` and every `stopRetry` reference; keep `finishCar`'s `p.stop = null` lines. In `public/js/predict.js:38` change the decode array to `['', 'guide', 'service', 'hold', 'lane', 'out', 'wait']`. If the meta diff needs `lastStop` compared by value (it's an object), follow how `compoundsUsed` (an array) is compared.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pitstop.test.js test/pitassist.test.js` → PASS. Then `npm test` → PASS (fix tests hijacked by the assist with `p.box = null` as above; list them in the report).

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js public/js/predict.js test/
git commit -m "Pit stop phases with full pit assist, perfect/auto/jumped release and stop times"
```

---

### Task 3: Layout for wheel marks, the 17-person crew, pit-wall stands, tyre card text

**Files:**
- Modify: `public/js/pitLayout.js` (add exports; remove `boxCue` and `visitDone`, which the assist makes obsolete)
- Test: `test/pitLayout.client.test.js`

**Interfaces:**
- Produces: `tMarks(box, scale)` → `[{ x, y, angle }]` ×4; `crew17(box, scale, trackSide)` → `[{ role, idle: { x, y }, work: { x, y }, angle }]` ×17; `wallStands(t)` → `[{ teamId, x, y, angle }]`; `cardText({ compound, next, fitted })` → `{ next: string, confirm: string | null }`. Roles: `gunFL gunFR gunRL gunRR offFL offFR offRL offRR onFL onFR onRL onRR jackF jackR stabL stabR lollipop`.

- [ ] **Step 1: Tests** — in `test/pitLayout.client.test.js` delete the `boxCue` and `visitDone` tests and add:

```js
const roles17 = ['gunFL', 'gunFR', 'gunRL', 'gunRR', 'offFL', 'offFR', 'offRL', 'offRR', 'onFL', 'onFR', 'onRL', 'onRR', 'jackF', 'jackR', 'stabL', 'stabR', 'lollipop'];
for (const id of Track.TRACK_IDS) {
    test(`${id}: wheel marks in every box, a 17-strong crew inside the lane, a wall stand per garage`, () => {
        const t = tracks[id], lay = L.pitLayout(t), sc = t.scale;
        for (const b of lay.boxes) {
            const marks = L.tMarks(b, sc);
            assert.strictEqual(marks.length, 4);
            for (const m of marks) assert.ok(Math.hypot(m.x - b.x, m.y - b.y) / sc < Math.hypot(L.BOX_M.len, L.BOX_M.wide) / 2, 'mark outside its box');
            const crew = L.crew17(b, sc, t.pit.trackSide);
            assert.deepStrictEqual(crew.map((c) => c.role).sort(), [...roles17].sort());
            for (const c of crew) for (const at of [c.idle, c.work]) assert.ok(Math.abs(lateral(t, at)) <= 5 + 0.05, `${c.role} outside the lane`);
            // Waiting crew stand clear of the car's way in and out (2.2 m corridor along the box)
            for (const c of crew) {
                const dx = (c.idle.x - b.x) / sc, dy = (c.idle.y - b.y) / sc, l = -dx * Math.sin(b.angle) + dy * Math.cos(b.angle);
                assert.ok(Math.abs(l) >= 1.1, `${c.role} idles in the car's path`);
            }
        }
        const standing = lay.garages.filter((g) => !g.skip).length;
        assert.strictEqual(L.wallStands(t).length, standing);
    });
}

test('cardText: next set, auto, confirmations', () => {
    assert.deepStrictEqual(L.cardText({ compound: 'M', next: 'S', fitted: false }), { next: 'NEXT: S', confirm: '✓ SOFT ON NEXT STOP' });
    assert.deepStrictEqual(L.cardText({ compound: 'M', next: null, fitted: false }), { next: 'NEXT: H (auto)', confirm: null });
    assert.deepStrictEqual(L.cardText({ compound: 'H', next: null, fitted: false }), { next: 'NEXT: M (auto)', confirm: null });
    assert.deepStrictEqual(L.cardText({ compound: 'S', next: null, fitted: true }), { next: 'NEXT: M (auto)', confirm: '✓ SOFT FITTED' });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/pitLayout.client.test.js` → FAIL (`L.tMarks is not a function`).

- [ ] **Step 3: Implement** — in `public/js/pitLayout.js` delete `boxCue` and `visitDone` (and their now-unused constants), import `nextHarder` with `import { nextHarder } from './sim/tyres.js';` and add:

```js
// Box frame helper: a metres along the box heading, l metres to its left
const at = (box, a, l, scale) => side(ahead(box, box.angle, a * scale), box.angle, l * scale);

// Four white T marks where the wheels stop (car centre on the box, wheelbase ±1.8 m, track ±0.8 m)
export function tMarks(box, scale) {
    return [[1.8, 0.8], [1.8, -0.8], [-1.8, 0.8], [-1.8, -0.8]].map(([a, l]) => ({ ...at(box, a, l, scale), angle: box.angle }));
}

// The pit crew around a box: idle = waiting clear of the car's way (|l| ≥ 1.1 m), work = where they stand during the change.
// g: the garage side (+1 = the box's left). Wheel men by wheel; jacks idle at the garage-side corners and step onto the car's
// centre line to lift it; the lollipop man waits beside the nose with his board over the stopping point
export function crew17(box, scale, trackSide) {
    const g = -trackSide, wheels = { FL: [1.8, 1], FR: [1.8, -1], RL: [-1.8, 1], RR: [-1.8, -1] }, out = [];
    for (const [w, [a, sgn]] of Object.entries(wheels)) {
        out.push({ role: `gun${w}`, idle: [a, sgn * 1.8], work: [a, sgn * 1.35] });
        out.push({ role: `off${w}`, idle: [a + 0.8, sgn * 2.2], work: [a + 0.6, sgn * 1.7] });
        out.push({ role: `on${w}`, idle: [a - 0.8, sgn * 2.2], work: [a - 0.6, sgn * 1.7] });
    }
    out.push({ role: 'jackF', idle: [3.6, g * 1.6], work: [3.1, 0] }, { role: 'jackR', idle: [-3.6, g * 1.6], work: [-3.1, 0] },
        { role: 'stabL', idle: [0.2, 2.0], work: [0.2, 1.3] }, { role: 'stabR', idle: [0.2, -2.0], work: [0.2, -1.3] },
        { role: 'lollipop', idle: [4.6, g * 1.6], work: [4.6, g * 1.6] });
    return out.map((c) => {
        const idle = at(box, c.idle[0], c.idle[1], scale), work = at(box, c.work[0], c.work[1], scale);
        return { role: c.role, idle, work, angle: Math.atan2(box.y - work.y, box.x - work.x) };
    });
}
```

Wheel men on the fast-lane side: if any idle/work spot falls outside the lane (|lateral| > 5 m) on some circuit, reduce that side's lateral offsets (not below 1.1 m idle) and report it.

```js
// One team stand per standing garage, on the lane side of the pit wall opposite it
export function wallStands(t) {
    const pit = t.pit, wall = pit.wall, sc = t.scale, out = [];
    for (const g of pitLayout(t).garages) {
        if (g.skip) continue;
        let best = null;
        for (let i = 0; i < wall.length - 1; i++) {
            const a = wall[i], b = wall[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
            const u = Math.max(0, Math.min(1, ((g.x - a.x) * dx + (g.y - a.y) * dy) / l2));
            const q = { x: a.x + u * dx, y: a.y + u * dy }, d = Math.hypot(g.x - q.x, g.y - q.y);
            if (!best || d < best.d) best = { d, q, angle: Math.atan2(dy, dx) };
        }
        if (!best) continue;
        const toLane = side(best.q, best.angle, -pit.trackSide * 1.2 * sc); // the garages' side of the wall is the lane's
        out.push({ teamId: g.teamId, x: toLane.x, y: toLane.y, angle: best.angle });
    }
    return out;
}

const NAMES = { S: 'SOFT', M: 'MEDIUM', H: 'HARD' };
// The tyre card's two lines: what the next stop fits, and a confirmation once something is chosen or fitted
export function cardText({ compound, next, fitted }) {
    const n = next ? `NEXT: ${next}` : `NEXT: ${nextHarder(compound)} (auto)`;
    const confirm = fitted ? `✓ ${NAMES[compound]} FITTED` : next ? `✓ ${NAMES[next]} ON NEXT STOP` : null;
    return { next: n, confirm };
}
```

Check `pit.wall`'s shape in `src/game/Track.js` (array of `{x, y}` points); if the lane side of the wall is `+trackSide`, flip the sign and assert in a test that each stand is closer to `pit.path` than its wall point. Remove the game3d.js imports/uses of `boxCue`/`visitDone` only in Task 5 (leave game3d.js compiling: if removing them here breaks `node --check`, keep thin deprecated wrappers until Task 5 and say so).

- [ ] **Step 4: Run** `node --test test/pitLayout.client.test.js` → PASS; `node --check public/js/game3d.js`; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/pitLayout.js test/pitLayout.client.test.js
git commit -m "Pit layout: wheel T-marks, a 17-person crew, pit-wall stands and tyre card text"
```

---

### Task 4: Recessed garages, concrete working lane, T-marks, pit-wall stands

**Files:**
- Modify: `public/js/game3d.js` (`buildPit` garage/box block)

**Interfaces:**
- Consumes: `pitLayout`, `tMarks`, `wallStands`, `BOX_M` (Task 3 / earlier).

- [ ] **Step 1: Working lane** — after the lane split/edge strips, add the concrete working lane on the garage-side half over the garage span (`onSpan` already exists):

```js
    const wFrom = half.map((h) => (s > 0 ? -(h - 2 * line) : line / 2)), wTo = half.map((h) => (s > 0 ? -line / 2 : h - 2 * line));
    world.add(strip(pit.path, wFrom, wTo, 0.6, onSpan, solid('#8a8f96')));
```

(garage side is `-s`: for `s > 0` that's negative offsets; keep `from < to`.)

- [ ] **Step 2: Recessed bays** — replace the `shells`, `doors`, `lit` pieces with one merged bay geometry (back wall + two side walls + roof, open toward the lane), a floor, a lit back panel and tyre stacks, all instanced per standing garage. Garage-local frame: x along the lane (18 m), z away from the lane (the bay is 5 m deep from the front line), y up:

```js
    const bayGeo = mergeGeometries([
        new THREE.BoxGeometry(18 * scale, 6 * scale, 0.4 * scale).translate(0, 3 * scale, 4.8 * scale),          // back wall
        new THREE.BoxGeometry(0.4 * scale, 6 * scale, 5 * scale).translate(-8.8 * scale, 3 * scale, 2.5 * scale), // side walls
        new THREE.BoxGeometry(0.4 * scale, 6 * scale, 5 * scale).translate(8.8 * scale, 3 * scale, 2.5 * scale),
        new THREE.BoxGeometry(18 * scale, 0.4 * scale, 5 * scale).translate(0, 6 * scale, 2.5 * scale),           // roof
    ]);
    const floorGeo = new THREE.BoxGeometry(17.2 * scale, 0.05 * scale, 4.6 * scale).translate(0, 0.03 * scale, 2.5 * scale);
    const panelGeo = new THREE.PlaneGeometry(16 * scale, 4.5 * scale).translate(0, 2.6 * scale, 0).rotateY(Math.PI).translate(0, 0, 4.55 * scale);
    const stackGeo = new THREE.CylinderGeometry(0.33 * scale, 0.33 * scale, 1.2 * scale, 10).translate(0, 0.6 * scale, 0);
```

Place each with its origin at the garage front point (`g.front`), rotated so local +z points away from the lane (toward the garage side) — derive the rotation from `g.angle` and `s` and check both trackSide signs on paper (the lit panel must face the lane). Tyre stacks: 6 per garage along the back (x = −6…+6 m, z = 3.8 m). Materials: bay `0x2b2f36`, floor `0xb9bec4`, panel unlit team colour (instance colour), stacks `0x151515`. Keep the team sign and canopy at the same front line.

- [ ] **Step 3: T-marks and stands**

```js
    const tGeo = mergeGeometries([bar(0.12 * scale, 0.7 * scale, 0, 0), bar(0.5 * scale, 0.12 * scale, 0.3 * scale, 0)]);
    add(tGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), lay.boxes.flatMap((b) => tMarks(b, scale).map((m) => ({ x: m.x, y: 0.84 + pitY(m.x, m.y), z: m.y, angle: -m.angle }))));
    const standGeo = mergeGeometries([
        new THREE.BoxGeometry(4 * scale, 1.1 * scale, 1.6 * scale).translate(0, 0.55 * scale, 0),     // desk
        new THREE.BoxGeometry(4.6 * scale, 0.15 * scale, 2.2 * scale).translate(0, 2.6 * scale, 0),   // roof
        new THREE.BoxGeometry(0.12 * scale, 2.6 * scale, 0.12 * scale).translate(-2.1 * scale, 1.3 * scale, 0),
        new THREE.BoxGeometry(0.12 * scale, 2.6 * scale, 0.12 * scale).translate(2.1 * scale, 1.3 * scale, 0),
    ]);
    add(standGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), wallStands(t).map((w) => ({ x: w.x, y: pitY(w.x, w.y), z: w.y, angle: -w.angle, color: teamInfo[w.teamId]?.chatColor || '#888888' })));
```

(`bar` is the helper already used for the outlines; hoist it if it's local.) Old shells/doors/lit lists and meshes are deleted.

- [ ] **Step 4: Verify** — `node --check public/js/game3d.js && npm test` → OK, PASS. Count meshes added by `buildPit` before/after and report (target: no more than +4 over the previous branch).

- [ ] **Step 5: Commit**

```bash
git add public/js/game3d.js
git commit -m "Pit lane: recessed lit garages with tyre stacks, concrete working lane, wheel T-marks, team pit-wall stands"
```

---

### Task 5: The pit crew at every stopping car

**Files:**
- Modify: `public/js/game3d.js` (replace the own-box crew/board/countdown block; record other cars' stop phase from the fast packet)
- Modify: `public/index.html`, `public/css/style.css` (remove `#box-cue`)

**Interfaces:**
- Consumes: `crew17` (Task 3); stop phases (Task 2); `predictor.car.stop` for your car; each car's `box` from `clientState.gameState[id].box`.

- [ ] **Step 1: Other cars' stop phase** — where `applyNet` reads each car's packet entry for interpolation, store the stop phase on the game-state player: `gs[id].stopPhase = STOP_PHASES[entry[12]] || null` with `const STOP_PHASES = ['', 'guide', 'service', 'hold', 'lane', 'out', 'wait'];` (find how entries are decoded — `netsync.js` may drop index 12; if so, carry it through the same way `wear`/index 11 is, and add a test in the existing netsync tests that the phase code survives). For your own car use `predictor.car.stop?.phase`.

- [ ] **Step 2: Human figure** — build once:

```js
function humanGeometry() {
    const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w * scale, h * scale, d * scale).translate(x * scale, y * scale, z * scale);
    const head = new THREE.SphereGeometry(0.15 * scale, 8, 6).translate(0, 1.68 * scale, 0);
    return mergeGeometries([box(0.14, 0.8, 0.16, -0.1, 0.4, 0), box(0.14, 0.8, 0.16, 0.1, 0.4, 0), // legs
        box(0.42, 0.62, 0.24, 0, 1.12, 0), box(0.11, 0.6, 0.12, -0.28, 1.12, 0.05), box(0.11, 0.6, 0.12, 0.28, 1.12, 0.05), head]); // torso, arms, helmet
}
```

- [ ] **Step 3: Crew slots** — up to 4 crews, each `{ id, mesh: InstancedMesh(humanGeometry, MeshStandardMaterial({ color: team }), 17), tyres: InstancedMesh(torus, dark, 8), board: { group, brake, go } }`, created lazily, reused (recolour on reassignment). Each frame:
  - candidates = cars (yours + others) with a box that are in the pit lane (`inPit`) or have a stop phase; assign/keep slots by car id, free slots of cars that left the lane; hide unused slots.
  - per crew, with `spots = crew17(box, scale, pit.trackSide)` cached per box: position = `idle` in `lane`/`guide`/`wait`/`out`/none; `work` during `service`; during `hold` jacks back at `idle`, others at `work`; at release (phase becomes `out`) everyone eases to `idle` stepped 0.5 m further to the garage side over 0.6 s. Interpolate positions toward the target at 6 /s so moves look smooth (reuse vectors; no per-frame allocation).
  - tyres: 4 old tyres at the wheels until mid-service then moved 1 m outward with the off-men; 4 new tyres with the on-men, then at the wheels; new tyres' band colour = the car's compound colour (`COMPOUND_COLORS`).
  - car lift: during `service` add `0.08 * scale` to that car's rendered body height (after its pose is set this frame).
  - lollipop board per crew (move today's own-box board code into the crew slot): red BRAKE face toward the arriving car until `service`, lowered (tilted) during `service`, green GO for 1 s after release.
- Keep your box's pulsing outline and BOX sign (approach + lane). Delete the countdown (`#box-cue` element, CSS, `missedUntil`, `visitIsDone`, `cueCanStop`, the `boxCue`/`visitDone` imports) and the old own-box crew/tyres code.

- [ ] **Step 4: Verify** — `node --check public/js/game3d.js && npm test` → OK, PASS; `grep -n "box-cue\|boxCue\|visitDone\|missedUntil" public` → no hits.

- [ ] **Step 5: Commit**

```bash
git add public/js/game3d.js public/index.html public/css/style.css public/js/netsync.js test/
git commit -m "A 17-person pit crew with jacks, tyres and lollipop at every stopping car"
```

---

### Task 6: TV pit camera and pit HUD

**Files:**
- Modify: `public/js/game3d.js` (`updateCamera` ~line 1673; HUD tick), `public/index.html`, `public/css/style.css`

**Interfaces:**
- Consumes: `predictor.car.stop`, `predictor.box`, meta `me.lastStop` (Task 2), `side`/`facing` helpers.

- [ ] **Step 1: Camera** — in `updateCamera`, when your car's stop phase is `service`, `hold` or `wait`, target the camera at `side(box, box.angle, -pit.trackSide * 9 * scale)` raised `2 * scale` above `pitY`, looking at the car; blend from the chase camera with `k = 1 − exp(−dt·3)` toward the pit-cam pose and back the same way once the phase is `out`/none. Store the blend in a module variable; reset it on a new session.

- [ ] **Step 2: HUD** — add `<div id="pit-banner" class="hidden"></div>` near `#box-msg` (big, centred, top 22%):
  - when your stop phase becomes `lane` or `out` from none: "PIT ASSIST" for 1.5 s;
  - when `me.lastStop` changes: "PIT STOP 2.41 s" plus a second line "PERFECT RELEASE −0.3 s" (release `perfect`), "JUMPED +0.5 s" (`jumped`), nothing for `auto`, for 3 s;
  - when your stop phase goes from `out` to none: "YOUR CAR" for 1.2 s.
  Keep `#box-msg` for "BOX — 2.4 s" during service and "GO" at release (green = press throttle now). Change-detected writes only.

- [ ] **Step 3: Verify** — `node --check public/js/game3d.js && npm test` → OK, PASS.

- [ ] **Step 4: Commit**

```bash
git add public/js/game3d.js public/index.html public/css/style.css
git commit -m "TV pit camera and pit HUD: PIT ASSIST, stop time with release rating, YOUR CAR"
```

---

### Task 7: The tyre card

**Files:**
- Modify: `public/index.html` (remove the picker from the cluster and `#tyre-picker-big`; add `#tyre-card`), `public/css/style.css`, `public/js/game3d.js` (picker code → card code)

**Interfaces:**
- Consumes: `pickerOpen`, `cardText`, `COMPOUND_COLORS` from `./pitLayout.js`; meta `compound`, `nextCompound`; predicted `wear`; your stop phase (`wait` = quali parked).
- Produces: `pickTyre(c)` unchanged (keys 1/2/3 and clicks).

- [ ] **Step 1: Markup** — delete the `.cl-tyre`/`#tyre-picker` block from the cluster and `#tyre-picker-big`; add inside `#hud`:

```html
<div id="tyre-card" class="hidden">
    <div class="tc-head"><div id="tc-tyre" class="tc-tyre tyre-M"><span>M</span></div><div><b id="tc-wear">100 %</b><small id="tc-next">NEXT: H (auto)</small></div></div>
    <div id="tc-pick" class="hidden">
        <div class="tc-title">PICK YOUR TYRES</div>
        <button type="button" class="tc-btn tyre-S" data-c="S"><b>1</b> SOFT <small>fastest · wears quickly</small></button>
        <button type="button" class="tc-btn tyre-M" data-c="M"><b>2</b> MEDIUM <small>balanced</small></button>
        <button type="button" class="tc-btn tyre-H" data-c="H"><b>3</b> HARD <small>slowest · lasts longest</small></button>
        <div id="tc-confirm" class="hidden"></div>
    </div>
</div>
```

- [ ] **Step 2: CSS** — `#tyre-card { position: absolute; left: 16px; top: 46%; pointer-events: auto; background: rgba(0,0,0,0.6); border-radius: 10px; padding: 10px 12px; color: #fff; min-width: 120px; }`; `.tc-tyre` a 44 px circle, border 5px in the compound colour, letter centred, with a conic-gradient ring for wear (`--wear` custom property, red below 20 %); `.tc-btn` full width, min-height 44px, left border 6px in its compound colour, `.tc-btn.on` filled with its compound colour and dark text; `#tc-confirm` green text. Remove the old `.tp*`, `#tyre-picker*`, `#tyre-next` rules (grep for leftovers).

- [ ] **Step 3: Card logic** — replace the picker HUD block: compute `open` with `pickerOpen` (quali `parked` = your stop phase `wait`), `fitted` = (status `COUNTDOWN` or phase `wait`) and the last pick equals the fitted compound; `cardText` for the lines; wear ring from predicted wear; show `#tyre-card` unless spectator; `#tc-pick` only when `open`; `.on` on the chosen next set (or the fitted one when `fitted`). Click handler on `#tc-pick` (delegate to `.tc-btn`, `blur()` the button, `pickTyre`). Change-detected DOM writes only (a key of compound, next, open, fitted, wear rounded to 1 %).

- [ ] **Step 4: Verify** — `node --check public/js/game3d.js && npm test` → OK, PASS; `grep -n "tyre-picker\|tyre-next\|\.tp\b\|tp-row" public` → no hits.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/css/style.css public/js/game3d.js
git commit -m "Tyre card: tyre and wear on its own, three big buttons when it's time to choose"
```

---

### Task 8: Real-game check

**Files:** none unless a defect is found (fix in the owning file, add a test where one fits).

- [ ] **Step 1:** Start `PORT=3299 node server.js` in the background; the Chrome tab must be visible and the extension connected (ask the user if not). Hard-refresh.
- [ ] **Step 2: Race at Monza.** Enter the pits at speed with no input: "PIT ASSIST", the car drives in and parks; the crew of 17 works (jacks lift, tyres off/on in the new colour); TV pit camera; press throttle at GO → "PIT STOP x.xx s / PERFECT RELEASE"; driven to the limiter end → "YOUR CAR". Enter again the same lap → driven through.
- [ ] **Step 3: Look.** Recessed lit garages with tyre stacks, concrete working lane, T-marks, pit-wall stands, no flicker; a rival's stop shows its own crew.
- [ ] **Step 4: Tyre card.** Collapsed (tyre, wear %, NEXT … (auto)); open 500 m before the pits, on the grid and in the quali garage; buttons work by key and click; confirmations.
- [ ] **Step 5: Quali at Monaco.** Waits in the box (camera on the car, card open) until throttle; then driven out.
- [ ] **Step 6:** Frame rate with crews visible within 10 % of the previous branch; console clean as driver, spectator and late joiner. Stop the 3299 server; report with screenshots.
