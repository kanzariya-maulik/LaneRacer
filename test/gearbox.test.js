const { test, before } = require('node:test');
const assert = require('node:assert');

let G;
before(async () => { G = await import('../public/js/audio/gearbox.js'); });
const kmh = (v) => v / 3.6;

// Accelerate from 0 to v at a constant rate; collect gear history and the highest rpm seen
function accelerate(box, toKmh, secs = 20) {
    const dt = 1 / 60, n = secs * 60, gears = [];
    let maxRpm = 0;
    for (let k = 0; k <= n; k++) {
        const r = box.update(kmh((toKmh * k) / n), 1, dt);
        maxRpm = Math.max(maxRpm, r.rpm);
        if (gears.at(-1) !== r.gear) gears.push(r.gear);
    }
    return { gears, maxRpm };
}

test('accelerating to 370 km/h goes up through all 7 gears in order and never exceeds the rev limit', () => {
    const box = new G.Gearbox();
    const { gears, maxRpm } = accelerate(box, 370);
    assert.deepStrictEqual(gears, [1, 2, 3, 4, 5, 6, 7]);
    assert.ok(maxRpm <= G.REV_LIMIT, `${maxRpm}`);
});

test('upshift happens at 17,800 rpm in the old gear', () => {
    const box = new G.Gearbox();
    let last = box.update(0, 1, 1 / 60);
    for (let v = 0; v < 140; v += 0.25) {
        const before = last.gear, rpmBefore = (v * 18000) / G.GEAR_TOP_KMH[before - 1];
        last = box.update(kmh(v), 1, 1 / 60);
        if (last.gear === 2 && before === 1) {
            assert.ok(rpmBefore >= 17700 && rpmBefore <= 17900, `shift at ${rpmBefore.toFixed(0)} rpm`);
            return;
        }
    }
    assert.fail('never shifted to 2nd');
});

test('braking 300 → 80 km/h shifts down one gear at a time, never above 17,800 rpm after a shift', () => {
    const box = new G.Gearbox();
    accelerate(box, 300);
    const start = box.update(kmh(300), 0, 1 / 60).gear;
    let prev = start, downs = 0;
    for (let v = 300; v >= 80; v -= 0.5) {           // ~3 s of braking
        const r = box.update(kmh(v), 0, 1 / 60);
        if (r.gear !== prev) {
            assert.strictEqual(r.gear, prev - 1, 'one gear at a time');
            assert.ok(r.rpm <= G.UPSHIFT, `${r.rpm} rpm after downshift`);
            downs++;
            prev = r.gear;
        }
    }
    assert.ok(downs >= 3, `${downs} downshifts from gear ${start}`);
});

test('shifts are at least 0.12 s apart and reported as events', () => {
    const box = new G.Gearbox();
    const ev = [];
    let t = 0, lastShift = -1;
    for (let k = 0; k < 600; k++) {
        const r = box.update(kmh(Math.min(370, k * 3)), 1, 1 / 60);
        t += 1 / 60;
        for (const e of r.events) {
            ev.push(e);
            if (lastShift >= 0) assert.ok(t - lastShift >= G.SHIFT_GAP_S - 1e-9);
            lastShift = t;
        }
    }
    assert.ok(ev.length >= 6 && ev.every((e) => e === 'up'));
});

test('standing on the throttle at the start revs to the launch rpm; idle otherwise', () => {
    const box = new G.Gearbox();
    let r;
    for (let k = 0; k < 120; k++) r = box.update(0, 1, 1 / 60);
    assert.ok(Math.abs(r.rpm - G.LAUNCH) < 200, `${r.rpm}`);
    for (let k = 0; k < 120; k++) r = box.update(0, 0, 1 / 60);
    assert.ok(Math.abs(r.rpm - G.IDLE) < 200, `${r.rpm}`);
});

test('launch: full throttle from rest holds at least launch rpm through 1st (clutch slip), no dip at 30 km/h', () => {
    const box = new G.Gearbox();
    for (let k = 0; k < 60; k++) box.update(0, 1, 1 / 60); // revs up on the grid
    for (let v = 0; v <= 60; v += 0.5) { // ~2 s off the line
        const r = box.update(kmh(v), 1, 1 / 60);
        assert.ok(r.rpm >= G.LAUNCH - 200, `${r.rpm.toFixed(0)} rpm at ${v} km/h`);
    }
});

test('rev limiter is reported at the top of 7th with throttle on; pit limiter flag passes through', () => {
    const box = new G.Gearbox();
    accelerate(box, 380);
    const r = box.update(kmh(380), 1, 1 / 60);
    assert.strictEqual(r.gear, 7);
    assert.strictEqual(r.limiter, true);
    assert.strictEqual(box.update(kmh(80), 0.5, 1 / 60, true).pit, true);
});

test('reverse: negative speed shows R, rpm never below idle, no NaN', () => {
    const box = new G.Gearbox();
    for (let k = 0; k < 60; k++) {
        const r = box.update(-5, 0, 1 / 60);
        assert.strictEqual(r.reverse, true);
        assert.ok(r.rpm >= G.IDLE && Number.isFinite(r.rpm));
    }
    const r = box.update(NaN, NaN, 1 / 60);
    assert.ok(Number.isFinite(r.rpm));
});

test('reset() puts the car back in 1st at idle (new session)', () => {
    const box = new G.Gearbox();
    accelerate(box, 300);
    box.reset();
    const r = box.update(0, 0, 1 / 60);
    assert.strictEqual(r.gear, 1);
    assert.ok(r.rpm < G.IDLE + 300);
});

test('shiftLights: green from 13k, 5 at 15k, 10 at 16.5k, all 15 by 17.8k, flash on the limiter', () => {
    assert.strictEqual(G.shiftLights(12900, false).lit, 0);
    assert.strictEqual(G.shiftLights(13000, false).lit, 1);
    assert.strictEqual(G.shiftLights(14999, false).lit, 5);
    assert.strictEqual(G.shiftLights(16499, false).lit, 10);
    assert.strictEqual(G.shiftLights(17800, false).lit, 15);
    assert.strictEqual(G.shiftLights(17800, false).flash, true);
    assert.strictEqual(G.shiftLights(15000, true).flash, true);
    assert.strictEqual(G.shiftLights(15000, false).flash, false);
});

test('higher gears: accelerating to 600 km/h uses higher gears past 7 without rev-limiter flicker', () => {
    const box = new G.Gearbox(600);
    const { gears, maxRpm } = accelerate(box, 580, 30);
    assert.ok(gears.length > 7, `gears used: ${gears.join(', ')}`);
    assert.ok(gears[gears.length - 1] >= 10, `top gear reached: ${gears[gears.length - 1]}`);
    assert.ok(maxRpm <= G.REV_LIMIT, `max RPM: ${maxRpm}`);
});

test('pit lane stability: pit limiter holds gear <= 2 without oscillations or shift events', () => {
    const box = new G.Gearbox();
    accelerate(box, 250); // was in 5th gear
    for (let k = 0; k < 60; k++) {
        const r = box.update(kmh(80), 1.0, 1 / 60, true);
        assert.ok(r.gear <= 2, `gear in pit: ${r.gear}`);
        assert.strictEqual(r.limiter, false, 'rev limiter must not fire in pit lane');
        assert.strictEqual(r.pit, true, 'pit flag set');
        assert.strictEqual(r.events.length, 0, 'no shift oscillations in pit');
    }
});
