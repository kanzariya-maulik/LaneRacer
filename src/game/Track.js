const fs = require('fs');
const path = require('path');

const TRACK_IDS = ['monza', 'spa', 'silverstone', 'suzuka', 'sakhir'];
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'tracks');
const CHECKPOINT_COUNT = 16;
const GRID_SLOTS = 20;
const GRID_GAP_M = 8;  // metres between consecutive (staggered) grid slots
const WALL_OFFSET = 80; // matches the invisible wall in Player.js

// cum[i] = distance along the loop to path[i]; cum[n] = full lap length
function cumulative(pts) {
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
        const a = pts[i - 1], b = pts[i % pts.length];
        cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return cum;
}

// Point and heading at distance s along the loop (s may be negative)
function pointAt(pts, cum, s) {
    const total = cum[pts.length];
    s = ((s % total) + total) % total;
    let i = 0;
    while (cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

function build(raw) {
    const { path: pts, width, scale } = raw;
    const cum = cumulative(pts);
    const total = cum[pts.length];

    const checkpoints = [];
    for (let k = 0; k < CHECKPOINT_COUNT; k++) {
        const p = k === 0 ? pts[0] : pointAt(pts, cum, (k * total) / CHECKPOINT_COUNT);
        checkpoints.push({ x: p.x, y: p.y, radius: width / 2 + WALL_OFFSET });
    }

    // Staggered two-column grid behind the start line
    const startPositions = [];
    for (let i = 0; i < GRID_SLOTS; i++) {
        const p = pointAt(pts, cum, -(i + 1) * GRID_GAP_M * scale);
        const off = (i % 2 === 0 ? -1 : 1) * (width / 4);
        startPositions.push({
            x: p.x - Math.sin(p.angle) * off,
            y: p.y + Math.cos(p.angle) * off,
            angle: p.angle,
        });
    }

    return { id: raw.id, name: raw.name, scale, width, path: pts, checkpoints, startPositions };
}

function load(id) {
    const file = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing track data ${file}. Run: npm run tracks`);
    return build(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function loadAll() {
    const tracks = {};
    for (const id of TRACK_IDS) tracks[id] = load(id);
    return tracks;
}

module.exports = { TRACK_IDS, load, loadAll, build };
