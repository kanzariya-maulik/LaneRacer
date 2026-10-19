// Photo materials for the track (CC0 textures, public/textures/manifest.json; scripts/fetch-textures.js): the asphalt, the
// ground splat (what each 0.5 m cell of the surface grid is: grass, gravel, run-off asphalt, paint...), kerbs and lines.
// Everything is mapped in world space (metres), so the road, the run-off and the pit lane continue one texture.
import * as THREE from 'three';
import { texture, positionWorld, attribute, uv, uniform, vec2, vec3, float, mix, smoothstep, step, sin, floor, fract, normalMap, mx_noise_float } from 'three/tsl';
import { LEVELS } from './quality.js';

const manifest = await (await fetch('/textures/manifest.json')).json();
const loader = new THREE.TextureLoader();
const caches = new Map();
export const sizeOf = (name) => manifest[name]?.sizeM?.[0] || 2;

// Every texture at the level's resolution (the largest the manifest has up to it); returned at once, each fills in when its
// image arrives (a session never waits on them). Cached per resolution: a new world reuses them
export function loadTrackTextures(level) {
    const L = LEVELS[level] || LEVELS.medium, key = `${L.texRes}`;
    if (!caches.has(key)) {
        const out = {};
        for (const [name, m] of Object.entries(manifest)) {
            const res = m.res.filter((r) => r <= L.texRes).at(-1) || m.res[0];
            out[name] = { sizeM: m.sizeM, avg: uniform(new THREE.Color(0.5, 0.5, 0.5)) }; // avg: the photo's mean colour (linear), once loaded
            for (const [map, file] of Object.entries(m.maps)) {
                const t = loader.load(`/textures/${file.replace('{res}', res)}`, map === 'diff' ? (tx) => out[name].avg.value.copy(meanColor(tx.image)) : undefined);
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                if (map === 'diff') t.colorSpace = THREE.SRGBColorSpace;
                out[name][map] = t;
            }
        }
        caches.set(key, out);
    }
    const out = caches.get(key);
    for (const n in out) for (const m of ['diff', 'nor', 'rough', 'alpha']) if (out[n][m]) out[n][m].anisotropy = L.anisotropy;
    return out;
}

// Mean colour of an image (linear): the shaders scale each photo to the colour a surface really has
function meanColor(img) {
    const c = document.createElement('canvas'), N = 32;
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data, sum = [0, 0, 0], lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += lin(d[i + k]);
    return new THREE.Color(...sum.map((v) => Math.max(1e-3, v / (N * N))));
}

const metres = (sc) => { const p = positionWorld.xz.div(sc); p.userData = {}; return p; };
const noise = (p, f) => mx_noise_float(vec3(p.mul(f), 0)); // about -1..1
const rot = (p, a) => vec2(p.x.mul(Math.cos(a)).sub(p.y.mul(Math.sin(a))), p.x.mul(Math.sin(a)).add(p.y.mul(Math.cos(a))));

// A photo texture sampled twice (the second turned 37° and scaled 0.71) and blended by slow noise: no repeat shows
// down a long straight; plus ±6 % brightness over tens of metres. Returns { color, rough, nor } nodes at world metres p
function antiTiled(T, p) {
    const s = 1 / T.sizeM[0], a = p.mul(s), b = rot(p.mul(s * 0.71), (37 * Math.PI) / 180).add(0.37);
    const { w, macro } = (p.userData.tiling ||= { w: smoothstep(-0.35, 0.35, noise(p, 0.045)), macro: float(1).add(noise(p, 0.013).mul(0.06)) }); // once per fragment
    const pick = (map) => mix(texture(T[map], a), texture(T[map], b), w);
    const c = pick('diff').rgb.mul(macro);
    return { color: c, flat: c.div(T.avg), rough: pick('rough').r, nor: pick('nor').rgb }; // flat: mean 1, to be coloured
}

