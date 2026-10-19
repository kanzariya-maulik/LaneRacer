// F1-style handling model. SI units inside; world units = metres × scale.
// Tuned against test/carPhysics.test.js to real 2023 figures: 0-100 ≈ 2.6 s, vmax ≈ 343 km/h, 5-6 g braking from 300 km/h,
// 2 g slow / 5 g fast cornering, a Monza limit lap near pole; YAW_ASSIST keeps it slide-free on a keyboard.
const C = {
    MASS: 798,             // kg, 2023 minimum incl. driver
    POWER: 750000,         // W (~1000 hp)
    CDA: 1.4,              // drag area, m²
    CLA: 4.0,              // downforce area, m² (a mid-downforce 2023 car: real cars run ~3.5 at Monza to ~5 at Monaco)
    RHO: 1.225,            // air density, kg/m³
    G: 9.81,
    MU: 1.8,               // tyre grip on asphalt: ~2 g in slow corners, 5-5.5 g at 300 km/h with the downforce (real 2023)
    TRACTION: 0.6,         // share of load on the driven (rear) tyres
    WHEELBASE: 3.6,        // m
    MAX_STEER: 0.35,       // rad of wheel angle at standstill
    STEER_FADE: 80,        // m/s: max steer halves by this speed
    LAT_ASSIST: 1.0,       // cornering grip multiplier: 1 = real grip (was 2: twice an F1 car's cornering)
    YAW_ASSIST: 1.25,      // car may rotate this much faster than grip allows → controlled slide
    MAX_SLIP: 0.21,        // rad (~12°): assist switches off beyond this slide angle, so no spins
    BRAKE_STEER_GIVE: 0.45, // steering priority: full lock leaves brakes 55% of grip, straight line 100%
    ROLL_G: 0.015,         // rolling resistance on asphalt, in g
    GRASS_MU: 0.9,
    GRASS_DRAG: 0.25,      // 1/s: grass slows the car by this × speed (stuck-free, unlike a flat drag)
    GRASS_DRIVE_G: 0.3,    // drive force on grass, in g (wheelspin)
    GRAVEL_MU: 0.55,       // gravel trap: little grip, slows hard (2 g from 200 km/h), still crawls out at ~4 m/s
    GRAVEL_DRAG: 0.35,     // 1/s
    GRAVEL_DRIVE_G: 0.15,
    ASSIST_STEER: 0.6,     // steering help: extra lock, full below ASSIST_FULL_KMH, none above ASSIST_OFF_KMH
    ASSIST_FULL_KMH: 150,
    ASSIST_OFF_KMH: 250,
    REVERSE_FORCE: 6000,   // N
    REVERSE_MAX: 20 / 3.6, // m/s
    WALL_KEEP: 0.4,        // share of speed kept after hitting the barrier
};

// Help levels: steering Off/On, braking Off/Low/High (fractions of 1; old slider values snap to the nearest level)
function snapAssist(steer, brake) {
    return { steer: steer >= 0.5 ? 1 : 0, brake: brake < 0.25 ? 0 : brake < 0.75 ? 0.5 : 1 };
}

// Parse an assist value into { steer: 0|1, brake: 0|0.5|1 }.
// Accepts: legacy 'off'/'full' strings, the 'steerPct,brakePct' string, or a pre-parsed object (server-sanitised).
function parseAssist(assist) {
    if (assist && typeof assist === 'object') return assist;
    if (assist === 'off') return { steer: 0, brake: 0 };
    const parts = String(assist).split(',').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) return snapAssist(parts[0] / 100, parts[1] / 100);
    return { steer: 1, brake: 1 }; // 'full', null and anything unknown
}

