import * as THREE from 'three';
import { buildCar, buildSteeringWheel, liveryTexture as carLivery, WHEEL_RADIUS } from './carModel.js';
import { VIEW_NAMES, VIEW_FOV, EYE, EYE_TILT, nextView, viewOf, onboard, wheelAngle, toThree } from './views.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { keyboardStep, gamepadInput, liftOffBrake } from './input.js';
import { parseAssist } from './sim/carphysics.js';
import { LEVELS, scaleRange, pixelRatio, resolveLevel, autoPick, shouldMeasure, stepDown, depthBias, adaptStep, frameCapped } from './quality.js';
import { placeScenery, seedOf, vergeReach, terrainHeights, terrainGround, skirtDepth, gridSampler, carveReach, onVerge, onPit, untangle, smoothPath, RENDER_STEP_M, SKIRT_M } from './scenery.js';
import { heightAt, pathHeights } from './sim/elevation.js';
import { themeOf, LANDS, SKIES, nightOf } from './themes.js';
import { SnapshotBuffer, RenderClock, sample, samplePresent, decodeFlags } from './netsync.js';
import { decodeFast } from './netcodec.js';
const driverOf = (id) => window.driverOf(id); // lobby player or AI driver (socket.js)
import { Predictor, STEP_S } from './predict.js';
import { stewardText } from './steward.js';
import { clockText, lapBanner, fmtLap, boxBanner, clockLeftMs } from './qualiText.js';
import { nextHarder } from './sim/tyres.js';
import { Gearbox, shiftLights } from './audio/gearbox.js';
import { estimateLoad } from './audio/mix.js';
import * as Sound from './audio/audio.js';
import { gapText, driverCode, lapDelta, stepFollow, watchTarget, inDrsZone, drsHint, liveSectors, resultCells, sectorClass, lastLapClass } from './timing.js';
import { cornersOf, createCoach, pastLine, SHOW_S } from './coach.js';
import { MODES, segmentColor, cornerMask, aheadM, trackIndex, nextMode } from './racingline.js';
import { distToPath, pitLayout, tMarks, wallStands, pickerOpen, cardText, crew17, BOX_M, COMPOUND_COLORS } from './pitLayout.js';

// World units per metre come from the track JSON (track.scale = 6).
const WHEEL_RADIUS_M = WHEEL_RADIUS; // carShape.js
const ROAD_DRAW_Y = 0.6;           // the asphalt is drawn this far (world units) over the road height: cars stand on it
const WHEELBASE_M = 3.6, TRACK_WIDTH_M = 1.6; // contact patches for the body's pitch and roll on the road (sim C.WHEELBASE)
const WALL_OFFSET = 80;       // public/js/sim/drive.js barrier beyond the track edge
const CHASE_BACK_M = 10, CHASE_UP_M = 4, LOOK_AHEAD_M = 6;
const CAM_TURN_SMOOTH = 8; // 1/s; time-based so lag doesn't grow at low frame rates
const KERB_TURN = 0.05;       // rad per path segment (~10 m) → radius under ~200 m gets kerbs
const TAG_FULL_M = 40, TAG_GONE_M = 120; // name labels fade out between these camera distances
const PIT_RUNOFF_M = 2; // public/js/sim/drive.js barrier outside the pit lane
const ELEVATION_SCALE = 1;  // real heights (track z); raise to exaggerate flat circuits like Monza
const TERRAIN_SINK_M = 0.6; // ground beyond the verge sits this far below the road, so its coarse grid never pokes through
const teamInfo = {};
fetch('teams.json').then(r => r.json()).then((list) => { for (const t of list) teamInfo[t.id] = t; });

const canvas = document.getElementById('game-canvas');
const minimap = document.getElementById('minimap');
const mm = minimap.getContext('2d');

// ---------- renderer / scene ----------
// localStorage, with an in-memory copy (shared with app.js) so choices still apply when storage is blocked
const mem = (window.lanraceMem ||= {});
const store = {
    get: (k) => { if (k in mem) return mem[k]; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: this page only */ } },
};
Sound.init();
const choice = store.get('lanrace.quality') || 'auto';
// WebGPU where the browser has it, else three's WebGL2 backend. Reversed depth keeps a 1 cm near plane precise out to
// 20 km (onboard views draw in one pass); a WebGL2 without EXT_clip_control can't reverse depth: logarithmic depth instead
let renderer, backend, reversed;
const FORCE_WEBGL = new URLSearchParams(location.search).has('webgl'); // ?webgl: test the WebGL2 fallback on a WebGPU browser
async function createRenderer({ logDepth = false } = {}) {
    const r = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: FORCE_WEBGL,
        reversedDepthBuffer: !logDepth, logarithmicDepthBuffer: logDepth });
    await r.init();
    return r;
}
renderer = await createRenderer();
if (!renderer.reversedDepthBuffer) { renderer.dispose(); renderer = await createRenderer({ logDepth: true }); }
backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
reversed = renderer.reversedDepthBuffer;
let level = resolveLevel(choice, store.get('lanrace.quality.auto'), backend);
let Q = LEVELS[level];
window.lanraceQuality = { choice, level, backend };
// Reading each shader's error log forces the GPU driver to finish compiling it there and then (a 2 s stall at a session's
// start in profiles); errors are a developer concern, the console still shows the backend's own
renderer.debug.checkShaderErrors = false;
let res = { ...scaleRange(level), good: 0 };
res.ratio = res.start;
renderer.setPixelRatio(pixelRatio(level, window.devicePixelRatio));

const SKY = 0x9cc8ef;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
const camera = new THREE.PerspectiveCamera(60, 1, 0.06, Q.far); // 1 cm near plane (reversed depth): onboard views in one pass
const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x4f7a2a, 1.4);
scene.add(hemi);
// Sky: a dome around the camera, zenith colour fading to the horizon (= the fog), set per circuit (themes.js)
const skyDome = (() => {
    const g = new THREE.SphereGeometry(1, 24, 12);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -1;
    m.frustumCulled = false;
    scene.add(m);
    return m;
})();
// Night: stars on the dome, as many as the place's light pollution leaves (themes.js NIGHTS stars)
const STARS = 2000;
const stars = (() => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
        const y = 0.06 + 0.94 * rnd(), a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y) * 0.98; // above the horizon haze
        pos.set([Math.cos(a) * r, y * 0.98, Math.sin(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    p.frustumCulled = false;
    p.visible = false;
    skyDome.add(p);
    return p;
})();
// Day: a physical sky (Rayleigh/Mie scattering, clouds) lit by the circuit's sun, drawn once per session into a cube
// that is the background; night keeps the dome and its stars. The SkyMesh stays out of the main scene: next to it,
// instanced meshes lose their per-instance colours in three r186 (trees and tyres turn white)
const daySky = new SkyMesh();
daySky.scale.setScalar(100);
const skyScene = new THREE.Scene();
skyScene.add(daySky);
const skyCube = new THREE.CubeRenderTarget(512, { type: THREE.HalfFloatType });
const skyCam = new THREE.CubeCamera(1, 1000, skyCube);
renderer.toneMapping = THREE.AgXToneMapping;
function applySky(sky) {
    const top = new THREE.Color(sky.top), hor = new THREE.Color(sky.horizon), c = new THREE.Color(), p = skyDome.geometry.attributes.position, col = skyDome.geometry.attributes.color;
    for (let i = 0; i < p.count; i++) { c.copy(hor).lerp(top, Math.min(1, Math.max(0, p.getY(i)) ** 0.6)); col.setXYZ(i, c.r, c.g, c.b); }
    col.needsUpdate = true;
    scene.background = hor;
    if (scene.fog) scene.fog.color.copy(hor);
    sun.color.set(sky.sun);
    sun.intensity = sky.power;
    hemi.intensity = sky.hemi;
    hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.5);
    stars.visible = !!sky.stars;
    stars.geometry.setDrawRange(0, Math.round(STARS * (sky.stars || 0)));
    if (scene.fog) scene.fog.near = sky.stars !== undefined ? 1500 : 3000; // night: the land fades into the dark sooner
    const el = (sky.elevation * Math.PI) / 180, az = (sky.azimuth * Math.PI) / 180, r = 1900;
    Object.assign(SUN_OFF, { x: r * Math.cos(el) * Math.sin(az), y: r * Math.sin(el), z: r * Math.cos(el) * Math.cos(az) });
    const isDay = sky.stars === undefined;
    skyDome.visible = !isDay;
    if (isDay) {
        daySky.turbidity.value = sky.turbidity; daySky.rayleigh.value = sky.rayleigh;
        daySky.mieCoefficient.value = sky.mie; daySky.mieDirectionalG.value = sky.mieG;
        daySky.cloudCoverage.value = sky.clouds;
        daySky.sunPosition.value.set(SUN_OFF.x, SUN_OFF.y, SUN_OFF.z).normalize();
        skyCam.update(renderer, skyScene);
        scene.background = skyCube.texture;
    }
    renderer.toneMappingExposure = sky.exposure ?? 1;
    // Sky light now comes from the environment map: the hemisphere light is only a small fill where there is one
    hemi.intensity = sky.hemi * (Q.envMap ? 0.35 : 1);
    scene.environmentIntensity = isDay ? 1 : 0.25;
    envTex?.dispose(); envTex = null;
    scene.environment = null; // EXPERIMENT
}
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
const SUN_OFF = { x: 600, y: 1800, z: 400 }; // sun position relative to the shadow target
Object.assign(sun.shadow.camera, { left: -360, right: 360, top: 360, bottom: -360, near: 10, far: 4000 }); // ±60 m around your car
// a texel (~6 cm) of offset along the surface normal: no shadow acne (blotches) on the cars' curved bodywork
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0;
scene.add(sun, sun.target);
let activeView = 'chase', onboardCar = null, steeringWheel = null; // onboardCar: the car whose T-cam/cockpit is in use

// Shadows, fog, draw distance and resolution limits for a level (applied when a track is built)
let appliedLevel = null;
function applyLevel(l) {
    if (l === appliedLevel) return; // same level next session: keep the shadow map and the learned resolution
    appliedLevel = l;
    level = l;
    Q = LEVELS[l];
    window.lanraceQuality.level = l;
    renderer.shadowMap.enabled = Q.shadows > 0;
    sun.castShadow = Q.shadows > 0;
    if (Q.shadows) sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    scene.fog = new THREE.Fog(SKY, 3000, Q.fog);
    camera.far = Q.far;
    camera.updateProjectionMatrix();
    const range = scaleRange(l);
    res = { ...range, good: 0, ratio: Math.max(range.min, Math.min(res.ratio, range.max)) };
    renderer.setPixelRatio(pixelRatio(l, window.devicePixelRatio));
}
applyLevel(level);

function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- input ----------
const keys = { up: false, down: false, left: false, right: false, drs: false };
const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', e: 'drs' };
let input = { throttle: 0, brake: 0, steer: 0, drs: false };
let touchInput = null;
let predictor = null, simAcc = 0, inputSeq = 0, sentInputs = []; // client-side prediction (own car)
let spectateId = null; // spectators follow this driver
let towerMode = 'interval'; // timing tower gap column: 'interval' (car ahead) or 'leader'
function toggleTower() {
    towerMode = towerMode === 'interval' ? 'leader' : 'interval';
    document.getElementById('tt-mode').textContent = towerMode.toUpperCase();
    lastTower = 0; // redraw on the next HUD tick
}
document.getElementById('tt-head').addEventListener('click', toggleTower);
// Racing line: one chevron mesh per world, recoloured with the HUD
let line = null, lineIdx = null, padX = false, drsIdx = null;
const lineChoice = () => { const v = store.get('lanrace.line'); return MODES.includes(v) ? v : 'corners'; };
let lineMode = lineChoice();
let coach = null, coachIdx = null, coachTimer = null, coachIntro = true, stewardAtS = -Infinity, contactAtS = -Infinity;
let coachOn = store.get('lanrace.coach') !== 'off';
window.onCoachChange = (v) => { coachOn = v !== 'off'; };
function toggleCoach() {
    coachOn = !coachOn;
    store.set('lanrace.coach', coachOn ? 'on' : 'off');
    window.renderCoach?.();
    window.showBanner?.(`COACH: ${coachOn ? 'ON' : 'OFF'}`, true);
    if (!coachOn) document.getElementById('coach-line').classList.add('hidden');
}
let view = viewOf(store.get('lanrace.view')); // chase / T-cam / cockpit, remembered
function cycleView() {
    view = nextView(view);
    store.set('lanrace.view', view);
    window.showBanner?.(`CAMERA: ${VIEW_NAMES[view]}`, true);
}
document.getElementById('cam-btn').addEventListener('click', (e) => { e.currentTarget.blur(); if (clientState.status !== 'LOBBY') cycleView(); });
function toggleLine() {
    if (!line) return; // no line on this track
    lineMode = nextMode(lineMode);
    applyLineMode();
    colourLine();
    window.showBanner?.(`RACING LINE: ${lineMode.toUpperCase()}`, true);
}

// Q / gamepad View: step your braking help Off → Low → High → Off (steering help kept); the host can fix it for everyone
let padView = false;
function toggleAssist() {
    if (isSpectator()) return;
    if (clientState.settings?.help?.mode === 'fixed') return window.showBanner?.('DRIVER HELP: SET BY HOST', true);
    const [s, b] = String(store.get('lanrace.assist') || '100,100').split(',').map(Number);
    const next = { 0: 50, 50: 100, 100: 0 }[b] ?? 100;
    window.setAssist?.(`${s >= 50 ? 100 : 0},${next}`); // sent at once: the server switches the same tick the predictor does
}
window.onAssistChange = (v) => {
    if (predictor) { predictor.assist = v; if (predictor.car) predictor.car.assist = v; }
    if (clientState.status !== 'LOBBY') {
        const [s, b] = v.split(',').map(Number);
        window.showBanner?.(`BRAKING HELP: ${{ 0: 'OFF', 50: 'LOW', 100: 'HIGH' }[b]}${s ? '' : ' · STEERING HELP OFF'}`, true);
    }
};

// After finishing (race or qualifying run): watch the cars still out there, like F1 TV after the flag; F: your own car
const WATCH_DELAY_MS = 2000;
let finishedAt = null, ownView = false;
function watchingAfterFinish() {
    const gs = clientState.gameState, me = gs?.[clientState.me];
    if (!me || !(me.finished || me.qualiOut) || isSpectator()) { finishedAt = null; ownView = false; return false; } // knocked out in qualifying: watch too
    finishedAt ??= performance.now();
    if (ownView || performance.now() - finishedAt < WATCH_DELAY_MS) return false;
    spectateId = watchTarget(rankedCarIds(), clientState.me, (id) => !!(gs[id]?.finished || gs[id]?.qualiOut), spectateId); // skip parked cars: finished, or knocked out of qualifying
    return spectateId !== null; // nobody left running: stay on your own car
}
const watching = () => isSpectator() || watchingAfterFinish();

function isSpectator() {
    return !!clientState.players[clientState.me]?.isSpectating || !clientState.gameState?.[clientState.me];
}

// A tyre pick (keys 1/2/3 or a click on the picker): fitted at once on the grid / in the quali box, else the next stop's set
// "Box, box" (race): call or cancel the stop; the tyre card opens to choose the set
let boxConfirmAt = 0, boxPick = null; // boxPick: the set chosen for the called stop (the server's nextCompound follows a moment later)
function callBox() {
    const me = clientState.gameState?.[clientState.me];
    if (clientState.status !== 'RACE' || !me || me.finished || isSpectator()) return;
    socket.emit('box_call', { on: !me.boxCall });
}
let lastPick = null; // fitted at once on the grid / quali box, so the server clears nextCompound: remember the pick to confirm it
function pickTyre(c) {
    if (isSpectator() || clientState.status === 'LOBBY') return;
    lastPick = c;
    if (clientState.gameState?.[clientState.me]?.boxCall) { boxPick = c; boxConfirmAt = performance.now(); } // confirm the call with the new set
    socket.emit('tyre_next', c);
    window.showBanner?.(`TYRES: ${{ S: 'SOFT', M: 'MEDIUM', H: 'HARD' }[c]}`, true);
}
const tcBtns = [...document.querySelectorAll('#tc-pick .tc-btn')];
document.getElementById('tc-box').addEventListener('click', (e) => { e.currentTarget.blur(); callBox(); });
document.getElementById('tc-pick').addEventListener('click', (e) => { const b = e.target.closest('.tc-btn'); if (b) { b.blur(); pickTyre(b.dataset.c); } }); // blur: Space/Enter must not re-fire the pick

function onKey(e, down) {
    if (e.target?.matches?.('input, textarea, select')) return; // typing a name or a chat line, not driving
    const key = e.key.toLowerCase();
    if (down && key === 't' && !e.repeat && clientState.status !== 'LOBBY') toggleTower();
    if (down && key === 'r' && !e.repeat && clientState.status !== 'LOBBY') toggleLine();
    if (down && key === 'c' && !e.repeat && clientState.status !== 'LOBBY') toggleCoach();
    if (down && key === 'v' && !e.repeat && clientState.status !== 'LOBBY') cycleView();
    if (down && key === 'b' && !e.repeat) callBox();
    if (down && key === 'q' && !e.repeat && clientState.status !== 'LOBBY') toggleAssist();
    if (down && key === 'escape' && !e.repeat) toggleHostPanel();
    if (down && key === 'm' && !e.repeat) window.showBanner?.(Sound.toggleMute() ? 'SOUND: MUTED' : 'SOUND: ON', true);
    if (down && e.key === 'F3') { e.preventDefault(); netstatsOn = !netstatsOn; netstatsEl.classList.toggle('hidden', !netstatsOn); }
    if (down && clientState.status !== 'LOBBY' && watching()) {
        const others = rankedCarIds().filter((id) => id !== clientState.me); // finished: every car but your own
        if (key === 'arrowleft') spectateId = stepFollow(others, spectateId, -1);
        if (key === 'arrowright') spectateId = stepFollow(others, spectateId, 1);
    }
    if (down && key === 'f' && !e.repeat && clientState.gameState?.[clientState.me]?.finished && !isSpectator()) {
        ownView = !ownView;
        window.showBanner?.(ownView ? 'YOUR CAR · F TO WATCH' : 'WATCHING', true);
    }
    // Tyre pick: 1 soft, 2 medium, 3 hard (Q, W and E are taken: assist, throttle, DRS)
    if (down && !e.repeat && ['1', '2', '3'].includes(key)) pickTyre('SMH'[+key - 1]);
    const k = KEYMAP[key];
    if (!k) return;
    // Presses are ignored in the lobby (typing a name), releases always count so no key stays stuck
    if (down && clientState.status === 'LOBBY') return;
    keys[k] = down;
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
// A keyup missed while the window lost focus (alt-tab, tab switch) must not leave throttle or steering held
function releaseKeys() {
    for (const k in keys) keys[k] = false;
    input = { throttle: 0, brake: 0, steer: 0, drs: false };
    simStep(false); // the release goes out now, not at the next frame (a hidden tab has none)
}
window.addEventListener('blur', releaseKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseKeys(); });

// 60 Hz fixed steps: sample controls, predict own car, send newest + 5 previous (a lost UDP packet costs nothing)
function simStep(sample = true) {
    if (sample) {
        const pad = gamepadInput((navigator.getGamepads ? [...navigator.getGamepads()] : []).find(Boolean));
        const car = predictor?.car, lift = car ? liftOffBrake(parseAssist(predictor.assist).brake >= 1 ? 1 : 0, (car.speed || 0) / predictor.track.scale) : 0;
        input = hostPanel ? { throttle: 0, brake: 0, steer: 0, drs: false } : pad || touchInput || keyboardStep(input, keys, STEP_S, lift); // menu open: hands off
    }
    const stamped = { seq: ++inputSeq, steer: input.steer, throttle: input.throttle, brake: input.brake, drs: !!input.drs };
    if (predictor && predictor.car) predictor.step(stamped);
    sentInputs.push(stamped);
    if (sentInputs.length > 6) sentInputs.shift();
    window.sendUDPInput({ inputs: sentInputs });
}

