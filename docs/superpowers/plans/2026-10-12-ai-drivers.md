# AI Drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host setting that fills every free grid seat with AI drivers at Easy / Medium / Hard / Pro, which qualify, race wheel to wheel, make mistakes and run a tyre/pit strategy.

**Architecture:** Bots are ordinary cars inside the server's `Game`. Each tick, before the shared physics runs, `Game.updateBots()` calls `strategy.tick` (box calls, compounds, quali exits, release presses) and then `driver.drive`, which writes the car's `p.input`. Everything else (physics, pit assist, rules, penalties, netcode) is unchanged. The roster lives in `socketManager` as `state.bots`, separate from the human lobby players, and the client learns bot names from `game_init`.

**Tech Stack:** Node 24 (CommonJS server that `require`s the ES modules in `public/js`), `node:test`, plain browser JS, three.js (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-12-ai-drivers-design.md`

Two simplifications against the spec, same behaviour: the bot's traffic scan checks every car each tick (22 × 22, cheaper than keeping a sorted lap-order list at this grid size), and the "AI" meta flag is the car's existing-style boolean `isBot` rather than a field named `ai` (`p.ai` holds the bot's level parameters).

## Global Constraints

- Off by default: `aiDrivers: false`, `aiLevel: 'medium'`.
- Grid fills to `MAX_RACERS = 22`; a team holds at most `maxPlayers` (2) cars; humans always keep their seats.
- Pace targets, lap ÷ `track.racingLine.lapS`: Easy 1.12, Medium 1.05, Hard 1.01, Pro 0.995, each bot ±1.5 % around its level.
- Bots drive with full help `{ steer: 1, brake: 1 }` through the same `Drive.driveCar` as humans.
- Bot names are fictional; never real F1 drivers.
- No new npm dependencies.
- Bots add nothing to the network except their car in the existing 34-byte fast update and their meta.
- A tick with 22 cars (21 bots) must average under 4 ms on the dev machine.
- Tests run with `npm test` (`node --test test/*.test.js`), all green before every commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; work on `develop`.

## Review Focus

1. **Bots never touch a car that is stopped or slower in front of them.** Covered in Task 3 (parked car test).
2. **Short races (2–3 laps) still meet the two-compound rule** without a bot running a stint into the tyre cliff where avoidable. Covered in Task 5 (planner sweep 2…50 laps).
3. **A bot never gets stuck:** off the line after a mistake, after a pit stop, after a wall hit, after being pushed wide. Each driving test asserts the bot finishes its laps; Task 4 forces a mistake every corner.
4. **Bot names show everywhere a human name does** (tower, results, quali results, pole card, fastest lap, minimap). Task 8 replaces every `clientState.players[id]` lookup for drivers with `driverOf(id)`.
5. **Everyone leaving mid-session with bots running stops the game** and frees the server for the next lobby. Covered in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/game/bots/roster.js` (new) | Level table, seeded RNG, fictional names, `fillGrid` |
| `src/game/bots/driver.js` (new) | Per-tick driving: line following, racecraft, mistakes, start, pit approach; `state(p)` |
| `src/game/bots/strategy.js` (new) | `planRace`, per-tick `tick`: race stops, quali runs, release presses |
| `src/game/Game.js` | Bot fields on the car record, `isBot` meta, `updateBots()` |
| `src/lobby.js` | `aiDrivers` / `aiLevel` settings |
| `src/socketManager.js` | `state.bots`, fill on start, keep through quali → race and restart, clear in lobby |
| `public/index.html`, `public/js/app.js` | Lobby controls |
| `public/js/socket.js` | `clientState.bots` from `game_init`, `window.driverOf` |
| `public/js/game3d.js` | Name lookups via `driverOf`, "AI" tag |
| `test/botRoster.test.js`, `test/botDriver.test.js`, `test/botStrategy.test.js`, `test/botSession.test.js` (new) | Tests |

---

### Task 1: Settings and roster

**Files:**
- Create: `src/game/bots/roster.js`
- Modify: `src/lobby.js` (`sanitizeSettings`)
- Modify: `src/socketManager.js` (default `state.settings`)
- Test: `test/botRoster.test.js`

**Interfaces:**
- Produces: `fillGrid(humans: {teamId}[], level: string, seed: number, max = 22) → bot[]` where `bot = { id: 'ai-<n>', username, teamId, color, assist: { steer: 1, brake: 1 }, compound: 'M', isBot: true, ai: { level, pace, aggression, mistake, reaction, release, bog } }`; `LEVELS`; `rngOf(seed) → () => number in [0,1)`.

- [ ] **Step 1: Write the failing test**

```js
// test/botRoster.test.js
const test = require('node:test');
const assert = require('node:assert');
const { fillGrid, LEVELS, rngOf } = require('../src/game/bots/roster');
const lobby = require('../src/lobby');
const TEAMS = require('../public/teams.json');

test('fills every free seat up to 22, humans keep theirs, no team over its seats', () => {
    const humans = [{ teamId: 'ferrari' }, { teamId: 'ferrari' }, { teamId: 'haas' }];
    const bots = fillGrid(humans, 'hard', 42);
    assert.strictEqual(humans.length + bots.length, 22);
    const count = {};
    for (const c of [...humans, ...bots]) count[c.teamId] = (count[c.teamId] || 0) + 1;
    for (const t of TEAMS) assert.ok((count[t.id] || 0) <= t.maxPlayers, `${t.id}: ${count[t.id]}`);
    assert.ok(!bots.some((b) => b.teamId === 'ferrari'), 'both Ferrari seats are human');
    assert.strictEqual(new Set(bots.map((b) => b.username)).size, bots.length, 'names unique');
    assert.strictEqual(new Set(bots.map((b) => b.id)).size, bots.length, 'ids unique');
    for (const b of bots) {
        assert.ok(b.isBot && b.id.startsWith('ai-'));
        assert.deepStrictEqual(b.assist, { steer: 1, brake: 1 });
        assert.ok(Math.abs(b.ai.pace / LEVELS.hard.pace - 1) <= 0.015 + 1e-9, `pace ${b.ai.pace}`);
        assert.strictEqual(b.color, TEAMS.find((t) => t.id === b.teamId).chatColor);
    }
});

test('same seed, same grid; 22 humans, no bots; unknown level plays as medium', () => {
    assert.deepStrictEqual(fillGrid([], 'pro', 7), fillGrid([], 'pro', 7));
    const full = TEAMS.flatMap((t) => [{ teamId: t.id }, { teamId: t.id }]);
    assert.strictEqual(fillGrid(full, 'easy', 1).length, 0);
    assert.strictEqual(fillGrid([], 'nonsense', 3)[0].ai.level, 'medium');
    const r = rngOf(5), xs = Array.from({ length: 1000 }, r);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('settings: aiDrivers boolean, aiLevel one of four, anything else keeps the current value', () => {
    const cur = { aiDrivers: false, aiLevel: 'medium' };
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { aiDrivers: true, aiLevel: 'pro' }, []), { aiDrivers: true, aiLevel: 'pro' });
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { aiDrivers: 'yes', aiLevel: 'god' }, []), cur);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/botRoster.test.js`
Expected: FAIL, `Cannot find module '../src/game/bots/roster'`

- [ ] **Step 3: Write the roster**

```js
// src/game/bots/roster.js
// AI drivers for the free grid seats: who they are and how good. Pure (seeded), so a test can rebuild a grid.
const TEAMS = require('../../../public/teams.json');

// pace: lap ÷ racingLine.lapS. mistake: chance per corner. reaction / release: seconds [min, max]. bog: chance of a slow getaway
const LEVELS = {
    easy:   { pace: 1.12,  aggression: 0.2,  mistake: 0.04,  reaction: [0.35, 0.45], release: [0.3, 0.8],  bog: 0.15 },
    medium: { pace: 1.05,  aggression: 0.45, mistake: 0.02,  reaction: [0.28, 0.38], release: [0.15, 0.5], bog: 0.05 },
    hard:   { pace: 1.01,  aggression: 0.7,  mistake: 0.008, reaction: [0.22, 0.3],  release: [0.05, 0.3], bog: 0 },
    pro:    { pace: 0.995, aggression: 0.9,  mistake: 0.002, reaction: [0.18, 0.24], release: [0, 0.15],   bog: 0 },
};
const SPREAD = 0.015; // ±1.5 % pace around the level

// Fictional names only (never real drivers)
const NAMES = ['Arlo Vance', 'Mika Strand', 'Teo Lindqvist', 'Ravi Sethi', 'Jonah Pryce', 'Luca Ferraro', 'Nils Achterberg',
    'Owen Hale', 'Kenji Arata', 'Mateo Quiroga', 'Felix Morrow', 'Sami Korhonen', 'Ezra Blackwood', 'Dario Conti', 'Hugo Delmas',
    'Ilya Petrenko', 'Callum Reid', 'Bruno Talavera', 'Yusuf Demir', 'Anders Holm', 'Leo Marchetti', 'Theo Garnier', 'Rafa Ibarra', 'Max Eklund'];

// mulberry32: small, fast, good enough for gameplay randomness
function rngOf(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fillGrid(humans, level, seed, max = 22) {
    const name = LEVELS[level] ? level : 'medium', L = LEVELS[name], rng = rngOf(seed);
    const pool = NAMES.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const taken = {};
    for (const h of humans) taken[h.teamId] = (taken[h.teamId] || 0) + 1;
    const between = ([a, b]) => a + (b - a) * rng();
    const bots = [];
    for (const t of TEAMS) {
        while ((taken[t.id] || 0) < t.maxPlayers && humans.length + bots.length < max) {
            taken[t.id] = (taken[t.id] || 0) + 1;
            bots.push({
                id: `ai-${bots.length + 1}`, username: pool[bots.length], teamId: t.id, color: t.chatColor,
                assist: { steer: 1, brake: 1 }, compound: 'M', isBot: true,
                ai: { level: name, pace: L.pace * (1 + (rng() * 2 - 1) * SPREAD), aggression: Math.min(1, Math.max(0, L.aggression + (rng() - 0.5) * 0.1)),
                    mistake: L.mistake * (0.75 + rng() * 0.5), reaction: between(L.reaction), release: between(L.release), bog: L.bog },
            });
        }
    }
    return bots;
}

module.exports = { LEVELS, NAMES, rngOf, fillGrid };
```

- [ ] **Step 4: Settings**

In `src/lobby.js` `sanitizeSettings`, after the `tyreWear` line add:

```js
    if (typeof incoming.aiDrivers === 'boolean') next.aiDrivers = incoming.aiDrivers;
    if (['easy', 'medium', 'hard', 'pro'].includes(incoming.aiLevel)) next.aiLevel = incoming.aiLevel;
```

In `src/socketManager.js` default `state.settings` add `aiDrivers: false, aiLevel: 'medium'` after `qualiLaps: 2`.

- [ ] **Step 5: Run tests**

Run: `node --test test/botRoster.test.js && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/bots/roster.js src/lobby.js src/socketManager.js test/botRoster.test.js
git commit -m "AI drivers: roster and host settings"
```

---

### Task 2: Driver follows the racing line, Game runs bots

**Files:**
- Create: `src/game/bots/driver.js`
- Modify: `src/game/Game.js` (car record, `META_FIELDS`, `update()`, new `updateBots()`)
- Test: `test/botDriver.test.js`

**Interfaces:**
- Consumes: roster bot records (Task 1).
- Produces: `driver.drive(p, ctx) → { throttle, brake, steer, drs }`; `driver.state(p) → p.bot` (per-bot scratch, created on first use: `{ idx, lane, passSide, defend, defended, err, prevPhase, followS, press, wantPit, bog }`); `driver.insideSide(track, i) → ±1`; `driver.PACE` (calibration object `{ base }`). `ctx = { game, track, cars, time, frozen, mode, dt, rng, toEntryM(p) }`. Game: `p.isBot`, `p.ai`, `p.color` on car records; `'isBot'` in `META_FIELDS`; `Game.prototype.updateBots()`; strategy hook `require('./bots/strategy').tick(p, ctx)` is called if the module exists (Task 5 creates it; until then guard with a no-op).

- [ ] **Step 1: Write the failing test**

```js
// test/botDriver.test.js
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const { fillGrid } = require('../src/game/bots/roster');

const io = { emit() {}, volatile: { emit() {} } };
const tracks = Object.fromEntries(['monza', 'monaco', 'silverstone', 'interlagos'].map((id) => [id, Track.load(id)]));
const RACE = { maxLaps: 50, qualifying: false, tyreWear: false, ghostStart: false, collisions: true };

// One bot (pace forced if given) alone on the track: lap times, wall hits (≥ 25 % speed lost in a tick), track-limit strikes
function lone(track, level, laps = 3, pace) {
    const bot = fillGrid([], level, 11)[0];
    if (pace) bot.ai.pace = pace;
    bot.ai.mistake = 0;
    const g = new Game(io, [bot], track, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const p = g.players[bot.id], times = [];
    let hits = 0, prev = 0, seen = 0;
    for (let k = 0; k < 60 * 150 * laps && times.length < laps; k++) {
        g.update();
        const v = Math.abs(p.speed) / track.scale;
        if (prev > 10 && v < prev * 0.75) hits++;
        prev = v;
        if (p.lap > seen) { seen = p.lap; if (p.lastLap !== null) times.push(p.lastLap); }
    }
    return { times, hits, strikes: p.limits, p, g };
}

for (const id of Object.keys(tracks)) {
    test(`a lone bot laps ${id} cleanly`, () => {
        const r = lone(tracks[id], 'medium', 3);
        assert.strictEqual(r.times.length, 3, `finished ${r.times.length} laps`);
        assert.strictEqual(r.hits, 0, 'hit a wall');
        assert.strictEqual(r.strikes, 0, 'track-limit strikes');
    });
}

test('pace lands in each level band on Monza and Silverstone (flying laps)', () => {
    for (const id of ['monza', 'silverstone']) {
        const t = tracks[id];
        for (const [level, target] of [['easy', 1.12], ['medium', 1.05], ['hard', 1.01], ['pro', 0.995]]) {
            const r = lone(t, level, 3, target);
            const ratio = r.times[2] / t.racingLine.lapS;
            assert.ok(Math.abs(ratio - target) <= 0.01, `${id} ${level}: lap ${r.times[2].toFixed(2)} = ${ratio.toFixed(3)} × lapS, want ${target}`);
        }
    }
});

test('bot cars carry isBot and the meta says so', () => {
    const bot = fillGrid([], 'easy', 1)[0];
    const g = new Game(io, [bot], tracks.monza, RACE, () => {});
    assert.strictEqual(g.players[bot.id].isBot, true);
    assert.ok(Game.META_FIELDS.includes('isBot'));
    assert.strictEqual(g.initPayload().players[bot.id].username, bot.username);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/botDriver.test.js`
Expected: FAIL, `Cannot find module` / bot never moves.

- [ ] **Step 3: Write the driver (line following only; racecraft and mistakes come in Tasks 3–4)**

```js
// src/game/bots/driver.js
// AI driver: a bot car's view of the track and traffic → { throttle, brake, steer, drs }, once per tick, before the shared
// physics. Same car, same help (full), same rules as a human.
const { C } = require('../CarPhysics');
const RacingLine = require('../RacingLine');
const Drive = require('../../../public/js/sim/drive.js');
const { trackIndex } = require('../../../public/js/racingline.js');

const IDLE = Object.freeze({ throttle: 0, brake: 0, steer: 0, drs: false });
const LOOK_S = 0.35, LOOK_MIN_M = 12, LOOK_MAX_M = 60; // steering aim this far ahead on the line
const SPEED_LOOK_S = 0.25;                             // speed target read this far ahead (throttle/brake response)
const EDGE_M = 1.5;                                    // lane moves stay this far inside the white lines
const LANE_RATE_MS = 3;                                // sideways moves at most this fast
const PIT_APPROACH_M = 80;                             // box called: the pit assist steers from this far before the entry
const PACE = { base: 1 };                              // calibration (Step 5): line speed × base / pace

const lines = new WeakMap();
function lineOf(t) {
    let c = lines.get(t);
    if (c) return c;
    const P = t.path, n = P.length, m = EDGE_M * t.scale;
    const N = P.map((_, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; // RacingLine.normals convention: point = path + N × offset
    });
    c = { N, lo: t.edgeL.map((e) => -(e - m)), hi: t.edgeR.map((e) => e - m), pts: RacingLine.linePoints(P, t.racingLine.offset) };
    lines.set(t, c);
    return c;
}

// Path index `metres` further along the lap from i
function ahead(t, i, metres) {
    const n = t.path.length, total = t.cum[n], want = metres * t.scale;
    for (let k = 1; k < n; k++) {
        const j = (i + k) % n;
        if ((((t.cum[j] - t.cum[i]) % total) + total) % total >= want) return j;
    }
    return i;
}

// The side the line takes at the next corner's apex (within 300 m): +1 = the path normal's side, -1 = the other
function insideSide(t, i) {
    const ph = t.racingLine.phase;
    for (let j = i, d = 0; d < 300; d += 5) { j = ahead(t, j, 5); if (ph[j] === 1) return Math.sign(t.racingLine.offset[j]) || 1; }
    return 1;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Pure pursuit onto (x, y): wheel angle for the arc through it, as a share of the lock (full help: the larger lock)
function steerTo(p, x, y, sc, v) {
    const dx = (x - p.x) / sc, dy = (y - p.y) / sc, d2 = Math.max(1, dx * dx + dy * dy);
    const lat = -dx * Math.sin(p.angle) + dy * Math.cos(p.angle);
    const wheel = Math.atan(((2 * lat) / d2) * C.WHEELBASE);
    const lock = ((1 + C.ASSIST_STEER) * C.MAX_STEER) / (1 + v / C.STEER_FADE);
    return clamp(wheel / lock, -1, 1);
}

function state(p) {
    return p.bot || (p.bot = { idx: null, lane: 0, passSide: 0, defend: 0, defended: false, err: null, prevPhase: 0, followS: 0, press: false, wantPit: false, bog: undefined });
}

// Racecraft (Task 3) and mistakes (Task 4) plug in here; for now: the line, alone
function racecraft() { return { laneT: 0, cap: Infinity }; }

function drive(p, ctx) {
    const b = state(p);
    if (p.stop) return { ...IDLE, throttle: b.press ? 1 : 0 }; // pit assist / parked: only release and box-exit presses
    if (ctx.frozen || p.finished) return IDLE;
    const t = ctx.track, sc = t.scale, L = lineOf(t), v = Math.abs(p.speed) / sc, ai = p.ai;
    b.idx = trackIndex(t.path, p.x, p.y, b.idx, 40 * sc);
    if ((p.boxCall || b.wantPit) && t.pit && p.box && ctx.toEntryM(p) < PIT_APPROACH_M) return { ...Drive.pitAssist(p, t), drs: false };
    if (ctx.mode === 'race' && ctx.time < ai.reaction) return IDLE;
    const here = b.idx;
    let factor = (PACE.base / ai.pace) * Math.sqrt(p.tyreGrip ?? 1);
    if (ctx.mode === 'quali' && p.lapStart === null) factor *= 0.9; // out-lap
    const { laneT, cap } = racecraft(p, b, ctx, v, here);
    const vt = Math.min(t.racingLine.speed[ahead(t, here, Math.max(5, v * SPEED_LOOK_S))] * factor, cap);
    b.lane += clamp(laneT - b.lane, -LANE_RATE_MS * ctx.dt, LANE_RATE_MS * ctx.dt);
    const j = ahead(t, here, clamp(v * LOOK_S, LOOK_MIN_M, LOOK_MAX_M));
    const o = clamp(t.racingLine.offset[j] + b.lane * sc, L.lo[j], L.hi[j]);
    const steer = steerTo(p, t.path[j].x + L.N[j].x * o, t.path[j].y + L.N[j].y * o, sc, v);
    const err = vt - v;
    const throttle = err > 0 ? Math.min(1, 0.35 + err * 0.5) : 0, brake = err < -0.5 ? Math.min(1, -err * 0.3) : 0;
    return { throttle, brake, steer, drs: !!p.drsAvailable && brake === 0 };
}

module.exports = { drive, state, insideSide, ahead, lineOf, PACE, IDLE };
```

- [ ] **Step 4: Wire bots into `Game`**

In `src/game/Game.js`:

1. At the top with the other requires:
```js
const BotDriver = require('./bots/driver');
let BotStrategy = { tick() {} }; // Task 5 replaces this with require('./bots/strategy')
```
2. `META_FIELDS`: append `'isBot'` to the array.
3. In the constructor's car record (the object literal assigned to `this.players[p.id]`), after `teamId: p.teamId,` add:
```js
                isBot: !!p.isBot, ai: p.ai || null, color: p.color,
```
4. In `update()`, directly before `if (this.mode === 'race') this.updateTow();` add `this.updateBots();`.
5. Add the method after `drive(p)`:
```js
    // AI drivers decide their inputs (and pit calls) before anyone moves, from the same state humans see
    updateBots() {
        const cars = Object.values(this.players);
        if (!cars.some((p) => p.isBot)) return;
        const ctx = { game: this, track: this.track, cars, time: this.time, frozen: this.frozen, mode: this.mode, dt: this.dt, rng: this.rng, toEntryM: (p) => this.toEntryM(p) };
        for (const p of cars) {
            if (!p.isBot) continue;
            BotStrategy.tick(p, ctx);
            p.input = BotDriver.drive(p, ctx);
        }
    }
```

- [ ] **Step 5: Calibrate and tune until the tests pass**

Run: `node --test test/botDriver.test.js`

Expected first result: the clean-lap tests may fail on Monaco (walls) and the pace test will print each ratio. Tune in this order, re-running after each change. Keep every change in `driver.js` constants:
1. Wall hits or strikes: lower `LOOK_S` (0.35 → 0.3) and raise `LOOK_MIN_M` for tight hairpins only if hits are in slow corners; if the car runs wide on corner exit, lower the throttle gain `0.5` → `0.3`.
2. Pace: set `PACE.base` so the Pro bot's Monza ratio sits at 0.995 (e.g. ratio 1.03 at base 1 → base ≈ 1.03). If Easy/Medium then land off-band, the speed target isn't linear in lap time on straights (power-limited): change `factor` to `(PACE.base / ai.pace) ** PACE.exp` with `PACE.exp` tuned (start 1.6) so all four levels fit.
3. Done when all `botDriver` tests pass. Record the final constants in the commit message.

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: all PASS (existing tests unaffected: no bots in them).

- [ ] **Step 7: Commit**

```bash
git add src/game/bots/driver.js src/game/Game.js test/botDriver.test.js
git commit -m "AI drivers: follow the racing line at their level's pace; Game runs bot inputs before physics"
```

---

### Task 3: Racecraft

**Files:**
- Modify: `src/game/bots/driver.js` (replace the stub `racecraft`, add `scan`)
- Test: `test/botDriver.test.js` (append)

**Interfaces:**
- Consumes: `state`, `insideSide`, `ahead` (Task 2).
- Produces: `scan(p, ctx, v) → { ahead, behind, alongside, lapper, close }` (entries `{ o, f, l, v }`: metres forward, metres left/right of my heading, speed m/s); `b.followS` (seconds spent within 1.5 s of a car ahead, read by strategy for undercuts).

- [ ] **Step 1: Write the failing tests**

```js
// append to test/botDriver.test.js
const Physics = require('../src/game/Physics');

test('a faster bot passes a slower one without contact', () => {
    const [fast, slow] = fillGrid([], 'pro', 21);
    fast.ai.mistake = slow.ai.mistake = 0;
    slow.ai.pace = 1.2;
    const g = new Game(io, [slow, fast], tracks.monza, { ...RACE, rng: () => 0.5 }, () => {}); // slow on pole, fast behind
    g.release();
    let passed = false;
    for (let k = 0; k < 60 * 300 && !passed; k++) { g.update(); passed = g.players[fast.id].rank === 1; }
    assert.ok(passed, 'never got past in 5 minutes');
    assert.strictEqual(g.contacts.size, 0, 'touched');
    assert.strictEqual(g.players[fast.id].penalty, 0);
});

test('a bot behind a stopped car on the line never hits it', () => {
    const bot = fillGrid([], 'pro', 5)[0];
    bot.ai.mistake = 0;
    const t = tracks.monza, g = new Game(io, [bot, { id: 'h', username: 'H', teamId: 'haas' }], t, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const L = require('../src/game/bots/driver').lineOf(t), j = require('../src/game/bots/driver').ahead(t, 0, 400);
    Object.assign(g.players.h, { x: L.pts[j].x, y: L.pts[j].y, angle: g.players[bot.id].angle, vx: 0, vy: 0, speed: 0 });
    let touched = false;
    for (let k = 0; k < 60 * 40; k++) {
        g.players.h.input = { throttle: 0, brake: 1, steer: 0, drs: false };
        g.players.h.inputAt = g.clock; // still "connected": no input timeout
        g.update();
        if (Physics.carOverlap(g.players[bot.id], g.players.h, t.scale)) touched = true;
    }
    assert.strictEqual(touched, false);
    assert.ok(g.players[bot.id].lap >= 1, 'got round it');
});

test('defending: one move toward the inside before the braking zone, never a second on that straight', () => {
    const { drive, state, insideSide, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, ph = t.racingLine.phase;
    let i = 0; // a straight point with a braking zone 150 m on (the distance the defence looks ahead)
    for (let k = 0; k < ph.length; k++) if (ph[ahead(t, k, 150)] === 2 && ph[k] === 0) { i = k; break; }
    const P = t.path[i], Q = t.path[(i + 1) % t.path.length], ang = Math.atan2(Q.y - P.y, Q.x - P.x);
    const me = { x: P.x, y: P.y, angle: ang, speed: 70 * t.scale, ai: { pace: 1, aggression: 0.9, mistake: 0, reaction: 0 }, lap: 3, rank: 1, tyreGrip: 1 };
    const back = (side) => ({ x: P.x - Math.cos(ang) * 20 * t.scale + side * -Math.sin(ang) * 2 * t.scale, y: P.y - Math.sin(ang) * 20 * t.scale + side * Math.cos(ang) * 2 * t.scale, speed: 72 * t.scale, lap: 3, rank: 2 });
    const ctx = (o) => ({ track: t, cars: [me, o], time: 100, frozen: false, mode: 'race', dt: 1 / 60, rng: () => 0.99, toEntryM: () => 1e9 });
    drive(me, ctx(back(1)));
    const side = state(me).defend;
    assert.strictEqual(side, insideSide(t, i), 'covers the inside');
    drive(me, ctx(back(-1)));
    assert.strictEqual(state(me).defend, side, 'no second move when the attacker switches');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/botDriver.test.js`
Expected: the three new tests FAIL (contact / never passes / `defend` stays 0).

- [ ] **Step 3: Implement `scan` and `racecraft`**

In `src/game/bots/driver.js` add the constants next to the others and replace the stub `racecraft`:

```js
const CAR_M = 5.6, PASS_M = 3.5, DEFEND_M = 3, BLUE_M = 3.5; // metres

// Cars around me in my heading's frame: f = metres ahead (+) / behind (−), l = metres to my left (−) / right (+)
function scan(p, ctx, v) {
    const sc = ctx.track.scale, ca = Math.cos(p.angle), sa = Math.sin(p.angle), r = { ahead: null, behind: null, alongside: null, lapper: null, close: false };
    for (const o of ctx.cars) {
        if (o === p || o.finished || (o.inPit && o.stop)) continue;
        const dx = (o.x - p.x) / sc, dy = (o.y - p.y) / sc, f = dx * ca + dy * sa, l = -dx * sa + dy * ca;
        const e = { o, f, l, v: Math.abs(o.speed) / sc };
        if (Math.abs(f) < CAR_M && Math.abs(l) < 4) r.alongside = e;
        else if (f > 0 && f < 150 && Math.abs(l) < 2.5) { if (!r.ahead || f < r.ahead.f) r.ahead = e; }
        else if (f < 0 && f > -60 && Math.abs(l) < 4) {
            if (!r.behind || f > r.behind.f) r.behind = e;
            if (o.lap > p.lap && o.rank < p.rank) r.lapper = e; // a lap or more up on me, catching me
        }
    }
    r.close = !!r.alongside || (!!r.behind && -r.behind.f < Math.max(10, 0.6 * v));
    return r;
}

function racecraft(p, b, ctx, v, here, r, vt) {
    const t = ctx.track, ai = p.ai, ph = t.racingLine.phase[here];
    if (ph === 1) { b.defend = 0; b.defended = false; } // in the corner: the next straight allows a new move
    if (r.lapper && -r.lapper.f < 1.5 * v + 10) { b.passSide = 0; return { laneT: -insideSide(t, here) * BLUE_M, cap: v * 0.97 }; } // blue flag
    let laneT = 0, cap = Infinity;
    const a = r.ahead;
    if (a) {
        const faster = vt > a.v + 0.5 || p.tow > 0 || p.drsAvailable;
        if (!b.passSide && faster && !r.alongside && a.f < (0.5 + 0.5 * ai.aggression) * v + CAR_M) {
            const inside = insideSide(t, here);
            b.passSide = Math.sign(a.l) === inside ? -inside : inside; // the inside, unless they're already on it
        }
        if (b.passSide && ph === 2 && a.f > CAR_M * 0.5) b.passSide = 0; // not alongside by the braking point: back in line
        if (Math.abs(a.l) < 2.2 && a.f < Math.max(8, 0.4 * v) + CAR_M) cap = a.v - (a.f < CAR_M + 3 ? 2 : 0); // no ramming
        if (a.f < 1.5 * v) b.followS += ctx.dt;
    } else b.passSide = 0;
    if (b.passSide) laneT = b.passSide * PASS_M;
    else {
        const brakingSoon = t.racingLine.phase[ahead(t, here, 150)] === 2;
        if (!b.defended && ai.aggression >= 0.3 && r.behind && -r.behind.f < 0.5 * v + CAR_M && brakingSoon && ph === 0) {
            b.defend = insideSide(t, here);
            b.defended = true;
        }
        if (b.defend) laneT = b.defend * DEFEND_M;
    }
    if (r.alongside) laneT = b.lane; // side by side: hold my lane, never turn in across them
    return { laneT, cap };
}
```

In `drive`, replace the two lines

```js
    const { laneT, cap } = racecraft(p, b, ctx, v, here);
    const vt = Math.min(t.racingLine.speed[ahead(t, here, Math.max(5, v * SPEED_LOOK_S))] * factor, cap);
```

with

```js
    const r = scan(p, ctx, v);
    const vLine = t.racingLine.speed[ahead(t, here, Math.max(5, v * SPEED_LOOK_S))] * factor;
    const { laneT, cap } = racecraft(p, b, ctx, v, here, r, vLine);
    const vt = Math.min(vLine, cap);
```

and export `scan`: `module.exports = { drive, state, insideSide, ahead, lineOf, scan, PACE, IDLE };`

- [ ] **Step 4: Run tests, tune**

Run: `node --test test/botDriver.test.js`
Expected: PASS. If the pass test touches: raise the follow gap `0.4 * v` → `0.5 * v`; if it never passes: raise `PASS_M` to 4 (still clamped inside the lines by `lo`/`hi`).

- [ ] **Step 5: Full suite and commit**

Run: `npm test` → all PASS.

```bash
git add src/game/bots/driver.js test/botDriver.test.js
git commit -m "AI drivers: racecraft — follow without ramming, pass on the inside, one defensive move, room alongside, blue flags"
```

---

### Task 4: Mistakes and the race start

**Files:**
- Modify: `src/game/bots/driver.js` (`drive`)
- Test: `test/botDriver.test.js` (append)

**Interfaces:**
- Consumes: `scan(...).close` (Task 3), `p.ai.mistake`, `p.ai.reaction`, `p.ai.bog`.
- Produces: `b.err = { kind: 'late' | 'early' | 'apex', until }`, `b.bog: boolean`.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/botDriver.test.js
test('mistakes: forced at every corner, the bot is slower but recovers and keeps lapping', () => {
    const clean = lone(tracks.silverstone, 'medium', 2, 1.05).times[1];
    const bot = fillGrid([], 'medium', 11)[0];
    bot.ai.pace = 1.05; bot.ai.mistake = 1;
    const g = new Game(io, [bot], tracks.silverstone, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const p = g.players[bot.id];
    let kinds = new Set();
    for (let k = 0; k < 60 * 400 && p.lap < 2; k++) { g.update(); if (p.bot?.err) kinds.add(p.bot.err.kind); }
    assert.strictEqual(p.lap, 2, 'stuck after a mistake');
    assert.ok(p.lastLap > clean, `mistake lap ${p.lastLap} vs clean ${clean}`);
    assert.ok(kinds.size >= 1);
});

test('no mistakes with a car alongside or close behind', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, ph = t.racingLine.phase;
    let i = 0;
    for (let k = 1; k < ph.length; k++) if (ph[k] === 2 && ph[k - 1] !== 2) { i = k; break; }
    const P = t.path[i], Q = t.path[i + 1], ang = Math.atan2(Q.y - P.y, Q.x - P.x);
    const me = { x: P.x, y: P.y, angle: ang, speed: 60 * t.scale, ai: { pace: 1, aggression: 0.5, mistake: 1, reaction: 0 }, lap: 1, rank: 1, tyreGrip: 1 };
    const side = { x: P.x - Math.sin(ang) * 3 * t.scale, y: P.y + Math.cos(ang) * 3 * t.scale, speed: 60 * t.scale, lap: 1, rank: 2 };
    state(me).prevPhase = 0;
    drive(me, { track: t, cars: [me, side], time: 50, frozen: false, mode: 'race', dt: 1 / 60, rng: () => 0, toEntryM: () => 1e9 });
    assert.strictEqual(state(me).err, null);
});

test('start: no throttle before the bot reacts, then it goes', () => {
    const bot = fillGrid([], 'easy', 2)[0];
    bot.ai.reaction = 0.4; bot.ai.bog = 0;
    const g = new Game(io, [bot], tracks.monza, RACE, () => {});
    g.update();
    assert.strictEqual(g.players[bot.id].input.throttle, 0, 'lights still on');
    g.release();
    for (let k = 0; k < 20; k++) g.update(); // 0.33 s
    assert.strictEqual(g.players[bot.id].input.throttle, 0, 'before its reaction time');
    for (let k = 0; k < 10; k++) g.update();
    assert.ok(g.players[bot.id].input.throttle > 0, 'after it');
    assert.strictEqual(g.players[bot.id].jumpStart, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/botDriver.test.js`
Expected: the mistake tests FAIL (`kinds.size` 0, slower-lap assertion fails); the start test may already pass (Task 2 has the reaction gate) — that's fine, it pins the behaviour.

- [ ] **Step 3: Implement**

In `drive`, after `const r = scan(p, ctx, v);` insert:

```js
    // A mistake at a corner entry, never with someone right there; it lasts until the corner is done (or 2.5 s)
    const phNow = t.racingLine.phase[here];
    if (phNow === 2 && b.prevPhase !== 2 && !b.err && !r.close && ctx.rng() < ai.mistake) {
        const roll = ctx.rng();
        b.err = { kind: roll < 0.4 ? 'late' : roll < 0.7 ? 'early' : 'apex', until: ctx.time + 2.5 };
    }
    b.prevPhase = phNow;
    if (b.err && (ctx.time > b.err.until || (phNow === 0 && b.err.until - ctx.time < 1.5))) b.err = null;
    if (b.err?.kind === 'late') factor *= 1.06;
    else if (b.err?.kind === 'early') factor *= 0.92;
```

Then where the lane moves, use the apex error:

```js
    const laneWant = laneT + (b.err?.kind === 'apex' ? -insideSide(t, here) * 1.5 : 0);
    b.lane += clamp(laneWant - b.lane, -LANE_RATE_MS * ctx.dt, LANE_RATE_MS * ctx.dt);
```

(`factor` must be declared with `let`, as it already is.) Replace the reaction line

```js
    if (ctx.mode === 'race' && ctx.time < ai.reaction) return IDLE;
```

with

```js
    if (ctx.mode === 'race' && ctx.time < ai.reaction) return IDLE;
    if (b.bog === undefined) b.bog = ctx.mode === 'race' && ctx.rng() < (ai.bog || 0);
    const bogging = b.bog && ctx.time < ai.reaction + 0.3;
```

and before the return: `const thr = bogging ? Math.min(throttle, 0.6) : throttle;`, returning `throttle: thr`.

- [ ] **Step 4: Run tests**

Run: `node --test test/botDriver.test.js && npm test`
Expected: all PASS. If the mistake bot hits a wall or gets stuck, lower `1.06` → `1.04`.

- [ ] **Step 5: Commit**

```bash
git add src/game/bots/driver.js test/botDriver.test.js
git commit -m "AI drivers: corner mistakes by level (never next to someone), reaction and bog at the start"
```

---

### Task 5: Race strategy

**Files:**
- Create: `src/game/bots/strategy.js`
- Modify: `src/game/Game.js` (replace the `BotStrategy` stub with the real require)
- Test: `test/botStrategy.test.js`

**Interfaces:**
- Consumes: `driver.state(p)` (Task 2), `b.followS` (Task 3), `ctx.game.setBoxCall(id, on)`, `ctx.game.setNextCompound(id, c)`, `p.stops`, `p.wear`, `p.wearPerM`, `p.compoundsUsed`, `p.stop`.
- Produces: `planRace(level: string, maxLaps: number, tyreWear: boolean, rng) → [{ compound: 'S'|'M'|'H', laps: number }]` (laps sum to `maxLaps`); `tick(p, ctx)`; per-bot `b.plan`, `b.stint`, `b.stintLap`, `b.stopsSeen`, `b.lapSeen`, `b.stuckLaps`, `b.wantPit`, `b.press`.

- [ ] **Step 1: Write the failing tests**

```js
// test/botStrategy.test.js
const test = require('node:test');
const assert = require('node:assert');
const { planRace } = require('../src/game/bots/strategy');
const { rngOf, fillGrid } = require('../src/game/bots/roster');
const { COMPOUNDS } = require('../public/js/sim/tyres.js');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');

test('every plan for 2…50 laps: laps add up, two compounds, stints under the cliff where any plan allows it', () => {
    for (const level of ['easy', 'medium', 'hard', 'pro']) for (let laps = 2; laps <= 50; laps++) for (let s = 0; s < 5; s++) {
        const plan = planRace(level, laps, true, rngOf(laps * 10 + s));
        assert.strictEqual(plan.reduce((a, x) => a + x.laps, 0), laps, `${level} ${laps}`);
        assert.ok(new Set(plan.map((x) => x.compound)).size >= 2, `${level} ${laps}: ${JSON.stringify(plan)}`);
        assert.ok(plan.every((x) => x.laps >= 1));
        if (laps >= 8) for (const x of plan) assert.ok(x.laps <= 0.75 * COMPOUNDS[x.compound].life * laps + 1e-9, `${level} ${laps}: ${JSON.stringify(plan)}`);
    }
});

test('no stop with tyre wear off or a 1-lap race: Softs, flat out', () => {
    assert.deepStrictEqual(planRace('pro', 10, false, rngOf(1)), [{ compound: 'S', laps: 10 }]);
    assert.deepStrictEqual(planRace('pro', 1, true, rngOf(1)), [{ compound: 'S', laps: 1 }]);
});

test('the grid gets a spread of strategies', () => {
    const plans = new Set(Array.from({ length: 21 }, (_, i) => planRace('hard', 20, true, rngOf(i)).map((x) => x.compound).join('')));
    assert.ok(plans.size >= 3, [...plans].join(' '));
});

test('a bot race: it pits on its plan, uses two compounds, never boxes on the last lap', () => {
    const t = Track.load('monza'), bot = fillGrid([], 'pro', 3)[0];
    bot.ai.mistake = 0;
    const io = { emit() {}, volatile: { emit() {} } };
    let done = false;
    const g = new Game(io, [bot], t, { maxLaps: 4, qualifying: false, tyreWear: true, ghostStart: false, rng: rngOf(9) }, () => { done = true; });
    const p = g.players[bot.id];
    g.update(); // grid: start tyre fitted from the plan
    assert.strictEqual(p.compound, p.bot.plan[0].compound);
    g.release();
    let lastLapCall = false, prevCall = null;
    for (let k = 0; k < 60 * 600 && !done; k++) {
        g.update();
        if (p.lap === 3 && p.boxCall && !prevCall) lastLapCall = true; // a new call on the last lap (one from the lap before stays on until serviced)
        prevCall = p.boxCall;
    }
    assert.ok(p.finished, 'finished');
    assert.ok(p.stops >= 1, 'pitted');
    assert.ok(p.compoundsUsed.length >= 2, `${p.compoundsUsed}`);
    assert.strictEqual(p.penalty, 0);
    assert.ok(['perfect', 'auto'].includes(p.lastStop.release), p.lastStop.release);
    assert.strictEqual(lastLapCall, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/botStrategy.test.js`
Expected: FAIL, `Cannot find module '../src/game/bots/strategy'`.

- [ ] **Step 3: Write the strategy (race part; Task 6 adds qualifying)**

```js
// src/game/bots/strategy.js
// AI strategy: a legal tyre plan per bot, box calls when the plan or the wear says so, undercuts, and the release press.
// Uses only the controls a human has (setBoxCall, setNextCompound, the throttle).
const { COMPOUNDS } = require('../../../public/js/sim/tyres.js');
const { state } = require('./driver');

const WEAR_CAP = 0.75; // a stint ends before this much wear (the grip cliff starts at 0.8)
const PLANS = [['M', 'H'], ['H', 'M'], ['S', 'H'], ['S', 'M', 'S'], ['S', 'H', 'S']];

// Laps per stint: each at least 1 and within cap × life × race; the rest shared out, weighted toward room left
function split(compounds, maxLaps, cap, rng) {
    const most = compounds.map((c) => Math.floor(cap * COMPOUNDS[c].life * maxLaps + 1e-9));
    if (compounds.length > maxLaps || most.some((m) => m < 1) || most.reduce((a, b) => a + b, 0) < maxLaps) return null;
    const laps = compounds.map(() => 1);
    for (let left = maxLaps - laps.length; left > 0; left--) {
        const room = laps.map((l, i) => Math.max(0, most[i] - l)), total = room.reduce((a, b) => a + b, 0);
        let pick = rng() * total, i = 0;
        while (pick >= room[i]) pick -= room[i++];
        laps[i]++;
    }
    return compounds.map((c, i) => ({ compound: c, laps: laps[i] }));
}

function planRace(level, maxLaps, tyreWear, rng) {
    if (!tyreWear || maxLaps < 2) return [{ compound: 'S', laps: maxLaps }];
    const twoStopWeight = (level === 'hard' || level === 'pro' ? 2 : 1) * (maxLaps >= 15 ? 2 : 0.5);
    for (const cap of [WEAR_CAP, 1, Infinity]) { // short races may not fit under the cliff: then the rule wins
        const ok = PLANS.map((pl) => split(pl, maxLaps, cap, rng)).filter(Boolean);
        if (!ok.length) continue;
        const w = ok.map((s) => (s.length === 3 ? twoStopWeight : 2));
        let pick = rng() * w.reduce((a, b) => a + b, 0), i = 0;
        while (pick >= w[i]) pick -= w[i++];
        return ok[i];
    }
    return [{ compound: 'M', laps: maxLaps - 1 }, { compound: 'H', laps: 1 }]; // unreachable for maxLaps ≥ 2
}

function raceTick(p, ctx, b) {
    const g = ctx.game, maxLaps = g.settings.maxLaps || 1;
    if (!b.plan) Object.assign(b, { plan: planRace(p.ai.level, maxLaps, g.settings.tyreWear !== false, ctx.rng), stint: 0, stintLap: 0, stopsSeen: 0, lapSeen: 0, stuckLaps: 0 });
    if (ctx.frozen && !b.fitted) { g.setNextCompound(p.id, b.plan[0].compound); b.fitted = true; }
    // Release from the box: a press after this driver's delay (the game auto-releases at 0.5 s anyway)
    b.press = p.stop?.phase === 'hold' && p.stop.age >= p.ai.release;
    if (p.stop?.phase === 'lane') b.wantPit = false;
    if (p.stops > b.stopsSeen) { b.stopsSeen = p.stops; b.stint = Math.min(b.stint + 1, b.plan.length - 1); b.stintLap = p.lap; }
    if (p.lap === b.lapSeen || ctx.frozen || p.finished) return;
    // Once a lap, on crossing the line: undercut bookkeeping, then the box decision
    b.lapSeen = p.lap;
    b.stuckLaps = b.followS > 0.6 * (p.lastLap || 90) ? b.stuckLaps + 1 : 0;
    b.followS = 0;
    if (p.boxCall || p.inPit) return;
    const rule = p.compoundsUsed.length < 2 && g.settings.tyreWear !== false && maxLaps >= 2;
    if (p.lap >= maxLaps - 1 && !rule) return;                                     // the last lap: never
    const last = b.stint >= b.plan.length - 1;
    const lapsIn = p.lap - b.stintLap, planned = b.plan[b.stint].laps;
    const lapM = ctx.track.cum[ctx.track.path.length] / ctx.track.scale;
    const perLap = Math.max(p.wearPerM * lapM, lapsIn >= 1 ? p.wear / lapsIn : 0);
    const undercut = (p.ai.level === 'hard' || p.ai.level === 'pro') && b.stuckLaps >= 2 && lapsIn >= 0.7 * planned;
    const due = !last && (lapsIn + 1 >= planned || p.wear + perLap > WEAR_CAP + 0.05 || undercut);
    if (due || (rule && p.lap >= maxLaps - 2)) {
        const next = last ? (p.compoundsUsed.includes('H') ? 'M' : 'H') : b.plan[b.stint + 1].compound;
        g.setNextCompound(p.id, next);
        g.setBoxCall(p.id, true);
        b.wantPit = true;
    }
}

function tick(p, ctx) {
    const b = state(p);
    if (ctx.mode === 'race') raceTick(p, ctx, b);
}

module.exports = { planRace, tick, WEAR_CAP };
```

In `src/game/Game.js` replace

```js
let BotStrategy = { tick() {} }; // Task 5 replaces this with require('./bots/strategy')
```

with

```js
const BotStrategy = require('./bots/strategy');
```

- [ ] **Step 4: Run tests**

Run: `node --test test/botStrategy.test.js && npm test`
Expected: all PASS. If the race test shows `stops === 0`, the bot is not reaching the pit entry: raise `PIT_APPROACH_M` in `driver.js` (80 → 150) so the pit assist has room to steer in; re-run the Task 2 lap tests too.

- [ ] **Step 5: Commit**

```bash
git add src/game/bots/strategy.js src/game/Game.js test/botStrategy.test.js
git commit -m "AI drivers: legal tyre plans spread across the grid, box calls by plan and wear, undercuts, release presses"
```

---

### Task 6: Qualifying runs

**Files:**
- Modify: `src/game/bots/strategy.js` (`quali tick`)
- Test: `test/botStrategy.test.js` (append)

**Interfaces:**
- Consumes: `game.quali` (`{ phase, segment, endsAt, refS, format }`), `game.canLeaveBox(p)`, `game.segmentRanking()`, `game.survivors()`, `p.lapStart`, `p.lap`, `p.stop`, `p.qualiOut`, `p.segBest`.
- Produces: per-bot `b.seg`, `b.exitAt`, `b.runs`, `b.timedSeen`, `b.timed`.

- [ ] **Step 1: Write the failing test**

```js
// append to test/botStrategy.test.js
test('qualifying: every bot goes out on Softs, sets a time, comes back in and parks', () => {
    const t = Track.load('monza'), bots = fillGrid([], 'hard', 4).slice(0, 3);
    bots.forEach((b) => { b.ai.mistake = 0; });
    const io = { emit() {}, volatile: { emit() {} } };
    let results = null;
    const g = new Game(io, bots, t, { maxLaps: 3, qualifying: true, qualiFormat: 'short', qualiScale: 0.6, tyreWear: true, rng: rngOf(2) }, (r) => { results = r; }, 'quali');
    for (let k = 0; k < 60 * 900 && !results; k++) g.update();
    assert.ok(results, 'session ended');
    for (const b of bots) {
        const p = g.players[b.id];
        assert.ok(results.find((r) => r.id === b.id).time !== null, `${b.username}: no time`);
        assert.strictEqual(p.compound, 'S');
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/botStrategy.test.js`
Expected: FAIL (bots never leave the box: `no time`).

- [ ] **Step 3: Implement**

In `src/game/bots/strategy.js` add:

```js
// Exit window per level, as shares of the segment clock: later = more track evolution, never too late for a lap
const EXIT = { easy: [0, 0.6], medium: [0.3, 0.7], hard: [0.55, 0.75], pro: [0.55, 0.75] };

function qualiTick(p, ctx, b) {
    const g = ctx.game, q = g.quali, lap = q.refS / 1.15; // a racing lap at pace (refS carries a 15 % margin)
    if (p.qualiOut || !q) return;
    if (b.seg !== q.segment) { // a new segment: plan this one's first exit
        const [lo, hi] = EXIT[p.ai.level] || EXIT.medium, len = Math.max(0, q.endsAt - ctx.time);
        Object.assign(b, { seg: q.segment, runs: 0, timed: 0, wantPit: false, exitAt: ctx.time + len * (lo + (hi - lo) * ctx.rng()) });
        b.exitAt = Math.max(ctx.time, Math.min(b.exitAt, q.endsAt - 2.2 * lap));
    }
    const parked = p.stop?.phase === 'wait';
    if (parked) {
        if (p.compound !== 'S') g.setNextCompound(p.id, 'S'); // parked: fitted at once
        if (b.wantPit || b.timed) { // back from a run: go again only from the drop zone (or with no time) and with time for it
            b.runs++; b.timed = 0; b.wantPit = false;
            const rank = g.segmentRanking().findIndex((e) => e.id === p.id) + 1;
            const atRisk = p.segBest === null || (q.format === 'full' && rank > g.survivors());
            b.exitAt = atRisk && q.endsAt - ctx.time > 2.2 * lap ? ctx.time + 3 : Infinity;
        }
        b.press = q.phase === 'running' && ctx.time >= b.exitAt && g.canLeaveBox(p);
        return;
    }
    b.press = false;
    // On track: count finished timed laps; two of them (or no time for another), or the flag, and it's the in-lap
    if (p.lap !== b.timedSeen) { if (b.timedSeen !== undefined && p.lastLap !== null) b.timed++; b.timedSeen = p.lap; }
    const noTime = q.endsAt - ctx.time < lap;
    if (b.timed >= 2 || (b.timed >= 1 && noTime) || (q.phase === 'flag' && p.lapStart === null)) b.wantPit = true;
}
```

and change `tick` to:

```js
function tick(p, ctx) {
    const b = state(p);
    if (ctx.mode === 'race') raceTick(p, ctx, b);
    else qualiTick(p, ctx, b);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/botStrategy.test.js && npm test`
Expected: all PASS. If a bot leaves but never returns to its box, its in-lap isn't reaching the pit entry: confirm `b.wantPit` is true on the in-lap and `PIT_APPROACH_M` matches the value from Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/game/bots/strategy.js test/botStrategy.test.js
git commit -m "AI drivers: qualifying runs — exit timing by level, out-lap, two push laps, in-lap, second run from the drop zone"
```

---

### Task 7: Session wiring

**Files:**
- Modify: `src/socketManager.js`
- Test: `test/botSession.test.js`

**Interfaces:**
- Consumes: `fillGrid` (Task 1).
- Produces: `state.bots` (array of bot records, `[]` in the lobby); `driverById(id)`.

- [ ] **Step 1: Write the failing tests**

```js
// test/botSession.test.js
const test = require('node:test');
const assert = require('node:assert');
const setupSocketManager = require('../src/socketManager');

const noNet = { setupPeer() {}, hasOpenChannel: () => false, cleanup() {}, broadcastGameState: (s, io) => io.volatile.emit('game_state', s) };
function fakeIo() {
    const io = { handlers: {}, sent: [], ticks: 0, on(ev, fn) { this.handlers[ev] = fn; }, emit(ev, data) { this.sent.push([ev, data]); } };
    io.volatile = { emit() { io.ticks++; } }; // game_state: counted, not stored
    io.connect = (id) => {
        const s = { id, handlers: {}, sent: [], on(ev, fn) { this.handlers[ev] = fn; }, emit(ev, data) { this.sent.push([ev, data]); }, broadcast: { emit() {} }, fire(ev, data) { this.handlers[ev]?.(data); } };
        io.handlers.connection(s);
        return s;
    };
    io.events = (name) => io.sent.filter(([ev]) => ev === name).map(([, d]) => d);
    return io;
}
const advance = (t, ms) => { for (let k = 0; k < ms; k++) t.mock.timers.tick(1); };

test('solo host with AI drivers on: a full 22-car grid, bots marked, team seats respected', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = io.connect('a');
    a.fire('join_lobby', { username: 'A', teamId: 'ferrari' });
    a.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualifying: false, aiDrivers: true, aiLevel: 'hard' });
    a.fire('start_game');
    const init = io.events('game_init').at(-1), cars = Object.values(init.players);
    assert.strictEqual(cars.length, 22);
    assert.strictEqual(cars.filter((c) => c.isBot).length, 21);
    assert.strictEqual(cars.filter((c) => c.teamId === 'ferrari').length, 2);
    a.fire('disconnect');
    advance(t, 100);
});

test('bots keep their qualifying places on the race grid; the lobby clears them; the last human leaving stops it all', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = io.connect('a');
    a.fire('join_lobby', { username: 'A', teamId: 'ferrari' });
    a.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualiFormat: 'short', qualiScale: 0.02, aiDrivers: true, aiLevel: 'easy' });
    a.fire('start_game');
    const quali = io.events('game_init').at(-1);
    const botId = Object.keys(quali.players).find((id) => quali.players[id].isBot);
    Object.assign(quali.players[botId], { segBest: 70, segAt: 1 }); // pole for one bot
    advance(t, 13000 + 8000);
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(Object.keys(race.players).length, 22, 'bots made the race grid');
    assert.strictEqual(race.index[botId], 0, 'the pole bot starts first');
    a.fire('disconnect');
    const ticks = io.ticks;
    advance(t, 1000);
    assert.strictEqual(io.ticks, ticks, 'game stopped with no humans left');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/botSession.test.js`
Expected: FAIL (`cars.length` 1).

- [ ] **Step 3: Implement**

In `src/socketManager.js`:

1. Require: `const { fillGrid } = require('./game/bots/roster');`
2. `state`: add `bots: [],` after `hostId: null,`.
3. Helper below `lobbySnapshot`:
```js
// A car's driver: a human in the lobby, or one of this session's AI drivers
const driverById = (id) => state.players[id] || state.bots.find((b) => b.id === id);
```
4. In `start_game`, after the `overflow` handling and before `if (state.settings.qualifying)`:
```js
            state.bots = state.settings.aiDrivers ? fillGrid(racers, state.settings.aiLevel, Date.now()) : [];
            const grid = racers.concat(state.bots);
```
and pass `grid` instead of `racers` to `startQuali` / `startRace`.
5. In `startQuali`'s results callback replace `const grid = results.map(r => state.players[r.id]).filter(Boolean);` with `const grid = results.map((r) => driverById(r.id)).filter(Boolean);`.
6. In `restart_session` replace `.map((id) => state.players[id])` with `.map(driverById)`.
7. In `finishRace`'s `later(...)` callback add `state.bots = [];` before `io.emit('lobby_state_sync', ...)`; in `removePlayer`'s no-humans branch add `state.bots = [];` next to `state.status = 'LOBBY';`.

- [ ] **Step 4: Run tests**

Run: `node --test test/botSession.test.js && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/socketManager.js test/botSession.test.js
git commit -m "AI drivers: fill the grid at start, keep bots from qualifying to the race and on restart, clear them in the lobby"
```

---

### Task 8: Client — lobby controls, bot names, AI tag

**Files:**
- Modify: `public/index.html` (settings), `public/js/app.js` (settings), `public/js/socket.js` (`game_init`, `driverOf`), `public/js/game3d.js` (lookups, tags)
- Test: browser check (Step 5)

**Interfaces:**
- Consumes: `game_init` players with `isBot`, `username`, `teamId`, `color` (Tasks 2, 7).
- Produces: `clientState.bots`, `window.driverOf(id)`.

- [ ] **Step 1: Lobby controls**

`public/index.html`, directly after the closing `</label>` of the Collisions select:

```html
                                    <label>AI drivers
                                        <select id="setting-ai" title="Fill every free seat with AI drivers (up to 22 cars)">
                                            <option value="0" selected>Off</option>
                                            <option value="1">On</option>
                                        </select>
                                    </label>
                                    <label>AI level
                                        <select id="setting-ai-level">
                                            <option value="easy">Easy</option>
                                            <option value="medium" selected>Medium</option>
                                            <option value="hard">Hard</option>
                                            <option value="pro">Pro</option>
                                        </select>
                                    </label>
```

`public/js/app.js`:
- With the other `const set… = document.getElementById(...)` lines: `const setAi = document.getElementById('setting-ai');` and `const setAiLevel = document.getElementById('setting-ai-level');`
- In `emitSettings`'s object: `aiDrivers: setAi.value === '1', aiLevel: setAiLevel.value,`
- With the other listeners: `setAi.addEventListener('change', emitSettings); setAiLevel.addEventListener('change', emitSettings);`
- In `updateSettingsUI` after the `setPenalties.value` line: `setAi.value = clientState.settings.aiDrivers ? '1' : '0'; setAiLevel.value = clientState.settings.aiLevel || 'medium';`

Check how non-hosts see settings read-only (search `updateSettingsUI` for `disabled`); if selects are disabled by a selector or list, add the two new selects to it.

- [ ] **Step 2: Bot names on the client**

`public/js/socket.js`: in `clientState` add `bots: {},`. In the `game_init` handler, after `clientState.gameState = data.players;`:

```js
    // AI drivers aren't lobby players: their names, teams and colours come with the session
    clientState.bots = Object.fromEntries(Object.values(data.players).filter((p) => p.isBot)
        .map((p) => [p.id, { id: p.id, username: p.username, teamId: p.teamId, color: p.color, isBot: true }]));
```

and at file end:

```js
// A car's driver for names, teams and colours: a lobby player or an AI driver
window.driverOf = (id) => clientState.players[id] || clientState.bots[id];
```

- [ ] **Step 3: Use it in `game3d.js`**

Replace `clientState.players[X]` with `driverOf(X)` at each driver lookup (find them with `grep -n "clientState.players\[" public/js/game3d.js`): the lookups by `id`, `r.id`, `fl.id`, `spectateId`, `d.id`, `pole.id`, and the tower's `.filter(([id]) => clientState.players[id])` and `driverCode(clientState.players[id].username)`. Leave `clientState.players[clientState.me]` (own-player lookups at lines ~222 and ~678) unchanged. Add `const driverOf = (id) => window.driverOf(id);` near the top of the module.

Then the tag. Next to `const helpTags = …` add:

```js
const driverTags = (lp) => (lp?.isBot ? 'AI' : helpTags(lp?.assist)); // AI drivers say so instead of their help levels
```

and replace `helpTags(lp?.assist)` / `helpTags(lp.assist)` with `driverTags(lp)` in the quali results list, the race results row and the tower (three places).

- [ ] **Step 4: Unit tests still green**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Browser check**

Start a server and drive the page headless (no new dependencies):

```bash
PORT=3299 node server.js &
```

Use the CDP probe from the netcode work (headless Chrome with `--use-angle=metal`, joining via `socket.emit('join_lobby', …)`). Extend it to `socket.emit('update_settings', { qualifying: false, aiDrivers: true, aiLevel: 'hard', maxLaps: 3 })` before `start_game`, then after 20 s evaluate:

```js
({ cars: Object.keys(clientState.gameState).length,
   named: Object.keys(clientState.gameState).every((id) => window.driverOf(id)?.username),
   aiRows: [...document.querySelectorAll('#leaderboard-list .tt-tag.help')].filter((e) => e.textContent === 'AI').length,
   fps: window.lanraceFps })
```

Expected: `cars: 22`, `named: true`, `aiRows ≥ 9` (top-10 tower), `fps` ≈ 60, no console errors. Stop the server afterwards (`kill %1`).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/app.js public/js/socket.js public/js/game3d.js
git commit -m "AI drivers: lobby controls, bot names everywhere a driver is named, AI tag in tower and results"
```

---

### Task 9: Full-grid session, tick cost, final check

**Files:**
- Test: `test/botSession.test.js` (append)

- [ ] **Step 1: Write the test**

```js
// append to test/botSession.test.js
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const { fillGrid, rngOf } = require('../src/game/bots/roster');

test('21 bots race 3 laps of Monza: everyone classified, every bot pitted onto a second compound, tick under 4 ms', () => {
    const bots = fillGrid([], 'medium', 99).slice(0, 21);
    const io = { emit() {}, volatile: { emit() {} } };
    let done = false;
    const g = new Game(io, bots, Track.load('monza'), { maxLaps: 3, qualifying: false, tyreWear: true, collisions: true, ghostStart: true, rng: rngOf(1) }, () => { done = true; });
    g.release();
    let ms = 0, n = 0;
    for (let k = 0; k < 60 * 900 && !done; k++) {
        const t0 = process.hrtime.bigint();
        g.update();
        ms += Number(process.hrtime.bigint() - t0) / 1e6; n++;
    }
    assert.ok(done, 'race ended');
    const cars = Object.values(g.players);
    assert.ok(cars.every((p) => p.finished), 'all classified');
    const dnf = cars.filter((p) => p.dnf).length;
    assert.ok(dnf <= 1, `${dnf} DNFs`);
    assert.ok(cars.filter((p) => !p.dnf).every((p) => p.compoundsUsed.length >= 2), 'compound rule');
    assert.ok(ms / n < 4, `tick ${(ms / n).toFixed(2)} ms`);
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/botSession.test.js`
Expected: PASS. If DNFs > 1, look at which bots stalled (`p.bot`, `p.stop`, position) and fix the cause in `driver.js` / `strategy.js` (stuck behind a parked car → racecraft; stuck in the pit → `PIT_APPROACH_M` / release press). If the tick is over 4 ms, cache `insideSide` per path index in `lineOf` (it's the only per-tick search over the track).

- [ ] **Step 3: Full suite and final review**

Run: `npm test`
Expected: all PASS. Then run the browser check from Task 8 Step 5 once more with `aiLevel: 'pro'` and qualifying on (`qualiFormat: 'short'`), confirming the session goes QUALIFYING → QUALI_RESULTS → COUNTDOWN → RACE with 22 cars.

- [ ] **Step 4: Commit**

```bash
git add test/botSession.test.js
git commit -m "AI drivers: full-grid race test with tick-cost budget"
```