// ground: the surface's grip (surface.js GRIP: grass, gravel), or null on asphalt
function step(car, input, dt, scale, ground = null, assist = 'off') {
    const mu = ground ? ground.mu : C.MU * (car.tyreGrip ?? 1); // tyres.js: compound and wear
    const { steer: assistSteer, brake: assistBrake } = parseAssist(assist);
    // k is the speed-dependent blend (1 = full assist below ASSIST_FULL_KMH, 0 = none above ASSIST_OFF_KMH)

    let vx = car.vx / scale, vy = car.vy / scale;
    let fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    let vf = vx * fx + vy * fy;
    const v = Math.hypot(vx, vy);
    const roll = C.ROLL_G * C.G + (ground ? ground.drag * v : 0);
    const speedBlend = Math.max(0, Math.min(1, (C.ASSIST_OFF_KMH - v * 3.6) / (C.ASSIST_OFF_KMH - C.ASSIST_FULL_KMH)));
    // k for steer assist, kb for brake assist — each scaled by the player's chosen strength
    const k = assistSteer * speedBlend;
    const downforce = 0.5 * C.RHO * C.CLA * v * v;
    // Road shape (drive.js sets these from the track): a compression presses the car down, a crest makes it go light
    const grade = car.grade || 0, load = Math.max(0, 1 + ((car.vcurv || 0) * v * v) / C.G);
    const grip = mu * (C.MASS * C.G * load + downforce);

    // Longitudinal tyre force: traction/power-limited drive, grip-limited brakes, slow reverse
    let ft = 0;
    if (vf >= -0.5) {
        ft += input.throttle * Math.min(C.POWER / Math.max(vf, 1), C.TRACTION * grip, ground ? ground.driveG * C.G * C.MASS : Infinity);
        if (vf > 0.5) ft -= input.brake * (1 - C.BRAKE_STEER_GIVE * Math.abs(input.steer)) * grip;
        else if (input.brake > 0 && input.throttle === 0) ft -= input.brake * C.REVERSE_FORCE;
    } else if (input.throttle > 0) {
        ft += input.throttle * grip; // throttle while rolling backwards acts as a brake
    } else if (input.brake > 0) {
        ft -= input.brake * C.REVERSE_FORCE;
    }
    ft = Math.max(-grip, Math.min(grip, ft));

    // Friction circle: what braking/drive uses is not available for cornering
    const latAccel = (C.LAT_ASSIST * Math.sqrt(Math.max(0, grip * grip - ft * ft))) / C.MASS; // every car corners on the same grip
    const slip = Math.atan2(Math.abs(-vx * fy + vy * fx), Math.abs(vf));

    // Steering (bicycle model), yaw capped by available grip → understeer when overdriven
    // Speed-sensitive lock: full lock just reaches the (assisted) grip limit, so partial input is
    // proportional instead of a light tap already maxing out the rotation at speed
    const lockForGrip = Math.atan((C.WHEELBASE * latAccel * C.YAW_ASSIST) / Math.max(vf * vf, 1));
    const maxSteer = Math.min(((1 + C.ASSIST_STEER * k) * C.MAX_STEER) / (1 + Math.abs(vf) / C.STEER_FADE), lockForGrip);
    car.steer = input.steer * maxSteer;
    let yaw = (vf / C.WHEELBASE) * Math.tan(car.steer);
    const yawMax = (latAccel / Math.max(Math.abs(vf), 1)) * (slip < C.MAX_SLIP ? C.YAW_ASSIST : 1);
    yaw = Math.max(-yawMax, Math.min(yawMax, yaw));
    // For tyre wear (drive.js): share of the cornering grip in use, and the slide angle
    car.latUse = Math.min(1, Math.abs(yaw * vf) / Math.max(latAccel, 1e-6));
    car.slip = slip;
    car.angle += yaw * dt;

    // Re-project velocity onto the new heading; tyres cancel sideways slide up to their grip
    fx = Math.cos(car.angle); fy = Math.sin(car.angle);
    vf = vx * fx + vy * fy;
    let vl = -vx * fy + vy * fx;
    vl -= Math.sign(vl) * Math.min(Math.abs(vl), latAccel * dt);

    const drag = 0.5 * C.RHO * C.CDA * (car.dragMul ?? 1) * v * v; // dragMul: DRS / slipstream
    const before = vf;
    vf += (ft / C.MASS - (drag / C.MASS + roll) * Math.sign(vf) - C.G * grade) * dt; // gravity along the slope
    if (input.brake > 0 && before > 0 && vf < 0) vf = 0;                                         // brakes stop, don't reverse
    if (input.throttle === 0 && input.brake === 0 && Math.sign(vf) !== Math.sign(before)) vf = 0; // coasting stops at zero
    if (vf < -C.REVERSE_MAX) vf = -C.REVERSE_MAX;

    vx = vf * fx - vl * fy;
    vy = vf * fy + vl * fx;
    car.vx = vx * scale;
    car.vy = vy * scale;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.speed = vf * scale;
}

export { C, step, parseAssist, snapAssist };
