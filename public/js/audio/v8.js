// Advanced Multi-Engine Audio Synthesizer (V6 Turbo, 7.0L Muscle V8, F1 Classic Screamer, 4-Rotor Rotary, Flat-6 GT3 Boxer).
// Synthesizes rich, deep, distinct internal combustion physics in real time with zero allocations.
// Pure DSP shared by AudioWorklet (v8-worklet.js) and unit tests.

export const FIRINGS_PER_REV = 4;
const TAU = 2 * Math.PI;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0

export const ENGINE_PROFILES = {
    v6: {
        id: 'v6',
        name: 'F1 1.6L V6 Turbo (Modern Growl & Turbo)',
        firings: 3,
        bodyQ: 1.1,
        raspMult: 2.0,
        raspQ: 2.2,
        subBass: 0.45,      // deep low-end rumble
        turboWhistle: 0.28,  // high-frequency turbo spool
        lpFreq: 5400,
        drive: 2.2,
        toneWeight: 0.75,
        decayRate: 3.6,
        isRotary: false
    },
    muscle: {
        id: 'muscle',
        name: '7.0L V8 Muscle (Deep Bass Rumble)',
        firings: 4,
        bodyQ: 0.9,
        raspMult: 1.8,
        raspQ: 1.8,
        subBass: 0.55,      // massive sub-woofer thump
        turboWhistle: 0.0,
        lpFreq: 4400,
        drive: 2.4,
        toneWeight: 0.75,
        decayRate: 3.2,
        isRotary: false
    },
    screamer: {
        id: 'screamer',
        name: 'F1 Classic Screamer (High-RPM Howl)',
        firings: 5,
        bodyQ: 1.8,
        raspMult: 2.5,
        raspQ: 3.2,
        subBass: 0.15,
        turboWhistle: 0.0,
        lpFreq: 9500,
        drive: 1.8,
        toneWeight: 0.80,
        decayRate: 4.8,
        isRotary: false
    },
    rotary: {
        id: 'rotary',
        name: '2.6L 4-Rotor Wankel (787B Shriek)',
        firings: 6,
        bodyQ: 2.2,
        raspMult: 3.2,
        raspQ: 3.8,
        subBass: 0.10,
        turboWhistle: 0.0,
        lpFreq: 11000,
        drive: 2.0,
        toneWeight: 0.85,
        decayRate: 5.8,
        isRotary: true
    },
    boxer: {
        id: 'boxer',
        name: '4.0L Flat-6 GT3 (Throaty Boxer Rasp)',
        firings: 3,
        bodyQ: 1.4,
        raspMult: 2.3,
        raspQ: 2.6,
        subBass: 0.35,
        turboWhistle: 0.10,
        lpFreq: 6800,
        drive: 2.0,
        toneWeight: 0.78,
        decayRate: 4.0,
        isRotary: false
    },
    // Backwards compatibility aliases
    v10: {
        id: 'screamer',
        name: 'F1 Classic Screamer (High-RPM Howl)',
        firings: 5,
        bodyQ: 1.8,
        raspMult: 2.5,
        raspQ: 3.2,
        subBass: 0.15,
        turboWhistle: 0.0,
        lpFreq: 9500,
        drive: 1.8,
        toneWeight: 0.80,
        decayRate: 4.8,
        isRotary: false
    },
    v8: {
        id: 'v8',
        name: 'F1 2.4L V8 (Classic High-RPM)',
        firings: 4,
        bodyQ: 1.3,
        raspMult: 3.0,
        raspQ: 2.5,
        subBass: 0.12,
        turboWhistle: 0.0,
        lpFreq: 7500,
        drive: 1.6,
        toneWeight: 0.65,
        decayRate: 4.8,
        isRotary: false
    },
    v12: {
        id: 'screamer',
        name: 'F1 Classic Screamer (High-RPM Howl)',
        firings: 5,
        bodyQ: 1.8,
        raspMult: 2.5,
        raspQ: 3.2,
        subBass: 0.15,
        turboWhistle: 0.0,
        lpFreq: 9500,
        drive: 1.8,
        toneWeight: 0.80,
        decayRate: 4.8,
        isRotary: false
    }
};

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
    constructor(sampleRate, seed = 1, profile = 'v8') {
        this.sr = sampleRate;
        this.crank = 0;              // revolutions since start (wrapped each block)
        this.fire = 0;               // firings so far
        this.env = 0;                // current combustion pulse envelope
        this.pop = 0;                // overrun crackle pop envelope
        this.stutterPhase = 0;       // limiter on/off cycle 0..1
        this.turboPhase = 0;         // turbocharger oscillation phase
        this.seed = (seed >>> 0) || 1;
        this.body = biquad();        // resonance at the firing frequency
        this.rasp = biquad();        // upper harmonic resonance
        this.lp = 0;                 // exhaust/air top-end roll-off
        this.hpX = 0; this.hpY = 0;  // DC blocker
        this.setProfile(profile);
    }

    setProfile(profileName) {
        this.profile = ENGINE_PROFILES[profileName] || ENGINE_PROFILES.v8;
        this.firings = this.profile.firings;
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
        const prof = this.profile || ENGINE_PROFILES.v8;
        const firings = prof.firings;
        const sr = this.sr, ff = (rpm / 60) * firings, dRev = rpm / 60 / sr;
        const whole = Math.floor(this.crank); this.crank -= whole; this.fire -= whole * firings;

        bandpass(this.body, ff, prof.bodyQ, sr);
        bandpass(this.rasp, ff * prof.raspMult, prof.raspQ, sr);

        const decay = Math.exp(-ff / (sr * 0.30));
        const amp = 0.25 + 0.75 * load;
        const noisy = 0.12 + 0.28 * (1 - load);
        const dSt = stutter / sr, popChance = (crackle * 9) / sr;
        const popDecay = Math.exp(-1 / (sr * 0.004));
        const lpK = 1 - Math.exp((-TAU * prof.lpFreq) / sr);
        const drive = prof.drive, norm = 0.8 / Math.tanh(drive);
        const dTurbo = (ff * 4.8 * (0.8 + 0.6 * load)) / sr;

        for (let i = 0; i < n; i++) {
            this.crank += dRev;
            const curCycle = this.crank * firings;
            const f = Math.floor(curCycle);
            const phi = curCycle - f; // phase within current firing pulse [0, 1)
            const lit = stutter > 0 && this.stutterPhase < 0.5 ? 0 : 1 - cut;

            if (f !== this.fire) {                                  // a cylinder fires
                this.fire = f;
                const bank = f & 1 ? 0.92 : 1;                      // bank asymmetry
                this.env = Math.max(this.env, amp * bank * (0.92 + 0.16 * this.rand()) * (0.05 + 0.95 * lit));
            }

            if (stutter > 0) {
                this.stutterPhase += dSt;
                if (this.stutterPhase >= 1) this.stutterPhase -= 1;
            }

            if (popChance > 0 && this.rand() < popChance) {
                this.pop = 0.6 + 0.4 * this.rand();
            }

            // 1. Tonal combustion wave (fundamental firing frequency + harmonics)
            let combustionTone;
            if (prof.isRotary) {
                // Rotary Wankel: high-overlap triangular chamber port exposure with sharp buzzing harmonics
                const rotPulse = Math.sin(phi * TAU) * Math.exp(-phi * prof.decayRate);
                const rotHarm2 = Math.sin(phi * 2 * TAU) * 0.6;
                const rotHarm3 = Math.sin(phi * 3 * TAU) * 0.35;
                combustionTone = (rotPulse + rotHarm2 + rotHarm3) * this.env;
            } else {
                // Piston 4-stroke: asymmetric compression-expansion pulse
                const pulse = Math.sin(phi * Math.PI) * Math.exp(-phi * prof.decayRate);
                const harm2 = Math.sin(phi * 2 * Math.PI) * Math.exp(-phi * (prof.decayRate + 2)) * 0.35;
                combustionTone = (pulse + harm2) * this.env;
            }

            // 2. Sub-bass & intake growl
            const crankRad = this.crank * TAU;
            const subBass = (Math.sin(crankRad) * 0.7 + Math.sin(crankRad * 0.5) * 0.3) * this.env * prof.subBass * (0.2 + 0.8 * load) * lit;

            // 3. Turbocharger whistle
            let turbo = 0;
            if (prof.turboWhistle > 0) {
                this.turboPhase += dTurbo;
                if (this.turboPhase >= 1) this.turboPhase -= 1;
                turbo = Math.sin(this.turboPhase * TAU) * prof.turboWhistle * (0.1 + 0.9 * load) * lit;
            }

            // 4. Combustion turbulence & pop crackle
            const noise = (this.rand() * 2 - 1);
            const turbulent = (this.env * noisy * noise) + (this.pop * noise);

            this.env *= decay;
            this.pop *= popDecay;

            // Combined raw acoustic excitation
            const rawExcite = (combustionTone * prof.toneWeight) + (turbulent * (1 - prof.toneWeight)) + subBass + turbo;

            // Exhaust header acoustic resonator
            const y = 0.55 * rawExcite + 0.90 * step(this.body, rawExcite) + 0.35 * step(this.rasp, rawExcite);

            // Exhaust air lowpass damping
            this.lp += (y - this.lp) * lpK;

            // DC blocking highpass filter
            const hp = this.lp - this.hpX + 0.995 * this.hpY;
            this.hpX = this.lp;
            this.hpY = hp;

            // Non-linear power stage saturation
            out[i] = Math.tanh(drive * hp) * norm;
        }
    }
}
