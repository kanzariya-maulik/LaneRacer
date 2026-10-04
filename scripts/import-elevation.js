// One-off importer: node scripts/import-elevation.js (after import-tracks.js)
// Real road height from F1 live timing: every car's X/Y/Z position through the 2023 race (decimetres, F1's own frame).
// The official track outline (MultiViewer, same frame) is fitted onto our centreline; each car sample is matched to the
// centreline by lap progress (so Suzuka's bridge keeps its two levels), and each point takes the median height.
// Stored as z (metres above the lowest point) in data/tracks/<id>.json.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { SCALE, SOURCES, only } = require('./import-tracks');

const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks');
const CACHE = path.join(__dirname, 'build', 'f1');
const F1 = { // MultiViewer circuit key, race session in the F1 live timing archive, year (2023 unless given)
    monza: [39, '2023-09-03_Italian_Grand_Prix/2023-09-03_Race'],
    spa: [7, '2023-07-30_Belgian_Grand_Prix/2023-07-30_Race'],
    silverstone: [2, '2023-07-09_British_Grand_Prix/2023-07-09_Race'],
    suzuka: [46, '2023-09-24_Japanese_Grand_Prix/2023-09-24_Race'],
    sakhir: [63, '2023-03-05_Bahrain_Grand_Prix/2023-03-05_Race'],
    interlagos: [14, '2023-11-05_São_Paulo_Grand_Prix/2023-11-05_Race'],
    cota: [9, '2023-10-22_United_States_Grand_Prix/2023-10-22_Race'],
    zandvoort: [55, '2023-08-27_Dutch_Grand_Prix/2023-08-27_Race'],
    spielberg: [19, '2023-07-02_Austrian_Grand_Prix/2023-07-02_Race'],
    montreal: [23, '2023-06-18_Canadian_Grand_Prix/2023-06-18_Race'],
    hungaroring: [4, '2023-07-23_Hungarian_Grand_Prix/2023-07-23_Race'],
    monaco: [22, '2023-05-28_Monaco_Grand_Prix/2023-05-28_Race'],
    imola: [6, '2024-05-19_Emilia_Romagna_Grand_Prix/2024-05-19_Race', 2024], // no 2023 race (cancelled)
};
const MAX_FIT_M = 5;       // outline fit (RMS)
const OFF_MARGIN_M = 5;    // a car sample further than the real half-width plus this from the centreline is in the pits or off track
const WINDOW = 30;         // points (~300 m) searched around a car's last match: keeps it on its own level at a bridge
const SMOOTH = 2;          // points each side, after the median
const ATTRIBUTION = (year) => `Elevation: F1 live timing car positions (${year} race)`;

async function cached(name, url) {
    const f = path.join(CACHE, name);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(f, text);
    return text;
}

// Best similarity transform (rotation, scale, translation, optional mirror) taking B onto A, point pairs in order
function similarity(A, B) {
    let best = null;
    for (const r of [1, -1]) {
        const Bb = B.map((p) => ({ x: p.x, y: r * p.y })), N = A.length;
        const ma = { x: 0, y: 0 }, mb = { x: 0, y: 0 };
        for (let i = 0; i < N; i++) { ma.x += A[i].x / N; ma.y += A[i].y / N; mb.x += Bb[i].x / N; mb.y += Bb[i].y / N; }
        let sxx = 0, sxy = 0, bb = 0;
        for (let i = 0; i < N; i++) {
            const ax = A[i].x - ma.x, ay = A[i].y - ma.y, bx = Bb[i].x - mb.x, by = Bb[i].y - mb.y;
            sxx += ax * bx + ay * by; sxy += ay * bx - ax * by; bb += bx * bx + by * by;
        }
        const th = Math.atan2(sxy, sxx), k = Math.hypot(sxx, sxy) / bb, c = Math.cos(th), s = Math.sin(th);
        const tr = (p) => { const bx = p.x - mb.x, by = r * p.y - mb.y; return { x: ma.x + k * (c * bx - s * by), y: ma.y + k * (s * bx + c * by) }; };
        let e = 0;
        for (let i = 0; i < N; i++) { const q = tr(B[i]); e += (q.x - A[i].x) ** 2 + (q.y - A[i].y) ** 2; }
        e = Math.sqrt(e / N);
        if (!best || e < best.e) best = { e, tr };
    }
    return best;
}

