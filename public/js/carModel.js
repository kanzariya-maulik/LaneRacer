// The F1 car as three.js objects, from carShape.js's surfaces: a body (material 'livery', detail by distance) and four
// wheels named wheel_FL..RR, each the tyre then the wheel cover (game3d.js batches every car's wheels in that order).
// Liveries are painted off the main thread (livery-worker.js) into canvas textures.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bodyArrays, drsFlapArrays, WHEELS, WHEEL_RADIUS, ATLAS } from './carShape.js';
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

const flaps = {};
export const drsFlapGeometry = (detail) => (flaps[detail] ||= toGeometry(drsFlapArrays(detail)));

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

// 18-inch BBS competition forged wheel & Pirelli P-Zero tyre
export function wheelGeometries(segs = 48) {
    const R = WHEEL_RADIUS, sh = 0.075, prof = [];
    const side = (z) => [0.262, 0.27, 0.281, 0.282, 0.298, 0.299, 0.31, R - sh].map((r) => [r, z]);
    prof.push(...side(0.5));
    for (let k = 1; k <= 8; k++) { const a = (Math.PI / 2) * (k / 8); prof.push([R - sh + sh * Math.sin(a), 0.5 - 0.12 * (1 - Math.cos(a))]); }
    for (let k = 0; k <= 8; k++) { const a = (Math.PI / 2) * (k / 8); prof.push([R - sh + sh * Math.cos(a), -0.5 + 0.12 * (1 - Math.sin(a))]); }
    prof.push(...side(-0.5).reverse());
    const tyre = lathe(prof, segs, (r) => (r >= 0.2815 && r <= 0.2985 ? [1.0, 0.82, 0.0] : [0.025, 0.025, 0.028]));
    
    // BBS aero cover with center-lock wheel nut and recessed spokes
    const coverProf = [
        [0.262, -0.52], [0.250, -0.51], [0.220, -0.49], [0.150, -0.48],
        [0.055, -0.47], [0.035, -0.45], [0.015, -0.44], [0, -0.44],
        [0, 0.44], [0.015, 0.44], [0.035, 0.45], [0.055, 0.47],
        [0.150, 0.48], [0.220, 0.49], [0.250, 0.51], [0.262, 0.52]
    ];
    const cover = lathe(coverProf, segs, (r) => {
        if (r <= 0.035) return [0.85, 0.15, 0.15]; // Red anodized center-lock nut
        if (r <= 0.065) return [0.15, 0.15, 0.16]; // Dark alloy hub collar
        if (r <= 0.220) return [0.24, 0.25, 0.27]; // Metallic BBS face
        return [0.10, 0.10, 0.12];                 // Carbon outer aero lip
    });
    return { tyre, cover };
}

// 2026 Red Bull RB22 Model Caching & Team Liveries
let gltfCarTemplate = null;
let gltfPromise = null;
let nativeRedBullMap = null;
const modelReadyCallbacks = [];
const teamLiveryTextures = {};
const textureLoader = new THREE.TextureLoader();

