# Real Grids, Pit Lanes & Garages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every circuit gets its real OSM pit lane, a grid at the real start line on the pole side, 11 team garages, an automatic 80 km/h limiter, and qualifying that starts from the garages.

**Architecture:** A one-off importer aligns OSM pit ways onto the TUMFTM centrelines and stores them in `data/tracks/<id>.json`; hand-researched facts live in `data/tracks/circuits.json`. `Track.build` derives start line, checkpoints, grid, pit wall and garages. `Game.drive` adds pit surface, pit wall, pit barrier corridor and the limiter; lap logic maps in-pit cars onto the track. The client draws it all from `game_init.track`.

**Tech Stack:** Node 24, `node:test`, Three.js 0.186 (client), OSM API 0.6 (import only).

**Spec:** `docs/superpowers/specs/2026-10-01-pitlane-grid-design.md`

## Global Constraints

- No runtime internet: OSM is fetched only by `scripts/import-pits.js`; outputs are committed.
- `SCALE = 6` world units per metre; game y = −north (as `scripts/import-tracks.js`).
- OSM fit: fail the import if the median ICP distance is over 5 m.
- Pit lane resampled every 5 m.
- Limiter: 80 km/h, every circuit, automatic, no penalties.
- Garage order: redbull, ferrari, mercedes, alpine, mclaren, alfaromeo, astonmartin, haas, alphatauri, williams, redbull-suzuka. Two boxes each.
- Every track JSON carries `"attribution": "Pit lane © OpenStreetMap contributors (ODbL)"`.
- No new npm dependencies.
- Commit after each task on `feature/3d-f1`. No `Co-Authored-By` or other trailers (user's `/commit` rule). Never commit `refs/`.

### Deviations from the spec (decided while planning, from measured data)

1. **Pit width is 10 m, not 12 m.** Tracks are drawn 1.5× real width (`WIDTH_MULT`). With 12 m, the pit's track-side edge would overlap the track at Sakhir (pit centre 16 m from the centreline, track half-width 9.7 m) and Suzuka (14 m vs 6.9 m). With 10 m, every circuit keeps at least 0.5 m clearance along the garages.
2. **`garageSide` is derived, not hand-entered.** Garages always sit on the side away from the track. `Track.build` measures that side.
3. **The pit wall exists only where it clears the track edge by at least 0.5 m** inside the limiter zone. It runs as one continuous piece, the longest stretch that qualifies. Where the pit lane merges into the track, there is no wall.
4. **"Entering the pits" means crossing the limiter-start line** (`limiter` turns on). Brushing the merge area does not cancel a lap.
5. **In-pit lap progress:** a car in the pit lane counts as being at the track point `entryS + pitS/len · span`. Checkpoints the pit bypasses still register in order.
6. **Garage 1 (redbull) is nearest the pit exit.** This is unconfirmed and listed in `unconfirmed`.

### Measured facts (2026-10-01, OSM aligned to TUMFTM, metres)

| Circuit | Pit way | Fit | Pit length | Start line on pit | Pit centre to centreline (every 50 m) |
|---|---|---|---|---|---|
| monza | 38168747 | 1.41 | 737 | 239 | 2 7 11 17 19 18 18 18 18 18 18 18 15 9 5 |
| spa | 323851541 | 1.75 | 717 | 272 | 6 26 25 27 24 15 15 15 15 16 16 17 24 14 12 |
| silverstone | 227902927 | 1.94 | 1125 | 587 | 4 10 19 29 35 37 67 102 54 28 26 25 23 22 20 18 17 27 26 19 10 6 4 |
| suzuka | 120917578 | 1.20 | 886 | 270 | 2 8 14 14 14 14 15 15 15 15 15 15 15 13 10 6 3 1 |
| sakhir | 187123422 | 1.97 | 771 | 199 | 2 12 14 16 16 16 16 16 16 16 16 15 15 14 9 4 |

Track half-widths in-game: monza 6.8, spa 6.9, silverstone 10.3, suzuka 6.9, sakhir 9.7 m.

## Review Focus

1. A car on the racing line beside the pit entry/exit merge must not count as in the pit (no limiter, no lap cancel). Tested in Task 4.
2. The pit wall must block crossings both ways (straight → pit, pit → straight). Tested in Task 4.
3. A lap driven through the pit lane must count even where pit-bypassed checkpoints lie outside the raw checkpoint radius. Tested in Task 5 with shrunken radii.
4. A track without a pit lane (synthetic or future circuit) must still build and drive. Tested in Tasks 3 and 4.
5. A quali car whose `teamId` has no garage must still spawn (first garage). Tested in Task 5.

---

### Task 1: Physics helpers — open-path nearest point and wall crossing

**Files:**
- Modify: `src/game/Physics.js` (`nearestOnTrack` → wrapper over a new `nearestOnPath`; new `crossWall`)
- Test: `test/physics.test.js`

**Interfaces:**
- Produces: `Physics.nearestOnPath(x, y, path, closed = true) → { dist, px, py, i, t }`. Here `i` is the segment index (`path[i]→path[i+1]`) and `t` is in [0, 1].
- Produces: `Physics.crossWall(ax, ay, bx, by, wall) → null | { nx, ny }`, where `n` is the unit normal pointing back to the side `a` was on.
- `Physics.nearestOnTrack(x, y, track)` is unchanged for callers. It also returns `i` and `t` now.

- [ ] **Step 1: Write the failing tests** (append to `test/physics.test.js`)

```js
test('nearestOnPath: open path does not wrap back to the first point', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const open = Physics.nearestOnPath(10, 60, line, false);
    assert.strictEqual(open.dist, 60);
    assert.strictEqual(open.i, 0);
    assert.ok(Math.abs(open.t - 0.1) < 1e-9);
    assert.ok(Physics.nearestOnPath(10, 60, line).dist < 36, 'closed path should use the closing segment');
});

test('crossWall: crossing reports the normal back toward the side the car came from', () => {
    const wall = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const down = Physics.crossWall(50, 10, 50, -10, wall);
    assert.ok(Math.abs(down.nx) < 1e-9 && Math.abs(down.ny - 1) < 1e-9);
    const up = Physics.crossWall(50, -10, 50, 10, wall);
    assert.ok(Math.abs(up.nx) < 1e-9 && Math.abs(up.ny + 1) < 1e-9);
    assert.strictEqual(Physics.crossWall(50, 10, 50, 5, wall), null, 'same side');
    assert.strictEqual(Physics.crossWall(150, 10, 150, -10, wall), null, 'past the wall end');
    assert.strictEqual(Physics.crossWall(50, 10, 50, -10, []), null, 'no wall');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/physics.test.js`
Expected: FAIL with `Physics.nearestOnPath is not a function`.

- [ ] **Step 3: Implement** — replace `nearestOnTrack` in `src/game/Physics.js` with:

```js
    // Nearest point on a polyline; closed = the last point joins back to the first
    static nearestOnPath(x, y, path, closed = true) {
        const n = closed ? path.length : path.length - 1;
        let best = { d2: Infinity, px: x, py: y, i: 0, t: 0 };
        for (let i = 0; i < n; i++) {
            const v = path[i], w = path[(i + 1) % path.length];
            const l2 = this.distSquared(v, w);
            let t = l2 ? ((x - v.x) * (w.x - v.x) + (y - v.y) * (w.y - v.y)) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = v.x + t * (w.x - v.x), py = v.y + t * (w.y - v.y);
            const d2 = (x - px) ** 2 + (y - py) ** 2;
            if (d2 < best.d2) best = { d2, px, py, i, t };
        }
        return { dist: Math.sqrt(best.d2), px: best.px, py: best.py, i: best.i, t: best.t };
    }

    static nearestOnTrack(x, y, track) {
        return this.nearestOnPath(x, y, track.path);
    }

    // First wall segment the move a→b crosses; n points back to a's side
    static crossWall(ax, ay, bx, by, wall) {
        for (let i = 0; i + 1 < wall.length; i++) {
            const p = wall[i], q = wall[i + 1];
            const ex = q.x - p.x, ey = q.y - p.y;
            const sa = ex * (ay - p.y) - ey * (ax - p.x);
            const sb = ex * (by - p.y) - ey * (bx - p.x);
            if (sa === 0 || sa * sb > 0) continue;
            const fx = bx - ax, fy = by - ay;
            if ((fx * (p.y - ay) - fy * (p.x - ax)) * (fx * (q.y - ay) - fy * (q.x - ax)) > 0) continue;
            const k = (sa > 0 ? 1 : -1) / (Math.hypot(ex, ey) || 1);
            return { nx: -ey * k, ny: ex * k };
        }
        return null;
    }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 79/79 (77 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/game/Physics.js test/physics.test.js
git commit -m "Add open-path nearest point and wall crossing helpers"
```

---

### Task 2: OSM pit lane importer and circuit facts

**Files:**
- Create: `scripts/import-pits.js`
- Create: `data/tracks/circuits.json`
- Modify: `scripts/import-tracks.js` (export `BASE`, `SOURCES`)
- Modify: `package.json` (`tracks` script runs both importers)
- Modify (generated): `data/tracks/{monza,spa,silverstone,suzuka,sakhir}.json`
- Test: `test/track.test.js`

**Interfaces:**
- Consumes: `Physics.nearestOnPath` (Task 1, used by the tests).
- Produces: each track JSON gains `pit: { path: [{x,y}], width, osmWay, fitM }` and `attribution`. The pit path is ordered entry→exit in game units, and `width` is `10 × SCALE`.
- Produces: `circuits.json` maps each track id to `{ startLineM, poleSide, limiterStartM, limiterEndM, sources, unconfirmed }`.

- [ ] **Step 1: Write the failing tests** (append to `test/track.test.js`, which needs `fs` and `path` at the top)

```js
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data', 'tracks');
const circuits = JSON.parse(fs.readFileSync(path.join(DATA, 'circuits.json'), 'utf8'));

for (const id of Track.TRACK_IDS) {
    test(`${id}: circuit facts present`, () => {
        const c = circuits[id];
        assert.ok(c, 'missing from circuits.json');
        assert.strictEqual(typeof c.startLineM, 'number');
        assert.ok(['left', 'right'].includes(c.poleSide));
        assert.ok(c.limiterStartM >= 0 && c.limiterStartM < c.limiterEndM);
        assert.ok(Array.isArray(c.sources) && Array.isArray(c.unconfirmed));
    });

    test(`${id}: OSM pit lane imported, aligned and joined to the track`, () => {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
        assert.ok(raw.pit, 'no pit lane: run node scripts/import-pits.js');
        assert.ok(raw.pit.fitM <= 5, `OSM fit ${raw.pit.fitM} m`);
        assert.match(raw.attribution, /OpenStreetMap contributors \(ODbL\)/);
        const pts = raw.pit.path;
        assert.ok(pts.length > 100, `only ${pts.length} points`);
        for (const end of [pts[0], pts.at(-1)]) {
            assert.ok(Physics.getDistanceFromTrack(end.x, end.y, raw) < raw.width / 2 + 15 * raw.scale, 'pit end not joined to the track');
        }
        const m = pts.length >> 1, near = Physics.nearestOnPath(pts[m].x, pts[m].y, raw.path);
        const a = raw.path[near.i], b = raw.path[(near.i + 1) % raw.path.length];
        assert.ok((b.x - a.x) * (pts[m + 1].x - pts[m].x) + (b.y - a.y) * (pts[m + 1].y - pts[m].y) > 0, 'pit lane runs against the track');
        const lim = circuits[id];
        let s = 0;
        for (let i = 1; i < pts.length; i++) {
            s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / raw.scale;
            if (s >= lim.limiterStartM && s <= lim.limiterEndM) {
                assert.ok(Physics.getDistanceFromTrack(pts[i].x, pts[i].y, raw) < 40 * raw.scale, `pit ${s.toFixed(0)} m is far from the straight`);
            }
        }
    });
}
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/track.test.js`
Expected: FAIL with `ENOENT … circuits.json`.

- [ ] **Step 3: Write `data/tracks/circuits.json`**

```json
{
  "monza": {
    "startLineM": 0, "poleSide": "left", "limiterStartM": 60, "limiterEndM": 677,
    "sources": ["start line: TUMFTM row 0 (assumed)", "pole side: web search 2026-10-01", "limiter: 60 m inside each end of OSM way 38168747"],
    "unconfirmed": ["startLineM", "poleSide", "limiterStartM", "limiterEndM", "garage order direction"]
  },
  "spa": {
    "startLineM": 0, "poleSide": "left", "limiterStartM": 60, "limiterEndM": 657,
    "sources": ["start line: TUMFTM row 0 (assumed; OSM start node is 1414 m off and ignored)", "pole side: web search 2026-10-01 (conflicts with the inside-of-La-Source rule, which gives right)", "limiter: 60 m inside each end of OSM way 323851541"],
    "unconfirmed": ["startLineM", "poleSide", "limiterStartM", "limiterEndM", "garage order direction"]
  },
  "silverstone": {
    "startLineM": 135, "poleSide": "left", "limiterStartM": 430, "limiterEndM": 1075,
    "sources": ["start line: OSM node raceway=start/finish, aligned onto TUMFTM (+135 m, 2.5 m off-centre)", "pole side: web search 2026-10-01", "limiter: where OSM way 227902927 meets the straight (430 m) to 50 m before its end"],
    "unconfirmed": ["poleSide", "limiterStartM", "limiterEndM", "garage order direction"]
  },
  "suzuka": {
    "startLineM": 0, "poleSide": "right", "limiterStartM": 60, "limiterEndM": 826,
    "sources": ["start line: TUMFTM row 0 (assumed)", "pole side: web search 2026-10-01", "limiter: 60 m inside each end of OSM way 120917578"],
    "unconfirmed": ["startLineM", "poleSide", "limiterStartM", "limiterEndM", "garage order direction"]
  },
  "sakhir": {
    "startLineM": 0, "poleSide": "right", "limiterStartM": 60, "limiterEndM": 711,
    "sources": ["start line: TUMFTM row 0 (assumed)", "pole side: web search 2026-10-01", "limiter: 60 m inside each end of OSM way 187123422"],
    "unconfirmed": ["startLineM", "poleSide", "limiterStartM", "limiterEndM", "garage order direction"]
  }
}
```

- [ ] **Step 4: Export from `scripts/import-tracks.js`**

Change its last line to:

```js
module.exports = { convert, SCALE, BASE, SOURCES };
```

and `package.json` `"tracks"` to:

```json
    "tracks": "node scripts/import-tracks.js && node scripts/import-pits.js",
```

- [ ] **Step 5: Write `scripts/import-pits.js`**

```js
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
```

- [ ] **Step 6: Run the importer**

Run: `node scripts/import-pits.js`
Expected (fits within about ±0.1 m):
```
monza: fit 1.41 m, pit 148 points
spa: fit 1.75 m, pit 144 points
silverstone: fit 1.94 m, pit 226 points
suzuka: fit 1.20 m, pit 178 points
sakhir: fit 1.97 m, pit 155 points
```
If a fit fails, the seed is stale. Re-derive it with a rotation sweep: run `align` from `θ ∈ {0°, 5°, …, 355°}` with centroid-matched translation and 8 iterations, and keep the lowest median. For Silverstone, also grid-search the translation ±800 m in 50 m steps. Ledger a ruling.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (79 + 10 new).

- [ ] **Step 8: Commit**

```bash
git add scripts/import-pits.js scripts/import-tracks.js package.json data/tracks test/track.test.js
git commit -m "Import real pit lanes from OpenStreetMap and add circuit facts"
```

---

### Task 3: Track derivations — start line, grid, pit wall, garages

**Files:**
- Modify: `src/game/Track.js`
- Test: `test/track.test.js`

**Interfaces:**
- Consumes: `Physics.nearestOnPath`, `Physics.nearestOnTrack` (Task 1); `pit` in the track JSON and `circuits.json` (Task 2).
- Produces: `Track.build(raw, circuit = {})` returns `{ id, name, scale, width, path, cum, start: {x, y, angle}, checkpoints, startPositions, pit }`.
- `pit` is `null` or `{ path, width, cum, len, entryS, exitS, span, startOnPit, trackSide, limStart, limEnd, wall: [{x, y}], garages: [{teamId, s, x, y, angle, boxes: [{x, y, angle}, {x, y, angle}]}], garageSpan: [lo, hi], fitM }`. All lengths are in world units. `trackSide` is ±1 along `L = (-sin a, cos a)`, the same convention as client `offsetPoints`.
- Produces: `Track.pointAt(pts, cum, s, closed = true)`, `Track.GARAGE_ORDER`.

- [ ] **Step 1: Write the failing tests** — in `test/track.test.js`, replace the `16 checkpoints, first on the start line` test body's two `path[0]` asserts with `t.start`, and add:

```js
    test(`${id}: 16 checkpoints, first on the start line`, () => {
        assert.strictEqual(t.checkpoints.length, 16);
        assert.strictEqual(t.checkpoints[0].x, t.start.x);
        assert.strictEqual(t.checkpoints[0].y, t.start.y);
        for (const cp of t.checkpoints) assert.strictEqual(cp.radius, t.width / 2 + 80);
    });

    test(`${id}: start line at circuits.json startLineM`, () => {
        const p = Track.pointAt(t.path, t.cum, circuits[id].startLineM * t.scale);
        assert.strictEqual(t.start.x, p.x);
        assert.strictEqual(t.start.y, p.y);
    });

    test(`${id}: grid behind the start line, pole on the ${circuits[id].poleSide}, alternating`, () => {
        const pole = circuits[id].poleSide, other = pole === 'left' ? 'right' : 'left';
        // y points down the screen, so driver's left has a negative cross product
        const sideOf = (s) => {
            const n = Physics.nearestOnTrack(s.x, s.y, t);
            return Math.cos(s.angle) * (s.y - n.py) - Math.sin(s.angle) * (s.x - n.px) < 0 ? 'left' : 'right';
        };
        t.startPositions.forEach((s, i) => assert.strictEqual(sideOf(s), i % 2 === 0 ? pole : other, `slot ${i}`));
        const s0 = t.startPositions[0];
        const ahead = Math.cos(t.start.angle) * (s0.x - t.start.x) + Math.sin(t.start.angle) * (s0.y - t.start.y);
        assert.ok(ahead < -7 * t.scale && ahead > -9 * t.scale, `pole is ${(-ahead / t.scale).toFixed(1)} m behind the line`);
    });

    test(`${id}: 11 garages × 2 boxes in team order, in the pit lane, inside the limiter zone`, () => {
        const pit = t.pit;
        assert.deepStrictEqual(pit.garages.map(g => g.teamId), Track.GARAGE_ORDER);
        for (let k = 1; k < pit.garages.length; k++) assert.ok(pit.garages[k].s < pit.garages[k - 1].s, 'garage 1 is nearest the pit exit');
        for (const g of pit.garages) {
            assert.strictEqual(g.boxes.length, 2);
            for (const b of g.boxes) {
                const n = Physics.nearestOnPath(b.x, b.y, pit.path, false);
                assert.ok(n.dist < pit.width / 2, `${g.teamId} box outside the pit lane`);
                assert.ok(Physics.nearestOnTrack(b.x, b.y, t).dist > t.width / 2, `${g.teamId} box on the track`);
                const s = pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);
                assert.ok(s > pit.limStart && s < pit.limEnd, `${g.teamId} box outside the limiter zone`);
            }
        }
    });

    test(`${id}: pit wall clears the track edge and runs past the garages`, () => {
        const { wall, path: pp, cum, garageSpan } = t.pit;
        assert.ok(wall.length > 20, `wall only ${wall.length} points`);
        for (const w of wall) assert.ok(Physics.nearestOnTrack(w.x, w.y, t).dist >= t.width / 2, 'wall on the track');
        const sOf = (w) => { const n = Physics.nearestOnPath(w.x, w.y, pp, false); return cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]); };
        assert.ok(sOf(wall[0]) < garageSpan[0] && sOf(wall.at(-1)) > garageSpan[1], 'wall gap beside the garages');
    });
```

and outside the loop:

```js
test('a track without a pit lane still builds', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: Math.cos(i / 50 * Math.PI) * 3000, y: Math.sin(i / 50 * Math.PI) * 3000 }));
    const t = Track.build({ id: 'ring', name: 'Ring', scale: 6, width: 80, path: pts });
    assert.strictEqual(t.pit, null);
    assert.strictEqual(t.start.x, pts[0].x);
    assert.strictEqual(t.startPositions.length, 20);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/track.test.js`
Expected: FAIL. The new tests fail with `Cannot read properties of undefined (reading 'x')` (`t.start`) or `Track.pointAt is not a function`.

- [ ] **Step 3: Implement** — `src/game/Track.js` becomes:

```js
const fs = require('fs');
const path = require('path');
const Physics = require('./Physics');

const TRACK_IDS = ['monza', 'spa', 'silverstone', 'suzuka', 'sakhir'];
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'tracks');
const CHECKPOINT_COUNT = 16;
const GRID_SLOTS = 20;
const GRID_GAP_M = 8;  // metres between consecutive (staggered) grid slots
const WALL_OFFSET = 80; // matches the invisible wall in Game.js
// 2022 constructors' order, then the Suzuka special in its own garage
const GARAGE_ORDER = ['redbull', 'ferrari', 'mercedes', 'alpine', 'mclaren', 'alfaromeo', 'astonmartin', 'haas', 'alphatauri', 'williams', 'redbull-suzuka'];
const GARAGE_PITCH_M = 18;
const BOX_GAP_M = 9;
const WALL_CLEAR_M = 0.5; // pit wall only where it stays this far off the track edge

// cum[i] = distance along the loop to path[i]; cum[n] = full lap length
function cumulative(pts) {
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
        const a = pts[i - 1], b = pts[i % pts.length];
        cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return cum;
}

// Point and heading at distance s along the path (closed: wraps; open: clamps to the ends)
function pointAt(pts, cum, s, closed = true) {
    const total = closed ? cum[pts.length] : cum[pts.length - 1];
    s = closed ? ((s % total) + total) % total : Math.max(0, Math.min(s, total));
    let i = 0;
    while (cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

const along = (cum, n) => cum[n.i] + n.t * (cum[n.i + 1] - cum[n.i]);
// Offset sideways along L = (-sin a, cos a)
const lateral = (p, off) => ({ x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off, angle: p.angle });

function buildPit(raw, circuit, track) {
    const { scale, width } = raw;
    const pts = raw.pit.path, half = raw.pit.width / 2;
    const cum = cumulative(pts), len = cum[pts.length - 1];
    const total = track.cum[track.path.length];
    const trackS = (p) => along(track.cum, Physics.nearestOnPath(p.x, p.y, track.path));
    const entryS = trackS(pts[0]), exitS = trackS(pts.at(-1));
    const span = (((exitS - entryS) % total) + total) % total;

    const startOnPit = along(cum, Physics.nearestOnPath(track.start.x, track.start.y, pts, false));
    const sp = pointAt(pts, cum, startOnPit, false);
    const trackSide = Math.sign(-Math.sin(sp.angle) * (track.start.x - sp.x) + Math.cos(sp.angle) * (track.start.y - sp.y)) || 1;
    const limStart = (circuit.limiterStartM ?? 0) * scale;
    const limEnd = Math.min(len, (circuit.limiterEndM ?? Infinity) * scale);

    // Pit wall: longest run of the track-side edge that clears the track, inside the limiter zone
    let run = [], wall = [];
    for (let i = 0; i < pts.length; i++) {
        const w = lateral(pointAt(pts, cum, cum[i], false), trackSide * half);
        const ok = cum[i] >= limStart && cum[i] <= limEnd
            && Physics.nearestOnTrack(w.x, w.y, track).dist >= width / 2 + WALL_CLEAR_M * scale;
        if (ok) run.push({ x: w.x, y: w.y }); else run = [];
        if (run.length > wall.length) wall = run;
    }

    // Garages centred on the start line, garage 1 nearest the pit exit; boxes in the lane on the garage side
    const pitch = GARAGE_PITCH_M * scale;
    const garages = GARAGE_ORDER.map((teamId, k) => {
        const s = startOnPit + (5 - k) * pitch;
        const c = pointAt(pts, cum, s, false);
        const boxes = [-1, 1].map((d) => lateral(pointAt(pts, cum, s + (d * BOX_GAP_M * scale) / 2, false), (-trackSide * half) / 2));
        return { teamId, s, x: c.x, y: c.y, angle: c.angle, boxes };
    });
    const garageSpan = [startOnPit - 5.5 * pitch, startOnPit + 5.5 * pitch];

    return { path: pts, width: raw.pit.width, cum, len, entryS, exitS, span, startOnPit, trackSide, limStart, limEnd, wall, garages, garageSpan, fitM: raw.pit.fitM };
}

function build(raw, circuit = {}) {
    const { path: pts, width, scale } = raw;
    const cum = cumulative(pts);
    const total = cum[pts.length];
    const startS = (circuit.startLineM || 0) * scale;
    const start = pointAt(pts, cum, startS);

    const checkpoints = [];
    for (let k = 0; k < CHECKPOINT_COUNT; k++) {
        const p = pointAt(pts, cum, startS + (k * total) / CHECKPOINT_COUNT);
        checkpoints.push({ x: p.x, y: p.y, radius: width / 2 + WALL_OFFSET });
    }

    // Staggered two-column grid behind the start line; -1 = driver's left (y points down the screen)
    const pole = circuit.poleSide === 'right' ? 1 : -1;
    const startPositions = [];
    for (let i = 0; i < GRID_SLOTS; i++) {
        const p = pointAt(pts, cum, startS - (i + 1) * GRID_GAP_M * scale);
        startPositions.push(lateral(p, (i % 2 === 0 ? pole : -pole) * (width / 4)));
    }

    const track = { id: raw.id, name: raw.name, scale, width, path: pts, cum, start, checkpoints, startPositions, pit: null };
    if (raw.pit) track.pit = buildPit(raw, circuit, track);
    return track;
}

function load(id) {
    const file = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing track data ${file}. Run: npm run tracks`);
    const circuits = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'circuits.json'), 'utf8'));
    return build(JSON.parse(fs.readFileSync(file, 'utf8')), circuits[id]);
}

