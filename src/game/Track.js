const fs = require('fs');
const path = require('path');
const Physics = require('./Physics');
const Assist = require('./Assist');
const RacingLine = require('./RacingLine');
const Elevation = require('../../public/js/sim/elevation.js'); // shared with the browser

const TRACK_IDS = ['monza', 'spa', 'silverstone', 'suzuka', 'sakhir', 'interlagos', 'cota', 'zandvoort', 'spielberg', 'montreal', 'hungaroring', 'monaco', 'imola', 'buddh'];
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'tracks');
const CHECKPOINT_COUNT = 16;
const GRID_SLOTS = 22; // 11 teams x 2 drivers
const GRID_GAP_M = 8;  // metres between consecutive (staggered) grid slots
const BuildData = require('../../public/js/sim/build.js'); // shared with the browser
const Walls = require('../../public/js/sim/walls.js');
const BARRIER_FAR_M = 400; // barrierR / barrierL: no wall within this, square to the road, counts as this far
const CP_RADIUS_MAX_M = 120; // a checkpoint reaches past the barriers beside it (escape roads), but no further than this
// 2022 constructors' order, then the Suzuka special in its own garage
const GARAGE_ORDER = ['redbull', 'ferrari', 'mercedes', 'alpine', 'mclaren', 'alfaromeo', 'astonmartin', 'haas', 'alphatauri', 'williams', 'redbull-suzuka'];
const GARAGE_PITCH_M = 18;
const BOX_GAP_M = 9;
const PIT_CLEAR_M = 0;          // the lane's edge may meet the real road edge (the apron between them is drawn as asphalt)
const CONNECTOR_R_M = 50;       // entry / exit curves no tighter than this (real lanes leave the road gently: 30 m trapped hot entries)
const TAPER_MAX_M = 60;         // a mouth reaches full lane width within this
const MOUTH_STEP_M = 5, MOUTH_MAX_M = 300; // mouths tried further from the garages until a connector fits
const PIT_STEP_M = 4;           // spacing of the rebuilt lane's points
const PIT_SNAP_M = 0.5;         // lane points this little short of the wall room are moved out to it (see buildPit)
const PIT_SMOOTH_PASSES = 400, PIT_SMOOTH_MAX_M = 3, PIT_KINK_DEG = 4; // smoothing the surveyed lane

// cum[i] = distance along the loop to path[i]; cum[n] = full lap length
function cumulative(pts) {
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
        const a = pts[i - 1], b = pts[i % pts.length];
        cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return cum;
}

// Point and heading at distance s along the path (closed: wraps; open: clamps to the ends)
function pointAt(pts, cum, s, closed = true) {
    const total = closed ? cum[pts.length] : cum[pts.length - 1];
    s = closed ? ((s % total) + total) % total : Math.max(0, Math.min(s, total));
    let i = 0;
    while (cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

// The survey centrelines zig-zag by a metre or so over 20-30 m in places (COTA T1 and T11, Imola's start, Monaco's
// Portier, Spielberg T3): on the wide road the edges swing with every kink, and the cars' steering with them. Taubin
// smoothing (a low-pass that doesn't shrink the loop) takes those out and leaves every corner where it is (under 2 m
// moved, mostly under 1). Points move square to the road only, so the per-point edges and heights still line up, and
// the passes scale with 1/spacing² so the smoothing reaches as many metres on Monaco's 5 m points as on the 10 m ones
const FAIR_PASSES_10M = 5, FAIR_LAMBDA = 0.5, FAIR_MU = -0.53;
function fair(path, scale) {
    const n = path.length, passes = Math.round(FAIR_PASSES_10M * ((10 * scale * n) / cumulative(path)[n]) ** 2);
    let P = path;
    const pass = (f) => {
        P = P.map((b, i) => {
            const a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
            const la = Math.hypot(b.x - a.x, b.y - a.y) || 1, lc = Math.hypot(c.x - b.x, c.y - b.y) || 1, l = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            // toward the chord a-c where the spacing puts b (uneven points aren't pulled sideways), square to the chord
            const mx = (a.x * lc + c.x * la) / (la + lc), my = (a.y * lc + c.y * la) / (la + lc), nx = -(c.y - a.y) / l, ny = (c.x - a.x) / l;
            const d = f * ((mx - b.x) * nx + (my - b.y) * ny);
            return { x: b.x + d * nx, y: b.y + d * ny };
        });
    };
    for (let k = 0; k < passes; k++) { pass(FAIR_LAMBDA); pass(FAIR_MU); }
    return P;
}

const along = (cum, n) => cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]);

