const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

let B;
before(async () => { B = await import('../public/js/sim/build.js'); });
const DATA = path.join(__dirname, '..', 'data', 'tracks');
const SURFACES = ['road', 'kerb', 'asphalt', 'paint', 'astroturf', 'grass', 'gravel'];
const STYLES = ['flat', 'serrated', 'sausage', 'negative', 'double'];
const BARRIERS = ['concrete', 'armco', 'tyres', 'tecpro', 'wall'];
const tracks = Track.loadAll();
const buildOf = (id) => tracks[id].build; // world units: the file, or generated

// Barriers drawn into a 1 m grid; a 4-connected fill from the start line must never reach the grid's border
function leaks(t, walls) {
    const cell = t.scale, pad = 500 * t.scale, xs = t.path.map((p) => p.x), ys = t.path.map((p) => p.y);
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    const w = Math.ceil((Math.max(...xs) + pad - x0) / cell), h = Math.ceil((Math.max(...ys) + pad - y0) / cell);
    const g = new Uint8Array(w * h), at = (x, y) => Math.floor((y - y0) / cell) * w + Math.floor((x - x0) / cell);
    for (const wl of walls) for (let i = 0; i + 1 < wl.pts.length; i++) {
        const a = wl.pts[i], b = wl.pts[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 4)) + 1;
        for (let k = 0; k <= n; k++) g[at(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)] = 1;
    }
    const stack = [at(t.start.x, t.start.y)];
    while (stack.length) {
        const c = stack.pop();
        if (g[c]) continue;
        g[c] = 2;
        const cx = c % w, cy = (c / w) | 0;
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) return { x: (x0 + cx * cell) / t.scale, y: (y0 + cy * cell) / t.scale };
        stack.push(c - 1, c + 1, c - w, c + w);
    }
    return null;
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: build data follows the schema`, () => {
        const b = buildOf(id);
        for (const s of b.surfaces) { assert.ok(SURFACES.includes(s.kind), s.kind); assert.ok(s.poly.length >= 3); assert.ok(s.src, 'surface src'); }
        for (const k of b.kerbs) { assert.ok(STYLES.includes(k.style), k.style); assert.ok(['R', 'L'].includes(k.side)); assert.ok(k.w > 0 && k.fromM !== k.toM); assert.ok(k.src); }
        for (const w of b.barriers) { assert.ok(BARRIERS.includes(w.kind), w.kind); assert.ok(w.pts.length >= 2 && w.h > 0 && w.fence >= 0); assert.ok(w.src); }
        assert.ok(b.barriers.length > 0);
    });

    test(`${id}: walls contain the track`, () => {
        const t = tracks[id], b = buildOf(id);
        const leak = leaks(t, [...b.barriers, ...(t.pit ? [{ pts: t.pit.wall }] : [])]);
        assert.strictEqual(leak, null, `${id}: the fill reaches the edge near ${JSON.stringify(leak)} m`);
    });

    test(`${id}: no barrier on the road`, () => {
        const t = tracks[id], raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8')), b = buildOf(id);
        for (const w of b.barriers) for (const p of w.pts) {
            const n = Physics.nearestOnTrack(p.x, p.y, t), half = Math.max(...raw.edges[n.i]) * t.scale; // the real road there
            assert.ok(n.dist > half, `${id}: barrier at ${p.x / t.scale},${-p.y / t.scale} m on the road`);
        }
    });
}

// Monza as built in 2026 (docs/superpowers/research/2026-10-17-track-surface/circuits-a.md §1): apexes in metres past the
// start line, measured once off Track.load('monza') (curvature peaks), turn direction R/L
test('monza build matches the research', () => {
    const t = tracks.monza, b = t.build, P = t.path, n = P.length, sc = t.scale, total = t.cum[n];
    const at = (m) => { const s = (t.startS + m * sc) % total; let i = 0; while (t.cum[i + 1] < s) i++; return i; };
    const nrm = (i) => { const a = P[(i - 1 + n) % n], c = P[(i + 1) % n], l = Math.hypot(c.x - a.x, c.y - a.y); return [-(c.y - a.y) / l, (c.x - a.x) / l]; }; // + = right
    const out = (m, side, offM) => { const i = at(m), [nx, ny] = nrm(i), e = (side > 0 ? t.edgeR : t.edgeL)[i] + offM * sc; return { x: P[i].x + side * nx * e, y: P[i].y + side * ny * e }; };
    const inside = (q, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], d = poly[i]; if ((a.y > q.y) !== (d.y > q.y) && q.x < a.x + ((q.y - a.y) * (d.x - a.x)) / (d.y - a.y)) c = !c; } return c; };
    const kindAt = (q) => { let k = 'grass'; for (const s2 of b.surfaces) if (inside(q, s2.poly)) k = s2.kind; return k; };
    // a polygon of `kind` beside the corner: a vertex on the given side, from `before` m ahead of the apex to `after` past it,
    // within `maxOff` m of the white line (traps lie straight on from the entry, not square to the apex)
    const lapOf = (q) => { const nr = Physics.nearestOnTrack(q.x, q.y, t); return { nr, m: ((((t.cum[nr.i] + nr.t * (t.cum[nr.i + 1] - t.cum[nr.i]) - t.startS) % total) + total) % total) / sc }; };
    const near = (kind, apex, side, before = 80, after = 40, maxOff = 80) => b.surfaces.some((s2) => s2.kind === kind && s2.poly.some((q) => {
        const { nr, m } = lapOf(q), a2 = P[nr.i], c = P[(nr.i + 1) % n], sd = -(c.y - a2.y) * (q.x - nr.px) + (c.x - a2.x) * (q.y - nr.py) > 0 ? 1 : -1;
        return sd === side && m >= apex - before && m <= apex + after && nr.dist - Track.edgeAt(t, nr, q.x, q.y) < maxOff * sc;
    }));
    // gravel outside Roggia (T4, left-hander), both Lesmos (right), Ascari's T8 (left) and T10 (left)
    for (const [m, side, name] of [[2122, 1, 'T4'], [2535, -1, 'Lesmo 1'], [2860, -1, 'Lesmo 2'], [3929, 1, 'T8'], [4119, 1, 'T10']])
        assert.ok(near('gravel', m, side), `${name}: gravel on the outside`);
    // Alboreto: asphalt run-off outside (left of the right-hander), with gravel at the track edge; Rettifilo escape road asphalt
    assert.strictEqual(kindAt(out(5198, -1, 25)), 'asphalt', 'Alboreto run-off');
    assert.strictEqual(kindAt(out(5198, -1, 3)), 'gravel', 'Alboreto gravel strip at the edge');
    assert.ok(near('asphalt', 990, 1, 60, 60), 'Rettifilo escape road (right of T1-T2, paved, block rows)');
    // negative kerbs from the 100 m board before T1 (left), T4 (right), T8 (right)
    for (const [m, side] of [[907, 'L'], [2122, 'R'], [3929, 'R']])
        assert.ok(b.kerbs.some((k) => k.style === 'negative' && k.side === side && Math.abs(k.fromM - (m - 100)) <= 15), `negative kerb before ${m} m`);
    // the 2026 wall and debris fence on the left of the main straight
    const left = out(300, -1, 0), d = (w) => Math.min(...w.pts.map((q) => Math.hypot(q.x - left.x, q.y - left.y)));
    assert.ok(b.barriers.some((w) => w.fence >= 3 && w.kind === 'concrete' && d(w) < 40 * sc), 'wall and fence left of the main straight');
    // pit entry: the blue gore and yellow bollard
    assert.ok(b.features.some((f) => f.type === 'gore' && f.mouth === 'entry') && b.features.some((f) => f.type === 'bollard' && f.mouth === 'entry'));
    assert.ok(b.sources.length > 1 && b.unconfirmed.length > 0, 'sources and unconfirmed items carried');
});
