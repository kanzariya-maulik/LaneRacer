// 2006–2013 F1 V8 (2.4 L, flat-plane, 18,000 rpm) synthesised: one sharp combustion pulse per firing (4 per revolution),
// louder with load, through rpm-tracking resonances at the firing frequency and its 2nd-4th harmonics (the scream),
// plus intake/mechanical hiss pulsed by the firings, a soft clip and a DC blocker.
// Pure DSP shared by the AudioWorklet (v8-worklet.js) and the node tests. render() allocates nothing.
export const FIRINGS_PER_REV = 4;
export const PITCH = 1.12;  // sound only, ~2 semitones above the true firing frequency: brighter scream (rpm, gears, HUD unchanged)
const TAU = 2 * Math.PI;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0
const DRIVE = 1.6, NORM = 0.8 / Math.tanh(DRIVE);
const PULSE = 0.09;      // a combustion pulse rings this share of a firing period: short = rich harmonics
const MIX = { direct: 0.3, body: 0.6, h2: 0.5, h3: 0.55, h4: 0.9, hiss: 0.65 }; // tone balance (tested: centroid ~3 kHz at full revs)
const HISS_HZ = 6000, TOP_HZ = 12000;

function biquad() { return { b0: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }; }
function bandpass(c, f, q, sr) { // RBJ band-pass, 0 dB peak gain
    const w = (TAU * Math.min(f, sr * 0.45)) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    c.b0 = al / a0; c.b2 = -al / a0; c.a1 = (-2 * Math.cos(w)) / a0; c.a2 = (1 - al) / a0;
}
function step(c, x) {
    const y = c.b0 * x + c.b2 * c.x2 - c.a1 * c.y1 - c.a2 * c.y2;
    c.x2 = c.x1; c.x1 = x; c.y2 = c.y1; c.y1 = y;
    return y;
}

export class V8Synth {
    constructor(sampleRate, seed = 1) {
        this.sr = sampleRate;
        this.crank = 0;              // revolutions since start (wrapped each block)
        this.fire = 0;               // firings so far = floor(crank × 4)
        this.env = 0;                // current combustion pulse envelope
        this.pop = 0;                // overrun crackle pop envelope
        this.stutterPhase = 0;       // limiter on/off cycle 0..1
        this.seed = (seed >>> 0) || 1;
        this.body = biquad();        // resonance at the firing frequency
        this.h2 = biquad();          // 2nd harmonic: the wail
        this.h3 = biquad();          // 3rd harmonic: the rasp
        this.h4 = biquad();          // 4th harmonic: the scream on top
        this.hiss = biquad();        // intake/mechanical air, fixed band
        bandpass(this.hiss, Math.min(HISS_HZ, sampleRate * 0.4), 0.8, sampleRate);
        this.lp = 0;                 // top-end roll-off
        this.hpX = 0; this.hpY = 0;  // DC blocker
    }

    rand() { // xorshift32 → [0, 1)
        let x = this.seed;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        this.seed = x >>> 0;
        return this.seed / 4294967296;
    }

    render(out, n, p) {
        const rpm = Math.min(20000, Math.max(500, Number.isFinite(p.rpm) ? p.rpm : 500));
        const load = clamp01(p.load), cut = clamp01(p.cut), crackle = clamp01(p.crackle);
        const stutter = Number.isFinite(p.stutter) && p.stutter > 0 ? p.stutter : 0;
        const sr = this.sr, ff = (rpm / 60) * FIRINGS_PER_REV * PITCH, dRev = (rpm / 60 / sr) * PITCH;
        const whole = Math.floor(this.crank); this.crank -= whole; this.fire -= whole * FIRINGS_PER_REV;
        bandpass(this.body, ff, 1.5, sr);
        bandpass(this.h2, ff * 2, 3, sr);
        bandpass(this.h3, ff * 3, 3, sr);
        bandpass(this.h4, ff * 4, 3, sr);
        const decay = Math.exp(-ff / (sr * PULSE));
        const amp = 0.25 + 0.75 * load, noisy = 0.1 + 0.3 * (1 - load);
        const rev = rpm / 18000, hissAmt = MIX.hiss * (0.3 + 0.7 * load) * rev * rev; // air grows with revs and throttle
        const dSt = stutter / sr, popChance = (crackle * 9) / sr;  // ~9 pops/s at full crackle
        const popDecay = Math.exp(-1 / (sr * 0.004)), lpK = 1 - Math.exp((-TAU * Math.min(TOP_HZ, sr * 0.45)) / sr);
        for (let i = 0; i < n; i++) {
            this.crank += dRev;
            const f = Math.floor(this.crank * FIRINGS_PER_REV);
            if (f !== this.fire) {                                  // a cylinder fires
                this.fire = f;
                const lit = stutter > 0 && this.stutterPhase < 0.5 ? 0 : 1 - cut;
                const bank = f & 1 ? 0.92 : 1;                      // the two banks differ slightly: a touch of half-order
                this.env = Math.max(this.env, amp * bank * (0.9 + 0.2 * this.rand()) * (0.05 + 0.95 * lit));
            }
            if (stutter > 0) { this.stutterPhase += dSt; if (this.stutterPhase >= 1) this.stutterPhase -= 1; }
            if (popChance > 0 && this.rand() < popChance) this.pop = 0.6 + 0.4 * this.rand();
            const r = 2 * this.rand() - 1;
            const x = this.env * (1 - noisy + noisy * r) + this.pop * r;
            const air = step(this.hiss, r) * this.env * hissAmt;     // pulsed with the firings, so it beats with the engine
            this.env *= decay;
            this.pop *= popDecay;
            const y = MIX.direct * x + MIX.body * step(this.body, x) + MIX.h2 * step(this.h2, x) + MIX.h3 * step(this.h3, x) + MIX.h4 * step(this.h4, x) + air;
            this.lp += (y - this.lp) * lpK;
            const hp = this.lp - this.hpX + 0.995 * this.hpY;
            this.hpX = this.lp; this.hpY = hp;
            out[i] = Math.tanh(DRIVE * hp) * NORM;
        }
    }
}
