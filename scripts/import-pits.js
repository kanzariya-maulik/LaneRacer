// One-off importer: node scripts/import-pits.js (run after import-tracks.js)
// Pit lanes © OpenStreetMap contributors (ODbL), aligned onto the TUMFTM centrelines by robust ICP.
const fs = require('fs');
const path = require('path');
const { SCALE, WIDTH_MULT, BASE, SOURCES, only } = require('./import-tracks');
const { fair } = require('../src/game/Track');
const { densify, resample, align, nearestIndex } = require('./geo');
const { fitF1 } = require('./import-elevation');

// Raceway ways (and their nodes) in a bbox 'west,south,east,north', via Overpass: the plain OSM API refuses busy city areas
// (plus the listed ways whatever they are: Monaco's pit lane runs partly on a service road)
const osmUrl = (bbox, ids = []) => { const [w, s, e, n] = bbox.split(','); return 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:xml];(way[highway=raceway](${s},${w},${n},${e});${ids.length ? `way(id:${ids.join(',')});` : ''});(._;>;);out;`); };
const CACHE = path.join(__dirname, 'build', 'osm');
const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks');
const PIT_WIDTH_M = 10; // 12 m would overlap the widened track at Sakhir/Suzuka
const STEP_M = 5;
const MAX_FIT_M = 5;
const ATTRIBUTION = 'Pit lane © OpenStreetMap contributors (ODbL)';
// bbox, OSM pit way(s), ICP seed [theta, tx, ty] (TUMFTM metres → local OSM metres; found by a rotation search when missing),
// (every lane is then moved clear of the drawn road where it would cover it: clearOfRoad)
const PITS = {
    monza: { bbox: '9.275,45.605,9.300,45.635', way: '38168747', seed: [-0.004017, 722558.13, 5042407.6] },
    spa: { bbox: '5.955,50.425,5.985,50.448', way: '323851541', seed: [-0.037237, 423016.43, 5575985.87] },
    silverstone: { bbox: '-1.040,52.060,-1.000,52.085', way: '227902927', seed: [-0.027002, -70032.16, 5755636.62] },
    suzuka: { bbox: '136.522,34.830,136.552,34.852', way: '120917578', seed: [-0.015115, 12474110.04, 3851764.41] },
    sakhir: { bbox: '50.502,26.024,50.522,26.041', way: '187123422', seed: [0.003081, 5052448.48, 2877385.24] },
    interlagos: { bbox: '-46.708,-23.712,-46.690,-23.696', way: '33779109', seed: [-0.009960, -4760138.16, -2620185.07] },
    cota: { bbox: '-97.650,30.124,-97.628,30.142', way: '514836373', seed: [-0.013242, -9400523.02, 3330960.76] },
    zandvoort: { bbox: '4.533,52.382,4.550,52.394', way: '38144527', seed: [-0.021118, 308498.36, 5791054.50] },
    spielberg: { bbox: '14.755,47.214,14.775,47.228', way: '289111668', seed: [0.004265, 1116430.59, 5219731.35] },
    montreal: { bbox: '-73.535,45.493,-73.515,45.516', way: '413000959', seed: [-0.017425, -5736215.10, 5029581.54] },
    hungaroring: { bbox: '19.240,47.575,19.256,47.588', way: '231417580', seed: [0.022517, 1445386.07, 5259347.85] },
    // Monaco: OSM lacks the pit lane along the start straight (2023 race cars in the pits: right of the track, ~11 m out)
    monaco: { bbox: '7.410,43.725,7.435,43.745', way: ['850261588', { follow: 1, offsetM: 11 }, '1388331347'] },
    imola: { bbox: '11.700,44.335,11.725,44.350', way: '196368195' },
    buddh: { bbox: '77.528,28.340,77.542,28.360', way: '188019426' }, // from the T16 exit to T1, beside the main straight
};

function parseOsm(xml, keep = []) {
    const nodes = {};
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes[m[1]] = [+m[2], +m[3]];
    const ways = [];
    for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
        const tags = {};
        for (const t of m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
        if ((tags.highway !== 'raceway' && !keep.includes(m[1])) || tags.area === 'yes') continue;
        ways.push({ id: m[1], tags, nds: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(x => nodes[x[1]]).filter(Boolean) });
    }
    return ways;
}

// No seed yet: try a rotation every 5° (centroids matched) and keep the best fit
function search(P, Q) {
    const mean = (A) => A.reduce((m, p) => [m[0] + p[0] / A.length, m[1] + p[1] / A.length], [0, 0]);
    const mp = mean(P), mq = mean(Q);
    let best = null;
    for (let d = 0; d < 360; d += 5) {
        const th = (d * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
        const f = align(P, Q, [th, mq[0] - (c * mp[0] - s * mp[1]), mq[1] - (s * mp[0] + c * mp[1])]);
        if (!best || f.median < best.median) best = f;
    }
    console.log(`  seed: [${best.theta.toFixed(6)}, ${best.tx.toFixed(2)}, ${best.ty.toFixed(2)}]`);
    return best;
}

async function cached(file, url) {
    const f = path.join(CACHE, file);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    let res;
    for (let tries = 1; ; tries++) { // public Overpass servers answer 429/504 when busy
        res = await fetch(url, { headers: { 'User-Agent': 'LanRace pit lane importer (one-off)' } });
        if (res.ok || tries === 5 || ![429, 502, 503, 504].includes(res.status)) break;
        await new Promise((r) => setTimeout(r, 15000 * tries));
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(f, text);
    return text;
}

async function importPit(src) {
    const cfg = PITS[src.id];
    const pitWays = [].concat(cfg.way).filter((w) => typeof w === 'string');
    const ways = parseOsm(await cached(`${src.id}.osm`, osmUrl(cfg.bbox, pitWays)), pitWays);
    const all = ways.flatMap(w => w.nds);
    const csv = src.local ? fs.readFileSync(src.local, 'utf8') : await cached(`${src.file}.csv`, BASE + src.file + '.csv');
    // A centreline built from OSM (osm-centreline.js) is already in OSM metres: same projection, nothing to fit
    const own = /lat0=([-\d.]+)/.exec(csv);
    const lat0 = own ? +own[1] : all.reduce((s, p) => s + p[0], 0) / all.length;
    const toXY = ([la, lo]) => [lo * 111320 * Math.cos(lat0 * Math.PI / 180), la * 110540];
    const isPit = (w) => /pit/i.test((w.tags.name || '') + (w.tags['name:en'] || '') + (w.tags.service || '') + (w.tags.raceway || ''));
    const Q = ways.filter(w => !isPit(w)).flatMap(w => densify(w.nds.map(toXY), 4));

    const P = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(',').map(Number)).map(r => [r[0], r[1]]);

    const origin = /origin=([-\d.]+),([-\d.]+)/.exec(csv); // centreline shifted to the origin by this much
    const fit = own ? { theta: 0, tx: origin ? +origin[1] : 0, ty: origin ? +origin[2] : 0, median: 0 } : cfg.seed ? align(P, Q, cfg.seed) : search(P, Q);
    if (!(fit.median <= MAX_FIT_M)) throw new Error(`${src.id}: OSM fit ${fit.median.toFixed(2)} m > ${MAX_FIT_M} m`);

    // One way, or several joined end to end (Monaco: pit lane + pit exit)
    // A gap OSM lacks can be filled by { follow: 1 (right) / -1 (left), offsetM }: alongside the track's centreline at that
    // offset, from the lane so far (where it is still beside the track) to the next way (where it is beside it again)
    const c = Math.cos(fit.theta), s = Math.sin(fit.theta);
    const toTum = ([x, y]) => { const dx = x - fit.tx, dy = y - fit.ty; return [c * dx + s * dy, -s * dx + c * dy]; };
    const nearestP = (q) => { let bi = 0, bd = Infinity; P.forEach((p, i) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); return [bi, Math.sqrt(bd)]; };
    let xy = [], follow = null;
    for (const item of [].concat(cfg.way)) {
        if (typeof item === 'object') { follow = item; continue; }
        const way = ways.find(w => w.id === item);
        if (!way) throw new Error(`${src.id}: OSM way ${item} not found`);
        let w = way.nds.map(toXY).map(toTum);
        if (!xy.length) { xy = w; continue; }
        if (follow) {
            const beside = (q) => nearestP(q)[1] >= 0.7 * follow.offsetM;
            while (xy.length > 1 && !beside(xy.at(-1))) xy.pop(); // OSM merges it into the track early
            w = w.slice(Math.max(0, w.findIndex(beside)));
            const n = P.length, [a] = nearestP(xy.at(-1)), [b] = nearestP(w[0]);
            for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) {
                const p = P[i], q = P[(i + 1) % n], len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
                xy.push([p[0] + (follow.follow * (q[1] - p[1]) * follow.offsetM) / len, p[1] - (follow.follow * (q[0] - p[0]) * follow.offsetM) / len]); // y north: right = (dy, -dx)
            }
            xy = xy.concat(w);
            follow = null;
            continue;
        }
        // Listed in driving order, each drawn that way (one-way): carry on from the next way's point nearest the end so far
        const end = xy.at(-1), d = w.map((p) => Math.hypot(p[0] - end[0], p[1] - end[1])), j = d.indexOf(Math.min(...d));
        if (d[j] > 20) throw new Error(`${src.id}: OSM way ${item} doesn't join the pit lane`);
        xy = xy.concat(w.slice(j + 1));
    }
    let pit = densify(xy, 4);

    // Same direction as the track at the middle of the pit lane
    const m = pit.length >> 1;
    let ti = 0, bd = Infinity;
    P.forEach((p, i) => { const d = Math.hypot(p[0] - pit[m][0], p[1] - pit[m][1]); if (d < bd) { bd = d; ti = i; } });
    const t1 = P[(ti + 1) % P.length];
    if ((t1[0] - P[ti][0]) * (pit[m + 1][0] - pit[m][0]) + (t1[1] - P[ti][1]) * (pit[m + 1][1] - pit[m][1]) < 0) pit.reverse();

    pit = resample(pit, STEP_M);
    const file = path.join(OUT_DIR, `${src.id}.json`);
    const track = JSON.parse(fs.readFileSync(file, 'utf8'));
    pit = await fitToCars(src, pit, P, track.width / SCALE / WIDTH_MULT / 2);
    pit = smoothLane(pit);
    pit = clearOfRoad(pit, P, track.width / SCALE / 2); // last: room for the pit wall beside the drawn (widened) road
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