function loadAll() {
    const tracks = {};
    for (const id of TRACK_IDS) tracks[id] = load(id);
    return tracks;
}

module.exports = { TRACK_IDS, GARAGE_ORDER, load, loadAll, build, pointAt };
```

Note: the old grid formula `(x - sin·off, y + cos·off)` with `off = -width/4` for slot 0 is `lateral(p, -width/4)`, so `poleSide: 'left'` reproduces today's grid.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for everything, including `socketManager.test.js` (it compares against `monza.startPositions`, which is unchanged for a left pole at row 0).

- [ ] **Step 5: Commit**

```bash
git add src/game/Track.js test/track.test.js
git commit -m "Derive real start line, pole-side grid, pit wall and garages per circuit"
```

---

### Task 4: Server driving — pit surface, pit wall, barrier corridor, limiter

**Files:**
- Modify: `src/game/Game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Consumes: `track.pit` (Task 3), `Physics.nearestOnPath`, `Physics.crossWall` (Task 1).
- Produces: player fields `inPit` (bool), `limiter` (bool), `pitS` (world units along the pit). `game_state[id]` gains `inPit` and `limiter`.
- Produces: `Game.prototype.updatePit(p, near?, nearPit?)`. It sets `inPit`, `pitS` and `limiter`, and clamps speed.
- Produces: module constants `PIT_LIMIT_KMH = 80` and `PIT_RUNOFF_M = 2`.

