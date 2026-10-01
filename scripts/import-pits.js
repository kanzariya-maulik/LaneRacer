// One-off importer: node scripts/import-pits.js (run after import-tracks.js)
// Pit lanes © OpenStreetMap contributors (ODbL), aligned onto the TUMFTM centrelines by robust ICP.
const fs = require('fs');
const path = require('path');
const { SCALE, BASE, SOURCES } = require('./import-tracks');

const OSM_API = 'https://api.openstreetmap.org/api/0.6/map?bbox=';
const CACHE = path.join(__dirname, 'build', 'osm');
const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks');
const PIT_WIDTH_M = 10; // 12 m would overlap the 1.5×-widened track at Sakhir/Suzuka
const STEP_M = 5;
const MAX_FIT_M = 5;
const ATTRIBUTION = 'Pit lane © OpenStreetMap contributors (ODbL)';
// bbox, OSM pit way, ICP seed [theta, tx, ty] (TUMFTM metres → local OSM metres), found once by a rotation/translation search
const PITS = {
    monza: { bbox: '9.275,45.605,9.300,45.635', way: '38168747', seed: [-0.004017, 722558.13, 5042407.6] },
    spa: { bbox: '5.955,50.425,5.985,50.448', way: '323851541', seed: [-0.037237, 423016.43, 5575985.87] },
    silverstone: { bbox: '-1.040,52.060,-1.000,52.085', way: '227902927', seed: [-0.027002, -70032.16, 5755636.62] },
    suzuka: { bbox: '136.522,34.830,136.552,34.852', way: '120917578', seed: [-0.015115, 12474110.04, 3851764.41] },
    sakhir: { bbox: '50.502,26.024,50.522,26.041', way: '187123422', seed: [0.003081, 5052448.48, 2877385.24] },
};

function parseOsm(xml) {
    const nodes = {};
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes[m[1]] = [+m[2], +m[3]];
    const ways = [];
    for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
        const tags = {};
        for (const t of m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
        if (tags.highway !== 'raceway' || tags.area === 'yes') continue;
        ways.push({ id: m[1], tags, nds: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(x => nodes[x[1]]).filter(Boolean) });
    }
    return ways;
}

// Points every ≤ step metres along a polyline of [x, y]
function densify(pts, step) {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    if (pts.length) out.push(pts.at(-1));
    return out;
}

// Points exactly every step metres, plus the end point
function resample(pts, step) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const out = [];
    let i = 0;
    for (let s = 0; s < cum.at(-1) - step / 2; s += step) {
        while (cum[i + 1] < s) i++;
        const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
        out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
    }
    out.push(pts.at(-1));
    return out;
}

// Nearest-point lookup on a 20 m grid hash
function nearestIndex(Q) {
    const cell = 20, grid = new Map();
    Q.forEach((q, i) => {
        const k = Math.floor(q[0] / cell) + ',' + Math.floor(q[1] / cell);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
    });
    return (p) => {
        const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
        let best = -1, bd = Infinity;
        for (let r = 0; r < 30 && (best < 0 || r * cell < Math.sqrt(bd) + cell); r++) {
            for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                for (const i of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
                    const d = (Q[i][0] - p[0]) ** 2 + (Q[i][1] - p[1]) ** 2;
                    if (d < bd) { bd = d; best = i; }
                }
            }
        }
        return [best, Math.sqrt(bd)];
    };
}