// The road is drawn WIDTH_MULT x the real width, so beside a tight pit straight (COTA, Zandvoort) it would cover the pit
// lane's inner edge and leave no room for the pit wall. Where the lane runs beside the track (not where it merges), move it
// out to drawn edge + wall clearance + half its width, tapering at ≤ 2.5 % so the lane stays smooth. P: TUMFTM centreline
// (m), smoothed as the game draws it (Track.js fair)
const PIT_CLEAR_M = 1;    // drawn track edge → pit lane edge
const PUSH_TAPER = 0.025; // m of push per m along the lane
const MERGE_M = 80;        // the lane's ends, where it runs into the track
function clearOfRoad(pit, P, drawnHalf) {
    P = fair(P.map(([x, y]) => ({ x, y })), 1).map(({ x, y }) => [x, y]);
    const need = drawnHalf + PIT_CLEAR_M + PIT_WIDTH_M / 2;
    const near = pit.map(([x, y]) => {
        let best = null;
        for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1)));
            const px = a[0] + t * ex, py = a[1] + t * ey, d = Math.hypot(x - px, y - py);
            if (!best || d < best.d) best = { d, nx: (x - px) / (d || 1), ny: (y - py) / (d || 1) };
        }
        return best;
    });
    // Beside the track = more than half a pit lane off the centreline (merging lanes overlap the road, and stay put)
    // (beside the track = all but the first and last MERGE_M, where the lane runs into the road and overlaps it, as it should)
    let along = 0;
    const at = pit.map((p, i) => (along += i ? Math.hypot(p[0] - pit[i - 1][0], p[1] - pit[i - 1][1]) : 0)), len = at[at.length - 1];
    const want = near.map((n, i) => (at[i] > MERGE_M && len - at[i] > MERGE_M ? Math.max(0, need - n.d) : 0));
    const push = want.map((_, i) => Math.max(...want.map((w, j) => w - Math.abs(i - j) * STEP_M * PUSH_TAPER)));
    const max = Math.max(...push);
    if (max > 0) console.log(`  pit lane moved out up to ${max.toFixed(1)} m to clear the drawn track`);
    // Each point's own direction (away from its nearest bit of track) fans out near a bend: neighbours moving apart or
    // together left kinks the pit wall poked through. The push vectors are averaged along the lane (±PUSH_BLEND points)
    const PUSH_BLEND = 4, vx = push.map((d, i) => near[i].nx * d), vy = push.map((d, i) => near[i].ny * d);
    const avg = (v, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - PUSH_BLEND); k <= Math.min(v.length - 1, i + PUSH_BLEND); k++) { s += v[k]; c++; } return s / c; };
    return pit.map(([x, y], i) => [x + avg(vx, i), y + avg(vy, i)]);
}

