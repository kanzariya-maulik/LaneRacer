const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');

let S, E;
before(async () => { S = await import('../public/js/scenery.js'); E = await import('../public/js/sim/elevation.js'); });
const tracks = Track.loadAll();

for (const id of Track.TRACK_IDS) {
    test(`${id}: scenery stays clear of the track and pit lane`, () => {
        const t = tracks[id], out = S.placeScenery(t, 1, S.seedOf(id));
        const clear = t.width / 2 + t.wallOffset + 3 * t.scale; // past the barrier
        for (const o of [...out.grandstands, ...out.trees, ...out.billboards, ...out.buildings, ...out.posts, ...out.floodlights, ...out.boards, ...(out.landmark ? [out.landmark] : [])]) {
            assert.ok(Physics.nearestOnTrack(o.x, o.y, t).dist > clear, `${id}: object on or near the track at ${o.x},${o.y}`);
            if (t.pit) assert.ok(Physics.nearestOnPath(o.x, o.y, t.pit.path, false).dist > t.pit.width / 2 + 6 * t.scale, `${id}: object in the pit lane`);
        }
        // Whole grandstand footprint (60 m long, 12 m deep), not just its centre
        for (const g of out.grandstands) for (let a = -30; a <= 30; a += 5) for (const d of [-6, 6]) {
            const x = g.x + (Math.cos(g.angle) * a - Math.sin(g.angle) * d) * t.scale, y = g.y + (Math.sin(g.angle) * a + Math.cos(g.angle) * d) * t.scale;
            assert.ok(Physics.nearestOnTrack(x, y, t).dist > clear, `${id}: grandstand reaches the track at ${x},${y}`);
            if (t.pit) assert.ok(Physics.nearestOnPath(x, y, t.pit.path, false).dist > t.pit.width / 2 + 6 * t.scale, `${id}: grandstand over the pit lane`);
        }
        // Whole building footprints (w × d m)
        for (const b of out.buildings) for (const a of [-b.w / 2, b.w / 2]) for (const d of [-b.d / 2, b.d / 2]) {
            const x = b.x + (Math.cos(b.angle) * a - Math.sin(b.angle) * d) * t.scale, y = b.y + (Math.sin(b.angle) * a + Math.cos(b.angle) * d) * t.scale;
            assert.ok(Physics.nearestOnTrack(x, y, t).dist > clear, `${id}: building reaches the track at ${x},${y}`);
        }
        assert.ok(out.grandstands.length >= 2, 'grandstands at the main straight and slow corners');
        // Night: light towers lining the lap, so no stretch of road is left dark
        const lapM = t.cum[t.path.length] / t.scale;
        assert.ok(out.floodlights.length >= lapM / 120, `${id}: ${out.floodlights.length} light towers for ${Math.round(lapM)} m`);
        assert.ok(out.trees.length > 50 && out.billboards.length > 3);
        assert.ok(out.slowCorners.length >= 2);
    });
}

// Same offsets as game3d.js offsetPoints: normal from the previous and next points
function offsetPoints(P, off) {
    const n = P.length;
    return P.map((p, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, o = typeof off === 'number' ? off : off[i];
        return { x: p.x - ((b.y - a.y) / l) * o, y: p.y + ((b.x - a.x) / l) * o };
    });
}
// Points on the asphalt every 3 m: { x, y, h (road height, m), i (segment) }
function asphalt(t, fn) {
    const P = t.path, n = P.length, half = t.width / 2;
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        for (let s = 0; s < len; s += 3 * t.scale) for (let l = -half * 0.9; l <= half * 0.9; l += 3 * t.scale) {
            const f = s / len;
            fn({ x: a.x + (b.x - a.x) * f + nx * l, y: a.y + (b.y - a.y) * f + ny * l, h: t.z[i] + (t.z[(i + 1) % n] - t.z[i]) * f, i });
        }
    }
}