export function loadF1Model() {
    if (gltfCarTemplate) return Promise.resolve(gltfCarTemplate);
    if (gltfPromise) return gltfPromise;

    gltfPromise = new Promise((resolve) => {
        try {
            const loader = new GLTFLoader();
            loader.load(
                '/model/2026_redbull_rb22.glb',
                (gltf) => {
                    const rawModel = gltf.scene;

                    rawModel.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            if (child.material) {
                                if (child.material.map) {
                                    child.material.map.anisotropy = 16;
                                    child.material.map.generateMipmaps = true;
                                    child.material.map.minFilter = THREE.LinearMipmapLinearFilter;
                                    child.material.map.magFilter = THREE.LinearFilter;
                                    child.material.map.colorSpace = THREE.SRGBColorSpace;
                                    child.material.map.wrapS = THREE.RepeatWrapping;
                                    child.material.map.wrapT = THREE.RepeatWrapping;
                                    child.material.map.needsUpdate = true;
                                }
                                if (child.material.normalMap) {
                                    child.material.normalMap.anisotropy = 16;
                                    child.material.normalMap.generateMipmaps = true;
                                    child.material.normalMap.needsUpdate = true;
                                }
                            }
                        }
                    });

                    // Cache native Red Bull factory 4K body texture
                    const obj9 = rawModel.getObjectByName('Object_9');
                    if (obj9 && obj9.material && obj9.material.map) {
                        nativeRedBullMap = obj9.material.map;
                        nativeRedBullMap.wrapS = THREE.RepeatWrapping;
                        nativeRedBullMap.wrapT = THREE.RepeatWrapping;
                        nativeRedBullMap.anisotropy = 16;
                    }

                    // Hide static wheel meshes in GLB (Object_11: discs, Object_12: wheel_hub, Object_13: sidewall, Object_14: sidewall)
                    for (const name of ['Object_11', 'Object_12', 'Object_13', 'Object_14']) {
                        const obj = rawModel.getObjectByName(name);
                        if (obj) {
                            obj.visible = false;
                            obj.castShadow = false;
                        }
                    }

                    // Align model: Rotate +90 degrees around Y so nose points +X (forward)
                    // Offset by X = -0.125 so wheelbase midpoint aligns with LaneRacer's axle midpoint
                    // Offset Y = 0.04 to align wheel hubs with 0.36m wheel radius
                    const chassisGroup = new THREE.Group();
                    chassisGroup.name = 'f1Chassis';
                    rawModel.rotation.y = Math.PI / 2;
                    rawModel.position.set(-0.125, 0.04, 0);
                    chassisGroup.add(rawModel);

                    gltfCarTemplate = chassisGroup;
                    for (const cb of modelReadyCallbacks) {
                        try { cb(gltfCarTemplate); } catch (e) { console.error(e); }
                    }
                    modelReadyCallbacks.length = 0;

                    // Asynchronously preload all team liveries for zero-latency switching
                    preloadTeamLiveries();
                    resolve(gltfCarTemplate);
                },
                undefined,
                (err) => {
                    console.warn('Could not load /model/2026_redbull_rb22.glb, fallback to procedural car:', err);
                    resolve(null);
                }
            );
        } catch (e) {
            console.warn('GLTFLoader error, fallback to procedural car:', e);
            resolve(null);
        }
    });

    return gltfPromise;
}

export function onF1ModelReady(cb) {
    if (gltfCarTemplate) cb(gltfCarTemplate);
    else modelReadyCallbacks.push(cb);
}

export function getF1Template() {
    return gltfCarTemplate;
}

export const TEAM_PALETTES = {
    redbull: {
        primary: 0x0e1b30,
        accent: 0xe10600,
        stripe: 0xf59e0b,
        isRedBull: true,
        gloss: 0.18,
        metal: 0.16,
        trimColor: 0xf59e0b,
        wingColor: 0xffffff,
        mirrorColor: 0x0e1b30,
    },
    'redbull-suzuka': {
        primary: 0xf6f6f8,
        accent: 0xe10600,
        stripe: 0x1a1a1e,
        isRedBull: false,
        isSuzuka: true,
        gloss: 0.18,
        metal: 0.10,
        trimColor: 0xe10600,
        wingColor: 0xe10600,
        mirrorColor: 0xe10600,
    },
    mercedes: {
        primary: 0xc4c8cc,
        accent: 0x00d2be,
        stripe: 0x121316,
        isRedBull: false,
        gloss: 0.15,
        metal: 0.40,
        trimColor: 0x00d2be,
        wingColor: 0x00d2be,
        mirrorColor: 0x121316,
    },
    ferrari: {
        primary: 0xe8002d,
        accent: 0xffe500,
        stripe: 0x141416,
        isRedBull: false,
        gloss: 0.15,
        metal: 0.12,
        trimColor: 0xffe500,
        wingColor: 0xe8002d,
        mirrorColor: 0xe8002d,
    },
    mclaren: {
        primary: 0xff8000,
        accent: 0x1482ff,
        stripe: 0x1a1a1d,
        isRedBull: false,
        gloss: 0.18,
        metal: 0.12,
        trimColor: 0x1482ff,
        wingColor: 0xff8000,
        mirrorColor: 0x1482ff,
    },
    astonmartin: {
        primary: 0x00594f,
        accent: 0xcedc00,
        stripe: 0x0c0d10,
        isRedBull: false,
        gloss: 0.16,
        metal: 0.28,
        trimColor: 0xcedc00,
        wingColor: 0x00594f,
        mirrorColor: 0x00594f,
    },
    alpine: {
        primary: 0x0078d7,
        accent: 0xff87bc,
        stripe: 0x111215,
        isRedBull: false,
        gloss: 0.18,
        metal: 0.15,
        trimColor: 0xff87bc,
        wingColor: 0xff87bc,
        mirrorColor: 0xff87bc,
    },
    williams: {
        primary: 0x041e42,
        accent: 0x00a3e0,
        stripe: 0x0a0b0e,
        isRedBull: false,
        gloss: 0.18,
        metal: 0.16,
        trimColor: 0x00a3e0,
        wingColor: 0x00a3e0,
        mirrorColor: 0x00a3e0,
    },
    alphatauri: {
        primary: 0x022b44,
        accent: 0xffffff,
        stripe: 0x2563eb,
        isRedBull: false,
        gloss: 0.22,
        metal: 0.12,
        trimColor: 0xffffff,
        wingColor: 0x022b44,
        mirrorColor: 0xffffff,
    },
    alfaromeo: {
        primary: 0x981e32,
        accent: 0xffffff,
        stripe: 0x121214,
        isRedBull: false,
        gloss: 0.16,
        metal: 0.24,
        trimColor: 0xffffff,
        wingColor: 0x981e32,
        mirrorColor: 0x981e32,
    },
    haas: {
        primary: 0xf2f2f4,
        accent: 0xe10600,
        stripe: 0x1e1f22,
        isRedBull: false,
        gloss: 0.20,
        metal: 0.10,
        trimColor: 0xe10600,
        wingColor: 0xe10600,
        mirrorColor: 0xe10600,
    },
};

