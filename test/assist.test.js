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

test('safe speed: a corner over a crest is slower (the car goes light), a compression is not counted on', () => {
    const arc = Array.from({ length: 40 }, (_, i) => ({ x: Math.cos(i / 10) * 80 * 6, y: Math.sin(i / 10) * 80 * 6 })); // R 80 m
    const flat = Assist.safeSpeeds(arc, 6)[20];
    const crest = Assist.safeSpeeds(arc, 6, arc.map(() => -0.002))[20];
    assert.ok(crest < flat * 0.95, `${(crest * 3.6).toFixed(0)} vs ${(flat * 3.6).toFixed(0)} km/h`);
    assert.strictEqual(Assist.safeSpeeds(arc, 6, arc.map(() => 0.002))[20], flat);
});

const Physics = require('../src/game/Physics');
const CarPhysics = require('../src/game/CarPhysics');

// Flat out from 200 m down Monza's straight toward the first chicane, steering along the centreline (simple pursuit)
function runToChicane(useAssist) {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 300 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    let apex = 0, min = Infinity;
    for (let i = 0; i < monza.path.length; i++) {
        const m = monza.cum[i] / monza.scale;
        if (m > 800 && m < 1300 && monza.lineLimit[i] < min) { min = monza.lineLimit[i]; apex = monza.cum[i]; }
    }
    const FULL = { throttle: 1, brake: 0, steer: 0 };
    for (let k = 0; k < 60 * 20; k++) {
        const near = Physics.nearestOnTrack(car.x, car.y, monza);
        if (monza.cum[near.i] >= apex) return { speed: car.speed / monza.scale, safe: min };
        const aim = monza.path[(near.i + 3) % monza.path.length];
        let d = Math.atan2(aim.y - car.y, aim.x - car.x) - car.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const drive = { ...FULL, steer: Math.max(-1, Math.min(1, d * 3)) };
        const input = useAssist ? Assist.brakeAssist(car, drive, monza, near, 1) : drive;
        CarPhysics.step(car, input, 1 / 60, monza.scale, false, useAssist ? '100,100' : '0,0');
    }
    throw new Error('never reached the chicane');
}

test(`braking help High: flat out from 300 km/h, the car is at or below ${Assist.HIGH.aim * 100} % of the chicane's corner speed`, () => {
    const { speed, safe } = runToChicane(true);
    assert.ok(speed <= safe * Assist.HIGH.aim * 1.02, `${(speed * 3.6).toFixed(0)} km/h vs safe ${(safe * 3.6).toFixed(0)}`);
    const off = runToChicane(false);
    assert.ok(off.speed > off.safe * 1.5, 'without the assist the car should arrive far too fast');
});

test('braking help leaves the driver alone on a straight and never weakens braking', () => {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 150 / 3.6 * monza.scale;
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    const near = Physics.nearestOnTrack(car.x, car.y, monza);
    const input = { throttle: 1, brake: 0, steer: 0.2 };
    assert.strictEqual(Assist.brakeAssist(car, input, monza, near, 1), input);
    const braking = { throttle: 0, brake: 1, steer: 0 };
    assert.strictEqual(Assist.brakeAssist(car, braking, monza, near, 1).brake, 1);
});

test('braking help: Off never brakes; Low brakes later than High', () => {
    const s0 = monza.cum.findIndex(c => c >= 750 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const at = (kmh) => { const v = kmh / 3.6 * monza.scale; return { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 }; };
    const near = Physics.nearestOnTrack(p.x, p.y, monza), FULL = { throttle: 1, brake: 0, steer: 0 };
    const brakes = (kmh, level) => Assist.brakeAssist(at(kmh), FULL, monza, near, level).brake === 1;
    let high = null, low = null; // lowest speed at which each level brakes here, 150 m before the chicane
    for (let kmh = 120; kmh <= 360; kmh += 5) { if (high === null && brakes(kmh, 1)) high = kmh; if (low === null && brakes(kmh, 0.5)) low = kmh; }
    for (let kmh = 120; kmh <= 360; kmh += 5) assert.strictEqual(brakes(kmh, 0), false, `Off braked at ${kmh} km/h`);
    assert.ok(high !== null && low !== null && low > high, `High from ${high} km/h, Low from ${low} km/h`);
});

test('braking help: no braking on a straight even above 95 % of the speed cap (DRS + tow)', () => {
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const v = 99 * monza.scale; // 356 km/h
    const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
    const near = Physics.nearestOnTrack(p.x, p.y, monza), FULL = { throttle: 1, brake: 0, steer: 0 };
    // Every point a straight (limit = the cap): no level may brake, however fast the car goes
    for (const level of [0.5, 1]) {
        const out = Assist.brakeAssist({ ...car }, FULL, { ...monza, lineLimit: monza.lineLimit.map(() => Assist.MAX_SAFE) }, near, level);
        assert.strictEqual(out, FULL, `level ${level} braked on a straight`);
    }
});

test('braking help cuts the throttle in a corner the car is over the target for, keeping brake and steering; Off never does', () => {
    const t = { ...monza, lineLimit: monza.lineLimit.map(() => 30) }; // every point a 108 km/h corner
    const s0 = monza.cum.findIndex(c => c >= 200 * monza.scale);
    const p = Track.pointAt(monza.path, monza.cum, monza.cum[s0]);
    const near = Physics.nearestOnTrack(p.x, p.y, t), input = { throttle: 1, brake: 0.3, steer: 0.4 };
    const car = (ms) => ({ x: p.x, y: p.y, angle: p.angle, speed: ms * monza.scale });
    for (const level of [0.5, 1]) {
        // Just over the target (aim × 30 m/s) with the corner here: lift, no extra braking
        const out = Assist.brakeAssist(car(30 * (level >= 1 ? Assist.HIGH.aim : Assist.LOW.aim) + 0.3), input, t, near, level);
        assert.deepStrictEqual(out, { throttle: 0, brake: 0.3, steer: 0.4 }, `level ${level}`);
        // Under the target: the driver's input untouched
        assert.strictEqual(Assist.brakeAssist(car(20), input, t, near, level), input, `level ${level} under target`);
    }
    assert.strictEqual(Assist.brakeAssist(car(40), input, t, near, 0), input, 'Off changed the input');
});

test('braking help Low lifts only shortly before it brakes (Monza first chicane at 330 km/h)', () => {
    let apex = 0, min = Infinity;
    for (let i = 0; i < monza.path.length; i++) {
        const m = monza.cum[i] / monza.scale;
        if (m > 800 && m < 1300 && monza.lineLimit[i] < min) { min = monza.lineLimit[i]; apex = m; }
    }
    let lift = null, brake = null;
    for (let m = 300; m < apex && brake === null; m++) {
        const p = Track.pointAt(monza.path, monza.cum, m * monza.scale), v = 330 / 3.6 * monza.scale;
        const car = { x: p.x, y: p.y, angle: p.angle, vx: Math.cos(p.angle) * v, vy: Math.sin(p.angle) * v, speed: v, steer: 0 };
        const out = Assist.brakeAssist(car, { throttle: 1, brake: 0, steer: 0 }, monza, Physics.nearestOnTrack(p.x, p.y, monza), 0.5);
        if (lift === null && out.throttle === 0) lift = m;
        if (out.brake === 1) brake = m;
    }
    assert.ok(brake !== null && lift !== null && brake - lift <= 92, `lifts ${brake - lift} m (${((brake - lift) / (330 / 3.6)).toFixed(2)} s) before braking`);
});