function pollInput(dt) {
    const pad = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find(Boolean);
    const x = !!pad?.buttons[2]?.pressed; // gamepad X / Square
    if (x && !padX && clientState.status !== 'LOBBY') toggleLine();
    padX = x;
    const view = !!pad?.buttons[8]?.pressed; // gamepad View / Back / Select
    if (view && !padView && clientState.status !== 'LOBBY') toggleAssist();
    padView = view;
    simAcc = Math.min(simAcc + dt * (predictor?.rate ?? 1), 0.25); // paced to the server's input cushion; a long stall doesn't fire a burst
    while (simAcc >= STEP_S) { simStep(); simAcc -= STEP_S; }
}

// Virtual joystick for touch devices
const joyZone = document.getElementById('joystick-zone');
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');
let isTouching = false;
const joyCenter = { x: 0, y: 0 };
const JOY_MAX = 50;

if ('ontouchstart' in window) { joyZone.style.display = 'block'; document.body.classList.add('touch'); }

joyBase.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = joyBase.getBoundingClientRect();
    joyCenter.x = rect.left + rect.width / 2;
    joyCenter.y = rect.top + rect.height / 2;
    isTouching = true;
    updateJoystick(e.touches[0]);
}, { passive: false });

joyBase.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (isTouching) updateJoystick(e.touches[0]);
}, { passive: false });

joyBase.addEventListener('touchend', (e) => {
    e.preventDefault();
    isTouching = false;
    joyKnob.style.transform = 'translate(-50%, -50%)';
    touchInput = null;
}, { passive: false });

function updateJoystick(touch) {
    let dx = touch.clientX - joyCenter.x;
    let dy = touch.clientY - joyCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_MAX) { dx = (dx / dist) * JOY_MAX; dy = (dy / dist) * JOY_MAX; }
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    touchInput = {
        steer: dx / JOY_MAX,
        throttle: Math.max(0, -dy / JOY_MAX),
        brake: Math.max(0, dy / JOY_MAX),
    };
}

// ---------- ground ----------
const GROUND_COARSE = 64, GROUND_FINE = 256, GROUND_FINE_HIGH = 384; // grid cells a side: at once, then from the worker (High: finer)
let terrainWorker, groundJob = 0;
// The fine ground grid in a worker (terrain-worker.js); without workers, on this thread after the first frame
function fineGround(t, reach, grid, done) {
    const id = ++groundJob, finish = (H) => { if (id === groundJob) done(H); };
    const here = () => setTimeout(() => finish(terrainHeights(t, grid.x0, grid.y0, grid.w, grid.h, grid.segs, terrainGround(t, reach), grid.sink, grid.carve)), 0);
    if (terrainWorker === undefined) {
        try {
            const w = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' }), pending = new Map();
            w.onmessage = ({ data }) => { const job = pending.get(data.id); pending.delete(data.id); job?.done(data.H); };
            w.onerror = (e) => { // finish what was asked of it here, and stop using it
                console.warn('[LanRace] terrain worker failed, building on the main thread', e);
                terrainWorker = null;
                for (const job of pending.values()) job.here();
                pending.clear();
            };
            terrainWorker = { w, pending };
        } catch (e) { terrainWorker = null; }
    }
    if (!terrainWorker) return here();
    terrainWorker.pending.set(id, { done: finish, here });
    // what scenery.js's ground needs of the track (the pit lane too: the ground is pressed under it)
    const pit = t.pit && { path: t.pit.path, width: t.pit.width };
    terrainWorker.w.postMessage({ id, t: { path: t.path, z: t.z, width: t.width, scale: t.scale, wallOffset: t.wallOffset, bridges: t.bridges, pit }, reach, ...grid });
}

// ---------- track geometry ----------
let world = null;
let scale = 6;
let elev = null; // the current track: road heights (the physics feels them too, in sim/elevation.js)
// Road height in world units under a world point, and the terrain a little below it
// angle (optional): the road a car heading that way is on, so at Suzuka's bridge it stays on its own level
const roadY = (x, y, angle, hint) => (elev ? heightAt(elev, x, y, angle, hint).h * scale * ELEVATION_SCALE : 0);
// Pit lane surface height under (x, y): the lane's own smoothed heights (sim/elevation.js pathHeights), so its boxes,
// boards, garages and the cars in it sit on what's drawn, not on whichever road happens to be nearest
function pitY(x, y) {
    const pit = elev && elev.pit;
    if (!pit || !elev.z) return roadY(x, y);
    const P = pit.path, H = heights(P);
    let bi = 0, bt = 0, bd = Infinity;
    for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0, d = (x - a.x - t * ex) ** 2 + (y - a.y - t * ey) ** 2;
        if (d < bd) { bd = d; bi = i; bt = t; }
    }
    return H[bi] + (H[bi + 1] - H[bi]) * bt;
}
// Terrain: under the lowest road within the barriers (never over the lower road at a bridge)
let groundFn = null; // this track's ground height (m), set when the world is built (scenery.js terrainGround)
// The drawn terrain grid's height (m) and the verge reach it was built with: a wheel past the verge stands on it
let terrainAt = null, vergeR = null;
const groundY = (x, y) => (groundFn ? groundFn(x, y) * scale * ELEVATION_SCALE : 0) - TERRAIN_SINK_M * scale;
// Height of every point of a polyline: the centreline uses its own z, anything else (pit lane, walls) looks it up
const heightCache = new WeakMap();
function heights(path) {
    let h = heightCache.get(path);
    if (!h) {
        h = elev && path === elev.path && elev.z ? elev.z.map((z) => z * scale * ELEVATION_SCALE)
            : elev && elev.pit && path === elev.pit.path ? pathHeights(elev, path).map((z) => z * scale * ELEVATION_SCALE) // its own road's height
            : elev && elev.pit && path === elev.pit.wall ? path.map((p) => pitY(p.x, p.y)) // on the pit lane
            : path.map((p) => roadY(p.x, p.y));
        heightCache.set(path, h);
    }
    return h;
}
let bounds = null;
let snapCamera = true;
const cars = {}; // playerId -> { root, wheels, teamId }
let netBuf = new SnapshotBuffer();

function getBounds(path) {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of path) {
        b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
        b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
    }
    return b;
}

// Offset every path point sideways (positive = left of travel in screen space); offset: one number or one per point.
// On the inside of a bend tighter than the offset (Monaco's hairpins at the road edge, any hairpin at the barrier line)
// the offset line folds back on itself in a loop; the real edge there is where the loop crosses itself, so the loop's
// points all go to that crossing (untangle): nothing drawn from them lies across the road
function offsetPoints(path, offset) {
    const n = path.length;
    return untangle(path, path.map((p, i) => {
        const prev = path[(i - 1 + n) % n], next = path[(i + 1) % n];
        let dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const o = typeof offset === 'number' ? offset : offset[i];
        return { x: p.x - dy * o, y: p.y + dx * o };
    }));
}

function turnAngle(path, i) {
    const n = path.length;
    const a = path[(i - 1 + n) % n], b = path[i], c = path[(i + 1) % n];
    const d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

function coloredMesh(pos, col, uv = null, opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, map: opts.map || null, roughnessMap: opts.roughnessMap || null,
        transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthWrite: opts.opacity === undefined,
        // Flat layers only cm apart: a depth offset per layer stops them fighting (flickering) in the distance
        polygonOffset: !!opts.layer, polygonOffsetFactor: depthBias(-(opts.layer || 0), reversed), polygonOffsetUnits: depthBias(-(opts.layer || 0) * 2, reversed),
    }));
    m.receiveShadow = true;
    return m;
}

// Flat band between two sideways offsets, only on segments where keep(i); opts.map tiles every opts.repeatM metres
function strip(path, from, to, y, keep, colorAt, opts = {}) {
    const a = offsetPoints(path, from), b = offsetPoints(path, to), H = heights(path);
    const pos = [], col = [], uv = [];
    const rep = (opts.repeatM || 8) * scale;
    let along = 0;
    for (let i = 0; i < path.length; i++) {
        const j = (i + 1) % path.length;
        const seg = Math.hypot(path[j].x - path[i].x, path[j].y - path[i].y);
        if (keep(i)) {
            const c = colorAt(i), v0 = along / rep, v1 = (along + seg) / rep, yi = y + H[i], yj = y + H[j];
            pos.push(a[i].x, yi, a[i].y, b[i].x, yi, b[i].y, b[j].x, yj, b[j].y,
                     a[i].x, yi, a[i].y, b[j].x, yj, b[j].y, a[j].x, yj, a[j].y);
            uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
            for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
        }
        along += seg;
    }
    return coloredMesh(pos, col, uv, opts);
}

// Grey speckle, tiled along the track
let asphaltTex = null, asphaltRough = null;
function asphaltTexture() {
    if (!asphaltTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d'), rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
        g.fillStyle = '#d8d8d8';
        g.fillRect(0, 0, 256, 256);
        for (let k = 0; k < 9000; k++) {
            const v = 150 + Math.floor(rand() * 105);
            g.fillStyle = `rgb(${v},${v},${v})`;
            g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
        }
        asphaltTex = new THREE.CanvasTexture(c);
        asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
        asphaltTex.colorSpace = THREE.SRGBColorSpace;
        // Roughness varies grain to grain (0.6–0.92): the surface catches the sun at low angles
        const r = document.createElement('canvas');
        r.width = r.height = 256;
        const rg = r.getContext('2d'), img = rg.createImageData(256, 256);
        for (let i = 0; i < 256 * 256; i++) { const v = 150 + rand() * 85; img.data.set([v, v, v, 255], i * 4); }
        rg.putImageData(img, 0, 0);
        asphaltRough = new THREE.CanvasTexture(r);
        asphaltRough.wrapS = asphaltRough.wrapT = THREE.RepeatWrapping;
    }
    asphaltTex.anisotropy = Q.anisotropy;
    return asphaltTex;
}

// Vertical wall at one sideways offset
function wall(path, offset, height, keep, colorAt, bottom = 0, opts = {}) { // height / bottom (from the road): one for all, or per point
    const a = offsetPoints(path, offset), H = heights(path);
    const pos = [], col = [];
    for (let i = 0; i < path.length; i++) {
        if (!keep(i)) continue;
        const j = (i + 1) % path.length;
        const c = colorAt(i), hi = H[i] + (bottom[i] ?? bottom), hj = H[j] + (bottom[j] ?? bottom), di = height[i] ?? height, dj = height[j] ?? height;
        pos.push(a[i].x, hi, a[i].y, a[j].x, hj, a[j].y, a[j].x, hj + dj, a[j].y,
                 a[i].x, hi, a[i].y, a[j].x, hj + dj, a[j].y, a[i].x, hi + di, a[i].y);
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    return coloredMesh(pos, col, null, opts);
}

// The ground: two mown tones in stripes and a fine speckle, in the circuit's land colours (themes.js LANDS)
function grassTexture(w, h, land) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = land.ground[0]; g.fillRect(0, 0, 128, 128);
    g.fillStyle = land.ground[1]; g.fillRect(0, 0, 64, 128);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = land.speck;
    for (let k = 0; k < 900; k++) g.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1 + Math.floor(rnd() * 2), 1);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / (40 * scale), h / (40 * scale));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}

function startLine(start, width) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    for (let r = 0; r < 16; r++) {
        for (let k = 0; k < 2; k++) {
            g.fillStyle = (r + k) % 2 ? '#111' : '#fff';
            g.fillRect(k * 8, r * 8, 8, 8);
        }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(2 * scale, width);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex }));
    m.position.set(start.x, 1.0 + roadY(start.x, start.y), start.y);
    m.rotation.y = -start.angle;
    m.receiveShadow = true;
    return m;
}

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

// Many copies of one mesh in one draw call; p: { x, y (height), z, angle, sx, sy, sz, color }
function instanced(geometry, material, placements) {
    const m = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
    const o = new THREE.Object3D();
    placements.forEach((p, i) => {
        o.position.set(p.x, p.y ?? 0, p.z);
        o.rotation.set(0, p.angle ?? 0, 0);
        o.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (p.color) m.setColorAt(i, new THREE.Color(p.color));
    });
    m.count = placements.length;
    return m;
}