export function getTeamLiveryTexture(teamId) {
    if (teamLiveryTextures[teamId]) return teamLiveryTextures[teamId];
    if (teamId === 'redbull') return nativeRedBullMap;

    const url = `/model/liveries/${teamId}.png`;
    const tex = textureLoader.load(
        url,
        (loadedTex) => {
            loadedTex.colorSpace = THREE.SRGBColorSpace;
            loadedTex.wrapS = THREE.RepeatWrapping;
            loadedTex.wrapT = THREE.RepeatWrapping;
            loadedTex.generateMipmaps = true;
            loadedTex.minFilter = THREE.LinearMipmapLinearFilter;
            loadedTex.magFilter = THREE.LinearFilter;
            loadedTex.anisotropy = 16;
            loadedTex.needsUpdate = true;
        },
        undefined,
        (err) => {
            console.warn(`Could not load team livery texture: ${url}`, err);
        }
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
    teamLiveryTextures[teamId] = tex;
    return tex;
}

export function preloadTeamLiveries() {
    for (const teamId of Object.keys(TEAM_PALETTES)) {
        if (teamId !== 'redbull') {
            getTeamLiveryTexture(teamId);
        }
    }
}

export function applyTeamLiveryToModel(model, teamId) {
    const pal = TEAM_PALETTES[teamId] || TEAM_PALETTES.mercedes;
    const isRedBullCar = teamId === 'redbull';

    model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;

        if (o.material) o.material = o.material.clone();

        if (o.material?.name === 'livery') {
            o.material.map = liveryTexture(teamId);
            o.material.needsUpdate = true;
        }

        // Object_9: Bodywork Paint (Material: redbull_paint.007)
        if (o.name === 'Object_9' || o.material?.name?.includes('paint')) {
            if (isRedBullCar) {
                // RED BULL: Native 4K Oracle Red Bull Racing factory livery
                o.material.map = nativeRedBullMap || o.material.map;
                o.material.color.setHex(0xffffff);
            } else {
                // OTHER TEAMS: Team-specific high-definition livery texture
                const tex = getTeamLiveryTexture(teamId);
                o.material.map = tex;
                o.material.color.setHex(0xffffff);
            }
            if (o.material.map) {
                o.material.map.wrapS = THREE.RepeatWrapping;
                o.material.map.wrapT = THREE.RepeatWrapping;
                o.material.map.anisotropy = 16;
                o.material.map.colorSpace = THREE.SRGBColorSpace;
                o.material.map.needsUpdate = true;
            }
            o.material.roughness = pal.gloss || 0.18;
            o.material.metalness = pal.metal || 0.16;
            if ('clearcoat' in o.material) {
                o.material.clearcoat = 0.95;
                o.material.clearcoatRoughness = 0.05;
            }
            o.material.needsUpdate = true;
        }

        // Object_21 & Object_19: Decals and numbers
        if (o.name === 'Object_21' || o.name === 'Object_19' || o.material?.name?.includes('decals') || o.material?.name?.includes('number')) {
            o.visible = isRedBullCar;
            if (o.material) {
                o.material.transparent = true;
                o.material.depthWrite = false;
                o.material.polygonOffset = true;
                o.material.polygonOffsetFactor = -1.5;
                o.material.polygonOffsetUnits = -3;
                if (o.material.map) {
                    o.material.map.anisotropy = 16;
                    o.material.map.generateMipmaps = true;
                    o.material.map.minFilter = THREE.LinearMipmapLinearFilter;
                    o.material.map.magFilter = THREE.LinearFilter;
                    o.material.map.colorSpace = THREE.SRGBColorSpace;
                    o.material.map.needsUpdate = true;
                }
            }
        }

        // Object_24: Accent trim (nose tip, airbox rim, halo crest)
        if (o.name === 'Object_24' || o.material?.name?.includes('color')) {
            if (isRedBullCar) {
                o.material.color.setHex(0xffffff);
            } else {
                o.material.map = null;
                o.material.color.setHex(pal.trimColor || pal.accent);
            }
            o.material.roughness = 0.18;
            o.material.metalness = pal.metal || 0.20;
            if ('clearcoat' in o.material) {
                o.material.clearcoat = 0.92;
                o.material.clearcoatRoughness = 0.06;
            }
            o.material.needsUpdate = true;
        }

        // Object_4 & Object_7: Front and rear wings
        if (o.name === 'Object_4' || o.name === 'Object_7' || o.material?.name?.includes('carbon1') || o.material?.name?.includes('carbon3')) {
            if (isRedBullCar) {
                o.material.color.setHex(0xffffff);
            } else if (pal.wingColor) {
                o.material.color.setHex(pal.wingColor);
            }
            o.material.needsUpdate = true;
        }

        // Object_29: Rear-view mirrors
        if (o.name === 'Object_29' || o.material?.name?.includes('mirror')) {
            if (isRedBullCar) {
                o.material.color.setHex(0x0e1b30);
            } else if (pal.mirrorColor) {
                o.material.color.setHex(pal.mirrorColor);
            }
            o.material.needsUpdate = true;
        }

        // Object_10: FIA safety rain LED (Material: rear_light_2.007)
        if (o.name === 'Object_10' || o.material?.name?.includes('rear_light')) {
            o.material = new THREE.MeshStandardMaterial({
                color: 0x220000,
                emissive: 0xff1010,
                emissiveIntensity: 0.4,
                roughness: 0.2,
                metalness: 0.8
            });
        }
    });
}

