// The F1 car as three.js objects, from carShape.js's surfaces: a body (material 'livery', detail by distance) and four
// wheels named wheel_FL..RR, each the tyre then the wheel cover (game3d.js batches every car's wheels in that order).
// Liveries are painted off the main thread (livery-worker.js) into canvas textures.
import * as THREE from 'three';
import { bodyArrays, WHEELS, WHEEL_RADIUS, ATLAS } from './carShape.js';
export { WHEEL_RADIUS };

const toGeometry = ({ pos, nrm, uv, idx, col }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
};
const bodies = {};
export const bodyGeometry = (detail) => (bodies[detail] ||= toGeometry(bodyArrays(detail)));

// Lathe round the axle (three.js z): profile [radius, axial]; colour(radius) per vertex
function lathe(profile, segs, colour) {
    const pos = [], nrm = [], col = [], idx = [], m = profile.length;
    for (let i = 0; i <= segs; i++) {
        const a = (2 * Math.PI * i) / segs, c = Math.cos(a), s = Math.sin(a);
        profile.forEach(([r, z], j) => {
            pos.push(r * c, r * s, z);
            const p = profile[Math.max(0, j - 1)], q = profile[Math.min(m - 1, j + 1)], dr = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dr, dz) || 1;
            nrm.push((-dz / l) * c, (-dz / l) * s, dr / l); // the profile's outward side (it runs round the tyre clockwise)
            col.push(...colour(r));
        });
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = a + m; idx.push(a, b + 1, b, a, a + 1, b + 1); }
    return toGeometry({ pos, nrm, idx, col });
}
// Tyre at unit width (each wheel's scale.z makes it 305 / 405 mm): flat tread, rounded shoulders, sidewall with the
// Pirelli compound band; the wheel cover a shallow dish inside it
export function wheelGeometries(segs = 40) {
    const R = WHEEL_RADIUS, sh = 0.075, prof = [];
    const side = (z) => [0.262, 0.27, 0.281, 0.282, 0.298, 0.299, 0.31, R - sh].map((r) => [r, z]); // band: crisp edges
    prof.push(...side(0.5));
    for (let k = 1; k <= 6; k++) { const a = (Math.PI / 2) * (k / 6); prof.push([R - sh + sh * Math.sin(a), 0.5 - 0.12 * (1 - Math.cos(a))]); }
    for (let k = 0; k <= 6; k++) { const a = (Math.PI / 2) * (k / 6); prof.push([R - sh + sh * Math.cos(a), -0.5 + 0.12 * (1 - Math.sin(a))]); }
    prof.push(...side(-0.5).reverse());
    const tyre = lathe(prof, segs, (r) => (r >= 0.2815 && r <= 0.2985 ? [1.0, 0.82, 0.0] : [0.02, 0.02, 0.022]));
    const cover = lathe([[0.262, -0.52], [0.24, -0.5], [0.04, -0.47], [0, -0.47], [0, 0.47], [0.04, 0.47], [0.24, 0.5], [0.262, 0.52]], segs, () => [0.11, 0.11, 0.12]);
    return { tyre, cover };
}

let wheels = null;
// detail: 'low' | 'mid' | 'high'; lodM: world units past which the light body is drawn instead
export function buildCar(detail = 'mid', lodM = Infinity) {
    const root = new THREE.Group(), body = new THREE.LOD();
    body.name = 'bodyLOD';
    const mat = new THREE.MeshStandardMaterial({ name: 'livery', roughness: 0.55, metalness: 0.05 });
    const near = new THREE.Mesh(bodyGeometry(detail), mat);
    near.name = 'body';
    body.addLevel(near, 0);
    if (detail !== 'low' && Number.isFinite(lodM)) { const far = new THREE.Mesh(bodyGeometry('low'), mat); far.name = 'body'; body.addLevel(far, lodM); }
    root.add(body);
    const { tyre, cover } = (wheels ||= wheelGeometries(detail === 'high' ? 48 : detail === 'mid' ? 36 : 24));
    const tyreMat = new THREE.MeshStandardMaterial({ name: 'tyre', vertexColors: true, roughness: 0.92 });
    const coverMat = new THREE.MeshStandardMaterial({ name: 'rim', vertexColors: true, roughness: 0.4, metalness: 0.6 });
    for (const [name, [x, y, w]] of Object.entries(WHEELS)) {
        const g = new THREE.Group();
        g.name = name;
        g.position.set(x, WHEEL_RADIUS, -y);
        g.scale.set(1, 1, w);
        g.add(new THREE.Mesh(tyre, tyreMat), new THREE.Mesh(cover, coverMat));
        root.add(g);
    }
    return root;
}

// Team liveries, painted in a worker and cached as textures; until one is ready the car shows plain grey
const textures = {};
let worker = null;
export function liveryTexture(teamId, anisotropy = 4) {
    if (textures[teamId]) return textures[teamId];
    const data = new Uint8Array(ATLAS * ATLAS * 4).fill(140), tex = new THREE.DataTexture(data, ATLAS, ATLAS);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    textures[teamId] = tex;
    worker ||= new Worker(new URL('./livery-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data: d }) => {
        if (d.teamId !== teamId) return;
        tex.image.data.set(new Uint8Array(d.pixels));
        tex.needsUpdate = true;
    });
    worker.postMessage({ teamId, size: ATLAS });
    return tex;
}
