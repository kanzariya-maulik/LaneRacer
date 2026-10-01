// Graphics levels and the rules that pick and adapt them. Pure, shared by game3d.js and the node tests.
export const LEVELS = {
    low:    { ratio: [0.75, 0.5, 1], antialias: false, shadows: 0,    softShadows: false, scenery: 0.3, far: 6000,  fog: 6000,  envMap: false, tyreMarks: false, anisotropy: 1 },
    medium: { ratio: [1, 0.6, 1],    antialias: false, shadows: 1024, softShadows: false, scenery: 0.6, far: 12000, fog: 12000, envMap: true,  tyreMarks: true,  anisotropy: 4 },
    high:   { ratio: [2, 0.75, 2],   antialias: true,  shadows: 2048, softShadows: true,  scenery: 1,   far: 20000, fog: 16000, envMap: true,  tyreMarks: true,  anisotropy: 8 },
};

export function ratioRange(level, dpr) {
    const [start, min, max] = LEVELS[level].ratio;
    const cap = level === 'high' ? Math.min(dpr, max) : max;
    return { start: Math.min(start, cap), min: Math.min(min, cap), max: cap };
}

export function resolveLevel(choice, autoResult) {
    if (choice in LEVELS) return choice;
    return autoResult in LEVELS ? autoResult : 'medium';
}

// After 5 s of driving on Medium: under ~45 fps steps down, over ~85 fps steps up
export function autoPick(avgFrameMs, current, dpr) {
    if (avgFrameMs > 22) return 'low';
    if (avgFrameMs < 11.8 && dpr >= 1) return 'high';
    return current;
}

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
        if (st.noDrop || st.ratio <= st.min) return { ...st, good: 0 };
        return { ...st, ratio: st.min, good: 0, need: 10, probe: { fps, from: st.ratio } };
    }
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

// Point p moved onto the shadow map's texel grid in the light's own axes (three.js lookAt basis, up = +Y),
// so the shadow camera can follow the car without shadow edges crawling. off = light position − target.
export function snapLight(p, off, step) {
    const n = Math.hypot(off.x, off.y, off.z), z = { x: off.x / n, y: off.y / n, z: off.z / n };
    const xl = Math.hypot(z.z, z.x), x = { x: z.z / xl, y: 0, z: -z.x / xl };
    const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
    const dot = (a) => p.x * a.x + p.y * a.y + p.z * a.z;
    const u = Math.round(dot(x) / step) * step, v = Math.round(dot(y) / step) * step, w = dot(z);
    return { x: x.x * u + y.x * v + z.x * w, y: x.y * u + y.y * v + z.y * w, z: x.z * u + y.z * v + z.z * w };
}
