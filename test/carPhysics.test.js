const test = require('node:test');
const assert = require('node:assert');
const { step, C } = require('../src/game/CarPhysics');

const DT = 1 / 60, S = 6;
const mk = (v = 0) => ({ x: 0, y: 0, angle: 0, vx: v * S, vy: 0, speed: v * S, steer: 0 });
const kmh = (c) => (c.speed / S) * 3.6;
const FULL = { throttle: 1, brake: 0, steer: 0 };
const BRAKE = { throttle: 0, brake: 1, steer: 0 };
const COAST_LOCK = { throttle: 0, brake: 0, steer: 1 };
const vDir = (c) => Math.atan2(c.vy, c.vx);
const slipAngle = (c) => Math.abs(Math.atan2(-c.vx * Math.sin(c.angle) + c.vy * Math.cos(c.angle), c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle)));
// Path radius from how fast the velocity (not the nose) turns, over `seconds` at full lock
function pathRadius(v, seconds, input = COAST_LOCK, assist = 'off') {
    const c = mk(v), d0 = vDir(c), n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) step(c, input, DT, S, false, assist);
    return (Math.hypot(c.vx, c.vy) / S) / ((vDir(c) - d0) / seconds);
}

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

test('cornering grip matches assisted μ·(g + downforce/m) within 15%', () => {
    for (const v of [20, 50, 80]) {
        const c = mk(v), d0 = vDir(c);
        for (let i = 0; i < 12; i++) step(c, COAST_LOCK, DT, S);
        const vNow = Math.hypot(c.vx, c.vy) / S;
        const measured = vNow * ((vDir(c) - d0) / (12 * DT));
        const formula = C.MU * C.LAT_ASSIST * (C.G + (0.5 * C.RHO * C.CLA * vNow * vNow) / C.MASS);
        assert.ok(Math.abs(measured - formula) / formula < 0.15, `v=${v}: ${measured} vs ${formula}`);
    }
});

test('too fast for a 50 m corner: the car runs wide', () => {
    const r = pathRadius(70, 1);
    assert.ok(r > 50, `radius ${r} m`); // can't hold the 50 m corner at 252 km/h
});

test('chicane: full lock at 75 km/h holds a path radius under 20 m', () => {
    const r = pathRadius(75 / 3.6, 0.5, { throttle: 0.3, brake: 0, steer: 1 });
    assert.ok(r < 20, `radius ${r} m`);
});

