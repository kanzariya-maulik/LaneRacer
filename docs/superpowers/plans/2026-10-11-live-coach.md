# Live Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live, non-nagging coach that rates each corner against the racing line and gives short racecraft tips while players drive.

**Architecture:** One pure client module `public/js/coach.js` (corners from the racing line, per-corner recording and verdict, tips, all rate limits), node-tested with synthetic drives and all 14 circuits. The shared sim exposes one boolean (`p.assistBrake`). `game3d.js` builds a frame per HUD tick and shows the message; `app.js` adds the lobby toggle.

**Tech Stack:** Browser ES modules (three.js client), Node `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-live-coach-design.md`

## Global Constraints

- Client only; no server or network change. The only shared-sim change: `p.assistBrake` (boolean) in `driveCar`.
- Messages (exact text): `Perfect corner` (good), `Braked N m early — brake later` (warn, N rounded to 5 m), `Slow mid-corner — carry more speed` (warn), `Missed the apex — aim for the inside kerb` (warn), `Too fast in — missed the apex` (bad), `In the tow — pull out and brake later to pass` (tip), `Inside line — brake late, the corner is yours` (tip), `Outside — leave room or tuck in behind` (tip), `DRS — press E` (tip), `Clean laps! Try Low braking help (Q) — it's faster` (tip), `Coach on — C to turn off` (tip).
- Thresholds: merge corners < 60 m apart; window 150 m before `brakeS`; wide checked to `endS + 30 m`; early > 20 m; slow < 0.85 × vApex; apex miss > 2 m; entry < 0.4 × vApex = no report; brake on > 0.2.
- Rate: ≤ 1 message per 4 s (`GAP_S`); show 2.5 s; each tip ≤ 3 per session; a corner quiet after 3 Perfect in a row; steward card holds the coach 4 s; a steward event within 5 s of a corner suppresses that corner's report.
- Runs in RACE and QUALIFYING; not spectating, finished, in the lobby or in the pit lane. Toggle key C; lobby "Coach" On/Off stored as `lanrace.coach` (`'on'|'off'`, default on).
- Never touch the server on port 3232; test servers use 3299.

## Review Focus

1. A corner that spans the start/finish line (braking zone before the line, apex after) — must still be one corner and be rated. → Task 1 test "a corner across the lap end".
2. Two corners whose windows overlap (short straight between them) — the first is rated when left, the second still records its braking. → Task 1 test "back-to-back corners both rated".
3. Driving the wrong way / spinning back through a corner — no false verdict. → Task 1 test "reverse pass gives no report" (entry-speed and window rules).
4. Braking help High braking early for the driver — never "brake later". → Task 1 test "help-braked early is not told to brake later".
5. Spectators and finished cars — coach never runs (no crash on missing `predictor.car`). → Task 3 guard + Task 4 browser check.

---

### Task 1: Corners and corner verdicts (`coach.js` core)

**Files:**
- Create: `public/js/coach.js`
- Test: `test/coach.client.test.js`

**Interfaces:**
- Produces:
  - `cornersOf(rl, t) → Corner[]` where `rl = { offset[], speed[], phase[] }` (racing line; phase 0 flat, 1 corner, 2 braking), `t = { path[], cum[] (n+1 entries, world units), scale }`; `Corner = { brakeI, apexI, endI, brakeS, endS, vApex, turn }` (`*S` metres along the lap from `cum`, `turn` = +1 when the corner turns toward `(-sin h, cos h)` of the path heading, −1 the other way, 0 straight).
  - `linePoint(rl, t, i) → {x, y}` (racing line point at path index i, same formula as `buildRacingLine`).
  - `pastLine(t, i, x, y) → boolean` (car fully past the white line: distance from the path segment at i beyond `edgeR`/`edgeL` + 1 m × scale; same side test as `Track.edgeAt`; false when the track has no edges).
  - `createCoach(corners, t, rl, opts = {}) → { update(frame) → {text, tone} | null }`, `opts.intro` (boolean). `frame = { t (s), i (nearest path index), x, y, angle, speed (m/s), brake (0..1 driver), assistBrake, tow, inPit, ghostOverlap, wide, lap, mode ('race'|'quali'), stewardAt (s or undefined), near ([{x,y}] other cars), drsAvailable, inDrsZone, drsOpen, helpLevel (0|0.5|1) }`.
  - Exported constants: `GAP_S = 4`, `SHOW_S = 2.5`.

- [ ] **Step 1: Write the failing tests** — `test/coach.client.test.js`:

```js
// Live coach: corners from the racing line, one verdict per corner, rate limits
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
let C;
before(async () => { C = await import('../public/js/coach.js'); });

// A 1000 m straight "lap" (scale 1): braking 400–449 (80 → 31 m/s), corner 450–499 at 30 m/s
function strip(rot = 0) {
    const n = 1000, path = [], cum = [0];
    for (let i = 0; i < n; i++) path.push({ x: i, y: 0 });
    for (let i = 1; i <= n; i++) cum.push(i);
    const at = (i) => (i - rot + n) % n;
    const phase = path.map((_, i) => { const j = at(i); return j >= 400 && j < 450 ? 2 : j >= 450 && j < 500 ? 1 : 0; });
    const speed = path.map((_, i) => { const j = at(i); return j < 400 ? 80 : j < 450 ? 80 - (j - 400) : j < 500 ? 30 : 80; });
    return { t: { path, cum, scale: 1 }, rl: { phase, speed, offset: path.map(() => 0) } };
}
const base = { tow: 0, inPit: false, ghostOverlap: false, near: [], angle: 0, drsAvailable: false, inDrsZone: false, drsOpen: false, helpLevel: 0, mode: 'race', lap: 1 };
// One pass from s=200 to 560; returns the messages shown
function run(coach, o = {}) {
    const { brakeFrom = 400, vMinK = 1, lat = 0, wide = false, help = false, t0 = 0, entry, ...rest } = o, out = [];
    for (let s = 200; s <= 560; s += 2) {
        const v = entry ?? (s < brakeFrom ? 80 : s < 500 ? 30 * vMinK : 80), braking = s >= brakeFrom && s < 450;
        const m = coach.update({ ...base, ...rest, t: t0 + (s - 200) / 100, i: s % 1000, x: s, y: s >= 440 && s <= 460 ? lat : 0, speed: v,
            brake: !help && braking ? 1 : 0, assistBrake: help && braking, wide: wide && s > 470 && s < 480 });
        if (m) out.push(m);
    }
    return out;
}
const fresh = (o) => { const { t, rl } = strip(); return C.createCoach(C.cornersOf(rl, t), t, rl, o); };
const texts = (ms) => ms.map((m) => m.text);

test('cornersOf: one braking + corner run is one corner', () => {
    const { t, rl } = strip(), cs = C.cornersOf(rl, t);
    assert.strictEqual(cs.length, 1);
    assert.deepStrictEqual([cs[0].brakeS, cs[0].apexI, cs[0].endS, cs[0].vApex], [400, 450, 499, 30]);
});

test('a corner across the lap end', () => {
    const { t, rl } = strip(600), cs = C.cornersOf(rl, t); // braking 0..49 shifted to 1000: brake 0? -> rot 600 puts braking at 0..49
    assert.strictEqual(cs.length, 1);
    const { t: t2, rl: rl2 } = strip(580), cs2 = C.cornersOf(rl2, t2); // braking 980..1029: wraps
    assert.strictEqual(cs2.length, 1);
    assert.strictEqual(cs2[0].brakeS, 980);
    assert.strictEqual(cs2[0].endS, 79);
});

test('verdicts: perfect, early, slow, missed apex, too fast', () => {
    assert.deepStrictEqual(texts(run(fresh())), ['Perfect corner']);
    assert.deepStrictEqual(texts(run(fresh(), { brakeFrom: 370 })), ['Braked 30 m early — brake later']);
    assert.deepStrictEqual(texts(run(fresh(), { vMinK: 0.7 })), ['Slow mid-corner — carry more speed']);
    assert.deepStrictEqual(texts(run(fresh(), { lat: 3 })), ['Missed the apex — aim for the inside kerb']);
    assert.deepStrictEqual(texts(run(fresh(), { wide: true })), ['Too fast in — missed the apex']);
    assert.deepStrictEqual(run(fresh(), { wide: true })[0].tone, 'bad');
});

test('help-braked early is not told to brake later', () => {
    assert.deepStrictEqual(texts(run(fresh(), { brakeFrom: 370, help: true })), ['Perfect corner']);
});

test('rate: a second verdict within 4 s is dropped; a corner goes quiet after 3 perfects', () => {
    const c = fresh();
    assert.strictEqual(run(c, { t0: 0 }).length, 1);
    assert.strictEqual(run(c, { t0: 0.5 }).length, 0);
    const q = fresh();
    const n = [0, 10, 20, 30].map((t0) => run(q, { t0 }).length);
    assert.deepStrictEqual(n, [1, 1, 1, 0]);
});

test('no report: pit lane, recent steward event, first-lap corner 0, slow entry, reverse pass', () => {
    assert.strictEqual(run(fresh(), { inPit: true }).length, 0);
    assert.strictEqual(run(fresh(), { stewardAt: 1 }).length, 0);
    assert.strictEqual(run(fresh(), { lap: 0 }).length, 0);
    assert.strictEqual(run(fresh(), { lap: 0, mode: 'quali' }).length, 1);
    assert.strictEqual(run(fresh(), { entry: 10 }).length, 0);
    const c = fresh(), out = [];
    for (let s = 560; s >= 200; s -= 2) { const m = c.update({ ...base, t: (560 - s) / 100, i: s, x: s, y: 0, speed: 20, brake: 0, assistBrake: false, wide: false }); if (m) out.push(m); }
    assert.strictEqual(out.length, 0);
});

test('back-to-back corners both rated', () => {
    const { t, rl } = strip();
    for (let i = 560; i < 600; i++) rl.phase[i] = 2; // a second braking zone 61 m after the first corner ends
    for (let i = 600; i < 640; i++) { rl.phase[i] = 1; rl.speed[i] = 40; }
    const cs = C.cornersOf(rl, t);
    assert.strictEqual(cs.length, 2);
    const coach = C.createCoach(cs, t, rl), out = [];
    for (let s = 200; s <= 720; s += 2) {
        const v = s < 400 ? 80 : s < 500 ? 30 : s < 600 ? 60 : s < 640 ? 40 : 80;
        const m = coach.update({ ...base, t: (s - 200) / 20, i: s, x: s, y: 0, speed: v, brake: (s >= 400 && s < 450) || (s >= 560 && s < 600) ? 1 : 0, assistBrake: false, wide: false });
        if (m) out.push(m);
    }
    assert.deepStrictEqual(texts(out), ['Perfect corner', 'Perfect corner']);
});

test('intro once when asked', () => {
    const c = fresh({ intro: true });
    assert.deepStrictEqual(texts(run(c)).slice(0, 1), ['Coach on — C to turn off']);
});

for (const id of Track.TRACK_IDS) {
    test(`${id}: corners from the real racing line`, () => {
        const t = Track.load(id), cs = C.cornersOf(t.racingLine, t), L = t.cum[t.path.length] / t.scale;
        const fwd = (a, b) => (((b - a) % L) + L) % L;
        assert.ok(cs.length >= 3, `${cs.length} corners`);
        cs.forEach((c, k) => {
            const nx = cs[(k + 1) % cs.length];
            if (cs.length > 1) assert.ok(fwd(c.endS, nx.brakeS) >= 60, 'merged when closer than 60 m');
            const apexS = t.cum[c.apexI] / t.scale;
            assert.ok(fwd(c.brakeS, apexS) <= fwd(c.brakeS, c.endS), 'apex inside the corner');
            assert.ok(c.vApex > 0 && [-1, 0, 1].includes(c.turn));
        });
    });
}
```

