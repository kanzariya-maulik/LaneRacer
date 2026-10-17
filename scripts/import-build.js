// node scripts/import-build.js <id>: a circuit as built → data/tracks/<id>.build.json (metres, TUMFTM frame)
// From OpenStreetMap (barriers, gravel / grass / asphalt areas near the track, via Overpass) merged with the researched
// hand file data/tracks/source/<id>.build.hand.json (same schema; its entries win: "drop": ["osm:<wayId>", ...] removes
// OSM ones, its surfaces paint over OSM's, its kerbs replace the generated ones). Research: docs/superpowers/research/
// 2026-10-17-track-surface/. © OpenStreetMap contributors (ODbL).
const fs = require('fs');
const path = require('path');
const Track = require('../src/game/Track');
const { PITS } = require('./import-pits');

const DATA = path.join(__dirname, '..', 'data', 'tracks');
const OVERPASS = 'https://overpass-api.de/api/interpreter'; // POST with a User-Agent (a bare GET gets HTTP 406)

async function overpass(file, query) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const r = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': 'LanRace track import (one-off)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
    if (!r.ok) throw new Error(`Overpass: HTTP ${r.status}`);
    const text = await r.text();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return text;
}
const NEAR_M = 150; // OSM features farther than this from the centreline aren't trackside

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

async function importBuild(id) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
    if (!raw.osmFit) throw new Error(`${id}: no osmFit (node scripts/import-pits.js --fit-only)`);
    const { toM } = geo(raw.osmFit), [w, s, e, n] = PITS[id].bbox.split(',');
    const q = `[out:json][timeout:120];(way[barrier](${s},${w},${n},${e});way[natural~"sand|shingle"](${s},${w},${n},${e});way[surface~"gravel|sand|pebblestone|fine_gravel|grass|asphalt"](${s},${w},${n},${e});way[landuse=grass](${s},${w},${n},${e});way["area:highway"](${s},${w},${n},${e}););out geom;`;
    const osm = JSON.parse(await overpass(path.join(__dirname, 'build', 'osm', `${id}-build.json`), q));
    const t = Track.load(id), C = raw.path.map((p) => [p.x / raw.scale, -p.y / raw.scale]);
    const near = (pts) => pts.some(([x, y]) => C.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < NEAR_M));
    const hand = fs.existsSync(path.join(DATA, 'source', `${id}.build.hand.json`)) ? JSON.parse(fs.readFileSync(path.join(DATA, 'source', `${id}.build.hand.json`), 'utf8')) : {};
    const drop = new Set(hand.drop || []), surfaces = [], barriers = [];
    for (const way of osm.elements) {
        const c = classify(way.tags || {}), src = `osm:${way.id}`;
        if (!c || drop.has(src) || !way.geometry) continue;
        const pts = way.geometry.map((g) => toM([g.lat, g.lon]));
        if (!near(pts)) continue;
        const closed = way.nodes && way.nodes[0] === way.nodes.at(-1);
        if (c.surface && closed) surfaces.push({ kind: c.surface, poly: pts.slice(0, -1), src });
        if (c.barrier) barriers.push({ kind: c.barrier, h: 1, fence: 0, pts, src });
    }
    // grass first, then asphalt, then gravel: a gravel trap mapped inside a grass area stays gravel
    const order = { grass: 0, asphalt: 1, gravel: 2 };
    surfaces.sort((a, b) => order[a.kind] - order[b.kind]);
    const B = await import('../public/js/sim/build.js'), base = B.defaultBuild(t);
    const build = {
        id, asphalt: hand.asphalt || base.asphalt,
        surfaces: [...surfaces, ...(hand.surfaces || [])],
        kerbs: hand.kerbs || base.kerbs,
        barriers: [...barriers, ...(hand.barriers || [])],
        features: hand.features || [],
        sources: ['© OpenStreetMap contributors (ODbL)', ...(hand.sources || [])],
        unconfirmed: hand.unconfirmed || [],
    };
    fs.writeFileSync(path.join(DATA, `${id}.build.json`), JSON.stringify(build, null, 1) + '\n');
    console.log(`${id}: ${surfaces.length} OSM surfaces, ${barriers.length} OSM barriers, ${(hand.surfaces || []).length} + ${(hand.barriers || []).length} hand`);
}

if (require.main === module) importBuild(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });

module.exports = { geo, classify };
