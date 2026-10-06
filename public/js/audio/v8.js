// Multi-profile engine synthesiser: F1 V8 (classic), F1 V6 Turbo, V8 Muscle, F1 Screamer, 4-Rotor Wankel, Flat-6 Boxer.
// Each profile tunes the combustion model (firings/rev, resonance Qs, sub-bass, turbo whistle, drive, decay).
// Pure DSP shared by AudioWorklet (v8-worklet.js) and unit tests. render() allocates nothing.
export const FIRINGS_PER_REV = 4; // default; overridden per profile at render time
export const PITCH = 1.12;        // kept for the classic v8: ~2 semitones above true firing freq

const TAU = 2 * Math.PI;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN → 0

// ─── Engine profiles ──────────────────────────────────────────────────────────
export const ENGINE_PROFILES = {
    // Classic 2006–2013 F1 2.4L V8 (the original develop synth feel, kept as default)
    v8: {
        id: 'v8',
        name: 'F1 2.4L V8 (Classic High-RPM Scream)',
        firings: 4,
        bodyQ: 1.5,
        raspMult: 2.0,    // h2 harmonic multiplier
        raspQ: 3.0,
        h3Mult: 3.0, h3Q: 3.0,
        h4Mult: 4.0, h4Q: 3.0,
        subBass: 0.12,
        turboWhistle: 0.0,
        lpFreq: 7500,
        drive: 1.6,
        toneWeight: 0.65,
        decayPulse: 0.09, // fraction of firing period: short = rich harmonics
        isRotary: false,
        pitchBright: PITCH,  // extra pitch for this profile's scream
    },
    // Modern F1 1.6L V6 Turbo
    v6: {
        id: 'v6',
        name: 'F1 1.6L V6 Turbo (Modern Growl)',
        firings: 3,
        bodyQ: 1.1,
        raspMult: 2.0,
        raspQ: 2.2,
        h3Mult: 3.0, h3Q: 2.2,
        h4Mult: 4.0, h4Q: 2.2,
        subBass: 0.45,
        turboWhistle: 0.28,
        lpFreq: 5400,
        drive: 2.2,
        toneWeight: 0.75,
        decayPulse: 0.10,
        isRotary: false,
        pitchBright: 1.0,
    },
    // 7.0L V8 Muscle / NASCAR
    muscle: {
        id: 'muscle',
        name: '7.0L V8 Muscle (Deep Bass Rumble)',
        firings: 4,
        bodyQ: 0.9,
        raspMult: 1.8,
        raspQ: 1.8,
        h3Mult: 2.7, h3Q: 1.8,
        h4Mult: 3.6, h4Q: 1.8,
        subBass: 0.55,
        turboWhistle: 0.0,
        lpFreq: 4400,
        drive: 2.4,
        toneWeight: 0.75,
        decayPulse: 0.12,
        isRotary: false,
        pitchBright: 1.0,
    },
    // F1 Classic Screamer (high-firing V10-era feel)
    screamer: {
        id: 'screamer',
        name: 'F1 Classic Screamer (High-RPM Howl)',
        firings: 5,
        bodyQ: 1.8,
        raspMult: 2.5,
        raspQ: 3.2,
        h3Mult: 3.5, h3Q: 3.2,
        h4Mult: 4.5, h4Q: 3.2,
        subBass: 0.15,
        turboWhistle: 0.0,
        lpFreq: 9500,
        drive: 1.8,
        toneWeight: 0.80,
        decayPulse: 0.07,
        isRotary: false,
        pitchBright: 1.0,
    },
    // 2.6L 4-Rotor Wankel (Mazda 787B / RX-7)
    rotary: {
        id: 'rotary',
        name: '2.6L 4-Rotor Wankel (787B Shriek)',
        firings: 6,
        bodyQ: 2.2,
        raspMult: 3.2,
        raspQ: 3.8,
        h3Mult: 4.2, h3Q: 3.8,
        h4Mult: 5.2, h4Q: 3.8,
        subBass: 0.10,
        turboWhistle: 0.0,
        lpFreq: 11000,
        drive: 2.0,
        toneWeight: 0.85,
        decayPulse: 0.06,
        isRotary: true,
        pitchBright: 1.0,
    },
    // 4.0L Flat-6 GT3 Boxer
    boxer: {
        id: 'boxer',
        name: '4.0L Flat-6 GT3 (Throaty Boxer Rasp)',
        firings: 3,
        bodyQ: 1.4,
        raspMult: 2.3,
        raspQ: 2.6,
        h3Mult: 3.0, h3Q: 2.6,
        h4Mult: 3.8, h4Q: 2.6,
        subBass: 0.35,
        turboWhistle: 0.10,
        lpFreq: 6800,
        drive: 2.0,
        toneWeight: 0.78,
        decayPulse: 0.09,
        isRotary: false,
        pitchBright: 1.0,
    },
};
// Backwards-compatibility aliases
ENGINE_PROFILES.v10 = ENGINE_PROFILES.screamer;
ENGINE_PROFILES.v12 = ENGINE_PROFILES.screamer;

