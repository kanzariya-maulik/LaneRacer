const { test, before } = require('node:test');
const assert = require('node:assert');

let input;
before(async () => { input = await import('../public/js/input.js'); });

const DT = 1 / 60;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const hold = (keys, seconds, start = { throttle: 0, brake: 0, steer: 0 }) => {
    let s = start;
    for (let i = 0; i < Math.round(seconds / DT); i++) s = input.keyboardStep(s, keys, DT);
    return s;
};

test('steer held 0.1 s reaches 0.5, full lock by 0.2 s', () => {
    close(hold({ right: true }, 0.1).steer, 0.5);
    close(hold({ left: true }, 0.2).steer, -1);
});

test('releasing steer returns to centre within 0.1 s', () => {
    const s = hold({ right: true }, 0.1);
    close(hold({}, 0.1, s).steer, 0);
});

test('lift off W: brakes by the share of braking the driver took off the assist', () => {
    const fast = 40; // m/s
    close(input.liftOffBrake(0, fast), 1, 1e-9);        // assist braking 0%: lifting off is full brake
    close(input.liftOffBrake(0.7, fast), 0.3, 1e-9);    // 70%: the other 30% comes from lifting off
    close(input.liftOffBrake(1, fast), 0, 1e-9);        // 100%: the assist brakes, lifting off just coasts
    close(input.liftOffBrake(0, 0.5), 0, 1e-9);         // nearly stopped: no brake, or it would creep into reverse
    let s = hold({ up: true }, 0.5);
    for (let i = 0; i < 6; i++) s = input.keyboardStep(s, {}, DT, 0.3);
    close(s.brake, 0.3);                                // W released: brake settles at the lift-off amount
    close(input.keyboardStep(s, { up: true }, DT, 0.3).brake, 0, 1e-9);   // back on W: brake lets go at once
    close(hold({ down: true }, 0.05).brake, 1);         // S is still full brake / reverse
});

test('throttle ramps in 0.2 s, brake in 0.05 s', () => {
    close(hold({ up: true }, 0.1).throttle, 0.5);
    close(hold({ up: true }, 0.2).throttle, 1);
    close(hold({ down: true }, 0.05).brake, 1);
});

test('gamepad: dead zone and trigger mapping', () => {
    close(input.deadZone(0.05), 0);
    close(input.deadZone(0.55), 0.5);
    close(input.deadZone(-1), -1);
    const pad = { axes: [0.55, 0], buttons: Object.assign(new Array(8).fill({ value: 0 }), { 6: { value: 0.25 }, 7: { value: 0.75 } }) };
    const g = input.gamepadInput(pad);
    close(g.steer, 0.5);
    close(g.throttle, 0.75);
    close(g.brake, 0.25);
});

test('idle pad returns null so the keyboard keeps working', () => {
    const idle = { axes: [0.04, 0], buttons: new Array(8).fill({ value: 0 }) };
    assert.strictEqual(input.gamepadInput(idle), null);
    assert.strictEqual(input.gamepadInput(undefined), null);
});

test('changed() ignores tiny jitter', () => {
    const a = { throttle: 0.5, brake: 0, steer: 0.2 };
    assert.strictEqual(input.changed(a, null), true);
    assert.strictEqual(input.changed(a, { throttle: 0.505, brake: 0, steer: 0.2 }), false);
    assert.strictEqual(input.changed(a, { throttle: 0.6, brake: 0, steer: 0.2 }), true);
});

test('DRS button: keyboard E and gamepad Y, and a press counts as a change', async () => {
    const { keyboardStep, gamepadInput, changed } = input;
    const prev = { throttle: 1, brake: 0, steer: 0, drs: false };
    const next = keyboardStep(prev, { up: true, down: false, left: false, right: false, drs: true }, 1 / 60);
    assert.strictEqual(next.drs, true);
    assert.ok(changed(next, prev));
    const pad = { axes: [0], buttons: Array.from({ length: 8 }, (_, i) => ({ value: i === 7 ? 1 : 0, pressed: i === 3 || i === 7 })) };
    assert.strictEqual(gamepadInput(pad).drs, true);
});