- [ ] **Step 1: Write the failing tests** (append to `test/game.test.js`; add `const CarPhysics = require('../src/game/CarPhysics');` at the top)

```js
const box = (team, i = 0) => monza.pit.garages.find(g => g.teamId === team).boxes[i];
function place(p, at, speedMs = 0) {
    p.x = at.x; p.y = at.y; p.angle = at.angle;
    p.vx = Math.cos(at.angle) * speedMs * monza.scale;
    p.vy = Math.sin(at.angle) * speedMs * monza.scale;
    p.speed = speedMs * monza.scale;
}
const kmh = (p) => (Math.hypot(p.vx, p.vy) / monza.scale) * 3.6;
const FULL = { throttle: 1, brake: 0, steer: 0 };

test('pit limiter holds 80 km/h at full throttle in the limiter zone', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, box('ferrari'), 40);
    p.input = FULL;
    for (let k = 0; k < 60; k++) {
        g.drive(p);
        assert.ok(kmh(p) <= 80 + 1e-6, `${kmh(p).toFixed(1)} km/h`);
    }
    assert.ok(p.inPit && p.limiter);
    assert.ok(kmh(p) > 79, 'limiter should hold the limit, not stop the car');
});

test('no limiter on the track', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, monza.start, 60);
    p.input = FULL;
    for (let k = 0; k < 10; k++) g.drive(p);
    assert.ok(!p.inPit && !p.limiter);
    assert.ok(kmh(p) > 200);
});

test('pit lane is asphalt, not grass', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    const c = monza.pit.garages[5];
    place(p, c, 0);
    p.input = FULL;
    const ref = { ...p };
    for (let k = 0; k < 30; k++) {
        g.drive(p);
        CarPhysics.step(ref, FULL, g.dt, monza.scale, false);
    }
    close(p.speed, ref.speed);
});

test('racing line beside the pit entry is not the pit lane', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    const e = monza.pit.path[3];
    const c = Physics.nearestOnTrack(e.x, e.y, monza);
    p.x = c.px; p.y = c.py;
    g.updatePit(p);
    assert.ok(!p.inPit && !p.limiter);
});

test('pit wall blocks the straight → pit and pit → straight', () => {
    const w = monza.pit.wall[monza.pit.wall.length >> 1];
    const c = Physics.nearestOnTrack(w.x, w.y, monza);
    const wallOff = Physics.nearestOnTrack(w.x, w.y, monza).dist;
    const toPit = Math.atan2(w.y - c.py, w.x - c.px);

    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, { x: c.px, y: c.py, angle: toPit }, 30);
    p.input = FULL;
    for (let k = 0; k < 120; k++) {
        g.drive(p);
        assert.ok(!p.inPit, 'car got into the pit lane');
    }
    assert.ok(Physics.nearestOnTrack(p.x, p.y, monza).dist < wallOff);

    const q = Physics.nearestOnPath(w.x, w.y, monza.pit.path, false);
    place(p, { x: q.px, y: q.py, angle: toPit + Math.PI }, 20);
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.ok(Physics.nearestOnTrack(p.x, p.y, monza).dist > wallOff, 'car got out of the pit lane through the wall');
});

test('game_state carries inPit and limiter', () => {
    let sent = null;
    const io2 = { emit() {}, volatile: { emit(ev, d) { sent = d; } } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.release();
    place(g.players.a, box('haas'), 0);
    g.update();
    assert.strictEqual(sent.a.inPit, true);
    assert.strictEqual(sent.a.limiter, true);
});

test('tracks without a pit lane still drive', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: Math.cos(i / 50 * Math.PI) * 3000, y: Math.sin(i / 50 * Math.PI) * 3000 }));
    const ring = Track.build({ id: 'ring', name: 'Ring', scale: 6, width: 80, path: pts });
    const g = new Game(io, [lp('a')], ring, RACE, () => {});
    g.release();
    g.players.a.input = FULL;
    g.update();
    assert.ok(g.players.a.speed > 0);
    assert.strictEqual(g.players.a.inPit, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/game.test.js`