// The circuit's asphalt (build.asphalt.tone: 0 fresh and black, 1 old and grey: 4.5 % to 13 % reflectance, a faint blue
// grey) at world metres p; the photo gives the grain
const ASPHALT_ALBEDO = [0.045, 0.13];
function asphaltAt(tex, build, p, name = 'asphalt') {
    const A = antiTiled(tex[name], p), tone = build?.asphalt?.tone ?? 0.5, a = ASPHALT_ALBEDO[0] + (ASPHALT_ALBEDO[1] - ASPHALT_ALBEDO[0]) * tone;
    const lum = A.flat.dot(vec3(0.3, 0.59, 0.11));
    return { ...A, color: vec3(a * 0.97, a, a * 1.04).mul(lum) };
}

const standard = (n) => { const m = new THREE.MeshStandardNodeMaterial(); Object.assign(m, n); return m; };

// Road, apron and pit lane. Patches (build.asphalt.patchesM, lap metres) are fresher: darker and a touch smoother;
// the `track` attribute (trackMesh.js: lap metres per vertex) says where
export function asphaltMaterial(tex, build, sc, { pit = false } = {}) {
    const p = metres(sc), A = asphaltAt(tex, build, p, pit ? 'asphalt_pit' : 'asphalt');
    let color = A.color, rough = A.rough;
    if (!pit) for (const q of (build?.asphalt?.patchesM || []).slice(0, 8)) {
        const lap = attribute('track', 'vec2').x, edge = noise(p, 0.6).mul(1.5); // ragged ends
        const inside = step(q.fromM, lap.add(edge)).mul(step(lap.add(edge), q.toM));
        const P = antiTiled(tex.asphalt_patch, p);
        color = mix(color, color.mul(P.flat.dot(vec3(0.3, 0.59, 0.11))).mul(0.72), inside);
        rough = mix(rough, P.rough.mul(0.9), inside);
    }
    return standard({ colorNode: color, roughnessNode: rough, normalNode: normalMap(A.nor), metalness: 0 });
}

