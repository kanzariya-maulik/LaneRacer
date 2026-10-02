// 2006–2013 F1 V8 (2.4 L, flat-plane, 18,000 rpm) synthesised: one combustion pulse per firing (4 per revolution),
// sharper and louder with load, through rpm-tracking exhaust resonances, a soft clip and a DC blocker.
// Pure DSP shared by the AudioWorklet (v8-worklet.js) and the node tests. render() allocates nothing.
export const FIRINGS_PER_REV = 4;
const TAU = 2 * Math.PI;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0
const DRIVE = 1.6, NORM = 0.8 / Math.tanh(DRIVE);

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
        this.rasp = biquad();        // at 3× firing: the top-end scream
        this.lp = 0;                 // exhaust/air top-end roll-off
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
        const sr = this.sr, ff = (rpm / 60) * FIRINGS_PER_REV, dRev = rpm / 60 / sr;
        const whole = Math.floor(this.crank); this.crank -= whole; this.fire -= whole * FIRINGS_PER_REV;
        bandpass(this.body, ff, 1.2, sr);
        bandpass(this.rasp, ff * 3, 2.5, sr);
        const decay = Math.exp(-ff / (sr * 0.3));                  // a pulse rings ~0.3 of a firing period
        const amp = 0.25 + 0.75 * load, noisy = 0.15 + 0.35 * (1 - load);
        const dSt = stutter / sr, popChance = (crackle * 9) / sr;  // ~9 pops/s at full crackle
        const popDecay = Math.exp(-1 / (sr * 0.004)), lpK = 1 - Math.exp((-TAU * 7000) / sr);
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
            const x = this.env * (1 - noisy + noisy * (2 * this.rand() - 1)) + this.pop * (2 * this.rand() - 1);
            this.env *= decay;
            this.pop *= popDecay;
            const y = 0.55 * x + 0.9 * step(this.body, x) + 0.35 * step(this.rasp, x);
            this.lp += (y - this.lp) * lpK;
            const hp = this.lp - this.hpX + 0.995 * this.hpY;
            this.hpX = this.lp; this.hpY = hp;
            out[i] = Math.tanh(DRIVE * hp) * NORM;
        }
    }
}
