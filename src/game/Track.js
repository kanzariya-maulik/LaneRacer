const fs = require('fs');
const path = require('path');
const Physics = require('./Physics');
const Assist = require('./Assist');
const RacingLine = require('./RacingLine');

const F1_TRACK_IDS = ['monza', 'spa', 'silverstone', 'suzuka', 'sakhir'];
const DRIFT_TRACK_IDS = ['ebisu', 'longbeach'];
const TRACK_IDS = [...F1_TRACK_IDS, ...DRIFT_TRACK_IDS];
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'tracks');
const CHECKPOINT_COUNT = 16;
const GRID_SLOTS = 20;
const GRID_GAP_M = 8;  // metres between consecutive (staggered) grid slots
const WALL_OFFSET = 80; // matches the invisible wall in Game.js
// 2022 constructors' order, then the Suzuka special in its own garage
const GARAGE_ORDER = ['redbull', 'ferrari', 'mercedes', 'alpine', 'mclaren', 'alfaromeo', 'astonmartin', 'haas', 'alphatauri', 'williams', 'redbull-suzuka'];
const GARAGE_PITCH_M = 18;
const BOX_GAP_M = 9;
const CLOSE_RAMP_M = 60;  // the barrier angles back this far, so a car meeting it glances off onto the track
const PIT_RUNOFF_M = 2;   // matches Game.js
const WALL_CLEAR_M = 0.5; // pit wall only where it stays this far off the track edge

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

const along = (cum, n) => cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]);
// Offset sideways along L = (-sin a, cos a)
const lateral = (p, off) => ({ x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off, angle: p.angle });

function buildPit(raw, circuit, track) {
    const { scale, width } = raw;
    const pts = raw.pit.path, half = raw.pit.width / 2;
    const cum = cumulative(pts), len = cum[pts.length - 1];
    const total = track.cum[track.path.length];
    const trackS = (p) => along(track.cum, Physics.nearestOnPath(p.x, p.y, track.path));
    const entryS = trackS(pts[0]), exitS = trackS(pts.at(-1));
    const span = (((exitS - entryS) % total) + total) % total;

    const startOnPit = along(cum, Physics.nearestOnPath(track.start.x, track.start.y, pts, false));
    const sp = pointAt(pts, cum, startOnPit, false);
    const trackSide = Math.sign(-Math.sin(sp.angle) * (track.start.x - sp.x) + Math.cos(sp.angle) * (track.start.y - sp.y)) || 1;
    const limStart = (circuit.limiterStartM ?? 0) * scale;
    const limEnd = Math.min(len, (circuit.limiterEndM ?? Infinity) * scale);

    // Pit wall: longest run of the track-side edge that clears the track, inside the limiter zone
    let run = [], wall = [], runFrom = 0, wallFrom = 0;
    for (let i = 0; i < pts.length; i++) {
        const w = lateral(pointAt(pts, cum, cum[i], false), trackSide * half);
        const ok = cum[i] >= limStart && cum[i] <= limEnd
            && Physics.nearestOnTrack(w.x, w.y, track).dist >= width / 2 + WALL_CLEAR_M * scale;
        if (ok) { if (!run.length) runFrom = i; run.push({ x: w.x, y: w.y }); } else run = [];
        if (run.length > wall.length) { wall = run; wallFrom = runFrom; }
    }

    // Garages centred on the start line (slid along if needed to stay beside the pit wall),
    // garage 1 nearest the pit exit; boxes in the lane on the garage side
    const pitch = GARAGE_PITCH_M * scale, reach = 5.5 * pitch;
    const wallLo = cum[wallFrom], wallHi = cum[wallFrom + Math.max(0, wall.length - 1)];
    // Limiter only where the pit wall keeps track cars out of the pit lane
    const limLo = Math.max(limStart, wallLo), limHi = Math.min(limEnd, wallHi);
    const margin = reach + 5 * scale;
    const centre = Math.max(wallLo + margin, Math.min(startOnPit, wallHi - margin));
    const garages = GARAGE_ORDER.map((teamId, k) => {
        const s = centre + (5 - k) * pitch;
        const c = pointAt(pts, cum, s, false);
        const boxes = [-1, 1].map((d) => lateral(pointAt(pts, cum, s + (d * BOX_GAP_M * scale) / 2, false), (-trackSide * half) / 2));
        return { teamId, s, x: c.x, y: c.y, angle: c.angle, boxes };
    });
    const garageSpan = [centre - reach, centre + reach];

    // Pit entry closed (no pit stops): angled barrier from the start of the pit wall, so no gap or wedge beside it
    const closeS = wallLo;
    const inner = lateral(pointAt(pts, cum, closeS, false), trackSide * half);
    const up = pointAt(pts, cum, closeS - CLOSE_RAMP_M * scale, false);
    let outerOff = half + PIT_RUNOFF_M * scale;
    // Outer end reaches past the track's run-off barrier, so there is no way round it
    const short = width / 2 + WALL_OFFSET - Physics.nearestOnTrack(lateral(up, -trackSide * outerOff).x, lateral(up, -trackSide * outerOff).y, track).dist;
    if (short > 0) outerOff += short + scale;
    const closeWall = [lateral(up, -trackSide * outerOff), inner].map(({ x, y }) => ({ x, y }));

    return { path: pts, width: raw.pit.width, cum, len, entryS, exitS, span, startOnPit, trackSide, limStart: limLo, limEnd: limHi, wall, garages, garageSpan, closeS, closeWall, fitM: raw.pit.fitM };
}

