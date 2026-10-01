// Timing tower text, F1 broadcast style. Pure, shared by game3d.js and the node tests.
// rows: sorted by rank, each { gap: seconds behind the leader or null, lapsDown }

const laps = (n) => `+${n} LAP${n > 1 ? 'S' : ''}`;

// Gap column for row i: mode 'leader' (to P1) or 'interval' (to the car ahead). null for the leader.
export function gapText(rows, i, mode) {
    if (i === 0) return null;
    const p = rows[i], ahead = rows[i - 1];
    if (mode === 'leader') return p.lapsDown > 0 ? laps(p.lapsDown) : p.gap === null ? '' : `+${p.gap.toFixed(3)}`;
    if (p.lapsDown > ahead.lapsDown) return laps(p.lapsDown - ahead.lapsDown);
    const aheadGap = i === 1 ? 0 : ahead.gap;
    if (p.gap === null || aheadGap === null) return '';
    return `+${Math.max(0, p.gap - aheadGap).toFixed(3)}`;
}

export function driverCode(name) {
    return ((name.match(/[a-z]/gi) || []).join('') || name).slice(0, 3).toUpperCase();
}

// Last lap against personal best: PB, or how far off it was
export function lapDelta(last, best) {
    if (last === null || last === undefined || best === null || best === undefined) return null;
    const d = last - best;
    return d <= 1e-9 ? { text: 'PB', cls: 't-green' } : { text: `+${d.toFixed(3)}`, cls: 't-yellow' };
}
