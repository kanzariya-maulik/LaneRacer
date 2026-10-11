# Fair Racing Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ghost start through the first corners, lenient lap-1 contact judging, track limits that only punish corner cuts, and a steward card that explains every verdict.

**Architecture:** All rules live in the server referee (`src/game/Game.js`); the client only draws (`ghost` packet bit already drawn per car) and explains (new pure `public/js/steward.js` + a HUD card). Lobby gets one host setting, `ghostStart`.

**Tech Stack:** Node (CommonJS server, `node --test`), browser ES modules + three.js client, socket.io.

**Spec:** `docs/superpowers/specs/2026-10-11-fair-racing-rules-design.md`

## Global Constraints

- Race mode only; qualifying rules unchanged (lap deleted on any side, all cars ghost as today).
- Ghost: every race car from session start until past the end of sector 1 of its first lap (`track.sectorCps[1]` checkpoint) or `GHOST_MAX_S = 25` s after lights out, **and** not overlapping any car (`Physics.carOverlap`).
- Code lap numbering: `p.lap` counts completed laps; the first lap is `p.lap === 0`. "Lap 1" in the spec = `p.lap === 0`.
- Lap-1 blame: `CONTACT_BLAME_LAP1 = 3` while either car has `lap === 0`; otherwise `CONTACT_BLAME = 2` (unchanged).
- Track limits, race: cut = off on the inside of a bend; wide = outside, or a straight (|bend| < 1/400 per metre, i.e. radius > 400 m); bend measured over ±25 m (`BEND_SPAN_M = 25`).
- Strike ladder: `LIMIT_WARNINGS = 3` warnings, the 4th strike = black-and-white flag (no time), 5th and later = `+5 s` each.
- Steward card: 4 s, own car only; texts exactly as in Task 3's `stewardText`.
- Host setting `ghostStart` (boolean, default `true`), shown with the collision settings.
- Never start/stop/touch the server on port 3232; test servers use 3299.

## Review Focus

1. Two cars overlapping when their ghost window ends (side by side through sector 1) — they must stay ghost until apart, never pop apart violently. → Task 1 test "overlapping cars stay ghost until clear".
2. A cut through a chicane — each bend judged on its own, so cutting it is a cut, not "wide". → Task 2 test "inside of every circuit's tightest bend is a cut" (covers chicanes where they are tightest) plus the independent chord-midpoint check.
3. Pushed off by another car on the inside of a corner — still exempt (no strike, no wide card). → Task 2 test "pushed-off victim gets no strike or wide".
4. Contact or penalties switched off — no collision/incident cards, but track-limit cards still show. → Task 2 test "incident events only with contact penalties on".
5. A late joiner/spectator mid-ghost phase — sees translucent cars, no card, no crash on a missing `me`. → Task 3 (socket handler returns for non-me; `updateHUD` guards `racing`), browser check in Task 4.

---

### Task 1: Ghost start and lenient lap 1 (server) + host setting plumbing

**Files:**
- Modify: `src/game/Game.js` (constants near line 14; player init ~line 95; `fastPacket` ghost bit ~line 270; `update()` pair loop ~line 510; `noteContact` ~line 585; new `updateGhosts`)
- Modify: `src/lobby.js:25-26` (sanitize `ghostStart`)
- Modify: `src/socketManager.js:15` (default `ghostStart: true`)
- Test: `test/fairRacing.test.js` (new)

**Interfaces:**
- Produces: `p.ghost` (boolean, race cars); `Game.prototype.updateGhosts(ids)`; settings field `ghostStart`; packet ghost bit = `quali || collisions === false || p.ghost`.

- [ ] **Step 1: Write the failing tests** — create `test/fairRacing.test.js`:

```js
// Fair racing: ghost start through the first corners, lenient lap-1 blame, cut vs wide, strike ladder
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

const io = { emit() {}, volatile: { emit() {} } };
const spy = () => { const events = []; return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } }; };
const monza = Track.load('monza');
const lp = (id, teamId = 'ferrari') => ({ id, username: id.toUpperCase(), teamId });
const RACE = { maxLaps: 3, qualifying: false };
const sector1End = (g) => g.track.sectorCps[1];

test('ghost start: every race car is a ghost on the grid; off by setting; quali unaffected', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    assert.ok(g.players.a.ghost && g.players.b.ghost);
    const off = new Game(io, [lp('a'), lp('b')], monza, { ...RACE, ghostStart: false }, () => {});
    assert.ok(!off.players.a.ghost && !off.players.b.ghost);
});

test('ghost start: ghosts never collide; solid after sector 1 when clear', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    const a = g.players.a, b = g.players.b;
    b.x = a.x; b.y = a.y; b.angle = a.angle; // fully overlapping
    a.vx = 30 * monza.scale; b.vx = 0;
    g.update();
    assert.ok(Physics.carOverlap(a, b, monza.scale), 'ghosts pass through: no push apart');
    a.checkpoint = sector1End(g); b.checkpoint = sector1End(g);
    g.updateGhosts(['a', 'b']);
    assert.ok(a.ghost && b.ghost, 'overlapping cars stay ghost until clear');
    b.x += 20 * monza.scale;
    g.updateGhosts(['a', 'b']);
    assert.ok(!a.ghost && !b.ghost, 'clear and past sector 1: solid');
});

test('ghost start: before sector 1 a clear car stays ghost; the 25 s cap ends it', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const a = g.players.a;
    g.time = 10; g.updateGhosts(['a']);
    assert.ok(a.ghost);
    g.time = 25; g.updateGhosts(['a']);
    assert.ok(!a.ghost);
});

test('ghost bit in the fast packet is per car', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    g.players.b.ghost = false;
    const pk = g.fastPacket(), flagsOf = (i) => pk.find((e) => e[0] === i)[6];
    const ia = g.players.a.index ?? 0, ib = g.players.b.index ?? 1;
    assert.ok(flagsOf(ia) & Game.FLAGS.ghost);
    assert.ok(!(flagsOf(ib) & Game.FLAGS.ghost));
});

// Two solid cars touching at speed: a drives into b with `aIn`, b into a with `bIn` (m/s)
function contact(g, aIn, bIn) {
    const a = g.players.a, b = g.players.b, sc = monza.scale;
    a.ghost = b.ghost = false;
    a.vx = aIn * sc; a.vy = 0; b.vx = -bIn * sc; b.vy = 0;
    g.noteContact(a, b, { nx: -1, ny: 0 }); // n points from b to a: a is left of b
}

test('lap-1 blame is lenient: 2.5x is a racing incident on the first lap, a penalty after it', () => {
    const s1 = spy(), g1 = new Game(s1.io, [lp('a'), lp('b')], monza, RACE, () => {});
    g1.release();
    contact(g1, 10, 4);
    assert.strictEqual(g1.incidents.length, 0);
    const g2 = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g2.release();
    g2.players.a.lap = g2.players.b.lap = 1;
    contact(g2, 10, 4);
    assert.strictEqual(g2.incidents.length, 1);
    const g3 = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g3.release();
    contact(g3, 12, 3); // 4x: a clear hit even on lap 1
    assert.strictEqual(g3.incidents.length, 1);
});
```

