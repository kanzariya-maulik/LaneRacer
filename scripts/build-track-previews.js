const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'tracks');
const OUT_FILE = path.join(__dirname, '..', 'public', 'tracks-preview.json');

const TRACK_IDS = [
    'monza', 'spa', 'silverstone', 'suzuka', 'sakhir', 'interlagos',
    'cota', 'zandvoort', 'spielberg', 'montreal', 'hungaroring', 'monaco',
    'imola', 'buddh', 'oval-x', 'ring-x', 'track-x', 'oval', 'ring', 'bone-x'
];

const previews = {};

for (const id of TRACK_IDS) {
    const file = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Downsample slightly to ~150-200 points for ultra-fast canvas drawing
    const step = Math.max(1, Math.floor(raw.path.length / 180));
    const pts = [];
    for (let i = 0; i < raw.path.length; i += step) {
        pts.push([Math.round(raw.path[i].x), Math.round(raw.path[i].y)]);
    }
    // Compute bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    previews[id] = {
        id,
        name: raw.name || id,
        bounds: { minX, maxX, minY, maxY },
        path: pts
    };
}

fs.writeFileSync(OUT_FILE, JSON.stringify(previews));
console.log(`Generated ${OUT_FILE} with ${Object.keys(previews).length} track previews.`);
