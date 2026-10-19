// The real cars (scripts/cars/build.py: one GLB per team, two LODs, wheels and the driver's eye as markers) and the shared
// parts (tyres per compound, helmet). Loaded once per page; a team whose GLB is missing or broken keeps the procedural car.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let loader = null;
const gltfLoad = (url) => (loader ||= new GLTFLoader()).loadAsync(url);
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

// One car's body: near model up close, far past lodM (0: far only); materials its own so a ghost fades only this car
export function cloneForCar(asset, lodM) {
    const lod = new THREE.LOD();
    for (const [m, d] of [[asset.near, 0], [asset.far, lodM]]) {
        const c = m.clone();
        c.traverse((o) => {
            if (!o.isMesh) return;
            o.material = o.material.clone();
            o.castShadow = o.receiveShadow = true;
            o.layers.enable(1);
        });
        lod.addLevel(c, d);
    }
    return lod;
}

export const detailFor = (level) => (level === 'low' ? 'far' : 'near');

export const preloadTeams = (teamIds) => Promise.all(teamIds.map((id) => loadTeamCar(id))).then(() => {});

let parts = null;
export function loadParts(load = gltfLoad) {
    parts ||= Promise.all([load('models/tyre.glb'), load('models/helmet.glb')]).then(([t, h]) => {
        const get = (s, name) => s.scene.getObjectByName(name);
        const tyres = { S: get(t, 'tyre_S'), M: get(t, 'tyre_M'), H: get(t, 'tyre_H'), rim: get(t, 'rim') };
        const helmet = get(h, 'helmet'), shoulders = get(h, 'shoulders');
        return Object.values(tyres).every((m) => m?.isMesh) && helmet && shoulders ? { tyres, helmet, shoulders } : null;
    }).catch(() => null);
    return parts;
}