(Check `fastPacket` entry index 0 is the car index and index 6 the flags — see the packet comment above `fastPacket`; adapt `ia`/`ib` to how the car index is stored on the player.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/fairRacing.test.js`
Expected: FAIL (`ghost` undefined, `updateGhosts` not a function).

- [ ] **Step 3: Implement** in `src/game/Game.js`:

```js
const CONTACT_BLAME_LAP1 = 3;    // first lap: only a clear hit is anyone's fault (everyone arrives at turn 1 together)
const GHOST_MAX_S = 25;          // ghost start ends by this long after lights out even if sector 1 is longer
```

Player init (next to `lapValid: true,`): `ghost: mode === 'race' && settings.ghostStart !== false,`

Packet flag: `| ((this.mode === 'quali' || this.settings.collisions === false || p.ghost) && FLAGS.ghost)`

New method (next to `noteContact`):

```js
    // Ghost start: cars pass through each other from the grid until past sector 1 of the first lap (or GHOST_MAX_S after
    // lights out), and only turn solid clear of every other car, so nobody is ever popped apart
    updateGhosts(ids) {
        for (const id of ids) {
            const p = this.players[id];
            if (!p.ghost) continue;
            const done = p.lap > 0 || p.checkpoint >= this.track.sectorCps[1] || (!this.frozen && this.time >= GHOST_MAX_S);
            if (!done) continue;
            const sc = this.track.scale;
            if (ids.some((o) => o !== id && !this.players[o].finished && Physics.carOverlap(p, this.players[o], sc))) continue;
            p.ghost = false;
        }
    }
```

In `update()`, just before the pair loop (`if (this.mode === 'race' && this.settings.collisions !== false)`): `if (this.mode === 'race') this.updateGhosts(ids);` and in the pair loop: `if (a.finished || b.finished || a.ghost || b.ghost) continue;`

`noteContact`: replace `const blame = (x, y) => x > 0 && x >= CONTACT_BLAME * Math.max(y, 0);` with

```js
        const k = a.lap === 0 || b.lap === 0 ? CONTACT_BLAME_LAP1 : CONTACT_BLAME;
        const blame = (x, y) => x > 0 && x >= k * Math.max(y, 0);
```

`src/lobby.js` after line 26: `if (typeof incoming.ghostStart === 'boolean') next.ghostStart = incoming.ghostStart;`
`src/socketManager.js:15` settings default: add `ghostStart: true,` after `contactPenalties: true,`.

- [ ] **Step 4: Run** `node --test test/fairRacing.test.js && npm test` → PASS (existing contact tests in other files must still pass; if one relied on 2x blame on lap 0, set its cars' `lap = 1` — the rule changed on purpose — and say so in the report).

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/lobby.js src/socketManager.js test/fairRacing.test.js
git commit -m "Ghost start through the first corners and lenient lap-1 contact judging"
```

---

### Task 2: Cut vs wide, the strike ladder and complete steward events (server)

**Files:**
- Modify: `src/game/Game.js` (constants; `checkLimits` ~line 632; `noteContact` incident emit; `judgeIncidents` emits; `checkJumpStart` emit; new `bendAt`)
- Modify: `test/game.test.js` (existing track-limit tests that excurse on the start straight)
- Test: `test/fairRacing.test.js`

**Interfaces:**
- Consumes: Task 1 (`ghost`, `CONTACT_BLAME_LAP1`).
- Produces: `Game.bendAt(track, i)` (static, signed heading change per metre: `> 0` = the path turns clockwise on screen (y down) = toward its right); `track_limits` events: `{id, kind:'warning', count, of}`, `{id, kind:'flag'}`, `{id, kind:'penalty', add, penalty}`, `{id, kind:'wide'}`, `{id, kind:'collision', add, penalty, victim, off}`, `{id, kind:'hit', by, add}`, `{id, kind:'incident', with}`, `{id, kind:'jump', add, penalty}`, `{id, kind:'deleted'}`.

- [ ] **Step 1: Write the failing tests** — append to `test/fairRacing.test.js`:

```js
const tracks = Track.loadAll();
// Tightest bend of a circuit: the path index with the largest |bend|
const tightest = (t) => t.path.reduce((b, _, i) => (Math.abs(Game.bendAt(t, i)) > Math.abs(Game.bendAt(t, b)) ? i : b), 0);
// A point beside path index i, `m` metres past the white line on the given side (+1 = left of the heading, -1 = right)
function pastLine(t, i, sideSign, m = 2) {
    const P = t.path, a = P[i], b = P[(i + 1) % P.length], h = Math.atan2(b.y - a.y, b.x - a.x);
    const probe = { x: a.x - Math.sin(h) * sideSign * t.scale, y: a.y + Math.cos(h) * sideSign * t.scale };
    const line = Track.edgeAt(t, Physics.nearestOnTrack(probe.x, probe.y, t), probe.x, probe.y);
    const off = line + (Physics.CAR_HALF_WIDTH_M + m) * t.scale;
    return { x: a.x - Math.sin(h) * sideSign * off, y: a.y + Math.cos(h) * sideSign * off };
}
// Independent inside check: the inside of a bend is the side the chord between ±25 m lies on
function insideSign(t, i) {
    const P = t.path, n = P.length, a = P[i], b = P[(i + 1) % n], h = Math.atan2(b.y - a.y, b.x - a.x);
    let k = i, j = i, back = 0, fwd = 0;
    while (back < 25 * t.scale) { const q = (k - 1 + n) % n; back += Math.hypot(P[k].x - P[q].x, P[k].y - P[q].y); k = q; }
    while (fwd < 25 * t.scale) { const q = (j + 1) % n; fwd += Math.hypot(P[q].x - P[j].x, P[q].y - P[j].y); j = q; }
    const mx = (P[k].x + P[j].x) / 2 - a.x, my = (P[k].y + P[j].y) / 2 - a.y;
    return -Math.sin(h) * mx + Math.cos(h) * my > 0 ? 1 : -1; // + = left (L = (-sin h, cos h))
}
const strike = (g, p, at) => { p.x = at.x; p.y = at.y; p.offLimits = false; g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, g.track)); };

for (const id of Track.TRACK_IDS) {
    test(`${id}: the inside of the tightest bend is a cut, the outside is wide`, () => {
        const t = tracks[id], i = tightest(t), ins = insideSign(t, i);
        const { events, io: sio } = spy(), g = new Game(sio, [lp('a')], t, RACE, () => {});
        g.release();
        const p = g.players.a;
        strike(g, p, pastLine(t, i, ins));
        assert.strictEqual(p.limits, 1, 'cut = strike');
        strike(g, p, pastLine(t, i, -ins));
        assert.strictEqual(p.limits, 1, 'wide = no strike');
        assert.strictEqual(p.lapValid, false);
        assert.ok(events.some(([ev, d]) => ev === 'track_limits' && d.kind === 'wide'));
    });
}

test('a long straight is wide on both sides', () => {
    const t = monza, i = t.path.reduce((b, _, k) => (Math.abs(Game.bendAt(t, k)) < Math.abs(Game.bendAt(t, b)) ? k : b), 0);
    const g = new Game(io, [lp('a')], t, RACE, () => {});
    g.release();
    strike(g, g.players.a, pastLine(t, i, 1));
    strike(g, g.players.a, pastLine(t, i, -1));
    assert.strictEqual(g.players.a.limits, 0);
});

test('strike ladder: three warnings, a black-and-white flag, then +5 s each', () => {
    const { events, io: sio } = spy(), t = monza, i = tightest(t), ins = insideSign(t, i);
    const g = new Game(sio, [lp('a')], t, RACE, () => {});
    g.release();
    const p = g.players.a;
    for (let k = 0; k < 6; k++) strike(g, p, pastLine(t, i, ins));
    const kinds = events.filter(([ev]) => ev === 'track_limits').map(([, d]) => d.kind + (d.count ? d.count : ''));
    assert.deepStrictEqual(kinds, ['warning1', 'warning2', 'warning3', 'flag', 'penalty', 'penalty']);
    assert.strictEqual(p.penalty, 10);
    assert.ok(events.find(([, d]) => d.kind === 'warning').at(1).of === 3);
});

test('pushed-off victim gets no strike or wide', () => {
    const { events, io: sio } = spy(), t = monza, i = tightest(t), ins = insideSign(t, i);
    const g = new Game(sio, [lp('a'), lp('b')], t, RACE, () => {});
    g.release();
    g.incidents.push({ striker: 'b', victim: 'a', at: 0, off: false, before: false });
    strike(g, g.players.a, pastLine(t, i, ins));
    strike(g, g.players.a, pastLine(t, i, -ins));
    assert.strictEqual(g.players.a.limits, 0);
    assert.ok(!events.some(([ev, d]) => ev === 'track_limits' && d.id === 'a'));
});

test('incident events reach both drivers, only with contact penalties on', () => {
    for (const contactPenalties of [true, false]) {
        const { events, io: sio } = spy(), g = new Game(sio, [lp('a'), lp('b')], monza, { ...RACE, contactPenalties }, () => {});
        g.release();
        g.players.a.lap = g.players.b.lap = 1;
        contact(g, 6, 5); // alike: racing incident
        const inc = events.filter(([ev, d]) => ev === 'track_limits' && d.kind === 'incident');
        assert.strictEqual(inc.length, contactPenalties ? 2 : 0);
        if (contactPenalties) assert.deepStrictEqual(inc.map(([, d]) => [d.id, d.with]).sort(), [['a', 'B'], ['b', 'A']]);
    }
});

test('collision and hit events carry what the steward card needs', () => {
    const { events, io: sio } = spy(), g = new Game(sio, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    g.players.a.lap = g.players.b.lap = 1;
    contact(g, 12, 1);
    g.judgeIncidents(true);
    const col = events.find(([, d]) => d.kind === 'collision')[1], hit = events.find(([, d]) => d.kind === 'hit')[1];
    assert.deepStrictEqual([col.id, col.add, col.victim, col.off], ['a', 5, 'B', false]);
    assert.deepStrictEqual([hit.id, hit.by, hit.add], ['b', 'A', 5]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/fairRacing.test.js`
Expected: FAIL (`Game.bendAt` is not a function).

- [ ] **Step 3: Implement** in `src/game/Game.js`:

Constants: `const LIMIT_WARNINGS = 3;    // race: corner cuts warned before the black-and-white flag, then penalties` (replace the old line) and

```js
const BEND_SPAN_M = 25;       // a bend's direction is read over this far either side
const STRAIGHT_PER_M = 1 / 400; // turning less than this (radius > 400 m): a straight, off there is "wide"
```

Static helper (module level, exported as `Game.bendAt = bendAt` next to `Game.META_FIELDS`):

```js
// Signed heading change per metre of the path over ±BEND_SPAN_M around index i: > 0 turns clockwise on screen (y down),
// i.e. toward the path's right; the inside of the bend is the side it turns toward
function bendAt(t, i) {
    const P = t.path, n = P.length, span = BEND_SPAN_M * t.scale;
    let k = i, j = i, back = 0, fwd = 0;
    while (back < span) { const q = (k - 1 + n) % n; back += Math.hypot(P[k].x - P[q].x, P[k].y - P[q].y); k = q; }
    while (fwd < span) { const q = (j + 1) % n; fwd += Math.hypot(P[q].x - P[j].x, P[q].y - P[j].y); j = q; }
    const h1 = Math.atan2(P[i].y - P[k].y, P[i].x - P[k].x), h2 = Math.atan2(P[j].y - P[i].y, P[j].x - P[i].x);
    return Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)) / ((back + fwd) / t.scale);
}
```

(Verify the sign against the test's independent chord check before relying on it; if the chord test fails on every circuit, the sign is flipped — fix `bendAt`, not the test.)

`checkLimits`, replacing everything after `if (this.incidents.some((i) => i.victim === p.id)) return;`:

```js
        // Inside of a bend = a cut (gains time): a strike. Outside, or on a straight = wide (loses time): the lap just
        // doesn't count for the fastest lap
        const k = bendAt(t, near.i), P = t.path, a = P[near.i], b = P[(near.i + 1) % P.length];
        const right = -(b.y - a.y) * (p.x - near.px) + (b.x - a.x) * (p.y - near.py) > 0; // same side test as edgeAt
        const cut = Math.abs(k) >= STRAIGHT_PER_M && (k > 0) === right;
        p.lapValid = false;
        if (!cut) { this.io.emit('track_limits', { id: p.id, kind: 'wide' }); return; }
        p.limits++;
        if (p.limits <= LIMIT_WARNINGS) {
            this.io.emit('track_limits', { id: p.id, kind: 'warning', count: p.limits, of: LIMIT_WARNINGS });
            return;
        }
        if (p.limits === LIMIT_WARNINGS + 1) {
            this.io.emit('track_limits', { id: p.id, kind: 'flag' });
            this.io.emit('chat_msg', { username: 'SYSTEM', color: '#f59e0b', msg: `${p.username}: black and white flag, next corner cut is a penalty` });
            return;
        }
        p.penalty += LIMIT_PENALTY_S;
        this.io.emit('track_limits', { id: p.id, kind: 'penalty', add: LIMIT_PENALTY_S, penalty: p.penalty });
        this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username}: +${LIMIT_PENALTY_S}s corner cutting penalty (total +${p.penalty}s)` });
