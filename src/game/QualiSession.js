// Qualifying rules (pure): knockout counts, segment clocks, segment ranking, grid order
const SEGMENT_LAPS = { full: [5, 4, 3.5], short: [6] };
const MIN_S = 120;

const knockoutCount = (n) => Math.max(1, Math.floor(n / 4));
const effectiveFormat = (format, drivers) => (format === 'full' && drivers < 4 ? 'short' : format);
const round30 = (s) => Math.round(s / 30) * 30;

function segmentPlan(format, refS, scale = 1) {
    if (format === 'oneshot') return [Infinity];
    return (SEGMENT_LAPS[format] || SEGMENT_LAPS.short).map((k) => Math.max(MIN_S, round30(k * refS)) * scale);
}

function rankSegment(entries) {
    return [...entries].sort((a, b) => {
        if (a.time === null || b.time === null) return a.time === b.time ? a.joinOrder - b.joinOrder : a.time === null ? 1 : -1;
        return a.time - b.time || a.at - b.at;
    });
}

function gridOrder(segments) {
    const last = segments[segments.length - 1], ids = last.ranked.map((e) => e.id);
    for (let k = segments.length - 2; k >= 0; k--) {
        const out = new Set(segments[k].out);
        for (const e of segments[k].ranked) if (out.has(e.id)) ids.push(e.id);
    }
    return ids;
}

module.exports = { knockoutCount, effectiveFormat, segmentPlan, rankSegment, gridOrder };
