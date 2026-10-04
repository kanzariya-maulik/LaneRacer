// Geometry shared by the track importers: polyline densify / resample, nearest point lookup, trimmed ICP (metres)

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

module.exports = { densify, resample, nearestIndex, align };
