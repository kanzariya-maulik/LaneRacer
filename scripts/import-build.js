// node scripts/import-build.js <id>: a circuit as built → data/tracks/<id>.build.json (metres, TUMFTM frame)
// Research: docs/superpowers/research/2026-10-17-track-surface/. © OpenStreetMap contributors (ODbL).
//   Surfaces: OpenStreetMap areas near the track (gravel / grass / asphalt), relabelled where the hand file's "kinds" say
//     (OSM calls Monza's paved escape roads "sand"; colour from the imagery can't tell bleached gravel from painted
//     asphalt, or dry grass from gravel), then the hand file's own polygons over them.
//   Barriers: how far the barrier stands past the white line, per centreline point and side: where a ray square to the
//     road meets an OSM barrier line, that distance; the hand file's sections ("barrierM") override; short gaps are
//     interpolated, long ones take the generated default. The barriers are the outline of the area that leaves for cars
//     plus the run-off areas (build.js outlineBarriers): closed by construction, on the OSM lines where they are mapped.
//     Each piece's kind: the OSM barrier it lies on, else the hand file's "barrierKinds" section, else Armco.
//   Kerbs: the generated ones (tight corners, both sides) restyled by the hand file's "kerbStyles" sections, plus its own
//     "kerbs". Hand file: data/tracks/source/<id>.build.hand.json; "drop": ["osm:<wayId>"] removes an OSM entry.
const fs = require('fs');
const path = require('path');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
const { PITS } = require('./import-pits');

const DATA = path.join(__dirname, '..', 'data', 'tracks');
const OVERPASS = 'https://overpass-api.de/api/interpreter'; // POST with a User-Agent (a bare GET gets HTTP 406)
const NEAR_M = 150;          // OSM features farther than this from the centreline aren't trackside
const RAY_M = 150;           // barriers this far out from the white line at most
const GAP_M = 300;           // unmapped stretches up to this long (lap metres) are interpolated between their ends
const DEFAULT_M = 80 / 6;    // past that, the generated rule (13.3 m past the white line)
const ON_OSM_M = 3;          // an outline point this close to an OSM barrier takes its kind

async function overpass(file, query) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const r = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': 'LanRace track import (one-off)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
    if (!r.ok) throw new Error(`Overpass: HTTP ${r.status}`);
    const text = await r.text();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return text;
}

// OSM (lat, lon) ↔ TUMFTM metres through the track's osmFit (scripts/import-pits.js)
function geo(fit) {
    const k = 111320 * Math.cos((fit.lat0 * Math.PI) / 180), c = Math.cos(fit.theta), s = Math.sin(fit.theta);
    return {
        toM: ([lat, lon]) => { const dx = lon * k - fit.tx, dy = lat * 110540 - fit.ty; return [+(c * dx + s * dy).toFixed(2), +(-s * dx + c * dy).toFixed(2)]; },
        toLL: ([X, Y]) => ({ lat: (s * X + c * Y + fit.ty) / 110540, lon: (c * X - s * Y + fit.tx) / k }),
    };
}

// What an OSM way is on a circuit, or null
function classify(tags) {
    const b = tags.barrier;
    if (b === 'guard_rail') return { barrier: tags.material === 'tyres' ? 'tyres' : 'armco' };
    if (b === 'tyres') return { barrier: 'tyres' };
    if (b === 'wall' || b === 'jersey_barrier' || b === 'concrete' || b === 'retaining_wall') return { barrier: 'concrete' };
    if (['sand', 'shingle'].includes(tags.natural) || ['gravel', 'sand', 'pebblestone', 'fine_gravel'].includes(tags.surface)) return { surface: 'gravel' };
    if (tags.landuse === 'grass' || tags.surface === 'grass') return { surface: 'grass' };
    if (tags['area:highway'] || tags.surface === 'asphalt') return { surface: 'asphalt' };
    return null;
}

// Lap-metre sections ({ side?, fromM, toM }) that cover m on side ('R' / 'L'), wrapping past the line
const covers = (q, side, m) => (!q.side || q.side === side) && (q.fromM <= q.toM ? m >= q.fromM && m < q.toM : m >= q.fromM || m < q.toM);

