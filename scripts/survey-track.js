// One-off survey: node scripts/survey-track.js <id> [overlayDir]   (macOS: reads the imagery with `sips`)
// For a circuit with no published survey (Buddh: not in TUMFTM, no F1 car data since 2013): the centreline and the real
// track edges (white lines) measured off aerial imagery, written as a TUMFTM-style CSV (x_m, y_m, w_tr_right_m,
// w_tr_left_m; metres, north up, every 5 m) into data/tracks/source/, which import-tracks.js then reads like a TUMFTM file.
//   1. The circuit's OpenStreetMap raceway ways, joined in driving order: a first centreline (OSM is traced by hand, a few
//      metres off the middle in places).
//   2. Every 5 m, the imagery across the road (Esri World Imagery, zoom 18, ~0.53 m a pixel): candidate edges each side
//      (a white line brighter than the asphalt inside and the ground outside it, or where the ground stops looking like the
//      road's own asphalt), then the most continuous run of them around the lap (Viterbi), spikes filtered out.
//   3. The centreline moved to the middle of the two lines, both smoothed along the lap.
// overlayDir: crops of the imagery every 200 m with the measured edges drawn on, to check them by eye.
// Roads © OpenStreetMap contributors (ODbL); imagery: Esri, Maxar, Earthstar Geographics (measurements only, not stored).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { densify, resample } = require('./geo');

const SURVEYS = {
    // Main loop in driving order (from the exit of T3); the pit lane (188019426) is imported by import-pits.js
    buddh: { file: 'Buddh', ways: [188020620, 188020619, 169886195, 188020614, 188020617, 188020613] },
};
const BUILD = path.join(__dirname, 'build');
const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks', 'source');
const OVERPASS = 'https://overpass-api.de/api/interpreter?data=';
const UA = { 'User-Agent': 'LanRace track survey (one-off)' };
const Z = 18, TILE_PAD = 0.4;                 // imagery zoom; tiles beyond the track's extent (~60 m)
const STEP_M = 5, SCAN_STEP_M = 0.25, REACH_M = 14; // along the lap; across it, to either side
const HALF_MIN_M = 4, HALF_MAX_M = 11;        // half-widths outside this are unlikely (Tilke roads: 10-16 m, main straight wider)
const MED = 5, RATE = 0.12;                   // spike filter: median over ±MED points, then at most RATE m wider per m along
const CENTRE_SMOOTH = 4;                      // points each side when the centreline moves to the middle of the lines