// Where the race cars drove in the pit lane is the real lane (F1 live timing positions of cars off the track, near the
// pit lane): each point moves to the middle of the cars that passed it, by at most FIT_MAX_M, where at least FIT_MIN of
// them did. Lanes OSM drew off (Spa's, Spielberg's exits) come right; the rest barely move. P: centreline, TUM frame
const FIT_NEAR_M = 12, FIT_ALONG_M = 4, FIT_MIN = 15, FIT_MAX_M = 8;
async function fitToCars(src, pit, P, realHalf) {
    let data;
    try { data = await fitF1(src); } catch (e) { console.log(`  ${src.id}: no F1 positions (${e.message}), lane as drawn`); return pit; }
    const near = nearestIndex(densify([...P, P[0]], 1)), lane = nearestIndex(pit);
    const cars = [];
    for (const s of data.S) {
        const g = data.fit.tr(s), q = [g.x, -g.y]; // fitF1: game frame metres (y down) → TUM (y north)
        if (near(q)[1] < realHalf + 3) continue; // on the track
        if (lane(q)[1] < FIT_NEAR_M) cars.push(q);
    }
    const CELL = FIT_NEAR_M, grid = new Map(), key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    for (const c of cars) { const k = key(c[0], c[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
    const n = pit.length, normal = pit.map((p, i) => {
        const a = pit[Math.max(0, i - 1)], b = pit[Math.min(n - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    });
    // sideways offset to the cars' middle per point (null: too few cars), the ends 0 (they join the track where OSM says)
    const off = pit.map((p, i) => {
        if (i < 3 || i > n - 4) return 0;
        const [tx, ty] = normal[i], offs = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const c of grid.get(`${Math.floor(p[0] / CELL) + dx},${Math.floor(p[1] / CELL) + dy}`) || []) {
            const ex = c[0] - p[0], ey = c[1] - p[1];
            if (Math.abs(ex * tx + ey * ty) <= FIT_ALONG_M && Math.hypot(ex, ey) <= FIT_NEAR_M) offs.push(-ty * ex + tx * ey);
        }
        if (offs.length < FIT_MIN) return null;
        offs.sort((x, y) => x - y);
        return Math.max(-FIT_MAX_M, Math.min(FIT_MAX_M, offs[offs.length >> 1]));
    });
    // gaps bridged linearly, then averaged over ±FIT_BLEND points: the lane bends into the fitted stretch, no steps
    const known = off.map((o, i) => (o === null ? -1 : i)).filter((i) => i >= 0);
    const filled = off.map((o, i) => {
        if (o !== null) return o;
        const a = [...known].reverse().find((k) => k < i), b = known.find((k) => k > i);
        return off[a] + ((off[b] - off[a]) * (i - a)) / (b - a);
    });
    const FIT_BLEND = 5, smooth = filled.map((_, i) => { let s = 0, c = 0; for (let d = -FIT_BLEND; d <= FIT_BLEND; d++) { const k = i + d; if (k >= 0 && k < n) { s += filled[k]; c++; } } return i < 3 || i > n - 4 ? 0 : s / c; });
    const moved = Math.max(...smooth.map(Math.abs));
    const out = pit.map((p, i) => [p[0] - normal[i][1] * smooth[i], p[1] + normal[i][0] * smooth[i]]);
    console.log(`  ${src.id}: pit lane fitted to ${cars.length} race-car positions, moved up to ${moved.toFixed(1)} m`);
    return out;
}

// Kinks where OSM ways join, or where clearOfRoad's taper starts, made the lane jerk at speed: relax each point toward
// its neighbours' midpoint, never more than SMOOTH_MAX_M from where it was (the real layout stays), ends fixed
const SMOOTH_PASSES = 40, SMOOTH_MAX_M = 2.5;
function smoothLane(pit) {
    const orig = pit.map((p) => [...p]), out = pit.map((p) => [...p]);
    for (let k = 0; k < SMOOTH_PASSES; k++) {
        for (let i = 2; i < out.length - 2; i++) {
            const a = out[i - 1], b = out[i + 1], o = orig[i];
            let x = (out[i][0] + (a[0] + b[0]) / 2) / 2, y = (out[i][1] + (a[1] + b[1]) / 2) / 2;
            const d = Math.hypot(x - o[0], y - o[1]);
            if (d > SMOOTH_MAX_M) { x = o[0] + ((x - o[0]) * SMOOTH_MAX_M) / d; y = o[1] + ((y - o[1]) * SMOOTH_MAX_M) / d; }
            out[i] = [x, y];
        }
    }
    return out;
}

async function main() {
    fs.mkdirSync(CACHE, { recursive: true });
    for (const src of only(SOURCES)) await importPit(src);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { parseOsm, cached, osmUrl, CACHE, PITS, clearOfRoad };
