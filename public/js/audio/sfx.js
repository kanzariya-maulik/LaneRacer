// Synthesised one-shots (start beeps, DRS clunk, shift bark) and the wind loop. Each can be replaced by a recording
// through the slot in audio.js. All share one noise buffer.
export function makeNoise(ctx, seconds = 2) {
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}

function env(ctx, dest, peak, attack, dur) {
    const g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    return g;
}

function noiseBurst(ctx, dest, noise, freq, q, peak, dur) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = noise;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(env(ctx, dest, peak, 0.002, dur));
    src.start(ctx.currentTime, Math.random());
    src.stop(ctx.currentTime + dur + 0.05);
}

// F1-game start light: one beep per red light, a higher longer tone at lights out
export function beep(ctx, dest, freq = 1000, dur = 0.12) {
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = freq;
    o.connect(env(ctx, dest, 0.18, 0.004, dur));
    o.start(); o.stop(ctx.currentTime + dur + 0.05);
}

// DRS flap: a mechanical clack plus a low thump
export function clunk(ctx, dest, noise) {
    noiseBurst(ctx, dest, noise, 1200, 2, 0.35, 0.05);
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(110, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.08);
    o.connect(env(ctx, dest, 0.3, 0.002, 0.09));
    o.start(); o.stop(ctx.currentTime + 0.15);
}

// Upshift bark: the exhaust snap as ignition comes back
export function bark(ctx, dest, noise) { noiseBurst(ctx, dest, noise, 2500, 1.5, 0.22, 0.035); }

// Wind roar: looped noise, louder and brighter with speed
export function makeWind(ctx, dest, noise) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true;
    f.type = 'lowpass'; f.frequency.value = 400;
    g.gain.value = 0;
    src.connect(f).connect(g).connect(dest);
    src.start();
    return {
        set(speedMs) {
            const k = Math.min(1.3, Math.abs(speedMs) / 90);
            g.gain.setTargetAtTime(0.22 * k * k, ctx.currentTime, 0.05);
            f.frequency.setTargetAtTime(300 + 2500 * k, ctx.currentTime, 0.05);
        },
    };
}

export function playBuffer(ctx, dest, buffer, gain = 0.8) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffer; g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start();
}
