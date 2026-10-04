// Formula-D & Hybrid Sports / NASCAR Drift Handling Model.
// Pacejka non-linear friction, dynamic weight transfer, steering angle lock, and handbrake initiation.
// Shared between server (authoritative sim) and browser (client-side prediction).

// Unified, equal-spec high-performance Formula-D Sports Sprint car model
// All players in this mode race with identical, high-octane performance specs
const FORMULA_D_SPEC = {
    name: 'Formula-D Sports Sprint',
    MASS: 1250,             // kg
    POWER: 650000,          // W (~875 hp twin-turbo high-power engine)
    CDA: 1.25,              // drag area, m²
    CLA: 1.5,               // aerodynamic downforce
    WHEELBASE: 2.65,        // m
    MAX_STEER: 0.85,        // ~49° steering lock for razor-sharp agile turning
    STEER_FADE: 115,        // m/s
    PEAK_SLIP: 0.16,        // ~9.2° peak slip angle
    PEAK_MU: 1.75,          // high baseline asphalt grip for crisp, responsive turns
    SLIDE_MU: 1.35,         // strong, predictable sliding grip
    TRACTION: 0.60,         // balanced 40/60 weight distribution
    HANDBRAKE_REAR_MU: 0.35,// e-brake grip drop for sharp hairpins
    DRAFT_MULT: 1.25,       // slipstream drafting boost
    CG_HEIGHT: 0.36,        // centre of gravity height, m
    TRACK_WIDTH: 1.85,      // m
};

const PROFILES = {
    tuner: FORMULA_D_SPEC,
    nascar: FORMULA_D_SPEC,
    gt3: FORMULA_D_SPEC,
    sprint: FORMULA_D_SPEC,
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

    // Steering & Counter-steer dynamics:
    // Front wheels naturally experience self-aligning torque toward the velocity vector when sliding
    let rawSteerInput = input.steer;
    const velHeading = Math.atan2(vy, vx);
    let counterAngle = velHeading - car.angle;
    while (counterAngle > Math.PI) counterAngle -= Math.PI * 2;
    while (counterAngle < -Math.PI) counterAngle += Math.PI * 2;

    if (assistLevel > 0 && Math.abs(vl) > 1.2 && Math.abs(vf) > 3.0) {
        const targetSteer = Math.max(-1, Math.min(1, counterAngle / cfg.MAX_STEER));
        if (Math.abs(input.steer) < 0.2) {
            // Player is coasting/holding drift: auto self-align to catch and stabilize the drift angle
            rawSteerInput = targetSteer * assistLevel * cfg.COUNTER_STEER_ASSIST;
        } else if (Math.sign(input.steer) === Math.sign(targetSteer)) {
            // Player is actively counter-steering: provide 100% full steering lock authority
            rawSteerInput = input.steer;
        } else {
            // Player is fighting the slide (initiating deeper angle): blend with player control
            rawSteerInput = input.steer * 0.7 + targetSteer * 0.3 * (1 - assistLevel * 0.5);
        }
    }

    const steerSpeedFactor = 1 / (1 + Math.abs(vf) / cfg.STEER_FADE);
    const maxSteer = cfg.MAX_STEER * steerSpeedFactor;
    car.steer = Math.max(-maxSteer, Math.min(maxSteer, rawSteerInput * maxSteer));

    // Yaw calculation (Bicycle model with dynamic drift yaw control)
    let yaw = (vf / cfg.WHEELBASE) * Math.tan(car.steer);
    
    // Handbrake flick & power oversteer initiation
    if (isHandbrake && Math.abs(vf) > 4.0) {
        // Handbrake induces aggressive rotation in the direction of steering or slide
        const kickDir = Math.sign(car.steer) || (Math.sign(vl) !== 0 ? -Math.sign(vl) : 1);
        yaw += kickDir * 2.4 * (1 - Math.min(1, Math.abs(vl) / 12));
    } else if (input.throttle > 0.7 && car.isDrifting) {
        // High throttle in drift allows controlled yaw rotation
        yaw += (Math.sign(vl) !== 0 ? -Math.sign(vl) : 1) * 0.35 * input.throttle;
    }

    const maxAllowedYaw = (maxLatAccel / Math.max(Math.abs(vf), 1)) * 2.5;
    yaw = Math.max(-maxAllowedYaw, Math.min(maxAllowedYaw, yaw));
    car.angle += yaw * dt;

    // Re-project velocity vector on new car orientation
    fx = Math.cos(car.angle); fy = Math.sin(car.angle);
    vf = vx * fx + vy * fy;
    vl = -vx * fy + vy * fx;

    // Dynamic Lateral Force and Grip Recovery:
    // - Full throttle allows sustained high-angle power sliding
    // - Lifting/easing throttle (input.throttle < 0.5) triggers rapid tire bite & grip recovery
    // - Counter-steering pulls the front of the car toward the inside of the turn to keep it on track
    const isCounterSteering = (vl < 0 && car.steer < 0) || (vl > 0 && car.steer > 0);
    const counterPullGrip = isCounterSteering ? Math.abs(car.steer) * 1.8 * baseMu : 0;
    const gripRecoveryGrip = (1 - input.throttle) * (car.isDrifting ? 1.6 : 0.6) * baseMu;
    const throttleSlideMod = car.isDrifting ? (0.65 + 0.35 * input.throttle) : 1.0;

    const latMu = pacejkaLateralMu(currentSlipAngle, cfg.PEAK_SLIP, baseMu, slideMu);
    const effectiveLatGrip = (latMu * throttleSlideMod + gripRecoveryGrip + counterPullGrip) * totalNormalForce;
    const effectiveLatAccel = effectiveLatGrip / cfg.MASS;

    // Sideways tire scrub / damping
    const scrub = effectiveLatAccel * dt;
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
    car.prevAy = effectiveLatAccel * Math.sign(vl);
    car.driftSpeed = Math.abs(car.speed / scale) * 3.6; // in km/h
}

export { C, PROFILES, COMMON, parseSteerAssist, pacejkaLateralMu, step };
