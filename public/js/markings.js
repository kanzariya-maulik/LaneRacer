// FIA trackside markings from the circuit's build data (features) and its pit lane, as plain shapes (no three.js:
// game3d.js draws them, the node tests check them). Monza 2026 (docs/superpowers/specs/2026-10-26-monza-markings-and-rules-design.md):
// the blue pit entry gore and its yellow bollard, SC1 / SC2 across the pit lane, the T1 escape road's polystyrene blocks,
// the T4 yellow line and bollard, the black and yellow bumps before the T5 apex.
// paint: { feature, poly: [{ x, y }] (world units, flat on the ground), paint: [colour] }
// solids: { feature, x, y, angle, len, w, h (metres), color }: a box standing on the ground
import Physics from './sim/physics.js';

const LINE_M = 0.3;          // SC lines across the pit lane
const YELLOW_LINE_M = 0.15;  // the T4 run-off's yellow line
const BLOCK_ROW_GAP_M = 12;  // polystyrene block rows along the escape road, each over 60 % of its width, alternating sides
const BLOCK_ROAD_MIN_M = 4;  // the rows start where the escape road is this wide
const SC2_MIN_W_M = 3;       // SC2: the last point of the exit road this wide (the exit line ends there)

export function markings(t) {
    const out = { paint: [], solids: [] };
    const features = t.build?.features || [];
    if (!features.length) return out;
    const sc = t.scale, P = t.path, n = P.length, total = t.cum[n];
    // Lap metres → the centreline there: point, heading, and the white line's offset on a side (R +1, L -1)
    const at = (m) => {
        const s = (((t.startS + m * sc) % total) + total) % total;
        let i = 0; while (t.cum[i + 1] < s) i++;
        const a = P[i], b = P[(i + 1) % n], f = (s - t.cum[i]) / (t.cum[i + 1] - t.cum[i] || 1), h = Math.atan2(b.y - a.y, b.x - a.x);
        const edge = (side) => { const e = side > 0 ? t.edgeR : t.edgeL; return e[i] + (e[(i + 1) % n] - e[i]) * f; };
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, h, edge };
    };
    const side = (q, sd, offM) => ({ x: q.x - Math.sin(q.h) * sd * offM * sc, y: q.y + Math.cos(q.h) * sd * offM * sc }); // off the centreline
    const sideOf = (f) => (f.side === 'L' ? -1 : 1);
    const pit = t.pit;
    // A pit lane point: along s, `l` metres to the lane's track side (pit.trackSide: the (-sin, cos) side the track is on)
    const lanePt = (i, l) => {
        const A = pit.path[Math.max(0, i - 1)], B = pit.path[Math.min(pit.path.length - 1, i + 1)], h = Math.atan2(B.y - A.y, B.x - A.x), q = pit.path[i];
        return { x: q.x - Math.sin(h) * pit.trackSide * l * sc, y: q.y + Math.cos(h) * pit.trackSide * l * sc, h };
    };
    const across = (i, feature) => { // a line across the pit lane at point i, its full width
        const w = pit.widthAt[i] / sc / 2, a = lanePt(i, -w), b = lanePt(i, w), dx = Math.cos(a.h) * (LINE_M / 2) * sc, dy = Math.sin(a.h) * (LINE_M / 2) * sc;
        out.paint.push({ feature, paint: ['#f2f2f2'], poly: [{ x: a.x - dx, y: a.y - dy }, { x: b.x - dx, y: b.y - dy }, { x: b.x + dx, y: b.y + dy }, { x: a.x + dx, y: a.y + dy }] });
    };
    for (const f of features) {
        if (f.type === 'gore' && pit?.gore) {
            // between the lane's track-side edge and the track's white line, from where they part to the start of the pit wall
            const lane = [], road = [];
            pit.cum.forEach((c, i) => {
                if (c < pit.gore.from || c > pit.gore.to) return;
                const e = lanePt(i, pit.widthAt[i] / sc / 2), nn = Physics.nearestOnTrack(e.x, e.y, t), d = Math.hypot(e.x - nn.px, e.y - nn.py) || 1;
                const at2 = P[nn.i], bt = P[(nn.i + 1) % n], right = -(bt.y - at2.y) * (e.x - nn.px) + (bt.x - at2.x) * (e.y - nn.py) > 0;
                const ee = (right ? t.edgeR : t.edgeL), edge = ee[nn.i] + (ee[(nn.i + 1) % n] - ee[nn.i]) * nn.t;
                lane.push({ x: e.x, y: e.y }); road.push({ x: nn.px + ((e.x - nn.px) / d) * edge, y: nn.py + ((e.y - nn.py) / d) * edge });
            });
            if (lane.length >= 3) out.paint.push({ feature: 'gore', paint: [f.color || '#1e5bd8'], poly: [...lane, ...road.reverse()] });
        } else if (f.type === 'bollard') {
            let q;
            if (f.mouth === 'entry' && pit?.gore) { // just inside the gore's tip
                const g = out.paint.find((p) => p.feature === 'gore'), k = g ? g.poly.length : 0;
                if (k) q = { x: (g.poly[1].x + g.poly[k - 2].x) / 2, y: (g.poly[1].y + g.poly[k - 2].y) / 2 };
            } else if (f.atM != null) { const c = at(f.atM), sd = sideOf(f); q = side(c, sd, c.edge(sd) / sc + (f.offM ?? 1)); }
            if (q) out.solids.push({ feature: 'bollard', ...q, angle: 0, len: 0.3, w: 0.3, h: 1.0, color: f.color || '#facc15' });
        } else if (f.type === 'sc' && pit?.gore) {
            if (f.mouth === 'entry') across(pit.cum.findIndex((c) => c >= pit.gore.from), 'sc1');
            else { let i = pit.path.length - 1; while (i > 0 && pit.widthAt[i] < SC2_MIN_W_M * sc) i--; across(i, 'sc2'); }
        } else if (f.type === 'yellowLine') {
            const sd = sideOf(f), inner = [], outer = [];
            for (let m = f.fromM; m <= f.toM; m += 2) { const c = at(m), o = c.edge(sd) / sc + (f.offM ?? 0); inner.push(side(c, sd, o)); outer.push(side(c, sd, o + YELLOW_LINE_M)); }
            if (inner.length >= 2) out.paint.push({ feature: 'yellowLine', paint: ['#facc15'], poly: [...inner, ...outer.reverse()] }); // fewer: no area to paint
        } else if (f.type === 'bumps') {
            const sd = sideOf(f);
            for (let m = f.fromM, k = 0; m <= f.toM; m += 1, k++) {
                const c = at(m), q = side(c, sd, c.edge(sd) / sc + 0.8);
                out.solids.push({ feature: 'bumps', ...q, angle: c.h, len: 0.8, w: 0.6, h: 0.12, color: k % 2 ? '#111111' : '#facc15' });
            }
        } else if (f.type === 'blocks') {
            // On the escape road (the build's asphalt run-off beside atM): each row across its width, staggered so cars weave
            const asphalt = (t.build.surfaces || []).filter((s) => s.kind === 'asphalt');
            const inside = (q) => asphalt.some((s) => inPoly(s.poly, q));
            const spanAt = (c) => { // the widest run of escape road beside this point, either side
                let span = null;
                for (const sd of [1, -1]) {
                    let a = null, b = null;
                    for (let o = c.edge(sd) / sc + 1; o <= c.edge(sd) / sc + 60; o += 0.5) {
                        if (inside(side(c, sd, o))) { if (a === null) a = o; b = o; } else if (a !== null) break;
                    }
                    if (a !== null && (!span || b - a > span.b - span.a)) span = { sd, a, b };
                }
                return span;
            };
            // from where the escape road opens (at least BLOCK_ROAD_MIN_M wide) near atM
            let m0 = f.atM - 30; while (m0 < f.atM + 60 && !((s) => s && s.b - s.a >= BLOCK_ROAD_MIN_M)(spanAt(at(m0)))) m0 += 2;
            for (let k = 0; k < (f.rows || 4); k++) {
                const c = at(m0 + k * BLOCK_ROW_GAP_M), span = spanAt(c);
                if (!span) continue;
                const len = 0.6 * (span.b - span.a), mid = k % 2 ? span.b - len / 2 : span.a + len / 2;
                out.solids.push({ feature: 'blocks', ...side(c, span.sd, mid), angle: c.h + Math.PI / 2, len, w: 1, h: 1, color: '#f4f4f4' });
            }
        }
    }
    return out;
}

function inPoly(P, q) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if ((P[i].y > q.y) !== (P[j].y > q.y) && q.x < ((P[j].x - P[i].x) * (q.y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) c = !c;
    }
    return c;
}
