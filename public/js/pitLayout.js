import { nextHarder } from './sim/tyres.js';
// Pit lane layout for drawing (game3d.js buildPit) and the player's own-box cues. Pure — no three.js, no DOM — so node
// tests cover every circuit. World units (metres × track.scale); t = a built track, t.pit from Track.build; the garages are
// on the -pit.trackSide side of the lane.
export const TEAM_CODES = { redbull: 'RBR', ferrari: 'FER', mercedes: 'MER', alpine: 'ALP', mclaren: 'MCL', alfaromeo: 'ALF',
    astonmartin: 'AMR', haas: 'HAA', alphatauri: 'AT', williams: 'WIL', 'redbull-suzuka': 'RBR' };
export const BOX_M = { len: 7, wide: 3.4 };
export const COMPOUND_COLORS = { S: '#e10600', M: '#ffd12e', H: '#f2f2f2' };
const RUNOFF_M = 2, WALL_OFFSET = 80, GARAGE_BACK_M = 2.5, CANOPY_DEEP_M = 1.5, SPAN_PAD_M = 9, ENTRY_PICK_M = 500;

export const side = (p, angle, off) => ({ x: p.x - Math.sin(angle) * off, y: p.y + Math.cos(angle) * off });

export function distToPath(p, path, closed = true) {
    let best = Infinity;
    for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        let u = l2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        best = Math.min(best, Math.hypot(p.x - (a.x + u * (b.x - a.x)), p.y - (a.y + u * (b.y - a.y))));
    }
    return best;
}

const ahead = (p, angle, m) => ({ x: p.x + Math.cos(angle) * m, y: p.y + Math.sin(angle) * m });

export function pitLayout(t) {
    const pit = t.pit, sc = t.scale, s = pit.trackSide, back = pit.width / 2 + RUNOFF_M * sc;
    const [lo, hi] = pit.garageSpan, pad = SPAN_PAD_M * sc, n = pit.cum.length;
    let i0 = pit.cum.findIndex((c) => c >= lo - pad);
    i0 = Math.max(0, i0 > 0 && pit.cum[i0] > lo - pad ? i0 - 1 : i0);
    let i1 = n - 1;
    while (i1 > 0 && pit.cum[i1 - 1] >= hi + pad) i1--;
    const split = { i0, i1 };
    const garages = pit.garages.map((g) => {
        const c = side(g, g.angle, -s * (back + GARAGE_BACK_M * sc)), fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        // no building where it would stand on the track's run-off (Zandvoort, Sakhir: the track runs close behind the pits)
        const skip = [[-9, -2.5], [9, -2.5], [-9, 2.5], [9, 2.5]].some(([a, l]) =>
            distToPath({ x: c.x + (fx * a - fy * l) * sc, y: c.y + (fy * a + fx * l) * sc }, t.path) < t.width / 2 + (t.wallOffset ?? WALL_OFFSET));
        return { teamId: g.teamId, x: c.x, y: c.y, angle: g.angle, s: g.s, skip, front: side(g, g.angle, -s * back) };
    });
    const boxes = pit.garages.flatMap((g) => g.boxes.map((b) => ({
        teamId: g.teamId, code: TEAM_CODES[g.teamId] || g.teamId.slice(0, 3).toUpperCase(),
        x: b.x, y: b.y, angle: b.angle, s: b.s, codeAt: ahead(b, b.angle, (BOX_M.len / 2 + 1) * sc),
    })));
    const canopy = garages.filter((g) => !g.skip).map((g) => ({ ...side(g.front, g.angle, s * (CANOPY_DEEP_M / 2) * sc), angle: g.angle }));
    return { split, edge: { ...split }, boxes, garages, canopy };
}

// Around a car parked on its box (car corridor 2.2 m wide): wheel men at the corners; the jacks and the lollipop man stand
// to the garage side, clear of the line the car drives in and out on. garageSide: -pit.trackSide. ox/oy: unit step away
// from the box centre line (sideways), for the step-back at GO.
const CREW = [['wheelFL', 1.8, 1.6], ['wheelFR', 1.8, -1.6], ['wheelRL', -1.8, 1.6], ['wheelRR', -1.8, -1.6],
    ['jackF', 3.2, 1.3], ['jackR', -3.4, 1.3], ['lollipop', 4.4, 1.6]];
export function crewSpots(box, scale, garageSide) {
    return CREW.map(([role, a, l]) => {
        const lat = l * garageSide, p = side(ahead(box, box.angle, a * scale), box.angle, lat * scale), sg = Math.sign(lat);
        return { role, x: p.x, y: p.y, lat, angle: Math.atan2(box.y - p.y, box.x - p.x), // facing the car
            ox: -Math.sin(box.angle) * sg, oy: Math.cos(box.angle) * sg };
    });
}

// removed in Task 5 (game3d.js still imports boxCue/visitDone; pit assist makes them obsolete)
// HUD cue on the way to your box. distM: metres along the lane to the mark (< 0 past it); canStop(m): can the car stop in m;
// done: this visit already ended at the box (see visitDone) — nothing to cue
export function boxCue(distM, speedMs, canStop, done = false) {
    if (done) return null;
    if (distM > 0.5) {
        if (!canStop(distM + 0.5)) return 'MISSED — GO AROUND';
        return speedMs < 3 || canStop(distM - 3) ? `YOUR BOX ${Math.round(distM)} m` : 'BRAKE';
    }
    return distM < -1 && speedMs > 2 ? 'MISSED — GO AROUND' : null;
}