Expected: FAIL. The limiter test reports speeds above 80 km/h, and the `updatePit` test fails with `g.updatePit is not a function`.

- [ ] **Step 3: Implement** in `src/game/Game.js`:

Constants under `QUALI_CUTOFF_S`:

```js
const PIT_LIMIT_KMH = 80;
const PIT_RUNOFF_M = 2;     // barrier this far outside the pit lane edge
```

Module-level helper above `class Game`:

```js
// Barrier response: n points from the barrier back toward the car
function bounce(p, nx, ny) {
    const vn = -(p.vx * nx + p.vy * ny); // speed into the barrier
    const v = Math.hypot(p.vx, p.vy);
    if (vn > 0) { p.vx += vn * nx; p.vy += vn * ny; }
    // Speed loss scales with how square-on the hit is: head-on keeps WALL_KEEP, a graze keeps almost all
    const impact = v > 0 ? Math.max(0, vn) / v : 0;
    const keep = 1 - (1 - CarPhysics.C.WALL_KEEP) * impact;
    p.vx *= keep;
    p.vy *= keep;
    p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
}
```

In the constructor's player object, after `steer: 0,` add `inPit: false, limiter: false, pitS: 0,`.

Replace `drive(p)` with:

```js
    drive(p) {
        const t = this.track, scale = t.scale, pit = t.pit;
        const x0 = p.x, y0 = p.y;
        const nearPit = (x, y) => (pit ? Physics.nearestOnPath(x, y, pit.path, false) : null);
        const before = Physics.nearestOnTrack(p.x, p.y, t), beforePit = nearPit(p.x, p.y);
        const grass = before.dist > t.width / 2 && !(beforePit && beforePit.dist <= pit.width / 2);
        CarPhysics.step(p, p.input, this.dt, scale, grass);

        // Pit wall: a move across it is undone
        const hit = pit && Physics.crossWall(x0, y0, p.x, p.y, pit.wall);
        if (hit) {
            p.x = x0 + hit.nx * 0.5;
            p.y = y0 + hit.ny * 0.5;
            bounce(p, hit.nx, hit.ny);
        }

        // Barrier: outside both the track's run-off and the pit lane's
        const wallDist = t.width / 2 + WALL_OFFSET;
        const pitDist = pit && pit.width / 2 + PIT_RUNOFF_M * scale;
        const after = Physics.nearestOnTrack(p.x, p.y, t), afterPit = nearPit(p.x, p.y);
        const overTrack = after.dist - wallDist, overPit = afterPit ? afterPit.dist - pitDist : Infinity;
        if (overTrack > 0 && overPit > 0) {
            const [near, lim] = overPit < overTrack ? [afterPit, pitDist] : [after, wallDist];
            const nx = (p.x - near.px) / near.dist, ny = (p.y - near.py) / near.dist;
            p.x = near.px + nx * (lim - 1);
            p.y = near.py + ny * (lim - 1);
            bounce(p, -nx, -ny);
        }

        if (pit) this.updatePit(p, after, afterPit);

        if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
            p.lastSafeX = p.x;
            p.lastSafeY = p.y;
        } else {
            p.x = p.lastSafeX; p.y = p.lastSafeY;
            p.vx = p.vy = p.speed = 0;
            if (!Number.isFinite(p.angle)) p.angle = 0;
        }
    }

    // In the pit lane = on pit asphalt and off the track's (where they overlap, it's track)
    updatePit(p, near = Physics.nearestOnTrack(p.x, p.y, this.track), nearPit = Physics.nearestOnPath(p.x, p.y, this.track.pit.path, false)) {
        const t = this.track, pit = t.pit;
        p.inPit = nearPit.dist <= pit.width / 2 && near.dist > t.width / 2;
        p.pitS = pit.cum[nearPit.i] + nearPit.t * (pit.cum[nearPit.i + 1] - pit.cum[nearPit.i]);
        p.limiter = p.inPit && p.pitS >= pit.limStart && p.pitS <= pit.limEnd;
        if (p.limiter) {
            const max = (PIT_LIMIT_KMH / 3.6) * t.scale, v = Math.hypot(p.vx, p.vy);
            if (v > max) {
                p.vx *= max / v;
                p.vy *= max / v;
                p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
            }
        }
    }
```

