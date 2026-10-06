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

// Spectator camera: keep following the same driver through overtakes; step ±1 through the running order
export function stepFollow(ids, current, step) {
    if (!ids.length) return null;
    const i = ids.indexOf(current);
    if (i < 0) return ids[0];
    return ids[(((i + step) % ids.length) + ids.length) % ids.length];
}

// After finishing: which car to watch. ids in rank order; a car the player switched to stays watched (even once it
// finishes), otherwise the best-placed car still running; null when nobody is left running (back to your own car)
export function watchTarget(ids, me, isFinished, current) {
    if (current && current !== me && ids.includes(current)) return current;
    return ids.find((id) => id !== me && !isFinished(id)) ?? null;
}

// Lap distance (world units from the start line) inside a DRS zone; zones may wrap past the line
export function inDrsZone(zones, lapS) {
    return zones.some((z) => (z.startS <= z.endS ? lapS >= z.startS && lapS < z.endS : lapS >= z.startS || lapS < z.endS));
}

// Why DRS is off (or how to open it), shown under the badge. Race: from lap 2, within 1.0 s at detection. Quali: free in the zones.
export function drsHint({ mode, inPit, drs, drsAvailable, lap, inZone }) {
    if (inPit) return 'PIT LANE';
    if (drs) return 'OPEN';
    if (drsAvailable) return 'PRESS E / Y';
    if (mode === 'race' && lap < 1) return 'FROM LAP 2';
    if (mode === 'race' && inZone) return 'NEED < 1.0 s';
    return 'IN DRS ZONES';
}

// F1 timing colours, decided when drawn so they change live: purple = this driver holds the session best with this
// time right now, green = a personal best (also a purple someone has since beaten), yellow = slower, grey = invalid lap.
// s: { id, sector (1-3), time, valid, personalBest }; best / bestIds: the live session bests and their holders
export function sectorClass(s, best, bestIds) {
    if (!s.valid) return 'sec-grey';
    const i = s.sector - 1;
    if (bestIds[i] === s.id && best[i] !== null && s.time <= best[i] + 1e-9) return 'sec-purple';
    return s.personalBest ? 'sec-green' : 'sec-yellow';
}

// Live sector times per driver for the lap they're on (timing tower), coloured when drawn; sector 1 starts a fresh lap
export function liveSectors(live, s) {
    if (s.sector === 1 || !live[s.id]) live[s.id] = [null, null, null];
    live[s.id][s.sector - 1] = s;
    return live;
}

// Your last lap: purple while it is the session's fastest, green once beaten (still your best), red if deleted
export function lastLapClass(last, best, fastest, deleted) {
    if (deleted) return 't-red';
    if (last === null || last === undefined) return '';
    if (fastest !== null && fastest !== undefined && last <= fastest + 1e-9) return 't-purple';
    return best !== null && best !== undefined && last <= best + 1e-9 ? 't-green' : '';
}

// Race classification row: winner's final time (penalties included), gap for the rest, penalty, places won/lost to penalties
export function resultCells(r, fmtTime) {
    const time = r.dnf ? 'DNF' : r.position === 1 || r.gap === null ? fmtTime(r.total) : `+${r.gap.toFixed(3)}`;
    const change = r.change > 0 ? `▲${r.change}` : r.change < 0 ? `▼${-r.change}` : '';
    return { time, pen: r.penalty ? `+${r.penalty}s` : '', change, changeCls: r.change > 0 ? 'up' : r.change < 0 ? 'down' : '' };
}
