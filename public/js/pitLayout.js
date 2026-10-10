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

// Around a car parked on its box: wheel men at the corners, jacks fore and aft, the lollipop ahead of the nose
const CREW = [['wheelFL', 1.8, 1.6], ['wheelFR', 1.8, -1.6], ['wheelRL', -1.8, 1.6], ['wheelRR', -1.8, -1.6],
    ['jackF', 3.6, 0], ['jackR', -3.6, 0], ['lollipop', 4.6, 0]];
export function crewSpots(box, scale) {
    return CREW.map(([role, a, l]) => {
        const p = side(ahead(box, box.angle, a * scale), box.angle, l * scale);
        return { role, x: p.x, y: p.y, angle: Math.atan2(box.y - p.y, box.x - p.x) }; // facing the car
    });
}

// HUD cue on the way to your box. distM: metres along the lane to the mark (< 0 past it); canStop(m): can the car stop in m
export function boxCue(distM, speedMs, canStop) {
    if (distM > 0.5) {
        if (!canStop(distM + 0.5)) return 'MISSED — GO AROUND';
        return speedMs < 3 || canStop(distM - 3) ? `YOUR BOX ${Math.round(distM)} m` : 'BRAKE';
    }
    return distM < -1 && speedMs > 2 ? 'MISSED — GO AROUND' : null;
}

// When the tyre picker pops out (spec §1)
export function pickerOpen({ spectator, status, inPit, parked, toEntryM, boxDistM }) {
    if (spectator) return false;
    if (status === 'COUNTDOWN') return true;
    if (status === 'QUALIFYING') return !!(inPit && parked);
    if (status !== 'RACE') return false;
    if (inPit) return boxDistM !== null && boxDistM > -1;
    return toEntryM >= 0 && toEntryM <= ENTRY_PICK_M;
}