In `update()`'s `stateSync[id]`, add `inPit: p.inPit, limiter: p.limiter,` after `steer: p.steer,`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/game.test.js
git commit -m "Add pit lane surface, pit wall and 80 km/h limiter"
```

---

### Task 5: Session rules — garage spawn, out-lap, pit entry cancels, laps through the pit

**Files:**
- Modify: `src/game/Game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Consumes: `track.pit.garages`, `entryS`, `span`, `len` (Task 3); `Track.pointAt`, `track.cum` (Task 3); `updatePit` (Task 4).
- Produces: `Game.garageSlots(players, track) → [{x, y, angle}]` and `Game.prototype.trackPos(p) → {x, y}`.

- [ ] **Step 1: Write the failing tests** (append to `test/game.test.js`)

```js
const QUALI = { maxLaps: 3, qualiMinutes: 1 };

test('quali cars start in their own garage box, at rest, facing pit exit', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c', 'haas')], monza, QUALI, () => {}, 'quali');
    for (const [id, b] of [['a', box('ferrari', 0)], ['b', box('ferrari', 1)], ['c', box('haas', 0)]]) {
        const p = g.players[id];
        assert.deepStrictEqual([p.x, p.y, p.angle, p.speed], [b.x, b.y, b.angle, 0], id);
    }
});

test('quali: a team with no garage starts in the first garage', () => {
    const g = new Game(io, [lp('z', 'nope')], monza, QUALI, () => {}, 'quali');
    assert.strictEqual(g.players.z.x, monza.pit.garages[0].boxes[0].x);
});

test('race cars still start on the grid', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    assert.strictEqual(g.players.a.x, monza.startPositions[0].x);
});

test('quali: out-lap from the garage; timing starts at the first line crossing after pit exit', () => {
    // redbull-suzuka is the last garage, before the line, so the car crosses the line in the pit lane
    const g = new Game(io, [lp('a', 'redbull-suzuka')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a, pit = monza.pit;
    const from = Physics.nearestOnPath(p.x, p.y, pit.path, false).i;
    let crossed = false;
    for (let i = from; i < pit.path.length; i++) {
        g.time = i * 0.1;
        p.x = pit.path[i].x; p.y = pit.path[i].y;
        g.updatePit(p);
        const before = p.checkpoint;
        g.checkLapProgress(p);
        if (before !== p.checkpoint && p.checkpoint === 0) crossed = true;
        if (p.inPit) assert.strictEqual(p.lapStart, null, 'timing started in the pit lane');
    }
    assert.ok(crossed, 'car never crossed the line in the pit lane');
    assert.ok(!p.inPit);
    lap(g, p, 100, 80);
    assert.notStrictEqual(p.lapStart, null, 'timing never started');
    assert.strictEqual(p.lastLap, null, 'out-lap must not be timed');
});

test('quali: crossing the pit entry line cancels the timed lap', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a;
    p.x = monza.start.x; p.y = monza.start.y;
    g.updatePit(p);
    p.lapStart = 3;
    g.time = 50;
    const b = box('haas');
    p.x = b.x; p.y = b.y;
    g.updatePit(p);
    assert.strictEqual(p.lapStart, null);
});

test('race: a lap through the pit lane counts even where checkpoints are out of reach of the pit', () => {
    const tight = { ...monza, checkpoints: monza.checkpoints.map(c => ({ ...c, radius: 5 * monza.scale })) };
    const g = new Game(io, [lp('a')], tight, RACE, () => {});
    g.release();
    const p = g.players.a;
    p.checkpoint = tight.checkpoints.length - 1;
    monza.pit.path.forEach((q, i) => {
        g.time = 60 + i * 0.1;
        p.x = q.x; p.y = q.y;
        g.updatePit(p);
        g.checkLapProgress(p);
    });
    assert.strictEqual(p.lap, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/game.test.js`
