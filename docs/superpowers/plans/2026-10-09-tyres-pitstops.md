# Tyres, Pit Stops & Pit Lane Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F1-lite tyre wear with compound strategy, real drive-in pit stops, and pit lanes on all 14 circuits that never overlap the racing surface.

**Architecture:** Tyre grip and wear live in the shared simulation (`public/js/sim/`), run identically by the server and the browser's prediction; the server owns stop decisions (trigger, service time, tyre swap, release) and sends their state in the existing fast packet. `Track.build` rebuilds each pit lane as entry connector + real garage lane + exit connector, with a per-point width that tapers to zero where it meets the road, so lane and road share only an edge.

**Tech Stack:** Node 24 (server, `node --test`), plain ES modules in the browser, three.js 0.186. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-tyres-pitstops-design.md`

## Global Constraints

- Compounds: `S { grip: 1.06, life: 0.40 }`, `M { grip: 1.00, life: 0.65 }`, `H { grip: 0.95, life: 0.90 }`.
- Grip from wear: −3.75 % per unit up to 0.8 (−3 % at 0.8), then a cliff to −12 % at 1.0.
- Life is the share of race distance (`maxLaps × lap length`) a set lasts at typical racing load.
- One-compound penalty: +22 s, races with `maxLaps ≥ 2` and `tyreWear` on.
- Stop: guide within 12 m before the box when braking (> 0.2) or below 40 km/h; service 2.5 s + 0–0.4 s; unsafe-release hold ≤ 0.5 s while a moving car is within 10 m behind the box.
- Pit lane: connector minimum radius ≥ 30 m; lane reaches full width within 60 m of each mouth; lane edge ≥ 1 m off the drawn road once at full width; lane asphalt never inside the drawn road.
- Compound keys 1 / 2 / 3 (Q, W, E are taken). Host setting `tyreWear` boolean, default true. Start compound default `M`.
- Shared sim stays deterministic: no `Math.random` in `public/js/sim/`; the server draws service times.
- Every step's tests: `npm test` must stay green at each commit (full suite, ~6 s).

## Review Focus

- **Car reaching its box from a pit entry it entered at speed** (late braking from 80 km/h): guide must still stop on the mark, not overshoot into the garage. Pinned in Task 6 (guided stop from 80 km/h).
- **Two team-mates stopping on the same lap**: each uses its own box (box 0 / box 1), no collision with the other. Pinned in Task 6 (team-mate boxes differ).
- **A car on track passing the pit entry flat out**: must not be slowed, walled, or flagged in-pit by the new taper geometry. Pinned in Task 4 (track car past the mouth keeps its speed).
- **Client prediction during a stop**: the predicted car must not drift while the server holds it stationary. Pinned in Task 6 (predictor stays put through service).
- **Tyre wear off**: no wear, no penalty, grip exactly the compound's. Pinned in Task 3.

---

### Task 1: Tyre model (pure)

**Files:**
- Create: `public/js/sim/tyres.js`
- Test: `test/tyres.test.js`

**Interfaces:**
- Produces: `COMPOUNDS`, `isCompound(c) → boolean`, `gripOf(compound, wear) → number`, `wearPerM(compound, lapM, laps) → number` (wear per metre at typical load), `wearLoad(latUse, brake, slip) → number` (≈1 for typical racing), `nextHarder(c) → 'M'|'H'`, `LOAD_TYPICAL` (number, calibrated in Task 3).

- [ ] **Step 1: Write the failing test**

```js
// test/tyres.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');
let T;
before(async () => { T = await import('../public/js/sim/tyres.js'); });

test('grip: soft > medium > hard when new', () => {
    assert.ok(T.gripOf('S', 0) > T.gripOf('M', 0) && T.gripOf('M', 0) > T.gripOf('H', 0));
    assert.strictEqual(T.gripOf('M', 0), 1);
});

test('grip from wear: -3 % at 0.8, -12 % at 1.0, clamped past it', () => {
    assert.ok(Math.abs(T.gripOf('M', 0.8) - 0.97) < 1e-9);
    assert.ok(Math.abs(T.gripOf('M', 1) - 0.88) < 1e-9);
    assert.strictEqual(T.gripOf('M', 1.5), T.gripOf('M', 1));
    assert.ok(T.gripOf('S', 0.9) < T.gripOf('S', 0.85)); // the cliff keeps falling
});

test('wear per metre: a set lasts its share of the race at typical load', () => {
    const lapM = 5000, laps = 10;
    for (const c of ['S', 'M', 'H']) {
        const metres = 1 / T.wearPerM(c, lapM, laps);
        assert.ok(Math.abs(metres - T.COMPOUNDS[c].life * lapM * laps) < 1e-6, c);
    }
});

test('wear load: harder driving wears faster, normalised by LOAD_TYPICAL', () => {
    assert.ok(T.wearLoad(0.9, 0, 0) > T.wearLoad(0.3, 0, 0));
    assert.ok(T.wearLoad(0.3, 1, 0) > T.wearLoad(0.3, 0, 0));
    assert.ok(T.wearLoad(0.3, 0, 0.21) > T.wearLoad(0.3, 0, 0));
    assert.ok(Math.abs(T.wearLoad(0, 0, 0) - 1 / T.LOAD_TYPICAL) < 1e-12);
});

