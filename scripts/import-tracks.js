// One-off importer: node scripts/import-tracks.js
// Source: TUMFTM racetrack-database (LGPL-3.0), centreline + track widths per ~5 m; circuits it lacks (Monaco, Imola)
// from OpenStreetMap roads and the F1 track outline (osm-centreline.js), or (Buddh: no F1 data since 2013) our own survey
// in the same format, data/tracks/source/<file>.csv (survey-track.js: OSM roads, edges measured off aerial imagery)
const fs = require('fs');
const { osmCentreline } = require('./osm-centreline');
const path = require('path');

const SCALE = 6;        // game units per metre — car model, physics and HUD assume this
const WIDTH_MULT = 2;   // real widths feel too tight for a full grid side by side (src/game/Track.js: the same)
const STEP = 2;         // dataset is ~5 m/point; keep every 2nd → ~10 m

const BASE = 'https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/';
// Real track widths (m) by section, from the timing line, for the OSM-built circuits (no dataset has them). Published:
// Monaco straight ~12, Portier 8.87, Fairmont hairpin ~9.45, chicane 9.3 -> 10.1, Tabac ~8, Rascasse ~9 (kymillman.com);
// Imola 15 max / 10 min (circuit brochure). The rest are estimates between those
const MONACO_WIDTHS = [[0, 12], [150, 12], [195, 11], [300, 10], [880, 10], [1105, 9.5], [1230, 9.45], [1310, 8.9], [1395, 8.87], [1450, 10.5],
    [1700, 10.5], [2060, 9.3], [2115, 10.1], [2250, 9], [2340, 8], [2420, 9], [2875, 9], [2965, 10], [3100, 12]];
const IMOLA_WIDTHS = [[0, 15], [200, 15], [255, 13], [885, 13], [1090, 12], [1900, 12], [2550, 11], [2940, 10.5], [3120, 10.5], [3530, 10],
    [3580, 10], [4130, 12], [4470, 12], [4780, 15]];
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
    // Not in TUMFTM: OSM roads (the circuit relation at Monaco; Imola's raceway ways), F1 outline [MultiViewer key, year]
    { id: 'monaco', name: 'Monaco', file: 'Monaco', step: 1, widths: MONACO_WIDTHS, f1: [22, 2023], osm: { query: 'relation(148194);way(r);out geom;', skip: /pit|stands/i } },
    { id: 'imola', name: 'Imola', file: 'Imola', widths: IMOLA_WIDTHS, f1: [6, 2024], osm: { query: 'way(44.335,11.700,44.350,11.725)[highway=raceway];out geom;', skip: /pit|karting/i } },
    // Our own survey (survey-track.js), already a TUMFTM-style CSV
    { id: 'buddh', name: 'Buddh International', file: 'Buddh', local: path.join(__dirname, '..', 'data', 'tracks', 'source', 'Buddh.csv') },
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
    const kept = rows.filter((_, i) => i % (meta.step || STEP) === 0); // step 1: every 5 m point (Monaco's hairpins)
    const pts = kept.map(([x, y]) => ({ x: +(x * SCALE).toFixed(1), y: +(-y * SCALE).toFixed(1) }));
    // The real track edges (white lines) at each point, metres from the centreline: [driver's right, left]. Flipping y
    // keeps right as right in the game (y down the screen, 'right' = clockwise of the heading)
    const edges = kept.map((r) => [+r[2].toFixed(2), +r[3].toFixed(2)]);
    return { id: meta.id, name: meta.name, scale: SCALE, width, path: pts, edges };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const src of only(SOURCES)) {
        let csv, extra = {};
        if (src.osm) ({ csv, ...extra } = await osmCentreline(src)); // + tunnels
        else if (src.local) csv = fs.readFileSync(src.local, 'utf8');
        else {
            const res = await fetch(BASE + src.file + '.csv');
            if (!res.ok) throw new Error(`${src.file}: HTTP ${res.status}`);
            csv = await res.text();
        }
        const track = { ...convert(csv, src), ...extra };
        // Keep what the later importers added (pit lane, elevation): this one only owns the centreline and widths
        const file = path.join(OUT_DIR, `${src.id}.json`), old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        if (old.path && JSON.stringify(old.path) !== JSON.stringify(track.path)) throw new Error(`${src.id}: centreline changed upstream; re-run npm run tracks`);
        fs.writeFileSync(file, JSON.stringify({ ...old, ...track }));
        console.log(`${src.id}: ${track.path.length} points, width ${track.width}`);
    }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { convert, SCALE, WIDTH_MULT, BASE, SOURCES, only };
