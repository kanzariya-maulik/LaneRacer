// The F1 car as three.js objects, from carShape.js's surfaces: a body (material 'livery', detail by distance) and four
// wheels named wheel_FL..RR, each the tyre then the wheel cover (game3d.js batches every car's wheels in that order).
// Liveries are painted off the main thread (livery-worker.js) into canvas textures.
import * as THREE from 'three';
import { bodyArrays, WHEELS, WHEEL_RADIUS, ATLAS } from './carShape.js';
import { WHEEL_POS, toThree } from './views.js';
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
// Pirelli compound band, coloured per car by the wheel batch's instance colour; the wheel cover a shallow dish inside it
export function wheelGeometries(segs = 40) {
    const R = WHEEL_RADIUS, sh = 0.075, prof = [];
    const side = (z) => [0.262, 0.27, 0.281, 0.282, 0.298, 0.299, 0.31, R - sh].map((r) => [r, z]); // band: crisp edges
    prof.push(...side(0.5));
    for (let k = 1; k <= 6; k++) { const a = (Math.PI / 2) * (k / 6); prof.push([R - sh + sh * Math.sin(a), 0.5 - 0.12 * (1 - Math.cos(a))]); }
    for (let k = 0; k <= 6; k++) { const a = (Math.PI / 2) * (k / 6); prof.push([R - sh + sh * Math.cos(a), -0.5 + 0.12 * (1 - Math.sin(a))]); }
    prof.push(...side(-0.5).reverse());
    const tyre = lathe(prof, segs, (r) => (r >= 0.2815 && r <= 0.2985 ? [1.0, 1.0, 1.0] : [0.02, 0.02, 0.022]));
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

// The steering wheel, cockpit view only (one, on the car the camera follows): an F1 rim with grips, a display, two gloves.
// Model frame (metres, three.js: x forward, y up, z right). spin turns about the column: +x = clockwise from the driver = right.
export function buildSteeringWheel(canvas, glove = '#e10600') {
    const root = new THREE.Group(), spin = new THREE.Group();
    root.name = 'steeringWheel';
    root.position.set(...toThree(WHEEL_POS));
    root.rotation.z = -0.5; // top leaning forward: the face looks up at the driver's eyes, like the column in a real F1 car
    root.add(spin);
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45, metalness: 0.3 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.95 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: glove, roughness: 0.8 });
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.2), carbon);
    rim.name = 'rim';
    spin.add(rim);
    for (const s of [1, -1]) {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 12), rubber);
        grip.name = 'grip';
        grip.position.set(-0.005, -0.005, 0.12 * s);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), gloveMat);
        hand.name = 'glove';
        hand.scale.set(1, 1.35, 1);
        hand.position.set(-0.03, 0, 0.125 * s);
        spin.add(grip, hand);
    }
    canvas.width = 256; canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    display.name = 'wheelDisplay';
    display.position.set(-0.016, 0.01, 0);
    display.rotation.y = -Math.PI / 2; // faces the driver (-x)
    spin.add(display);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.layers.enable(1); } });
    const ctx = canvas.getContext('2d');
    const REV = ['#22c55e', '#22c55e', '#22c55e', '#22c55e', '#22c55e', '#ef4444', '#ef4444', '#ef4444', '#ef4444', '#ef4444', '#3b82f6', '#3b82f6', '#3b82f6', '#3b82f6', '#3b82f6'];
    function draw({ gear, kmh, lit, drs }) {
        ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, 256, 128);
        REV.forEach((c, i) => { ctx.fillStyle = i < lit ? c : '#1f2937'; ctx.fillRect(8 + i * 16, 6, 12, 12); });
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '900 72px sans-serif'; ctx.fillText(gear || 'N', 128, 76);
        ctx.font = '800 26px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(kmh, 10, 76);
        ctx.fillStyle = drs ? '#22c55e' : '#1f2937'; ctx.fillRect(196, 62, 52, 28);
        ctx.fillStyle = drs ? '#05070a' : '#6b7280'; ctx.font = '800 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('DRS', 222, 77);
        tex.needsUpdate = true;
    }
    draw({ gear: 'N', kmh: '0', lit: 0, drs: false });
    return { root, spin, setGlove: (c) => gloveMat.color.set(c), draw };
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
