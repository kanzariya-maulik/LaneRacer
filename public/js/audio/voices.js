// Which other cars get one of the few V8 voices: the nearest within range, with hysteresis so a voice isn't
// handed back and forth between two cars at almost the same distance. Pure.
export function pickVoices(cars, lx, ly, current, n = 4, maxDist = Infinity, hyst = 0.1) {
    const scored = [];
    for (const c of cars) {
        const d = Math.hypot(c.x - lx, c.y - ly);
        if (!(d <= maxDist)) continue;
        scored.push([current.includes(c.id) ? d / (1 + hyst) : d, c.id, d]);
    }
    scored.sort((p, q) => p[0] - q[0]);
    return scored.slice(0, n).sort((p, q) => p[2] - q[2]).map((s) => s[1]);
}