for (const id of Track.TRACK_IDS) {
    test(`${id}: no grass verge lies over any asphalt (hairpins, bridges, slopes)`, () => {
        const t = tracks[id], P = t.path, n = P.length, half = t.width / 2, CELL = 20 * t.scale, grid = new Map();
        const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        for (const dir of [1, -1]) {
            const A = offsetPoints(P, dir * half), B = offsetPoints(P, S.vergeReach(t, dir).map((r) => dir * r));
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n, h = Math.max(t.z[i], t.z[j]);
                for (const tri of [[A[i], B[i], B[j]], [A[i], B[j], A[j]]]) {
                    const xs = tri.map((p) => p.x), ys = tri.map((p) => p.y);
                    for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++)
                        for (let cy = Math.floor(Math.min(...ys) / CELL); cy <= Math.floor(Math.max(...ys) / CELL); cy++) {
                            const k = `${cx},${cy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push({ tri, h, i });
                        }
                }
            }
        }
        const side = (p, a, b) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
        const inside = (p, [a, b, c]) => { const d = [side(p, a, b), side(p, b, c), side(p, c, a)]; return !(d.some((v) => v < 0) && d.some((v) => v > 0)); };
        const bad = [];
        asphalt(t, (p) => {
            // the verge is drawn 0.05 m under the asphalt (0.3 vs 0.6 world units): higher than that and it shows
            for (const v of grid.get(key(p.x, p.y)) || []) if (v.h > p.h + 0.05 && inside(p, v.tri)) { bad.push(Math.round(t.cum[p.i] / t.scale)); break; }
        });
        assert.deepStrictEqual([...new Set(bad)], [], `${id}: grass over the road at metres`);
    });

    // The ground as game3d.js builds it: banked between roads, 256 x 256 grid, pressed down under asphalt and kerbs
    const ground = (() => {
        let g = null;
        return () => {
            if (g) return g;
            const t = tracks[id], P = t.path, SEGS = 256;
            const xs = P.map((p) => p.x), ys = P.map((p) => p.y), gw = Math.max(...xs) - Math.min(...xs) + 8000, gh = Math.max(...ys) - Math.min(...ys) + 8000;
            const x0 = (Math.min(...xs) + Math.max(...xs) - gw) / 2, y0 = (Math.min(...ys) + Math.max(...ys) - gh) / 2, N = SEGS + 1, cw = gw / SEGS, ch = gh / SEGS;
            const vr = { 1: S.vergeReach(t, 1), [-1]: S.vergeReach(t, -1) };
            const H = S.terrainHeights(t, x0, y0, gw, gh, SEGS, S.terrainGround(t, vr), 0.6, S.carveReach(t, vr)); // as game3d
            const at = (x, y) => { // the triangle three.js draws there (cell corners a (0,0) b (0,1) c (1,1) d (1,0), split b-d)
                const u = (x - x0) / cw, v = (y - y0) / ch, ix = Math.floor(u), iy = Math.floor(v), fu = u - ix, fv = v - iy;
                const A = H[iy * N + ix], B = H[(iy + 1) * N + ix], Cc = H[(iy + 1) * N + ix + 1], D = H[iy * N + ix + 1];
                return fu + fv <= 1 ? A * (1 - fu - fv) + D * fu + B * fv : Cc * (fu + fv - 1) + B * (1 - fu) + D * (1 - fv);
            };
            return (g = { at, vr });
        };
    })();

    test(`${id}: the terrain never rises through the road`, () => {
        const { at } = ground();
        let worst = -Infinity;
        asphalt(tracks[id], (p) => { worst = Math.max(worst, at(p.x, p.y) - p.h); });
        assert.ok(worst < 0.05, `${id}: terrain ${worst.toFixed(2)} m above the road`);
    });

    test(`${id}: the pit lane is clear: no verge grass across it, the ground under it`, () => {
        const t = tracks[id], pit = t.pit, { at, vr } = ground(), over = [], verge = [], Z = E.pathHeights(t, pit.path);
        for (let i = 1; i < pit.path.length - 2; i++) {
            if (pit.cum[i] < pit.closeS) continue;
            const p = pit.path[i], q = pit.path[i + 1], ang = Math.atan2(q.y - p.y, q.x - p.x), surf = Z[i];
            for (const l of [-0.9, 0, 0.9]) {
                const o = (l * pit.width) / 2, x = p.x - Math.sin(ang) * o, y = p.y + Math.cos(ang) * o;
                if (at(x, y) > surf) over.push(Math.round(pit.cum[i] / t.scale));
                const nr = Physics.nearestOnTrack(x, y, t), a = t.path[nr.i], b = t.path[(nr.i + 1) % t.path.length];
                const side = -(b.y - a.y) * (x - a.x) + (b.x - a.x) * (y - a.y) > 0 ? 1 : -1;
                if (nr.dist > t.width / 2 && nr.dist < vr[side][nr.i]) verge.push(Math.round(pit.cum[i] / t.scale));
            }
        }
        assert.deepStrictEqual([...new Set(over)], [], `${id}: ground over the pit lane at metres`);
        assert.deepStrictEqual([...new Set(verge)], [], `${id}: verge grass across the pit lane at metres`);
    });

    test(`${id}: the run-off is at road level out to the verge edge (cars drive there; the barrier stands on it)`, () => {
        const t = tracks[id], P = t.path, n = P.length, { at, vr } = ground(), bad = [];
        for (let i = 0; i < n; i++) {
            const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], h = Math.atan2(b.y - a.y, b.x - a.x);
            for (const dir of [1, -1]) for (const f of [0.5, 1]) {
                const o = dir * (t.width / 2 + (vr[dir][i] - t.width / 2) * f), x = P[i].x - Math.sin(h) * o, y = P[i].y + Math.cos(h) * o;
                if (at(x, y) > t.z[i] + 0.05) bad.push(Math.round(t.cum[i] / t.scale));
            }
        }
        assert.deepStrictEqual([...new Set(bad)], [], `${id}: ground over the run-off at metres`);
    });

    test(`${id}: no road floats: just past every verge edge the ground is within the grass skirt or its retaining wall (bridges excepted)`, () => {
        const t = tracks[id], P = t.path, n = P.length, { at, vr } = ground(), bad = [], crossings = [];
        for (let i = 0; i < n; i++) for (let j = i + 3; j < n - (i === 0 ? 1 : 0); j++) { // where the track crosses itself
            const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n], r = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
            if (!r) continue;
            const u = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / r, v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / r;
            if (u >= 0 && u <= 1 && v >= 0 && v <= 1) crossings.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
        }
        const depth = { 1: S.skirtDepth(t, vr[1], 1, at), [-1]: S.skirtDepth(t, vr[-1], -1, at) }; // walls reach the drawn ground
        for (let i = 0; i < n; i++) {
            const a = P[i], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
            for (const dir of [1, -1]) {
                const o = dir * (vr[dir][i] + 1 * t.scale), x = a.x + nx * o, y = a.y + ny * o, near = Physics.nearestOnTrack(x, y, t);
                if (crossings.some((c) => Math.hypot(x - c.x, y - c.y) < 50 * t.scale)) continue; // at a bridge: open beneath
                if (depth[dir][i] === 0) continue; // the verge meets the pit lane: its asphalt carries on there
                if (t.z[i] - at(x, y) > depth[dir][i]) bad.push(Math.round(t.cum[i] / t.scale));
            }
        }
        assert.deepStrictEqual([...new Set(bad)], [], `${id}: roads floating at metres`);
        // Deep retaining walls only where a road runs along a hillside above another (Monaco) or onto a bridge (Suzuka's
        // approach embankments); open circuits get at most short ones where the ground falls away past the barrier
        const nearBridge = (i) => crossings.some((c) => Math.hypot(P[i].x - c.x, P[i].y - c.y) < 200 * t.scale);
        const deep = [1, -1].flatMap((dir) => depth[dir].map((d, i) => (d > 6 && !nearBridge(i) ? i : -1)).filter((i) => i >= 0));
        if (id !== 'monaco') assert.deepStrictEqual(deep.map((i) => Math.round(t.cum[i] / t.scale)), [], `${id}: retaining walls over 6 m deep at metres`);
    });
}
test('scenery is deterministic and scales with density', () => {
    const t = tracks.monza;
    assert.deepStrictEqual(S.placeScenery(t, 0.6, 42), S.placeScenery(t, 0.6, 42));
    const lo = S.placeScenery(t, 0.3, 42), hi = S.placeScenery(t, 1, 42);
    assert.ok(lo.trees.length < hi.trees.length * 0.5);
    assert.strictEqual(lo.grandstands.length, hi.grandstands.length, 'grandstands always placed');
    assert.notStrictEqual(S.seedOf('monza'), S.seedOf('spa'));
});

// game3d.js sets a car's wheel on the drawn terrain only past the verge: onVerge must agree with where the verge ends
test('onVerge: true out to the verge edge, false past it', () => {
    for (const id of ['monza', 'suzuka', 'interlagos']) {
        const t = tracks[id], P = t.path, n = P.length, vr = { 1: S.vergeReach(t, 1), [-1]: S.vergeReach(t, -1) };
        let inside = 0, outside = 0;
        for (let i = 0; i < n; i += 7) for (const dir of [1, -1]) {
            const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], h = Math.atan2(b.y - a.y, b.x - a.x);
            const at = (o) => ({ x: P[i].x - Math.sin(h) * dir * o, y: P[i].y + Math.cos(h) * dir * o });
            const r = vr[dir][i], q1 = at(r * 0.9), q2 = at(r + 3 * t.scale);
            assert.ok(S.onVerge(t, vr, q1.x, q1.y), `${id} point ${i}: inside the verge`);
            inside++;
            const near = Physics.nearestOnTrack(q2.x, q2.y, t);
            if (Math.abs(near.i - i) > 2) continue; // another stretch of road is nearer: its own verge decides
            assert.ok(!S.onVerge(t, vr, q2.x, q2.y), `${id} point ${i} side ${dir}: past the verge`);
            outside++;
        }
        assert.ok(inside > 50 && outside > 50, `${id}: ${inside} / ${outside} samples`);
    }
});

test('every circuit has a night: sky darker than its day, light towers to race by, a star field by its real light pollution', async () => {
    const { THEMES, SKIES, NIGHTS, nightOf } = await import('../public/js/themes.js');
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    for (const id of Track.TRACK_IDS) {
        const day = SKIES[THEMES[id].sky], night = nightOf(id);
        assert.ok(NIGHTS[id], `${id}: no night of its own`);
        assert.ok(lum(night.top) < lum(day.top) / 3 && lum(night.horizon) < lum(day.horizon) / 2, `${id}: night sky not dark`);
        assert.ok(night.stars >= 0 && night.stars <= 1 && night.power > 0, id);
    }
    // Dark countryside shows far more stars than a megacity
    assert.ok(NIGHTS.spa.stars > NIGHTS.interlagos.stars && NIGHTS.spielberg.stars > NIGHTS.monaco.stars);
});

// Offset lines as game3d.js offsetPoints draws them (each point square to its neighbours' chord), loops cut out
const offsetLine = (P, o) => S.untangle(P, P.map((p, i) => {
    const n = P.length, a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x - ((b.y - a.y) / l) * o, y: p.y + ((b.x - a.x) / l) * o };
}));
const folds = (P, E) => E.filter((e, k) => {
    const n = E.length, f = E[(k + 1) % n], p = P[k], q = P[(k + 1) % n];
    return (f.x - e.x) * (q.x - p.x) + (f.y - e.y) * (q.y - p.y) < -1e-9;
}).length;

test('untangle: the inside of a U-turn tighter than the offset ends where the two legs\' lines cross', () => {
    // legs 10 apart joined by a half circle (radius 5), offset 8 to the inside: the lines meet where the legs are 16 apart
    const P = [];
    for (let x = -200; x < 0; x += 2) P.push({ x, y: -5 });
    for (let k = 0; k < 16; k++) { const a = -Math.PI / 2 + (k / 16) * Math.PI; P.push({ x: 5 * Math.cos(a), y: 5 * Math.sin(a) }); }
    for (let x = 0; x > -200; x -= 2) P.push({ x, y: 5 + 30 * Math.max(0, -x - 100) / 100 }); // the exit leg spreads out
    const raw = P.map((p, i) => { const n = P.length, a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return { x: p.x - ((b.y - a.y) / l) * 8, y: p.y + ((b.x - a.x) / l) * 8 }; });
    assert.ok(folds(P, raw) > 0, 'the plain offset folds');
    const E = offsetLine(P, 8);
    assert.strictEqual(folds(P, E.slice(0, -2)), 0); // (the loop's own closing segment aside)
    for (const e of E.slice(5, -5)) assert.ok(Physics.nearestOnPath(e.x, e.y, P).dist > 8 * 0.98, `inside the road at ${e.x},${e.y}`);
});

for (const id of Track.TRACK_IDS) {
    test(`${id}: drawn road edges and barrier lines lie off their own road, nowhere folded back across it`, () => {
        const t = tracks[id], { rp } = S.smoothPath(t.path, t.scale, t.cum), m = rp.length, half = t.width / 2;
        // distance to the drawn road within ±40 m of point k (a nearby leg, Monaco's Fairmont, can overlap it)
        const own = (e, k) => {
            let best = Infinity;
            for (let d = -16; d <= 16; d++) {
                const a = rp[(k + d + m) % m], b = rp[(k + d + 1 + m) % m], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
                const u = l2 ? Math.max(0, Math.min(1, ((e.x - a.x) * ex + (e.y - a.y) * ey) / l2)) : 0;
                best = Math.min(best, Math.hypot(e.x - a.x - u * ex, e.y - a.y - u * ey));
            }
            return best;
        };
        for (const o of [half, half + t.wallOffset]) for (const side of [1, -1]) {
            const E = offsetLine(rp, side * o);
            assert.strictEqual(folds(rp, E), 0, `${(o / t.scale).toFixed(1)} m line folds`);
            E.forEach((e, k) => assert.ok(own(e, k) > o * 0.95, `${(o / t.scale).toFixed(1)} m line inside its road at ${e.x.toFixed(0)},${e.y.toFixed(0)}`));
        }
    });
}