Expected: FAIL. The garage spawn test fails because the car is on the grid. The out-lap test fails with "timing started in the pit lane". The cancel test fails on `lapStart` 3 ≠ null. The race-through-pit test fails on lap 0 ≠ 1.

- [ ] **Step 3: Implement** in `src/game/Game.js`:

At the top: `const { pointAt } = require('./Track');`

In the constructor, replace `const slot = track.startPositions[index % track.startPositions.length];` with:

```js
        const boxes = mode === 'quali' && track.pit ? Game.garageSlots(players, track) : null;
```

(declared once before `players.forEach`), and inside the loop:

```js
            const slot = boxes ? boxes[index] : track.startPositions[index % track.startPositions.length];
```

Add the static method next to `qualiOrder`:

```js
    // Each driver's box in their team's garage; unknown teams use the first garage
    // ponytail: a third driver on one team reuses box 0; the lobby caps teams at 2
    static garageSlots(players, track) {
        const used = {};
        return players.map((p) => {
            const g = track.pit.garages.find(x => x.teamId === p.teamId) || track.pit.garages[0];
            used[g.teamId] = (used[g.teamId] || 0) + 1;
            return g.boxes[(used[g.teamId] - 1) % 2];
        });
    }

    // Lap progress for a car in the pit lane: the matching point on the track
    trackPos(p) {
        const t = this.track, pit = t.pit;
        if (!p.inPit) return p;
        return pointAt(t.path, t.cum, pit.entryS + (p.pitS / pit.len) * pit.span);
    }
```