function build(raw, circuit = {}) {
    const { path: pts, width, scale } = raw;
    const cum = cumulative(pts);
    const total = cum[pts.length];
    const startS = (circuit.startLineM || 0) * scale;
    const start = pointAt(pts, cum, startS);

    // Checkpoints: the start line and both sector lines are checkpoints, the rest evenly spaced per sector
    const bounds = [
        0,
        circuit.sector2M != null ? circuit.sector2M * scale : total / 3,
        circuit.sector3M != null ? circuit.sector3M * scale : (2 * total) / 3,
        total,
    ];
    const checkpoints = [], sectorCps = [];
    for (let k = 0; k < 3; k++) {
        const len = bounds[k + 1] - bounds[k];
        const count = Math.max(3, Math.round((CHECKPOINT_COUNT * len) / total));
        sectorCps.push(checkpoints.length);
        for (let j = 0; j < count; j++) {
            const p = pointAt(pts, cum, startS + bounds[k] + (j * len) / count);
            checkpoints.push({ x: p.x, y: p.y, radius: width / 2 + WALL_OFFSET });
        }
    }

    // Staggered two-column grid behind the start line; -1 = driver's left (y points down the screen)
    const pole = circuit.poleSide === 'right' ? 1 : -1;
    const startPositions = [];
    for (let i = 0; i < GRID_SLOTS; i++) {
        const p = pointAt(pts, cum, startS - (i + 1) * GRID_GAP_M * scale);
        startPositions.push(lateral(p, (i % 2 === 0 ? pole : -pole) * (width / 4)));
    }

    // DRS zones as lap distances from the start line (world units)
    const lapS = (m) => ((((m * scale) % total) + total) % total);
    const drsZones = (circuit.drs || []).map(([d, a, b]) => ({ detectS: lapS(d), startS: lapS(a), endS: lapS(b) }));

    const track = { id: raw.id, name: raw.name, scale, width, path: pts, cum, start, startS, drsZones, checkpoints, sectorCps, startPositions, safeSpeed: Assist.safeSpeeds(pts, scale), pit: null };
    if (raw.pit) track.pit = buildPit(raw, circuit, track);
    track.racingLine = RacingLine.compute(track); // visual guide, sent to clients in game_init
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

module.exports = { F1_TRACK_IDS, DRIFT_TRACK_IDS, TRACK_IDS, GARAGE_ORDER, load, loadAll, build, pointAt };