(The `strip(600)` assertion in "a corner across the lap end" only checks it still parses; `strip(580)` is the real wrap case.)

- [ ] **Step 2: Run** `node --test test/coach.client.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** `public/js/coach.js`:

```js
// Live coach (pure; node-tested): rates each corner against the racing line and gives one short tip at a time.
// Corners: a braking run (phase 2) plus its corner run (phase 1), merged when closer than MERGE_M (a chicane is one)
export const GAP_S = 4, SHOW_S = 2.5;
const TIP_MAX = 3, QUIET_AFTER = 3, STEWARD_HOLD_S = 4, CONTACT_QUIET_S = 5;
const MERGE_M = 60, WINDOW_M = 150, WIDE_AFTER_M = 30, EARLY_M = 20, SLOW_K = 0.85, APEX_M = 2, ENTRY_K = 0.4, BRAKE_ON = 0.2;

const lapM = (t) => t.cum[t.path.length] / t.scale;
const heading = (P, i) => { const n = P.length, a = P[i], b = P[(i + 1) % n]; return Math.atan2(b.y - a.y, b.x - a.x); };

export function cornersOf(rl, t) {
    const n = rl.phase.length, at = (i) => t.cum[i] / t.scale, L = lapM(t);
    const fwd = (a, b) => (((at(b) - at(a)) % L) + L) % L;
    const runs = [];
    for (let i = 0; i < n; i++) {
        if (rl.phase[i] !== 2 || rl.phase[(i - 1 + n) % n] === 2) continue;
        let e = i;
        while (rl.phase[(e + 1) % n] === 2 && (e + 1) % n !== i) e = (e + 1) % n;
        while (rl.phase[(e + 1) % n] === 1 && (e + 1) % n !== i) e = (e + 1) % n;
        runs.push({ brakeI: i, endI: e });
    }
    const merged = [];
    for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && fwd(last.endI, r.brakeI) < MERGE_M) last.endI = r.endI; else merged.push({ ...r });
    }
    if (merged.length > 1 && fwd(merged[merged.length - 1].endI, merged[0].brakeI) < MERGE_M) merged[0].brakeI = merged.pop().brakeI;
    return merged.map(({ brakeI, endI }) => {
        let apexI = brakeI;
        for (let k = brakeI; ; k = (k + 1) % n) { if (rl.speed[k] < rl.speed[apexI]) apexI = k; if (k === endI) break; }
        const d = heading(t.path, endI) - heading(t.path, brakeI), turn = Math.sign(Math.round(Math.atan2(Math.sin(d), Math.cos(d)) * 1000));
        return { brakeI, apexI, endI, brakeS: at(brakeI), endS: at(endI), vApex: rl.speed[apexI], turn };
    });
}

