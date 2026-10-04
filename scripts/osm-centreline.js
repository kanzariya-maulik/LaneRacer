// Centrelines for circuits the TUMFTM dataset lacks (Monaco, Imola): the F1 official track outline (MultiViewer: race
// direction, lap start at the timing line) is fitted onto the circuit's OpenStreetMap roads, which are drawn along the
// middle of the real road, and each outline point snapped onto them. Output: { csv: TUMFTM-style "x_m,y_m,w_tr_right_m,
// w_tr_left_m" (metres, north up) for import-tracks' convert(), also cached for import-pits; tunnels: [[fromM, toM]] }.
// Roads © OpenStreetMap contributors (ODbL).
const fs = require('fs');
const path = require('path');
const { densify, resample, nearestIndex, align } = require('./geo');

const CACHE = path.join(__dirname, 'build', 'osm');
const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=';
const SNAP_MAX_M = 15;  // further from any OSM road than this, the outline point is kept as is (and reported)
const SMOOTH = 1;       // points (5 m apart) each side: rounds off the OSM polyline's vertices without cutting hairpins

async function cached(name, url) {
    const f = path.join(CACHE, name);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    let res;
    for (let tries = 1; ; tries++) { // public Overpass servers answer 429/504 when busy
        res = await fetch(url, { headers: { 'User-Agent': 'LanRace track importer (one-off)' } });
        if (res.ok || tries === 5 || ![429, 502, 503, 504].includes(res.status)) break;
        await new Promise((r) => setTimeout(r, 15000 * tries));
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, text);
    return text;
}

// src.osm: { query (Overpass QL body returning ways with `out geom`), skip (RegExp on name / sport: pit lanes, karting) },
// src.f1: [MultiViewer circuit key, year], src.widthM: real track width (both halves equal)
async function osmCentreline(src) {
    const { query, skip } = src.osm;
    const data = JSON.parse(await cached(`${src.id}-roads.json`, OVERPASS + encodeURIComponent(`[out:json][timeout:90];${query}`)));
    const ways = data.elements.filter((e) => e.type === 'way' && e.geometry && !(skip && skip.test(`${e.tags.name || ''} ${e.tags['name:en'] || ''} ${e.tags.sport || ''}`)));
    if (!ways.length) throw new Error(`${src.id}: no OSM roads`);
    const lat0 = ways[0].geometry[0].lat;
    const toXY = (g) => [g.lon * 111320 * Math.cos((lat0 * Math.PI) / 180), g.lat * 110540];
    const Q = ways.flatMap((w) => densify(w.geometry.map(toXY), 1));

    const [key, year] = src.f1;
    const mv = JSON.parse(await cached(`${src.id}-mv-${key}-${year}.json`, `https://api.multiviewer.app/api/v1/circuits/${key}/${year}`));
    const outline = mv.x.map((x, i) => [x / 10, mv.y[i] / 10]);

    // Outline → OSM frame: rigid ICP from every 5° (and mirrored, the F1 frame's y may point either way)
    const mean = (A) => A.reduce((m, p) => [m[0] + p[0] / A.length, m[1] + p[1] / A.length], [0, 0]);
    const mq = mean(Q);
    let best = null;
    for (const r of [1, -1]) {
        const P = outline.map(([x, y]) => [x, r * y]), mp = mean(P);
        for (let d = 0; d < 360; d += 5) {
            const th = (d * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
            const f = align(P, Q, [th, mq[0] - (c * mp[0] - s * mp[1]), mq[1] - (s * mp[0] + c * mp[1])]);
            if (!best || f.median < best.median) best = { ...f, r };
        }
    }
    const c = Math.cos(best.theta), s = Math.sin(best.theta);
    const fitted = densify([...outline, outline[0]], 2).map(([x, y]) => [c * x - s * best.r * y + best.tx, s * x + c * best.r * y + best.ty]);

    // Snap onto the roads, then even 5 m spacing and a light smoothing
    const nearest = nearestIndex(Q);
    let far = 0;
    const snapped = fitted.map((p) => { const [j, d] = nearest(p); if (d > SNAP_MAX_M) { far++; return p; } return Q[j]; });
    const even = resample(snapped, 5).slice(0, -1); // closed: the last point repeats the first
    const n = even.length;
    const line = even.map((_, i) => {
        let x = 0, y = 0;
        for (let k = -SMOOTH; k <= SMOOTH; k++) { const q = even[(i + k + n) % n]; x += q[0]; y += q[1]; }
        return [x / (2 * SMOOTH + 1), y / (2 * SMOOTH + 1)];
    });
    console.log(`  ${src.id}: OSM ${ways.length} roads, outline fit ${best.median.toFixed(1)} m${best.r < 0 ? ' (mirrored)' : ''}, ${n} points (${(n * 5 / 1000).toFixed(2)} km), ${far} outline points off the roads`);
    // Real width per point: src.widths [[metres from the timing line, width m], ...] interpolated (wrapping), else src.widthM
    let along = 0;
    const widthAt = (m) => {
        const W = src.widths, L = n * 5;
        if (!W) return src.widthM;
        let k = W.findIndex(([wm]) => wm > m);
        const [m0, w0] = k <= 0 ? [W.at(-1)[0] - L, W.at(-1)[1]] : W[k - 1], [m1, w1] = k < 0 ? [W[0][0] + L, W[0][1]] : W[k];
        return w0 + ((w1 - w0) * (m - m0)) / (m1 - m0 || 1);
    };
    // Centred on the origin: raw map metres (~5,000 km out) are too big for the GPU's 32-bit floats (the world shakes)
    const ox = line.reduce((a, p) => a + p[0], 0) / n, oy = line.reduce((a, p) => a + p[1], 0) / n;
    const rows = line.map(([x, y], i) => {
        if (i) along += Math.hypot(x - line[i - 1][0], y - line[i - 1][1]);
        const half = (widthAt(along) / 2).toFixed(2);
        return `${(x - ox).toFixed(3)},${(y - oy).toFixed(3)},${half},${half}`;
    });
    const csv = `# x_m,y_m,w_tr_right_m,w_tr_left_m lat0=${lat0} origin=${ox.toFixed(3)},${oy.toFixed(3)}\n` + rows.join('\n') + '\n';
    fs.writeFileSync(path.join(CACHE, `${src.file}.csv`), csv); // import-pits reads the centreline from here
    // Tunnels (OSM tunnel=yes): stretches of the lap, metres from row 0, where the line runs within 6 m of one
    const T = ways.filter((w) => w.tags.tunnel === 'yes').flatMap((w) => densify(w.geometry.map(toXY), 2));
    const inTunnel = T.length ? (() => { const near = nearestIndex(T); return line.map((p) => near(p)[1] < 6); })() : line.map(() => false);
    const tunnels = [];
    inTunnel.forEach((v, i) => { if (v && !inTunnel[i - 1]) tunnels.push([i * 5, i * 5]); if (v) tunnels.at(-1)[1] = i * 5 + 5; });
    // none under 50 m (a road beneath), then one tube where pieces are < 100 m apart (where the F1 line leaves OSM's tube)
    const long = tunnels.filter(([a, b]) => b - a >= 50)
        .reduce((m, t) => (m.length && t[0] - m.at(-1)[1] < 100 ? (m.at(-1)[1] = t[1], m) : [...m, t]), []);
    if (long.length) console.log(`  ${src.id}: tunnel ${long.map(([a, b]) => `${a}-${b} m`).join(', ')}`);
    return { csv, tunnels: long };
}

module.exports = { osmCentreline };