// Our centreline (metres) with the 2023 race's car samples fitted onto it; also used to measure lines and the grid
async function fitF1(src) {
    const [key, session, year = 2023] = F1[src.id];
    const file = path.join(OUT_DIR, `${src.id}.json`);
    const track = JSON.parse(fs.readFileSync(file, 'utf8'));
    const P = track.path.map((p) => ({ x: p.x / SCALE, y: p.y / SCALE })), n = P.length;
    const C = [0];
    for (let i = 1; i <= n; i++) C.push(C[i - 1] + Math.hypot(P[i % n].x - P[i - 1].x, P[i % n].y - P[i - 1].y));
    const L = C[n];
    const realHalf = track.width / SCALE / 1.5 / 2, MAX_OFF_M = realHalf + OFF_MARGIN_M; // import-tracks widened the real track 1.5x
    const pit = track.pit && track.pit.path.map((q) => ({ x: q.x / SCALE, y: q.y / SCALE }));
    const at = (m) => {
        m = ((m % L) + L) % L;
        let i = 0; while (C[i + 1] < m) i++;
        const a = P[i], b = P[(i + 1) % n], t = (m - C[i]) / (C[i + 1] - C[i] || 1);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };

    // Official outline onto our centreline: same lap fraction â†” same place, best start offset
    const mv = JSON.parse(await cached(year === 2023 ? `mv-${key}.json` : `mv-${key}-${year}.json`, `https://api.multiviewer.app/api/v1/circuits/${key}/${year}`));
    const M = mv.x.map((x, i) => ({ x: x / 10, y: mv.y[i] / 10 }));
    const mc = [0];
    for (let i = 1; i < M.length; i++) mc.push(mc[i - 1] + Math.hypot(M[i].x - M[i - 1].x, M[i].y - M[i - 1].y));
    const ML = mc.at(-1) + Math.hypot(M[0].x - M.at(-1).x, M[0].y - M.at(-1).y);
    let fit = null;
    for (let o = -400; o <= 400; o += 5) {
        const A = [], B = [];
        for (let i = 0; i < M.length; i += 2) { A.push(at(o + (mc[i] / ML) * L)); B.push(M[i]); }
        const f = similarity(A, B);
        if (!fit || f.e < fit.e) fit = f;
    }
    // Car samples (metres, F1 frame). At some circuits (Suzuka) the feed sits ~15 m off the outline, so refine on these
    const raw = await cached(`${src.id}-position.txt`, `https://livetiming.formula1.com/static/${year}/${encodeURI(session)}/Position.z.jsonStream`);
    const S = [];
    for (const line of raw.split('\n')) {
        const q = line.indexOf('"');
        if (q < 0) continue;
        const data = JSON.parse(zlib.inflateRawSync(Buffer.from(line.slice(q + 1, line.lastIndexOf('"')), 'base64')).toString());
        for (const snap of data.Position) for (const [car, e] of Object.entries(snap.Entries)) {
            if (e.Status === 'OnTrack' && (e.X || e.Y || e.Z)) S.push({ car, t: Date.parse(snap.Timestamp), x: e.X / 10, y: e.Y / 10, z: e.Z / 10 });
        }
    }
    // Refine (trimmed ICP): pair car samples with the nearest centreline point under the current fit, drop the worst
    // 20 % (pit lane, run-offs), solve again
    const nearest = (q) => {
        let best = null, bd = Infinity;
        for (let i = 0; i < n; i++) {
            const a = P[i], b = P[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
            const x = a.x + t * ex, y = a.y + t * ey, d = (x - q.x) ** 2 + (y - q.y) ** 2;
            if (d < bd) { bd = d; best = { x, y }; }
        }
        return best;
    };
    const sub = S.filter((_, i) => i % Math.max(1, Math.floor(S.length / 4000)) === 0);
    for (let it = 0; it < 15; it++) {
        const pairs = sub.map((p) => { const q = nearest(fit.tr(p)), r = fit.tr(p); return { p, q, d: Math.hypot(q.x - r.x, q.y - r.y) }; })
            .sort((a, b) => a.d - b.d).slice(0, Math.floor(sub.length * 0.8));
        const f = similarity(pairs.map((x) => x.q), pairs.map((x) => x.p));
        if (f.e >= fit.e - 0.01 && it > 0) break;
        fit = f;
    }
    if (!(fit.e <= MAX_FIT_M)) throw new Error(`${src.id}: fit ${fit.e.toFixed(1)} m > ${MAX_FIT_M} m`);
    return { file, track, P, C, L, n, M, S, fit, realHalf, MAX_OFF_M, pit };
}

async function importElevation(src) {
    const { file, track, P, n, S, fit, realHalf, MAX_OFF_M, pit } = await fitF1(src);

    // Every car sample â†’ nearest centreline point near that car's last one, height into that point's bucket
    const buckets = Array.from({ length: n }, () => []), hint = {}, last = {};
    let used = 0, skipped = 0;
    for (const s of S) {
        const p = fit.tr(s);
        let bi = -1, bd = Infinity;
        const h = hint[s.car], from = h === undefined ? 0 : h - WINDOW, count = h === undefined ? n : 2 * WINDOW + 1;
        for (let k = 0; k < count; k++) {
            const i = (((from + k) % n) + n) % n, d = (P[i].x - p.x) ** 2 + (P[i].y - p.y) ** 2;
            if (d < bd) { bd = d; bi = i; }
        }
        if (Math.sqrt(bd) > MAX_OFF_M + 6) { delete hint[s.car]; skipped++; continue; } // lost (pits, retired): search afresh
        hint[s.car] = bi;
        if (Math.sqrt(bd) > MAX_OFF_M) { skipped++; continue; }
        // Beyond the real track edge, a car nearer the pit lane than the track is in the pits (Spa: the pit exit runs
        // alongside the descent to Eau Rouge, at another height)
        if (pit && Math.sqrt(bd) > realHalf && pit.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < bd)) { skipped++; continue; }
        if (last[s.car] === bi) continue; // one sample per car per pass: a parked car must not outvote the field
        last[s.car] = bi;
        buckets[bi].push(s.z);
        used++;
    }

    // Median per point, gaps bridged linearly, light smoothing
    // A point with only a few samples (cars that lost their place) is a gap, not a height
    const minCount = 0.1 * buckets.map((b) => b.length).sort((a, c) => a - c)[n >> 1];
    const med = buckets.map((b) => (b.length >= minCount ? b.sort((a, c) => a - c)[b.length >> 1] : null));
    const known = med.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
    if (known.length < n * 0.9) throw new Error(`${src.id}: only ${known.length}/${n} points have car data`);
    const filled = med.map((v, i) => {
        if (v !== null) return v;
        const a = [...known].reverse().find((k) => k < i) ?? known.at(-1) - n, b = known.find((k) => k > i) ?? known[0] + n;
        const za = med[((a % n) + n) % n], zb = med[b % n];
        return za + ((zb - za) * (i - a)) / (b - a);
    });
    const sm = filled.map((_, i) => { let s = 0; for (let d = -SMOOTH; d <= SMOOTH; d++) s += filled[(i + d + n) % n]; return s / (2 * SMOOTH + 1); });
    const lo = Math.min(...sm);
    track.z = sm.map((v) => +(v - lo).toFixed(2)); // cm: crests and compressions come from second differences
    track.attribution = (track.attribution || '').replace(/; Elevation:.*$/, '') + `; ${ATTRIBUTION(F1[src.id][2] || 2023)}`;
    fs.writeFileSync(file, JSON.stringify(track));
    const counts = buckets.map((b) => b.length).sort((a, c) => a - c);
    console.log(`${src.id}: fit ${fit.e.toFixed(1)} m, ${used} samples (${skipped} off track), median ${counts[n >> 1]} per point, ${n - known.length} gaps, range ${Math.max(...track.z).toFixed(1)} m`);
}

async function main() {
    fs.mkdirSync(CACHE, { recursive: true });
    for (const src of only(SOURCES)) await importElevation(src);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { fitF1 };
