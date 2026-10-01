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
];
const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks');

function convert(csvText, meta) {
    const rows = csvText.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.split(',').map(Number));
    const widths = rows.map(r => r[2] + r[3]).sort((a, b) => a - b);
    const width = Math.round(widths[Math.floor(widths.length / 2)] * WIDTH_MULT * SCALE);
    // CSV y points north; game y points down the screen, so flip it
    const pts = rows
        .filter((_, i) => i % STEP === 0)
        .map(([x, y]) => ({ x: +(x * SCALE).toFixed(1), y: +(-y * SCALE).toFixed(1) }));
    return { id: meta.id, name: meta.name, scale: SCALE, width, path: pts };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const src of SOURCES) {
        const res = await fetch(BASE + src.file + '.csv');
        if (!res.ok) throw new Error(`${src.file}: HTTP ${res.status}`);
        const track = convert(await res.text(), src);
        fs.writeFileSync(path.join(OUT_DIR, `${src.id}.json`), JSON.stringify(track));
        console.log(`${src.id}: ${track.path.length} points, width ${track.width}`);
    }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { convert, SCALE };