// The real track edge (white line, world units from the centreline) beside point (x, y), on its side of the road.
// near: Physics.nearestOnTrack(x, y, t). Track limits are judged here; the road beyond is asphalt run-off.
function edgeAt(t, near, x, y) {
    const P = t.path, n = P.length, a = P[near.i], b = P[(near.i + 1) % n];
    const right = -(b.y - a.y) * (x - near.px) + (b.x - a.x) * (y - near.py) > 0; // right = clockwise of the heading (y down)
    const e = right ? t.edgeR : t.edgeL;
    return e[near.i] + (e[(near.i + 1) % n] - e[near.i]) * near.t;
}
// Offset sideways along L = (-sin a, cos a)
const lateral = (p, off) => ({ x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off, angle: p.angle });

// Cubic Bézier a→d with handles b, c, sampled every `step` world units (by arc length, approximately)
function bezier(a, b, c, d, step) {
    const at = (u) => { const v = 1 - u; return { x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x, y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y }; };
    const fine = Array.from({ length: 201 }, (_, k) => at(k / 200)), out = [fine[0]];
    let acc = 0;
    for (let k = 1; k < fine.length; k++) {
        acc += Math.hypot(fine[k].x - fine[k - 1].x, fine[k].y - fine[k - 1].y);
        if (acc >= step) { out.push(fine[k]); acc = 0; }
    }
    // the end itself, not a sliver after the last sample (a few cm of segment: its heading is noise, a kink)
    if (out.length > 1 && Math.hypot(fine.at(-1).x - out.at(-1).x, fine.at(-1).y - out.at(-1).y) < step / 2) out.pop();
    if (out.at(-1) !== fine.at(-1)) out.push(fine.at(-1));
    return out;
}
// Smallest circumradius over every point and its neighbours two away
function minRadius(P) {
    let r = Infinity;
    for (let i = 2; i + 2 < P.length; i++) {
        const a = P[i - 2], b = P[i], c = P[i + 2];
        const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
        const cr = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        if (cr) r = Math.min(r, (ab * bc * ca) / (2 * cr));
    }
    return r;
}

// The real road edge on one side (+1 right, -1 left) at lap distance s
function edgeAtS(t, s, side) {
    const n = t.path.length, total = t.cum[n]; s = ((s % total) + total) % total;
    let i = 0; while (t.cum[i + 1] < s) i++;
    const e = side > 0 ? t.edgeR : t.edgeL, f = (s - t.cum[i]) / (t.cum[i + 1] - t.cum[i] || 1);
    return e[i] + (e[(i + 1) % n] - e[i]) * f;
}

// Relax the interior toward its neighbours' midpoint (never more than maxM from where it was) until no step
// turns more than PIT_KINK_DEG beyond the mean of the steps either side: the joints between OSM ways stop jerking, while a
// real tight bend (Spa's lane round the inside of La Source) keeps its shape. The first and last `hold` points stay
function smoothLane(P, scale, hold, maxM) {
    const orig = P.map((p) => ({ ...p })), out = P.map((p) => ({ ...p })), max = maxM * scale;
    const worst = () => {
        const turn = []; for (let i = 1; i + 1 < out.length; i++) { const a = Math.atan2(out[i].y - out[i - 1].y, out[i].x - out[i - 1].x), b = Math.atan2(out[i + 1].y - out[i].y, out[i + 1].x - out[i].x); turn.push(Math.atan2(Math.sin(b - a), Math.cos(b - a))); }
        let w = 0; for (let i = 1; i + 1 < turn.length; i++) w = Math.max(w, Math.abs(turn[i] - (turn[i - 1] + turn[i + 1]) / 2));
        return (w * 180) / Math.PI;
    };
    for (let k = 0; k < PIT_SMOOTH_PASSES && worst() > PIT_KINK_DEG; k++) {
        for (let i = hold; i < out.length - hold; i++) {
            const a = out[i - 1], b = out[i + 1], o = orig[i];
            let x = (out[i].x + (a.x + b.x) / 2) / 2, y = (out[i].y + (a.y + b.y) / 2) / 2;
            const d = Math.hypot(x - o.x, y - o.y);
            if (d > max) { x = o.x + ((x - o.x) * max) / d; y = o.y + ((y - o.y) * max) / d; }
            out[i] = { x, y };
        }
    }
    return out;
}