```

Note: `p.lapValid = false` on a cut too — a cut lap never counts for the fastest lap (reasonable-person expectation; the spec names it for wide).

`noteContact` racing-incident branch (inside the existing `if (this.settings.contactPenalties !== false)`):

```js
            if (this.settings.contactPenalties !== false) {
                this.io.emit('chat_msg', { username: 'SYSTEM', color: '#f59e0b', msg: `${a.username} / ${b.username}: racing incident, no action` });
                this.io.emit('track_limits', { id: a.id, kind: 'incident', with: b.username });
                this.io.emit('track_limits', { id: b.id, kind: 'incident', with: a.username });
            }
```

`judgeIncidents` emits: `{ id: s.id, kind: 'collision', add, penalty: s.penalty, victim: v.username, off: inc.off }` and `{ id: v.id, kind: 'hit', by: s.username, add }`.
`checkJumpStart` emit: `{ id: p.id, kind: 'jump', add: JUMP_PENALTY_S, penalty: p.penalty }`.

- [ ] **Step 4: Fix the existing track-limit tests** in `test/game.test.js` (~lines 522-600). The `beside()` helper excurses on Monza's start straight, which is now *wide* (no strike). Change `beside(m)` to place the car beside the inside of Monza's tightest bend instead (reuse the same `bendAt`-based approach: index `i = tightest`, side = the inside), and recompute `lineM` there. Tests asserting `p.limits` counts keep their numbers; the run-off test (`'track limits are the real white line…'`) picks the widest run-off — if that point is on the outside of a bend, assert `p.lapValid === false` and a `wide` event instead of `limits === 1`, and say so in the report. The quali tests are unchanged in meaning (quali deletes on any side).

- [ ] **Step 5: Run** `node --test test/fairRacing.test.js && npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js test/fairRacing.test.js test/game.test.js
git commit -m "Track limits punish corner cuts only: three warnings, black and white flag, then +5 s; steward events for every verdict"
```

---

### Task 3: Steward card, ghost tag and the host setting (client)

**Files:**
- Create: `public/js/steward.js`
- Test: `test/steward.client.test.js`
- Modify: `public/index.html` (`#steward-card`, `#ghost-tag` in `#hud`; lobby `setting-ghost` select), `public/css/style.css`, `public/js/game3d.js` (`window.showSteward`, ghost tag in `updateHUD`), `public/js/socket.js:393-401` (track_limits handler), `public/js/app.js` (setting plumbing ~lines 23, 287, 410, 426)