test('next harder compound, and compound names', () => {
    assert.deepStrictEqual(['S', 'M', 'H'].map(T.nextHarder), ['M', 'H', 'M']);
    assert.ok(T.isCompound('S') && !T.isCompound('X') && !T.isCompound(undefined));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tyres.test.js`
Expected: FAIL, `Cannot find module '…/public/js/sim/tyres.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// public/js/sim/tyres.js
// F1-lite tyres: three compounds, grip that fades with wear and falls off a cliff near the end, wear scaled to the race
// (a set lasts `life` of the race distance at typical racing load). Shared by the server and the browser's prediction.
export const COMPOUNDS = { S: { grip: 1.06, life: 0.40 }, M: { grip: 1.00, life: 0.65 }, H: { grip: 0.95, life: 0.90 } };
const FADE = 0.0375, CLIFF_FROM = 0.8, CLIFF = 0.09;
// Mean raw load of a clean racing lap (Task 3 calibration), so typical driving wears at exactly 1 / life
export const LOAD_TYPICAL = 1;

export const isCompound = (c) => c === 'S' || c === 'M' || c === 'H';

export function gripOf(compound, wear) {
    const w = Math.max(0, Math.min(1, wear || 0));
    const cliff = w > CLIFF_FROM ? CLIFF * ((w - CLIFF_FROM) / (1 - CLIFF_FROM)) ** 2 : 0;
    return COMPOUNDS[compound].grip * (1 - FADE * Math.min(w, CLIFF_FROM) - cliff);
}

export const wearPerM = (compound, lapM, laps) => 1 / (COMPOUNDS[compound].life * lapM * laps);

// latUse: share of the cornering grip in use (0-1); brake: brake input (0-1); slip: slide angle (rad)
export const wearLoad = (latUse, brake, slip) => (1 + 0.6 * latUse * latUse + 0.4 * brake + 0.8 * Math.min(1, slip / 0.21)) / LOAD_TYPICAL;

export const nextHarder = (c) => (c === 'S' ? 'M' : c === 'M' ? 'H' : 'M');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tyres.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/sim/tyres.js test/tyres.test.js
git commit -m "Add F1-lite tyre model: compounds, wear grip curve, race-scaled wear"
```

---

### Task 2: Grip factor and load outputs in the physics step

**Files:**
- Modify: `public/js/sim/carphysics.js` (`step`, lines ~50-115)
- Test: `test/carPhysics.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `step()` reads `car.tyreGrip` (default 1) as a multiplier on asphalt grip, and writes `car.latUse` (0-1) and `car.slip` (rad) every call.

- [ ] **Step 1: Write the failing test** (append to `test/carPhysics.test.js`; it already imports `step` the same way its other tests do: check the top of the file and reuse that import)

```js
test('tyreGrip scales cornering: worn tyres run wide on the same input', () => {
    const run = (tyreGrip) => {
        const car = { x: 0, y: 0, angle: 0, vx: 50 * 6, vy: 0, speed: 50 * 6, steer: 0, tyreGrip };
        for (let k = 0; k < 120; k++) step(car, { throttle: 0.4, brake: 0, steer: 1 }, 1 / 60, 6);
        return car.angle;
    };
    assert.ok(run(0.88) < run(1) - 0.05, 'less grip, less rotation');
    assert.strictEqual(run(undefined), run(1));
});

test('step reports grip use and slip', () => {
    const car = { x: 0, y: 0, angle: 0, vx: 40 * 6, vy: 0, speed: 40 * 6, steer: 0 };
    step(car, { throttle: 0, brake: 0, steer: 0 }, 1 / 60, 6);
    assert.ok(car.latUse < 0.01 && car.slip < 0.01);
    for (let k = 0; k < 30; k++) step(car, { throttle: 0, brake: 0, steer: 1 }, 1 / 60, 6);
    assert.ok(car.latUse > 0.5 && car.latUse <= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/carPhysics.test.js`
Expected: FAIL (`run(0.88)` equals `run(1)`; `car.latUse` undefined)

- [ ] **Step 3: Implement**

In `step`, replace the first line:

```js
    const mu = offTrack ? C.GRASS_MU : C.MU * (car.tyreGrip ?? 1); // tyres.js: compound and wear
```

After `yaw = Math.max(-yawMax, Math.min(yawMax, yaw));` add:

```js
    // For tyre wear (drive.js): share of the cornering grip in use, and the slide angle
    car.latUse = Math.min(1, Math.abs(yaw * vf) / Math.max(latAccel, 1e-6));
    car.slip = slip;
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, including `simGolden.test.js` unchanged (tyreGrip absent = 1, and the new fields don't feed back into motion).

- [ ] **Step 5: Commit**

```bash
git add public/js/sim/carphysics.js test/carPhysics.test.js
git commit -m "Scale tyre grip per car and report grip use and slip from the physics step"
```

---

### Task 3: Tyre state on every car, wear per tick, sync and settings

**Files:**
- Modify: `public/js/sim/drive.js` (`driveCar`), `src/game/Game.js` (player init, `META_FIELDS`, `fastPacket`, new `setNextCompound`), `src/lobby.js` (`sanitizeSettings`, new `sanitizeCompound`), `src/socketManager.js` (`join_lobby`, new `set_compound`, `tyre_next`), `public/js/predict.js` (`load`, new `setTyres`), `public/js/game3d.js` (`game_meta` handling → predictor)
- Modify: `public/js/sim/tyres.js` (`LOAD_TYPICAL` value)
- Test: `test/tyres.test.js`, `test/game.test.js`, `test/drive.test.js`, `test/lobby.test.js`

**Interfaces:**
- Consumes: Task 1 exports; Task 2's `car.latUse`, `car.slip`, `car.tyreGrip`.
- Produces: player fields `compound`, `nextCompound` (null | S/M/H), `wear` (0-1), `wearPerM`, `tyreGrip`, `stops` (0), `compoundsUsed` (array); `Game#setNextCompound(id, c)`; `Game.tyreWearPerM(settings, track, compound)`; fast packet entry index 11 = wear (4 dp); meta fields add `compound`, `nextCompound`, `stops`, `compoundsUsed`, `wearPerM`; `Predictor#setTyres({ compound, wearPerM })`.

- [ ] **Step 1: Write the failing tests**

Append to `test/game.test.js` (it already defines `io`, `lp`, `RACE`, `monza`, `place`):

```js
test('tyres: cars start on their chosen compound (medium by default), wear scaled to the race', () => {
    const g = new Game(io, [{ ...lp('a'), compound: 'S' }, lp('b')], monza, { ...RACE, maxLaps: 10 }, () => {});
    const a = g.players.a, b = g.players.b, lapM = monza.cum[monza.path.length] / monza.scale;
    assert.strictEqual(a.compound, 'S'); assert.strictEqual(b.compound, 'M');
    assert.deepStrictEqual(a.compoundsUsed, ['S']);
    assert.ok(Math.abs(1 / a.wearPerM - 0.40 * lapM * 10) < 1e-6);
    assert.strictEqual(a.wear, 0); assert.strictEqual(a.tyreGrip, 1.06);
});

test('tyres: wear builds while driving and the fast packet carries it', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    g.frozen = false; p.input = { throttle: 1, brake: 0, steer: 0 };
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.ok(p.wear > 0 && p.tyreGrip < 1);
    const e = g.fastPacket().c.find((c) => c[0] === g.index.a);
    assert.strictEqual(e[11], +p.wear.toFixed(4));
});

test('tyres: wear off means no wear', () => {
    const g = new Game(io, [lp('a')], monza, { ...RACE, tyreWear: false }, () => {});
    const p = g.players.a;
    p.input = { throttle: 1, brake: 0, steer: 0 };
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.strictEqual(p.wear, 0); assert.strictEqual(p.tyreGrip, 1);
});

test('tyres: the next compound is validated and sent as meta', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.setNextCompound('a', 'H'); assert.strictEqual(g.players.a.nextCompound, 'H');
    g.setNextCompound('a', 'X'); assert.strictEqual(g.players.a.nextCompound, 'H');
    for (const f of ['compound', 'nextCompound', 'stops', 'compoundsUsed', 'wearPerM']) assert.ok(Game.META_FIELDS.includes(f), f);
});
```

Append to `test/lobby.test.js` (it requires `../src/lobby` as `lobby`: check the top and reuse):

```js
test('tyreWear setting and compound choice are sanitised', () => {
    const s = lobby.sanitizeSettings({ tyreWear: true }, { tyreWear: false }, ['monza']);
    assert.strictEqual(s.tyreWear, false);
    assert.strictEqual(lobby.sanitizeSettings({ tyreWear: true }, { tyreWear: 'no' }, ['monza']).tyreWear, true);
    assert.strictEqual(lobby.sanitizeCompound('S'), 'S');
    assert.strictEqual(lobby.sanitizeCompound('Z'), 'M');
});
```

Append to `test/drive.test.js` (extends the existing JSON round-trip parity idea to tyres):

```js
test('tyre wear is identical on the server and the client copy of the track', () => {
    const t = Track.load('suzuka'), wire = JSON.parse(JSON.stringify(t));
    const a = { ...JSON.parse(JSON.stringify(t.startPositions[0])), vx: 0, vy: 0, speed: 0, steer: 0, assist: 'full', tow: 0,
        compound: 'S', wear: 0, wearPerM: 1 / 3000, tyreGrip: 1.06 };
    a.lastSafeX = a.x; a.lastSafeY = a.y;
    const b = { ...a };
    for (let k = 0; k < 900; k++) {
        const input = { steer: Math.sin(k / 40), throttle: 1, brake: k % 200 > 180 ? 1 : 0, drs: false };
        D.driveCar(a, input, t, 1 / 60); D.driveCar(b, input, wire, 1 / 60);
    }
    assert.ok(a.wear > 0);
    for (const f of ['x', 'y', 'wear', 'tyreGrip']) assert.strictEqual(b[f], a[f], f);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the new tests FAIL (`compound` undefined, `sanitizeCompound` not a function, `wear` undefined)

- [ ] **Step 3: Implement the shared wear update**

`public/js/sim/drive.js`: add the import and, in `driveCar` right after `step(p, used, dt, scale, grass, p.assist);`:

```js
import { gripOf, wearLoad } from './tyres.js';
```

```js
    // Tyres wear with distance, harder the more grip is in use (tyres.js); grip follows
    if (p.compound) {
        const metres = Math.hypot(p.x - x0, p.y - y0) / scale;
        p.wear = Math.min(1, (p.wear || 0) + metres * (p.wearPerM || 0) * wearLoad(p.latUse || 0, used.brake || 0, p.slip || 0));
        p.tyreGrip = gripOf(p.compound, p.wear);
    }
```

- [ ] **Step 4: Implement server state, packet and meta**

`src/game/Game.js`:

```js
const Tyres = require('../../public/js/sim/tyres.js');
```

Add to `META_FIELDS`: `'compound', 'nextCompound', 'stops', 'compoundsUsed', 'wearPerM'`.

Add the static helper next to `garageSlots`:

```js
    // Wear per metre for a compound in this session (0 with tyre wear off)
    static tyreWearPerM(settings, track, compound) {
        if (settings.tyreWear === false) return 0;
        return Tyres.wearPerM(compound, track.cum[track.path.length] / track.scale, settings.maxLaps || 1);
    }
```

In the constructor's player object, after `tow: 0, lapS: null,` add:

```js
                ...(() => {
                    const compound = Tyres.isCompound(p.compound) ? p.compound : 'M';
                    return { compound, nextCompound: null, wear: 0, wearPerM: Game.tyreWearPerM(settings, track, compound),
                        tyreGrip: Tyres.gripOf(compound, 0), stops: 0, compoundsUsed: [compound] };
                })(),
```

In `fastPacket`, append `+(p.wear || 0).toFixed(4)` after `p.lastSeq` in the pushed array.

Add the method after `handleInputs`:

```js
    setNextCompound(id, c) {
        const p = this.players[id];
        if (p && Tyres.isCompound(c)) p.nextCompound = c;
    }
```

- [ ] **Step 5: Implement lobby and socket plumbing**

`src/lobby.js`, in `sanitizeSettings` before `return next;`:

```js
    if (typeof incoming.tyreWear === 'boolean') next.tyreWear = incoming.tyreWear;
```

and add (export it in `module.exports`):

```js
// Start / next tyre compound: S, M or H (medium unless valid)
const sanitizeCompound = (c) => (c === 'S' || c === 'M' || c === 'H' ? c : 'M');
```

`src/socketManager.js`: in `join_lobby`'s new player object add `compound: lobby.sanitizeCompound(data.compound),`; add the default `tyreWear: true` wherever `state.settings` is first defined (search `collisions: true` in that file and add beside it); add handlers next to `set_assist`:

```js
        socket.on('set_compound', (c) => {
            const player = state.players[socket.id];
            if (!player) return;
            player.compound = lobby.sanitizeCompound(c); // start compound for the next session
            io.emit('lobby_state_sync', lobbySnapshot());
        });

        socket.on('tyre_next', (c) => gameInstance?.setNextCompound(socket.id, c));
```

Ensure the racer objects passed to `new Game` carry `compound` (they are the lobby player objects from `pickRacers`, so `compound` rides along; confirm by reading `startQuali` / `startRace` and the grid built from quali results, and copy `compound` there if the grid builds new objects).

- [ ] **Step 6: Implement prediction**

`public/js/predict.js`: in `load(e)` add `c.wear = e[11] ?? c.wear ?? 0;` and add:

```js
    // Compound and wear rate from the server's meta: the predicted car wears and grips exactly like the server's
    setTyres({ compound, wearPerM }) {
        this.tyres = { compound, wearPerM };
        if (this.car) Object.assign(this.car, this.tyres);
    }
```

In `reset(e)`, after `this.car = { assist: this.assist };` add `if (this.tyres) Object.assign(this.car, this.tyres);`.

`public/js/game3d.js`: where `game_meta` diffs are merged into `clientState.gameState` (search `game_meta`), after merging, if the diff has `compound` or `wearPerM` for `clientState.me`, call:

```js
predictor?.setTyres({ compound: me.compound, wearPerM: me.wearPerM }); // me = clientState.gameState[clientState.me]
```

and right after `predictor = new Predictor(…)` (line ~2081) call the same with the player's initial values from `clientState.gameState[clientState.me]`.

- [ ] **Step 7: Calibrate LOAD_TYPICAL and pin the stint lengths**

Run this script (save as `scripts/calibrate-tyres.js`; it stays as the documented calibration tool):

```js
// node scripts/calibrate-tyres.js: mean raw tyre load (tyres.js wearLoad × LOAD_TYPICAL) over a clean lap on each circuit,
// driven by the steering assist's own bot (steer at the centreline 3 points ahead, throttle to the safe speed)
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
(async () => {
    const D = await import('../public/js/sim/drive.js'), T = await import('../public/js/sim/tyres.js');
    const means = [];
    for (const id of Track.TRACK_IDS) {
        const t = Track.load(id), s = t.startPositions[0];
        const p = { x: s.x, y: s.y, angle: s.angle, vx: 0, vy: 0, speed: 0, steer: 0, assist: 'full', tow: 0, lastSafeX: s.x, lastSafeY: s.y };
        let sum = 0, metres = 0;
        const total = t.cum[t.path.length] / t.scale;
        while (metres < total) {
            const n = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), ah = t.path[(n.i + 3) % t.path.length];
            let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            const v = Math.hypot(p.vx, p.vy) / t.scale, want = t.safeSpeed[(n.i + 2) % t.path.length];
            const input = { steer: Math.max(-1, Math.min(1, d * 3)), throttle: v < want ? 1 : 0, brake: v > want + 2 ? 1 : 0, drs: false };
            const x0 = p.x, y0 = p.y;
            D.driveCar(p, input, t, 1 / 60);
            const m = Math.hypot(p.x - x0, p.y - y0) / t.scale;
            sum += m * T.wearLoad(p.latUse || 0, input.brake, p.slip || 0) * T.LOAD_TYPICAL; metres += m;
        }
        means.push(sum / metres);
        console.log(id.padEnd(12), (sum / metres).toFixed(3));
    }
    console.log('LOAD_TYPICAL =', (means.reduce((a, b) => a + b, 0) / means.length).toFixed(2));
})();
```

Run: `node scripts/calibrate-tyres.js`
Set `LOAD_TYPICAL` in `public/js/sim/tyres.js` to the printed value (two decimals). Then add to `test/tyres.test.js`:

```js
test('calibrated: a clean lap wears each circuit at its typical rate (±15 %)', async () => {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('node', ['scripts/calibrate-tyres.js'], { encoding: 'utf8' });
    const per = out.split('\n').filter((l) => /^\w+\s+\d/.test(l)).map((l) => +l.trim().split(/\s+/)[1]);
    assert.strictEqual(per.length, 14);
    for (const v of per) assert.ok(Math.abs(v / T.LOAD_TYPICAL - 1) < 0.15, `${v} vs ${T.LOAD_TYPICAL}`);
});
```

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: PASS. `simGolden.test.js` still passes because golden cars have no `compound` (no wear update, `tyreGrip` undefined = 1).

- [ ] **Step 9: Commit**

```bash
git add public/js/sim/drive.js public/js/sim/tyres.js public/js/predict.js public/js/game3d.js src/game/Game.js src/lobby.js src/socketManager.js scripts/calibrate-tyres.js test/
git commit -m "Wear tyres every tick in the shared sim and sync compound and wear"
```

---

### Task 4: Pit lane rebuild: connectors, taper, continuous pit wall

**Files:**
- Modify: `src/game/Track.js` (`buildPit`, constants block), `public/js/sim/physics.js` (new `nearestOnPathHint`; `src/game/Physics.js` re-exports this class), `public/js/sim/drive.js` (pit width per point, closure removed, hint), `src/game/RacingLine.js` (remove `pitWindow`)
- Test: `test/track.test.js`, `test/game.test.js`, `test/scenery.test.js`

**Interfaces:**
- Consumes: existing `cumulative`, `pointAt`, `lateral`, `along`, `Physics.nearestOnTrack`, `Physics.nearestOnPath`.
- Produces: `pit.path` (connector + lane + connector, points ~4 m apart), `pit.widthAt[]` (world units, 0 at each mouth), `pit.cum`, `pit.len`, `pit.entryS`, `pit.exitS`, `pit.span`, `pit.trackSide`, `pit.wall` (one polyline), `pit.garages`, `pit.garageSpan`, `pit.limStart`, `pit.limEnd`, `pit.startOnPit`, `pit.limitKmh`. **Removed:** `pit.closeS`, `pit.closeWall`, `pit.width` stays (full lane width). `Physics.nearestOnPathHint(x, y, path, hint, closed = false)`. Car field `p.pitI` (last lane segment).

- [ ] **Step 1: Write the failing geometry tests**

In `test/track.test.js` replace the test `pit entry closed just before the first garage` (lines ~55-61) and the `pit entry barrier reaches past the track run-off` loop (lines ~223-228) with:

```js
    test(`${id}: pit lane only meets the road at its two mouths, at full width with room for the wall`, () => {
        const pit = t.pit, half = t.width / 2;
        pit.path.forEach((q, i) => {
            const d = Physics.nearestOnTrack(q.x, q.y, t).dist;
            assert.ok(d - pit.widthAt[i] / 2 >= half - 0.01 * t.scale, `lane asphalt on the road at ${(pit.cum[i] / t.scale).toFixed(0)} m`);
            if (pit.widthAt[i] >= pit.width - 1e-6) assert.ok(d - pit.width / 2 >= half + 1 * t.scale - 1e-6, `no room for the pit wall at ${(pit.cum[i] / t.scale).toFixed(0)} m`);
        });
        const full = (i) => pit.widthAt[i] >= pit.width - 1e-6;
        const first = pit.widthAt.findIndex((_, i) => full(i)), last = pit.widthAt.length - 1 - [...pit.widthAt].reverse().findIndex((_, i) => full(pit.widthAt.length - 1 - i));
        assert.ok(pit.cum[first] <= 60 * t.scale && pit.len - pit.cum[last] <= 60 * t.scale, 'full width within 60 m of each mouth');
        assert.strictEqual(pit.widthAt[0], 0); assert.strictEqual(pit.widthAt.at(-1), 0);
        assert.ok(!('closeWall' in pit) && !('closeS' in pit));
    });

    test(`${id}: pit lane is smooth (radius ≥ 30 m on the connectors) and never crosses itself`, () => {
        const P = t.pit.path, n = P.length;
        for (let i = 2; i < n - 2; i++) {
            const a = P[i - 2], b = P[i], c = P[i + 2];
            const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
            const cr = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
            if (cr && t.pit.widthAt[i] < t.pit.width - 1e-6) assert.ok((ab * bc * ca) / (2 * cr) >= 30 * t.scale - 1e-6, `tight connector at ${i}`);
        }
        for (let i = 0; i + 1 < n; i++) for (let j = i + 2; j + 1 < n; j++) {
            const p = P[i], q = P[i + 1], r = P[j], s = P[j + 1];
            const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
            if (!d) continue;
            const u = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, v = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
            assert.ok(!(u > 0 && u < 1 && v > 0 && v < 1), `lane crosses itself at ${i}/${j}`);
        }
    });

    test(`${id}: pit wall runs the whole full-width lane on the track side`, () => {
        const pit = t.pit, sOf = (w) => { const k = Physics.nearestOnPath(w.x, w.y, pit.path, false); return pit.cum[k.i] + k.t * (pit.cum[k.i + 1] - pit.cum[k.i]); };
        const full = pit.widthAt.map((w) => w >= pit.width - 1e-6), first = full.indexOf(true), last = full.lastIndexOf(true);
        assert.ok(sOf(pit.wall[0]) <= pit.cum[first] + 5 * t.scale && sOf(pit.wall.at(-1)) >= pit.cum[last] - 5 * t.scale);
        for (const w of pit.wall) assert.ok(Physics.nearestOnTrack(w.x, w.y, t).dist >= t.width / 2, 'wall on the road');
    });
```

Delete from `test/track.test.js` the assertion block that used `garageSpan` vs `wall` gap (lines ~122-128, `wall gap beside the garages`): the wall no longer has a gap (garages open on the far side).

- [ ] **Step 2: Write the failing behaviour tests**

In `test/game.test.js`, replace the four closure tests (`pit entry is closed…`, `…kerb beside the closed pit entry…` loop, `the closed pit entry is not pit lane…`, `walls stop the car body… pit entry barrier`) with:

```js
test('pit entry is open: a car drives down the lane past the garages under the limiter', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a, pit = monza.pit;
    place(p, pitPoint(pit.cum[3]), 20);
    for (let k = 0; k < 60 * 25 && pitS(p) < pit.garageSpan[1]; k++) {
        const ah = pitPoint(Math.min(pit.len, pitS(p) + 15 * monza.scale));
        let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
        p.input = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, d * 2)) };
        g.drive(p);
        if (pitS(p) > pit.limStart + 20 * monza.scale && pitS(p) < pit.limEnd) assert.ok(p.limiter, 'limiter on');
    }
    assert.ok(pitS(p) >= pit.garageSpan[1], 'got past the garages');
});

