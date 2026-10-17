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
