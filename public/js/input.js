// Pure input shaping, shared by game3d.js and the node tests.
export const RATES = { steerIn: 5, steerOut: 8, throttle: 5, brake: 20 }; // units per second
export const DEAD_ZONE = 0.1;

export function approach(cur, target, rate, dt) {
    const stepSize = rate * dt;
    return Math.abs(target - cur) <= stepSize ? target : cur + Math.sign(target - cur) * stepSize;
}

// keys: { up, down, left, right, drs, handbrake } booleans
export function keyboardStep(prev, keys, dt, autoBrake = false) {
    const steerTarget = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const isAutoBrake = autoBrake && !keys.up && !keys.down;
    const downPressed = keys.down || isAutoBrake;
    return {
        steer: approach(prev.steer, steerTarget, steerTarget === 0 ? RATES.steerOut : RATES.steerIn, dt),
        throttle: approach(prev.throttle, keys.up ? 1 : 0, RATES.throttle, dt),
        brake: approach(prev.brake, downPressed ? 1 : 0, RATES.brake, dt),
        drs: !!keys.drs,
        handbrake: !!keys.handbrake,
        explicitReverse: !!keys.down
    };
}

export function deadZone(v, dz = DEAD_ZONE) {
    const a = Math.abs(v);
    return a < dz ? 0 : (Math.sign(v) * (a - dz)) / (1 - dz);
}

// Standard mapping: left stick X steers, RT (button 7) throttle, LT (button 6) brake, Y (button 3) DRS, B (button 1) / X (button 2) Handbrake
export function gamepadInput(pad) {
    if (!pad) return null;
    const steer = deadZone(pad.axes[0] || 0);
    const throttle = pad.buttons[7]?.value || 0;
    const brake = pad.buttons[6]?.value || 0;
    const drs = !!pad.buttons[3]?.pressed;
    const handbrake = !!(pad.buttons[1]?.pressed || pad.buttons[2]?.pressed);
    if (Math.abs(steer) < 0.01 && throttle < 0.05 && brake < 0.05 && !drs && !handbrake) return null; // idle pad doesn't override the keyboard
    return { steer, throttle, brake, drs, handbrake };
}

export function changed(a, b) {
    return !b
        || Math.abs(a.steer - b.steer) > 0.01
        || Math.abs(a.throttle - b.throttle) > 0.01
        || Math.abs(a.brake - b.brake) > 0.01
        || !!a.drs !== !!b.drs
        || !!a.handbrake !== !!b.handbrake;
}