// ─── Biquad helpers ───────────────────────────────────────────────────────────
function biquad() { return { b0: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }; }
function bandpass(c, f, q, sr) { // RBJ band-pass, 0 dB peak gain
    const w = (TAU * Math.min(f, sr * 0.45)) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    c.b0 = al / a0; c.b2 = -al / a0; c.a1 = (-2 * Math.cos(w)) / a0; c.a2 = (1 - al) / a0;
}
function stepBQ(c, x) {
    const y = c.b0 * x + c.b2 * c.x2 - c.a1 * c.y1 - c.a2 * c.y2;
    c.x2 = c.x1; c.x1 = x; c.y2 = c.y1; c.y1 = y;
    return y;
}

// ─── Synth class ──────────────────────────────────────────────────────────────
export class V8Synth {
    constructor(sampleRate, seed = 1, profile = 'v8') {
        this.sr = sampleRate;
        this.crank = 0;
        this.fire = 0;
        this.env = 0;
        this.pop = 0;
        this.stutterPhase = 0;
        this.turboPhase = 0;
        this.seed = (seed >>> 0) || 1;
        // Four resonance biquads (body + 3 harmonics) + hiss + DC blocker state
        this.body = biquad();
        this.h2   = biquad();
        this.h3   = biquad();
        this.h4   = biquad();
        this.hiss = biquad();
        this.lp = 0;
        this.hpX = 0; this.hpY = 0;
        // Fixed hiss band — the profile may override lpFreq but hiss stays at the physical intake frequency
        bandpass(this.hiss, Math.min(6000, sampleRate * 0.4), 0.8, sampleRate);
        this.setProfile(profile);
    }

    setProfile(profileName) {
        this.profile = ENGINE_PROFILES[profileName] || ENGINE_PROFILES.v8;
    }

    rand() { // xorshift32 → [0, 1)
        let x = this.seed;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        this.seed = x >>> 0;
        return this.seed / 4294967296;
    }