test('assist never spins: 3 s at full lock from 80 km/h keeps the slide under 17°', () => {
    const c = mk(80 / 3.6);
    let worst = 0;
    for (let i = 0; i < 180; i++) {
        step(c, { throttle: 0.3, brake: 0, steer: 1 }, DT, S);
        worst = Math.max(worst, slipAngle(c));
    }
    assert.ok(worst < (17 * Math.PI) / 180, `slip ${(worst * 180) / Math.PI}°`);
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

test('full brake + full steer still turns (ABS keeps grip for steering)', () => {
    const c = mk(150 / 3.6), d0 = vDir(c), h0 = c.angle;
    for (let i = 0; i < 30; i++) step(c, { throttle: 0, brake: 1, steer: 1 }, DT, S);
    const turnedDeg = ((c.angle - h0) * 180) / Math.PI;
    const pathDeg = ((vDir(c) - d0) * 180) / Math.PI;
    assert.ok(turnedDeg > 8, `nose turned only ${turnedDeg.toFixed(2)}° in 0.5 s while braking`);
    assert.ok(pathDeg > 5, `path turned only ${pathDeg.toFixed(2)}° in 0.5 s while braking`);
});

test('keyboard chicane: full lock at 100 km/h holds a path radius ≤ 22 m', () => {
    const r = pathRadius(100 / 3.6, 0.5, { throttle: 0.3, brake: 0, steer: 1 });
    assert.ok(r <= 22, `radius ${r} m`);
});

test('braking into a corner (S + full lock at 130 km/h) still turns tighter than 32 m', () => {
    const r = pathRadius(130 / 3.6, 0.5, { throttle: 0, brake: 1, steer: 1 });
    assert.ok(r <= 32, `radius ${r} m`);
});

test('on grass at 60 km/h full lock gets back within a 24 m radius', () => {
    const c = mk(60 / 3.6), d0 = vDir(c);
    for (let i = 0; i < 30; i++) step(c, { throttle: 1, brake: 0, steer: 1 }, DT, S, true);
    const r = (Math.hypot(c.vx, c.vy) / S) / ((vDir(c) - d0) / 0.5);
    assert.ok(r <= 24, `radius ${r} m`);
});

test('high-speed steering is progressive: a light tap at 290 km/h is well below full-lock rotation', () => {
    const yawRate = (steer) => {
        const c = mk(290 / 3.6);
        for (let i = 0; i < 6; i++) step(c, { throttle: 1, brake: 0, steer }, DT, S);
        return c.angle / (6 * DT);
    };
    const ratio = yawRate(0.35) / yawRate(1);
    assert.ok(ratio < 0.5, `35% steer gives ${(ratio * 100).toFixed(0)}% of full-lock rotation`);
});

test('grass: a 30 m cut at 150 km/h on full throttle loses more than 20 km/h', () => {
    const c = mk(150 / 3.6);
    while (c.x / S < 30) step(c, FULL, DT, S, true);
    assert.ok(150 - kmh(c) > 20, `lost ${(150 - kmh(c)).toFixed(1)} km/h`);
});

test('grass: full throttle levels off below 110 km/h, and a stopped car can still drive away', () => {
    const fast = mk(150 / 3.6);
    for (let i = 0; i < 120; i++) step(fast, FULL, DT, S, true);
    assert.ok(kmh(fast) < 110, `${kmh(fast).toFixed(0)} km/h after 2 s`);
    const stopped = mk(0);
    for (let i = 0; i < 300; i++) step(stopped, FULL, DT, S, true);
    assert.ok(kmh(stopped) > 20, `${kmh(stopped).toFixed(0)} km/h after 5 s from rest`);
});

test('steering assist: chicane at 100 km/h ≤ 16 m, hairpin at 60 km/h ≤ 10 m', () => {
    const chicane = pathRadius(100 / 3.6, 0.5, { throttle: 0.3, brake: 0, steer: 1 }, 'steering');
    assert.ok(chicane <= 16, `chicane radius ${chicane} m`);
    const hairpin = pathRadius(60 / 3.6, 0.5, COAST_LOCK, 'steering');
    assert.ok(hairpin <= 10, `hairpin radius ${hairpin} m`);
});

test('steering assist changes nothing above 250 km/h', () => {
    const a = mk(260 / 3.6), b = mk(260 / 3.6);
    const input = { throttle: 1, brake: 0, steer: 0.4 };
    for (let i = 0; i < 30; i++) { step(a, input, DT, S, false, 'off'); step(b, input, DT, S, false, 'full'); }
    assert.deepStrictEqual([b.x, b.y, b.angle, b.vx, b.vy], [a.x, a.y, a.angle, a.vx, a.vy]);
});

test('DRS drag cut adds 25–35 km/h of top speed', async () => {
    const { DRS_DRAG } = await import('../public/js/sim/drive.js');
    const top = (dragMul) => { const c = { ...mk(80), dragMul }; for (let i = 0; i < 60 * 40; i++) step(c, FULL, DT, S); return kmh(c); };
    const gain = top(DRS_DRAG) - top(1);
    assert.ok(gain > 25 && gain < 35, `+${gain.toFixed(1)} km/h`);
});

// Elevation (car.grade: rise per metre along the heading; car.vcurv: 1/m, + compression, − crest)
test('hills: coasting up a 10% grade loses ~1 m/s more per second than on the flat; downhill gains it', () => {
    const coast = (grade) => { const c = Object.assign(mk(50), { grade }); for (let i = 0; i < 60; i++) step(c, { throttle: 0, brake: 0, steer: 0 }, DT, S); return c.speed / S; };
    const flat = coast(0), up = coast(0.1), down = coast(-0.1);
    assert.ok(Math.abs(flat - up - C.G * 0.1) < 0.1, `uphill ${flat - up} m/s`);
    assert.ok(Math.abs(down - flat - C.G * 0.1) < 0.1, `downhill ${down - flat} m/s`);
});

test('hills: a compression adds cornering grip, a crest takes it away (the car goes light)', () => {
    const turn = (vcurv) => { const c = Object.assign(mk(60), { vcurv }), d0 = vDir(c); for (let i = 0; i < 12; i++) step(c, COAST_LOCK, DT, S); return vDir(c) - d0; };
    const flat = turn(0), comp = turn(1 / 600), crest = turn(-1 / 600); // Eau Rouge-like radius at 216 km/h: ±0.6 g
    assert.ok(comp > flat * 1.2, `compression ${comp} vs ${flat}`);
    assert.ok(crest < flat * 0.8, `crest ${crest} vs ${flat}`);
    assert.ok(Number.isFinite(turn(-1)), 'airborne-hard crest stays finite');
});