function buildPit(raw, circuit, track) {
    const { scale } = raw, full = raw.pit.width, room = full / 2 + PIT_CLEAR_M * scale;
    const total = track.cum[track.path.length];
    const trackS = (p) => along(track.cum, Physics.nearestOnPath(p.x, p.y, track.path));
    const clear = (p) => { const n = Physics.nearestOnTrack(p.x, p.y, track); return n.dist - edgeAt(track, n, p.x, p.y); }; // from the real road edge
    // scripts/import-pits.js put the lanes exactly the wall room off the road as it smoothed it; this road (fair()) leaves
    // stretches a few cm (Monaco: 43 cm) short. Those points move out to the wall room, square to the road; real dips
    // (Zandvoort's lane passing another leg, Buddh's the last apex) stay where they are and break the garage lane
    const lane = smoothLane(raw.pit.path, scale, 1, PIT_SMOOTH_MAX_M).map((p) => { // the surveyed lane's own joints smoothed first: connectors meet a smooth lane
        const n = Physics.nearestOnTrack(p.x, p.y, track), c = n.dist - edgeAt(track, n, p.x, p.y);
        if (c >= room || c < room - PIT_SNAP_M * scale) return p;
        const k = (room - c) / n.dist;
        return { x: p.x + (p.x - n.px) * k, y: p.y + (p.y - n.py) * k };
    });
    const rawCum = cumulative(lane);

    // The garage lane: the longest run of the surveyed lane at full width with room for the wall
    const ok = lane.map((p) => clear(p) >= room - 1e-9);
    let a = 0, b = -1;
    for (let i = 0, from = 0; i < lane.length; i++) {
        if (!ok[i]) { from = i + 1; continue; }
        if (i - from > b - a) { a = from; b = i; }
    }
    if (b <= a) throw new Error(`${raw.id}: no stretch of pit lane clear of the road`);
    const mid = lane[(a + b) >> 1], mn = Physics.nearestOnPath(mid.x, mid.y, track.path), mp = pointAt(track.path, track.cum, along(track.cum, mn));
    const laneSide = Math.sign(-Math.sin(mp.angle) * (mid.x - mp.x) + Math.cos(mp.angle) * (mid.y - mp.y)) || 1; // lateral() sign of the lane

    // A connector from the road edge at lap distance s (tangent to the road) to lane point k (tangent to the lane)
    const connector = (s, k, entry, step = PIT_STEP_M * scale) => {
        // tangent to the road there: its direction over ±4 m (a 10 m chord's own direction is off by half its turn)
        const b0 = pointAt(track.path, track.cum, s - 4 * scale), b1 = pointAt(track.path, track.cum, s + 4 * scale), on = pointAt(track.path, track.cum, s);
        const e = lateral({ ...on, angle: Math.atan2(b1.y - b0.y, b1.x - b0.x) }, laneSide * edgeAtS(track, s, laneSide)), ed = { x: Math.cos(e.angle), y: Math.sin(e.angle) };
        // along the lane segment it joins (entry: the one after k, exit: the one before), so the joint has no kink
        const nb = entry ? lane[Math.min(lane.length - 1, k + 1)] : lane[Math.max(0, k - 1)], q = lane[k];
        const ql = Math.hypot(nb.x - q.x, nb.y - q.y) || 1, qd = entry ? { x: (nb.x - q.x) / ql, y: (nb.y - q.y) / ql } : { x: (q.x - nb.x) / ql, y: (q.y - nb.y) / ql };
        const h = 0.4 * Math.hypot(q.x - e.x, q.y - e.y);
        return entry ? bezier(e, { x: e.x + ed.x * h, y: e.y + ed.y * h }, { x: q.x - qd.x * h, y: q.y - qd.y * h }, q, step)
            : bezier(q, { x: q.x + qd.x * h, y: q.y + qd.y * h }, { x: e.x - ed.x * h, y: e.y - ed.y * h }, e, step);
    };
    // Fits: never on the road, full width within TAPER_MAX_M of the mouth
    const fits = (C, entry) => {
        let dist = 0, opened = false;
        const seq = entry ? C : [...C].reverse();
        for (let i = 0; i < seq.length; i++) {
            if (i) dist += Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y);
            const c = clear(seq[i]);
            if (c < -0.01 * scale) return false;
            if (c >= room - 1e-9) opened = true;
            else if (opened) return false;              // once open it stays open
            if (!opened && dist > TAPER_MAX_M * scale) return false;
        }
        return opened;
    };
    // From beside the garage lane's end, away from the garages: the surveyed lanes run 50-100 m alongside the road before
    // they clear it, too far for a TAPER_MAX_M taper from their real branch-off. Where none fits there, the connector joins
    // the lane further in (Monaco's and Montreal's lanes leave the road at a hairpin / chicane, too sharply to meet sooner)
    const mouth = (k0, entry) => {
        const max = circuit.pitMouthMaxM ?? MOUTH_MAX_M;
        for (let k = k0; entry ? k < b : k > a; k += entry ? 1 : -1) {
            const s0 = trackS(lane[k]);
            for (let m = 0; m <= max; m += MOUTH_STEP_M) {
                const s = (((s0 + (entry ? -m : m) * scale) % total) + total) % total, C = connector(s, k, entry);
                // smooth enough: judged on every Bézier sample (step 0), so a short connector's kink can't hide between 4 m points
                if (minRadius(connector(s, k, entry, 0)) >= CONNECTOR_R_M * scale && fits(C, entry)) return { s, C, m, k };
            }
        }
        throw new Error(`${raw.id}: no pit ${entry ? 'entry' : 'exit'} connector fits`);
    };
    const en = mouth(a, true), ex = mouth(b, false);
    // A light last pass (≤ 1 m) evens the curvature where a connector meets the lane; the two points at each tip stay, so
    // each mouth keeps its place on the road edge and its tangent
    const pts = smoothLane([...en.C, ...lane.slice(en.k + 1, ex.k), ...ex.C].map(({ x, y }) => ({ x, y })), scale, 2, 1);
    const cum = cumulative(pts), len = cum[pts.length - 1];
    // Full width where the wall fits beside it, narrowing in step with the gap to the road edge toward each mouth
    const widthAt = pts.map((p) => { const c = clear(p); return c >= room - 1e-9 ? full : Math.max(0, (full * c) / room); });
    widthAt[0] = 0; widthAt[pts.length - 1] = 0;
    const entryS = en.s, exitS = ex.s, span = (((exitS - entryS) % total) + total) % total;
    const onPit = (rawM) => { const p = pointAt(lane, rawCum, rawM * scale, false); return along(cum, Physics.nearestOnPath(p.x, p.y, pts, false)); };

    const startOnPit = along(cum, Physics.nearestOnPath(track.start.x, track.start.y, pts, false));
    const sp = pointAt(pts, cum, startOnPit, false);
    const trackSide = Math.sign(-Math.sin(sp.angle) * (track.start.x - sp.x) + Math.cos(sp.angle) * (track.start.y - sp.y)) || 1;

    // Pit wall: the track-side edge of the full-width lane, one polyline
    const isFull = (i) => widthAt[i] >= full - 1e-6;
    const w0 = widthAt.findIndex((_, i) => isFull(i)), w1 = widthAt.length - 1 - [...widthAt].reverse().findIndex((_, i) => isFull(widthAt.length - 1 - i));
    const wall = [];
    for (let i = w0; i <= w1; i++) { const w = lateral(pointAt(pts, cum, cum[i], false), trackSide * full / 2); wall.push({ x: w.x, y: w.y }); }

    // Limiter: circuits.json metres along the surveyed lane, onto the rebuilt one, inside the walled stretch (the pit assist
    // brakes for it before it starts)
    const limStart = Math.max(cum[w0], onPit(circuit.limiterStartM ?? 0));
    const limEnd = Math.min(cum[w1], circuit.limiterEndM != null ? onPit(circuit.limiterEndM) : cum[w1]);

    // Garages centred on the start line (slid to stay inside the limiter zone), garage 1 nearest the exit unless garagesFrom: "entry"
    const dir = circuit.garagesFrom === 'entry' ? -1 : 1, pitch = GARAGE_PITCH_M * scale, reach = 5.5 * pitch, margin = reach + 5 * scale;
    const centre = Math.max(limStart + margin, Math.min(startOnPit, limEnd - margin)); // limiter zone: inside the wall
    const garages = GARAGE_ORDER.map((teamId, k) => {
        const s = centre + dir * (5 - k) * pitch, c = pointAt(pts, cum, s, false);
        const boxes = [-1, 1].map((d) => { const bs = s + (d * BOX_GAP_M * scale) / 2; return { ...lateral(pointAt(pts, cum, bs, false), (-trackSide * full / 2) / 2), s: bs }; });
        return { teamId, s, x: c.x, y: c.y, angle: c.angle, boxes };
    });
    // Each mouth: where it leaves (rejoins) the road, on which side, and the lane's angle to the road 20 m in
    const mouthOf = (s, at) => {
        const q = pointAt(pts, cum, at, false), r = pointAt(track.path, track.cum, trackS(q));
        return { s, side: laneSide, angleDeg: +((Math.abs(Math.atan2(Math.sin(q.angle - r.angle), Math.cos(q.angle - r.angle))) * 180) / Math.PI).toFixed(1) };
    };
    const mouths = { entry: mouthOf(en.s, 20 * scale), exit: mouthOf(ex.s, len - 20 * scale) };
    return { path: pts, width: full, widthAt, cum, len, entryS, exitS, span, startOnPit, trackSide, limStart, limEnd, wall, garages, mouths,
        garageSpan: [centre - reach, centre + reach], fitM: raw.pit.fitM, limitKmh: circuit.pitLimitKmh || null };
}

