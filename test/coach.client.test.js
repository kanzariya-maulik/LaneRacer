// Live coach: corners from the racing line, one verdict per corner, rate limits
const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
let C;
let K; // car scale: distances below are for a real-size car
before(async () => { C = await import('../public/js/coach.js'); K = (await import('../public/js/sim/physics.js')).default.CAR_SCALE; });

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
    const { tap = false, brakeFrom = 400, vMinK = 1, lat = 0, wide = false, help = false, t0 = 0, entry, nearF, ...rest } = o, out = [];
    for (let s = 200; s <= 560; s += 2) {
        const v = entry ?? (s < brakeFrom ? 80 : s < 500 ? 30 * vMinK : 80), braking = s >= brakeFrom && s < 450;
        const m = coach.update({ ...base, ...rest, t: t0 + (s - 200) / 100, i: s % 1000, x: s, y: s >= 440 && s <= 460 ? lat : 0, speed: v, near: nearF ? nearF(s) : rest.near || [],
            brake: (!help && braking) || (tap && s >= 260 && s < 264) ? 1 : 0, assistBrake: help && braking, wide: wide && s > 470 && s < 480 });
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
    assert.strictEqual(run(fresh(), { contactAt: -1.2 }).length, 0); // 4.5 s before the verdict: past the 4 s hold, inside the 5 s corner quiet
    assert.strictEqual(run(fresh(), { ghostOverlap: true }).length, 0);
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

test('a brake tap early in the window does not count as the brake point', () => {
    assert.deepStrictEqual(texts(run(fresh(), { tap: true })), ['Perfect corner']);
});

test('intro survives the steward hold', () => {
    const c = fresh({ intro: true });
    assert.strictEqual(c.update({ ...base, t: 1, i: 100, x: 100, y: 0, speed: 80, brake: 0, assistBrake: false, wide: false, stewardAt: 0 }), null);
    assert.strictEqual(c.update({ ...base, t: 5, i: 102, x: 102, y: 0, speed: 80, brake: 0, assistBrake: false, wide: false, stewardAt: 0 }).text, 'Coach on — C to turn off');
});

test('a corner across the lap end is rated', () => {
    const { t, rl } = strip(580), c = C.createCoach(C.cornersOf(rl, t), t, rl), out = [];
    for (let s = 800; s <= 1120; s += 2) {
        const i = s % 1000, m = c.update({ ...base, t: (s - 800) / 100, i, x: i, y: 0, speed: rl.speed[i], brake: rl.phase[i] === 2 ? 1 : 0, assistBrake: false, wide: false });
        if (m) out.push(m);
    }
    assert.deepStrictEqual(texts(out), ['Perfect corner']);
});

test('apex is judged sideways on a track with 10 m point spacing', () => {
    const n = 100, path = [], cum = [0];
    for (let i = 0; i < n; i++) path.push({ x: i * 10, y: 0 });
    for (let i = 1; i <= n; i++) cum.push(i * 10);
    const phase = path.map((_, i) => (i >= 40 && i < 45 ? 2 : i >= 45 && i < 50 ? 1 : 0));
    const speed = path.map((_, i) => (i < 40 ? 80 : i < 45 ? 80 - (i - 40) * 10 : i < 50 ? 30 : 80));
    const t = { path, cum, scale: 1 }, rl = { phase, speed, offset: path.map(() => 0) };
    const go = (off) => {
        const c = C.createCoach(C.cornersOf(rl, t), t, rl), out = [];
        for (let s = 200; s <= 560; s += 2) {
            const i = Math.floor(s / 10), v = s < 400 ? 80 : s < 500 ? 30 : 80;
            const m = c.update({ ...base, t: (s - 200) / 100, i, x: s, y: s >= 440 && s <= 460 ? off : 0, speed: v, brake: s >= 400 && s < 450 ? 1 : 0, assistBrake: false, wide: false });
            if (m) out.push(m);
        }
        return texts(out);
    };
    assert.deepStrictEqual(go(0), ['Perfect corner']);
    assert.deepStrictEqual(go(3), ['Missed the apex — aim for the inside kerb']);
});

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
    const ms = texts(run(c, { lap: 3, t0: 20, helpLevel: 1 })); // lap 3 starts: laps 1 and 2 were clean, so the nudge comes in this pass
    assert.strictEqual(ms.filter((x) => x.startsWith('Clean laps!')).length, 1);
    assert.ok(ms.includes('Clean laps! Try Low braking help (Q) — it\'s faster'));
    assert.strictEqual(c.update(frameAt(100, { t: 50, lap: 3, helpLevel: 1 })), null);
});