// Many text planes, one texture atlas, one draw call; items: { text, x, y (height), z, rotY, flat, bg }
function atlasPlanes(items, w, h, bg, fg = '#fff') {
    const cell = 64, cols = 8, rows = Math.ceil(items.length / cols), aspect = w / h;
    const c = document.createElement('canvas');
    c.width = cols * cell * aspect; c.height = rows * cell;
    const g = c.getContext('2d');
    items.forEach((it, i) => {
        const cx = (i % cols) * cell * aspect, cy = Math.floor(i / cols) * cell;
        g.fillStyle = it.bg || bg; g.fillRect(cx, cy, cell * aspect, cell);
        g.fillStyle = fg; g.font = `bold ${cell * 0.6}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(it.text, cx + (cell * aspect) / 2, cy + cell / 2, cell * aspect * 0.9);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geos = items.map((it, i) => {
        const geo = new THREE.PlaneGeometry(w, h);
        const u0 = (i % cols) / cols, v1 = 1 - Math.floor(i / cols) / rows, du = 1 / cols, dv = 1 / rows;
        const uv = geo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * du, v1 - dv + uv.getY(k) * dv);
        if (it.flat) geo.rotateX(-Math.PI / 2);
        geo.rotateY(it.rotY);
        geo.translate(it.x, it.y, it.z);
        return geo;
    });
    return new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
}

function gridBoxes(slots) {
    const bars = [], nums = [];
    slots.forEach((g, i) => {
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle), h = pitY(g.x, g.y);
        bars.push({ x: g.x + fx * 3 * scale, y: 0.9 + h, z: g.y + fy * 3 * scale, angle: -g.angle });
        nums.push({ text: String(i + 1), x: g.x + fx * 4.6 * scale, y: 0.95 + h, z: g.y + fy * 4.6 * scale, rotY: facing(g.angle), flat: true });
    });
    const barGeo = new THREE.PlaneGeometry(0.4 * scale, 2.6 * scale);
    barGeo.rotateX(-Math.PI / 2);
    world.add(instanced(barGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), bars));
    world.add(atlasPlanes(nums, 1.6 * scale, 1.6 * scale, 'rgba(0,0,0,0)'));
}

// Your own box: a pulsing outline and a "BOX" sign, shown from 500 m before the entry until you leave the lane
let boxRing = null;
function buildBoxRing(box, name, col) {
    const g = new THREE.Group(), h = pitY(box.x, box.y);
    const bar = (w, d, x, z) => { const q = new THREE.PlaneGeometry(w, d); q.rotateX(-Math.PI / 2); q.translate(x, 0, z); return q; };
    const L = (BOX_M.len + 0.6) * scale, W = (BOX_M.wide + 0.6) * scale, lw = 0.3 * scale;
    const ring = new THREE.Mesh(mergeGeometries([bar(L, lw, 0, W / 2), bar(L, lw, 0, -W / 2), bar(lw, W, L / 2, 0), bar(lw, W, -L / 2, 0)]),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    ring.position.set(box.x, 0.9 + h, box.y);
    ring.rotation.y = -box.angle;
    const sign = textPlane(`BOX · ${name.toUpperCase()}`, 6 * scale, 1.4 * scale, col);
    sign.position.set(box.x, 7 * scale + h, box.y);
    sign.rotation.y = facing(box.angle);
    g.add(ring, sign);
    g.visible = false;
    world.add(g);
    return { g, ring, box };
}
function disposeRing(c) {
    world?.remove(c.g);
    c.g.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.dispose(); } });
}
function updateBoxRing(me, racing, toEntryM) {
    const box = predictor?.box;
    if (boxRing && boxRing.box !== box) { disposeRing(boxRing); boxRing = null; }
    if (!boxRing && box && me && world && clientState.trackData?.pit) {
        const pl = clientState.players[clientState.me];
        boxRing = buildBoxRing(box, pl?.username || '', teamInfo[me.teamId || pl?.teamId]?.chatColor || '#888888');
    }
    if (!boxRing) return;
    const inLane = !!(racing && me?.inPit);
    boxRing.g.visible = inLane || !!(racing && clientState.status === 'RACE' && toEntryM <= 500);
    boxRing.ring.material.opacity = 0.55 + 0.45 * Math.sin(performance.now() / 180);
}

// ---------- pit crews: 17 people, tyres and a lollipop board at every car that is stopping (at most CREWS at once) ----------
const CREWS = 4, STOP_PHASES = ['', 'guide', 'service', 'hold', 'lane', 'out', 'wait'];
const CREW_EASE = 6, STEP_BACK_M = 0.5, STEP_BACK_S = 0.6, GO_BOARD_S = 1, LIFT_M = 0.08;
const crews = []; // { id, mesh, tyres, board: { group, mast, brake, go }, pos: [{x,y}] x17, ... }
const crewTmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), zero: new THREE.Vector3(0, 0, 0) };
let humanGeo = null, tyreGeo = null;
function humanGeometry() {
    const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w * scale, h * scale, d * scale).translate(x * scale, y * scale, z * scale);
    const head = new THREE.SphereGeometry(0.15 * scale, 8, 6).translate(0, 1.68 * scale, 0);
    return mergeGeometries([box(0.14, 0.8, 0.16, -0.1, 0.4, 0), box(0.14, 0.8, 0.16, 0.1, 0.4, 0), // legs
        box(0.42, 0.62, 0.24, 0, 1.12, 0), box(0.11, 0.6, 0.12, -0.28, 1.12, 0.05), box(0.11, 0.6, 0.12, 0.28, 1.12, 0.05), head]); // torso, arms, helmet
}
function newCrew() {
    humanGeo ||= humanGeometry();
    tyreGeo ||= new THREE.TorusGeometry(0.3 * scale, 0.12 * scale, 6, 10).rotateX(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(humanGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), 17);
    const tyres = new THREE.InstancedMesh(tyreGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), 8);
    const dark = new THREE.Color(0x222222);
    for (let k = 0; k < 4; k++) tyres.setColorAt(k, dark); // old tyres dark; the new ones' band colour is set per car
    for (let k = 4; k < 8; k++) tyres.setColorAt(k, dark);
    mesh.frustumCulled = tyres.frustumCulled = false;
    const group = new THREE.Group(), mast = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 2.2 * scale), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    const brake = textPlane('BRAKE', 0.9 * scale, 0.9 * scale, '#e10600'), go = textPlane('GO', 0.9 * scale, 0.9 * scale, '#2a9d3f');
    pole.position.y = 1.1 * scale; brake.position.y = go.position.y = 2.3 * scale;
    mast.add(pole, brake, go); group.add(mast); // group: yawed to the box heading (local +x = forward); mast tilts so the pole lowers forward
    const root = new THREE.Group();
    root.add(mesh, tyres, group);
    root.visible = false;
    world.add(root);
    const pos = Array.from({ length: 17 }, () => ({ x: 0, y: 0 })), tpos = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
    return { id: null, root, mesh, tyres, group, mast, brake, go, pos, tpos, spotsFor: null, spots: null, phase: '', outAt: -1, goUntil: 0, fresh: true, serviceAt: 0, served: false, marks: null, compound: null };
}
const lerpTo = (p, x, y, k) => { p.x += (x - p.x) * k; p.y += (y - p.y) * k; };
// Crew slots are keyed by car id: cars already holding one keep it, free slots go to new stoppers, slots of cars gone are freed
const wantedIds = [];
function assignCrews() {
    for (const c of crews) if (c.id !== null && !wantedIds.includes(c.id)) c.id = null;
    for (let n = 0; n < wantedIds.length; n++) {
        const id = wantedIds[n];
        let have = false, free = null;
        for (const c of crews) { if (c.id === id) have = true; else if (c.id === null && !free) free = c; }
        if (have) continue;
        if (!free && crews.length < CREWS) { free = newCrew(); crews.push(free); }
        if (free) { free.id = id; free.spots = null; free.phase = ''; free.outAt = -1; free.goUntil = 0; free.served = false; }
    }
}
// Who needs a crew, best first: you, then cars in a stop (guide/service/hold/lane/out), then cars merely in the lane or parked in quali
function pickCrewCars(gs) {
    wantedIds.length = 0;
    for (let pass = 0; pass < 3 && wantedIds.length < CREWS; pass++) {
        for (let held = 1; held >= 0; held--) for (const id in gs) { // cars already holding a crew first: a new stopper never takes one mid-stop
            const p = gs[id];
            if (!p.box || !cars[id] || (!p.inPit && !p.stopPhase) || crews.some((c) => c.id === id) !== !!held) continue;
            if ((pass === 0 && id === clientState.me) || (pass === 1 && id !== clientState.me && p.stopPhase && p.stopPhase !== 'wait') || (pass === 2 && id !== clientState.me && !(p.stopPhase && p.stopPhase !== 'wait'))) {
                if (wantedIds.length < CREWS) wantedIds.push(id);
            }
        }
    }
}
const OLD_TYRE_OUT_M = 1, MID_SERVICE_MS = 1000, SIDES = ['FL', 'FR', 'RL', 'RR'];
function updateCrews(dt) {
    const gs = clientState.gameState, td = clientState.trackData;
    if (!world || !gs || !td?.pit) { for (const c of crews) c.root.visible = false; return; }
    pickCrewCars(gs);
    assignCrews();
    const now = performance.now(), k = 1 - Math.exp(-CREW_EASE * dt), T = crewTmp, garage = -td.pit.trackSide;
    for (const c of crews) {
        c.root.visible = c.id !== null;
        if (c.id === null) continue;
        const p = gs[c.id], box = p.box, phase = p.stopPhase || '', h = pitY(box.x, box.y);
        if (!c.spots || c.spotsFor !== box) {
            c.spots = crew17(box, scale, td.pit.trackSide); c.spotsFor = box; c.marks = tMarks(box, scale);
            c.mesh.material.color.set(teamInfo[p.teamId]?.chatColor || '#888888');
            c.group.position.set(c.spots[16].idle.x, h, c.spots[16].idle.y); c.group.rotation.y = -box.angle;
            c.brake.rotation.y = c.go.rotation.y = facing(box.angle) + box.angle; // net yaw = facing(): toward the arriving car
            const lean = Math.asin(-garage * 1.6 / 2.3); // the man stands off the car's line: lean the pole so the board hangs over the box centre line
            c.mast.rotation.x = lean; c.brake.rotation.x = c.go.rotation.x = -lean;
            c.fresh = true;
        }
        if (compoundColor[p.compound] !== c.compound) {
            c.compound = compoundColor[p.compound];
            for (let j = 4; j < 8; j++) c.tyres.setColorAt(j, c.compound || compoundColor.M);
            c.tyres.instanceColor.needsUpdate = true;
        }
        if (phase !== c.phase) {
            if (phase === 'service') { c.serviceAt = now; c.served = true; }
            if (phase === 'lane') c.served = false;
            if (phase === 'out' && c.phase) { c.outAt = now; c.goUntil = now + GO_BOARD_S * 1000; } else if (phase !== 'out') c.outAt = -1;
            c.phase = phase;
        }
        const working = phase === 'service' || phase === 'hold', released = phase === 'out' && c.outAt >= 0;
        const mid = phase === 'hold' || phase === 'out' || (phase === 'service' && now - c.serviceAt > MID_SERVICE_MS);
        const ox = -Math.sin(box.angle) * garage * STEP_BACK_M * scale, oy = Math.cos(box.angle) * garage * STEP_BACK_M * scale;
        const kk = c.fresh ? 1 : k;
        for (let i = 0; i < 17; i++) {
            const s = c.spots[i], jack = s.role === 'jackF' || s.role === 'jackR';
            const tgt = phase === 'service' || (phase === 'hold' && !jack) ? s.work : s.idle, q = c.pos[i];
            lerpTo(q, tgt.x + (released ? ox : 0), tgt.y + (released ? oy : 0), kk);
            T.q.setFromEuler(T.e.set(0, -s.angle + Math.PI / 2, 0));
            T.v.set(q.x, h, q.y);
            c.mesh.setMatrixAt(i, T.m.compose(T.v, T.q, T.one));
        }
        // Tyres: old ones come off the car at the wheels and go 1 m outward with the off-men from mid-service; new ones ride
        // with the on-men, then sit at the wheels. Index order of crew17 is gun, off, on per wheel (FL, FR, RL, RR)
        T.q.identity();
        for (let w = 0; w < 4; w++) {
            const mark = c.marks[w], off = c.pos[w * 3 + 1], on = c.pos[w * 3 + 2], sg = w % 2 ? -1 : 1;
            const oldT = c.tpos[w], newT = c.tpos[w + 4];
            if (mid) lerpTo(oldT, off.x - Math.sin(box.angle) * sg * OLD_TYRE_OUT_M * scale, off.y + Math.cos(box.angle) * sg * OLD_TYRE_OUT_M * scale, kk);
            else { oldT.x = mark.x; oldT.y = mark.y; }
            if (mid) lerpTo(newT, mark.x, mark.y, kk); else lerpTo(newT, on.x, on.y, kk);
            const oldOn = working || phase === 'out'; // before the stop the old tyres are still on the car
            T.v.set(oldT.x, h + 0.3 * scale, oldT.y);
            c.tyres.setMatrixAt(w, T.m.compose(T.v, T.q, oldOn ? T.one : T.zero));
            T.v.set(newT.x, h + 0.3 * scale, newT.y);
            c.tyres.setMatrixAt(w + 4, T.m.compose(T.v, T.q, T.one));
        }
        c.mesh.instanceMatrix.needsUpdate = c.tyres.instanceMatrix.needsUpdate = true;
        // Lollipop: red BRAKE until the service, lowered during it, green GO for 1 s after release
        const goOn = now < c.goUntil;
        c.mast.rotation.z = working ? -Math.PI / 2.2 : 0;
        c.brake.visible = !goOn && (phase === 'lane' || phase === 'guide' || phase === 'wait' || (!phase && !c.served)); // only while the car arrives
        c.go.visible = goOn;
        c.fresh = false;
    }
}

// A flat w x d bar at (x, z), lying on the ground
const bar = (w, d, x, z) => { const q = new THREE.PlaneGeometry(w, d); q.rotateX(-Math.PI / 2); q.translate(x, 0, z); return q; };

let entryGuide = null;
function buildPit(pit, t) {
    const n = pit.path.length, ph = pit.width / 2, s = pit.trackSide, line = 0.3 * scale;
    const W = pit.widthAt, half = W.map((w) => w / 2), neg = (A) => A.map((v) => -v);
    const inner = (i) => i >= 1 && i <= n - 3; // end segments would use wrapped normals
    const fullAt = (i) => W[i] >= pit.width - 1e-6;
    // The lane: per-point width, 0 where it joins the road edge, so it never lies over the racing surface
    world.add(strip(pit.path, neg(half), half, 0.55, inner, solid('#3a3f47')));
    // White edges: the outer one all along; the track-side one is the blend line in the mouths and the pit-wall line beside it
    const inL = half.map((h) => h - line), inR = half.map((h) => -h + line);
    world.add(strip(pit.path, inL, half, 0.85, (i) => inner(i) && W[i] > line, solid('#f2f2f2')));
    world.add(strip(pit.path, neg(half), inR, 0.85, (i) => inner(i) && W[i] > line, solid('#f2f2f2')));
    // "Box, box": a blue stripe down the entry road to the limiter line, lit while your stop is called and the entry is near
    const limI = Math.max(2, pit.cum.findIndex((c) => c >= pit.limStart));
    entryGuide = strip(pit.path, half.map(() => -0.5 * scale), half.map(() => 0.5 * scale), 0.9, (i) => inner(i) && i < limI, solid('#3b82f6'));
    entryGuide.visible = false;
    world.add(entryGuide);
    const lay = pitLayout(t);
    // Fast lane | working lane (white) and the garage-row edge (yellow), along the garages
    const onSpan = (i) => inner(i) && i >= lay.split.i0 && i < lay.split.i1;
    world.add(strip(pit.path, half.map(() => -line / 2), half.map(() => line / 2), 0.86, onSpan, solid('#f2f2f2')));
    // The concrete working lane: the garage-side half of the lane along the garages
    const wFrom = half.map((h) => (s > 0 ? -(h - 2 * line) : line / 2)), wTo = half.map((h) => (s > 0 ? -line / 2 : h - 2 * line));
    world.add(strip(pit.path, wFrom, wTo, 0.68, onSpan, solid('#8a8f96')));
    const yA = half.map((h) => -s * (h - line)), yB = half.map((h) => -s * (h - 2 * line));
    world.add(strip(pit.path, s > 0 ? yA : yB, s > 0 ? yB : yA, 0.86, onSpan, solid('#ffd400')));

    // Pit wall on the track side; outer wall behind the lane except where the garages open onto it
    world.add(wall(pit.wall, 0, 1 * scale, (i) => i < pit.wall.length - 1, solid('#9aa0a6')));
    const [lo, hi] = pit.garageSpan, back = ph + PIT_RUNOFF_M * scale, backOff = half.map((h) => -s * (h + PIT_RUNOFF_M * scale));
    world.add(wall(pit.path, backOff, 1 * scale, (i) => inner(i) && fullAt(i) && fullAt(i + 1) && (pit.cum[i + 1] < lo || pit.cum[i] > hi), solid('#9aa0a6')));

    const at = (s0) => {
        const i = Math.max(1, pit.cum.findIndex((c) => c >= s0));
        const a = pit.path[i - 1], b = pit.path[i];
        return { x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const board = (s0, text, bg) => {
        const p = at(s0), b = side(p, p.angle, -s * (ph + 1 * scale));
        const m = textPlane(text, 3 * scale, 1.5 * scale, bg);
        m.position.set(b.x, 2 * scale + pitY(b.x, b.y), b.y);
        m.rotation.y = facing(p.angle);
        world.add(m);
    };
    board(pit.limStart, `PIT LIMIT ${pit.limitKmh || 80}`, '#1e5bd8');
    $('pit-limiter').textContent = `PIT LIMITER ${pit.limitKmh || 80}`;
    board(pit.limEnd, 'END LIMIT', '#1e5bd8');
    board(pit.cum[n - 3], 'PIT OUT', '#2a9d3f');
    for (const s0 of [pit.limStart, pit.limEnd]) {
        const p = at(s0), m = flat(0.5 * scale, pit.width, 0xf2f2f2);
        m.position.set(p.x, 0.9 + pitY(p.x, p.y), p.y);
        m.rotation.y = -p.angle;
        world.add(m);
    }

    const bays = [], signs = [], roofs = [], paint = [], outlines = [], codes = [];
    const tc = (id) => teamInfo[id]?.chatColor || '#888888';
    for (const g of lay.garages) {
        if (g.skip) continue;
        const h = pitY(g.x, g.y), info = teamInfo[g.teamId] || { name: g.teamId };
        // Bay frame: x along the lane, +z away from the lane. Local +z under rotation.y = th is (sin th, cos th) = the lane's left
        // normal when th = -angle (garages on the left, trackSide < 0); for trackSide > 0 the garages are on the right, so th = PI - angle
        bays.push({ x: g.front.x, y: h, z: g.front.y, angle: s > 0 ? Math.PI - g.angle : -g.angle, color: tc(g.teamId) });
        const f = side(g.front, g.angle, s * 0.1 * scale);
        signs.push({ text: info.name.toUpperCase(), x: f.x, y: 6.4 * scale + h, z: f.y, rotY: s > 0 ? -g.angle : Math.PI - g.angle, bg: tc(g.teamId) });
    }
    for (const c of lay.canopy) roofs.push({ x: c.x, y: pitY(c.x, c.y) + 5.6 * scale, z: c.y, angle: -c.angle });
    for (const b of lay.boxes) {
        const h = pitY(b.x, b.y), dark = new THREE.Color(tc(b.teamId)).multiplyScalar(0.75);
        paint.push({ x: b.x, y: 0.8 + h, z: b.y, angle: -b.angle, color: dark });
        outlines.push({ x: b.x, y: 0.82 + h, z: b.y, angle: -b.angle });
        codes.push({ text: b.code, x: b.codeAt.x, y: 0.83 + h, z: b.codeAt.y, rotY: facing(b.angle), flat: true });
    }
    const add = (geo, mat, list) => { if (list.length) world.add(instanced(geo, mat, list)); };
    const bayGeo = mergeGeometries([
        new THREE.BoxGeometry(18 * scale, 6 * scale, 0.4 * scale).translate(0, 3 * scale, 4.8 * scale),          // back wall
        new THREE.BoxGeometry(0.4 * scale, 6 * scale, 5 * scale).translate(-8.8 * scale, 3 * scale, 2.5 * scale), // side walls
        new THREE.BoxGeometry(0.4 * scale, 6 * scale, 5 * scale).translate(8.8 * scale, 3 * scale, 2.5 * scale),
        new THREE.BoxGeometry(18 * scale, 0.4 * scale, 5 * scale).translate(0, 6 * scale, 2.5 * scale),           // roof
    ]);
    const floorGeo = new THREE.BoxGeometry(17.2 * scale, 0.05 * scale, 4.6 * scale).translate(0, 0.03 * scale, 2.5 * scale);
    const panelGeo = new THREE.PlaneGeometry(16 * scale, 4.5 * scale).translate(0, 2.6 * scale, 0).rotateY(Math.PI).translate(0, 0, 4.55 * scale);
    const stackGeo = mergeGeometries([-6, -3.6, -1.2, 1.2, 3.6, 6].map((x) => new THREE.CylinderGeometry(0.33 * scale, 0.33 * scale, 1.2 * scale, 10).translate(x * scale, 0.6 * scale, 3.8 * scale)));
    const bayMesh = instanced(bayGeo, new THREE.MeshStandardMaterial({ color: 0x2b2f36 }), bays.map((b) => ({ ...b, color: undefined })));
    bayMesh.castShadow = true;
    if (bays.length) world.add(bayMesh);
    add(floorGeo, new THREE.MeshStandardMaterial({ color: 0xb9bec4 }), bays.map((b) => ({ ...b, color: undefined })));
    add(panelGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), bays);
    add(stackGeo, new THREE.MeshStandardMaterial({ color: 0x151515 }), bays.map((b) => ({ ...b, color: undefined })));
    add(new THREE.BoxGeometry(18 * scale, 0.2 * scale, 1.5 * scale), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), roofs);
    const boxGeo = new THREE.PlaneGeometry(BOX_M.len * scale, BOX_M.wide * scale);
    boxGeo.rotateX(-Math.PI / 2);
    add(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), paint);
    // Car outline: four thin bars (5.4 × 2 m) laid flat
    const lw = 0.15 * scale, ol = 5.4 * scale, ow = 2 * scale;
    const outlineGeo = mergeGeometries([bar(ol, lw, 0, ow / 2), bar(ol, lw, 0, -ow / 2), bar(lw, ow, ol / 2, 0), bar(lw, ow, -ol / 2, 0)]);
    add(outlineGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), outlines);
    const tGeo = mergeGeometries([bar(0.12 * scale, 0.7 * scale, 0, 0), bar(0.5 * scale, 0.12 * scale, 0.3 * scale, 0)]);
    add(tGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), lay.boxes.flatMap((b) => tMarks(b, scale).map((m, k) => ({ x: m.x, y: 0.84 + pitY(m.x, m.y), z: m.y, angle: -m.angle + (k < 2 ? Math.PI : 0) }))));  // stems point toward the car centre
    const standGeo = mergeGeometries([
        new THREE.BoxGeometry(4 * scale, 1.1 * scale, 1.6 * scale).translate(0, 0.55 * scale, 0),     // desk
        new THREE.BoxGeometry(4.6 * scale, 0.15 * scale, 2.2 * scale).translate(0, 2.6 * scale, 0),   // roof
        new THREE.BoxGeometry(0.12 * scale, 2.6 * scale, 0.12 * scale).translate(-2.1 * scale, 1.3 * scale, 0),
        new THREE.BoxGeometry(0.12 * scale, 2.6 * scale, 0.12 * scale).translate(2.1 * scale, 1.3 * scale, 0),
    ]);
    add(standGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), wallStands(t).map((w) => ({ x: w.x, y: pitY(w.x, w.y), z: w.y, angle: -w.angle, color: tc(w.teamId) })));
    if (signs.length) world.add(atlasPlanes(signs, 17 * scale, 1.6 * scale, '#888888'));
    if (codes.length) world.add(atlasPlanes(codes, 1.6 * scale, 1.2 * scale, 'rgba(0,0,0,0)'));
}

const solid = (hex) => { const c = new THREE.Color(hex); return () => c; };

// three.js draws a see-through double-sided material twice (back faces, then front), flagging it changed both times, so
// its shader is looked up again every frame (most of a frame's CPU with fences, boards and ghost cars about). Our flat,
// see-through things don't need that: one pass
// The track's world doesn't move: its matrices are worked out once, not again every frame for every object (cars,
// added later, still update)
const freeze = (root) => { root.updateMatrixWorld(true); root.traverse((o) => { o.matrixAutoUpdate = false; }); };
const singlePass = (root) => root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.forceSinglePass = true; });

// Canvas textures made once: building windows, a grandstand crowd
const canvasTex = (w, h, paint, repeat = false) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
};
let windowsTex = null, crowdTex = null, night = false;
const windowsTexture = () => (windowsTex ||= canvasTex(64, 128, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#5d6a78';
    for (let y = 6; y < 124; y += 12) for (let x = 5; x < 60; x += 12) g.fillRect(x, y, 7, 7);
}));
// Night: the same window grid as windowsTexture, a share of them lit warm (an emissive map: lit windows glow, the rest dark)
const litWindowsTexture = (share) => canvasTex(64, 128, (g) => {
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#000000'; g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 124; y += 12) for (let x = 5; x < 60; x += 12) {
        if (rnd() >= share) continue;
        g.fillStyle = ['#ffd9a0', '#ffe9c4', '#cfe0ff'][Math.floor(rnd() * 3)];
        g.fillRect(x, y, 7, 7);
    }
});
const crowdTexture = () => (crowdTex ||= canvasTex(256, 64, (g) => {
    g.fillStyle = '#2a2f38'; g.fillRect(0, 0, 256, 64);
    const cols = ['#e63946', '#f1faee', '#ffd166', '#118ab2', '#ef476f', '#06d6a0', '#ff8c42', '#ffffff'];
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 1; y < 64; y += 3) for (let x = 1; x < 256; x += 3) if (rnd() < 0.85) { g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(x, y, 2, 2); }
}));

// Everything around the track, from scenery.js's placements, in the circuit's style (themes.js): one draw per kind
const PALETTES = {
    leaf: ['#2f6b2a', '#3a7a2f', '#2a5f27', '#457f33'], broad: ['#3f7d2c', '#4c8a33', '#5a9438', '#36702a', '#6a9a3a'],
    town: ['#f2e6cf', '#e8cfa8', '#f0d9c4', '#e9b9a0', '#f7f1e3', '#d9c3a5', '#c9a27e'], sky: ['#9aa3ab', '#b8bec4', '#7f8a96', '#c9ccd0', '#8fa3b8', '#a8b5c2'],
};
function buildScenery(t, scen, theme) {
    const g = new THREE.Group(), mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, ...o });
    const hi = Q.scenery >= 1, seg = (lo, high) => (hi ? high : lo); // High: rounder trees and hills
    const pick = (list, x, y) => list[Math.abs(Math.floor(x * 0.37 + y * 0.61)) % list.length];
    const add = (geo, m, items) => { if (items.length) g.add(instanced(geo, m, items)); };

    // Trees: pine (cone), broadleaf (round crown), palm (tall trunk, flat crown); greens vary tree to tree
    const T = { pine: [[], []], broad: [[], []], palm: [[], []] };
    for (const tr of scen.trees) {
        const k = tr.size === 2 ? 1.5 : 1, h = groundY(tr.x, tr.y), [trunks, crowns] = T[tr.kind] || T.pine, s = { sx: k, sy: k, sz: k };
        if (tr.kind === 'palm') {
            trunks.push({ x: tr.x, y: 5 * scale * k + h, z: tr.y, ...s });
            crowns.push({ x: tr.x, y: 10.2 * scale * k + h, z: tr.y, angle: tr.x, ...s, color: pick(PALETTES.leaf, tr.x, tr.y) });
        } else if (tr.kind === 'broad') {
            trunks.push({ x: tr.x, y: 2.2 * scale * k + h, z: tr.y, ...s });
            crowns.push({ x: tr.x, y: 6.8 * scale * k + h, z: tr.y, angle: tr.y, sx: k, sy: k * 0.85, sz: k, color: pick(PALETTES.broad, tr.x, tr.y) });
        } else {
            trunks.push({ x: tr.x, y: 2 * scale * k + h, z: tr.y, ...s });
            crowns.push({ x: tr.x, y: 7 * scale * k + h, z: tr.y, ...s, color: pick(PALETTES.leaf, tr.x, tr.y) });
        }
    }
    const bark = mat(0x5b3a1e), leaves = mat(0xffffff);
    add(new THREE.CylinderGeometry(0.4 * scale, 0.5 * scale, 4 * scale, seg(5, 8)), bark, T.pine[0]);
    add(new THREE.ConeGeometry(3 * scale, 9 * scale, seg(7, 14)), leaves, T.pine[1]);
    add(new THREE.CylinderGeometry(0.45 * scale, 0.6 * scale, 4.4 * scale, seg(5, 8)), bark, T.broad[0]);
    add(new THREE.IcosahedronGeometry(4.2 * scale, seg(0, 1)), leaves, T.broad[1]);
    add(new THREE.CylinderGeometry(0.25 * scale, 0.4 * scale, 10 * scale, seg(5, 8)), mat(0x8a6a48), T.palm[0]);
    add(new THREE.ConeGeometry(4 * scale, 1.6 * scale, seg(8, 16)), leaves, T.palm[1]);

    // Buildings: a unit box per building, scaled; windows tinted by the building's colour; sunk 6 m so slopes don't lift them
    const town = theme.city === 2, blocks = scen.buildings.map((b) => ({
        x: b.x, y: groundY(b.x, b.y) + ((b.h - 6) / 2) * scale, z: b.y, angle: -b.angle, sx: b.w * scale, sy: (b.h + 6) * scale, sz: b.d * scale,
        color: (town ? PALETTES.town : PALETTES.sky)[Math.floor(b.tone * 7) % 7],
    }));
    const win = windowsTexture(), lit = night ? { emissive: 0xffffff, emissiveMap: litWindowsTexture(nightOf(t.id).windows) } : {};
    add(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, { map: win, roughness: 0.8, ...lit }), blocks);

    // Grandstands: the stand, and its seat deck full of people
    const stands = [], seats = [];
    for (const s of scen.grandstands) {
        const h = groundY(s.x, s.y);
        stands.push({ x: s.x, y: 4 * scale + h, z: s.y, angle: -s.angle });
        seats.push({ x: s.x, y: 8.2 * scale + h, z: s.y, angle: -s.angle });
    }
    add(new THREE.BoxGeometry(60 * scale, 8 * scale, 12 * scale), mat(0x9aa0a6), stands);
    add(new THREE.BoxGeometry(58 * scale, 0.6 * scale, 10 * scale), mat(0xffffff, { map: crowdTexture() }), seats);

    // Billboards on the straights, and the 300 / 200 / 100 m boards before the slow corners: one atlas each
    const facingBoard = (b, y, bg) => ({ text: b.text, x: b.x, y: y + groundY(b.x, b.y), z: b.y, rotY: b.side > 0 ? Math.PI - b.angle : -b.angle, bg }); // front (not the mirrored back) toward the track
    if (scen.billboards.length) g.add(atlasPlanes(scen.billboards.map((b) => facingBoard(b, 2.5 * scale, ['#d62828', '#1e5bd8', '#2a9d3f', '#111827'][b.text.length % 4])), 12 * scale, 3 * scale, '#111827'));
    if (scen.boards.length) g.add(atlasPlanes(scen.boards.map((b) => facingBoard(b, 1.6 * scale, '#1b2a4a')), 1.6 * scale, 1.2 * scale, '#1b2a4a'));

    // Marshal posts: small orange huts behind the barrier
    add(new THREE.BoxGeometry(2.2 * scale, 2.6 * scale, 2.2 * scale), mat(0xf08a24), scen.posts.map((p) => ({ x: p.x, y: 1.3 * scale + groundY(p.x, p.y), z: p.y, angle: -p.angle })));

    // Night: floodlight towers behind the barrier, their lamp banks glowing (unlit material, seen from afar, not fogged)
    if (night && scen.floodlights.length) {
        const at = (f, up, toward) => ({ x: f.x + Math.sin(f.angle) * f.side * toward, y: up + groundY(f.x, f.y), z: f.y - Math.cos(f.angle) * f.side * toward, angle: -f.angle });
        add(new THREE.CylinderGeometry(0.3 * scale, 0.45 * scale, 24 * scale, seg(5, 8)), mat(0x7d838a), scen.floodlights.map((f) => at(f, 12 * scale, 0)));
        add(new THREE.BoxGeometry(5 * scale, 1.6 * scale, 0.7 * scale), new THREE.MeshBasicMaterial({ color: 0xf2f5ff, fog: false }), scen.floodlights.map((f) => at(f, 24 * scale, 1.2 * scale)));
    }

    if (scen.landmark) g.add(buildLandmark(scen.landmark));

    // Far off: mountains ringing the horizon (Spa, Spielberg, Monaco), the sea under it all (coast and river circuits)
    const b = getBounds(t.path), cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2, R = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2 + 5000;
    const low = Math.min(...(t.z || [0])) * scale * ELEVATION_SCALE;
    if (theme.mountains) {
        const peaks = [];
        for (let k = 0; k < 28; k++) {
            // the whole base 600 m+ past the track's extent, so no slope reaches it; within the fog's reach so they show
            const a = (k / 28) * Math.PI * 2, hgt = (220 + ((k * 53) % 9) * 45) * scale, r = R - 5000 + 600 * scale + hgt * 1.2 + ((k * 37) % 10) * 60 * scale;
            peaks.push({ x: cx + Math.cos(a) * r, y: low + hgt / 2, z: cz + Math.sin(a) * r, sx: hgt * 1.2, sy: hgt, sz: hgt * 1.2, angle: a, color: (night ? ['#141b26', '#18202b', '#1c2430'] : ['#6f8a6a', '#7a8f7c', '#8796a0'])[k % 3] }); // night: silhouettes
        }
        add(new THREE.ConeGeometry(1, 1, seg(6, 16)), mat(0xffffff), peaks);
    }
    if (theme.sea) {
        const sea = new THREE.Mesh(new THREE.PlaneGeometry(R * 8, R * 8), mat(0x2f6f9a, { roughness: 0.35, metalness: 0.1 }));
        sea.rotation.x = -Math.PI / 2;
        sea.position.set(cx, low - 2 * scale, cz);
        g.add(sea);
    }
    return g;
}

// Suzuka's Ferris wheel and COTA's observation tower: a few meshes, built once per session
function buildLandmark(l) {
    const g = new THREE.Group(), s = scale, steel = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
    if (l.kind === 'wheel') {
        const R = 28 * s, ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.6 * s, 6, 48), steel);
        ring.position.y = R + 6 * s;
        g.add(ring);
        for (let k = 0; k < 8; k++) {
            const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.25 * s, 2 * R, 4), steel);
            spoke.position.y = R + 6 * s; spoke.rotation.z = (k / 8) * Math.PI;
            g.add(spoke);
        }
        for (const d of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * s, 0.9 * s, R + 8 * s, 6), steel);
            leg.position.set(d * R * 0.35, (R + 6 * s) / 2, 0); leg.rotation.z = d * 0.33;
            g.add(leg);
        }
        const cars = [];
        for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; cars.push({ x: Math.cos(a) * R, y: R + 6 * s + Math.sin(a) * R - 2 * s, z: 0, color: ['#e63946', '#ffd166', '#118ab2', '#06d6a0'][k % 4] }); }
        g.add(instanced(new THREE.BoxGeometry(2.5 * s, 2.5 * s, 2.5 * s), new THREE.MeshStandardMaterial({ color: 0xffffff }), cars));
    } else { // COTA: a slim tower with a red canopy fanning down from its top
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(2 * s, 3 * s, 77 * s, 8), steel);
        tower.position.y = 38.5 * s;
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(8 * s, 8 * s, 3 * s, 12), steel);
        deck.position.y = 72 * s;
        const veil = new THREE.Mesh(new THREE.ConeGeometry(30 * s, 75 * s, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xd62828, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
        veil.position.y = 38 * s;
        g.add(tower, deck, veil);
    }
    g.position.set(l.x, groundY(l.x, l.y), l.y);
    g.rotation.y = -l.angle;
    return g;
}

// Monaco's tunnel (OSM tunnel=yes, Track.js t.tunnels): concrete side walls on the barrier line (where cars stop), a
// roof slab that shades the road, portal faces at both ends and a strip of lamps along the roof
const TUNNEL_ROOF_M = 6.5, TUNNEL_SLAB_M = 2;
function buildTunnels(t, path, half) {
    const g = new THREE.Group(), n = path.length, W = half + (t.wallOffset ?? WALL_OFFSET);
    const roof = TUNNEL_ROOF_M * scale, top = roof + TUNNEL_SLAB_M * scale, H = heights(path);
    const inside = path.map((_, i) => t.tunnels.some(([a, b]) => t.cum[i] >= a && t.cum[i + 1] <= b)), keep = (i) => inside[i];
    const concrete = solid('#9d988d'), slab = solid('#76726a');
    for (const s of [1, -1]) g.add(wall(path, s * W, top, keep, concrete));
    const under = strip(path, -W, W, roof, keep, slab);
    under.castShadow = true;
    g.add(under, strip(path, -W, W, top, keep, slab));
    const lamps = strip(path, -0.25 * scale, 0.25 * scale, roof - 0.05 * scale, (i) => inside[i] && i % 2 === 0, solid('#fff1c4')); // one every other point
    lamps.material.emissive = new THREE.Color('#ffe7a8');
    g.add(lamps);
    // Portals: the slab's end faces above each mouth
    const L = offsetPoints(path, -W), R = offsetPoints(path, W), pos = [], col = [], c = slab();
    for (let k = 0; k < n; k++) {
        if (inside[k] === inside[(k - 1 + n) % n]) continue; // a mouth: the first point inside, or the first past the end
        const y0 = H[k] + roof, y1 = H[k] + top;
        pos.push(L[k].x, y0, L[k].y, R[k].x, y0, R[k].y, R[k].x, y1, R[k].y, L[k].x, y0, L[k].y, R[k].x, y1, R[k].y, L[k].x, y1, L[k].y);
        for (let m = 0; m < 6; m++) col.push(c.r, c.g, c.b);
    }
    if (pos.length) g.add(coloredMesh(pos, col));
    return g;
}

// Suzuka's overpass, as in the photos, all from the server's bridge geometry (Track.js buildBridges): a skew concrete deck
// whose ends rest on the cutting walls, parapets with a blue band and a light catch fence along its sides, the lower
// road's cutting lined with concrete walls that follow its curve, and grass along the top of each wall joining it to the
// ground. The physics stops cars at the same parapets and walls.
const DECK_M = 1.2, BERM_M = 16;
function buildBridge(b, t) {
    const S = scale * ELEVATION_SCALE, up = b.upper.h * S, deck = DECK_M * scale, top = up + 0.5; // deck top: just under the asphalt
    const solidMesh = (pos, color, opts = {}) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, ...opts }));
        m.castShadow = !opts.transparent; m.receiveShadow = true;
        world.add(m);
    };
    const quad = (pos, a, b2, c, d) => pos.push(a.x, a.h, a.y, b2.x, b2.h, b2.y, c.x, c.h, c.y, a.x, a.h, a.y, c.x, c.h, c.y, d.x, d.h, d.y);
    const at = (p, h) => ({ x: p.x, y: p.y, h });

    // Deck: the parallelogram between the upper road's edges and the walls, 1.2 m deep
    const C = b.corners, slab = [];
    quad(slab, at(C[0], top), at(C[1], top), at(C[2], top), at(C[3], top));
    quad(slab, at(C[0], top - deck), at(C[1], top - deck), at(C[2], top - deck), at(C[3], top - deck));
    for (let k = 0; k < 4; k++) { const p = C[k], q = C[(k + 1) % 4]; quad(slab, at(p, top - deck), at(q, top - deck), at(q, top), at(p, top)); }
    solidMesh(slab, 0xc9c4ba);

    // Parapets along both sides of the deck: concrete, a blue band, a light catch fence above
    const wallPos = [], band = [], fence = [];
    for (const [p, q] of [[C[0], C[1]], [C[3], C[2]]]) {
        quad(wallPos, at(p, top), at(q, top), at(q, top + 0.8 * scale), at(p, top + 0.8 * scale));
        quad(band, at(p, top + 0.8 * scale), at(q, top + 0.8 * scale), at(q, top + 1.1 * scale), at(p, top + 1.1 * scale));
        quad(fence, at(p, top + 1.1 * scale), at(q, top + 1.1 * scale), at(q, top + 3 * scale), at(p, top + 3 * scale));
    }
    solidMesh(wallPos, 0xd9d6cf);
    solidMesh(band, 0x1e5bd8);
    solidMesh(fence, 0x9aa3ad, { transparent: true, opacity: 0.15, depthWrite: false });

    // Cutting walls along the lower road, from below it up to the ground just outside (into the deck under the bridge),
    // and a grass strip from each wall's top out to the ground, so nothing shows between them
    const walls = [], berm = [];
    for (const [w, side] of [[b.walls[2], 1], [b.walls[3], -1]]) {
        const outer = w.pts.map((p, k) => {
            const a = b.cut[k].angle, o = side * BERM_M * scale;
            return { x: p.x - Math.sin(a) * o, y: p.y + Math.cos(a) * o };
        });
        const tops = w.pts.map((p, k) => {
            const a = b.cut[k].angle, o = side * 2 * scale, low = b.cut[k].h * S;
            return Math.max(low + 0.5 * scale, groundY(p.x - Math.sin(a) * o, p.y + Math.cos(a) * o) + TERRAIN_SINK_M * scale);
        });
        for (let k = 0; k + 1 < w.pts.length; k++) {
            const p = w.pts[k], q = w.pts[k + 1], lp = b.cut[k].h * S - scale, lq = b.cut[k + 1].h * S - scale;
            quad(walls, at(p, lp), at(q, lq), at(q, tops[k + 1]), at(p, tops[k]));
            quad(berm, at(p, tops[k] - 0.1 * scale), at(q, tops[k + 1] - 0.1 * scale),
                at(outer[k + 1], groundY(outer[k + 1].x, outer[k + 1].y)), at(outer[k], groundY(outer[k].x, outer[k].y)));
        }
    }
    solidMesh(walls, 0xc9c4ba);
    solidMesh(berm, 0x5f9e35);
}

const LINE_RGB = { green: new THREE.Color('#22c55e'), yellow: new THREE.Color('#facc15'), red: new THREE.Color('#ef4444') };

function buildRacingLine(t) {
    line = null;
    lineIdx = null;
    drsIdx = null;
    lineMode = lineChoice(); // each session starts from the lobby choice
    const rl = t.racingLine;
    coach = createCoach(rl ? cornersOf(rl, t) : [], t, rl || { offset: [], speed: [], phase: [] }, { intro: coachOn && coachIntro });
    if (coachOn) coachIntro = false;
    coachIdx = null;
    if (!rl) return;
    const P = t.path, n = P.length, w = 0.5 * scale, y = 0.75;
    const L = P.map((p, i) => {
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: p.x - ((b.y - a.y) / len) * rl.offset[i], y: p.y + ((b.x - a.x) / len) * rl.offset[i] };
    });
    // One chevron per segment, pointing along the lap: 4 triangles = 12 vertices
    const pos = new Float32Array(n * 36), H = heights(P);
    for (let i = 0; i < n; i++) {
        const a = L[i], b = L[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len, h0 = H[i], h1 = H[(i + 1) % n];
        const at = (f, s) => ({ x: a.x + tx * len * f - ty * w * s, y: a.y + ty * len * f + tx * w * s, h: h0 + (h1 - h0) * f });
        const BL = at(0, 1), BR = at(0, -1), NOTCH = at(0.35, 0), FL = at(0.6, 1), FR = at(0.6, -1), TIP = at(0.95, 0);
        [BL, FL, NOTCH, FL, TIP, NOTCH, TIP, FR, NOTCH, FR, BR, NOTCH].forEach((p, v) => {
            const k = i * 36 + v * 3;
            pos[k] = p.x; pos[k + 1] = y + p.h; pos[k + 2] = p.y;
        });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 36), 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
        polygonOffset: true, polygonOffsetFactor: depthBias(-3, reversed), polygonOffsetUnits: depthBias(-6, reversed) }));
    mesh.renderOrder = 1;        // over the tyre marks
    mesh.frustumCulled = false;  // hidden segments collapse to the origin, so the bounds are meaningless
    world.add(mesh);
    line = { mesh, full: pos, mask: cornerMask(rl.phase, t.cum, scale), rl, n };
    applyLineMode();
    colourLine();
}

// Corners-only hides segments by collapsing them; rewritten only when the mode changes
function applyLineMode() {
    if (!line) return;
    const p = line.mesh.geometry.attributes.position;
    for (let i = 0; i < line.n; i++) {
        const show = lineMode === 'full' || (lineMode === 'corners' && line.mask[i]);
        for (let k = i * 36; k < i * 36 + 36; k++) p.array[k] = show ? line.full[k] : 0;
    }
    p.needsUpdate = true;
}

// Base colours by phase; within 250 m ahead, from your own speed
function colourLine() {
    if (!line) return;
    const gs = clientState.gameState, me = gs && gs[clientState.me], racing = !!me && !isSpectator();
    line.mesh.visible = lineMode !== 'off' && !(racing && me.inPit);
    if (!line.mesh.visible) { lineIdx = null; line.baseDone = false; return; } // re-found from scratch when the line comes back
    if (!racing && line.baseDone) return; // spectators see fixed base colours: written once
    const t = clientState.trackData, rl = line.rl, c = line.mesh.geometry.attributes.color;
    let from = null, v = 0;
    if (racing) {
        lineIdx = trackIndex(t.path, me.x, me.y, lineIdx, t.width);
        from = lineIdx;
        v = Math.abs(me.speed) / scale;
    }
    for (let i = 0; i < line.n; i++) {
        const col = LINE_RGB[segmentColor(rl.phase[i], rl.speed[i], v, from === null ? null : aheadM(t.cum, from, i, scale))];
        for (let k = i * 36; k < i * 36 + 36; k += 3) { c.array[k] = col.r; c.array[k + 1] = col.g; c.array[k + 2] = col.b; }
    }
    c.needsUpdate = true;
    line.baseDone = !racing;
}


function buildWorld(t) {
    applyLevel(resolveLevel(store.get('lanrace.quality') || 'auto', store.get('lanrace.quality.auto')));
    const theme = themeOf(t.id), land = LANDS[theme.land]; // the place: sky, light, land, trees, city (themes.js)
    night = clientState.settings.timeOfDay === 'night';
    applySky(night ? nightOf(t.id) : SKIES[theme.sky]);
    hemi.groundColor.set(land.bounce);
    elev = t; // road heights for everything built below, the cars and the camera
    scale = t.scale;
    // Quali → race on the same track: keep the world (rebuilding recompiles every shader and stalls the lights);
    // only the cars and the racing line are per session
    if (world && world.userData.trackId === t.id && world.userData.level === level && world.userData.night === night) {
        for (const id in cars) {
            cars[id].root.traverse((o) => { // per-car material clones and name-tag textures (liveries are shared)
                if (!o.material) return;
                if (o.isSprite) o.material.map?.dispose();
                o.material.dispose();
            });
            dropCar(id);
        }
        if (line) { world.remove(line.mesh); line.mesh.geometry.dispose(); line.mesh.material.dispose(); }
        buildRacingLine(t);
        return;
    }
    if (world) {
        scene.remove(world);
        // Free GPU memory; shared caches (asphalt, blob, env map, liveries) are kept for the next world
        const keep = new Set([asphaltTex, asphaltRough, blobTex, envTex]);
        world.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.isInstancedMesh) o.dispose();
            for (const m of [].concat(o.material || [])) {
                if (m.map && !keep.has(m.map) && !m.map.isDataTexture) m.map.dispose(); // liveries (data textures) are cached
                m.emissiveMap?.dispose(); // night windows
                m.dispose();
            }
        });
    }
    for (const id in cars) delete cars[id];
    wheelBatch = null; // rebuilt in the new world
    boxRing = null;
    for (const c of crews) { world?.remove(c.root); c.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } }); c.mesh.material.dispose(); c.tyres.material.dispose(); }
    crews.length = 0; humanGeo?.dispose(); tyreGeo?.dispose(); humanGeo = tyreGeo = null;

    scale = t.scale;
    world = new THREE.Group();
    world.userData = { trackId: t.id, level, night };
    scene.add(world);

    const path = t.path, half = t.width / 2, n = path.length;
    // the road, its lines, kerbs, verge, gravel and barriers are drawn along rp (smooth); the rest works on the points
    const { rp, up, K } = smoothPath(path, t.scale, t.cum), m = rp.length;
    heightCache.set(rp, t.z ? up(t.z).map((z) => z * t.scale * ELEVATION_SCALE) : rp.map(() => 0));
    bounds = getBounds(path);
    const all = () => true;
    const alternate = (h1, h2) => { const a = new THREE.Color(h1), b = new THREE.Color(h2); return (i) => (i % 2 ? a : b); };
    // How far the asphalt reaches per smooth-curve point and side (dir as offsetPoints: +1 / -1): half the road, or as far
    // as a median (Track.js buildMedians: Monaco's Fairmont hairpin, two legs side by side at different heights), where
    // each road ends; no verge or gravel past it either
    const roadTo = { 1: rp.map(() => half), [-1]: rp.map(() => half) };
    for (const md of t.medians || []) for (const dir of [1, -1]) rp.forEach((p, k) => {
        const a = rp[(k - 1 + m) % m], b = rp[(k + 1) % m], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const dx = (-(b.y - a.y) / l) * dir, dy = ((b.x - a.x) / l) * dir; // sideways, as offsetPoints
        for (let i = 0; i + 1 < md.length; i++) {
            const c = md[i], ex = md[i + 1].x - c.x, ey = md[i + 1].y - c.y, r = dx * ey - dy * ex;
            if (!r) continue;
            const s = ((c.x - p.x) * ey - (c.y - p.y) * ex) / r, v = ((c.x - p.x) * dy - (c.y - p.y) * dx) / r;
            if (s > 0 && v >= 0 && v <= 1) roadTo[dir][k] = Math.min(roadTo[dir][k], s);
        }
    });
    const clipped = (dir, k) => roadTo[dir][k] < half; // a median beside this point
    const signed = (dir, A) => A.map((v) => dir * v);

    // Grass verge at road height from the track edge towards the barrier, so the road never sits on a step; it stops
    // short wherever another part of the track is nearer (hairpins, Suzuka's bridge) and leaves room for a grass bank down
    // to a road at another height (scenery.js vergeReach)
    const vr = { 1: vergeReach(t, 1), [-1]: vergeReach(t, -1) };
    const reach = { 1: vr[1], [-1]: vr[-1].map((r) => -r) }, rreach = { 1: up(reach[1]), [-1]: up(reach[-1]) };
    groundFn = t.z ? terrainGround(t, vr) : null;
    // Ground: a height grid following each road out to its verge edge, banking between roads at different heights, pressed
    // down wherever a road passes so no triangle covers the asphalt (scenery.js terrainGround / terrainHeights, tested)
    // ponytail: heights from the roads only; a real terrain model if hills away from the track matter
    // A coarse grid at once (a few ms), the fine one from a worker a moment later, so a session never freezes on it
    const gw = bounds.maxX - bounds.minX + 8000, gh = bounds.maxY - bounds.minY + 8000;
    const x0 = (bounds.minX + bounds.maxX - gw) / 2, y0 = (bounds.minY + bounds.maxY - gh) / 2, carve = carveReach(t, vr); // out to the barrier
    const groundGeo = (segs, H) => {
        const g = new THREE.PlaneGeometry(gw, gh, segs, segs);
        g.rotateX(-Math.PI / 2);
        g.translate((bounds.minX + bounds.maxX) / 2, 0, (bounds.minY + bounds.maxY) / 2);
        if (!H) return g;
        const gp = g.attributes.position, cw = gw / segs, ch = gh / segs;
        for (let k = 0; k < gp.count; k++) {
            const ix = Math.round((gp.getX(k) - x0) / cw), iy = Math.round((gp.getZ(k) - y0) / ch);
            gp.setY(k, H[iy * (segs + 1) + ix] * scale * ELEVATION_SCALE);
        }
        g.computeVertexNormals();
        return g;
    };
    const coarse = t.z ? terrainHeights(t, x0, y0, gw, gh, GROUND_COARSE, groundFn, TERRAIN_SINK_M, carve) : null;
    terrainAt = coarse && gridSampler(coarse, x0, y0, gw, gh, GROUND_COARSE);
    vergeR = vr;
    // Night: the land beyond the floodlit verges falls away into the dark
    const ground = new THREE.Mesh(groundGeo(GROUND_COARSE, coarse), new THREE.MeshStandardMaterial({ map: grassTexture(gw, gh, land), roughness: 1, color: night ? 0x3a4250 : 0xffffff }));
    ground.receiveShadow = true;
    world.add(ground);
    // Walls that meet the drawn ground (verge skirts, barriers): built for the coarse ground, again for the fine one
    const groundWalls = new THREE.Group(), wallBuilders = [];
    const buildGroundWalls = (H, segs) => {
        for (const m of groundWalls.children) m.geometry.dispose();
        groundWalls.clear();
        const at = H ? gridSampler(H, x0, y0, gw, gh, segs) : () => -TERRAIN_SINK_M;
        for (const build of wallBuilders) build(at);
        singlePass(groundWalls);
        freeze(groundWalls);
    };
    world.add(groundWalls);
    // A grass skirt hanging from each verge edge hides what the ground grid smooths away on banks, and becomes a stone
    // retaining wall where the drawn ground falls away further (Monaco's hillside roads); none where another road passes
    // beneath (the bridge stays open)
    const grass = solid(land.verge), stone = solid('#b3a990');
    const open = { 1: null, [-1]: null };
    if (t.z) wallBuilders.push((at) => {
        for (const dir of [1, -1]) {
            // open (nothing beneath) checked at each point of the smooth curve's verge edge itself, as the barriers are
            // ...and not right beside another part of the track (Suzuka: the upper road's edge crossing over the lower road's
            // cutting hung a strip of skirt down into it)
            const otherDist = (q, own) => { // nearest track that isn't this point's own stretch (±6 points)
                let best = Infinity;
                for (let i = 0; i < n; i++) {
                    const g = Math.abs(i - own); if (Math.min(g, n - g) <= 6) continue;
                    const a = path[i], b = path[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
                    const u = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.y - a.y) * ey) / l2)) : 0;
                    best = Math.min(best, Math.hypot(q.x - a.x - u * ex, q.y - a.y - u * ey));
                }
                return best;
            };
            open[dir] ||= offsetPoints(rp, rreach[dir]).map((q, k) => distToPath(q, path) >= Math.abs(rreach[dir][k]) * 0.9
                && otherDist(q, Math.floor(k / K)) > Math.abs(rreach[dir][k]) + 3 * scale);
            const E = offsetPoints(rp, rreach[dir]), near = (k) => Math.hypot(E[(k + 1) % m].x - E[k].x, E[(k + 1) % m].y - E[k].y) < 4 * RENDER_STEP_M * scale;
            const o = open[dir].map((v, k) => v && near(k)), depth = up(skirtDepth(t, vr[dir], dir, at));
            groundWalls.add(wall(rp, rreach[dir], depth.map((d) => -d * scale * ELEVATION_SCALE), (k) => o[k] && o[(k + 1) % m] && depth[k] > 0 && depth[(k + 1) % m] > 0,
                (k) => (Math.max(depth[k], depth[(k + 1) % m]) > SKIRT_M ? stone(k) : grass(k))));
        }
    });
    if (t.z) {
        const fine = Q.scenery >= 1 ? GROUND_FINE_HIGH : GROUND_FINE;
        fineGround(t, vr, { x0, y0, w: gw, h: gh, segs: fine, sink: TERRAIN_SINK_M, carve }, (H) => {
            if (ground.parent !== world) return; // the world was rebuilt meanwhile
            const old = ground.geometry;
            ground.geometry = groundGeo(fine, H);
            terrainAt = gridSampler(H, x0, y0, gw, gh, fine); // the cars follow the grid that's drawn
            old.dispose();
            buildGroundWalls(H, fine);
        });
        for (const dir of [1, -1]) world.add(strip(rp, signed(dir, roadTo[dir]), rreach[dir], 0.3, (k) => !clipped(dir, k) && !clipped(dir, (k + 1) % m), solid(land.verge)));
    }
    world.add(strip(rp, signed(-1, roadTo[-1]), roadTo[1], 0.6, all, solid('#4a505a'), { map: asphaltTexture(), roughnessMap: asphaltRough, repeatM: 8 }));
    // White lines on the track limits (t.edgeR / edgeL: judged there); beyond them the road carries on as asphalt run-off
    // to the drawn edge (Track.js: the road 2x the real width, the lines 4/3)
    const R = t.edgeR || path.map(() => half - 0.5 * scale), L = t.edgeL || R, lineW = 0.3 * scale; // per point (+ = driver's right)
    const rR = up(R), rL = up(L);
    const add = (e, d) => e.map((v) => v + d), neg = (e, d = 0) => e.map((v) => -(v + d));
    world.add(strip(rp, add(rR, -lineW), rR, 0.9, all, solid('#f2f2f2'), { layer: 2 }));
    world.add(strip(rp, neg(rL), neg(rL, -lineW), 0.9, all, solid('#f2f2f2'), { layer: 2 }));

    // Kerbs on corners (visual only), widened by 2 points so they don't flicker on and off; stripes ~2.5 m (alternate per
    // smooth-curve step, as real kerbs)
    const turny = path.map((_, i) => turnAngle(path, i) > KERB_TURN);
    const curvy = turny.map((_, i) => [-2, -1, 0, 1, 2].some((d) => turny[(i + d + n) % n])), rc = up(curvy);
    // 1.5 m wide, ending at the road's edge where the white line runs closer to it than that (never out on the grass)
    const kerbW = 1.5 * scale, kR = rR.map((v, k) => Math.min(v + kerbW, roadTo[1][k])), kL = rL.map((v, k) => Math.min(v + kerbW, roadTo[-1][k]));
    world.add(strip(rp, rR, kR, 0.7, (i) => rc[i], alternate('#d62828', '#f2f2f2'), { layer: 1 }));
    world.add(strip(rp, neg(kL), neg(rL), 0.7, (i) => rc[i], alternate('#d62828', '#f2f2f2'), { layer: 1 }));

    const scen = placeScenery(t, Q.scenery, seedOf(t.id));
    const onSlow = (side) => {
        const mark = new Array(n).fill(false);
        for (const c of scen.slowCorners) if (c.side === side) for (let i = c.from; i !== c.to; i = (i + 1) % n) mark[i] = true;
        return mark;
    };
    const slowOut = { 1: onSlow(1), [-1]: onSlow(-1) }, rslow = { 1: up(slowOut[1]), [-1]: up(slowOut[-1]) };
    // Gravel traps on the outside of slow corners, between the kerb and the barrier (visual only)
    for (const dir of [1, -1]) {
        const edge = rreach[dir].map((r) => r - dir * scale); // a metre inside the verge's reach
        // from the end of the asphalt run-off
        world.add(strip(rp, signed(dir, roadTo[dir]), edge, 0.4, (i) => rslow[dir][i] && !clipped(dir, i) && !clipped(dir, (i + 1) % m), solid('#cdb98f')));
    }
    // Rubbered-in racing line through slow corners: inside at the apex, drifting out on exit (Medium/High)
    if (Q.tyreMarks) {
        for (const c of scen.slowCorners) {
            const inside = -c.side; // the outside is c.side
            world.add(strip(rp, inside * half * 0.15, inside * half * 0.55, 0.62, (i) => {
                const len = (c.to - c.from + n) % n, k = (Math.floor(i / K) - c.from + n) % n;
                return k < len;
            }, solid('#1a1c20'), { opacity: 0.35, layer: 1 }));
        }
    }
    // Thin dark outer edge on the kerbs so they read at speed
    world.add(strip(rp, add(kR, -0.2 * scale), kR, 0.72, (i) => rc[i], solid('#5a1414'), { layer: 2 }));
    world.add(strip(rp, neg(kL), neg(kL, -0.2 * scale), 0.72, (i) => rc[i], solid('#5a1414'), { layer: 2 }));
    buildRacingLine(t);

    // Barriers exactly where the physics wall is; skipped where another part of the track is closer. 1 m tall, or where
    // the barrier stands in the bank between two roads at different heights, tall enough to stand 1 m above the ground
    // there (a retaining wall) instead of being buried in it
    const wallOff = half + (t.wallOffset ?? WALL_OFFSET);
    const ok = {}, foot = {}, H0 = heights(rp), redWhite = alternate('#d62828', '#f2f2f2'), tyre = solid('#1b1b1b'), fence = solid('#d8dde2');
    const med5 = (A) => A.map((_, i) => [-2, -1, 0, 1, 2].map((d) => A[(i + d * K + m) % m]).sort((a, b) => a - b)[2]); // no one-point spikes
    for (const dir of [1, -1]) {
        // drawn only where the physics wall is: each point of the smooth curve's barrier line checked itself (holding a
        // track point's answer along the curve let pieces through on the inside of hairpins and over Suzuka's lower road)
        // ...and only where the line's nearest bit of track is its own (within ±4 points): on the inside of a hairpin tighter
        // than the barrier distance the line folds back past the apex, far from the road but on the wrong side
        foot[dir] = offsetPoints(rp, dir * wallOff);
        const openW = t.openWall ? t.openWall[dir > 0 ? 0 : 1] : null; // no barrier there (Track.js openWalls), as in physics
        ok[dir] = foot[dir].map((p, k) => {
            if (openW && openW[Math.floor(k / K)]) return false;
            if (distToPath(p, path) <= wallOff * 0.95) return false;
            if (t.pit && distToPath(p, t.pit.path, false) < t.pit.width / 2 + (PIT_RUNOFF_M + 2) * scale) return false;
            const d = Math.abs(trackIndex(path, p.x, p.y, null) - Math.floor(k / K));
            return Math.min(d, n - d) <= 4;
        });
    }
    wallBuilders.push((at) => {
        for (const dir of [1, -1]) {
            // from the ground (or the road, whichever is lower: no gap under it where the ground falls away past the run-off)
            // to 1 m above the road or the ground, whichever is higher
            const g = foot[dir].map((p) => at(p.x, p.y) * scale * ELEVATION_SCALE);
            const base = med5(g.map((h, i) => Math.min(0, h - H0[i]) - 0.3 * scale));
            // a piece joins two neighbouring line points; none where they are far apart (the line folds on the inside of a bend)
            const F = foot[dir], keep = (i) => ok[dir][i] && ok[dir][(i + 1) % m] && Math.hypot(F[(i + 1) % m].x - F[i].x, F[(i + 1) % m].y - F[i].y) < 4 * RENDER_STEP_M * scale;
            const top = med5(g.map((h, i) => Math.max(1 * scale, h + 1 * scale - H0[i])));
            const stripe = (i) => Math.floor(i / Math.max(1, K / 2)); // red/white blocks ~5 m long, whatever the curve's step
            // concrete from the ground up to the barrier, the 1 m barrier (red/white, tyres at slow corners) on top
            groundWalls.add(wall(rp, dir * wallOff, top.map((v, i) => v - 1 * scale - base[i]), keep, solid('#a29d92'), base));
            groundWalls.add(wall(rp, dir * wallOff, 1 * scale, keep, (i) => (rslow[dir][i] ? tyre(i) : redWhite(stripe(i))), top.map((v) => v - 1 * scale)));
            // a see-through catch fence on top (not on Low: a big transparent surface costs fill rate)
            if (Q.scenery >= 0.5) groundWalls.add(wall(rp, dir * wallOff, 3 * scale, keep, fence, top, { opacity: 0.22 }));
        }
    });
    buildGroundWalls(coarse, GROUND_COARSE);
    // Medians: concrete from the lower road up to the higher one (a retaining wall where they differ), the red and white
    // barrier and its catch fence on top, as the run-off barriers
    for (const md of t.medians || []) {
        const H = heights(md), S = scale * ELEVATION_SCALE, keep = (i) => i < md.length - 1;
        const lo = md.map((q, i) => q.lo * S - H[i] - 0.3 * scale), hi = md.map((q, i) => q.hi * S - H[i] + ROAD_DRAW_Y);
        world.add(wall(md, 0, hi.map((v, i) => v - lo[i]), keep, solid('#a29d92'), lo));
        world.add(wall(md, 0, 1 * scale, keep, (i) => redWhite(Math.floor(i / 2)), hi));
        if (Q.scenery >= 0.5) world.add(wall(md, 0, 3 * scale, keep, fence, hi.map((v) => v + 1 * scale), { opacity: 0.22 }));
    }

    if (t.tunnels && t.tunnels.length) world.add(buildTunnels(t, path, half));

    world.add(buildScenery(t, scen, theme));

    world.add(startLine(t.start, t.width)); // chequered: the timing / finish line
    if (t.gridLine) { // the white start line across the real track, ahead of pole (the grid sits past the timing line)
        const g = t.gridLine, i = trackIndex(path, g.x, g.y, null), r = R[i], l = L[i], m = flat(0.4 * scale, r + l, 0xf2f2f2);
        const c = side(g, g.angle, (r - l) / 2); // white line to white line, centred between them
        m.position.set(c.x, 0.95 + roadY(g.x, g.y, g.angle), c.y);
        m.rotation.y = -g.angle;
        world.add(m);
    }
    gridBoxes(t.startPositions);
    if (t.pit) buildPit(t.pit, t);
    for (const b of t.bridges || []) buildBridge(b, t);
    snapCamera = true; pitBlend = 0;
}

// ---------- cars ----------
// The car (carModel.js, built from smooth surfaces): one template per quality level, its detail by level, a lighter body
// past CAR_LOD_M from the camera (only the few cars near you need every curve)
const CAR_DETAIL = { low: 'low', medium: 'mid', high: 'high' }, CAR_LOD_M = 45;
const carTemplates = {};
const carTemplateFor = () => (carTemplates[level] ||= buildCar(CAR_DETAIL[level] || 'mid', CAR_LOD_M * scale));
let carTemplate = null; // the current level's (wheel batches are built from it)
const liveryTexture = (teamId) => carLivery(teamId, Q.anisotropy);

function dropCar(id) {
    if (cars[id]) world?.remove(cars[id].root);
    delete cars[id];
}

// The paint reflection takes ~1.5 s of GPU work to make: done now, in the lobby, not when the first car appears

function nameTag(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.roundRect(16, 14, 224, 36, 18); g.fill();
    g.fillStyle = color;
    g.font = 'bold 30px Outfit, Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(2.5 * scale, 0.6 * scale, 1);
    s.position.y = 2.0 * scale;
    s.renderOrder = 10;
    return s;
}

// Low quality: a soft dark patch instead of real shadows
let blobTex = null;
function blobShadow(strength = 1) {
    if (!blobTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
        grad.addColorStop(0, 'rgba(0,0,0,0.7)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        blobTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6 * scale, 2.3 * scale), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: depthBias(-2, reversed), polygonOffsetUnits: depthBias(-4, reversed) }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0.2 * scale, 0.1, 0); // just over the asphalt under the car, a touch forward of the axle midpoint
    m.renderOrder = 1;
    return m;
}

// The session's sky as a reflection/ambient map (PMREM), built once per sky
let envTex = null;
function envTexture() {
    if (envTex) return envTex;
    let s = skyScene;
    if (skyDome.visible) { // night: the dome and its stars
        s = new THREE.Scene();
        const dome = skyDome.clone();
        dome.position.set(0, 0, 0); dome.scale.setScalar(50);
        s.add(dome);
    }
    // Without the sun disc: the sun light lights the scene already, a disc blurred into the map would add it twice
    daySky.showSunDisc.value = 0;
    envTex = new THREE.PMREMGenerator(renderer).fromScene(s, 0, 0.1, 1000).texture;
    daySky.showSunDisc.value = 1;
    return envTex;
}

function makeCar(id) {
    const lp = driverOf(id);
    if (!lp) return null;
    const root = new THREE.Group();
    const wheels = [];
    carTemplate = carTemplateFor();
    let model = null;
    if (carTemplate) {
        model = carTemplate.clone(true);
        const map = liveryTexture(lp.teamId);
        model.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.material = o.material.clone(); // per-car materials so ghost opacity doesn't leak to other cars
            if (o.material.name === 'livery') {
                o.material.map = map;
                o.material.color.set(0xffffff);
                o.material.needsUpdate = true;
            }
        });
        for (const name of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
            const w = model.getObjectByName(name);
            if (!w) continue;
            wheels.push(w);
            // Drawn by the shared wheel batches instead (tyre + rim for every car = 2 draws)
            w.traverse((o) => { if (o.isMesh) { o.visible = false; o.castShadow = false; } });
        }
        model.scale.setScalar(scale);
        root.add(model);
    } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(5.6 * scale, 1 * scale, 2 * scale), new THREE.MeshStandardMaterial({ color: lp.color }));
        box.position.y = 0.5 * scale;
        box.castShadow = true;
        root.add(box);
    }
    // Your own car has no label: it would sit in the middle of the chase-cam view
    const tag = id === clientState.me ? null : nameTag(lp.username, lp.color);
    if (tag) root.add(tag);
    root.add(blobShadow(Q.shadows ? 0.75 : 1)); // contact shadow: the car sits on the road, whatever the sun does
    singlePass(root);
    return { id, root, model, wheels, teamId: lp.teamId, ghost: false, tag };
}

function updateCars(dt) {
    const gs = clientState.gameState;
    for (const id in cars) if (!gs[id]) dropCar(id);
    for (const id in gs) {
        const s = gs[id];
        let car = cars[id];
        if (!car) {
            car = makeCar(id);
            if (!car) continue;
            car.root.position.set(s.x, ROAD_DRAW_Y, s.y);
            car.root.rotation.order = 'YXZ'; // heading, then pitch about the car's own axis
            world.add(car.root);
            cars[id] = car;
        }
        const r = car.root;
        r.position.x = s.x;
        r.position.z = s.y;
        r.rotation.y = -s.angle;
        // All four tyres on the road: height under each wheel, the body takes their average, pitch and roll
        if (elev && elev.z) {
            const fx = Math.cos(s.angle), fy = Math.sin(s.angle), ax = WHEELBASE_M / 2 * scale, tw = TRACK_WIDTH_M / 2 * scale;
            car.roadI = heightAt(elev, s.x, s.y, s.angle, car.roadI).i; // its own road, followed frame to frame (bridge levels)
            const at = (a, l) => { // l > 0: driver's right; in the pit lane, on the pit lane's own surface
                const x = s.x + fx * a - fy * l, y = s.y + fy * a + fx * l;
                if (s.inPit) return pitY(x, y);
                // Past the verge (a grass bank down to a lower road, beside hairpins and crossings) the drawn ground is the
                // terrain grid, which can sit metres below the road: stand on it, not in the air at road height
                if (terrainAt && !onPit(elev, x, y, 2 * scale) && !onVerge(elev, vergeR, x, y)) return terrainAt(x, y) * scale * ELEVATION_SCALE - ROAD_DRAW_Y;
                return roadY(x, y, s.angle, car.roadI);
            };
            const fl = at(ax, -tw), fr = at(ax, tw), rl = at(-ax, -tw), rr = at(-ax, tw);
            r.position.y = (fl + fr + rl + rr) / 4 + ROAD_DRAW_Y; // tyres on the drawn asphalt, not 10 cm into it
            r.rotation.z = Math.atan((fl + fr - rl - rr) / 2 / (2 * ax)); // nose up on a climb (+z lifts the +x nose)
            r.rotation.x = Math.atan((fl + rl - fr - rr) / 2 / (2 * tw)); // right side lower: lean right (+x tips +y to +z)
        }
        if (!(elev && elev.z)) r.position.y = ROAD_DRAW_Y;
        if (s.stopPhase === 'service') r.position.y += LIFT_M * scale; // the jacks lift the car for the wheel change
        const far = camera.position.distanceTo(r.position) > 300 * scale; // wheels unreadable that far: 4 fewer draws per car
        for (const w of car.wheels) w.userData.show = !far;
        for (const w of car.wheels) w.rotation.z -= (s.speed / (WHEEL_RADIUS_M * scale)) * dt;
        // +steer turns toward +z (right); a +y rotation points the wheel toward -z, so negate
        car.wheels[0] && (car.wheels[0].rotation.y = -(s.steer || 0)); // wheel_FL
        car.wheels[1] && (car.wheels[1].rotation.y = -(s.steer || 0)); // wheel_FR
        if (car.tag) {
            const m = camera.position.distanceTo(r.position) / scale;
            const fade = Math.min(1, Math.max(0, (TAG_GONE_M - m) / (TAG_GONE_M - TAG_FULL_M)));
            car.tag.visible = fade > 0;
            car.tag.material.opacity = fade;
        }
        const ghost = !!s.ghost && id !== clientState.me;
        if (ghost !== car.ghost) {
            car.ghost = ghost;
            car.root.traverse((o) => {
                if (!o.material || o.isSprite) return;
                o.material.transparent = ghost;
                o.material.opacity = ghost ? 0.5 : 1;
                o.material.needsUpdate = true; // transparency changes the shader; only runs when ghost flips
            });
        }
    }
}

// Own car: predicted (zero input delay). Others: adaptive interpolation delay, Hermite curves, dead reckoning.
const renderClock = new RenderClock(), carPose = new Map(), carState = new Map(), ownPose = {}; // reused every frame
let othersMode = 'present';
const presentClock = new RenderClock(); // 'present' mode time: server now, eased so packet jitter doesn't shake cars
function applyNet(nowS, dt) {
    const myIdx = clientState.netIndex[clientState.me];
    for (const [raw, at] of clientState.netIn.splice(0)) {
        const pkt = raw instanceof ArrayBuffer ? decodeFast(raw) : raw;
        if (!pkt || !netBuf.push(pkt, at) || !predictor || myIdx === undefined) continue; // duplicate / stale: dropped
        const mine = netBuf.latest().s === pkt.s && netBuf.latest().cars.get(myIdx);
        if (mine) predictor.onServer(mine, pkt.s);
    }
    const latest = netBuf.latest(), gs = clientState.gameState;
    if (!latest || !gs) return;
    const serverT = netBuf.serverNow(nowS);
    const renderT = renderClock.advance(dt, serverT, netBuf.targetDelayS());
    const presentT = presentClock.advance(dt, serverT, 0);
    const gameT = netBuf.gameTime(serverT);
    for (const id in gs) {
        const i = clientState.netIndex[id];
        if (i === undefined) continue;
        const p = gs[id];
        let pose;
        if (id === clientState.me && predictor && predictor.car) {
            pose = predictor.pose(simAcc / STEP_S, ownPose);
            const e = latest.cars.get(i);
            if (e) decodeFlags(e[6], p);
            p.stopPhase = predictor.car.stop?.phase || null;
        } else {
            let out = carPose.get(i), st = carState.get(i);
            if (!out) { out = {}; st = {}; carPose.set(i, out); carState.set(i, st); }
            // 'present': where the server has them now (matches the hitbox); 'smooth': interpolated, slightly behind
            pose = othersMode === 'smooth' ? sample(netBuf, renderT, i, out, st, scale) : samplePresent(netBuf, presentT, i, out, st, scale);
            if (!pose) continue;
            decodeFlags(pose.flags, p);
            p.stopPhase = STOP_PHASES[latest.cars.get(i)?.[12] || 0] || null; // pit stop phase, for the crew
        }
        p.x = pose.x; p.y = pose.y; p.angle = pose.angle; p.speed = pose.speed; p.steer = pose.steer;
        p.curLap = p.lapStart === null || p.lapStart === undefined || p.finished ? null : Math.max(0, gameT - p.lapStart);
    }
    const n = window.lanraceNet || (window.lanraceNet = {}); // F3 overlay readings
    n.delayMs = netBuf.targetDelayS() * 1000;
    n.jitterMs = netBuf.jitterS * 1000;
    n.lossPct = netBuf.expected ? Math.max(0, 100 * (1 - netBuf.received / netBuf.expected)) : 0;
    n.predErrCm = predictor && predictor.car ? (predictor.lastError / scale) * 100 : null;
}

// All wheels of all cars in two instanced draws (tyre, rim); each frame copies every wheel part's world matrix
const compoundColor = Object.fromEntries(Object.entries(COMPOUND_COLORS).map(([c, hex]) => [c, new THREE.Color(hex)]));
let wheelBatch = null; // [{ mesh: InstancedMesh }] per wheel sub-mesh, built from the car model
function updateWheelBatch() {
    if (!carTemplate) return;
    if (!wheelBatch) {
        const parts = [];
        carTemplate.getObjectByName('wheel_FL')?.traverse((o) => { if (o.isMesh) parts.push(o); });
        wheelBatch = parts.map((part) => {
            const mesh = new THREE.InstancedMesh(part.geometry, part.material, 4 * 24);
            mesh.frustumCulled = false;
            mesh.castShadow = true; // tyres shadow the track like the body does
            mesh.count = 0;
            world.add(mesh);
            return mesh;
        });
    }
    world.updateMatrixWorld();
    const counts = wheelBatch.map(() => 0);
    for (const id in cars) {
        for (const w of cars[id].wheels) {
            if (!w.parent || !w.userData.show) continue;
            let k = 0;
            w.traverse((o) => {
                if (!o.isMesh || k >= wheelBatch.length) return;
                const mesh = wheelBatch[k++];
                const i = counts[k - 1];
                if (i >= mesh.instanceMatrix.count) return;
                mesh.setMatrixAt(i, o.matrixWorld);
                counts[k - 1]++;
                if (k !== 1) return;
                const band = compoundColor[clientState.gameState?.[id]?.compound] || compoundColor.M; // tyre part carries the compound
                mesh.setColorAt(i, band);
            });
        }
    }
    wheelBatch.forEach((mesh, k) => { mesh.count = counts[k]; mesh.instanceMatrix.needsUpdate = true; });
    if (wheelBatch[0].instanceColor) wheelBatch[0].instanceColor.needsUpdate = true;
}

// ---------- camera ----------
const look = new THREE.Vector3(), pitCam = new THREE.Vector3();
const eyeTurn = new THREE.Quaternion(), eyeEuler = new THREE.Euler();
const PIT_CAM_AHEAD_M = 7, PIT_CAM_SIDE_M = 4, PIT_CAM_UP_M = 3.4;
let camHeading = 0, pitBlend = 0; // pitBlend: 0 = chase camera, 1 = TV pit camera

function rankedCarIds() {
    const gs = clientState.gameState || {};
    return Object.keys(gs).filter((id) => cars[id]).sort((a, b) => gs[a].rank - gs[b].rank);
}

function followedCar() {
    if (!watching()) return cars[clientState.me];
    if (isSpectator()) spectateId = stepFollow(rankedCarIds(), spectateId, 0); // after finishing, watchingAfterFinish picked it
    return spectateId ? cars[spectateId] : null;
}

function updateCamera(dt) {
    const car = followedCar();
    if (!car) { activeView = 'chase'; onboardCar = null; window.lanraceView = activeView; return; }
    const p = car.root.position;
    // Camera sits exactly behind the car; only its swing round corners is smoothed
    const target = -car.root.rotation.y; // back to server heading
    if (snapCamera) { camHeading = target; snapCamera = false; }
    const d = target - camHeading;
    camHeading += Math.atan2(Math.sin(d), Math.cos(d)) * (1 - Math.exp(-CAM_TURN_SMOOTH * dt));
    const h = camHeading;
    const v = onboard(view) && car.model ? view : 'chase'; // box fallback car: chase
    if (camera.fov !== VIEW_FOV[v]) { camera.fov = VIEW_FOV[v]; camera.updateProjectionMatrix(); }
    if (v === 'chase') {
        // Height: the road behind the car (so the camera rises before a crest, not into it), never below the car's own level
        const bx = p.x - Math.cos(h) * CHASE_BACK_M * scale, bz = p.z - Math.sin(h) * CHASE_BACK_M * scale;
        camera.position.set(bx, Math.max(p.y, roadY(bx, bz, h)) + CHASE_UP_M * scale, bz);
        look.set(p.x + Math.cos(h) * LOOK_AHEAD_M * scale, p.y + 1 * scale, p.z + Math.sin(h) * LOOK_AHEAD_M * scale);
    } else {
        // Bolted to the car: its heading, pitch and roll, no smoothing (TV onboards and the F1 games look like this)
        car.root.updateMatrixWorld();
        camera.position.set(...toThree(EYE[v])).multiplyScalar(scale).applyMatrix4(car.root.matrixWorld);
        car.root.getWorldQuaternion(camera.quaternion).multiply(eyeTurn.setFromEuler(eyeEuler.set(EYE_TILT[v], -Math.PI / 2, 0, 'YXZ'))); // camera -z → car +x
        look.set(0, 0, -10 * scale).applyQuaternion(camera.quaternion).add(camera.position);
    }
    // TV pit camera: while your own car is serviced, ease from the current pose to the garage side of its box
    const own = car === cars[clientState.me] && !isSpectator(), ph = predictor?.car?.stop?.phase, box = predictor?.box, td = clientState.trackData;
    pitBlend += ((own && box && td?.pit && (ph === 'service' || ph === 'hold' || ph === 'wait') ? 1 : 0) - pitBlend) * (1 - Math.exp(-dt * 3));
    if (!own) pitBlend = 0;
    if (pitBlend > 0.001 && box && td?.pit) {
        // front quarter from the working lane (7 m ahead, 4 m to the garage side): car, crew and lit garage in one frame
        const c = side(box, box.angle, -td.pit.trackSide * PIT_CAM_SIDE_M * scale), ca = Math.cos(box.angle) * PIT_CAM_AHEAD_M * scale, sa = Math.sin(box.angle) * PIT_CAM_AHEAD_M * scale;
        camera.position.lerp(pitCam.set(c.x + ca, pitY(box.x, box.y) + PIT_CAM_UP_M * scale, c.y + sa), pitBlend);
        look.lerp(p, pitBlend);
    }
    if (v === 'chase' || pitBlend > 0.001) camera.lookAt(look); // onboard keeps the car's roll
    // The close-range pass: off for the pit camera (it's metres away, the crew can stand in front of the car)
    const layeredNow = v !== 'chase' && pitBlend <= 0.001;
    activeView = layeredNow ? v : 'chase';
    onboardCar = layeredNow ? car : null;
    window.lanraceView = activeView;
    document.body.classList.toggle('view-cockpit', activeView === 'cockpit'); // the wheel's display replaces the dash's gear and revs
    if (layeredNow) { // the wheel shows from both onboard views (T-cam looks down into the cockpit)
        steeringWheel ||= buildSteeringWheel(document.createElement('canvas'));
        if (steeringWheel.root.parent !== car.model) {
            car.model.add(steeringWheel.root);
            steeringWheel.setGlove(teamInfo[car.teamId]?.chatColor || '#e10600');
        }
        steeringWheel.root.visible = true;
        steeringWheel.spin.rotation.x = wheelAngle(clientState.gameState?.[car.id]?.steer);
    } else if (steeringWheel) steeringWheel.root.visible = false;
}

// ---------- HUD + minimap ----------
const kmh = (speed) => Math.round((Math.abs(speed) / scale) * 3.6);
const lapLabel = (lap) => Math.min(lap + 1, clientState.settings.maxLaps);
const $ = (id) => document.getElementById(id);

function fmtTime(s) {
    if (s === null || s === undefined) return '--';
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}
function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

window.handleLights = (count) => {
    Sound.event(count > 0 ? 'beep' : 'lights_out');
    const el = $('lights');
    el.classList.remove('hidden');
    el.querySelectorAll('.light').forEach((l, i) => l.classList.toggle('on', i < count));
    if (count === 0) setTimeout(() => el.classList.add('hidden'), 1500);
};

window.showQualiResults = (list) => {
    const ol = $('quali-results-list');
    ol.innerHTML = '';
    const pole = list[0]?.bestLap;
    for (const r of list) {
        const lp = driverOf(r.id);
        const li = document.createElement('li');
        const gap = r.position > 1 && r.bestLap !== null && pole !== null ? `  +${(r.bestLap - pole).toFixed(3)}` : '';
        li.textContent = `P${r.position}  ${lp ? lp.username : '—'}${driverTags(lp) ? ' · ' + driverTags(lp) : ''}  ${r.bestLap === null ? 'no time' : fmtTime(r.bestLap)}${gap}`;
        ol.appendChild(li);
    }
};

// Final classification for everyone: times include penalties; ▲/▼ = places won or lost to penalties
let rrTimer = null;
window.showRaceResults = (res) => {
    const ol = $('rr-list');
    ol.innerHTML = '';
    $('rr-track').textContent = (clientState.trackData?.name || '').toUpperCase();
    const span = (cls, text = '') => Object.assign(document.createElement('span'), { className: cls, textContent: text });
    for (const r of res.rows) {
        const lp = driverOf(r.id) || clientState.gameState?.[r.id], c = resultCells(r, fmtTime);
        const li = document.createElement('li');
        li.className = (r.id === clientState.me ? 'me ' : '') + (r.position <= 3 && !r.dnf ? 'podium' : '');
        const team = span('rr-team');
        team.style.background = teamInfo[lp?.teamId]?.chatColor || '#888';
        const best = span('rr-best' + (r.id === res.fastestLapId ? ' fl' : ''), r.bestLap === null ? '—' : fmtTime(r.bestLap));
        if (r.id === res.fastestLapId) best.insertAdjacentHTML('afterbegin', STOPWATCH + ' ');
        li.append(span('rr-pos', r.position), team, span('rr-name', `${lp?.username || '—'}${driverTags(lp) ? ' · ' + driverTags(lp) : ''}`), span('rr-chg ' + c.changeCls, c.change),
            span('rr-laps', r.laps), best, span('rr-pen', c.pen), span('rr-time' + (r.dnf ? ' dnf' : ''), c.time));
        ol.appendChild(li);
    }
    $('race-results').classList.remove('hidden');
    const end = Date.now() + 15000;
    clearInterval(rrTimer);
    const tick = () => {
        const left = Math.ceil((end - Date.now()) / 1000);
        $('rr-count').textContent = left > 0 ? `back to lobby in ${left} s` : 'close with ✕';
        if (left <= 0) clearInterval(rrTimer);
    };
    tick();
    rrTimer = setInterval(tick, 250);
};

$('rr-close').addEventListener('click', () => $('race-results').classList.add('hidden'));

// Host session control: Esc or the HUD's HOST button opens it; a pause shows its card to everyone
let hostPanel = false, restartArmedUntil = 0;
const amHost = () => !!clientState.me && clientState.hostId === clientState.me;
const inSession = () => ['QUALIFYING', 'COUNTDOWN', 'RACE'].includes(clientState.status);
function renderSessionPanel() {
    const paused = !!clientState.paused && !clientState.resuming && inSession(), host = amHost() && inSession(); // the count hides it
    $('hud-host').classList.toggle('hidden', !host);
    if (!host) hostPanel = false;
    const show = paused || hostPanel;
    $('session-panel').classList.toggle('hidden', !show);
    if (!show) return;
    $('hc-title').textContent = paused ? 'PAUSED' : 'SESSION CONTROL';
    $('hc-note').textContent = !paused ? '' : host ? 'The session is paused for everyone.' : 'The host has paused the session.';
    $('hc-note').classList.toggle('hidden', !paused);
    $('hc-close').classList.toggle('hidden', !host);
    $('hc-host').classList.toggle('hidden', !host);
    $('hc-foot').textContent = host ? 'Esc resumes and closes · restart and remove act for everyone' : 'Only the host can resume';
    if (!host) return;
    const pause = $('hc-pause'), armed = performance.now() < restartArmedUntil;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.disabled = !['QUALIFYING', 'RACE'].includes(clientState.status); // not during the start lights
    pause.title = pause.disabled ? 'Pausing is possible once the lights are out' : '';
    $('hc-restart').textContent = armed ? 'Confirm restart' : 'Restart session';
    $('hc-restart').classList.toggle('armed', armed);
    const list = $('hc-drivers');
    list.replaceChildren();
    for (const [id, p] of Object.entries(clientState.players)) {
        if (id === clientState.me) continue;
        const li = document.createElement('li');
        const team = Object.assign(document.createElement('span'), { className: 'rr-team' });
        team.style.background = p.color;
        const name = Object.assign(document.createElement('span'), { className: 'rr-name', textContent: p.username + (p.isSpectating ? ' · spectating' : '') });
        const kick = Object.assign(document.createElement('button'), { className: 'kick-btn', textContent: 'KICK', title: `Remove ${p.username}` });
        kick.addEventListener('click', () => socket.emit('kick_player', id));
        li.append(team, name, kick);
        list.append(li);
    }
    if (!list.children.length) list.append(Object.assign(document.createElement('li'), { className: 'hc-empty', textContent: 'No other drivers' }));
}
window.renderSessionPanel = renderSessionPanel;
// Opening it pauses the session for everyone (once the lights are out); closing it (Esc, ✕, Resume) resumes
const canPause = () => ['QUALIFYING', 'RACE'].includes(clientState.status);
function toggleHostPanel() {
    if (!amHost() || !inSession()) return;
    const held = clientState.paused && !clientState.resuming;
    hostPanel = !(hostPanel || held);
    if (hostPanel) {
        releaseKeys();
        if (canPause() && !held) socket.emit('pause_session', true); // also calls off a resume count under way
    } else if (held) socket.emit('pause_session', false); // the server counts everyone in, then resumes
    renderSessionPanel();
}
$('hud-host').addEventListener('click', toggleHostPanel);
$('hc-close').addEventListener('click', toggleHostPanel);
$('hc-pause').addEventListener('click', () => {
    if (clientState.paused) toggleHostPanel(); // Resume: back to racing, menu closed
    else socket.emit('pause_session', true);
});
$('hc-restart').addEventListener('click', () => {
    if (performance.now() < restartArmedUntil) { // second click: it throws the session away, so it takes two
        restartArmedUntil = 0;
        hostPanel = false;
        socket.emit('restart_session');
    } else {
        restartArmedUntil = performance.now() + 4000;
        setTimeout(renderSessionPanel, 4000);
    }
    renderSessionPanel();
});
// Pause: your car stops being predicted and driven, engines go quiet; resume relearns the server clock (it stood still)
window.onPaused = (paused) => {
    if (paused) {
        for (const k in keys) keys[k] = false;
        input = { throttle: 0, brake: 0, steer: 0, drs: false };
    } else {
        netBuf.reset();
        clientState.netIn = [];
        simAcc = 0;
    }
    resumeCount(paused || !inSession() ? null : 'GO');
    renderSessionPanel();
};
// The host's resume: GET READY 3 · 2 · 1 for everyone (beeps like the start lights; hold your throttle), GO as the cars
// are let go. Keys pressed during the count are kept, so you can be on the throttle at GO
let countTimer = null;
function resumeCount(show) {
    clearTimeout(countTimer);
    const el = $('countdown-overlay'), txt = $('countdown-text'), label = $('countdown-label');
    if (show === null) { el.classList.add('hidden'); label.classList.add('hidden'); el.classList.remove('resume', 'go'); return; }
    const go = show === 'GO';
    Sound.event(go ? 'lights_out' : 'beep');
    txt.textContent = show;
    label.classList.toggle('hidden', go);
    el.classList.remove('hidden', 'tick');
    el.classList.add('resume');
    el.classList.toggle('go', go);
    void el.offsetWidth; // restart the pop for every number
    el.classList.add('tick');
    countTimer = go ? setTimeout(() => resumeCount(null), 900) : show > 1 ? setTimeout(() => resumeCount(show - 1), 1000) : null;
}
window.onResuming = (seconds) => {
    hostPanel = false;
    renderSessionPanel();
    resumeCount(seconds);
};

let flashTimer = null, bannerTimer = null;
window.showSectorFlash = (n, time, delta, cls) => {
    const el = $('sector-flash');
    el.textContent = `S${n} ${time.toFixed(3)}` + (delta === null ? '' : `  ${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(3)}`);
    el.className = cls;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.add('hidden'), 2000);
};
// Every driver's sectors on the lap they're on (quali timing tower), keyed by player id
const liveSec = {};
window.onSectorAll = (s) => { liveSectors(liveSec, s); };
const STOPWATCH = document.querySelector('#fl-card .stopwatch').outerHTML;
// Driver help badges: B = braking help (Low or High), S = steering help
const helpTags = (a) => (a ? `${a.brake > 0 ? 'B' : ''}${a.steer > 0 ? 'S' : ''}` : '');
const driverTags = (lp) => (lp?.isBot ? 'AI' : helpTags(lp?.assist)); // AI drivers say so instead of their help levels
const codeOf = (id) => { const lp = driverOf(id); return lp ? driverCode(lp.username) : '---'; };

// F1 TV-style purple card when anyone sets the session's fastest lap
let flTimer;
window.showFastestLap = (fl) => {
    const card = $('fl-card'), lp = driverOf(fl.id);
    card.querySelector('.fl-team').style.background = teamInfo[lp?.teamId]?.chatColor || '#888';
    card.querySelector('.fl-name').textContent = lp ? lp.username : '—';
    card.querySelector('.fl-time').textContent = fmtTime(fl.time);
    card.querySelector('.fl-lap').textContent = `LAP ${fl.lap}`;
    card.classList.remove('hidden');
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; // replay the slide-in
    clearTimeout(flTimer);
    flTimer = setTimeout(() => card.classList.add('hidden'), 6000);
};

window.showBanner = (text, good = false) => {
    const el = $('race-msg');
    el.textContent = text;
    el.className = good ? 'good' : '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.add('hidden'), 3000);
};

let stewardTimer = null;
window.showSteward = (e) => {
    stewardAtS = performance.now() / 1000;
    if (e.kind === 'hit' || e.kind === 'collision' || e.kind === 'incident') contactAtS = stewardAtS; // track-limits cards must not silence a corner
    const t = stewardText(e);
    if (!t) return;
    $('sc-head').textContent = t.head;
    $('sc-tip').textContent = t.tip;
    $('sc-tip').classList.toggle('hidden', !t.tip);
    $('steward-card').className = t.tone;
    clearTimeout(stewardTimer);
    stewardTimer = setTimeout(() => $('steward-card').classList.add('hidden'), 4000);
};

function updateHUD(withTower = true) {
    const gs = clientState.gameState;
    const me = gs[clientState.me];
    const racing = me && !isSpectator();
    const fastest = clientState.fastestLap?.time ?? Infinity; // the server's session fastest lap (kept if its holder leaves)
    const sec = (s) => sectorClass(s, clientState.sessionBest, clientState.sessionBestIds); // live: purple → green when beaten

    const ghostOn = !!(racing && clientState.status === 'RACE' && me.ghost && clientState.settings?.collisions !== false);
    if (ghostOn !== hudGhost) { hudGhost = ghostOn; $('ghost-tag').classList.toggle('hidden', !ghostOn); }
    $('hud-total').innerText = Object.keys(gs).length;
    // Finished and watching: say whose car is on screen and how to switch
    const w = watchingAfterFinish(), wo = $('watch-overlay');
    wo.classList.toggle('hidden', !w);
    if (w) $('watch-name').textContent = driverOf(spectateId)?.username || '';
    $('hud-rank').innerText = racing ? me.rank : '--';
    $('hud-lap').innerText = racing ? lapLabel(me.lap) : '--';
    $('hud-laps').textContent = racing && clientState.status !== 'QUALIFYING' ? `/${clientState.settings.maxLaps}` : '';
    $('hud-speed').innerText = racing ? kmh(me.speed) : '--';

    // Own lap times: purple while it's the session fastest, green once beaten (still your personal best)
    const curEl = $('lt-current');
    curEl.innerText = racing ? fmtTime(me.curLap) : '--';
    curEl.classList.toggle('t-red', !!racing && me.lapValid === false);
    const lastEl = $('lt-last');
    const deleted = !!racing && me.lastValid === false;
    lastEl.innerText = racing ? fmtTime(me.lastLap) + (deleted ? (clientState.status === 'RACE' || clientState.status === 'FINISHED' ? ' NOT COUNTED' : ' DELETED') : '') : '--';
    const lastCls = racing ? lastLapClass(me.lastLap, me.bestLap, clientState.fastestLap?.time, deleted) : '';
    for (const c of ['t-red', 't-purple', 't-green']) lastEl.classList.toggle(c, c === lastCls);
    $('lt-best').innerText = racing ? fmtTime(me.bestLap) : '--';
    const delta = racing && !deleted ? lapDelta(me.lastLap, me.bestLap) : null;
    $('lt-delta').textContent = delta ? delta.text : '';
    $('lt-delta').className = delta ? delta.cls : '';
    for (let i = 0; i < 3; i++) {
        const el = $(`sec-${i + 1}`), s = racing ? clientState.mySectors[i] : null;
        el.children[1].textContent = s ? s.time.toFixed(3) : `S${i + 1}`;
        el.className = `sec ${s ? sec(s) : ''}`;
        const best = clientState.sessionBest[i]; // purple sector: the session's best and who holds it
        el.lastElementChild.textContent = best === null ? '' : `${best.toFixed(3)} ${codeOf(clientState.sessionBestIds[i])}`;
    }
    const fl = clientState.fastestLap;
    $('lt-fl').textContent = fl ? fmtTime(fl.time) : '--';
    $('lt-fl-who').textContent = fl ? codeOf(fl.id) : '';
    document.querySelector('.lt-fl').classList.toggle('hidden', !fl); // no empty row until someone has set a lap

    // Session bar
    const sess = clientState.session;
    let bar = '';
    if (clientState.status === 'QUALIFYING' && sess && !clientState.qualiClock) { // old servers; the quali clock (#quali-clock) replaces it
        bar = `QUALIFYING ${fmtClock(sess.endsAt - (clientState.pausedAt ?? Date.now()))}`; // frozen while paused
        if (racing) bar += me.finished ? ` · QUALIFYING COMPLETE — P${me.rank}` : me.curLap === null ? (me.inPit ? ' · PIT LANE' : ' · OUT LAP') : ` · LAP ${me.lap + 1}/${clientState.settings.qualiLaps ?? 2}`;
    } else if (clientState.status === 'RACE' || clientState.status === 'FINISHED') {
        const leader = Object.values(gs).find(p => p.rank === 1);
        const lap = racing ? me.lap : leader ? leader.lap : 0;
        if (!racing) bar = `LAP ${lapLabel(lap)}/${clientState.settings.maxLaps}`; // racing: it's in the LAP box
    }
    $('session-bar').textContent = bar;
    $('pit-limiter').classList.toggle('hidden', !(racing && me.limiter));
    const wear = predictor?.car?.wear ?? 0;
    const comp = me?.compound || 'M', next = me?.nextCompound || '';
    const car = predictor?.car, box = predictor?.box, td = clientState.trackData;
    let toEntryM = Infinity;
    if (car && td?.pit && !me?.inPit) {
        pickIdx = trackIndex(td.path, car.x, car.y, pickIdx, td.width);
        const total = td.cum[td.path.length];
        toEntryM = ((((td.pit.entryS - td.cum[pickIdx]) % total) + total) % total) / td.scale;
    }
    const speedMs = car && td ? Math.hypot(car.vx, car.vy) / td.scale : 0, phase = car?.stop?.phase || null;
    const parked = !!car && !!box && !!td && !!me?.inPit && Math.abs((box.s - (car.pitS || 0)) / td.scale) < 0.5 && speedMs < 0.5; // server PARK_M 0.5 m
    const spectator = isSpectator();
    const open = pickerOpen({ spectator, status: clientState.status, inPit: !!me?.inPit, parked, toEntryM, phase, boxCall: me?.boxCall || null });
    const fitted = !!lastPick && lastPick === comp && (clientState.status === 'COUNTDOWN' || phase === 'wait'), wearPct = Math.round((1 - wear) * 100);
    const pickKey = `${comp}${next}${open}${fitted}${lastPick}${spectator}${wearPct}${me?.boxCall}${clientState.status}`;
    if (pickKey !== hudPick) {
        hudPick = pickKey;
        const t = cardText({ compound: comp, next, fitted });
        $('tyre-card').classList.toggle('hidden', spectator);
        $('tc-tyre').className = `tc-tyre tyre-${comp}${wearPct < 20 ? ' worn' : ''}`;
        $('tc-tyre').style.setProperty('--wear', wearPct);
        $('tc-tyre').firstElementChild.textContent = comp;
        $('tc-wear').textContent = `${wearPct} %`;
        $('tc-next').textContent = me?.boxCall ? `${me.boxCall === 'next' ? 'BOX NEXT LAP' : 'BOX THIS LAP'} · ${t.next}` : t.next;
        $('tc-box').classList.toggle('hidden', clientState.status !== 'RACE' || spectator);
        $('tc-box').classList.toggle('on', !!me?.boxCall);
        $('tc-pick').classList.toggle('hidden', !open);
        $('tc-confirm').textContent = t.confirm || '';
        $('tc-confirm').classList.toggle('hidden', !t.confirm);
        const on = fitted ? comp : next;
        tcBtns.forEach((b) => b.classList.toggle('on', b.dataset.c === on));
    }
    // "Box, box": banners on call / pick / cancel; the entry stripe and distance while the entry is near
    const bc = racing ? me?.boxCall || null : null, nowB = performance.now();
    if (bc && !hudBox) { window.showBanner?.('BOX, BOX — CHOOSE TYRES', true); Sound.event('drs'); boxConfirmAt = nowB + 3000; boxPick = null; }
    else if (!bc && hudBox && !['lane', 'guide', 'service'].includes(predictor?.car?.stop?.phase)) { window.showBanner?.('BOX CANCELLED'); boxConfirmAt = 0; }
    if (bc && boxConfirmAt && nowB >= boxConfirmAt) { boxConfirmAt = 0; window.showBanner?.(boxBanner(bc, boxPick || me.nextCompound || nextHarder(me.compound)), true); }
    hudBox = bc;
    const entryNear = bc === 'this' && !me?.inPit && toEntryM <= 300;
    if (entryGuide) entryGuide.visible = entryNear;
    const cue = entryNear ? `PIT ENTRY ${Math.round(toEntryM / 10) * 10} m` : '';
    if ($('entry-cue').textContent !== cue) { $('entry-cue').textContent = cue; $('entry-cue').classList.toggle('hidden', !cue); }
    const st = predictor?.car?.stop, atBox = !!st && (st.phase === 'guide' || st.phase === 'service' || st.phase === 'hold');
    if (hudHadStop && !atBox && racing && st?.phase === 'out') { hudGoUntil = performance.now() + 800; } // released: GO stays up a moment as the car pulls away
    hudHadStop = atBox;
    const go = performance.now() < hudGoUntil;
    $('box-msg').classList.toggle('hidden', !(racing && (atBox || go)));
    // hold: GO = press throttle now for a perfect release; HOLD while still held (jumped release, car passing behind: st.t left)
    if (atBox) $('box-msg').textContent = st.phase === 'service' ? `BOX — ${Math.max(0, st.t).toFixed(1)} s` : st.phase === 'hold' ? (st.t > 0 ? 'HOLD' : 'GO') : 'BOX';
    else if (go) $('box-msg').textContent = 'GO';
    // Pit banner: PIT ASSIST on entering lane/out, the stop time on a new lastStop, YOUR CAR when the exit drive ends
    const ls = me?.lastStop, lsKey = ls ? `${ls.n}|${ls.s}|${ls.release}` : null, now = performance.now(), bannerFor = (txt, ms) => { bannerText = txt; bannerUntil = now + ms; };
    if (hudLastStop !== undefined && lsKey && lsKey !== hudLastStop) bannerFor(`PIT STOP ${ls.s.toFixed(2)} s${ls.release === 'perfect' ? '\nPERFECT RELEASE' : ls.release === 'jumped' ? '\nJUMPED +0.5 s' : ''}`, 3000);
    hudLastStop = lsKey;
    if ((!hudPrevPhase || hudPrevPhase === 'wait') && (phase === 'lane' || phase === 'out')) bannerFor('PIT ASSIST', 1500); // wait: a quali car leaving its garage
    else if (hudPrevPhase === 'out' && !phase) bannerFor('YOUR CAR', 1200);
    if (phase !== hudPrevPhase) lastPick = null;
    hudPrevPhase = phase;
    const bannerOn = racing && now < bannerUntil, bt = bannerOn ? bannerText : '';
    if ($('pit-banner').textContent !== bt) $('pit-banner').textContent = bt;
    $('pit-banner').classList.toggle('hidden', !bannerOn);
    updateBoxRing(me, racing, toEntryM);
    $('drs-badge').className = !racing ? 'drs-off' : me.drs ? 'drs-open' : me.drsAvailable ? 'drs-avail' : 'drs-off';
    let hint = '';
    if (racing && clientState.trackData) {
        const t = clientState.trackData, total = t.cum[t.path.length];
        drsIdx = trackIndex(t.path, me.x, me.y, drsIdx, t.width);
        const lapS = (((t.cum[drsIdx] - (t.startS || 0)) % total) + total) % total;
        hint = drsHint({ mode: clientState.status === 'QUALIFYING' ? 'quali' : 'race', inPit: me.inPit, drs: me.drs, drsAvailable: me.drsAvailable, lap: me.lap, inZone: inDrsZone(t.drsZones || [], lapS) });
    }
    $('drs-hint').textContent = hint;
    const cCar = predictor?.car, st2 = clientState.status;
    if (coach && coachOn && racing && cCar && !me.finished && (st2 === 'RACE' || st2 === 'QUALIFYING')) {
        const t = clientState.trackData, sc = t.scale, now = performance.now() / 1000;
        coachIdx = trackIndex(t.path, cCar.x, cCar.y, coachIdx, 30 * sc);
        const near = [];
        for (const id in gs) { const o = gs[id]; if (id !== clientState.me && o && !o.finished && o.x !== undefined) near.push({ x: o.x, y: o.y }); }
        const total = t.cum[t.path.length], lapS = (((t.cum[coachIdx] - (t.startS || 0)) % total) + total) % total;
        const msg = coach.update({ t: now, i: coachIdx, x: cCar.x, y: cCar.y, angle: cCar.angle, speed: (cCar.speed || 0) / sc, brake: input.brake || 0,
            assistBrake: !!cCar.assistBrake, tow: cCar.tow || 0, inPit: !!me.inPit, ghostOverlap: !!me.ghost && near.some((o) => Math.hypot(o.x - cCar.x, o.y - cCar.y) < 5.5 * sc),
            wide: pastLine(t, coachIdx, cCar.x, cCar.y), lap: me.lap, mode: st2 === 'QUALIFYING' ? 'quali' : 'race', stewardAt: stewardAtS, contactAt: contactAtS, near,
            drsAvailable: !!me.drsAvailable, inDrsZone: inDrsZone(t.drsZones || [], lapS), drsOpen: !!me.drs, helpLevel: parseAssist(predictor.assist).brake });
        if (msg) {
            const el = $('coach-line');
            el.textContent = msg.text;
            el.className = msg.tone;
            clearTimeout(coachTimer);
            coachTimer = setTimeout(() => el.classList.add('hidden'), SHOW_S * 1000);
        }
    }

    // Qualifying: session clock and the knocked-out chip
    const qc = clientState.qualiClock, inQuali = clientState.status === 'QUALIFYING' && !!qc;
    const onTimed = me?.lapStart !== null && me?.lapStart !== undefined;
    const runState = !racing || me?.qualiOut || qc?.qphase === 'flag' || qc?.format === 'oneshot' ? '' : onTimed ? ' · PUSH LAP' : me?.inPit ? ' · PIT LANE' : ' · OUT LAP';
    const clockStr = inQuali ? clockText({ ...qc, endsInMs: clockLeftMs(qc, performance.now()) }, { onTimedLap: onTimed }) + runState : '';
    if (clockStr !== hudQClock) {
        hudQClock = clockStr;
        const el = $('quali-clock');
        el.textContent = clockStr;
        el.className = !clockStr ? 'hidden' : qc.qphase === 'flag' ? 'flag' : qc.qphase === 'running' && qc.format !== 'oneshot' && clockLeftMs(qc, performance.now()) < 60000 ? 'low' : '';
    }
    const ko = inQuali && me?.qualiOut ? `KNOCKED OUT${koPos ? ' — P' + koPos : ''}` : '';
    if ($('ko-chip').textContent !== ko) { $('ko-chip').textContent = ko; $('ko-chip').classList.toggle('hidden', !ko); }

    if (withTower) {
        // Timing tower
        const quali = clientState.status === 'QUALIFYING' || clientState.status === 'QUALI_RESULTS'; // ghosts also mean collisions off
        const ol = $('leaderboard-list');
        ol.innerHTML = '';
        const sorted = Object.entries(gs).filter(([id]) => driverOf(id)).sort((a, b) => a[1].rank - b[1].rank);
        const rows = sorted.map(([, p]) => ({ gap: p.gap, lapsDown: p.lapsDown || 0 }));
        const codes = sorted.map(([id]) => driverCode(driverOf(id).username));
        const el = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
        // Top 10, or top 9 plus your own row when you're further back
        const mine = sorted.findIndex(([id]) => id === clientState.me);
        const shown = mine >= 10 ? [...sorted.keys()].slice(0, 9).concat(mine) : [...sorted.keys()].slice(0, 10);
        shown.forEach((i, n) => {
            const [id, p] = sorted[i];
            const lp = driverOf(id);
            const li = el('li', (id === clientState.me ? 'me' : '') + (n > 0 && i !== shown[n - 1] + 1 ? ' gapline' : ''));
            const team = el('span', 'tt-team');
            team.style.background = teamInfo[lp.teamId]?.chatColor || '#888';
            // Three-letter code like the TV graphic, unless two drivers share it
            const name = el('span', 'tt-name', codes.indexOf(codes[i]) !== codes.lastIndexOf(codes[i]) ? lp.username.slice(0, 8) : codes[i]);
            li.append(el('span', 'tt-pos', p.rank), team, name);
            if (p.inPit && !quali) li.append(el('span', 'tt-tag', 'PIT'));
            if (p.compound) li.append(el('span', `tt-tyre tyre-${p.compound}`, `${p.compound}${p.stops ? ' ' + p.stops : ''}`));
            const tags = driverTags(lp); if (tags) li.append(el('span', 'tt-tag help', tags));
            if (p.penalty) li.append(el('span', 'tt-tag pen', `+${p.penalty}s`));
            if (!quali && p.boxCall) li.append(el('span', 'tt-tag box', 'BOX'));
            if (quali && p.qualiOut) { li.classList.add('out'); li.append(el('span', 'tt-tag out', 'OUT')); }
            else if (quali && p.rank > (clientState.qualiClock?.survive ?? Infinity)) li.classList.add('drop'); // knock-out zone
            if (clientState.fastestLap?.id === id) { // purple stopwatch: fastest lap of the session
                const fl = el('span', 'tt-fl');
                fl.innerHTML = STOPWATCH;
                li.append(fl);
            }
            const gap = gapText(rows, i, towerMode);
            const time = el('span', 'tt-gap');
            if (quali) {
                time.textContent = gap ? gap : fmtTime(p.bestLap);
                if (p.bestLap !== null && clientState.fastestLap?.id === id && p.bestLap <= fastest + 1e-9) time.classList.add('t-purple');
                const bars = el('span', 'tt-sectors');
                // On a timed lap: live bars for this lap (purple / green / yellow / grey); otherwise their best lap's sectors
                const live = p.lapStart !== null && p.lapStart !== undefined && liveSec[id];
                if (live) live.forEach((s) => bars.appendChild(el('i', s ? sec(s).replace('sec-', 'sb-') : '')));
                else (p.bestLapSectors || [null, null, null]).forEach((s, k) => { // their best lap: green unless they still hold purple
                    if (s === null) return bars.appendChild(el('i', ''));
                    bars.appendChild(el('i', sec({ id, sector: k + 1, time: s, valid: true, personalBest: true }).replace('sec-', 'sb-')));
                });
                li.append(bars);
            } else if (i === 0) {
                time.textContent = p.finished ? 'WINNER' : 'LEADER';
                time.classList.add('lead');
            } else {
                time.textContent = gap;
            }
            li.append(time);
            ol.appendChild(li);
        });
    }
}

function drawMinimap() {
    const t = clientState.trackData, gs = clientState.gameState;
    // The card takes the track's shape (a wide track: a wide, short card), long side 13em; the track centred in it
    const pad = 14, dx = bounds.maxX - bounds.minX, dy = bounds.maxY - bounds.minY, aspect = Math.max(0.6, Math.min(1.8, dx / dy));
    if (minimap.dataset.track !== t.id) {
        minimap.dataset.track = t.id;
        const LONG = 260, w = aspect >= 1 ? LONG : Math.round(LONG * aspect), h = aspect >= 1 ? Math.round(LONG / aspect) : LONG;
        minimap.width = w; minimap.height = h;
        minimap.style.width = `${(13 * w) / LONG}em`; minimap.style.height = `${(13 * h) / LONG}em`;
    }
    const W = minimap.width, H = minimap.height, k = Math.min((W - 2 * pad) / dx, (H - 2 * pad) / dy);
    const ox = (W - dx * k) / 2, oy = (H - dy * k) / 2;
    const mx = (x) => ox + (x - bounds.minX) * k;
    const my = (y) => oy + (y - bounds.minY) * k;

    mm.clearRect(0, 0, W, H);
    if (t.pit) {
        mm.strokeStyle = 'rgba(255,255,255,0.45)';
        mm.lineWidth = 2;
        mm.beginPath();
        t.pit.path
            .forEach((p, i) => (i ? mm.lineTo(mx(p.x), my(p.y)) : mm.moveTo(mx(p.x), my(p.y))));
        mm.stroke();
    }
    mm.strokeStyle = 'rgba(255,255,255,0.85)';
    mm.lineWidth = 4;
    mm.lineJoin = 'round';
    mm.beginPath();
    t.path.forEach((p, i) => (i ? mm.lineTo(mx(p.x), my(p.y)) : mm.moveTo(mx(p.x), my(p.y))));
    mm.closePath();
    mm.stroke();

    for (const id in gs) {
        const lp = driverOf(id);
        if (!lp) continue;
        const isMe = id === clientState.me;
        mm.fillStyle = lp.color;
        mm.beginPath();
        mm.arc(mx(gs[id].x), my(gs[id].y), isMe ? 6 : 4, 0, Math.PI * 2);
        mm.fill();
        if (isMe) { mm.strokeStyle = '#fff'; mm.lineWidth = 2; mm.stroke(); }
    }
}

// ---------- loop ----------
let last = performance.now(), compiling = false;
// F3 / ?stats=1: network and frame-time overlay, refreshed at 4 Hz
const frameMs = [], netstatsEl = document.getElementById('netstats');
let netstatsOn = new URLSearchParams(location.search).has('stats'), lastNetstats = 0;
netstatsEl.classList.toggle('hidden', !netstatsOn);
function drawNetstats() {
    const f = [...frameMs].sort((a, b) => a - b), n = window.lanraceNet || {}, net = clientState.net;
    const fmt = (v, d = 0, u = '') => (v === null || v === undefined ? '—' : v.toFixed(d) + u);
    const mean = f.reduce((a, b) => a + b, 0) / (f.length || 1);
    netstatsEl.textContent =
        `fps ${fmt(1000 / mean)}  frame p95 ${fmt(f[Math.floor((f.length - 1) * 0.95)], 1, 'ms')}  max ${fmt(f.at(-1), 1, 'ms')}\n` +
        `ping ${fmt(net.rttMs, 0, 'ms')}  jitter ${fmt(n.jitterMs, 1, 'ms')}  loss ${fmt(n.lossPct, 1, '%')}  link ${net.link}\n` +
        `interp delay ${fmt(n.delayMs, 0, 'ms')}  prediction error ${fmt(n.predErrCm, 1, 'cm')}\n` +
        `server tick ${fmt(net.tickMs, 2, 'ms')}  input starvation ${net.starve?.[clientState.me] ?? 0}/s`;
}
let fpsFrames = 0, fpsSince = performance.now(), lastHud = 0, lastTower = 0;
const fpsHist = []; let capWarned = false; // steady 30 fps = browser frame cap, told once per page
let autoMs = 0, autoFrames = 0, autoDone = false; // auto-pick: frame time while driving
const stats = new URLSearchParams(location.search).has('stats') ? Object.assign(document.createElement('div'), { id: 'stats' }) : null;
if (stats) document.body.appendChild(stats);
if (stats) window.lanraceDebug = { renderer, scene, camera, freeCam: false }; // ?stats=1: profiling / looking around from the console

// Sound + gear HUD: gearboxes for your car and every other car (cheap), audio frame in metres (track plane)
const ownBox = new Gearbox(), remoteBoxes = new Map(), soundOthers = [];
const ownFrame = { rpm: 0, load: 0, limiter: false, pit: false, speedMs: 0 };
const listenerFrame = { x: 0, y: 0, fx: 1, fy: 0, vx: 0, vy: 0 }, sndFrame = { own: null, others: soundOthers, listener: listenerFrame };
const silentFrame = { own: null, others: [], listener: listenerFrame };
const camDir = new THREE.Vector3();
let hudQClock = '', hudBox = null, lastDrs = false, hudLit = -1, hudFlash = null, hudGear = '', hudPick = '', pickIdx = null, hudHadStop = false, hudGoUntil = 0, hudLastStop, hudPrevPhase = null, hudGhost = false, bannerText = '', bannerUntil = 0;
function updateSound(dt) {
    const gs = clientState.gameState, me = gs[clientState.me], racing = !!me && !isSpectator();
    const followId = racing && !watchingAfterFinish() ? clientState.me : spectateId; // dash and engine: the car on screen
    let hud = null, hudSpeed = 0, followVx = 0, followVy = 0;
    soundOthers.length = 0;
    for (const id in gs) {
        if (racing && id === clientState.me) continue;
        const p = gs[id], v = p.speed / scale;
        let r = remoteBoxes.get(id);
        if (!r) { r = { box: new Gearbox(), speed: v, load: v > 30 ? 1 : 0, o: { id } }; remoteBoxes.set(id, r); } // joined mid-race: a fast car is on throttle
        r.load = estimateLoad(r.load, (v - r.speed) / Math.max(dt, 1e-3), dt, v);
        r.speed = v;
        const g = r.box.update(v, r.load, dt, !!p.limiter), o = r.o;
        o.x = p.x / scale; o.y = p.y / scale; o.vx = Math.cos(p.angle) * v; o.vy = Math.sin(p.angle) * v;
        o.rpm = g.rpm; o.load = r.load; o.limiter = g.limiter; o.pit = g.pit;
        soundOthers.push(o);
        if (id === followId) { hud = g; hudSpeed = v; followVx = o.vx; followVy = o.vy; }
    }
    for (const id of remoteBoxes.keys()) if (!gs[id]) remoteBoxes.delete(id); // left the session
    sndFrame.own = null;
    if (racing) {
        const thr = predictor?.car?.usedThrottle ?? input.throttle; // the throttle the help left (it lifts for you)
        const v = me.speed / scale, g = ownBox.update(v, thr, dt, !!me.limiter);
        for (const e of g.events) Sound.event(e === 'up' ? 'shift_up' : 'shift_down');
        if (!!me.drs !== lastDrs) { lastDrs = !!me.drs; Sound.event('drs'); }
        ownFrame.rpm = g.rpm; ownFrame.load = thr; ownFrame.limiter = g.limiter; ownFrame.pit = g.pit; ownFrame.speedMs = v;
        sndFrame.own = ownFrame;
        hud = g; hudSpeed = v;
        listenerFrame.vx = Math.cos(me.angle) * v; listenerFrame.vy = Math.sin(me.angle) * v;
    } else { listenerFrame.vx = followVx; listenerFrame.vy = followVy; } // spectator camera rides with the followed car
    camera.getWorldDirection(camDir);
    const len = Math.hypot(camDir.x, camDir.z) || 1;
    listenerFrame.x = camera.position.x / scale; listenerFrame.y = camera.position.z / scale;
    listenerFrame.fx = camDir.x / len; listenerFrame.fy = camDir.z / len;
    Sound.update(sndFrame);
    // Gear + shift lights (DOM touched only on change)
    const gear = !hud ? '' : hud.reverse ? 'R' : hudSpeed < 0.3 && hud.rpm < 4600 ? 'N' : String(hud.gear);
    if (gear !== hudGear) { hudGear = gear; $('hud-gear').textContent = gear; }
    const L = hud ? shiftLights(hud.rpm, hud.limiter) : { lit: 0, flash: false };
    if (L.lit !== hudLit) { hudLit = L.lit; document.querySelectorAll('#rev-lights i').forEach((el, i) => el.classList.toggle('on', i < L.lit)); }
    if (L.flash !== hudFlash) { hudFlash = L.flash; $('rev-lights').classList.toggle('flash', L.flash); }
}

function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    frameMs.push(dt * 1000);
    if (frameMs.length > 120) frameMs.shift();
    if (clientState.status === 'LOBBY') { Sound.update(silentFrame); return; } // engines and wind fade out in the lobby
    const paused = !!clientState.paused; // host pause: nothing is driven, cars hold where they are
    if (!paused) pollInput(dt);
    if (!world || !clientState.gameState) { Sound.update(silentFrame); return; }
    if (!paused) applyNet(now / 1000, dt);
    updateCars(dt);
    updateCrews(dt);
    updateWheelBatch();
    if (!window.lanraceDebug?.freeCam) updateCamera(dt);
    else { activeView = 'chase'; onboardCar = null; }
    skyDome.position.copy(camera.position);
    skyDome.scale.setScalar(camera.far * 0.9);
    if (paused) Sound.update(silentFrame); else updateSound(dt);
    if (!compiling) { // a draw before the shaders are ready compiles them there and then (a ~1.6 s freeze)
        renderer.render(scene, camera);
    }

    if (now - lastHud > 66) { // HUD and minimap at 15 Hz, timing tower at 4 Hz
        updateHUD(now - lastTower > 250);
        if (activeView !== 'chase' && steeringWheel && onboardCar) {
            steeringWheel.draw({ gear: hudGear, kmh: String(kmh(clientState.gameState[onboardCar.id]?.speed ?? 0)), lit: Math.max(0, hudLit), drs: !!clientState.gameState[onboardCar.id]?.drs });
        }
        if (now - lastTower > 250) lastTower = now;
        drawMinimap();
        colourLine();
        lastHud = now;
    }
    if (netstatsOn && now - lastNetstats > 250) { lastNetstats = now; drawNetstats(); }

    fpsFrames++;
    const me = clientState.gameState[clientState.me];
    if (!autoDone && shouldMeasure(choice, store.get('lanrace.quality.auto')) && me && Math.abs(me.speed) > 0) {
        autoMs += dt * 1000;
        autoFrames++;
        if (autoMs > 5000) {
            const picked = autoPick(autoMs / autoFrames, level, window.devicePixelRatio);
            store.set('lanrace.quality.auto', picked); // used from the next race
            autoDone = true; // once per page: a stored High is measured again only on the next load
        }
    }
    if (now - fpsSince > 1500) { // lobby, loading or a background tab: not a real measurement
        fpsFrames = 0;
        fpsSince = now;
    } else if (now - fpsSince >= 1000) {
        const fps = (fpsFrames * 1000) / (now - fpsSince);
        window.lanraceFps = fps; // network log telemetry (socket.js)
        const next = adaptStep(res, fps);
        res = next;
        fpsHist.push(fps);
        if (fpsHist.length > 6) fpsHist.shift();
        if (!capWarned && res.noDrop && frameCapped(fpsHist)) { // lowering resolution didn't help: a real cap
            capWarned = true;
            window.showBanner?.('30 FPS CAP — plug in the charger or turn off Chrome Energy Saver');
        }
        if (stats) stats.textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.drawCalls} calls · ${res.ratio.toFixed(2)}× · ${level}${choice === 'auto' ? ' (auto)' : ''} · ${backend}`;
        fpsFrames = 0;
        fpsSince = now;
    }
}

window.syncTyres = () => {
    const me = clientState.gameState?.[clientState.me];
    if (me) predictor?.setTyres({ compound: me.compound, wearPerM: me.wearPerM });
};

window.onQualiClock = (d) => {
    if (predictor) predictor.gripEvo = d.evo; // track evolution, same as the server's
    if (d.qphase === 'running') document.getElementById('quali-break').classList.add('hidden'); // next segment under way
};
// A timed lap: your own banner (improved / drop zone / pole); everyone hears about a new provisional pole
let koPos = null, qbTimer = null;
window.onQualiLap = (d) => {
    const name = driverOf(d.id)?.username || '';
    if (d.id === clientState.me) { const t = lapBanner(d, clientState.qualiClock?.survive ?? 99); if (t) window.showBanner?.(t, true); }
    else if (d.pole) window.showBanner?.(`PROVISIONAL POLE — ${name.toUpperCase()} ${fmtLap(d.time)}`, true);
};
// Between segments: who's through, who's out; after the last one, pole position
window.showQualiBreak = (d) => {
    const box = document.getElementById('quali-break'), list = document.getElementById('qb-list'), foot = document.getElementById('qb-foot');
    document.getElementById('qb-head').textContent = clientState.qualiClock?.format === 'full' ? `Q${d.segment} RESULTS` : 'QUALIFYING RESULTS';
    list.replaceChildren(...d.rows.map((r, i) => {
        const li = document.createElement('li');
        li.className = (r.out ? 'out ' : '') + (r.id === clientState.me ? 'me' : '');
        const name = driverOf(r.id)?.username || r.id;
        li.textContent = `${i + 1}  ${name}  ${r.time === null ? '—' : fmtLap(r.time)}  ${i && r.gap !== null ? '+' + r.gap.toFixed(3) : ''}  ${d.next ? (r.out ? 'KNOCKED OUT' : 'THROUGH') : ''}`;
        if (r.id === clientState.me && r.out) koPos = i + 1;
        return li;
    }));
    const pole = d.rows[0];
    const until = performance.now() + d.breakMs;
    clearInterval(qbTimer);
    const tick = () => { foot.textContent = d.next ? `Q${d.next} starts in 0:${String(Math.max(0, Math.ceil((until - performance.now()) / 1000))).padStart(2, '0')}`
        : pole && pole.time !== null ? `POLE POSITION — ${(driverOf(pole.id)?.username || '').toUpperCase()} ${fmtLap(pole.time)}` : ''; };
    tick();
    if (d.next) qbTimer = setInterval(tick, 250);
    box.classList.remove('hidden');
};

window.initGameVisuals = () => {
    netBuf = new SnapshotBuffer();
    // New session: predict from the new grid (reset on our first entry); spectators never get one, so never predict
    predictor = new Predictor(clientState.trackData, clientState.gameState?.[clientState.me]?.assist || 'off');
    predictor.box = clientState.gameState?.[clientState.me]?.box || null; // the pit stop guide drives into it
    predictor.gripEvo = clientState.status === 'QUALIFYING' ? clientState.qualiClock?.evo : undefined;
    clearInterval(qbTimer); document.getElementById('quali-break')?.classList.add('hidden'); koPos = null; hudQClock = null;
    hudBox = null; boxConfirmAt = 0; boxPick = null;
    lastPick = null; hudLastStop = undefined; hudPrevPhase = null; hudGhost = false; $('ghost-tag')?.classList.add('hidden'); clearTimeout(stewardTimer); $('steward-card')?.classList.add('hidden'); bannerUntil = 0; // the first meta seen is the baseline, not a new stop
    clearTimeout(coachTimer); $('coach-line')?.classList.add('hidden'); stewardAtS = contactAtS = -Infinity;
    window.syncTyres();
    sentInputs = []; carPose.clear(); carState.clear(); renderClock.t = presentClock.t = null;
    othersMode = store.get('lanrace.others') === 'smooth' ? 'smooth' : 'present';
    ownBox.reset(); remoteBoxes.clear(); lastDrs = false;
    for (const k in liveSec) delete liveSec[k]; // new session, new timing
    $('fl-card').classList.add('hidden');
    $('race-results').classList.add('hidden'); // next session: last race's classification goes
    buildWorld(clientState.trackData);
    singlePass(scene);
    freeze(world);
    // Shaders compile in the background; the world isn't drawn until they're done (the grid countdown covers it), at most 5 s
    // with a car in the scene for that, so its paint shaders are ready too
    compiling = !!renderer.compileAsync;
    const warm = compiling && clientState.me != null ? makeCar(clientState.me)?.root : null;
    if (warm) scene.add(warm);
    if (compiling) Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 5000))]).catch(() => { /* compiled on first draw instead */ }).finally(() => { compiling = false; if (warm) scene.remove(warm); });
    simStep(false); // resend what's held when a new session starts
};
renderer.setAnimationLoop(frame);
// game_init may have arrived while this module (and three.js) was still loading
if (clientState.trackData) window.initGameVisuals();