export function linePoint(rl, t, i) {
    const P = t.path, n = P.length, p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, o = rl.offset[i];
    return { x: p.x - ((b.y - a.y) / len) * o, y: p.y + ((b.x - a.x) / len) * o };
}

export function pastLine(t, i, x, y) {
    if (!t.edgeR) return false;
    const P = t.path, n = P.length, a = P[i], b = P[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)), px = a.x + dx * u, py = a.y + dy * u;
    const right = -dy * (x - px) + dx * (y - py) > 0, e = right ? t.edgeR : (t.edgeL || t.edgeR);
    return Math.hypot(x - px, y - py) > e[i] + (e[(i + 1) % n] - e[i]) * u + 1 * t.scale;
}

export function createCoach(corners, t, rl, opts = {}) {
    const L = lapM(t), at = (i) => t.cum[i] / t.scale, rel = (s, from) => (((s - from) % L) + L) % L;
    const st = { last: -Infinity, tips: {}, streak: corners.map(() => 0), cur: null, intro: !!opts.intro, lap: null, lapClean: true, cleanLaps: 0, nudged: false, towSince: null };
    const inWindow = (c, s) => rel(s, c.brakeS - WINDOW_M) <= rel(c.endS + WIDE_AFTER_M, c.brakeS - WINDOW_M);
    const say = (f, text, tone) => {
        if (f.t - st.last < GAP_S || f.t - (f.stewardAt ?? -Infinity) < STEWARD_HOLD_S) return null;
        st.last = f.t;
        return { text, tone };
    };
    const tip = (f, key, text) => {
        if ((st.tips[key] || 0) >= TIP_MAX) return null;
        const m = say(f, text, 'tip');
        if (m) st.tips[key] = (st.tips[key] || 0) + 1;
        return m;
    };

    function record(f, s) {
        const r = st.cur, c = corners[r.k];
        const before = rel(s, c.brakeS - WINDOW_M) < WINDOW_M, inCorner = rel(s, c.brakeS) <= rel(c.endS, c.brakeS);
        if (r.entry === undefined) { r.entry = f.speed; if (f.speed < ENTRY_K * c.vApex) r.skip = true; }
        if (f.ghostOverlap || f.t - (f.stewardAt ?? -Infinity) < CONTACT_QUIET_S) r.skip = true;
        if (r.prevS !== undefined && rel(s, r.prevS) > rel(r.prevS, s)) r.skip = true; // moved backwards along the lap: spun or reversing
        r.prevS = s;
        const braking = f.brake > BRAKE_ON || f.assistBrake;
        if (r.brakeAt === null && braking && (before || inCorner)) {
            r.brakeAt = s;
            r.early = before ? WINDOW_M - rel(s, c.brakeS - WINDOW_M) : 0;
            r.help = !(f.brake > BRAKE_ON);
        }
        if (inCorner) r.vMin = Math.min(r.vMin, f.speed);
        const apexS = at(c.apexI), d = Math.min(rel(s, apexS), rel(apexS, s));
        if (inCorner && d < r.apexD) { const q = linePoint(rl, t, c.apexI); r.apexD = d; r.apexMiss = Math.hypot(f.x - q.x, f.y - q.y) / t.scale; }
        if (f.wide && rel(s, c.brakeS) <= rel(c.endS + WIDE_AFTER_M, c.brakeS)) r.wide = true;
    }

    function verdict() {
        const r = st.cur, c = corners[r.k];
        if (r.skip || r.vMin === Infinity) return null;
        let v;
        if (r.wide) v = ['Too fast in — missed the apex', 'bad'];
        else if (!r.help && r.early > EARLY_M) v = [`Braked ${Math.round(r.early / 5) * 5} m early — brake later`, 'warn'];
        else if (r.vMin < SLOW_K * c.vApex) v = ['Slow mid-corner — carry more speed', 'warn'];
        else if (r.apexMiss > APEX_M) v = ['Missed the apex — aim for the inside kerb', 'warn'];
        else v = ['Perfect corner', 'good'];
        if (v[1] !== 'good') { st.lapClean = false; st.streak[r.k] = 0; return v; }
        st.streak[r.k]++;
        return st.streak[r.k] > QUIET_AFTER ? null : v;
    }

    return {
        update(f) {
            if (st.lap !== null && f.lap > st.lap) { st.cleanLaps = st.lapClean ? st.cleanLaps + 1 : 0; st.lapClean = true; }
            st.lap = f.lap;
            if (f.t - (f.stewardAt ?? -Infinity) < CONTACT_QUIET_S) st.lapClean = false;
            if (st.intro) { st.intro = false; return say(f, 'Coach on — C to turn off', 'tip'); }
            if (f.inPit) { st.cur = null; return null; }
            const s = at(f.i);
            let v = null;
            if (st.cur && !inWindow(corners[st.cur.k], s)) { v = verdict(); st.cur = null; }
            if (!st.cur) {
                const k = corners.findIndex((c) => inWindow(c, s));
                if (k >= 0) st.cur = { k, brakeAt: null, early: 0, help: false, vMin: Infinity, apexD: Infinity, apexMiss: 0, wide: false, skip: f.mode === 'race' && f.lap === 0 && k === 0 };
            }
            if (st.cur) record(f, s);
            if (v) return say(f, v[0], v[1]);
            return this.tips ? this.tips(f, s) : null;
        },
    };
}
```

(Task 2 adds the `tips(f, s)` method; until then `update` returns null outside corner verdicts. Implementer: if an edge of the tests disagrees with this sketch — e.g. the reverse-pass test — fix the code, keeping every Global Constraint; record what changed in the report.)

- [ ] **Step 4: Run** `node --test test/coach.client.test.js && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/coach.js test/coach.client.test.js
git commit -m "Coach: corners from the racing line and one plain verdict per corner"
```

---

### Task 2: Racecraft tips, nudges and the help flag

**Files:**
- Modify: `public/js/coach.js` (add `tips` to the returned object), `public/js/sim/drive.js:221-222`
- Test: `test/coach.client.test.js`, `test/drive.test.js` (or the existing shared-sim test file that has a `driveCar` helper — use whichever has one)

**Interfaces:**
- Consumes: Task 1 `createCoach`, frame fields `tow`, `near`, `angle`, `drsAvailable`, `inDrsZone`, `drsOpen`, `helpLevel`, `lap`.
- Produces: `p.assistBrake` (boolean) set every `driveCar` call.

- [ ] **Step 1: Write the failing tests** — append to `test/coach.client.test.js`:

```js
const corner1 = (turn) => { const { t, rl } = strip(); const c = C.cornersOf(rl, t)[0]; return { t, rl, cs: [{ ...c, turn }] }; };
const frameAt = (s, o = {}) => ({ ...base, t: 0, i: s, x: s, y: 0, speed: 80, brake: 0, assistBrake: false, wide: false, ...o });

