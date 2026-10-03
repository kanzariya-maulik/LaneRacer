// One-off importer: node scripts/import-tracks.js
// Source: TUMFTM racetrack-database (LGPL-3.0), centreline + track widths per ~5 m.
const fs = require('fs');
const path = require('path');

const SCALE = 6;        // game units per metre — car model, physics and HUD assume this
const WIDTH_MULT = 1.5; // real widths feel too tight with arcade steering
const STEP = 2;         // dataset is ~5 m/point; keep every 2nd → ~10 m

const BASE = 'https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/';
const SOURCES = [
    { id: 'monza', name: 'Monza', file: 'Monza' },
    { id: 'spa', name: 'Spa-Francorchamps', file: 'Spa' },
    { id: 'silverstone', name: 'Silverstone', file: 'Silverstone' },
    { id: 'suzuka', name: 'Suzuka', file: 'Suzuka' },
    { id: 'sakhir', name: 'Bahrain (Sakhir)', file: 'Sakhir' },
    { id: 'interlagos', name: 'Interlagos', file: 'SaoPaulo' },
    { id: 'cota', name: 'Circuit of the Americas', file: 'Austin' },
    { id: 'zandvoort', name: 'Zandvoort', file: 'Zandvoort' },
    { id: 'spielberg', name: 'Red Bull Ring', file: 'Spielberg' },
    { id: 'montreal', name: 'Montreal', file: 'Montreal' },
    { id: 'hungaroring', name: 'Hungaroring', file: 'Budapest' },
];
const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks');
// node scripts/<importer>.js [id,id,...]: only those tracks
const only = (list) => (process.argv[2] ? list.filter((s) => process.argv[2].split(',').includes(s.id)) : list);

function convert(csvText, meta) {
    const rows = csvText.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.split(',').map(Number));
    const widths = rows.map(r => r[2] + r[3]).sort((a, b) => a - b);
    const width = Math.round(widths[Math.floor(widths.length / 2)] * WIDTH_MULT * SCALE);
    // CSV y points north; game y points down the screen, so flip it
    const kept = rows.filter((_, i) => i % STEP === 0);
    const pts = kept.map(([x, y]) => ({ x: +(x * SCALE).toFixed(1), y: +(-y * SCALE).toFixed(1) }));
    // The real track edges (white lines) at each point, metres from the centreline: [driver's right, left]. Flipping y
    // keeps right as right in the game (y down the screen, 'right' = clockwise of the heading)
    const edges = kept.map((r) => [+r[2].toFixed(2), +r[3].toFixed(2)]);
    return { id: meta.id, name: meta.name, scale: SCALE, width, path: pts, edges };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const src of only(SOURCES)) {
        const res = await fetch(BASE + src.file + '.csv');
        if (!res.ok) throw new Error(`${src.file}: HTTP ${res.status}`);
        const track = convert(await res.text(), src);
        // Keep what the later importers added (pit lane, elevation): this one only owns the centreline and widths
        const file = path.join(OUT_DIR, `${src.id}.json`), old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        if (old.path && JSON.stringify(old.path) !== JSON.stringify(track.path)) throw new Error(`${src.id}: centreline changed upstream; re-run npm run tracks`);
        fs.writeFileSync(file, JSON.stringify({ ...old, ...track }));
        console.log(`${src.id}: ${track.path.length} points, width ${track.width}`);
    }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { convert, SCALE, BASE, SOURCES, only };