async function cached(file, url) {
    if (fs.existsSync(file)) return fs.readFileSync(file);
    let res;
    for (let tries = 1; ; tries++) {
        res = await fetch(url, { headers: UA });
        if (res.ok || tries === 5 || ![429, 502, 503, 504].includes(res.status)) break;
        await new Promise((r) => setTimeout(r, 15000 * tries));
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return buf;
}

// Web Mercator pixels at zoom Z
const px = (lon) => ((lon + 180) / 360) * 2 ** Z * 256;
const py = (lat) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z * 256;

// The imagery under a set of points: tiles fetched once (JPEG, converted to BMP with sips), sampled bilinearly
async function imagery(id, lls) {
    if (process.platform !== 'darwin') throw new Error('survey-track.js reads the imagery with macOS sips');
    const dir = path.join(BUILD, 'sat', id), tiles = new Map();
    const x0 = Math.floor(Math.min(...lls.map((p) => px(p.lon))) / 256 - TILE_PAD), x1 = Math.floor(Math.max(...lls.map((p) => px(p.lon))) / 256 + TILE_PAD);
    const y0 = Math.floor(Math.min(...lls.map((p) => py(p.lat))) / 256 - TILE_PAD), y1 = Math.floor(Math.max(...lls.map((p) => py(p.lat))) / 256 + TILE_PAD);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const f = path.join(dir, `${Z}_${tx}_${ty}`);
        if (!fs.existsSync(f + '.bmp')) {
            await cached(f + '.jpg', `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);
            execFileSync('sips', ['-s', 'format', 'bmp', f + '.jpg', '--out', f + '.bmp'], { stdio: 'ignore' });
        }
        tiles.set(`${tx},${ty}`, fs.readFileSync(f + '.bmp')); // 24-bit, top-down, rows of 768 bytes from offset 54
    }
    const pixel = (X, Y) => {
        const b = tiles.get(`${Math.floor(X / 256)},${Math.floor(Y / 256)}`);
        if (!b) return [0, 0, 0];
        const o = 54 + ((Y & 255) * 256 + (X & 255)) * 3;
        return [b[o + 2], b[o + 1], b[o]];
    };
    const rgb = ({ lat, lon }) => {
        const fx = px(lon) - 0.5, fy = py(lat) - 0.5, X = Math.floor(fx), Y = Math.floor(fy), u = fx - X, v = fy - Y;
        const a = pixel(X, Y), b = pixel(X + 1, Y), c = pixel(X, Y + 1), d = pixel(X + 1, Y + 1);
        return [0, 1, 2].map((k) => a[k] * (1 - u) * (1 - v) + b[k] * u * (1 - v) + c[k] * (1 - u) * v + d[k] * u * v);
    };
    return { rgb, pixel };
}

// Candidate road edges on one side (dir +1 left / -1 right) of a profile across the road
const colourDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function candidates(o, dir) {
    const mid = Math.round(REACH_M / SCAN_STEP_M), cands = [];
    const ref = [0, 1, 2].map((q) => o.slice(mid - 8, mid + 9).map((p) => p.c[q]).sort((x, y) => x - y)[8]); // the asphalt's colour
    const avg = (k0, k1) => { let t = 0, c = 0; for (let k = Math.min(k0, k1); k <= Math.max(k0, k1); k++) if (o[k]) { t += o[k].L; c++; } return t / c; };
    for (let k = mid + dir * 12; k > 6 && k < o.length - 7; k += dir) {
        const p = o[k], s = Math.abs(p.s), local = Math.max(avg(k - 6 * dir, k - 3 * dir), avg(k + 3 * dir, k + 6 * dir));
        const line = p.L >= o[k - 1].L && p.L >= o[k + 1].L && p.L - local > 5;
        const off = [0, 1, 2, 3].every((q) => o[k + q * dir] && colourDist(o[k + q * dir].c, ref) > 28);
        if (line) cands.push({ s, strength: p.L - local });
        else if (off && !(cands.length && cands.at(-1).off && s - cands.at(-1).s < 2)) cands.push({ s, strength: 6, off: true });
        if (cands.length >= 8) break;
    }
    return cands.length ? cands : [{ s: REACH_M, strength: 0 }];
}

// The most continuous choice around the lap: strong lines, near the centre, plausible widths, no jumps
function choose(C) {
    const unary = (c, j) => -0.25 * Math.min(c.strength, 30) + 0.4 * j + (c.s < HALF_MIN_M ? 3 * (HALF_MIN_M - c.s) ** 2 : 0) + (c.s > HALF_MAX_M ? 0.5 * (c.s - HALF_MAX_M) ** 2 : 0);
    const pair = (p, c) => 3 * Math.abs(p.s - c.s) ** 1.5;
    const cost = [], back = [];
    C.forEach((cs, i) => {
        const prev = i ? cs.map((c) => C[i - 1].map((p, q) => cost[i - 1][q] + pair(p, c))) : null;
        cost.push(cs.map((c, j) => unary(c, j) + (prev ? Math.min(...prev[j]) : 0)));
        back.push(cs.map((_, j) => (prev ? prev[j].indexOf(Math.min(...prev[j])) : -1)));
    });
    let j = cost.at(-1).indexOf(Math.min(...cost.at(-1)));
    const out = [];
    for (let i = C.length - 1; i >= 0; i--) { out[i] = C[i][j].s; j = back[i][j]; }
    return out;
}

function clean(E) {
    const n = E.length;
    const m = E.map((_, i) => { const w = []; for (let k = -MED; k <= MED; k++) w.push(E[(i + k + n) % n]); return w.sort((x, y) => x - y)[MED]; });
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 2 * n; i++) { // forwards and backwards
        const a = i % n, b = (a + 1) % n, c = (n - 1 - a + n) % n, d = (c - 1 + n) % n;
        m[b] = Math.min(m[b], m[a] + RATE * STEP_M);
        m[d] = Math.min(m[d], m[c] + RATE * STEP_M);
    }
    return m;
}

const loopMean = (A, k) => A.map((_, i) => { let s = 0; for (let d = -k; d <= k; d++) s += A[(i + d + A.length) % A.length]; return s / (2 * k + 1); });

async function survey(id, overlayDir) {
    const cfg = SURVEYS[id];
    if (!cfg) throw new Error(`no survey for ${id}`);
    const data = JSON.parse(await cached(path.join(BUILD, 'osm', `${id}-raceways.json`), OVERPASS + encodeURIComponent(`[out:json][timeout:90];way(id:${cfg.ways.join(',')});out geom;`)));
    const geom = cfg.ways.map((w) => {
        const way = data.elements.find((e) => e.id === w);
        if (!way) throw new Error(`${id}: OSM way ${w} missing`);
        return way.geometry;
    });
    geom.forEach((g, k) => { // each way starts where the last one ended: one loop, in driving order
        const prev = geom[(k - 1 + geom.length) % geom.length].at(-1);
        if (Math.hypot(g[0].lat - prev.lat, g[0].lon - prev.lon) > 1e-6) throw new Error(`${id}: way ${cfg.ways[k]} doesn't follow on`);
    });
    const lat0 = geom[0][0].lat, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540; // as osm-centreline.js
    const toLL = ([x, y]) => ({ lat: y / ky, lon: x / kx });
    let P = resample(densify(geom.flatMap((g, k) => (k ? g.slice(1) : g)).map((g) => [g.lon * kx, g.lat * ky]), 1), STEP_M);
    if (Math.hypot(P.at(-1)[0] - P[0][0], P.at(-1)[1] - P[0][1]) < STEP_M / 2) P = P.slice(0, -1);
    const n = P.length;

    const { rgb, pixel } = await imagery(id, P.map(toLL));
    const normals = P.map((_, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; // to the driver's left (north up)
    });
    const profiles = P.map((p, i) => {
        const out = [];
        for (let s = -REACH_M; s <= REACH_M + 1e-9; s += SCAN_STEP_M) {
            const c = rgb(toLL([p[0] + normals[i][0] * s, p[1] + normals[i][1] * s]));
            out.push({ s, c, L: (c[0] + c[1] + c[2]) / 3 });
        }
        return out;
    });
    const left = clean(choose(profiles.map((o) => candidates(o, 1)))), right = clean(choose(profiles.map((o) => candidates(o, -1))));

    // Centreline to the middle of the lines, then the real half-width either side of it, both smooth along the lap
    const shift = loopMean(left.map((l, i) => (l - right[i]) / 2), CENTRE_SMOOTH), half = loopMean(left.map((l, i) => (l + right[i]) / 2), CENTRE_SMOOTH);
    const C = P.map((p, i) => [p[0] + normals[i][0] * shift[i], p[1] + normals[i][1] * shift[i]]);
    const width = half.map((h) => 2 * h).sort((a, b) => a - b);
    console.log(`${id}: ${n} points (${((n * STEP_M) / 1000).toFixed(3)} km), centre moved up to ${Math.max(...shift.map(Math.abs)).toFixed(1)} m, width median ${width[n >> 1].toFixed(1)} m (${width[Math.floor(n * 0.05)].toFixed(1)}-${width[Math.floor(n * 0.95)].toFixed(1)})`);

    // Centred on the origin, as osm-centreline.js: map metres are too big for the GPU's 32-bit floats
    const ox = C.reduce((a, p) => a + p[0], 0) / n, oy = C.reduce((a, p) => a + p[1], 0) / n;
    const rows = C.map(([x, y], i) => `${(x - ox).toFixed(3)},${(y - oy).toFixed(3)},${half[i].toFixed(2)},${half[i].toFixed(2)}`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${cfg.file}.csv`);
    fs.writeFileSync(file, `# x_m,y_m,w_tr_right_m,w_tr_left_m lat0=${lat0} origin=${ox.toFixed(3)},${oy.toFixed(3)} (scripts/survey-track.js)\n` + rows.join('\n') + '\n');
    console.log(`  wrote ${path.relative(process.cwd(), file)}`);

    if (overlayDir) { // the measured lines (green left, red right) and the new centreline (magenta) over the imagery
        fs.mkdirSync(overlayDir, { recursive: true });
        const edge = (side, E) => P.map((p, i) => toLL([p[0] + side * normals[i][0] * E[i], p[1] + side * normals[i][1] * E[i]]));
        const lines = [[edge(1, left), [0, 255, 0]], [edge(-1, right), [255, 0, 0]], [C.map(toLL), [255, 0, 255]]];
        const S = 360;
        for (let i = 0; i < n; i += 40) {
            const cx = Math.round(px(toLL(P[i]).lon)) - S / 2, cy = Math.round(py(toLL(P[i]).lat)) - S / 2, img = [];
            for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.push(pixel(cx + x, cy + y));
            for (const [pts, col] of lines) for (let k = 1; k < pts.length; k++) {
                const ax = px(pts[k - 1].lon) - cx, ay = py(pts[k - 1].lat) - cy, bx = px(pts[k].lon) - cx, by = py(pts[k].lat) - cy;
                const st = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) || 1;
                for (let q = 0; q <= st; q++) { const x = Math.round(ax + ((bx - ax) * q) / st), y = Math.round(ay + ((by - ay) * q) / st); if (x >= 0 && y >= 0 && x < S && y < S) img[y * S + x] = col; }
            }
            const bmp = Buffer.alloc(54 + S * S * 3); // S * 3 a multiple of 4: no row padding
            bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(S, 18); bmp.writeInt32LE(-S, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
            img.forEach((c, k) => { bmp[54 + k * 3] = c[2]; bmp[55 + k * 3] = c[1]; bmp[56 + k * 3] = c[0]; });
            const f = path.join(overlayDir, `${String(i * STEP_M).padStart(4, '0')}`);
            fs.writeFileSync(f + '.bmp', bmp);
            execFileSync('sips', ['-s', 'format', 'png', f + '.bmp', '--out', f + '.png'], { stdio: 'ignore' });
            fs.unlinkSync(f + '.bmp');
        }
    }
}

if (require.main === module) survey(process.argv[2], process.argv[3]).catch((e) => { console.error(e); process.exit(1); });

module.exports = { SURVEYS };