test('tow tip after 1 s in the slipstream, at most 3 times', () => {
    const { t, rl, cs } = corner1(1), c = C.createCoach(cs, t, rl), seen = [];
    for (let k = 0; k < 400; k++) { const m = c.update(frameAt(100, { t: k * 0.1, tow: 0.5 })); if (m) seen.push(m.text); }
    assert.deepStrictEqual(seen, Array(3).fill('In the tow — pull out and brake later to pass'));
    const c2 = C.createCoach(cs, t, rl);
    assert.strictEqual(c2.update(frameAt(100, { t: 0, tow: 0.5 })), null);
    assert.strictEqual(c2.update(frameAt(100, { t: 0.5, tow: 0.5 })), null);
    assert.strictEqual(c2.update(frameAt(100, { t: 1.1, tow: 0.5 })).text, 'In the tow — pull out and brake later to pass');
});

test('side by side into a braking zone: inside or outside', () => {
    const { t, rl, cs } = corner1(1);
    const inside = C.createCoach(cs, t, rl).update(frameAt(330, { near: [{ x: 331, y: -3 }] })); // other car on the outside
    assert.strictEqual(inside.text, 'Inside line — brake late, the corner is yours');
    const outside = C.createCoach(cs, t, rl).update(frameAt(330, { near: [{ x: 331, y: 3 }] }));
    assert.strictEqual(outside.text, 'Outside — leave room or tuck in behind');
    assert.strictEqual(C.createCoach(cs, t, rl).update(frameAt(200, { near: [{ x: 201, y: 3 }] })), null, 'too far before the braking zone');
});