for (const id of Track.TRACK_IDS) {
    test(`${id}: a car racing past the pit entry on the track keeps its speed and stays out of the pit lane`, () => {
        const tr = Track.load(id), pit = tr.pit, g = new Game(io, [lp('a')], tr, RACE, () => {});
        const p = g.players.a, s0 = pit.entryS - 80 * tr.scale, q = Track.pointAt(tr.path, tr.cum, s0);
        let safe = 80;
        for (let m = -80; m <= 80; m += 10) safe = Math.min(safe, 0.9 * tr.safeSpeed[Physics.nearestOnTrack(...Object.values(Track.pointAt(tr.path, tr.cum, s0 + (80 + m) * tr.scale)).slice(0, 2), tr).i]);
        const v = safe * tr.scale;
        Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v });
        for (let n = 0; n < 90; n++) {
            const near = Physics.nearestOnTrack(p.x, p.y, tr), ah = Track.pointAt(tr.path, tr.cum, tr.cum[near.i] + 20 * tr.scale);
            let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            p.input = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, d * 2)) };
            g.drive(p);
            assert.ok(!p.inPit && !p.limiter, 'flagged in the pit lane');
        }
        assert.ok(p.speed > 0.8 * v, `${(p.speed / tr.scale * 3.6).toFixed(0)} km/h left`);
    });
}

