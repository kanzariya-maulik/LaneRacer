// One-off: node scripts/fetch-textures.js
// CC0 track textures (Poly Haven, ambientCG) → public/textures/<name>_<map>_<res>.webp + manifest.json.
// Downloads are cached in data/tracks/source/textures/ (gitignored); cwebp (brew install webp) does the resizing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'public', 'textures');
const CACHE = path.join(__dirname, '..', 'data', 'tracks', 'source', 'textures');
const RES = [512, 1024, 2048];
const SMALL = [512, 1024]; // seen small or from afar: 2k would only spend the budget
// name: [library, id, resolutions, why]
const PICKS = {
    asphalt:       ['polyhaven', 'asphalt_track', RES, 'race-track asphalt, fine aggregate'],
    asphalt_patch: ['polyhaven', 'clean_asphalt', SMALL, 'fresh asphalt patches'],
    asphalt_pit:   ['polyhaven', 'asphalt_pit_lane', SMALL, 'pit lane surface'],
    kerb_paint:    ['polyhaven', 'painted_concrete_02', SMALL, 'paint on concrete for kerbs'],
    grass:         ['ambientcg', 'Grass004', RES, 'mown turf from above'],
    grass_worn:    ['polyhaven', 'grass_ground', SMALL, 'worn grass at verge edges'],
    gravel:        ['polyhaven', 'dry_river_pebbles', RES, 'rounded gravel for traps'],
    concrete:      ['polyhaven', 'concrete_wall_004', SMALL, 'barrier and wall concrete'],
    fence:         ['ambientcg', 'Fence006', SMALL, 'debris fence mesh with alpha', [2, 2]], // ambientCG gives no size: 2 m (unconfirmed)
    sand:          ['polyhaven', 'aerial_sand', SMALL, 'sand'],
};
const PH_MAPS = { diff: 'Diffuse', nor: 'nor_gl', rough: 'Rough' };
const ACG_MAPS = { diff: 'Color', nor: 'NormalGL', rough: 'Roughness', alpha: 'Opacity' };

async function download(url, file) {
    if (fs.existsSync(file)) return file;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
}

async function polyhaven(id) {
    const [files, info] = await Promise.all([`files/${id}`, `info/${id}`].map((p) => fetch(`https://api.polyhaven.com/${p}`).then((r) => r.json())));
    const maps = {};
    for (const [k, key] of Object.entries(PH_MAPS)) {
        const url = files[key]['2k'].jpg.url;
        maps[k] = await download(url, path.join(CACHE, path.basename(url)));
    }
    return { maps, sizeM: info.dimensions.map((mm) => mm / 1000), url: `https://polyhaven.com/a/${id}` };
}

async function ambientcg(id) {
    const j = await fetch(`https://ambientcg.com/api/v2/full_json?id=${id}`).then((r) => r.json()), a = j.foundAssets[0];
    const zip = await download(`https://ambientcg.com/get?file=${id}_2K-JPG.zip`, path.join(CACHE, `${id}_2K-JPG.zip`));
    const dir = path.join(CACHE, id);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
    const maps = {};
    for (const [k, suffix] of Object.entries(ACG_MAPS)) {
        const f = fs.readdirSync(dir).find((n) => n.endsWith(`_${suffix}.jpg`));
        if (f) maps[k] = path.join(dir, f);
    }
    return { maps, sizeM: [a.dimensionX / 100, a.dimensionY / 100], url: `https://ambientcg.com/view?id=${id}` };
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    fs.mkdirSync(CACHE, { recursive: true });
    const manifest = {};
    for (const [name, [lib, id, res, why, sizeM]] of Object.entries(PICKS)) {
        const got = lib === 'polyhaven' ? await polyhaven(id) : await ambientcg(id);
        const maps = {};
        for (const [k, src] of Object.entries(got.maps)) {
            maps[k] = `${name}_${k}_{res}.webp`;
            for (const r of res) {
                const out = path.join(OUT, maps[k].replace('{res}', r));
                // colour lossy q82; normals q90 (lossy is fine at these sizes, lossless would blow the budget)
                execFileSync('cwebp', ['-quiet', '-q', k === 'nor' ? '90' : '82', '-resize', String(r), String(r), src, '-o', out]);
            }
        }
        manifest[name] = { src: `${lib}:${id}`, url: got.url, licence: 'CC0', why, sizeM: sizeM || got.sizeM.map((v) => Math.round(v * 100) / 100), res, maps };
        console.log(`${name}: ${lib}:${id}, ${got.sizeM.join(' x ')} m`);
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const total = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
    console.log(`total ${(total / 1048576).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