// Per pit-lane visit: true once the car has stopped at its box (a stop phase ran, or it sat on the mark — a quali car starting
// in its box); cleared on leaving the lane
export function visitDone(prev, { phase, distM, speedMs, inLane }) {
    if (!inLane) return false;
    return prev || !!phase || (distM !== null && Math.abs(distM) < 0.5 && speedMs < 0.5);
}

// When the tyre picker pops out (spec §1)
// phase: your stop's phase (null when none); done: visitDone — in a race the picker closes once serviced (hold, or after)
export function pickerOpen({ spectator, status, inPit, parked, toEntryM, boxDistM, phase = null, done = false }) {
    if (spectator) return false;
    if (status === 'COUNTDOWN') return true;
    if (status === 'QUALIFYING') return !!(inPit && parked);
    if (status !== 'RACE') return false;
    if (inPit) return phase !== 'hold' && !(done && !phase) && boxDistM !== null && boxDistM > -1;
    return toEntryM >= 0 && toEntryM <= ENTRY_PICK_M;
}

// Box frame helper: a metres along the box heading, l metres to its left
const at = (box, a, l, scale) => side(ahead(box, box.angle, a * scale), box.angle, l * scale);

// Four white T marks where the wheels stop (car centre on the box, wheelbase ±1.8 m, track ±0.8 m)
export function tMarks(box, scale) {
    return [[1.8, 0.8], [1.8, -0.8], [-1.8, 0.8], [-1.8, -0.8]].map(([a, l]) => ({ ...at(box, a, l, scale), angle: box.angle }));
}

// The pit crew around a box: idle = waiting clear of the car's way (|l| >= 1.1 m), work = where they stand during the change.
// Wheel men by wheel; jacks idle at the garage-side corners and step onto the car's centre line to lift it; the lollipop man
// waits beside the nose with his board over the stopping point
export function crew17(box, scale, trackSide) {
    const g = -trackSide, wheels = { FL: [1.8, 1], FR: [1.8, -1], RL: [-1.8, 1], RR: [-1.8, -1] }, out = [];
    for (const [w, [a, sgn]] of Object.entries(wheels)) {
        out.push({ role: `gun${w}`, idle: [a, sgn * 1.8], work: [a, sgn * 1.35] });
        out.push({ role: `off${w}`, idle: [a + 0.8, sgn * 2.2], work: [a + 0.6, sgn * 1.7] });
        out.push({ role: `on${w}`, idle: [a - 0.8, sgn * 2.2], work: [a - 0.6, sgn * 1.7] });
    }
    out.push({ role: 'jackF', idle: [3.6, g * 1.6], work: [3.1, 0] }, { role: 'jackR', idle: [-3.6, g * 1.6], work: [-3.1, 0] },
        { role: 'stabL', idle: [0.2, 2.0], work: [0.2, 1.3] }, { role: 'stabR', idle: [0.2, -2.0], work: [0.2, -1.3] },
        { role: 'lollipop', idle: [4.6, g * 1.6], work: [4.6, g * 1.6] });
    return out.map((c) => {
        const idle = at(box, c.idle[0], c.idle[1], scale), work = at(box, c.work[0], c.work[1], scale);
        return { role: c.role, idle, work, angle: Math.atan2(box.y - work.y, box.x - work.x) };
    });
}

// One team stand per standing garage, on the lane side of the pit wall opposite it
export function wallStands(t) {
    const pit = t.pit, wall = pit.wall, sc = t.scale, out = [];
    for (const g of pitLayout(t).garages) {
        if (g.skip) continue;
        let best = null;
        for (let i = 0; i < wall.length - 1; i++) {
            const a = wall[i], b = wall[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
            const u = Math.max(0, Math.min(1, ((g.x - a.x) * dx + (g.y - a.y) * dy) / l2));
            const q = { x: a.x + u * dx, y: a.y + u * dy }, d = Math.hypot(g.x - q.x, g.y - q.y);
            if (!best || d < best.d) best = { d, q, angle: Math.atan2(dy, dx) };
        }
        if (!best) continue;
        const toLane = side(best.q, best.angle, -pit.trackSide * 1.2 * sc); // the garages' side of the wall is the lane's
        out.push({ teamId: g.teamId, x: toLane.x, y: toLane.y, angle: best.angle });
    }
    return out;
}

const NAMES = { S: 'SOFT', M: 'MEDIUM', H: 'HARD' };
// The tyre card's two lines: what the next stop fits, and a confirmation once something is chosen or fitted
export function cardText({ compound, next, fitted }) {
    const n = next ? `NEXT: ${next}` : `NEXT: ${nextHarder(compound)} (auto)`;
    const confirm = fitted ? `✓ ${NAMES[compound]} FITTED` : next ? `✓ ${NAMES[next]} ON NEXT STOP` : null;
    return { next: n, confirm };
}