test('pit wall: a car on the track can\'t cut into the pit lane beside the garages', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a, pit = monza.pit, mid = pitPoint((pit.garageSpan[0] + pit.garageSpan[1]) / 2);
    const n = Physics.nearestOnTrack(mid.x, mid.y, monza), q = Track.pointAt(monza.path, monza.cum, monza.cum[n.i]);
    const toPit = Math.atan2(mid.y - q.y, mid.x - q.x);
    place(p, { x: q.x, y: q.y, angle: toPit }, 15);
    p.input = { throttle: 1, brake: 0, steer: 0 };
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.ok(!p.inPit, 'went through the pit wall');
});
```

In `test/scenery.test.js` line ~114 replace `if (pit.cum[i] < pit.closeS) continue;` with `if (pit.widthAt[i] < pit.width) continue; // the tapered mouths join the road`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (`pit.widthAt` undefined, `closeWall` present, connectors absent)

- [ ] **Step 4: Implement `nearestOnPathHint`** in `public/js/sim/physics.js`, next to `nearestOnTrack` (`src/game/Physics.js` re-exports this class, so the server gets it too):

```js
    // Nearest point on an open polyline, searching ±HINT_SPAN segments around the last one; full search as the fallback
    static nearestOnPathHint(x, y, path, hint, closed = false) {
        const m = closed ? path.length : path.length - 1;
        if (hint === undefined || hint === null || m < 2 * HINT_SPAN) return this.nearestOnPath(x, y, path, closed);
        let bd2 = Infinity, bi = 0, bt = 0, bx = x, by = y;
        for (let k = Math.max(0, hint - HINT_SPAN); k <= Math.min(m - 1, hint + HINT_SPAN); k++) {
            const v = path[k], w = path[(k + 1) % path.length], ex = w.x - v.x, ey = w.y - v.y, l2 = ex * ex + ey * ey;
            const t = l2 ? Math.max(0, Math.min(1, ((x - v.x) * ex + (y - v.y) * ey) / l2)) : 0, px = v.x + t * ex, py = v.y + t * ey;
            const d2 = (x - px) ** 2 + (y - py) ** 2;
            if (d2 < bd2) { bd2 = d2; bi = k; bt = t; bx = px; by = py; }
        }
        if (bi === Math.max(0, hint - HINT_SPAN) || bi === Math.min(m - 1, hint + HINT_SPAN)) return this.nearestOnPath(x, y, path, closed); // at the window's edge: may be outside it
        return { dist: Math.sqrt(bd2), px: bx, py: by, i: bi, t: bt };
    }
```

- [ ] **Step 5: Implement the rebuilt `buildPit`** in `src/game/Track.js`. Replace the constants `CLOSE_RAMP_M`, `WALL_CLEAR_M` with:

```js
const PIT_CLEAR_M = 1;          // the lane's edge this far off the drawn road wherever it is full width (room for the pit wall)
const CONNECTOR_R_M = 30;       // entry / exit curves no tighter than this
const TAPER_MAX_M = 60;         // a mouth reaches full lane width within this
const MOUTH_STEP_M = 5, MOUTH_MAX_M = 300; // mouths tried further from the garages until a connector fits
const PIT_STEP_M = 4;           // spacing of the rebuilt lane's points
```

Add helpers above `buildPit`:

```js
// Cubic Bézier a→d with handles b, c, sampled every `step` world units (by arc length, approximately)
function bezier(a, b, c, d, step) {
    const at = (u) => { const v = 1 - u; return { x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x, y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y }; };
    const fine = Array.from({ length: 201 }, (_, k) => at(k / 200)), out = [fine[0]];
    let acc = 0;
    for (let k = 1; k < fine.length; k++) {
        acc += Math.hypot(fine[k].x - fine[k - 1].x, fine[k].y - fine[k - 1].y);
        if (acc >= step) { out.push(fine[k]); acc = 0; }
    }
    if (out.at(-1) !== fine.at(-1)) out.push(fine.at(-1));
    return out;
}
// Smallest circumradius over every point and its neighbours two away
function minRadius(P) {
    let r = Infinity;
    for (let i = 2; i + 2 < P.length; i++) {
        const a = P[i - 2], b = P[i], c = P[i + 2];
        const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
        const cr = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        if (cr) r = Math.min(r, (ab * bc * ca) / (2 * cr));
    }
    return r;
}
```