async function importBuild(id) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
    if (!raw.osmFit) throw new Error(`${id}: no osmFit (node scripts/import-pits.js --fit-only)`);
    const { toM } = geo(raw.osmFit), [w, s, e, n] = PITS[id].bbox.split(',');
    const q = `[out:json][timeout:120];(way[barrier](${s},${w},${n},${e});way[natural~"sand|shingle"](${s},${w},${n},${e});way[surface~"gravel|sand|pebblestone|fine_gravel|grass|asphalt"](${s},${w},${n},${e});way[landuse=grass](${s},${w},${n},${e});way["area:highway"](${s},${w},${n},${e}););out geom;`;
    const osm = JSON.parse(await overpass(path.join(__dirname, 'build', 'osm', `${id}-build.json`), q));
    const t = Track.load(id), sc = t.scale, C = raw.path.map((p) => [p.x / raw.scale, -p.y / raw.scale]);
    const near = (pts) => pts.some(([x, y]) => C.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < NEAR_M));
    const handFile = path.join(DATA, 'source', `${id}.build.hand.json`), hand = fs.existsSync(handFile) ? JSON.parse(fs.readFileSync(handFile, 'utf8')) : {};
    const drop = new Set(hand.drop || []), osmSurfaces = [], osmBarriers = [];
    for (const way of osm.elements) {
        const c = classify(way.tags || {}), src = `osm:${way.id}`;
        if (!c || drop.has(src) || !way.geometry) continue;
        const pts = way.geometry.map((g) => toM([g.lat, g.lon]));
        if (!near(pts)) continue;
        if (c.surface && way.nodes && way.nodes[0] === way.nodes.at(-1)) osmSurfaces.push({ kind: c.surface, poly: pts.slice(0, -1), src });
        if (c.barrier) osmBarriers.push({ kind: c.barrier, pts, src });
    }
    // OSM areas the research finds mislabelled ("kinds": { "osm:<id>": kind }: Monza's paved escape roads are "sand")
    for (const x of osmSurfaces) { const k = hand.kinds?.[x.src]; if (k) { x.src += ` (${x.kind} in OSM: ${k} per the research)`; x.kind = k; } }
    const order = { grass: 0, asphalt: 1, gravel: 2 }; // grass first: a gravel trap mapped inside a grass area stays gravel
    osmSurfaces.sort((a, b) => order[a.kind] - order[b.kind]);
    // Hand bands: a strip beside the track ({ side, fromM, toM (lap metres), fromEdgeM, toEdgeM (out from the white line),
    // kind, paint?, src }) as a polygon in metres; asphalt patches across the whole road the same way
    const np0 = t.path.length, total0 = t.cum[np0], STEP = 2.5 * sc;
    const band = (fromM, toM, side, a, b2) => { // side +1 right, -1 left, 0 the whole road; a, b2 metres past the white line
        const len = ((((toM - fromM) * sc) % total0) + total0) % total0, outer = [], inner = [];
        for (let d = 0; d <= len + 1e-6; d += Math.min(STEP, len - d || STEP)) {
            const s0 = (t.startS + fromM * sc + d) % total0, p = Track.pointAt(t.path, t.cum, s0);
            let i = 0; while (t.cum[i + 1] < s0) i++;
            const f = (s0 - t.cum[i]) / (t.cum[i + 1] - t.cum[i] || 1), eR = t.edgeR[i] + (t.edgeR[(i + 1) % np0] - t.edgeR[i]) * f, eL = t.edgeL[i] + (t.edgeL[(i + 1) % np0] - t.edgeL[i]) * f;
            const off = (o) => [+((p.x - Math.sin(p.angle) * o) / sc).toFixed(2), +(-(p.y + Math.cos(p.angle) * o) / sc).toFixed(2)];
            if (side) { const e = side > 0 ? eR : eL; outer.push(off(side * (e + b2 * sc))); inner.push(off(side * (e + a * sc))); }
            else { outer.push(off(eR)); inner.push(off(-eL)); }
            if (d >= len) break;
        }
        return [...outer, ...inner.reverse()];
    };
    const bands = (hand.bands || []).map((x) => ({ kind: x.kind, poly: band(x.fromM, x.toM, x.side === 'R' ? 1 : -1, x.fromEdgeM, x.toEdgeM), ...(x.paint ? { paint: x.paint } : {}), src: x.src }));
    const surfaces = [...osmSurfaces, ...(hand.surfaces || []), ...bands];
    const patches = (hand.asphalt?.patchesM || []).map((x) => ({ poly: band(x.fromM, x.toM, 0), src: x.src }));

    // Barrier distance past the white line per point and side (metres): OSM rays, hand sections, interpolation, default
    const B = await import('../public/js/sim/build.js'), W = await import('../public/js/sim/walls.js'), np = t.path.length, lapLen = t.cum[np] / sc;
    const world = (pts) => pts.map(([x, y]) => ({ x: x * sc, y: -y * sc }));
    const index = W.wallIndex(osmBarriers.map((b) => ({ ...b, pts: world(b.pts) })), sc);
    const lap = t.path.map((_, i) => ((((t.cum[i] - t.startS) % t.cum[np]) + t.cum[np]) % t.cum[np]) / sc);
    const normal = (i) => { const a = t.path[(i - 1 + np) % np], b = t.path[(i + 1) % np], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return [-(b.y - a.y) / l, (b.x - a.x) / l]; };
    const past = {};
    for (const [side, dir, edge] of [['R', 1, t.edgeR], ['L', -1, t.edgeL]]) {
        const known = t.path.map((p, i) => {
            const sec = (hand.barrierM || []).find((x) => covers(x, side, lap[i]));
            if (sec) return sec.m;
            const [nx, ny] = normal(i), d = W.rayToWall(index, p.x, p.y, dir * nx, dir * ny, RAY_M * sc + edge[i]);
            return d === Infinity ? null : Math.max(0.5, (d - edge[i]) / sc);
        });
        past[side] = known.map((v, i) => {
            if (v !== null) return v;
            let a = i, b = i; // the nearest known point either way round the lap
            while (known[(a - 1 + np) % np] === null && i - a < np) a--;
            while (known[(b + 1) % np] === null && b - i < np) b++;
            const ka = (a - 1 + np) % np, kb = (b + 1) % np, span = (((lap[kb] - lap[ka]) % lapLen) + lapLen) % lapLen;
            if (known[ka] === null || known[kb] === null || span > GAP_M) return DEFAULT_M;
            const f = ((((lap[i] - lap[ka]) % lapLen) + lapLen) % lapLen) / (span || 1);
            return known[ka] + (known[kb] - known[ka]) * f;
        });
    }
    // a single ray reaching a far barrier (a fence-line behind a building, a barrier round the next corner) would bulge the
    // outline into a circle round that point: each distance is the median of its ±3 neighbours
    const med = (A) => A.map((_, i) => [-3, -2, -1, 0, 1, 2, 3].map((d) => A[(i + d + np) % np]).sort((a, b) => a - b)[3]);
    const limR = t.edgeR.map((e, i) => e + med(past.R)[i] * sc), limL = t.edgeL.map((e, i) => e + med(past.L)[i] * sc);
    const runoff = surfaces.filter((x) => ['asphalt', 'paint', 'gravel'].includes(x.kind)).map((x) => world(x.poly));
    const loops = B.outlineBarriers(t, limR, limL, runoff);

    // Each outline point's kind: the OSM barrier under it, else the hand section for its place, else Armco
    const nearOsm = (p) => {
        for (const b of index.walls) for (let i = 0; i + 1 < b.pts.length; i++) {
            const a = b.pts[i], c = b.pts[i + 1], ex = c.x - a.x, ey = c.y - a.y, u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
            if (Math.hypot(p.x - a.x - u * ex, p.y - a.y - u * ey) < ON_OSM_M * sc) return b;
        }
        return null;
    };
    const kindAt = (p) => {
        const o = nearOsm(p), nr = Physics.nearestOnTrack(p.x, p.y, t), a = t.path[nr.i], b = t.path[(nr.i + 1) % np];
        const side = -(b.y - a.y) * (p.x - nr.px) + (b.x - a.x) * (p.y - nr.py) > 0 ? 'R' : 'L';
        const sec = (hand.barrierKinds || []).find((x) => covers(x, side, lap[nr.i]));
        const kind = o ? o.kind : sec ? sec.kind : 'armco';
        return { kind, h: sec?.h ?? 1, fence: sec?.fence ?? 3.5, src: o ? o.src : sec ? sec.src : 'generated (kind unconfirmed)' };
    };
    const barriers = [];
    for (const loop of loops) {
        const m = loop.length - 1, ks = loop.slice(0, m).map(kindAt), key = (k) => `${k.kind}|${k.h}|${k.fence}|${k.src}`;
        const start = ks.findIndex((k, i) => key(k) !== key(ks[(i - 1 + m) % m]));
        if (start < 0) { barriers.push({ ...ks[0], pts: loop.map((p) => B.toM(t, p)) }); continue; }
        let piece = [loop[start]];
        for (let k = 1; k <= m; k++) { // pieces share their end points, so the loop stays closed
            const i = (start + k) % m;
            piece.push(loop[i]);
            if (key(ks[i]) !== key(ks[(i - 1 + m) % m])) { barriers.push({ ...ks[(i - 1 + m) % m], pts: piece.map((p) => B.toM(t, p)) }); piece = [loop[i]]; }
        }
    }

    // Kerbs: generated ones, restyled where the hand file says; then its own
    const kerbs = B.generatedKerbs(t).map((k) => {
        const mid = k.fromM <= k.toM ? (k.fromM + k.toM) / 2 : ((k.fromM + k.toM + lapLen) / 2) % lapLen;
        const st = (hand.kerbStyles || []).find((x) => covers(x, k.side, mid));
        return st ? { ...k, ...Object.fromEntries(Object.entries(st).filter(([f]) => ['style', 'colors', 'w'].includes(f))), src: st.src } : k;
    });
    const build = {
        id, asphalt: { tone: hand.asphalt?.tone ?? 0.6, resurfaced: hand.asphalt?.resurfaced ?? null, patches },
        surfaces, kerbs: [...kerbs, ...(hand.kerbs || [])], barriers, features: hand.features || [],
        sources: ['© OpenStreetMap contributors (ODbL)', ...(hand.sources || [])],
        unconfirmed: hand.unconfirmed || [],
    };
    fs.writeFileSync(path.join(DATA, `${id}.build.json`), JSON.stringify(build, null, 1) + '\n');
    const relabelled = osmSurfaces.filter((x) => x.src.includes('per the research')).length;
    console.log(`${id}: ${osmSurfaces.length} OSM surfaces (${relabelled} relabelled), ${osmBarriers.length} OSM barriers → ${barriers.length} barrier pieces; ${(hand.surfaces || []).length} hand surfaces`);
}

if (require.main === module) importBuild(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });

module.exports = { geo, classify };