In `updatePit`, record the previous limiter state on its first line, `const wasLimited = p.limiter;`, and add at its end:

```js
        // Crossing the pit entry line ends a timed lap
        if (this.mode === 'quali' && p.limiter && !wasLimited) p.lapStart = null;
```

In `checkLapProgress`, replace `if (Math.hypot(p.x - cp.x, p.y - cp.y) >= cp.radius) return;` with:

```js
        const pos = this.trackPos(p);
        if (Math.hypot(pos.x - cp.x, pos.y - cp.y) >= cp.radius) return;
```

and replace the last line, `p.lapStart = this.time;`, with:

```js
        p.lapStart = p.inPit ? null : this.time; // out-lap: timing starts at the first crossing after pit exit
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS for all. The existing quali tests teleport between checkpoints without `updatePit`, so `inPit` stays false and they are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js test/game.test.js
git commit -m "Start qualifying from team garages with out-lap and pit entry rules"
```

---

### Task 6: Client — pit lane, garages, grid boxes, start line, HUD, minimap

**Files:**
- Modify: `public/js/game3d.js`
- Modify: `public/index.html` (limiter badge)
- Modify: `public/css/style.css`

**Interfaces:**
- Consumes: `game_init.track.{start, startPositions, pit}` (Task 3); `game_state[id].{inPit, limiter, curLap}` (Tasks 4–5); `public/teams.json` `{ id, name, chatColor }`.

- [ ] **Step 1: Module-level helpers** in `game3d.js`.

Under the `const TAG_FULL_M …` line:

```js
const PIT_RUNOFF_M = 2; // src/game/Game.js barrier outside the pit lane
const teamInfo = {};
fetch('teams.json').then(r => r.json()).then((list) => { for (const t of list) teamInfo[t.id] = t; });
```

Move `solid` out of `buildWorld` to module level, just above `function buildWorld`:

```js
const solid = (hex) => { const c = new THREE.Color(hex); return () => c; };
```

and delete its line inside `buildWorld`. Replace `distToPath` with an open-path option:

```js
function distToPath(p, path, closed = true) {
    let best = Infinity;
    for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        let t = l2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
    }
    return best;
}
```

Add after `startLine`:

```js
// Same sideways convention as offsetPoints and the server's Track.lateral
const side = (p, angle, off) => ({ x: p.x - Math.sin(angle) * off, y: p.y + Math.cos(angle) * off });
// Rotation that turns a plane's +z normal to face against heading a (toward an approaching car)
const facing = (a) => Math.atan2(-Math.cos(a), -Math.sin(a));

// Text on a plane: signs, boards, grid numbers
function textPlane(text, w, h, bg, fg = '#fff') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = Math.max(32, Math.round((256 * h) / w));
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = fg; g.font = `bold ${Math.round(c.height * 0.6)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2, c.width * 0.9);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
}

function flat(w, d, color, opacity = 1) {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity }));
}

function gridBoxes(slots) {
    slots.forEach((g, i) => {
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        const bar = flat(0.4 * scale, 2.6 * scale, 0xf2f2f2);
        bar.position.set(g.x + fx * 3 * scale, 0.9, g.y + fy * 3 * scale);
        bar.rotation.y = -g.angle;
        world.add(bar);
        const num = textPlane(String(i + 1), 1.6 * scale, 1.6 * scale, 'rgba(0,0,0,0)');
        num.geometry.rotateX(-Math.PI / 2);
        num.position.set(g.x + fx * 4.6 * scale, 0.95, g.y + fy * 4.6 * scale);
        num.rotation.y = facing(g.angle);
        world.add(num);
    });
}