Replace the body of `buildPit` with:

```js
function buildPit(raw, circuit, track) {
    const { scale, width } = raw, full = raw.pit.width, roadHalf = width / 2, lane = raw.pit.path;
    const rawCum = cumulative(lane), total = track.cum[track.path.length];
    const trackS = (p) => along(track.cum, Physics.nearestOnPath(p.x, p.y, track.path));
    const clear = (p) => Physics.nearestOnTrack(p.x, p.y, track).dist - roadHalf; // from the drawn road edge
    const dirAt = (P, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };

    // The garage lane: the longest run of the surveyed lane at full width with room for the wall
    const ok = lane.map((p) => clear(p) >= full / 2 + PIT_CLEAR_M * scale);
    let a = 0, b = -1;
    for (let i = 0, from = 0; i < lane.length; i++) {
        if (!ok[i]) { from = i + 1; continue; }
        if (i - from > b - a) { a = from; b = i; }
    }
    if (b <= a) throw new Error(`${raw.id}: no stretch of pit lane clear of the road`);
    const mid = lane[(a + b) >> 1], mn = Physics.nearestOnPath(mid.x, mid.y, track.path), mp = pointAt(track.path, track.cum, along(track.cum, mn));
    const laneSide = Math.sign(-Math.sin(mp.angle) * (mid.x - mp.x) + Math.cos(mp.angle) * (mid.y - mp.y)) || 1; // lateral() sign of the lane

    // A connector from the road edge at lap distance s (tangent to the road) to lane point k (tangent to the lane)
    const connector = (s, k, entry) => {
        const e = lateral(pointAt(track.path, track.cum, s), laneSide * roadHalf), ed = { x: Math.cos(e.angle), y: Math.sin(e.angle) };
        const q = lane[k], qd = dirAt(lane, k), h = 0.4 * Math.hypot(q.x - e.x, q.y - e.y);
        return entry ? bezier(e, { x: e.x + ed.x * h, y: e.y + ed.y * h }, { x: q.x - qd.x * h, y: q.y - qd.y * h }, q, PIT_STEP_M * scale)
            : bezier(q, { x: q.x + qd.x * h, y: q.y + qd.y * h }, { x: e.x - ed.x * h, y: e.y - ed.y * h }, e, PIT_STEP_M * scale);
    };
    // Fits: smooth enough, never on the road, full width within TAPER_MAX_M of the mouth
    const fits = (C, entry) => {
        if (minRadius(C) < CONNECTOR_R_M * scale) return false;
        let dist = 0, opened = false;
        const seq = entry ? C : [...C].reverse();
        for (let i = 0; i < seq.length; i++) {
            if (i) dist += Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y);
            const c = clear(seq[i]);
            if (c < -0.01 * scale) return false;
            if (c >= full / 2 + PIT_CLEAR_M * scale) opened = true;
            else if (opened) return false;              // once open it stays open
            if (!opened && dist > TAPER_MAX_M * scale) return false;
        }
        return opened;
    };
    const mouth = (k, entry) => {
        const s0 = trackS(lane[entry ? 0 : lane.length - 1]);
        for (let m = 0; m <= MOUTH_MAX_M; m += MOUTH_STEP_M) {
            const s = (((s0 + (entry ? -m : m) * scale) % total) + total) % total, C = connector(s, k, entry);
            if (fits(C, entry)) return { s, C };
        }
        throw new Error(`${raw.id}: no pit ${entry ? 'entry' : 'exit'} connector fits`);
    };
    const en = mouth(a, true), ex = mouth(b, false);
    const pts = [...en.C, ...lane.slice(a + 1, b), ...ex.C].map(({ x, y }) => ({ x, y }));
    const cum = cumulative(pts), len = cum[pts.length - 1];
    const widthAt = pts.map((p) => Math.max(0, Math.min(full, 2 * clear(p))));
    widthAt[0] = 0; widthAt[pts.length - 1] = 0;
    const entryS = en.s, exitS = ex.s, span = (((exitS - entryS) % total) + total) % total;
    const onPit = (rawM) => { const p = pointAt(lane, rawCum, rawM * scale, false); return along(cum, Physics.nearestOnPath(p.x, p.y, pts, false)); };

    const startOnPit = along(cum, Physics.nearestOnPath(track.start.x, track.start.y, pts, false));
    const sp = pointAt(pts, cum, startOnPit, false);
    const trackSide = Math.sign(-Math.sin(sp.angle) * (track.start.x - sp.x) + Math.cos(sp.angle) * (track.start.y - sp.y)) || 1;

    // Pit wall: the track-side edge of the full-width lane, one polyline
    const isFull = (i) => widthAt[i] >= full - 1e-6;
    const w0 = widthAt.findIndex((_, i) => isFull(i)), w1 = widthAt.length - 1 - [...widthAt].reverse().findIndex((_, i) => isFull(widthAt.length - 1 - i));
    const wall = [];
    for (let i = w0; i <= w1; i++) { const w = lateral(pointAt(pts, cum, cum[i], false), trackSide * full / 2); wall.push({ x: w.x, y: w.y }); }

    // Limiter: circuits.json metres along the surveyed lane, onto the rebuilt one, inside the walled stretch
    const limStart = Math.max(cum[w0], onPit(circuit.limiterStartM ?? 0));
    const limEnd = Math.min(cum[w1], circuit.limiterEndM != null ? onPit(circuit.limiterEndM) : cum[w1]);

    // Garages centred on the start line (slid to stay beside the wall), garage 1 nearest the exit unless garagesFrom: "entry"
    const dir = circuit.garagesFrom === 'entry' ? -1 : 1, pitch = GARAGE_PITCH_M * scale, reach = 5.5 * pitch, margin = reach + 5 * scale;
    const centre = Math.max(cum[w0] + margin, Math.min(startOnPit, cum[w1] - margin));
    const garages = GARAGE_ORDER.map((teamId, k) => {
        const s = centre + dir * (5 - k) * pitch, c = pointAt(pts, cum, s, false);
        const boxes = [-1, 1].map((d) => { const bs = s + (d * BOX_GAP_M * scale) / 2; return { ...lateral(pointAt(pts, cum, bs, false), (-trackSide * full / 2) / 2), s: bs }; });
        return { teamId, s, x: c.x, y: c.y, angle: c.angle, boxes };
    });
    return { path: pts, width: full, widthAt, cum, len, entryS, exitS, span, startOnPit, trackSide, limStart, limEnd, wall, garages,
        garageSpan: [centre - reach, centre + reach], fitM: raw.pit.fitM, limitKmh: circuit.pitLimitKmh || null };
}
```

Note: boxes now carry `s` (lane distance) for Task 6.

- [ ] **Step 6: Update `drive.js` for per-point width, the hint, and no closure**

Add helper below `pitAlong`:

```js
// Half the lane's width at a nearestOnPath result (0 at the mouths: the lane tapers into the road edge)
export const pitHalf = (pit, n) => (pit.widthAt[n.i] + (pit.widthAt[Math.min(n.i + 1, pit.widthAt.length - 1)] - pit.widthAt[n.i]) * n.t) / 2;
```

In `updatePitState`: `p.inPit = nearPit.dist <= pitHalf(pit, nearPit) && near.dist > t.width / 2;`

In `driveCar`:
- `nearPit` becomes `(x, y) => (!pit ? null : nearPitBox(pit, x, y) ? Physics.nearestOnPathHint(x, y, pit.path, p.pitI) : FAR_PIT)`, and after `const after = …, afterPit = nearPit(p.x, p.y);` add `if (afterPit && afterPit !== FAR_PIT) p.pitI = afterPit.i;`
- `grass`: `… && !(beforePit && beforePit.dist <= pitHalf(pit, beforePit))`
- Pit wall: `const hit = pit && Physics.crossWall(x0, y0, p.x, p.y, pit.wall);` and delete the `closeWall` overlap lines (the `ponytail` comment and `wallOverlap(p, pit.closeWall…)`).
- Barrier: `const pitDist = (n) => pitHalf(pit, n) + PIT_RUNOFF_M * scale;` then `overPit = afterPit ? afterPit.dist - pitDist(afterPit) : Infinity`, `inPitLane = edgePit && edgePit.dist + reach(edgePit) <= pitDist(edgePit)`, and the final condition `!(edgePit && edgePit.dist <= pitDist(edgePit))`; `lim` for the pit case uses `pitDist(near)`. Delete `afterS` and every `>= pit.closeS` condition.