// Trimmed ICP (median distance, outliers > 3× median dropped) of P onto Q from a seed
function align(P, Q, [theta, tx, ty]) {
    const nearest = nearestIndex(Q);
    let median = Infinity;
    for (let it = 0; it < 40; it++) {
        const c = Math.cos(theta), s = Math.sin(theta);
        const pairs = P.map((p) => {
            const [j, d] = nearest([c * p[0] - s * p[1] + tx, s * p[0] + c * p[1] + ty]);
            return { p, q: Q[j], d };
        });
        const ds = pairs.map(x => x.d).sort((a, b) => a - b);
        median = ds[ds.length >> 1];
        const keep = pairs.filter(x => x.d <= Math.max(3 * median, 10));
        const mean = (f) => keep.reduce((acc, x) => [acc[0] + f(x)[0] / keep.length, acc[1] + f(x)[1] / keep.length], [0, 0]);
        const mp = mean(x => x.p), mq = mean(x => x.q);
        let sxx = 0, sxy = 0;
        for (const { p, q } of keep) {
            const a = [p[0] - mp[0], p[1] - mp[1]], b = [q[0] - mq[0], q[1] - mq[1]];
            sxx += a[0] * b[0] + a[1] * b[1];
            sxy += a[0] * b[1] - a[1] * b[0];
        }
        theta = Math.atan2(sxy, sxx);
        const c2 = Math.cos(theta), s2 = Math.sin(theta);
        tx = mq[0] - (c2 * mp[0] - s2 * mp[1]);
        ty = mq[1] - (s2 * mp[0] + c2 * mp[1]);
    }
    return { theta, tx, ty, median };
}

async function cached(file, url) {
    const f = path.join(CACHE, file);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    const res = await fetch(url, { headers: { 'User-Agent': 'LanRace pit lane importer (one-off)' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(f, text);
    return text;
}

async function importPit(src) {
    const cfg = PITS[src.id];
    const ways = parseOsm(await cached(`${src.id}.osm`, OSM_API + cfg.bbox));
    const all = ways.flatMap(w => w.nds);
    const lat0 = all.reduce((s, p) => s + p[0], 0) / all.length;
    const toXY = ([la, lo]) => [lo * 111320 * Math.cos(lat0 * Math.PI / 180), la * 110540];
    const isPit = (w) => /pit/i.test((w.tags.name || '') + (w.tags.service || '') + (w.tags.raceway || ''));
    const Q = ways.filter(w => !isPit(w)).flatMap(w => densify(w.nds.map(toXY), 4));

    const csv = await cached(`${src.file}.csv`, BASE + src.file + '.csv');
    const P = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(',').map(Number)).map(r => [r[0], r[1]]);

    const fit = align(P, Q, cfg.seed);
    if (!(fit.median <= MAX_FIT_M)) throw new Error(`${src.id}: OSM fit ${fit.median.toFixed(2)} m > ${MAX_FIT_M} m`);

    const way = ways.find(w => w.id === cfg.way);
    if (!way) throw new Error(`${src.id}: OSM way ${cfg.way} not found`);
    const c = Math.cos(fit.theta), s = Math.sin(fit.theta);
    const toTum = ([x, y]) => { const dx = x - fit.tx, dy = y - fit.ty; return [c * dx + s * dy, -s * dx + c * dy]; };
    let pit = densify(way.nds.map(toXY), 4).map(toTum);

    // Same direction as the track at the middle of the pit lane
    const m = pit.length >> 1;
    let ti = 0, bd = Infinity;
    P.forEach((p, i) => { const d = Math.hypot(p[0] - pit[m][0], p[1] - pit[m][1]); if (d < bd) { bd = d; ti = i; } });
    const t1 = P[(ti + 1) % P.length];
    if ((t1[0] - P[ti][0]) * (pit[m + 1][0] - pit[m][0]) + (t1[1] - P[ti][1]) * (pit[m + 1][1] - pit[m][1]) < 0) pit.reverse();

    pit = resample(pit, STEP_M);
    const file = path.join(OUT_DIR, `${src.id}.json`);
    const track = JSON.parse(fs.readFileSync(file, 'utf8'));
    track.pit = {
        path: pit.map(([x, y]) => ({ x: +(x * SCALE).toFixed(1), y: +(-y * SCALE).toFixed(1) })),
        width: PIT_WIDTH_M * SCALE,
        osmWay: cfg.way,
        fitM: +fit.median.toFixed(2),
    };
    track.attribution = ATTRIBUTION;
    fs.writeFileSync(file, JSON.stringify(track));
    console.log(`${src.id}: fit ${fit.median.toFixed(2)} m, pit ${pit.length} points`);
}

async function main() {
    fs.mkdirSync(CACHE, { recursive: true });
    for (const src of SOURCES) await importPit(src);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