// Where the track crosses itself at two heights (Suzuka's figure-8): a bridge. The upper road runs over a deck between
// parapets; the lower one passes between two walls beneath it. Each wall stops only the cars on its own level
// (drive.js: the road a car is on comes from its heading). Walls: { i (a centreline point of that road), a, b }
const BRIDGE_MARGIN_M = 1; // deck and walls this far beyond the drawn road edges
const CUTTING_M = 30;       // the underpass walls carry on this far past the deck: the lower road's cutting
function buildBridges(t) {
    const P = t.path, n = P.length, half = t.width / 2, m = BRIDGE_MARGIN_M * t.scale, bridges = [];
    for (let i = 0; i < n; i++) for (let j = i + 3; j < n - (i === 0 ? 1 : 0); j++) {
        const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n], r = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (!r) continue;
        const u = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / r, v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / r;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const road = (k, f) => ({ i: k, angle: Math.atan2(P[(k + 1) % n].y - P[k].y, P[(k + 1) % n].x - P[k].x), h: t.z ? t.z[k] + (t.z[(k + 1) % n] - t.z[k]) * f : 0 });
        const ri = road(i, u), rj = road(j, v);
        ri.s = t.cum[i] + u * (t.cum[i + 1] - t.cum[i]); rj.s = t.cum[j] + v * (t.cum[j + 1] - t.cum[j]); // lap distance at the crossing
        const [upper, lower] = ri.h >= rj.h ? [ri, rj] : [rj, ri];
        const sin = Math.max(0.3, Math.abs(Math.sin(upper.angle - lower.angle)));
        const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
        const span = (2 * (half + 2 * m)) / sin, under = (2 * (half + m)) / sin + 2 * CUTTING_M * t.scale; // deck length; walled cutting
        // The road every 5 m along `len` centred on the crossing: { x, y, angle, h (m) }; the deck, the cutting and their
        // walls all follow these, so they curve and slope with the real roads
        const total = t.cum[n];
        const along = (rd, len) => {
            const out = [], step = 5 * t.scale, k = Math.ceil(len / 2 / step);
            for (let q = -k; q <= k; q++) {
                const s = rd.s + (q * len) / (2 * k), p = pointAt(P, t.cum, s), w = ((s % total) + total) % total;
                // direction from a few metres either side, not the segment's own: at a segment joint two points would
                // face different ways, and the walls offset from them stepped sideways (a face standing out of the wall)
                const a = pointAt(P, t.cum, s - 4 * t.scale), b = pointAt(P, t.cum, s + 4 * t.scale);
                p.angle = Math.atan2(b.y - a.y, b.x - a.x);
                let e = 0; while (t.cum[e + 1] < w) e++;
                const f = (w - t.cum[e]) / (t.cum[e + 1] - t.cum[e] || 1);
                out.push({ x: p.x, y: p.y, angle: p.angle, h: t.z ? t.z[e] + (t.z[(e + 1) % n] - t.z[e]) * f : 0 });
            }
            return out;
        };
        const cut = along(lower, under);
        const edge = (line, side) => line.map((p) => ({ x: p.x - Math.sin(p.angle) * side * (half + m), y: p.y + Math.cos(p.angle) * side * (half + m) }));
        // A skew deck, as the roads cross at an angle: a parallelogram whose sides are the upper road's edges and whose
        // ends rest on the cutting walls (outer faces, 1 m thick), so it sits on them however steep the crossing
        const dir = (a) => ({ x: Math.cos(a), y: Math.sin(a) }), nrm = (a) => ({ x: -Math.sin(a), y: Math.cos(a) });
        const meet = (p, d, q, e) => { const k = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / (d.x * e.y - d.y * e.x); return { x: p.x + d.x * k, y: p.y + d.y * k }; };
        const corner = (su, sl) => {
            const nu = nrm(upper.angle), nl = nrm(lower.angle), eu = half + m, el = half + 2 * m;
            return meet({ x: x + nu.x * su * eu, y: y + nu.y * su * eu }, dir(upper.angle), { x: x + nl.x * sl * el, y: y + nl.y * sl * el }, dir(lower.angle));
        };
        const corners = [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
        bridges.push({ x, y, upper, lower, span, under, cut, corners,
            walls: [{ i: upper.i, pts: [corners[0], corners[1]] }, { i: upper.i, pts: [corners[3], corners[2]] }, // parapets
                { i: lower.i, pts: edge(cut, 1) }, { i: lower.i, pts: edge(cut, -1) }] });                         // cutting walls
    }
    return bridges;
}

