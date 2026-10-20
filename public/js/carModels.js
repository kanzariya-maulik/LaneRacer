// The real cars (scripts/cars/build.py: one GLB per team, two LODs, wheels and the driver's eye as markers) and the shared
// parts (tyres per compound, helmet). Loaded once per page; a team whose GLB is missing or broken keeps the procedural car.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let loader = null;
const gltfLoad = (url) => (loader ||= new GLTFLoader()).loadAsync(url);
// The file's bytes alone (no main-thread cost while it downloads) and, separately, its parse (geometry, texture decode)
export const fetchModel = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); });
export const parseModel = (buf) => (loader ||= new GLTFLoader()).parseAsync(buf, '');
const carFrame = (o) => [o.position.x, -o.position.z, o.position.y]; // glTF y up → car frame (x forward, y left, z up)
const WHEEL_NAMES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];

const teamCars = new Map(); // teamId → Promise<CarAsset | null>
export function loadTeamCar(teamId, load = gltfLoad) {
    if (!teamCars.has(teamId)) teamCars.set(teamId, load(`models/cars/${teamId}.glb`).then(toAsset).catch(() => null));
    return teamCars.get(teamId);
}

function toAsset({ scene }) {
    const get = (name) => scene.getObjectByName(name);
    const near = get('lod_near'), far = get('lod_far');
    if (!near || !far) return null;
    const wheels = {};
    for (const name of WHEEL_NAMES) {
        const w = get(name);
        if (!w) return null;
        wheels[name] = { pos: carFrame(w), radius: w.userData.radius, width: w.userData.width };
    }
    const at = (name) => (get(name) ? carFrame(get(name)) : null);
    for (const m of [near, far]) m.position.set(0, 0, 0); // the LOD places them
    return { near, far, wheels, eye: at('eye'), wheelPos: at('wheel_pos'), head: at('head') };
}

// One car's body: near model up close, far past lodM (0: far only). The team's materials are shared by its cars: one
// shader build per team, not per car (each clone was a build: 21 of them stalled the race for a frame or more)
export function cloneForCar(asset, lodM) {
    const lod = new THREE.LOD();
    for (const [m, d] of [[asset.near, 0], [asset.far, lodM]]) {
        const c = m.clone();
        c.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = o.receiveShadow = true;
            o.layers.enable(1);
        });
        lod.addLevel(c, d);
    }
    return lod;
}

// A ghost car (first corners, quali): its materials swapped for see-through copies, one copy per material made once
// (flipping `transparent` on the shared ones would rebuild their shaders, and fade every car of the team)
const ghosts = new WeakMap();
export function ghostOf(m) {
    let g = ghosts.get(m);
    if (!g) { g = m.clone(); g.transparent = true; g.opacity = 0.5; ghosts.set(m, g); }
    return g;
}
export function setGhost(root, on) {
    root.traverse((o) => {
        if (!o.material || o.isSprite) return;
        o.userData.solid ||= o.material;
        o.material = on ? ghostOf(o.userData.solid) : o.userData.solid;
    });
}

export const detailFor = (level) => (level === 'low' ? 'far' : 'near');

export const preloadTeams = (teamIds) => Promise.all(teamIds.map((id) => loadTeamCar(id))).then(() => {});

let parts = null;
export function loadParts(load = gltfLoad) {
    parts ||= Promise.all([load('models/tyre.glb'), load('models/helmet.glb')]).then(([t, h]) => {
        const get = (s, name) => s.scene.getObjectByName(name);
        const tyres = { S: get(t, 'tyre_S'), M: get(t, 'tyre_M'), H: get(t, 'tyre_H'), rim: get(t, 'rim') };
        const helmet = get(h, 'helmet'), shoulders = get(h, 'shoulders');
        // The GLB's rubber is glossy in places (its roughness map) and its rim a black mirror (roughness 0): under the sky
        // reflections both read as white chrome speckle. Rubber is matte (~0.9), a painted rim satin
        for (const k of ['S', 'M', 'H']) if (tyres[k]?.material) Object.assign(tyres[k].material, { roughnessMap: null, roughness: 0.9 });
        if (tyres.rim?.material) tyres.rim.material.roughness = 0.45;
        return Object.values(tyres).every((m) => m?.isMesh) && helmet && shoulders ? { tyres, helmet, shoulders } : null;
    }).catch(() => null);
    return parts;
}
