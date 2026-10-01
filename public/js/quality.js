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

// Once a second: below 50 fps drop resolution 0.1; above 58 fps for 3 s raise it 0.05
export function adaptStep(st, fps) {
    const round = (v) => Math.round(v * 100) / 100;
    if (fps < 50) return { ...st, ratio: Math.max(st.min, round(st.ratio - 0.1)), good: 0 };
    if (fps <= 58) return { ...st, good: 0 };
    const good = st.good + 1;
    if (good >= 3 && st.ratio < st.max) return { ...st, ratio: Math.min(st.max, round(st.ratio + 0.05)), good: 0 };
    return { ...st, good };
}