- [ ] **Step 7: Remove the closed-entry racing-line guard**

In `src/game/RacingLine.js` delete `pitWindow`, its constants (`PIT_RAMP_M`, `PIT_MARGIN_M`) and the `if (t.pit) { … }` block in `compute`.

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: PASS on all 14 circuits. If a circuit throws `no pit entry/exit connector fits`, print that circuit's `clear()` profile along the lane and widen `MOUTH_MAX_M` for it only via `circuits.json` `pitMouthMaxM` (read as `circuit.pitMouthMaxM ?? MOUTH_MAX_M`); record the reason in that circuit's `sources`.

- [ ] **Step 9: Commit**

```bash
git add src/game/Track.js public/js/sim/physics.js public/js/sim/drive.js src/game/RacingLine.js test/
git commit -m "Rebuild pit lanes with tapered entry and exit connectors that never overlap the road"
```

---

### Task 5: Draw the rebuilt pit lane

**Files:**
- Modify: `public/js/game3d.js` (`buildPit` ~line 635, `heights()` ~line 385, minimap ~line 1924)
- Test: real game in the browser (Task 8) plus `node --check public/js/game3d.js`

**Interfaces:**
- Consumes: Task 4's `pit.widthAt`, `pit.wall`, `pit.limStart`, `pit.limEnd`; no `closeS` / `closeWall`.

- [ ] **Step 1: Rewrite the top of `buildPit`** (from `const n = pit.path.length…` through the outer-wall line) to:

```js
function buildPit(pit, t) {
    const n = pit.path.length, s = pit.trackSide, line = 0.3 * scale;
    const W = pit.widthAt, half = W.map((w) => w / 2), neg = (A) => A.map((v) => -v);
    const inner = (i) => i >= 1 && i <= n - 3; // end segments would use wrapped normals
    const fullAt = (i) => W[i] >= pit.width - 1e-6;
    // The lane: per-point width, 0 where it joins the road edge, so it never lies over the racing surface
    world.add(strip(pit.path, neg(half), half, 0.55, inner, solid('#3a3f47')));
    // White edges: the outer one all along; the track-side one is the blend line in the mouths and the pit-wall line beside it
    const inL = half.map((h) => h - line), inR = half.map((h) => -h + line);
    world.add(strip(pit.path, inL, half, 0.85, (i) => inner(i) && W[i] > line, solid('#f2f2f2')));
    world.add(strip(pit.path, neg(half), inR, 0.85, (i) => inner(i) && W[i] > line, solid('#f2f2f2')));

    // Pit wall on the track side; outer wall behind the lane except where the garages open onto it
    world.add(wall(pit.wall, 0, 1 * scale, (i) => i < pit.wall.length - 1, solid('#9aa0a6')));
    const [lo, hi] = pit.garageSpan, back = half.map((h) => -s * (h + PIT_RUNOFF_M * scale));
    world.add(wall(pit.path, back, 1 * scale, (i) => inner(i) && fullAt(i) && fullAt(i + 1) && (pit.cum[i + 1] < lo || pit.cum[i] > hi), solid('#9aa0a6')));
```

- [ ] **Step 2: Remove closure drawing.** Delete the `board(pit.closeS - 15 * scale, 'PIT CLOSED', …)` line and the `world.add(wall(pit.closeWall, …))` line; change `board(Math.max(pit.limStart, pit.closeS), …)` to `board(pit.limStart, …)` and `for (const s0 of [Math.max(pit.limStart, pit.closeS), pit.limEnd])` to `for (const s0 of [pit.limStart, pit.limEnd])`.

- [ ] **Step 3: `heights()`**: change `(path === elev.pit.wall || path === elev.pit.closeWall)` to `path === elev.pit.wall`.

- [ ] **Step 4: Minimap**: replace `t.pit.path.filter((_, i) => t.pit.cum[i] >= t.pit.closeS)` with `t.pit.path`.

- [ ] **Step 5: Verify**

Run: `node --check public/js/game3d.js && grep -n "closeS\|closeWall" public/js/*.js public/js/sim/*.js src/game/*.js`
Expected: syntax OK; grep prints nothing.
Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add public/js/game3d.js
git commit -m "Draw pit lanes with tapered mouths, blend lines and one continuous pit wall"
```

---

### Task 6: Pit stops: guide, service, release, penalty

**Files:**
- Modify: `public/js/sim/drive.js` (new `guideToBox`, stop handling in `driveCar`), `src/game/Game.js` (boxes for all modes, `updateStop`, `serviceTyres`, packet stop fields, penalty at finish, rng), `public/js/predict.js` (`load` stop fields)
- Test: `test/pitstop.test.js` (new), `test/game.test.js`

**Interfaces:**
- Consumes: Task 3 tyre fields and `setNextCompound`; Task 4 `pit.garages[].boxes[]` with `{ x, y, angle, s }`, `p.pitS`, `p.inPit`.
- Produces: player fields `box` ({x, y, angle, s}), `stop` (null | { phase: 'guide'|'service'|'hold', t }), `servicedLap`; fast packet index 12 = stop code (0 none, 1 guide, 2 service, 3 hold), index 13 = `stop.t` (1 dp); `Game` option `settings.rng` (function, default `Math.random`); `guideToBox(p, t) → input`.

- [ ] **Step 1: Write the failing tests**

```js
// test/pitstop.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');
const io = { emit() {}, volatile: { emit() {} } };
const lp = (id, teamId = 'redbull', extra = {}) => ({ id, username: id, teamId, assist: 'full', ...extra });
const RACE = { maxLaps: 3, qualifying: false, rng: () => 0.5 };
let D;
before(async () => { D = await import('../public/js/sim/drive.js'); });

