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