    render(out, n, p) {
        const prof = this.profile || ENGINE_PROFILES.v8;
        const rpm  = Math.min(20000, Math.max(500, Number.isFinite(p.rpm) ? p.rpm : 500));
        const load = clamp01(p.load), cut = clamp01(p.cut), crackle = clamp01(p.crackle);
        const stutter = Number.isFinite(p.stutter) && p.stutter > 0 ? p.stutter : 0;

        const firings = prof.firings;
        const bright  = prof.pitchBright ?? 1.0;
        const sr = this.sr;
        const ff = (rpm / 60) * firings * bright;
        const dRev = (rpm / 60 / sr) * bright;

        // Wrap crank to avoid float precision loss at high RPM
        const whole = Math.floor(this.crank); this.crank -= whole; this.fire -= whole * firings;

        // Recompute resonances each block (frequency changes with rpm)
        bandpass(this.body, ff,                   prof.bodyQ,  sr);
        bandpass(this.h2,   ff * prof.raspMult,   prof.raspQ,  sr);
        bandpass(this.h3,   ff * (prof.h3Mult ?? prof.raspMult * 1.5), prof.h3Q ?? prof.raspQ, sr);
        bandpass(this.h4,   ff * (prof.h4Mult ?? prof.raspMult * 2.0), prof.h4Q ?? prof.raspQ, sr);

        const decay    = Math.exp(-ff / (sr * prof.decayPulse));
        const amp      = 0.25 + 0.75 * load;
        const noisy    = 0.10 + 0.30 * (1 - load);
        const rev      = rpm / 18000;
        const hissAmt  = 0.65 * (0.3 + 0.7 * load) * rev * rev;
        const lpK      = 1 - Math.exp((-TAU * Math.min(prof.lpFreq, sr * 0.45)) / sr);
        const drive    = prof.drive, norm = 0.8 / Math.tanh(drive);
        const dSt      = stutter / sr;
        const popChance = (crackle * 9) / sr;
        const popDecay  = Math.exp(-1 / (sr * 0.004));
        const dTurbo    = prof.turboWhistle > 0 ? (ff * 4.8 * (0.8 + 0.6 * load)) / sr : 0;

        for (let i = 0; i < n; i++) {
            this.crank += dRev;
            const curFire = Math.floor(this.crank * firings);
            const phi = (this.crank * firings) - curFire; // phase within current firing [0,1)

            if (curFire !== this.fire) {
                this.fire = curFire;
                const lit = stutter > 0 && this.stutterPhase < 0.5 ? 0 : 1 - cut;
                const bank = curFire & 1 ? 0.92 : 1; // bank asymmetry for natural roughness
                this.env = Math.max(this.env, amp * bank * (0.9 + 0.2 * this.rand()) * (0.05 + 0.95 * lit));
            }
            if (stutter > 0) { this.stutterPhase += dSt; if (this.stutterPhase >= 1) this.stutterPhase -= 1; }
            if (popChance > 0 && this.rand() < popChance) this.pop = 0.6 + 0.4 * this.rand();

            // ── Combustion tone ──
            let combustionTone;
            if (prof.isRotary) {
                // Wankel: triangular port overlap with sharp harmonic buzz
                const rotPulse = Math.sin(phi * TAU) * Math.exp(-phi * (1 / prof.decayPulse) * 0.4);
                combustionTone = (rotPulse
                    + Math.sin(phi * 2 * TAU) * 0.6
                    + Math.sin(phi * 3 * TAU) * 0.35) * this.env;
            } else {
                // 4-stroke piston: asymmetric compression-expansion pulse
                const decayK = 1 / prof.decayPulse * 0.4;
                const pulse = Math.sin(phi * Math.PI) * Math.exp(-phi * decayK);
                const harm2 = Math.sin(phi * 2 * Math.PI) * Math.exp(-phi * (decayK + 2)) * 0.35;
                combustionTone = (pulse + harm2) * this.env;
            }

            // ── Sub-bass (crankshaft / chassis resonance) ──
            const crankRad = this.crank * TAU;
            const subBass = (Math.sin(crankRad) * 0.7 + Math.sin(crankRad * 0.5) * 0.3)
                * this.env * prof.subBass * (0.2 + 0.8 * load);

            // ── Turbo whistle (only for profiles with turbo) ──
            let turbo = 0;
            if (prof.turboWhistle > 0) {
                this.turboPhase += dTurbo;
                if (this.turboPhase >= 1) this.turboPhase -= 1;
                turbo = Math.sin(this.turboPhase * TAU) * prof.turboWhistle * (0.1 + 0.9 * load);
            }

            // ── Combustion turbulence + crackle pops ──
            const r = this.rand() * 2 - 1;
            const turbulent = this.env * noisy * r + this.pop * r;
            this.env  *= decay;
            this.pop  *= popDecay;

            // ── Raw excitation: tone-weighted blend of deterministic + stochastic ──
            const tw = prof.toneWeight;
            const rawExcite = combustionTone * tw + turbulent * (1 - tw) + subBass + turbo;

            // ── Hiss (intake air, pulsed with the firings) ──
            const air = stepBQ(this.hiss, r) * this.env * hissAmt;

            // ── Exhaust resonators ──
            const y = 0.30 * rawExcite
                + 0.60 * stepBQ(this.body, rawExcite)
                + 0.50 * stepBQ(this.h2,   rawExcite)
                + 0.55 * stepBQ(this.h3,   rawExcite)
                + 0.90 * stepBQ(this.h4,   rawExcite)
                + air;

            // ── Lowpass + DC block + saturation ──
            this.lp += (y - this.lp) * lpK;
            const hp = this.lp - this.hpX + 0.995 * this.hpY;
            this.hpX = this.lp; this.hpY = hp;
            out[i] = Math.tanh(drive * hp) * norm;
        }
    }
}