const pitPoint = (t, s) => Track.pointAt(t.pit.path, t.pit.cum, s, false);
// Drive along the lane centre to the limiter speed, braking from 15 m before the box (as a driver stopping would)
function lanePilot(g, p, t, brakeFor = true) {
    const sc = t.scale, ah = pitPoint(t, Math.min(t.pit.len, p.pitS + 12 * sc));
    let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
    const near = brakeFor && p.box.s - p.pitS < 15 * sc && p.box.s - p.pitS > 0;
    p.input = { steer: Math.max(-1, Math.min(1, d * 2)), throttle: near ? 0 : 1, brake: near ? 1 : 0, drs: false };
}
function start(t, players, settings = RACE) {
    const g = new Game(io, players, t, settings, () => {});
    g.frozen = false;
    return g;
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: a car drives in, is guided into its box, serviced and released onto the track`, () => {
        const t = Track.load(id), g = start(t, [lp('a', 'ferrari')]), p = g.players.a;
        g.setNextCompound('a', 'H');
        const q = pitPoint(t, Math.max(t.pit.limStart, p.box.s - 120 * t.scale));
        Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * 20 * t.scale, vy: Math.sin(q.angle) * 20 * t.scale, speed: 20 * t.scale });
        let still = 0, serviced = false;
        for (let k = 0; k < 60 * 60 && !serviced; k++) {
            if (!p.stop) lanePilot(g, p, t);
            g.update();
            if (p.stop?.phase === 'service') still++;
            if (p.stops === 1) serviced = true;
        }
        assert.ok(serviced, 'never serviced');
        assert.strictEqual(p.compound, 'H'); assert.strictEqual(p.wear, 0); assert.deepStrictEqual(p.compoundsUsed, ['M', 'H']);
        assert.ok(still / 60 >= 2.5 && still / 60 <= 2.95, `${(still / 60).toFixed(2)} s stationary`);
        assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.6 * t.scale, 'parked on the box mark');
        for (let k = 0; k < 60 * 40 && (p.inPit || p.stop); k++) { if (!p.stop) lanePilot(g, p, t, false); g.update(); }
        assert.ok(!p.inPit && !p.stop, 'released and out of the lane');
        assert.ok(Physics.nearestOnTrack(p.x, p.y, t).dist < t.width / 2, 'back on the road');
    });
}

test('drive-through without braking: no stop, no service', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    const q = pitPoint(t, p.box.s - 100 * t.scale);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * 20 * t.scale, vy: Math.sin(q.angle) * 20 * t.scale, speed: 20 * t.scale });
    for (let k = 0; k < 60 * 12; k++) { lanePilot(g, p, t, false); g.update(); assert.strictEqual(p.stop, null); }
    assert.strictEqual(p.stops, 0);
});

test('guided stop from 80 km/h braking late still stops on the mark', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a, v = (80 / 3.6) * t.scale;
    const q = pitPoint(t, p.box.s - 13 * t.scale);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v, input: { throttle: 0, brake: 1, steer: 0 } });
    for (let k = 0; k < 60 * 6 && !(p.stop && p.stop.phase !== 'guide'); k++) g.update();
    assert.ok(p.stop && p.stop.phase === 'service', 'not in service');
    assert.ok(Math.hypot(p.x - p.box.x, p.y - p.box.y) < 0.6 * t.scale);
});

test('team-mates get different boxes', () => {
    const t = Track.load('monza'), g = start(t, [lp('a', 'mclaren'), lp('b', 'mclaren')]);
    assert.ok(Math.hypot(g.players.a.box.x - g.players.b.box.x, g.players.a.box.y - g.players.b.box.y) > 5 * t.scale);
});

test('one service per lap', () => {
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    p.servicedLap = p.lap;
    const q = pitPoint(t, p.box.s - 8 * t.scale);
    Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: 0, vy: 0, speed: 0, input: { throttle: 0, brake: 1, steer: 0 } });
    for (let k = 0; k < 30; k++) g.update();
    assert.strictEqual(p.stop, null);
});

test('race finish on one compound costs 22 s; two compounds none; tyre wear off none', () => {
    for (const [used, wearOn, want] of [[['M'], true, 22], [['M', 'S'], true, 0], [['M'], false, 0]]) {
        const t = Track.load('monza'), g = start(t, [lp('a')], { ...RACE, maxLaps: 2, tyreWear: wearOn }), p = g.players.a;
        p.compoundsUsed = used; p.lap = 1;
        g.finishCar(p);
        assert.strictEqual(p.penalty, want, `${used} wear ${wearOn}`);
    }
});

test('the packet carries the stop state and the predictor holds the car still through service', async () => {
    const { Predictor } = await import('../public/js/predict.js');
    const t = Track.load('monza'), g = start(t, [lp('a')]), p = g.players.a;
    Object.assign(p, { x: p.box.x, y: p.box.y, angle: p.box.angle, vx: 0, vy: 0, speed: 0, stop: { phase: 'service', t: 2.4 } });
    const e = g.fastPacket().c.find((c) => c[0] === g.index.a);
    assert.strictEqual(e[12], 2); assert.strictEqual(e[13], 2.4);
    const pr = new Predictor(JSON.parse(JSON.stringify(t)), 'full');
    pr.reset(e);
    for (let k = 0; k < 60; k++) pr.step({ throttle: 1, brake: 0, steer: 1, drs: false });
    assert.ok(Math.hypot(pr.car.x - p.box.x, pr.car.y - p.box.y) < 1e-6, 'predicted car moved during service');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/pitstop.test.js`
Expected: FAIL (`p.box` undefined, `finishCar` not a function)

- [ ] **Step 3: Implement the shared guide and hold in `drive.js`**

```js
// A car being guided into its box (Game.updateStop): follow the lane, turn into the box, stop on its mark
export function guideToBox(p, t) {
    const b = p.box, sc = t.scale, d = Math.hypot(b.x - p.x, b.y - p.y);
    const lead = Math.min(d, 6 * sc) * 0.6; // aim at a point before the box along its heading, closing in on the mark
    const ax = b.x - Math.cos(b.angle) * lead, ay = b.y - Math.sin(b.angle) * lead;
    let err = Math.atan2(ay - p.y, ax - p.x) - p.angle; err = Math.atan2(Math.sin(err), Math.cos(err));
    const v = p.speed / sc, want = Math.min(((t.pit.limitKmh || PIT_LIMIT_KMH) / 3.6), Math.sqrt(2 * 4 * Math.max(0, d / sc - 0.2)));
    return { steer: Math.max(-1, Math.min(1, err * 2)), throttle: v < want - 0.5 ? 0.6 : 0, brake: v > want + 0.5 || d < 0.3 * sc ? 1 : 0, drs: false };
}
```

At the top of `driveCar`, before `const x0 = p.x…`:

```js
    // Pit stop (Game.updateStop): guided into the box, then held still while the tyres change
    if (p.stop && p.stop.phase !== 'guide') {
        p.vx = p.vy = p.speed = 0; p.steer = 0;
        return Physics.nearestOnTrack(p.x, p.y, t, p.roadI);
    }
    if (p.stop) input = guideToBox(p, t);
```

(`input` is a parameter: reassigning it is fine.)

- [ ] **Step 4: Implement the server stop flow in `Game.js`**

Constants:

```js
const STOP_TRIGGER_M = 12, STOP_SLOW_KMH = 40, STOP_BRAKE = 0.2;
const STOP_S = 2.5, STOP_SPREAD_S = 0.4, RELEASE_HOLD_S = 0.5, RELEASE_GAP_M = 10, PARK_M = 0.5, PARK_MS = 0.3;
const COMPOUND_PENALTY_S = 22;
const STOP_CODE = { guide: 1, service: 2, hold: 3 };
```

Constructor: `this.rng = settings.rng || Math.random;`; compute `const boxes = track.pit ? Game.garageSlots(players, track) : null;` for every mode, keep the start slot `mode === 'quali' && boxes ? boxes[index] : …`; add player fields `box: boxes ? boxes[index] : null, stop: null, servicedLap: -1,`. `garageSlots` must return the box object including `s` (it returns `g.boxes[…]`, which now has `s`).

Methods:

```js
    // Pit stop: braking for (or crawling to) its box on the lane → guided in → serviced → released
    updateStop(p) {
        const t = this.track, sc = t.scale;
        if (!t.pit || !p.box || p.finished) return;
        if (!p.stop) {
            const ahead = p.box.s - p.pitS, kmh = (Math.hypot(p.vx, p.vy) / sc) * 3.6;
            if (!p.inPit || p.servicedLap === p.lap || ahead <= 0 || ahead > STOP_TRIGGER_M * sc) return;
            if ((p.input.brake || 0) > STOP_BRAKE || kmh < STOP_SLOW_KMH) p.stop = { phase: 'guide', t: STOP_S + this.rng() * STOP_SPREAD_S };
            return;
        }
        if (p.stop.phase === 'guide') {
            if (Math.hypot(p.x - p.box.x, p.y - p.box.y) < PARK_M * sc && Math.hypot(p.vx, p.vy) < PARK_MS * sc) p.stop.phase = 'service';
            return;
        }
        if (p.stop.phase === 'service') {
            p.stop.t -= this.dt;
            if (p.stop.t > 0) return;
            this.serviceTyres(p);
            p.stop = { phase: 'hold', t: RELEASE_HOLD_S };
        }
        // Unsafe release: a moving car in the lane just behind the box holds us (at most RELEASE_HOLD_S)
        const busy = Object.values(this.players).some((q) => q !== p && q.inPit && !q.stop && Math.hypot(q.vx, q.vy) > sc
            && q.pitS < p.box.s && p.box.s - q.pitS < RELEASE_GAP_M * sc);
        if (busy && p.stop.t > 0) { p.stop.t -= this.dt; return; }
        p.stop = null;
    }

    serviceTyres(p) {
        p.compound = p.nextCompound || Tyres.nextHarder(p.compound);
        p.nextCompound = null;
        p.wear = 0;
        p.wearPerM = Game.tyreWearPerM(this.settings, this.track, p.compound);
        p.tyreGrip = Tyres.gripOf(p.compound, 0);
        p.stops++;
        if (!p.compoundsUsed.includes(p.compound)) p.compoundsUsed = [...p.compoundsUsed, p.compound];
        p.servicedLap = p.lap;
    }

    // A race finisher who never ran a second compound (races of 2+ laps, tyre wear on)
    finishCar(p) {
        if (this.mode !== 'race' || this.settings.tyreWear === false || (this.settings.maxLaps || 1) < 2 || p.compoundsUsed.length >= 2) return;
        p.penalty += COMPOUND_PENALTY_S;
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: +${COMPOUND_PENALTY_S}s, raced on one tyre compound (total +${p.penalty}s)` });
    }
```

Call sites: in `update()`, after `this.drive(p);` add `this.updateStop(p);`. In `checkLapProgress`, inside the race branch right after `p.finished = true; p.finishTime = this.time;` add `this.finishCar(p);`.

Fast packet: append `p.stop ? STOP_CODE[p.stop.phase] : 0, p.stop ? +p.stop.t.toFixed(1) : 0` after the wear field.

- [ ] **Step 5: Predictor**

`public/js/predict.js` `load(e)`: add

```js
        const code = e[12] || 0;
        c.stop = code ? { phase: ['', 'guide', 'service', 'hold'][code], t: e[13] || 0 } : null;
