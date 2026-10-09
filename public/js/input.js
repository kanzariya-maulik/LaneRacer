// Pure input shaping, shared by game3d.js and the node tests.
export const RATES = { steerIn: 5, steerOut: 8, throttle: 5, brake: 20 }; // units per second
export const DEAD_ZONE = 0.1;

export function approach(cur, target, rate, dt) {
    const stepSize = rate * dt;
    return Math.abs(target - cur) <= stepSize ? target : cur + Math.sign(target - cur) * stepSize;
}

export const LIFT_MIN_MS = 2; // m/s: below this lifting off doesn't brake (a held brake at a stop reverses)

// Lift off W = brake, for the share of braking the driver took off the assist (brakeAssist 0–1).
// At 100% the assist already brakes at the right time and amount, so lifting off just coasts.
export function liftOffBrake(brakeAssist, speedMs) {
    return speedMs > LIFT_MIN_MS ? Math.max(0, Math.min(1, 1 - brakeAssist)) : 0;
}

// keys: { up, down, left, right, drs, handbrake } booleans; liftBrake: brake while neither W nor S is held (liftOffBrake or autoBrake)
export function keyboardStep(prev, keys, dt, liftBrake = 0) {
    const steerTarget = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let targetBrake = 0;
    if (keys.down) {
        targetBrake = 1;
    } else if (!keys.up) {
        if (typeof liftBrake === 'number') targetBrake = liftBrake;
        else if (liftBrake) targetBrake = 1;
    }
    return {
        steer: approach(prev.steer, steerTarget, steerTarget === 0 ? RATES.steerOut : RATES.steerIn, dt),
        throttle: approach(prev.throttle, keys.up ? 1 : 0, RATES.throttle, dt),
        brake: approach(prev.brake, targetBrake, RATES.brake, dt),
        drs: !!keys.drs,
        handbrake: !!keys.handbrake,
        explicitReverse: !!keys.down
    };
}

export function deadZone(v, dz = DEAD_ZONE) {
    const a = Math.abs(v);
    return a < dz ? 0 : (Math.sign(v) * (a - dz)) / (1 - dz);
}

// Standard mapping: left stick X steers, RT (button 7) throttle, LT (button 6) brake, Y (button 3) DRS
export function gamepadInput(pad) {
    if (!pad) return null;
    const steer = deadZone(pad.axes[0] || 0);
    const throttle = pad.buttons[7]?.value || 0;
    const brake = pad.buttons[6]?.value || 0;
    const drs = !!pad.buttons[3]?.pressed;
    if (Math.abs(steer) < 0.01 && throttle < 0.05 && brake < 0.05 && !drs) return null; // idle pad doesn't override the keyboard
    return { steer, throttle, brake, drs };
}

export function changed(a, b) {
    return !b
        || Math.abs(a.steer - b.steer) > 0.01
        || Math.abs(a.throttle - b.throttle) > 0.01
        || Math.abs(a.brake - b.brake) > 0.01
        || !!a.drs !== !!b.drs;
}
