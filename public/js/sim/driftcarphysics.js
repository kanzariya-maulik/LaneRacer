// Formula-D & Hybrid Sports / NASCAR Drift Handling Model.
// Pacejka non-linear friction, dynamic weight transfer, steering angle lock, and handbrake initiation.
// Shared between server (authoritative sim) and browser (client-side prediction).

const PROFILES = {
    tuner: {
        name: 'Formula-D Drift Tuner',
        MASS: 1200,             // kg
        POWER: 746000,          // W (~1000 hp)
        CDA: 1.25,              // drag area, m²
        CLA: 1.4,               // downforce area, m²
        WHEELBASE: 2.65,        // m
        MAX_STEER: 1.05,        // ~60° max steering lock
        STEER_FADE: 120,        // m/s
        PEAK_SLIP: 0.15,        // ~8.6° peak slip angle
        PEAK_MU: 1.55,          // peak asphalt grip
        SLIDE_MU: 0.92,         // sliding friction after peak slip
        TRACTION: 0.65,         // rear load share
        HANDBRAKE_REAR_MU: 0.25,// e-brake grip drop
        DRAFT_MULT: 1.0,
        CG_HEIGHT: 0.38,        // centre of gravity height, m
        TRACK_WIDTH: 1.80,      // m
    },
    nascar: {
        name: 'V8 Muscle Stock Car',
        MASS: 1550,             // kg (heavy inertia)
        POWER: 560000,          // W (~750 hp V8)
        CDA: 1.55,              // drag area
        CLA: 0.9,               // lower downforce
        WHEELBASE: 2.80,        // m
        MAX_STEER: 0.66,        // ~38° steering lock
        STEER_FADE: 95,         // m/s
        PEAK_SLIP: 0.13,        // ~7.5° peak slip
        PEAK_MU: 1.38,          // asphalt grip
        SLIDE_MU: 0.82,         // sliding friction
        TRACTION: 0.58,
        HANDBRAKE_REAR_MU: 0.30,
        DRAFT_MULT: 2.5,        // 2.5x Massive Slingshot drafting boost!
        CG_HEIGHT: 0.45,
        TRACK_WIDTH: 1.90,
    },
    gt3: {
        name: 'GT3 Sports Supercar',
        MASS: 1350,             // kg
        POWER: 462000,          // W (~620 hp twin-turbo)
        CDA: 1.30,              // drag area
        CLA: 2.6,               // high aerodynamic downforce
        WHEELBASE: 2.70,        // m
        MAX_STEER: 0.73,        // ~42° steering lock
        STEER_FADE: 105,        // m/s
        PEAK_SLIP: 0.14,        // ~8.0° peak slip
        PEAK_MU: 1.58,
        SLIDE_MU: 0.96,
        TRACTION: 0.62,
        HANDBRAKE_REAR_MU: 0.28,
        DRAFT_MULT: 1.2,
        CG_HEIGHT: 0.35,
        TRACK_WIDTH: 1.95,
    }
};

const COMMON = {
    RHO: 1.225,            // air density, kg/m³
    G: 9.81,
    ROLL_G: 0.018,         // rolling resistance in g
    GRASS_MU: 0.65,
    GRASS_DRAG: 0.35,
    GRASS_DRIVE_G: 0.25,
    REVERSE_FORCE: 7000,   // N
    REVERSE_MAX: 22 / 3.6, // m/s (~22 km/h)
    WALL_KEEP: 0.45,
    COUNTER_STEER_ASSIST: 0.85, // assist strength for casual steering
};

// Default profile is 'tuner'
const C = { ...PROFILES.tuner, ...COMMON };

function parseSteerAssist(assist) {
    if (typeof assist === 'object' && assist !== null) {
        return Number.isFinite(assist.steer) ? Math.min(100, Math.max(0, assist.steer)) / 100 : 1.0;
    }
    if (typeof assist === 'string') {
        const m = assist.match(/^(\d+),(\d+)$/);
        if (m) return Math.min(100, Math.max(0, parseInt(m[1], 10))) / 100;
        const lower = assist.trim().toLowerCase();
        if (lower === 'off' || lower === 'brake') return 0;
        if (lower === 'low') return 0.33;
        if (lower === 'medium') return 0.66;
        if (lower === 'full' || lower === 'high' || lower === 'steer' || lower === 'steering') return 1.0;
    }
    return 1.0;
}

