// Road height and shape (real elevation, F1 telemetry), shared by the physics (server + browser prediction) and the
// renderer. Track: z (m per centreline point), grade (rise per metre along the lap) and vcurv (vertical curvature, 1/m,
// + = compression, − = crest) per point from Track.build.

const HINT_WINDOW = 10; // segments (~100 m) either side of a car's last road point

// Centreline segment under (x, y). With a heading, a segment crossing it (the other level at Suzuka's bridge) is
// penalised, so a car stays on its own road; without one, plain nearest.
// hint: the segment this car was on last time; then only nearby segments count, so a car sliding sideways across the
// bridge keeps its own level (a far-off hint, after a reset, falls back to the full search)
export function roadAt(t, x, y, angle, hint) {
    const P = t.path, n = P.length, ca = Math.cos(angle ?? 0), sa = Math.sin(angle ?? 0);
    if (hint !== undefined && hint !== null) {
        let best = Infinity, bi = 0, bt = 0;
        for (let k = -HINT_WINDOW; k <= HINT_WINDOW; k++) {
            const i = (((hint + k) % n) + n) % n, a = P[i], b = P[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
            const f = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0, d = Math.hypot(x - a.x - f * ex, y - a.y - f * ey);
            if (d < best) { best = d; bi = i; bt = f; }
        }
        if (best <= t.width * 2) return { i: bi, f: bt };
    }
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
        const k = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0;
        let s = Math.hypot(x - a.x - k * ex, y - a.y - k * ey);
        if (angle !== undefined) s += t.width * (1 - Math.abs((ex * ca + ey * sa) / (Math.sqrt(l2) || 1)));
        if (s < best) { best = s; bi = i; bt = k; }
    }
    return { i: bi, f: bt };
}

const lerp = (arr, i, f) => arr[i] + (arr[(i + 1) % arr.length] - arr[i]) * f;

// Road height (m) under (x, y), and the gradient (m per m) along that segment as a world-direction vector
export function heightAt(t, x, y, angle, hint) {
    if (!t.z) return { h: 0, sx: 0, sy: 0 };
    const { i, f } = roadAt(t, x, y, angle, hint), P = t.path, j = (i + 1) % P.length;
    const a = P[i], b = P[j], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, g = (t.z[j] - t.z[i]) / (len / t.scale);
    return { h: t.z[i] + (t.z[j] - t.z[i]) * f, sx: (g * (b.x - a.x)) / len, sy: (g * (b.y - a.y)) / len, i };
}

// Height (m) of each point of a path beside the track (the pit lane): the road beside it, followed from point to point
// like a car's road, so a stretch passing near another part of the track (Interlagos) keeps to its own road's height
// Then smoothed along the lane (it has no steps of its own where the road beside it changes, Spielberg / Interlagos):
// a median over ±2 points, a mean over ±6 (~30 m), the window shrinking at the ends so they still meet the track
const PATH_MEDIAN = 2, PATH_MEAN = 6;
export function pathHeights(t, path) {
    let hint;
    const raw = path.map((p, k) => {
        const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
        const r = heightAt(t, p.x, p.y, Math.atan2(b.y - a.y, b.x - a.x), hint);
        hint = r.i;
        return r.h;
    });
    const n = raw.length, win = (A, k, w) => A.slice(k - Math.min(w, k, n - 1 - k), k + Math.min(w, k, n - 1 - k) + 1);
    const med = raw.map((_, k) => { const s = win(raw, k, PATH_MEDIAN).sort((x, y) => x - y); return s[s.length >> 1]; });
    return med.map((_, k) => { const s = win(med, k, PATH_MEAN); return s.reduce((x, y) => x + y, 0) / s.length; });
}

// For the car physics: slope and vertical curvature felt along heading `angle` (grade < 0 = downhill ahead)
export function slopeAt(t, x, y, angle, hint) {
    if (!t.grade) return { grade: 0, vcurv: 0 };
    const { i, f } = roadAt(t, x, y, angle, hint), P = t.path, b = P[(i + 1) % P.length];
    const d = Math.atan2(b.y - P[i].y, b.x - P[i].x), c = Math.cos(angle - d);
    return { grade: lerp(t.grade, i, f) * c, vcurv: lerp(t.vcurv, i, f) * c * c, i };
}

// Track.build: grade and vertical curvature per point from z, over ~20 m and ~60 m baselines (the data is a median of
// GPS samples: second differences need the longer span to stay out of the noise)
export function profile(z, cum, scale) {
    const n = z.length, total = cum[n];
    const dist = (i, j) => ((((cum[(j + n) % n] - cum[(i + n) % n]) % total) + total) % total) / scale;
    const at = (a, i) => a[((i % n) + n) % n];
    const grade = z.map((_, i) => (at(z, i + 2) - at(z, i - 2)) / (dist(i - 2, i + 2) || 1));
    const vcurv = z.map((_, i) => (at(grade, i + 3) - at(grade, i - 3)) / (dist(i - 3, i + 3) || 1));
    return { grade: grade.map((g) => +g.toFixed(4)), vcurv: vcurv.map((k) => +k.toFixed(5)) };
}