test('DRS tip in the zone when available and closed', () => {
    const { t, rl, cs } = corner1(1);
    assert.strictEqual(C.createCoach(cs, t, rl).update(frameAt(100, { drsAvailable: true, inDrsZone: true })).text, 'DRS — press E');
    assert.strictEqual(C.createCoach(cs, t, rl).update(frameAt(100, { drsAvailable: true, inDrsZone: true, drsOpen: true })), null);
});

test('steward card holds tips back 4 s', () => {
    const { t, rl, cs } = corner1(1), c = C.createCoach(cs, t, rl);
    assert.strictEqual(c.update(frameAt(100, { t: 10, drsAvailable: true, inDrsZone: true, stewardAt: 8 })), null);
    assert.strictEqual(c.update(frameAt(100, { t: 12.5, drsAvailable: true, inDrsZone: true, stewardAt: 8 })).text, 'DRS — press E');
});

test('two clean laps on High help: nudge once', () => {
    const c = fresh();
    run(c, { lap: 1, t0: 0, helpLevel: 1 });
    run(c, { lap: 2, t0: 10, helpLevel: 1 });
    run(c, { lap: 3, t0: 20, helpLevel: 1 }); // lap 3 starts: laps 1 and 2 were clean
    const m = c.update(frameAt(100, { t: 40, lap: 3, helpLevel: 1 }));
    assert.strictEqual(m.text, 'Clean laps! Try Low braking help (Q) — it\'s faster');
    assert.strictEqual(c.update(frameAt(100, { t: 50, lap: 3, helpLevel: 1 })), null);
});
```

And the shared-sim test (in the file with a `driveCar` setup — adapt names):

```js
test('assistBrake: set only when the braking help brakes harder than the driver', async () => {
    const D = await import('../public/js/sim/drive.js'), Track = require('../src/game/Track'), Game = require('../src/game/Game');
    const t = Track.load('monza'), io = { emit() {}, volatile: { emit() {} } };
    for (const [assist, expect] of [['100,100', true], ['0,0', false]]) {
        const g = new Game(io, [{ id: 'a', username: 'a', teamId: 'ferrari', assist }], t, { maxLaps: 3, qualifying: false }, () => {});
        const p = g.players.a, s0 = t.start, v = 85 * t.scale;
        Object.assign(p, { vx: Math.cos(s0.angle) * v, vy: Math.sin(s0.angle) * v, speed: v });
        let seen = false;
        for (let k = 0; k < 60 * 20 && !seen; k++) { D.driveCar(p, { throttle: 1, brake: 0, steer: 0, drs: false }, t, 1 / 60); seen = !!p.assistBrake; }
        assert.strictEqual(seen, expect, assist);
    }
});
```

(Monza's start straight leads into the first chicane at ~85 m/s: High help must brake. If the car leaves the road before the help acts, place it with the pit-assist tests' `pointOnPath`-style helper 300 m before turn 1 instead — say so in the report.)

- [ ] **Step 2: Run** the two test files → FAIL.

- [ ] **Step 3: Implement.** `public/js/sim/drive.js`, after `const used = …`: `p.assistBrake = used.brake > (input.brake || 0) + 0.05; // the help braked for the driver (the coach doesn't tell them to brake later)`.

`public/js/coach.js`: add constants `const TOW_ON = 0.3, TOW_S = 1, SIDE_M = 100, CAR_M = 5.5;` and a `tips` method on the returned object:

```js
        tips(f, s) {
            if (!st.nudged && st.cleanLaps >= 2 && f.helpLevel >= 1) { const m = say(f, 'Clean laps! Try Low braking help (Q) — it\'s faster', 'tip'); if (m) st.nudged = true; return m; }
            if (f.tow > TOW_ON) { st.towSince ??= f.t; if (f.t - st.towSince >= TOW_S) { const m = tip(f, 'tow', 'In the tow — pull out and brake later to pass'); if (m) return m; } } else st.towSince = null;
            const next = corners.find((c) => rel(c.brakeS, s) <= SIDE_M && c.turn !== 0);
            if (next && f.near.length) {
                const cos = Math.cos(f.angle), sin = Math.sin(f.angle);
                for (const o of f.near) {
                    const dx = o.x - f.x, dy = o.y - f.y, ahead = (dx * cos + dy * sin) / t.scale, lat = (-dx * sin + dy * cos) / t.scale;
                    if (Math.abs(ahead) >= 1.5 * CAR_M || Math.abs(lat) < 1.5 || Math.abs(lat) > 5) continue;
                    return next.turn * lat < 0 ? tip(f, 'inside', 'Inside line — brake late, the corner is yours') : tip(f, 'outside', 'Outside — leave room or tuck in behind');
                }
            }
            if (f.drsAvailable && f.inDrsZone && !f.drsOpen) return tip(f, 'drs', 'DRS — press E');
            return null;
        },
```

(`say`, `tip`, `rel`, `st`, `corners`, `t` are the closure variables from Task 1.)

- [ ] **Step 4: Run** `node --test test/coach.client.test.js && npm test` → PASS (predictor parity and sim golden tests included — `assistBrake` must not change motion).

- [ ] **Step 5: Commit**

```bash
git add public/js/coach.js public/js/sim/drive.js test/
git commit -m "Coach: tow, side-by-side and DRS tips, clean-lap nudge; the sim marks when the help braked"
```

---

### Task 3: Coach on the HUD, key C and the lobby switch

**Files:**
- Modify: `public/index.html` (`#coach-line` in `#hud`; lobby "Coach" segment in the driver help picker), `public/css/style.css`, `public/js/game3d.js`, `public/js/app.js`

**Interfaces:**
- Consumes: `cornersOf`, `createCoach`, `pastLine`, `SHOW_S` from `./coach.js`; `predictor.car` (`x, y, angle, speed, tow, assistBrake`); `clientState.gameState[me]` (`inPit, lap, ghost, drsAvailable, drs, finished`); `inDrsZone(t.drsZones, lapS)` from `./timing.js`; `trackIndex` from `./racingline.js`; `parseAssist` (already imported).
- Produces: `window.onCoachChange(v)` (`'on'|'off'`) called by app.js.

- [ ] **Step 1: Markup and CSS.** `index.html`, inside `#hud` next to `#steward-card`: `<div id="coach-line" class="hidden"></div>`. In the lobby help picker after the steering segment (before `#help-note`):

```html
<span class="assist-label">Coach</span>
<div class="seg" id="coach-seg" role="group" aria-label="Coach">
    <button type="button" data-v="on">On</button><button type="button" data-v="off">Off</button>
</div>
```

`style.css`:

```css
/* Coach: one short line bottom centre, above the cluster on phones */
#coach-line { position: absolute; left: 50%; bottom: calc(var(--pad) + 1em); transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 6px 14px; border-radius: 6px; background: rgba(0,0,0,0.65); border-bottom: 3px solid #888; color: #fff; font-weight: 800; font-size: 0.95rem; text-align: center; pointer-events: none; transition: opacity 0.3s; }
#coach-line.good { border-bottom-color: #22c55e; } #coach-line.warn { border-bottom-color: #f59e0b; }
#coach-line.bad { border-bottom-color: #e10600; } #coach-line.tip { border-bottom-color: #3b82f6; }
#coach-line.hidden { display: none; }
@media (max-width: 600px) { #coach-line { bottom: 330px; } }
```

(Verify against the cluster, tyre card and pit banner positions; keep clear of all at 1280×720 and 390×844 — Task 4 checks visually.)

- [ ] **Step 2: game3d.js wiring.**

```js
import { cornersOf, createCoach, pastLine, SHOW_S } from './coach.js';
```

Module state (next to the other HUD state lets; no `$` at module top level — `const $` is defined further down):

```js
let coach = null, coachIdx = null, coachTimer = null, coachIntro = true, stewardAtS = -Infinity;
let coachOn = store.get('lanrace.coach') !== 'off';
window.onCoachChange = (v) => { coachOn = v !== 'off'; };
```