// Pacejka-inspired Lateral Grip Evaluation:
// Ramps to peak grip at peakSlip, then smoothly transitions to sustained slide friction.
function pacejkaLateralMu(slipAngleRad, peakSlip, peakMu, slideMu) {
    const alpha = Math.abs(slipAngleRad);
    if (alpha <= 1e-6) return 0;
    const x = alpha / peakSlip;
    if (x <= 1.0) {
        // Smooth sine ramp to peak
        return peakMu * Math.sin(x * (Math.PI / 2));
    }
    // Smooth transition from peakMu down to slideMu asymptotically
    const drop = (peakMu - slideMu) * Math.exp(-(x - 1.0) * 1.5);
    return slideMu + drop;
}

function step(car, input, dt, scale, offTrack = false, assist = 'off', profileKey = 'tuner') {
    const p = PROFILES[profileKey] || PROFILES.tuner;
    const cfg = { ...p, ...COMMON };

    let vx = car.vx / scale, vy = car.vy / scale;
    let fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    let vf = vx * fx + vy * fy;
    let vl = -vx * fy + vy * fx;
    const v = Math.hypot(vx, vy);

    const isHandbrake = !!input.handbrake;
    const assistLevel = parseSteerAssist(assist);

    // Aerodynamic downforce
    const downforce = 0.5 * cfg.RHO * cfg.CLA * v * v;
    const totalNormalForce = cfg.MASS * cfg.G + downforce;

    // Dynamic longitudinal & lateral weight transfer
    const ax = car.prevAx || 0;
    const ay = car.prevAy || 0;
    const dFzLong = (cfg.MASS * ax * cfg.CG_HEIGHT) / cfg.WHEELBASE;
    const dFzLat = (cfg.MASS * ay * cfg.CG_HEIGHT) / cfg.TRACK_WIDTH;

    // Normal load on front vs rear axles
    const fzRearBase = totalNormalForce * cfg.TRACTION;
    const fzFrontBase = totalNormalForce * (1 - cfg.TRACTION);
    const fzRear = Math.max(totalNormalForce * 0.15, fzRearBase - dFzLong);
    const fzFront = Math.max(totalNormalForce * 0.15, fzFrontBase + dFzLong);

    // Effective friction coefficients
    let baseMu = offTrack ? cfg.GRASS_MU : cfg.PEAK_MU;
    let slideMu = offTrack ? cfg.GRASS_MU * 0.8 : cfg.SLIDE_MU;

    if (isHandbrake) {
        // Handbrake instantly reduces rear tire friction to allow immediate yaw break
        slideMu = Math.min(slideMu, cfg.HANDBRAKE_REAR_MU);
        baseMu = Math.min(baseMu, cfg.HANDBRAKE_REAR_MU * 1.2);
    }

    // Slip angle calculation (angle between heading and velocity vector)
    const currentSlipAngle = Math.atan2(Math.abs(vl), Math.max(Math.abs(vf), 0.5));
    car.driftAngle = currentSlipAngle * (180 / Math.PI); // in degrees
    car.isDrifting = car.driftAngle >= 15 && v > 6.0;

    // Longitudinal forces: Throttle & Brake
    let ft = 0;
    const allowReverse = input.explicitReverse !== false;
    const maxTractionForce = cfg.TRACTION * baseMu * fzRear;

    if (vf >= -0.5) {
        const engineDriveForce = cfg.POWER / Math.max(vf, 2.5);
        // Power-oversteer: If throttle > 0.8 and car is sliding, allow high rear wheel power
        ft += input.throttle * Math.min(engineDriveForce, maxTractionForce * (car.isDrifting ? 1.3 : 1.0));
        
        if (vf > 0.5) {
            const brakeGrip = baseMu * (fzFront + fzRear);
            ft -= input.brake * brakeGrip * 0.85;
        } else if (input.brake > 0 && input.throttle === 0 && allowReverse) {
            ft -= input.brake * cfg.REVERSE_FORCE;
        }
    } else if (input.throttle > 0) {
        ft += input.throttle * baseMu * totalNormalForce;
    } else if (input.brake > 0 && allowReverse) {
        ft -= input.brake * cfg.REVERSE_FORCE;
    }

    if (isHandbrake) {
        // Handbrake applies strong rear braking drag
        ft -= Math.sign(vf) * (cfg.HANDBRAKE_REAR_MU * fzRear);
    }

    ft = Math.max(-totalNormalForce * baseMu, Math.min(totalNormalForce * baseMu, ft));

    // Non-linear Lateral Force via Pacejka envelope
    const maxLatGrip = baseMu * totalNormalForce;
    const maxLatFrictionCircle = Math.sqrt(Math.max(0, maxLatGrip * maxLatGrip - (ft * 0.5) * (ft * 0.5)));
    const maxLatAccel = maxLatFrictionCircle / cfg.MASS;

    const latMu = pacejkaLateralMu(currentSlipAngle, cfg.PEAK_SLIP, baseMu, slideMu);
    const actualLatGrip = latMu * totalNormalForce;
    const actualLatAccel = actualLatGrip / cfg.MASS;

    // Steering & Counter-steer dynamics:
    // When sliding, the front wheels naturally experience a self-aligning torque toward the velocity vector
    let rawSteerInput = input.steer;
    if (assistLevel > 0 && Math.abs(vl) > 1.0 && Math.abs(vf) > 3.0) {
        const velHeading = Math.atan2(vy, vx);
        let counterAngle = velHeading - car.angle;
        while (counterAngle > Math.PI) counterAngle -= Math.PI * 2;
        while (counterAngle < -Math.PI) counterAngle += Math.PI * 2;
        
        // Counter-steer assist blends player input with self-aligning vector
        const assistAmount = Math.min(1.0, Math.abs(counterAngle) / 0.5) * assistLevel * cfg.COUNTER_STEER_ASSIST;
        const targetSteer = Math.max(-1, Math.min(1, counterAngle / cfg.MAX_STEER));
        rawSteerInput = rawSteerInput * (1 - assistAmount * 0.5) + targetSteer * (assistAmount * 0.5);
    }

    const steerSpeedFactor = 1 / (1 + Math.abs(vf) / cfg.STEER_FADE);
    const maxSteer = cfg.MAX_STEER * steerSpeedFactor;
    car.steer = Math.max(-maxSteer, Math.min(maxSteer, rawSteerInput * maxSteer));

    // Yaw calculation (Bicycle model with drift yaw agility)
    let yaw = (vf / cfg.WHEELBASE) * Math.tan(car.steer);
    
    // Power oversteer & handbrake yaw kick
    if (isHandbrake && Math.abs(vf) > 4.0) {
        // Handbrake induces aggressive rotation in the direction of steering or slide
        const kickDir = Math.sign(car.steer) || Math.sign(vl) || 1;
        yaw += kickDir * 2.2 * (1 - Math.min(1, Math.abs(vl) / 10));
    } else if (input.throttle > 0.7 && car.isDrifting) {
        // Feathering throttle in a drift maintains yaw rotation
        yaw += Math.sign(vl) * 0.4 * input.throttle;
    }

    const maxAllowedYaw = (maxLatAccel / Math.max(Math.abs(vf), 1)) * 2.2;
    yaw = Math.max(-maxAllowedYaw, Math.min(maxAllowedYaw, yaw));
    car.angle += yaw * dt;

    // Re-project velocity vector on new car orientation
    fx = Math.cos(car.angle); fy = Math.sin(car.angle);
    vf = vx * fx + vy * fy;
    vl = -vx * fy + vy * fx;

    // Sideways tire scrub / damping based on Pacejka lateral force
    const scrub = actualLatAccel * dt;
    vl -= Math.sign(vl) * Math.min(Math.abs(vl), scrub);

    // Longitudinal drag & rolling resistance
    const draftMultiplier = car.dragMul !== undefined ? car.dragMul : 1.0;
    const dragForce = 0.5 * cfg.RHO * cfg.CDA * draftMultiplier * v * v;
    const rollForce = cfg.ROLL_G * cfg.G * cfg.MASS + (offTrack ? cfg.GRASS_DRAG * v * cfg.MASS : 0);

    const beforeVf = vf;
    vf += (ft / cfg.MASS - (dragForce / cfg.MASS + rollForce / cfg.MASS) * Math.sign(vf)) * dt;

    if (input.brake > 0 && (vf <= 0 || (beforeVf > 0 && vf < 0)) && !allowReverse) vf = 0;
    if (input.brake > 0 && beforeVf > 0 && vf < 0) vf = 0;
    if (input.throttle === 0 && input.brake === 0 && !isHandbrake && Math.sign(vf) !== Math.sign(beforeVf)) vf = 0;
    if (vf < -cfg.REVERSE_MAX) vf = -cfg.REVERSE_MAX;

    // Update car velocities
    vx = vf * fx - vl * fy;
    vy = vf * fy + vl * fx;
    car.vx = vx * scale;
    car.vy = vy * scale;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.speed = vf * scale;

    // Store accelerations for next tick weight transfer
    car.prevAx = (vf - beforeVf) / dt;
    car.prevAy = actualLatAccel * Math.sign(vl);
    car.driftSpeed = Math.abs(car.speed / scale) * 3.6; // in km/h
}

export { C, PROFILES, COMMON, parseSteerAssist, pacejkaLateralMu, step };
