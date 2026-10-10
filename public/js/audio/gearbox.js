// Cosmetic multi-speed seamless gearbox for 2006–2013 F1 V8 sound and the shift-light HUD. Client-side only:
// physics knows speed, not gears. Pure — unit-tested in node, used per car by game3d.js.
export const GEAR_TOP_KMH = [130, 168, 205, 248, 292, 335, 375]; // speed at 18,000 rpm per gear; 7th covers DRS + tow
export const REV_LIMIT = 18000;
export const UPSHIFT = 17800;
export const IDLE = 4500;
export const LAUNCH = 11000;     // holding throttle on the grid / crawling in 1st
export const DOWN_BELOW = 16000; // shift down when the lower gear would sit below this (braking or coasting)
export const SHIFT_GAP_S = 0.12;
const BOG_RPM = 8000;            // on throttle but this low in gear (after a spin, a shunt): kick down
const RPM_RATE = 25;             // 1/s: rpm follows its target this fast (~40 ms)

// Dynamically generate higher gears when max speed is increased (up to 9999 km/h)
export function getGearTops(maxSpeedKmh = 375) {
    const base = [130, 168, 205, 248, 292, 335, 375];
    if (!Number.isFinite(maxSpeedKmh) || maxSpeedKmh <= 375) return base;
    const gears = [...base];
    let top = 375;
    const target = maxSpeedKmh * 1.05;
    while (top < target && gears.length < 60) {
        const step = Math.max(35, top * 0.135);
        top = Math.round(top + step);
        gears.push(top);
    }
    return gears;
}

export class Gearbox {
    constructor(maxSpeedKmh = 375) {
        this.out = { gear: 1, rpm: IDLE, limiter: false, pit: false, reverse: false, events: [] };
        this.maxSpeedKmh = maxSpeedKmh || 375;
        this.gears = getGearTops(this.maxSpeedKmh);
        this.reset();
    }

    setMaxSpeed(maxSpeedKmh) {
        if (!Number.isFinite(maxSpeedKmh) || maxSpeedKmh <= 0) return;
        this.maxSpeedKmh = maxSpeedKmh;
        this.gears = getGearTops(this.maxSpeedKmh);
    }

    reset() {
        this.gear = 1;
        this.rpm = IDLE;
        this.sinceShift = SHIFT_GAP_S;
    }

    update(speedMs, throttle, dt, pitLimiter = false, maxSpeedKmh = null) {
        if (maxSpeedKmh && maxSpeedKmh !== this.maxSpeedKmh) {
            this.setMaxSpeed(maxSpeedKmh);
        }
        const o = this.out;
        o.events.length = 0;
        const v = Number.isFinite(speedMs) ? speedMs : 0, thr = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
        const kmh = Math.abs(v) * 3.6;

        // Auto-extend gears only when max speed configuration exceeds standard 7-speed setup (375 km/h)
        if (this.maxSpeedKmh > 375 && kmh > this.gears[this.gears.length - 1]) {
            this.setMaxSpeed(Math.max(this.maxSpeedKmh, kmh));
        }

        const maxGear = this.gears.length;
        const rpmFor = (g) => (kmh * REV_LIMIT) / this.gears[g - 1];

        this.sinceShift += dt;

        if (pitLimiter) {
            // In pit lane / pit stop: lock smoothly into 1st or 2nd gear without hunting or shift bangs
            if (this.gear > 2) {
                this.gear = 2;
                this.sinceShift = SHIFT_GAP_S;
            }
        } else if (this.sinceShift >= SHIFT_GAP_S) {
            if (thr > 0.3 && this.gear < maxGear && rpmFor(this.gear) >= UPSHIFT) {
                this.gear++; this.sinceShift = 0; o.events.push('up');
            } else if (this.gear > 1 && rpmFor(this.gear - 1) < DOWN_BELOW && (thr <= 0.3 || rpmFor(this.gear) < BOG_RPM)) {
                this.gear--; this.sinceShift = 0; o.events.push('down');
            }
        }

        let target = Math.max(IDLE, Math.min(REV_LIMIT, rpmFor(this.gear)));
        if (this.gear === 1 && thr > 0.3 && !pitLimiter) {
            target = Math.max(target, IDLE + (LAUNCH - IDLE) * thr);
        }

        this.rpm += (target - this.rpm) * Math.min(1, dt * RPM_RATE);
        if (!Number.isFinite(this.rpm)) this.rpm = IDLE;
        o.gear = this.gear;
        o.rpm = Math.min(REV_LIMIT, Math.max(IDLE, this.rpm));
        // Rev limiter only activates on true top gear at maximum revs (never in pit limiter)
        o.limiter = !pitLimiter && thr > 0.3 && rpmFor(this.gear) >= REV_LIMIT - 50 && (this.gear === maxGear || this.sinceShift < SHIFT_GAP_S);
        o.pit = !!pitLimiter;
        o.reverse = v < -0.5;
        return o;
    }
}

// 15 steering-wheel lights: 5 green (13–15k), 5 red (15–16.5k), 5 blue (16.5–17.8k); all flash at the shift point / limiter
const LIGHT_AT = [];
for (let i = 0; i < 5; i++) LIGHT_AT.push(13000 + i * 400);
for (let i = 0; i < 5; i++) LIGHT_AT.push(15000 + i * 300);
for (let i = 0; i < 5; i++) LIGHT_AT.push(16500 + i * 260);
const LIGHTS = { lit: 0, flash: false };

export function shiftLights(rpm, limiter) {
    let lit = 0;
    while (lit < 15 && rpm >= LIGHT_AT[lit]) lit++;
    LIGHTS.lit = lit;
    LIGHTS.flash = !!limiter || rpm >= UPSHIFT;
    return LIGHTS;
}