let wheels = null;
// detail: 'low' | 'mid' | 'high'; lodM: world units past which the light body is drawn instead
export function buildCar(detail = 'mid', lodM = Infinity) {
    const root = new THREE.Group(), body = new THREE.LOD();
    body.name = 'bodyLOD';
    const mat = new THREE.MeshStandardMaterial({ name: 'livery', roughness: 0.38, metalness: 0.22 });
    const near = new THREE.Mesh(bodyGeometry(detail), mat);
    near.name = 'body';

    if (gltfCarTemplate) {
        const gltfClone = gltfCarTemplate.clone(true);
        gltfClone.name = 'f1Model';
        body.addLevel(gltfClone, 0);
        if (Number.isFinite(lodM)) {
            const far = new THREE.Mesh(bodyGeometry('low'), mat);
            far.name = 'body';
            body.addLevel(far, lodM);
        }
    } else {
        body.addLevel(near, 0);
        if (detail !== 'low' && Number.isFinite(lodM)) {
            const far = new THREE.Mesh(bodyGeometry('low'), mat);
            far.name = 'body';
            body.addLevel(far, lodM);
        }
    }
    root.add(body);

    // DRS Rear Wing Flap (only visible for fallback procedural body; 2026 model has integrated rear wing)
    const drsGroup = new THREE.Group();
    drsGroup.name = 'drsWing';
    drsGroup.position.set(-2.25, 0.91, 0);
    const drsMesh = new THREE.Mesh(drsFlapGeometry(detail), mat);
    drsMesh.name = 'drsFlap';
    drsGroup.add(drsMesh);
    if (gltfCarTemplate) drsGroup.visible = false;
    root.add(drsGroup);

    const { tyre, cover } = (wheels ||= wheelGeometries(detail === 'high' ? 64 : detail === 'mid' ? 44 : 28));
    const tyreMat = new THREE.MeshStandardMaterial({ name: 'tyre', vertexColors: true, roughness: 0.82, metalness: 0.05 });
    const coverMat = new THREE.MeshStandardMaterial({ name: 'rim', vertexColors: true, roughness: 0.22, metalness: 0.82 });
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