test('a tip just before a corner does not cost it its verdict', () => {
    const c = fresh(), out = [];
    for (let s = 200; s <= 560; s += 2) {
        const t = (s - 200) / 100; // verdict at s=529 (t=3.29): a DRS tip 1.5 s earlier
        const m = c.update({ ...base, t, i: s, x: s, y: 0, speed: s < 400 ? 80 : s < 500 ? 30 : 80, brake: s >= 400 && s < 450 ? 1 : 0, assistBrake: false, wide: false,
            drsAvailable: true, inDrsZone: s >= 480 && s < 500 });
        if (m) out.push(m.text);
    }
    assert.deepStrictEqual(out, ['DRS — press E', 'Perfect corner']);
});

test('a track-limits steward card does not silence the wide verdict; contact still does', () => {
    assert.deepStrictEqual(texts(run(fresh(), { wide: true, stewardAt: 2.9 })), ['Too fast in — missed the apex']);
    assert.strictEqual(run(fresh(), { wide: true, contactAt: 2.9 }).length, 0);
});

test('a near miss without a steward card skips the corner', () => {
    assert.strictEqual(run(fresh(), { nearF: (s) => [{ x: s + 5 * K, y: 3 * K }] }).length, 0, '5.8 m away at real size');
    assert.strictEqual(run(fresh(), { nearF: (s) => [{ x: s + 5 * K, y: 4.9 * K }] }).length, 1, '7 m away at real size is not contact');
});

test('off-line side by side is not scolded; too fast in still is', () => {
    const side = (s) => [{ x: s + 5 * K, y: -4.9 * K }]; // alongside on the straight (real-size metres × K)
    assert.deepStrictEqual(texts(run(fresh(), { lat: 3, nearF: side })), ['Perfect corner']);
    assert.deepStrictEqual(texts(run(fresh(), { vMinK: 0.7, nearF: side })), ['Perfect corner']);
    assert.deepStrictEqual(texts(run(fresh(), { wide: true, nearF: side })), ['Too fast in — missed the apex']);
});

test('the help set the corner speed: no slow-mid-corner', () => {
    assert.deepStrictEqual(texts(run(fresh(), { vMinK: 0.7, help: true })), ['Perfect corner']);
});

test('the first-lap shield covers the first corner after the start line', () => {
    const { t, rl } = strip();
    for (let i = 560; i < 600; i++) rl.phase[i] = 2;
    for (let i = 600; i < 640; i++) { rl.phase[i] = 1; rl.speed[i] = 40; }
    t.startS = 520;
    const coach = C.createCoach(C.cornersOf(rl, t), t, rl), out = [];
    for (let s = 200; s <= 720; s += 2) {
        const v = s < 400 ? 80 : s < 500 ? 20 : s < 600 ? 60 : s < 640 ? 40 : 80;
        const m = coach.update({ ...base, lap: 0, t: (s - 200) / 20, i: s, x: s, y: 0, speed: v, brake: (s >= 400 && s < 450) || (s >= 560 && s < 600) ? 1 : 0, assistBrake: false, wide: false });
        if (m) out.push(m);
    }
    assert.deepStrictEqual(texts(out), ['Slow mid-corner — carry more speed']); // corner 0 is rated; corner 1 (first after the line) is shielded
});

test('the same amber verdict 3 times at a corner, then quiet', () => {
    const q = fresh();
    assert.deepStrictEqual([0, 10, 20, 30].map((t0) => run(q, { t0, vMinK: 0.7 }).length), [1, 1, 1, 0]);
    assert.strictEqual(run(q, { t0: 40 }).length, 1, 'a different verdict speaks again');
});