(Check `store`'s API in game3d.js — `store.get` exists; use its setter, or `localStorage` in try/catch, for writes.)

At the end of `buildRacingLine(t)` (also when `rl` is missing, so tips still work):

```js
    coach = createCoach(t.racingLine ? cornersOf(t.racingLine, t) : [], t, t.racingLine || { offset: [], speed: [], phase: [] }, { intro: coachOn && coachIntro });
    if (coachOn) coachIntro = false;
    coachIdx = null;
```

In `window.showSteward`, first line: `stewardAtS = performance.now() / 1000;`.

Key C in `onKey` next to R/Q: `if (down && key === 'c' && !e.repeat && clientState.status !== 'LOBBY') toggleCoach();` with

```js
function toggleCoach() {
    coachOn = !coachOn;
    try { localStorage.setItem('lanrace.coach', coachOn ? 'on' : 'off'); } catch (e) { /* blocked */ }
    window.showBanner?.(`COACH: ${coachOn ? 'ON' : 'OFF'}`, true);
    if (!coachOn) document.getElementById('coach-line').classList.add('hidden');
}
```

In `updateHUD` (where `racing`, `me`, `td`/track and `predictor` are in scope):

```js
    const car = predictor?.car, st2 = clientState.status;
    if (coach && coachOn && racing && car && !me.finished && (st2 === 'RACE' || st2 === 'QUALIFYING')) {
        const t = clientState.trackData, sc = t.scale, now = performance.now() / 1000;
        coachIdx = trackIndex(t.path, car.x, car.y, coachIdx, 30 * sc);
        const near = [];
        for (const id in gs) { const o = gs[id]; if (id !== clientState.me && o && !o.finished && o.x !== undefined) near.push({ x: o.x, y: o.y }); }
        const total = t.cum[t.path.length], lapS = (((t.cum[coachIdx] - (t.startS || 0)) % total) + total) % total;
        const msg = coach.update({ t: now, i: coachIdx, x: car.x, y: car.y, angle: car.angle, speed: (car.speed || 0) / sc, brake: input.brake || 0,
            assistBrake: !!car.assistBrake, tow: car.tow || 0, inPit: !!me.inPit, ghostOverlap: !!me.ghost && near.some((o) => Math.hypot(o.x - car.x, o.y - car.y) < 5.5 * sc),
            wide: pastLine(t, coachIdx, car.x, car.y), lap: me.lap, mode: st2 === 'QUALIFYING' ? 'quali' : 'race', stewardAt: stewardAtS, near,
            drsAvailable: !!me.drsAvailable, inDrsZone: inDrsZone(t.drsZones || [], lapS), drsOpen: !!me.drs, helpLevel: parseAssist(predictor.assist).brake });
        if (msg) {
            const el = $('coach-line');
            el.textContent = msg.text;
            el.className = msg.tone;
            clearTimeout(coachTimer);
            coachTimer = setTimeout(() => el.classList.add('hidden'), SHOW_S * 1000);
        }
    }
```

(Use the real names for the game state map — `gs` in `updateHUD` — and for other cars' positions: if `gs[id]` has no `x/y`, take them from the same place the minimap draws other cars and say which in the report. `input` is the module-level driver input.) In `initGameVisuals`: `clearTimeout(coachTimer); $('coach-line')?.classList.add('hidden'); stewardAtS = -Infinity;`.

- [ ] **Step 3: app.js lobby switch** (next to the help segment code):

```js
const coachSeg = document.getElementById('coach-seg');
function renderCoach() {
    let v = 'on';
    try { v = localStorage.getItem('lanrace.coach') === 'off' ? 'off' : 'on'; } catch (e) { /* blocked */ }
    coachSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    return v;
}
coachSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try { localStorage.setItem('lanrace.coach', b.dataset.v); } catch (err) { /* blocked */ }
    window.onCoachChange?.(renderCoach());
});
renderCoach();
```

- [ ] **Step 4: Run** `node --check public/js/game3d.js && node --check public/js/app.js && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/css/style.css public/js/game3d.js public/js/app.js
git commit -m "Coach on the HUD: one line above the cluster, C to toggle, lobby switch"
```

---

### Task 4: Real game check (browser)

**Files:** none in the repo (scratchpad harness only).

- [ ] **Step 1:** Throwaway server on port 3299 (scratchpad `pw/harness.js` pattern; never 3232). One player, race, qualifying on (practice) and off.
- [ ] **Step 2:** Drive with a simple scripted key pattern (hold W; brake early for the first corner on purpose) and capture `#coach-line` text and screenshots: expect the intro, then a corner report (`Braked … early` or similar). Toggle C → banner, line hidden; lobby switch reflects it after reload.
- [ ] **Step 3:** Call the coach line styles via `document.getElementById('coach-line')` directly for each tone; screenshot at 1280×720 and 390×844; check no overlap with the cluster, tyre card, steward card, pit banner.
- [ ] **Step 4:** No page errors. Record findings; fix in a `Browser check fixes: …` commit if needed; `npm test` → PASS.