function buildPit(pit) {
    const n = pit.path.length, ph = pit.width / 2, s = pit.trackSide;
    const inner = (i) => i >= 1 && i <= n - 3; // end segments would use wrapped normals
    world.add(strip(pit.path, -ph, ph, 0.55, inner, solid('#3a3f47')));
    const line = 0.3 * scale;
    world.add(strip(pit.path, ph - line, ph, 0.85, inner, solid('#f2f2f2')));
    world.add(strip(pit.path, -ph, -ph + line, 0.85, inner, solid('#f2f2f2')));

    // Pit wall on the track side; outer wall behind the lane except where the garages open onto it
    world.add(wall(pit.wall, 0, 1 * scale, (i) => i < pit.wall.length - 1, solid('#9aa0a6')));
    const [lo, hi] = pit.garageSpan, back = ph + PIT_RUNOFF_M * scale;
    world.add(wall(pit.path, -s * back, 1 * scale, (i) => inner(i) && (pit.cum[i + 1] < lo || pit.cum[i] > hi), solid('#9aa0a6')));

    const at = (s0) => {
        const i = Math.max(1, pit.cum.findIndex((c) => c >= s0));
        const a = pit.path[i - 1], b = pit.path[i];
        return { x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const board = (s0, text, bg) => {
        const p = at(s0), b = side(p, p.angle, -s * (ph + 1 * scale));
        const m = textPlane(text, 3 * scale, 1.5 * scale, bg);
        m.position.set(b.x, 2 * scale, b.y);
        m.rotation.y = facing(p.angle);
        world.add(m);
    };
    board(pit.cum[2], 'PIT IN', '#d62828');
    board(pit.limStart, 'PIT LIMIT 80', '#1e5bd8');
    board(pit.limEnd, 'END LIMIT', '#1e5bd8');
    board(pit.cum[n - 3], 'PIT OUT', '#2a9d3f');
    for (const s0 of [pit.limStart, pit.limEnd]) {
        const p = at(s0), m = flat(0.5 * scale, pit.width, 0xf2f2f2);
        m.position.set(p.x, 0.9, p.y);
        m.rotation.y = -p.angle;
        world.add(m);
    }

    for (const g of pit.garages) {
        const info = teamInfo[g.teamId] || { name: g.teamId, chatColor: '#888888' };
        const c = side(g, g.angle, -s * (back + 2.5 * scale));
        const building = new THREE.Mesh(new THREE.BoxGeometry(18 * scale, 6 * scale, 5 * scale), new THREE.MeshStandardMaterial({ color: 0x2b2f36 }));
        building.position.set(c.x, 3 * scale, c.y);
        building.rotation.y = -g.angle;
        building.castShadow = true;
        world.add(building);
        const f = side(g, g.angle, -s * (back - 0.1 * scale));
        const sign = textPlane(info.name.toUpperCase(), 17 * scale, 1.6 * scale, info.chatColor);
        sign.position.set(f.x, 5 * scale, f.y);
        sign.rotation.y = s > 0 ? -g.angle : Math.PI - g.angle; // face the pit lane
        world.add(sign);
        for (const b of g.boxes) {
            const mark = flat(6 * scale, 2.6 * scale, info.chatColor, 0.45);
            mark.position.set(b.x, 0.8, b.y);
            mark.rotation.y = -b.angle;
            world.add(mark);
        }
    }
}
```

- [ ] **Step 2: Wire into `buildWorld`.**

Change `startLine(path, width)` to take the start point:

```js
function startLine(start, width) {
```

and replace its last positioning lines (`const a = path[0], b = path[1];` … `m.rotation.y = …`) with:

```js
    m.position.set(start.x, 1.0, start.y);
    m.rotation.y = -start.angle;
```

In `buildWorld`, replace the barrier `ok` line with one that also skips the pit corridor:

```js
        const ok = offsetPoints(path, side * wallOff).map((p) => distToPath(p, path) > wallOff * 0.95
            && !(t.pit && distToPath(p, t.pit.path, false) < t.pit.width / 2 + (PIT_RUNOFF_M + 2) * scale));
```

Rename that loop's variable `side` to `dir` (`for (const dir of [1, -1])`, `dir * wallOff`) so it doesn't shadow the new `side` helper.

Replace `world.add(startLine(path, t.width));` with:

```js
    world.add(startLine(t.start, t.width));
    gridBoxes(t.startPositions);
    if (t.pit) buildPit(t.pit);
```

- [ ] **Step 3: HUD and minimap.**

`public/index.html`, after `<div id="session-bar"></div>`:

```html
            <div id="pit-limiter" class="hidden">PIT LIMITER 80</div>
```

`public/css/style.css`:

```css
#pit-limiter { position: absolute; bottom: 120px; left: 50%; transform: translateX(-50%); background: #1e5bd8; color: #fff; font-weight: 800; letter-spacing: 1px; padding: 6px 14px; border-radius: 4px; }
```

In `updateHUD`, replace the quali session-bar line with:

```js
        bar = sess.phase === 'QUALI_FLAG' ? 'CHEQUERED FLAG' : `QUALIFYING ${fmtClock(sess.endsAt - Date.now())}`;
        if (sess.phase !== 'QUALI_FLAG' && racing && me.curLap === null && !me.finished) bar += me.inPit ? ' · PIT LANE' : ' · OUT LAP';
```

and add after `$('session-bar').textContent = bar;`:

```js
    $('pit-limiter').classList.toggle('hidden', !(racing && me.limiter));
```

In `drawMinimap`, before the track stroke (`mm.strokeStyle = 'rgba(255,255,255,0.85)';`):

```js
    if (t.pit) {
        mm.strokeStyle = 'rgba(255,255,255,0.45)';
        mm.lineWidth = 2;
        mm.beginPath();
        t.pit.path.forEach((p, i) => (i ? mm.lineTo(mx(p.x), my(p.y)) : mm.moveTo(mx(p.x), my(p.y))));
        mm.stroke();
    }
```

- [ ] **Step 4: Verify**

Run: `node --check public/js/game3d.js && npm test`
Expected: no syntax error; all tests pass.

Manual (browser, `npm start`, then `http://localhost:3232`). Do this on each of the five circuits, with qualiMinutes 1 and maxLaps 1:
- Qualifying starts with your car in its team's garage box, facing pit exit. The "PIT LIMITER 80" badge shows and the speed holds at 80. The session bar reads "OUT LAP". The PIT IN, PIT LIMIT 80, END LIMIT and PIT OUT boards are visible, along with the pit wall and the garages with team-colour signs.
- The badge disappears after the END LIMIT line. The timing starts at the first line crossing.
- On the race grid, cars sit at the numbered boxes behind the chequered start line, pole on the `circuits.json` side. Silverstone's line is on the straight 135 m after the dataset start.
- The minimap shows the pit lane.

Take a screenshot per circuit if the Chrome extension is connected. Otherwise ask the user to check.

- [ ] **Step 5: Commit**

```bash
git add public/js/game3d.js public/index.html public/css/style.css
git commit -m "Draw pit lanes, garages, grid boxes and pit limiter HUD"
```
