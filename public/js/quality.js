// Graphics levels and the rules that pick and adapt them. Pure, shared by game3d.js, postfx.js and the node tests.
// scale: internal render scale [start, min, max] (adaptStep moves it, the upscaler fills the screen); dpr: device-pixel cap.
// effects: the post chain (postfx.js), one anti-aliasing each. cascades: CSM cascades (0 = no sun shadows).
export const LEVELS = {
    low:    { scale: [0.75, 0.5, 1], dpr: 1, effects: ['fxaa', 'fsr1'], shadows: 0, cascades: 0,
              scenery: 0.3, far: 6000, fog: 6000, envMap: false, tyreMarks: false, anisotropy: 1, texRes: 512 },
    medium: { scale: [1, 0.6, 1], dpr: 1, effects: ['ao', 'bloom', 'vignette', 'smaa', 'fsr1'], shadows: 1024, cascades: 2,
              scenery: 0.6, far: 12000, fog: 12000, envMap: true, tyreMarks: true, anisotropy: 4, texRes: 1024 },
    high:   { scale: [1, 1, 1], dpr: 1, effects: ['ao', 'bloom', 'vignette', 'traa'], shadows: 2048, cascades: 3,
              scenery: 1, far: 20000, fog: 16000, envMap: true, tyreMarks: true, anisotropy: 16, texRes: 2048 },
    ultra:  { scale: [1, 1, 1], dpr: 1.5, effects: ['ao', 'ssr', 'bloom', 'lensflare', 'vignette', 'traa'], shadows: 4096, cascades: 4,
              scenery: 1, far: 20000, fog: 16000, envMap: true, tyreMarks: true, anisotropy: 16, texRes: 2048 },
};
export const ORDER = ['low', 'medium', 'high', 'ultra'];

export function scaleRange(level) {
    const [start, min, max] = LEVELS[level].scale;
    return { start, min, max };
}

export const pixelRatio = (level, dpr) => Math.min(dpr, LEVELS[level].dpr);

export const stepDown = (level) => ORDER[Math.max(0, ORDER.indexOf(level) - 1)];

// The lower of the two: after a GPU reset, later sessions stay at most at the level it lowered to
export const capLevel = (level, max) => ORDER[Math.min(ORDER.indexOf(level), ORDER.indexOf(max))];

// A manual choice is kept as is. Auto: the measured level, else Medium — Low on the slower WebGL2 fallback
export function resolveLevel(choice, autoResult, backend = 'webgpu') {
    if (choice in LEVELS) return choice;
    if (autoResult in LEVELS) return autoResult;
    return backend === 'webgl2' ? 'low' : 'medium';
}

// After 5 s of driving: under ~45 fps → Low; over ~85 fps → High; on High, fast enough that Ultra (~1.4x the work, its
// slow frames ~1.5x more) still fits the display's frame time → Ultra: 7 ms at 60 Hz, 3.5 ms at 120 Hz (ProMotion)
export function autoPick(avgFrameMs, current, dpr, hz = 60) {
    if (avgFrameMs > 22) return 'low';
    if (current === 'high' && avgFrameMs < (7 * 60) / hz) return 'ultra';
    if (current === 'ultra') return avgFrameMs <= 0.6 * (1000 / hz) ? 'ultra' : 'high'; // its slow frames still fit
    if (avgFrameMs < 11.8 && dpr >= 1) return 'high';
    return current;
}

// The display's refresh rate from frame intervals (ms) taken while nothing is drawn (the lobby): the median, snapped to the
// usual rates; 60 when unknown, 240 at most (no vsync)
const RATES = [60, 75, 90, 100, 120, 144, 165, 240];
export function refreshHz(intervals) {
    if (!intervals.length) return 60;
    const m = [...intervals].sort((a, b) => a - b)[intervals.length >> 1], hz = 1000 / m;
    return RATES.reduce((best, r) => (Math.abs(r - hz) < Math.abs(best - hz) ? r : best), 60);
}

// Auto measures when nothing is stored yet, and again from a stored High (the way up to Ultra) or Ultra (back down if it misses frames)
export const shouldMeasure = (choice, stored) => choice === 'auto' && (!stored || stored === 'high' || stored === 'ultra');

// polygonOffset pulls decals toward the camera with negative values; a reversed depth buffer needs the sign flipped
export const depthBias = (n, reversed) => (reversed && n ? -n : n);

// Once a second. Below 50 fps: probe by dropping straight to the level's minimum (with vsync, small steps can't get a
// 30 fps frame back under 16.7 ms). If that isn't at least 3 fps faster, resolution isn't the bottleneck (a frame cap,
// Energy Saver): restore the ratio and stop lowering. If it helps, keep it and climb back 0.05 every 3 s of 58+ fps
// (10 s right after a drop), never back up to the ratio that was too slow.
export function adaptStep(st, fps) {
    const round = (v) => Math.round(v * 100) / 100;
    if (st.probe) {
        const { fps: before, from } = st.probe;
        st = { ...st };
        delete st.probe;
        if (fps < before + 3) return { ...st, ratio: from, good: 0, noDrop: true };
        st.ceil = round(from - 0.05);
    }
    if (fps < 50) {
        const slow = (st.slow || 0) + 1; // two slow seconds in a row: a one-off hitch (loading, rebuild) isn't a slow GPU
        if (st.noDrop || st.ratio <= st.min || slow < 2) return { ...st, good: 0, slow };
        return { ...st, ratio: st.min, good: 0, slow: 0, need: 10, probe: { fps, from: st.ratio } };
    }
    st = { ...st, slow: 0 };
    if (fps <= 58) return { ...st, good: 0 };
    const good = st.good + 1, top = Math.min(st.max, st.ceil ?? st.max);
    if (good >= (st.need || 3) && st.ratio < top) return { ...st, ratio: Math.min(top, round(st.ratio + 0.05)), good: 0, need: 3 };
    return { ...st, good };
}

// The last 6 one-second fps readings all within 1 fps of 30: the browser caps frames (Chrome Energy Saver, low battery)
export function frameCapped(history) {
    const last = history.slice(-6);
    return last.length === 6 && last.every((f) => Math.abs(f - 30) <= 1);
}