// The ground beyond the road (the verges and the terrain): per fragment the surface kind from the grid (0.5 m cells),
// grid: { x0, y0, w, h, cell, data } (world units; data: KINDS indices); base: what grass-coded cells show here ('grass', 'sand' or 'concrete'), coloured
// target (null: the photo's own colour), dim multiplies everything (night); stripeDir: the mowing direction (radians, x-z)
export function groundMaterial(tex, build, sc, grid, { base = 'grass', target = null, dim = 1, stripeDir = 0 } = {}) {
    const p = metres(sc), G = antiTiled(tex[base] || tex.grass, p);
    // mown stripes, 5 m, ±4 % (green ground only)
    const along = p.x.mul(Math.cos(stripeDir)).add(p.y.mul(Math.sin(stripeDir))), mown = base === 'grass' ? float(1).add(step(0, sin(along.mul(Math.PI / 5))).sub(0.5).mul(0.08)) : float(1);
    const grassC = (target ? G.flat.mul(vec3(...new THREE.Color(target).toArray())) : G.color).mul(mown);
    if (!grid) return standard({ colorNode: grassC.mul(dim), roughnessNode: G.rough, normalNode: normalMap(G.nor), metalness: 0 }); // the land beyond the barriers

    const kindTex = new THREE.DataTexture(grid.data, grid.w, grid.h, THREE.RedFormat, THREE.UnsignedByteType);
    kindTex.magFilter = kindTex.minFilter = THREE.NearestFilter;
    kindTex.needsUpdate = true;
    const g0 = vec2(grid.x0 / sc, grid.y0 / sc);
    // the four cells around a wobbled point (0.6 m slow, 0.15 m ragged), weighted bilinearly: each kind's share is a smooth
    // field whose half-way line runs between the cell centres, so edges follow curves instead of the 0.5 m steps
    const wob = vec2(noise(p, 0.35), noise(p.add(31.7), 0.35)).mul(0.6).add(vec2(noise(p, 2.5), noise(p.add(7.3), 2.5)).mul(0.15));
    const q = p.add(wob).sub(g0).div(grid.cell / sc).sub(0.5), i0 = floor(q), f = fract(q);
    const K = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => {
        const t = i0.add(vec2(dx + 0.5, dy + 0.5)).div(vec2(grid.w, grid.h)), inside = step(0, t.x).mul(step(t.x, 1)).mul(step(0, t.y)).mul(step(t.y, 1));
        return texture(kindTex, t).r.mul(255).mul(inside); // outside the grid: 0, grass
    });
    const W = [float(1).sub(f.x).mul(float(1).sub(f.y)), f.x.mul(float(1).sub(f.y)), float(1).sub(f.x).mul(f.y), f.x.mul(f.y)];
    const share = (lo, hi) => K.map((k, i) => W[i].mul(step(lo - 0.5, k)).mul(step(k, hi + 0.5))).reduce((a, b) => a.add(b)), cube = (v) => v.mul(v).mul(v);
    // kinds in groups that look alike (paint: asphalt here, game3d.js draws the paint itself, crisp), only those the
    // circuit has; sharpened and normalised: about half a metre of blend
    const has = new Set((build?.surfaces || []).map((x) => x.kind)), layers = [{ w: share(0, 0), color: grassC, rough: G.rough, nor: G.nor }];
    if (['road', 'kerb', 'asphalt', 'paint'].some((k) => has.has(k))) { const A = asphaltAt(tex, build, p); layers.push({ w: share(1, 4), ...A }); }
    if (has.has('gravel')) { const S = antiTiled(tex.gravel, p); layers.push({ w: share(6, 6), ...S }); }
    if (has.has('astroturf')) layers.push({ w: share(5, 5), color: vec3(0.16, 0.42, 0.13).mul(float(0.9).add(noise(p, 9).mul(0.1))).mul(float(1).add(step(0, sin(along.mul(Math.PI / 1.8))).sub(0.5).mul(0.06))), rough: float(0.85), nor: vec3(0.5, 0.5, 1) });
    for (const l of layers) l.w = cube(l.w);
    const total = layers.reduce((a, l) => a.add(l.w), float(0)).max(1e-4), sum = (k) => layers.map((l) => l[k].mul(l.w)).reduce((a, b) => a.add(b)).div(total);
    return standard({ colorNode: sum('color').mul(dim), roughnessNode: sum('rough'), normalNode: normalMap(sum('nor')), metalness: 0 });
}

// Kerbs: the stripe colours (a 1 x n texture repeating along v, metres) over the kerb paint photo's grain and wear
export function kerbMaterial(tex, stripes, sc) {
    const p = metres(sc), K = antiTiled(tex.kerb_paint, p), lum = K.flat.dot(vec3(0.3, 0.59, 0.11));
    const color = texture(stripes, uv().mul(vec2(1, stripes.repeat.y))).rgb.mul(lum.clamp(0.75, 1.1)).mul(0.85);
    return standard({ colorNode: color, roughnessNode: K.rough.mul(0.8), normalNode: normalMap(K.nor), metalness: 0 });
}

// White lines and painted run-off: paint over the asphalt's grain, a little worn
export function paintMaterial(tex, sc, color = '#e6e6e0', worn = 0.35) {
    const p = metres(sc), A = antiTiled(tex.asphalt, p), wear = smoothstep(0.25, 0.65, noise(p, 3.1).mul(0.5).add(0.5)).mul(worn);
    const c = vec3(...new THREE.Color(color).toArray()).mul(A.flat.dot(vec3(0.3, 0.59, 0.11)).clamp(0.85, 1.1));
    return standard({ colorNode: mix(c, A.color, wear), roughnessNode: mix(float(0.55), A.rough, wear), metalness: 0 });
}
