// Driving at the limit, shared by the line follower (lineFollower.js, the calibration's and tests' exact driver) and the
// bots (bots/driver.js): the corner limits are calibrated with this control, so a bot using it drives them cleanly.
const { C } = require('./CarPhysics');

// Pure pursuit onto the aim point (world units): the wheel angle for the arc through it, as a share of full lock as
// carphysics computes it (the steering help adds lock at low speed, grip caps it at speed). Also the arc's curvature (1/m),
// and the wheel the arc needs as a share of the lock (over 1: the car can't make it)
function pursue(p, ax, ay, sc, steerHelp) {
    const v = p.speed / sc, dx = ax - p.x, dy = ay - p.y, ld = Math.max(1e-3, Math.hypot(dx, dy) / sc);
    const alpha = Math.atan2(Math.sin(Math.atan2(dy, dx) - p.angle), Math.cos(Math.atan2(dy, dx) - p.angle));
    const wheel = Math.atan((C.WHEELBASE * 2 * Math.sin(alpha)) / ld);
    const grip = C.MU * (p.tyreGrip ?? 1) * (C.MASS * C.G + 0.5 * C.RHO * C.CLA * v * v);
    const blend = Math.max(0, Math.min(1, (C.ASSIST_OFF_KMH - v * 3.6) / (C.ASSIST_OFF_KMH - C.ASSIST_FULL_KMH)));
    const lock = Math.min(((1 + C.ASSIST_STEER * steerHelp * blend) * C.MAX_STEER) / (1 + v / C.STEER_FADE),
        Math.atan((C.WHEELBASE * (C.LAT_ASSIST * grip / C.MASS) * C.YAW_ASSIST) / Math.max(v * v, 1)));
    return { steer: Math.max(-1, Math.min(1, wheel / lock)), arc: Math.abs((2 * Math.sin(alpha)) / ld), need: Math.abs(wheel / lock) };
}

// Throttle and brake toward the target speed (m/s), with only the grip the turn leaves (friction circle, as carphysics)
function pedals(p, sc, target, turn, steer) {
    const v = p.speed / sc, grip = C.MU * (p.tyreGrip ?? 1) * (C.MASS * C.G + 0.5 * C.RHO * C.CLA * v * v);
    const spare = grip * Math.sqrt(Math.max(0, 1 - ((v * v * turn * C.MASS) / (C.LAT_ASSIST * grip)) ** 2));
    const throttle = Math.min((target - v) * 2, spare / Math.min(C.POWER / Math.max(v, 1), C.TRACTION * grip));
    const brake = Math.min((v - target) / 2, spare / ((1 - C.BRAKE_STEER_GIVE * Math.abs(steer)) * grip));
    return { throttle: Math.max(0, Math.min(1, throttle)), brake: Math.max(0, Math.min(1, brake)) };
}

module.exports = { pursue, pedals };