const OPEN_APART_M = 60; // buildMedians: legs this far apart along the lap
const lapGap = (t, a, b) => { const total = t.cum[t.path.length], d = Math.abs(t.cum[a] - t.cum[b]); return Math.min(d, total - d); };
const nearBridge = (t, i) => (t.bridges || []).some((b) => [b.lower.s, b.upper.s].some((s) => {
    const total = t.cum[t.path.length], d = Math.abs(t.cum[i] - s);
    return Math.min(d, total - d) < b.under / 2 + 40 * t.scale;
}));

// Where two legs of the track, far apart along the lap, run closer than their two roads and a strip of run-off (the
// way into Monaco's Fairmont hairpin and the way out, 14 m apart), their asphalt would run together into one: a barrier
// stands midway between them instead, as on the island there, each road ending at it. Polylines of { x, y, lo, hi }:
// lo / hi the heights (m) of the lower and upper of the two roads beside it, so it stands as a retaining wall where they
// differ (the Fairmont's two legs: 6-12 m). drive.js stops cars at them, game3d.js draws them; none at a bridge (its
// levels are walled apart)
const MEDIAN_RUNOFF_M = 1.5;
function buildMedians(t) {
    const P = t.path, n = P.length, apart = OPEN_APART_M * t.scale;
    const close = t.width + 2 * MEDIAN_RUNOFF_M * t.scale;
    const mid = P.map((p, i) => {
        if (nearBridge(t, i)) return null;
        let best = null;
        for (let j = 0; j < n; j++) {
            if (lapGap(t, i, j) <= apart) continue;
            const a = P[j], b = P[(j + 1) % n], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
            const u = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0, x = a.x + u * ex, y = a.y + u * ey;
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < close && (!best || d < best.d)) best = { d, j, u, x, y };
        }
        // the leg met first in the lap carries the barrier (the other one would draw the same line back)
        if (!best || best.j < i) return null;
        const za = t.z ? t.z[i] : 0, zb = t.z ? t.z[best.j] + (t.z[(best.j + 1) % n] - t.z[best.j]) * best.u : 0;
        return { x: (p.x + best.x) / 2, y: (p.y + best.y) / 2, lo: Math.min(za, zb), hi: Math.max(za, zb) };
    });
    const medians = [];
    let run = [];
    for (let i = 0; i <= n; i++) {
        const m = i < n ? mid[i] : null;
        if (m) run.push(m);
        else { if (run.length > 1) medians.push(run); run = []; }
    }
    return medians;
}

