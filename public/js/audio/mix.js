// Small pure helpers for audio.js: Doppler, recorded-loop crossfade, throttle guessed from acceleration.
export const SOUND_C = 343; // m/s

// Pitch factor for a source moving away (vRadial > 0) or toward (< 0) the listener
export function doppler(vRadial) {
    const v = Number.isFinite(vRadial) ? vRadial : 0;
    return Math.min(1.25, Math.max(0.8, SOUND_C / Math.max(1, SOUND_C + v)));
}

// Recording slot: the two loops nearest rpm (sorted ascending) and equal-power crossfade weights
export function pickLoops(loops, rpm) {
    if (!loops.length) return null;
    const last = loops.length - 1;
    if (rpm <= loops[0].rpm) return { a: 0, b: 0, wa: 1, wb: 0 };
    if (rpm >= loops[last].rpm) return { a: last, b: last, wa: 1, wb: 0 };
    let i = 0;
    while (loops[i + 1].rpm <= rpm) i++;
    const t = (rpm - loops[i].rpm) / (loops[i + 1].rpm - loops[i].rpm);
    return { a: i, b: i + 1, wa: Math.cos((t * Math.PI) / 2), wb: Math.sin((t * Math.PI) / 2) };
}

// Other cars don't send throttle: > +2 m/s² reads as on, < −3 m/s² as off, otherwise the last state holds
export function estimateLoad(prevLoad, accel, dt) {
    const a = Number.isFinite(accel) ? accel : 0, prev = Number.isFinite(prevLoad) ? prevLoad : 0;
    const target = a > 2 ? 1 : a < -3 ? 0 : prev;
    return prev + (target - prev) * Math.min(1, dt * 8);
}