**Interfaces:**
- Consumes: Task 2 event shapes; settings `ghostStart`; packet ghost bit (`clientState.gameState[me].ghost`).
- Produces: `stewardText(e) → { head, tip, tone } | null` (`tone`: `'bad' | 'good' | 'info' | 'warn' | 'muted'`); `window.showSteward(e)`.

- [ ] **Step 1: Write the failing test** `test/steward.client.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
let S;
before(async () => { S = await import('../public/js/steward.js'); });

test('stewardText: every verdict has a headline and a tip that says what to do', () => {
    const t = (e) => S.stewardText(e);
    assert.deepStrictEqual(t({ kind: 'collision', add: 5, victim: 'RAHUL', off: false }), { head: '+5 s · You hit RAHUL', tip: 'Brake earlier when following — leave a car\'s length', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'collision', add: 10, victim: 'RAHUL', off: true }), { head: '+10 s · You pushed RAHUL off', tip: 'Leave a car\'s width on corner exits', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'hit', by: 'RAHUL', add: 5 }), { head: 'Hit by RAHUL · +5 s to RAHUL', tip: 'Not your fault — no penalty for you', tone: 'good' });
    assert.deepStrictEqual(t({ kind: 'incident', with: 'RAHUL' }), { head: 'Racing incident · no penalty', tip: 'Contact with RAHUL — both moved', tone: 'info' });
    assert.deepStrictEqual(t({ kind: 'warning', count: 2, of: 3 }), { head: 'Corner cut · warning 2/3', tip: 'Keep two wheels inside the white line', tone: 'warn' });
    assert.deepStrictEqual(t({ kind: 'flag' }), { head: 'Black & white flag', tip: 'Next corner cut = +5 s', tone: 'warn' });
    assert.deepStrictEqual(t({ kind: 'penalty', add: 5, penalty: 10 }), { head: '+5 s · Corner cut', tip: 'Keep two wheels inside the white line', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'wide' }), { head: 'Wide · lap time not counted', tip: '', tone: 'muted' });
    assert.deepStrictEqual(t({ kind: 'jump', add: 10, penalty: 10 }), { head: 'Jump start · +10 s', tip: 'Wait for all five lights to go out', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'deleted' }), { head: 'Lap deleted · track limits', tip: 'Keep two wheels inside the white line', tone: 'warn' });
    assert.strictEqual(t({ kind: 'nope' }), null);
});
```