function build(raw, circuit = {}) {
    const { width, scale } = raw, pts = fair(raw.path, scale);
    const cum = cumulative(pts);
    const total = cum[pts.length];
    // circuits.json and the tunnels measure metres along the survey's own points: the same spots on the smoothed lap
    const rawCum = cumulative(raw.path), rawTotal = rawCum[pts.length];
    const onLap = (m) => { // metres from point 0 → world units along pts
        const s = (((m * scale) % rawTotal) + rawTotal) % rawTotal;
        let i = 0; while (rawCum[i + 1] < s) i++;
        return cum[i] + ((s - rawCum[i]) / (rawCum[i + 1] - rawCum[i] || 1)) * (cum[i + 1] - cum[i]);
    };
    const startS = onLap(circuit.startLineM || 0);
    const fromStart = (m) => (((onLap((circuit.startLineM || 0) + m) - startS) % total) + total) % total; // metres past the start line
    const start = pointAt(pts, cum, startS);

    // Checkpoints: the start line and both sector lines are checkpoints, the rest evenly spaced per sector
    const bounds = [
        0,
        circuit.sector2M != null ? fromStart(circuit.sector2M) : total / 3,
        circuit.sector3M != null ? fromStart(circuit.sector3M) : (2 * total) / 3,
        total,
    ];
    const checkpoints = [], sectorCps = [];
    for (let k = 0; k < 3; k++) {
        const len = bounds[k + 1] - bounds[k];
        const count = Math.max(3, Math.round((CHECKPOINT_COUNT * len) / total));
        sectorCps.push(checkpoints.length);
        for (let j = 0; j < count; j++) {
            const p = pointAt(pts, cum, startS + bounds[k] + (j * len) / count);
            checkpoints.push({ x: p.x, y: p.y, radius: 0, s: bounds[k] + (j * len) / count }); // s: lap distance; radius once the walls are known
        }
    }

    // Staggered two-column grid behind the start line, or behind a separate grid line where the circuit has one
    // (gridLineM metres past the timing line: Monza, Suzuka); -1 = driver's left (y points down the screen)
    const gridS = startS + fromStart(circuit.gridLineM || 0);
    // White lines per point: the real edges (the survey's), right and left of the driver: the track limits
    const edge = (k) => pts.map((_, i) => (raw.edges ? raw.edges[i][k] * scale : width / 2)); // no survey: half the width
    const edgeR = edge(0), edgeL = edge(1);
    const edgeOf = (s, side) => { // at lap distance s; side +1 right, -1 left
        const total = cum[pts.length]; s = ((s % total) + total) % total;
        let i = 0; while (cum[i + 1] < s) i++;
        const e = side > 0 ? edgeR : edgeL, f = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
        return e[i] + (e[(i + 1) % pts.length] - e[i]) * f;
    };
    const gridLine = circuit.gridLineM ? pointAt(pts, cum, gridS) : null; // the painted start line, ahead of pole
    const pole = circuit.poleSide === 'right' ? 1 : -1;
    const startPositions = [];
    for (let i = 0; i < GRID_SLOTS; i++) {
        const p = pointAt(pts, cum, gridS - (i + 1) * GRID_GAP_M * scale);
        const side = i % 2 === 0 ? pole : -pole, s = gridS - (i + 1) * GRID_GAP_M * scale;
        startPositions.push(lateral(p, side * (edgeOf(s, side) / 2))); // centre of the real lane on that side
    }

    // DRS zones as lap distances from the start line (world units)
    const drsZones = (circuit.drs || []).map(([d, a, b]) => ({ detectS: fromStart(d), startS: fromStart(a), endS: fromStart(b) }));

    // z: real elevation per path point (metres above the lowest point); grade / vcurv: slope and crest / compression for
    // the car physics (public/js/sim/elevation.js)
    const shape = raw.z ? Elevation.profile(raw.z, cum, scale) : { grade: null, vcurv: null };
    const tunnels = (raw.tunnels || []).map(([a, b]) => [onLap(a), onLap(b)]); // lap distances from point 0 (Monaco)
    const track = { id: raw.id, name: raw.name, scale, width, tunnels, edgeR, edgeL, gridLine, path: pts, z: raw.z || null, grade: shape.grade, vcurv: shape.vcurv, cum, start, startS, drsZones, checkpoints, sectorCps, startPositions, safeSpeed: Assist.safeSpeeds(pts, scale, shape.vcurv), pit: null };
    if (raw.pit) track.pit = buildPit(raw, circuit, track);
    track.bridges = buildBridges(track);
    track.medians = buildMedians(track);
    // As built (data/tracks/<id>.build.json, else today's barrier rule generated): world units, sent with the track
    const file = path.join(DATA_DIR, `${raw.id}.build.json`);
    track.build = BuildData.toWorld(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : BuildData.defaultBuild(track, circuit.barrierM), scale);
    track.walls = [...track.build.barriers, ...track.medians.map((m) => ({ kind: 'concrete', h: 1, fence: 3, pts: m.map(({ x, y }) => ({ x, y })), src: 'median' }))];
    // Per point: how far the barrier stands square to the road each side, and the kerb's width there (0: none)
    const index = Walls.wallIndex(track.walls, scale), n = pts.length, far = BARRIER_FAR_M * scale;
    const normal = (i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return [-(b.y - a.y) / l, (b.x - a.x) / l]; }; // + = right
    track.barrierR = pts.map((p, i) => { const [nx, ny] = normal(i); return Math.min(far, Walls.rayToWall(index, p.x, p.y, nx, ny, far)); });
    track.barrierL = pts.map((p, i) => { const [nx, ny] = normal(i); return Math.min(far, Walls.rayToWall(index, p.x, p.y, -nx, -ny, far)); });
    const lap = pts.map((_, i) => ((((cum[i] - startS) % total) + total) % total) / scale); // metres past the start line
    const kerb = (side) => lap.map((m) => {
        const k = track.build.kerbs.find((q) => q.side === side && (q.fromM <= q.toM ? m >= q.fromM && m < q.toM : m >= q.fromM || m < q.toM));
        return k ? k.w * scale : 0;
    });
    track.kerbR = kerb('R'); track.kerbL = kerb('L');
    for (const cp of checkpoints) {
        const i = Physics.nearestOnTrack(cp.x, cp.y, track).i;
        cp.radius = Math.min(CP_RADIUS_MAX_M * scale, Math.max(track.barrierR[i], track.barrierL[i]) + 10 * scale);
    }
    const { limit: lineLimit, ...line } = RacingLine.compute(track);
    track.racingLine = line;  // visual guide, sent to clients in game_init
    track.lineLimit = lineLimit;  // braking help's corner speeds (shared sim, sent with the track)
    return track;
}

function load(id) {
    const file = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing track data ${file}. Run: npm run tracks`);
    const circuits = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'circuits.json'), 'utf8'));
    return build(JSON.parse(fs.readFileSync(file, 'utf8')), circuits[id]);
}

function loadAll() {
    const tracks = {};
    for (const id of TRACK_IDS) tracks[id] = load(id);
    return tracks;
}

module.exports = { TRACK_IDS, GARAGE_ORDER, load, loadAll, build, pointAt, edgeAt, fair };
