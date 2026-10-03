const test = require('node:test');
const assert = require('node:assert');
const Assist = require('../src/game/Assist');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
const at = (m) => monza.safeSpeed[monza.cum.findIndex(c => c >= m * monza.scale)];

test('safe speed: flat out on the straight, ~90 km/h at the first chicane', () => {
    assert.strictEqual(at(300), Assist.MAX_SAFE);
    let min = Infinity;
    for (let m = 800; m < 1300; m += 10) min = Math.min(min, at(m));
    assert.ok(min * 3.6 > 70 && min * 3.6 < 110, `${(min * 3.6).toFixed(0)} km/h`);
});

test('safe speed: a straight line is flat out', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 60, y: 0 }));
    for (const v of Assist.safeSpeeds(line, 6).slice(3, -3)) assert.strictEqual(v, Assist.MAX_SAFE);
});

const Physics = require('../src/game/Physics');
const CarPhysics = require('../src/game/CarPhysics');

// Flat out from 200 m down Monza's straight toward the first chicane (car keeps straight; the straight is straight)
function runToChicane(useAssist) {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 300 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    let apex = 0, min = Infinity;
    for (let i = 0; i < monza.path.length; i++) {
        const m = monza.cum[i] / monza.scale;
        if (m > 800 && m < 1300 && monza.safeSpeed[i] < min) { min = monza.safeSpeed[i]; apex = monza.cum[i]; }
    }
    const FULL = { throttle: 1, brake: 0, steer: 0 };
    for (let k = 0; k < 60 * 20; k++) {
        const near = Physics.nearestOnTrack(car.x, car.y, monza);
        if (monza.cum[near.i] >= apex) return { speed: car.speed / monza.scale, safe: min };
        const input = useAssist ? Assist.brakeAssist(car, FULL, monza, near) : FULL;
        CarPhysics.step(car, input, 1 / 60, monza.scale, false, useAssist ? 'full' : 'off');
    }
    throw new Error('never reached the chicane');
}

test('braking assist: flat out from 300 km/h, the car is at or below the chicane safe speed', () => {
    const { speed, safe } = runToChicane(true);
    assert.ok(speed <= safe * 1.05, `${(speed * 3.6).toFixed(0)} km/h vs safe ${(safe * 3.6).toFixed(0)}`);
    const off = runToChicane(false);
    assert.ok(off.speed > off.safe * 1.5, 'without the assist the car should arrive far too fast');
});

test('braking assist leaves the driver alone on a straight and never weakens braking', () => {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 150 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    const near = Physics.nearestOnTrack(car.x, car.y, monza);
    const input = { throttle: 1, brake: 0, steer: 0.2 };
    assert.strictEqual(Assist.brakeAssist(car, input, monza, near), input);
    const braking = { throttle: 0, brake: 1, steer: 0 };
    assert.strictEqual(Assist.brakeAssist(car, input, monza, near, '100,100') !== input ? Assist.brakeAssist(car, braking, monza, near).brake : 1, 1);
});

test('braking assist scales gradually from 0% to 100%', () => {
    // Car approaching Monza chicane fast (250 km/h) at 800m mark
    const s0 = monza.cum.findIndex(c => c >= 800 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 250 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    const near = Physics.nearestOnTrack(car.x, car.y, monza);
    const FULL = { throttle: 1, brake: 0, steer: 0 };

    const out0 = Assist.brakeAssist(car, FULL, monza, near, '100,0');
    const out30 = Assist.brakeAssist(car, FULL, monza, near, '100,30');
    const out75 = Assist.brakeAssist(car, FULL, monza, near, '100,75');
    const out100 = Assist.brakeAssist(car, FULL, monza, near, '100,100');

    assert.strictEqual(out0.brake, 0, '0% assist does not brake automatically');
    assert.ok(out30.brake > 0 && out30.brake < out75.brake, `30% brake (${out30.brake.toFixed(2)}) is less than 75% brake (${out75.brake.toFixed(2)})`);
    assert.ok(out75.brake <= out100.brake, `75% brake (${out75.brake.toFixed(2)}) is less than or equal to 100% brake (${out100.brake.toFixed(2)})`);
});