- [ ] **Step 2: Run** `node --test test/steward.client.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** `public/js/steward.js`:

```js
// The steward card: every verdict in plain words, with one tip on what to do next time (pure; node-tested)
const LINE_TIP = 'Keep two wheels inside the white line';
export function stewardText(e) {
    switch (e.kind) {
        case 'collision': return e.off
            ? { head: `+${e.add} s · You pushed ${e.victim} off`, tip: 'Leave a car\'s width on corner exits', tone: 'bad' }
            : { head: `+${e.add} s · You hit ${e.victim}`, tip: 'Brake earlier when following — leave a car\'s length', tone: 'bad' };
        case 'hit': return { head: `Hit by ${e.by} · +${e.add} s to ${e.by}`, tip: 'Not your fault — no penalty for you', tone: 'good' };
        case 'incident': return { head: 'Racing incident · no penalty', tip: `Contact with ${e.with} — both moved`, tone: 'info' };
        case 'warning': return { head: `Corner cut · warning ${e.count}/${e.of}`, tip: LINE_TIP, tone: 'warn' };
        case 'flag': return { head: 'Black & white flag', tip: 'Next corner cut = +5 s', tone: 'warn' };
        case 'penalty': return { head: `+${e.add} s · Corner cut`, tip: LINE_TIP, tone: 'bad' };
        case 'wide': return { head: 'Wide · lap time not counted', tip: '', tone: 'muted' };
        case 'jump': return { head: `Jump start · +${e.add} s`, tip: 'Wait for all five lights to go out', tone: 'bad' };
        case 'deleted': return { head: 'Lap deleted · track limits', tip: LINE_TIP, tone: 'warn' };
        default: return null;
    }
}
```

`public/index.html`, inside `#hud` next to `#race-msg`:

```html
<div id="steward-card" class="hidden"><b id="sc-head"></b><small id="sc-tip"></small></div>
<div id="ghost-tag" class="hidden">GHOST — FIRST CORNERS</div>
```

Lobby, before the `collisions-only` "Contact penalties" label:

```html
<label class="collisions-only">Start
    <select id="setting-ghost" title="Cars pass through each other until the end of sector 1 on lap 1: no turn-1 pile-ups">
        <option value="1" selected>Ghost first corners</option>
        <option value="0">Contact from lights out</option>
    </select>
</label>
```

`public/css/style.css`:

```css
/* Steward card: the verdict and one tip, top centre under the lights */
#steward-card { position: absolute; top: 120px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 2px; padding: 10px 18px; border-radius: 8px; background: rgba(0,0,0,0.75); border-left: 6px solid #888; color: #fff; text-align: left; pointer-events: none; max-width: calc(100vw - 32px); }
#steward-card b { font-size: 1.15rem; font-weight: 900; letter-spacing: 0.02em; }
#steward-card small { font-size: 0.85rem; opacity: 0.85; }
#steward-card.bad { border-left-color: #e10600; } #steward-card.good { border-left-color: #22c55e; }
#steward-card.info { border-left-color: #3b82f6; } #steward-card.warn { border-left-color: #f59e0b; }
#steward-card.muted { border-left-color: #6b7280; opacity: 0.85; }
#steward-card.hidden, #ghost-tag.hidden { display: none; }
#ghost-tag { position: absolute; top: 76px; left: 50%; transform: translateX(-50%); padding: 3px 10px; border-radius: 4px; background: rgba(255,255,255,0.18); color: #fff; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.1em; pointer-events: none; }
```

