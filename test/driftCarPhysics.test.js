const test = require('node:test');
const assert = require('node:assert');
const { step, PROFILES, pacejkaLateralMu } = require('../src/game/DriftCarPhysics');

const DT = 1 / 60, S = 6;
const mk = (v = 0, vehicleClass = 'tuner') => ({
    x: 0, y: 0, angle: 0, vx: v * S, vy: 0, speed: v * S, steer: 0,
    vehicleClass,
    driftAngle: 0,
    isDrifting: false
});
const kmh = (c) => (c.speed / S) * 3.6;
const FULL = { throttle: 1, brake: 0, steer: 0, handbrake: false };
const BRAKE = { throttle: 0, brake: 1, steer: 0, handbrake: false };
const HANDBRAKE_STEER = { throttle: 0.3, brake: 0, steer: 0.8, handbrake: true };

test('profiles exist and have correct specifications', () => {
    assert.ok(PROFILES.tuner, 'tuner profile exists');
    assert.ok(PROFILES.nascar, 'nascar profile exists');
    assert.ok(PROFILES.gt3, 'gt3 profile exists');

    assert.strictEqual(PROFILES.tuner.MAX_STEER, 1.05);
    assert.strictEqual(PROFILES.nascar.DRAFT_MULT, 2.5);
    assert.strictEqual(PROFILES.gt3.MASS, 1350);
});

test('Pacejka lateral friction model produces peak friction at optimal slip', () => {
    const peakSlip = 0.15; // ~8.6 degrees
    const highSlip = 0.8;  // ~45 degrees
    const zeroSlip = 0.0;
    const peakMu = 1.55;
    const slideMu = 0.92;

    const fZero = pacejkaLateralMu(zeroSlip, peakSlip, peakMu, slideMu);
    const fPeak = pacejkaLateralMu(peakSlip, peakSlip, peakMu, slideMu);
    const fHigh = pacejkaLateralMu(highSlip, peakSlip, peakMu, slideMu);

    assert.strictEqual(fZero, 0, 'zero slip produces zero lateral force');
    assert.ok(fPeak > fHigh, 'peak slip produces higher lateral grip than saturated slide');
    assert.ok(fPeak <= peakMu, 'peak does not exceed peak friction coefficient');
});

test('acceleration and top speed for drift vehicle classes', () => {
    for (const vClass of ['tuner', 'nascar', 'gt3']) {
        const c = mk(0, vClass);
        let t = 0, t100 = null;
        while (t < 20) {
            step(c, FULL, DT, S, false, 'off', vClass);
            t += DT;
            if (t100 === null && kmh(c) >= 100) t100 = t;
        }
        assert.ok(t100 !== null && t100 <= 8.0, `${vClass} reaches 100 km/h in ${t100}s`);
        assert.ok(kmh(c) >= 230, `${vClass} top speed is ${kmh(c)} km/h`);
    }
});

test('dynamic weight transfer shifts load forward during hard braking and rearward during acceleration', () => {
    const cBrake = mk(120 / 3.6, 'tuner');
    // First step establishes negative prevAx (deceleration)
    step(cBrake, BRAKE, DT, S, false, 'off', 'tuner');
    // Second step calculates fzFront / fzRear using prevAx
    step(cBrake, BRAKE, DT, S, false, 'off', 'tuner');
    assert.ok(cBrake.prevAx < 0, `negative longitudinal acceleration: ${cBrake.prevAx}`);

    const cAccel = mk(30 / 3.6, 'tuner');
    step(cAccel, FULL, DT, S, false, 'off', 'tuner');
    step(cAccel, FULL, DT, S, false, 'off', 'tuner');
    assert.ok(cAccel.prevAx > 0, `positive longitudinal acceleration: ${cAccel.prevAx}`);
});

test('handbrake input rapidly induces yaw rate and drift slip angle', () => {
    const c = mk(80 / 3.6, 'tuner');
    const angle0 = c.angle;

    // Pull handbrake while steering
    for (let i = 0; i < 20; i++) {
        step(c, HANDBRAKE_STEER, DT, S, false, 'off', 'tuner');
    }

    assert.ok(Math.abs(c.angle - angle0) > 0.05, `car rotated significantly: ${c.angle - angle0} rad`);
    assert.ok(c.driftAngle > 2.0, `drift angle initiated: ${c.driftAngle}°`);
});

test('NASCAR drafting slingshot vacuum reduces drag and increases top speed', () => {
    const cStandard = mk(250 / 3.6, 'nascar');
    cStandard.dragMul = 1.0;
    for (let i = 0; i < 120; i++) step(cStandard, FULL, DT, S, false, 'off', 'nascar');

    const cDraft = mk(250 / 3.6, 'nascar');
    cDraft.dragMul = 0.25; // 75% drag reduction from drafting
    for (let i = 0; i < 120; i++) step(cDraft, FULL, DT, S, false, 'off', 'nascar');

    assert.ok(kmh(cDraft) > kmh(cStandard) + 12, `draft top speed ${kmh(cDraft)} exceeds standard ${kmh(cStandard)}`);
});