```

and in `reset`, copy the player's `box` once: `this.car.box = this.box;` with `this.box` set from the constructor's caller. In `game3d.js` after `predictor = new Predictor(…)` add `predictor.box = clientState.gameState?.[clientState.me]?.box || null;` (the `box` field arrives in `game_init` players).

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (14 circuit stop runs + flow tests). If a circuit's guided stop overshoots the mark, lower `lead` to `Math.min(d, 6 * sc) * 0.5` and re-run; do not loosen the 0.6 m mark tolerance.

- [ ] **Step 7: Commit**

```bash
git add public/js/sim/drive.js public/js/predict.js public/js/game3d.js src/game/Game.js test/pitstop.test.js
git commit -m "Add pit stops: guided into the team box, timed service, safe release, compound rule"
```

---

### Task 7: Driver controls, lobby choices and HUD

**Files:**
- Modify: `public/index.html` (lobby: tyre wear setting + start compound; HUD markup), `public/css/style.css`, `public/js/app.js` (emit settings, compound choice, settings view), `public/js/game3d.js` (`onKey`, HUD update, tower tag)
- Test: real game (Task 8); `node --check` for both JS files

**Interfaces:**
- Consumes: socket events `set_compound`, `tyre_next` (Task 3); player meta `compound`, `nextCompound`, `stops`, `compoundsUsed`; predicted `predictor.car.wear`; packet stop code via `me.stop` on the predicted car.

- [ ] **Step 1: Lobby markup** in `public/index.html`, after the Collisions `<label>…</label>` block:

```html
                                    <label>Tyre wear
                                        <select id="setting-tyres" title="Soft lasts ~40 % of the race, medium ~65 %, hard ~90 %; finishers must use two compounds">
                                            <option value="1" selected>On</option>
                                            <option value="0">Off</option>
                                        </select>
                                    </label>
```

and in the player's own settings panel (next to `engine-select`):

```html
                    <label>Start tyre
                        <select id="compound-select"><option value="S">Soft</option><option value="M" selected>Medium</option><option value="H">Hard</option></select>
                    </label>
```

- [ ] **Step 2: `app.js`**: add `const setTyres = document.getElementById('setting-tyres');`; in `emitSettings` add `tyreWear: setTyres.value === '1',`; add `setTyres.addEventListener('change', emitSettings);`; in the settings render add `setTyres.value = clientState.settings.tyreWear === false ? '0' : '1';` and push `['Tyre wear', s.tyreWear === false ? 'Off' : 'On']` onto `rows`. Compound:

```js
const compoundSelect = document.getElementById('compound-select');
try { compoundSelect.value = localStorage.getItem('lanrace.compound') || 'M'; } catch (e) { /* storage blocked */ }
compoundSelect.addEventListener('change', () => {
    try { localStorage.setItem('lanrace.compound', compoundSelect.value); } catch (e) { /* storage blocked */ }
    socket.emit('set_compound', compoundSelect.value);
});
```

and include `compound: compoundSelect.value` in the `join_lobby` payload (search `emit('join_lobby'`).

- [ ] **Step 3: HUD markup** in `public/index.html`, inside the cluster after the `cl-drs` div:

```html
                        <div class="cl-tyre"><div id="tyre-chip" class="tyre-M">M</div><div id="tyre-wear"><i></i></div><small id="tyre-next">NEXT —</small></div>
```

and after `<div id="pit-limiter" …>`: `<div id="box-msg" class="hidden"></div>`.

CSS (`public/css/style.css`):

```css
.cl-tyre { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 44px; }
#tyre-chip { width: 26px; height: 26px; border-radius: 50%; border: 4px solid; display: grid; place-items: center; font: 700 12px/1 var(--font, sans-serif); background: #111; }
.tyre-S { border-color: #e10600; color: #e10600; } .tyre-M { border-color: #ffd12e; color: #ffd12e; } .tyre-H { border-color: #f2f2f2; color: #f2f2f2; }
#tyre-wear { width: 40px; height: 4px; background: #333; border-radius: 2px; overflow: hidden; }
#tyre-wear i { display: block; height: 100%; width: 100%; background: #3ecf6e; transform-origin: left; }
#tyre-wear.worn i { background: #e10600; }
#tyre-next { font-size: 9px; opacity: 0.8; letter-spacing: 0.04em; }
#box-msg { position: absolute; top: 38%; left: 50%; transform: translateX(-50%); font: 800 28px/1 var(--font, sans-serif); color: #fff; background: rgba(0,0,0,0.6); padding: 10px 18px; border-radius: 6px; }
```

- [ ] **Step 4: Keys** in `onKey` (`game3d.js`), before `const k = KEYMAP[key];`:

```js
    // Next tyre set: 1 soft, 2 medium, 3 hard (Q, W and E are taken: assist, throttle, DRS)
    if (down && !e.repeat && clientState.status !== 'LOBBY' && ['1', '2', '3'].includes(key)) {
        const c = 'SMH'[+key - 1];
        window.socket?.emit('tyre_next', c);
        window.showBanner?.(`NEXT TYRES: ${{ S: 'SOFT', M: 'MEDIUM', H: 'HARD' }[c]}`, true);
    }
```

(Check how `game3d.js` reaches the socket: search `emit(` in the file and use the same object.)

- [ ] **Step 5: HUD update**: where the HUD toggles `pit-limiter` (~line 1839), add:

```js
    const comp = me.compound || 'M', wear = predictor?.car?.wear ?? 0;
    if (hudTyre !== comp) { hudTyre = comp; const chip = $('tyre-chip'); chip.textContent = comp; chip.className = `tyre-${comp}`; }
    $('tyre-wear').firstElementChild.style.transform = `scaleX(${(1 - wear).toFixed(3)})`;
    $('tyre-wear').classList.toggle('worn', wear > 0.8);
    $('tyre-next').textContent = `NEXT ${me.nextCompound || '—'}`;
    const st = predictor?.car?.stop;
    $('box-msg').classList.toggle('hidden', !(racing && st));
    if (st) $('box-msg').textContent = st.phase === 'service' ? `BOX — ${Math.max(0, st.t).toFixed(1)} s` : st.phase === 'hold' ? 'HOLD' : 'BOX';
```

and declare `let hudTyre = null;` next to `hudGear`.

- [ ] **Step 6: Tower** (~line 1871 where `PIT` is appended): after it add

```js
        if (p.compound) li.append(el('span', `tt-tyre tyre-${p.compound}`, `${p.compound}${p.stops ? ' ' + p.stops : ''}`));
```

with CSS `.tt-tyre { font-size: 10px; margin-left: 4px; border: 2px solid; border-radius: 8px; padding: 0 4px; }`.

- [ ] **Step 7: Verify**

Run: `node --check public/js/game3d.js && node --check public/js/app.js && npm test`
Expected: OK, PASS.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/css/style.css public/js/app.js public/js/game3d.js
git commit -m "Add tyre choice, wear setting, tyre HUD, pit-stop countdown and tower compounds"
```

---

### Task 8: Golden trace, real-game check, cleanup

**Files:**
- Modify: `test/fixtures/drive-golden.json` (only if `simGolden.test.js` fails)
- Test: the running game

- [ ] **Step 1:** Run `npm test`. If only `simGolden.test.js` fails, confirm the cause is the pit lane rebuild (the golden tracks' pit walls moved) by checking that a golden car's trace diverges at a tick where it is beside the pit lane, then re-record: `node test/fixtures/make-drive-golden.js` and re-run `npm test` (PASS).

- [ ] **Step 2: Real game, Monza and Buddh.** Start `PORT=3299 node server.js`; in the browser join, set Tyre wear On, Laps 5, Qualifying Off, start. Check by eye and screenshot: pit entry mouth tapers from the road edge with a white blend line, no lane asphalt on the racing surface, no flicker; press 3 (banner "NEXT TYRES: HARD"); drive in, limiter shows, brake near the garage: "BOX" then "BOX — 2.x s", car sits on the box mark; "GO"/released; chip shows H, wear bar full; exit taper rejoins the road edge; tower shows "H 1". Read the console for errors. Repeat the visual check of both mouths at Buddh.

- [ ] **Step 3: Performance check.** With the netstats overlay (F3) on, note the server tick ms before (from `git stash` of the branch's first commit is not needed: compare against `tickMs` < 1.0 ms with one car) and confirm it stays under the existing figure ±10 %.

- [ ] **Step 4: Commit** any re-recorded golden file:

```bash
git add test/fixtures/drive-golden.json
git commit -m "Re-record the golden physics trace for the rebuilt pit lanes"
```