(Check `top` values against the lights and `#race-msg` positions in style.css; keep the card clear of both and of the timing tower at 390 px width.)

`public/js/game3d.js`: `import { stewardText } from './steward.js';` and near `window.showBanner`:

```js
let stewardTimer = null;
window.showSteward = (e) => {
    const t = stewardText(e);
    if (!t) return;
    $('sc-head').textContent = t.head;
    $('sc-tip').textContent = t.tip;
    $('sc-tip').classList.toggle('hidden', !t.tip);
    $('steward-card').className = t.tone;
    clearTimeout(stewardTimer);
    stewardTimer = setTimeout(() => $('steward-card').classList.add('hidden'), 4000);
};
```

In `updateHUD` (where `racing` and `me` are known), change-detected:

```js
    const ghostOn = !!(racing && clientState.status === 'RACE' && me.ghost && clientState.settings?.collisions !== false);
    if (ghostOn !== hudGhost) { hudGhost = ghostOn; $('ghost-tag').classList.toggle('hidden', !ghostOn); }
```

with `hudGhost = false` added to the HUD state `let` list (~line 2247) and reset in `initGameVisuals`.

`public/js/socket.js` track_limits handler becomes:

```js
socket.on('track_limits', (e) => {
    if (e.id !== clientState.me) return;
    window.showSteward?.(e);
});
```

`public/js/app.js`: `const setGhost = document.getElementById('setting-ghost');`; in `emitSettings` add `ghostStart: setGhost.value === '1',`; in the settings sync add `setGhost.value = clientState.settings.ghostStart === false ? '0' : '1';`; register `setGhost.addEventListener('change', emitSettings);` the way the other selects are; in the summary row for Collisions append `, ghost start` when `s.collisions !== false && s.ghostStart !== false`.

- [ ] **Step 4: Run** `node --test test/steward.client.test.js && node --check public/js/game3d.js && node --check public/js/socket.js && node --check public/js/app.js && npm test` → PASS. Also confirm no module-top-level code in game3d.js uses `$` before its definition (`const $` is defined around line 1794; use `document.getElementById` at top level).

- [ ] **Step 5: Commit**

```bash
git add public/js/steward.js test/steward.client.test.js public/index.html public/css/style.css public/js/game3d.js public/js/socket.js public/js/app.js
git commit -m "Steward card explains every verdict with a tip; ghost tag at the start; host setting for the ghost start"
```

---

### Task 4: Real game check (browser)

**Files:** none in the repo (scratchpad harness only).

- [ ] **Step 1:** Start a throwaway server on port 3299 (the scratchpad `pw/harness.js` pattern: `PORT=3299`, never touch 3232). Join two players from two headless pages (Playwright `playwright-core` with the cached Chromium), host starts a race (qualifying off).
- [ ] **Step 2:** Both hold throttle from lights out; log from the server each 0.5 s each car's `ghost`; expected: both ghost at start, both solid shortly after sector 1, never a collision resolve while either is ghost. Screenshot: translucent other car + `GHOST — FIRST CORNERS` tag.
- [ ] **Step 3:** In one page call `window.showSteward({...})` for every event kind; screenshot each at 1280×720 and 390×844; check legibility and no overlap with the lights, `#race-msg`, the timing tower and the tyre card.
- [ ] **Step 4:** Lobby: the "Start" select shows with collisions on, hides with collisions off, and the summary shows "ghost start".
- [ ] **Step 5:** Record findings; fix in a commit `Browser check fixes: …` if anything is off; `npm test` → PASS.
