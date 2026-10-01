// Racing line rules on the client. Pure, shared by game3d.js and the node tests.
export const MODES = ['off', 'corners', 'full'];
export const NEAR_M = 250;                 // segments this close ahead react to your speed
const RED_DECEL = 0.6 * 1.6 * 9.81;        // m/s²: more than this to make the corner = brake now (CarPhysics MU 1.6)
const BASE = ['green', 'yellow', 'red'];   // by phase: flat, lift, brake
const BEFORE_M = 30, AFTER_M = 50;         // corners-only: shown around each lift/brake run
const SEARCH_BACK = 5, SEARCH_AHEAD = 30;  // points searched around the last index

export function segmentColor(phase, target, mySpeed, distAhead) {
    if (distAhead === null || distAhead === undefined || distAhead > NEAR_M) return BASE[phase];
    const need = (mySpeed * mySpeed - target * target) / (2 * Math.max(distAhead, 1));
    return need > RED_DECEL ? 'red' : need > 0 ? 'yellow' : 'green';
}

// Metres along the lap from point `from` forward to point `to`
export function aheadM(cum, from, to, scale) {
    const total = cum[cum.length - 1];
    return ((((cum[to] - cum[from]) % total) + total) % total) / scale;
}

export function cornerMask(phase, cum, scale) {
    const n = phase.length, mark = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
        if (phase[i] === 0) continue;
        for (let k = 0; k < n; k++) { const j = (i - k + n) % n; if (aheadM(cum, j, i, scale) > BEFORE_M) break; mark[j] = true; }
        for (let k = 0; k < n; k++) { const j = (i + k) % n; if (aheadM(cum, i, j, scale) > AFTER_M) break; mark[j] = true; }
    }
    return mark;
}

// Nearest path point, searched near the last one so a crossover can't jump to the other leg
export function trackIndex(path, x, y, last) {
    const n = path.length;
    const from = last === null || last === undefined ? 0 : last - SEARCH_BACK;
    const count = last === null || last === undefined ? n : SEARCH_BACK + SEARCH_AHEAD + 1;
    let best = 0, bd = Infinity;
    for (let k = 0; k < count; k++) {
        const i = (((from + k) % n) + n) % n, d = (path[i].x - x) ** 2 + (path[i].y - y) ** 2;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

export function nextMode(mode) {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}
