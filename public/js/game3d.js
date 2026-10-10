import * as THREE from 'three';
import { buildCar, liveryTexture as carLivery, WHEEL_RADIUS } from './carModel.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { keyboardStep, gamepadInput, liftOffBrake } from './input.js';
import { parseAssist } from './sim/carphysics.js';
import { LEVELS, ratioRange, resolveLevel, autoPick, adaptStep, snapLight, frameCapped } from './quality.js';
import { placeScenery, seedOf, vergeReach, terrainHeights, terrainGround, skirtDepth, gridSampler, carveReach, onVerge, onPit, untangle, smoothPath, RENDER_STEP_M, SKIRT_M } from './scenery.js';
import { heightAt, pathHeights } from './sim/elevation.js';
import { themeOf, LANDS, SKIES, nightOf } from './themes.js';
import { SnapshotBuffer, RenderClock, sample, samplePresent, decodeFlags } from './netsync.js';
import { Predictor, STEP_S } from './predict.js';
import { Gearbox, shiftLights } from './audio/gearbox.js';
import { estimateLoad } from './audio/mix.js';
import * as Sound from './audio/audio.js';
import { gapText, driverCode, lapDelta, stepFollow, watchTarget, inDrsZone, drsHint, liveSectors, resultCells, sectorClass, lastLapClass } from './timing.js';
import { MODES, segmentColor, cornerMask, aheadM, trackIndex, nextMode } from './racingline.js';

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
let level = resolveLevel(choice, store.get('lanrace.quality.auto'));
let Q = LEVELS[level];
window.lanraceQuality = { choice, level };

// Antialias is fixed for the page's lifetime: it follows the level chosen at load
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
// Reading each shader's error log forces the GPU driver to finish compiling it there and then (a 2 s stall at a session's
// start in profiles); errors are a developer concern, the console still shows WebGL's own
renderer.debug.checkShaderErrors = false;
let res = { ...ratioRange(level, window.devicePixelRatio), good: 0 };
res.ratio = res.start;
renderer.setPixelRatio(res.ratio);

const SKY = 0x9cc8ef;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
const camera = new THREE.PerspectiveCamera(60, 1, 2, Q.far);
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
}
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
const SUN_OFF = { x: 600, y: 1800, z: 400 }; // sun position relative to the shadow target
Object.assign(sun.shadow.camera, { left: -360, right: 360, top: 360, bottom: -360, near: 10, far: 4000 }); // ±60 m around your car
// a texel (~6 cm) of offset along the surface normal: no shadow acne (blotches) on the cars' curved bodywork
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0;
scene.add(sun, sun.target);

// Shadows, fog, draw distance and resolution limits for a level (applied when a track is built)
let appliedLevel = null;
function applyLevel(l) {
    if (l === appliedLevel) return; // same level next session: keep the shadow map and the learned resolution
    appliedLevel = l;
    level = l;
    Q = LEVELS[l];
    window.lanraceQuality.level = l;
    renderer.shadowMap.enabled = Q.shadows > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft removed in three r186
    sun.castShadow = Q.shadows > 0;
    if (Q.shadows) sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    sun.shadow.radius = Q.softShadows ? 2.5 : 1; // High: softer shadow edges
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    scene.fog = new THREE.Fog(SKY, 3000, Q.fog);
    camera.far = Q.far;
    camera.updateProjectionMatrix();
    const range = ratioRange(l, window.devicePixelRatio);
    res = { ...range, good: 0, ratio: Math.max(range.min, Math.min(res.ratio, range.max)) };
    renderer.setPixelRatio(res.ratio);
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
const keys = { up: false, down: false, left: false, right: false, drs: false, handbrake: false };
const KEYMAP = {
    w: 'up', arrowup: 'up',
    s: 'down', arrowdown: 'down',
    a: 'left', arrowleft: 'left',
    d: 'right', arrowright: 'right',
    e: 'drs',
    ' ': 'handbrake',
    space: 'handbrake',
    b: 'handbrake',
    x: 'handbrake'
};
let input = { throttle: 0, brake: 0, steer: 0, drs: false, handbrake: false };
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
function toggleLine() {
    if (!line) return; // no line on this track
    lineMode = nextMode(lineMode);
    applyLineMode();
    colourLine();
    window.showBanner?.(`RACING LINE: ${lineMode.toUpperCase()}`, true);
}

// Assist on/off for your own car, any time (lobby select or Q / gamepad View): server and prediction switch together
let padView = false;
let savedBrakeAssist = 100;
try {
    const saved = store.get('lanrace.assist') || '100,100';
    const parts = String(saved).split(',');
    const b = parseInt(parts[1] ?? parts[0], 10);
    if (b > 0) savedBrakeAssist = b;
} catch (e) {}

function toggleAssist() {
    if (isSpectator()) return;
    const cur = store.get('lanrace.assist') || '100,100';
    const parts = String(cur).split(',');
    const curB = parseInt(parts[1] ?? (cur === 'off' ? 0 : 100), 10);

    if (curB > 0) {
        // Toggle OFF: save current brake assist and set to 0%
        savedBrakeAssist = curB;
        window.setAssist?.('100,0', true);
    } else {
        // Toggle ON: restore previous setting (defaulting to 100%)
        const target = savedBrakeAssist > 0 ? savedBrakeAssist : 100;
        window.setAssist?.(`100,${target}`, true);
    }
}

let brakeAssistHoldTimer = null;
let brakeAssistRepeatTimer = null;

function adjustBrakeAssist(delta) {
    if (isSpectator()) return;
    const cur = store.get('lanrace.assist') || '100,100';
    const parts = String(cur).split(',');
    const curB = parseInt(parts[1] ?? (cur === 'off' ? 0 : 100), 10);
    const newB = Math.max(0, Math.min(100, Math.round(curB / 10) * 10 + delta));
    if (newB === curB) return;

    if (newB > 0) savedBrakeAssist = newB;
    window.setAssist?.(`100,${newB}`, true);
}

function startBrakeAssistHold(delta) {
    stopBrakeAssistHold();
    adjustBrakeAssist(delta);
    brakeAssistHoldTimer = setTimeout(() => {
        brakeAssistRepeatTimer = setInterval(() => {
            adjustBrakeAssist(delta);
        }, 120);
    }, 280);
}

function stopBrakeAssistHold() {
    if (brakeAssistHoldTimer) { clearTimeout(brakeAssistHoldTimer); brakeAssistHoldTimer = null; }
    if (brakeAssistRepeatTimer) { clearInterval(brakeAssistRepeatTimer); brakeAssistRepeatTimer = null; }
}

window.onAssistChange = (v) => {
    if (predictor) { predictor.assist = v; if (predictor.car) predictor.car.assist = v; }
    if (clientState.status !== 'LOBBY') {
        const parts = String(v).split(',');
        const b = parseInt(parts[1] ?? (v === 'off' ? 0 : 100), 10);
        if (b === 0) {
            window.showBanner?.('BRAKE ASSIST: OFF (0%)', true);
        } else {
            window.showBanner?.(`BRAKE ASSIST: ${b}%`, true);
        }
    }
};

// After finishing (race or qualifying run): watch the cars still out there, like F1 TV after the flag; V: your own car
const WATCH_DELAY_MS = 2000;
let finishedAt = null, ownView = false;
function watchingAfterFinish() {
    const gs = clientState.gameState, me = gs?.[clientState.me];
    if (!me || !me.finished || isSpectator()) { finishedAt = null; ownView = false; return false; }
    finishedAt ??= performance.now();
    if (ownView || (clientState.status !== 'FINISHED' && performance.now() - finishedAt < WATCH_DELAY_MS)) return false;
    const ranked = rankedCarIds();
    spectateId = watchTarget(ranked, clientState.me, (id) => !!gs[id]?.finished, spectateId);
    if (!spectateId && ranked.length) {
        spectateId = ranked.find(id => id !== clientState.me) || null;
    }
    return spectateId !== null; // nobody left running: stay on your own car
}
const watching = () => isSpectator() || watchingAfterFinish();

function isSpectator() {
    return !!clientState.players[clientState.me]?.isSpectating || !clientState.gameState?.[clientState.me];
}

function onKey(e, down) {
    if (e.target?.matches?.('input, textarea, select')) return; // typing a name or a chat line, not driving
    const key = e.key.toLowerCase();
    if (down && key === 't' && !e.repeat && clientState.status !== 'LOBBY') toggleTower();
    if (down && key === 'r' && !e.repeat && clientState.status !== 'LOBBY') toggleLine();
    if (down && key === 'q' && !e.repeat && clientState.status !== 'LOBBY') toggleAssist();
    if (down && (e.key === '<' || e.key === ',') && !e.repeat && clientState.status !== 'LOBBY') startBrakeAssistHold(-10);
    if (down && (e.key === '>' || e.key === '.') && !e.repeat && clientState.status !== 'LOBBY') startBrakeAssistHold(10);
    if (!down && (e.key === '<' || e.key === ',' || e.key === '>' || e.key === '.')) stopBrakeAssistHold();
    if (down && key === 'escape' && !e.repeat) toggleHostPanel();
    if (down && key === 'm' && !e.repeat) window.showBanner?.(Sound.toggleMute() ? 'SOUND: MUTED' : 'SOUND: ON', true);
    if (down && e.key === 'F3') { e.preventDefault(); netstatsOn = !netstatsOn; netstatsEl.classList.toggle('hidden', !netstatsOn); }
    if (down && clientState.status !== 'LOBBY' && (watching() || clientState.gameState?.[clientState.me]?.finished)) {
        const others = rankedCarIds().filter((id) => id !== clientState.me); // finished: every car but your own
        if (others.length) {
            if (key === 'arrowleft') spectateId = stepFollow(others, spectateId, -1);
            if (key === 'arrowright') spectateId = stepFollow(others, spectateId, 1);
        }
    }
    if (down && key === 'v' && !e.repeat && clientState.gameState?.[clientState.me]?.finished && !isSpectator()) {
        ownView = !ownView;
        window.showBanner?.(ownView ? 'YOUR CAR · V TO WATCH' : 'WATCHING', true);
    }
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
    stopBrakeAssistHold();
    for (const k in keys) keys[k] = false;
    input = { throttle: 0, brake: 0, steer: 0, drs: false, handbrake: false };
    simStep(false); // the release goes out now, not at the next frame (a hidden tab has none)
}
window.addEventListener('blur', releaseKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseKeys(); });

// 60 Hz fixed steps: sample controls, predict own car, send newest + 5 previous (a lost UDP packet costs nothing)
function simStep(sample = true) {
    if (sample) {
        const pad = gamepadInput((navigator.getGamepads ? [...navigator.getGamepads()] : []).find(Boolean));
        const autoBrakeSetting = (window.lanraceMem?.['lanrace.autobrake'] ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('lanrace.autobrake') : null) ?? 'on') === 'on';
        const car = predictor?.car;
        const carSpeed = car ? Math.hypot(car.vx, car.vy) / scale : 0;
        // When autobrake is on (default), releasing W brakes when rolling forward. At standstill, lift = 0 (no reverse).
        const lift = autoBrakeSetting && carSpeed > 0.5 ? 1.0 : 0;
        input = hostPanel ? { throttle: 0, brake: 0, steer: 0, drs: false, handbrake: false, explicitReverse: false } : pad || touchInput || keyboardStep(input, keys, STEP_S, lift); // menu open: hands off
    }
    const stamped = {
        seq: ++inputSeq,
        steer: input.steer,
        throttle: input.throttle,
        brake: input.brake,
        drs: !!input.drs,
        handbrake: !!input.handbrake,
        explicitReverse: input.explicitReverse === true
    };
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
    simAcc = Math.min(simAcc + dt, 0.25); // a long stall doesn't fire a burst of steps
    while (simAcc >= STEP_S) { simStep(); simAcc -= STEP_S; }
}

// Virtual joystick for touch devices
const joyZone = document.getElementById('joystick-zone');
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');
let isTouching = false;
const joyCenter = { x: 0, y: 0 };
const JOY_MAX = 50;

if ('ontouchstart' in window) joyZone.style.display = 'block';

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
            : elev && elev.pit && (path === elev.pit.wall || path === elev.pit.closeWall) ? path.map((p) => pitY(p.x, p.y)) // on the pit lane
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

function distToPath(p, path, closed = true) {
    let best = Infinity;
    for (let i = 0; i < (closed ? path.length : path.length - 1); i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        let t = l2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
    }
    return best;
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
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, map: opts.map || null,
        transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthWrite: opts.opacity === undefined,
        // Flat layers only cm apart: a depth offset per layer stops them fighting (flickering) in the distance
        polygonOffset: !!opts.layer, polygonOffsetFactor: -(opts.layer || 0), polygonOffsetUnits: -(opts.layer || 0) * 2,
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
let asphaltTex = null;
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

let drsBillboardTex = null;
function getDrsBillboardTexture() {
    if (!drsBillboardTex) {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#064e3b';
        g.fillRect(0, 0, 512, 256);
        g.strokeStyle = '#22c55e';
        g.lineWidth = 14;
        g.strokeRect(7, 7, 498, 242);
        g.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        g.lineWidth = 2;
        g.strokeRect(18, 18, 476, 220);
        g.fillStyle = '#22c55e';
        g.fillRect(20, 20, 472, 42);
        g.fillStyle = '#022c22';
        g.font = '900 24px Outfit, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('FIA DRS ZONE', 256, 41);
        g.fillStyle = '#ffffff';
        g.font = '900 112px Outfit, sans-serif';
        g.fillText('DRS', 256, 138);
        g.fillStyle = '#22c55e';
        g.font = '800 22px Outfit, sans-serif';
        g.fillText('▶▶ ACTIVATION ▶▶', 256, 216);
        drsBillboardTex = new THREE.CanvasTexture(c);
        drsBillboardTex.colorSpace = THREE.SRGBColorSpace;
    }
    return drsBillboardTex;
}

function buildDrsBoards(t) {
    if (!t.drsZones || !t.drsZones.length) return;
    const g = new THREE.Group();
    const half = t.width / 2;
    const total = t.cum[t.path.length];
    const tex = getDrsBillboardTexture();
    const w = 3.6 * scale, h = 1.8 * scale, postH = 1.4 * scale;

    const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.6, roughness: 0.4 });

    for (const z of t.drsZones) {
        const absS = (((z.startS + (t.startS || 0)) % total) + total) % total;
        let i = 0;
        while (i < t.path.length && t.cum[i + 1] < absS) i++;
        const p1 = t.path[i], p2 = t.path[(i + 1) % t.path.length];
        const segLen = t.cum[i + 1] - t.cum[i] || 1;
        const frac = (absS - t.cum[i]) / segLen;
        const px = p1.x + (p2.x - p1.x) * frac;
        const py = p1.y + (p2.y - p1.y) * frac;
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        for (const dir of [1, -1]) {
            const bPos = side({ x: px, y: py }, ang, dir * (half + 2.5 * scale));
            const baseY = roadY(bPos.x, bPos.y, ang);
            const centerH = baseY + postH + h / 2;

            const unit = new THREE.Group();
            unit.position.set(bPos.x, centerH, bPos.y);
            unit.rotation.y = facing(ang);

            const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), boardMat);
            front.position.z = 0.05 * scale;
            unit.add(front);

            const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08 * scale), backMat);
            unit.add(back);

            for (const legSide of [-0.35, 0.35]) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, postH + h / 2, 6), postMat);
                leg.position.set(legSide * w, -(postH + h / 2) / 2, 0);
                unit.add(leg);
            }

            g.add(unit);
        }
    }
    world.add(g);
}

// ── Tire Smoke Particles ───────────────────────────────────────────────────
let smokeTexture = null;
function getSmokeTexture() {
    if (!smokeTexture) {
        const c = document.createElement('canvas');
        c.width = 128; c.height = 128;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.25, 'rgba(245, 248, 255, 0.80)');
        grad.addColorStop(0.55, 'rgba(225, 235, 245, 0.40)');
        grad.addColorStop(0.85, 'rgba(210, 220, 235, 0.12)');
        grad.addColorStop(1, 'rgba(200, 210, 230, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(64, 64, 64, 0, Math.PI * 2);
        g.fill();
        smokeTexture = new THREE.CanvasTexture(c);
        smokeTexture.colorSpace = THREE.SRGBColorSpace;
    }
    return smokeTexture;
}

let smokeMesh = null;
let smokeParticles = [];
const SMOKE_MAX = 140;
const smokeDummy = new THREE.Object3D();

function initSmokeSystem() {
    smokeParticles = Array.from({ length: SMOKE_MAX }, () => ({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        size: 0.5, life: 0, maxLife: 0.7
    }));
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
        map: getSmokeTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.72
    });
    smokeMesh = new THREE.InstancedMesh(geo, mat, SMOKE_MAX);
    smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    smokeMesh.frustumCulled = false; // CRITICAL: prevent frustum culling!
    smokeMesh.renderOrder = 999;
    // Initialize all matrices to hidden position
    for (let i = 0; i < SMOKE_MAX; i++) {
        smokeDummy.position.set(0, -9999, 0);
        smokeDummy.scale.set(0, 0, 0);
        smokeDummy.updateMatrix();
        smokeMesh.setMatrixAt(i, smokeDummy.matrix);
    }
    if (smokeMesh.instanceMatrix) smokeMesh.instanceMatrix.needsUpdate = true;
    world.add(smokeMesh);
}

function emitSmoke(x, y, z, baseAngle, speed, sizeMultiplier = 1) {
    if (!smokeMesh) return;
    for (const p of smokeParticles) {
        if (!p.active) {
            p.active = true;
            p.x = x + (Math.random() - 0.5) * 0.3 * scale;
            p.y = y + 0.12 * scale;
            p.z = z + (Math.random() - 0.5) * 0.3 * scale;
            const backSpd = Math.max(1.5, speed * 0.35);
            p.vx = -Math.cos(baseAngle) * backSpd + (Math.random() - 0.5) * 1.5;
            p.vy = 0.8 + Math.random() * 0.9;
            p.vz = -Math.sin(baseAngle) * backSpd + (Math.random() - 0.5) * 1.5;
            p.size = (0.55 + Math.random() * 0.35) * scale * sizeMultiplier;
            p.life = 0;
            p.maxLife = 0.55 + Math.random() * 0.35;
            break;
        }
    }
}

function updateSmokeParticles(dt) {
    if (!smokeMesh || !camera) return;
    let anyActive = false;
    for (let i = 0; i < SMOKE_MAX; i++) {
        const p = smokeParticles[i];
        if (!p.active) {
            smokeDummy.position.set(0, -9999, 0);
            smokeDummy.scale.set(0, 0, 0);
            smokeDummy.updateMatrix();
            smokeMesh.setMatrixAt(i, smokeDummy.matrix);
            continue;
        }
        anyActive = true;
        p.life += dt;
        if (p.life >= p.maxLife) {
            p.active = false;
            smokeDummy.position.set(0, -9999, 0);
            smokeDummy.scale.set(0, 0, 0);
            smokeDummy.updateMatrix();
            smokeMesh.setMatrixAt(i, smokeDummy.matrix);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 0.92;
        p.vz *= 0.92;
        const progress = p.life / p.maxLife;
        const currentSize = p.size * (1.0 + progress * 2.5);

        smokeDummy.position.set(p.x, p.y, p.z);
        smokeDummy.quaternion.copy(camera.quaternion);
        smokeDummy.scale.set(currentSize, currentSize, 1);
        smokeDummy.updateMatrix();
        smokeMesh.setMatrixAt(i, smokeDummy.matrix);
    }
    if (smokeMesh.instanceMatrix) smokeMesh.instanceMatrix.needsUpdate = true;
}

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

function buildPit(pit, t) {
    const n = pit.path.length, ph = pit.width / 2, s = pit.trackSide;
    const inner = (i) => i >= 1 && i <= n - 3; // end segments would use wrapped normals
    const open = (i) => inner(i) && pit.cum[i] >= pit.closeS; // nothing drawn on the closed pit entry
    world.add(strip(pit.path, -ph, ph, 0.55, inner, solid('#3a3f47'))); // the closed entry too: a road, barred (not grass)
    const line = 0.3 * scale;
    // Edge lines only off the track: where the pit lane merges, they'd be painted across the racing surface
    const offTrack = (off) => offsetPoints(pit.path, off).map((q) => distToPath(q, t.path) > t.width / 2);
    const outL = offTrack(ph - line / 2), outR = offTrack(-ph + line / 2);
    world.add(strip(pit.path, ph - line, ph, 0.85, (i) => open(i) && outL[i] && outL[i + 1], solid('#f2f2f2')));
    world.add(strip(pit.path, -ph, -ph + line, 0.85, (i) => open(i) && outR[i] && outR[i + 1], solid('#f2f2f2')));

    // Pit wall on the track side; outer wall behind the lane except where the garages open onto it
    world.add(wall(pit.wall, 0, 1 * scale, (i) => i < pit.wall.length - 1, solid('#9aa0a6')));
    const [lo, hi] = pit.garageSpan, back = ph + PIT_RUNOFF_M * scale;
    world.add(wall(pit.path, -s * back, 1 * scale, (i) => open(i) && (pit.cum[i + 1] < lo || pit.cum[i] > hi), solid('#9aa0a6')));

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
    board(pit.closeS - 15 * scale, 'PIT CLOSED', '#d62828'); // ahead of the limiter board, seen first
    board(Math.max(pit.limStart, pit.closeS), `PIT LIMIT ${pit.limitKmh || 80}`, '#1e5bd8');
    $('pit-limiter').textContent = `PIT LIMITER ${pit.limitKmh || 80}`;
    board(pit.limEnd, 'END LIMIT', '#1e5bd8');
    board(pit.cum[n - 3], 'PIT OUT', '#2a9d3f');
    world.add(wall(pit.closeWall, 0, 1.2 * scale, (i) => i === 0, solid('#d62828')));
    for (const s0 of [Math.max(pit.limStart, pit.closeS), pit.limEnd]) {
        const p = at(s0), m = flat(0.5 * scale, pit.width, 0xf2f2f2);
        m.position.set(p.x, 0.9 + pitY(p.x, p.y), p.y);
        m.rotation.y = -p.angle;
        world.add(m);
    }

    const buildings = [], signs = [], marks = [];
    for (const g of pit.garages) {
        const info = teamInfo[g.teamId] || { name: g.teamId, chatColor: '#888888' };
        const c = side(g, g.angle, -s * (back + 2.5 * scale)), h = pitY(g.x, g.y);
        // no building where it would stand on the track's run-off (Zandvoort, Sakhir: the track runs close behind the pits)
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle), onTrack = [[-9, -2.5], [9, -2.5], [-9, 2.5], [9, 2.5]].some(([a, l]) =>
            distToPath({ x: c.x + (fx * a - fy * l) * scale, y: c.y + (fy * a + fx * l) * scale }, t.path) < t.width / 2 + (t.wallOffset ?? WALL_OFFSET));
        if (!onTrack) buildings.push({ x: c.x, y: h, z: c.y, angle: -g.angle });
        const f = side(g, g.angle, -s * (back - 0.1 * scale));
        if (!onTrack) signs.push({ text: info.name.toUpperCase(), x: f.x, y: 5 * scale + h, z: f.y, rotY: s > 0 ? -g.angle : Math.PI - g.angle, bg: info.chatColor });
        for (const b of g.boxes) marks.push({ x: b.x, y: 0.8 + h, z: b.y, angle: -b.angle, color: info.chatColor });
    }
    const bGeo = new THREE.BoxGeometry(18 * scale, 12 * scale, 5 * scale); // 6 m above the pit lane, 6 m below: never floats
    if (buildings.length) {
        const garagesMesh = instanced(bGeo, new THREE.MeshStandardMaterial({ color: 0x2b2f36 }), buildings);
        garagesMesh.castShadow = true;
        world.add(garagesMesh);
    }
    if (signs.length) world.add(atlasPlanes(signs, 17 * scale, 1.6 * scale, '#888888'));
    const mGeo = new THREE.PlaneGeometry(6 * scale, 2.6 * scale);
    mGeo.rotateX(-Math.PI / 2);
    world.add(instanced(mGeo, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45 }), marks));
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
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
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
        const keep = new Set([asphaltTex, blobTex, envTex]);
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
    world.add(strip(rp, signed(-1, roadTo[-1]), roadTo[1], 0.6, all, solid('#4a505a'), { map: asphaltTexture(), repeatM: 8 }));
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
    buildDrsBoards(t);
    initSmokeSystem();
    snapCamera = true;
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
if (Q.envMap) (window.requestIdleCallback || setTimeout)(() => envTexture());

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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6 * scale, 2.3 * scale), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0.2 * scale, 0.1, 0); // just over the asphalt under the car, a touch forward of the axle midpoint
    m.renderOrder = 1;
    return m;
}

// Generated once: a soft studio reflection for car paint (Medium/High)
let envTex = null;
function envTexture() {
    if (!envTex) envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    return envTex;
}

function makeCar(id) {
    const lp = clientState.players[id];
    if (!lp) return null;
    const root = new THREE.Group();
    const wheels = [];
    let drsWing = null;
    carTemplate = carTemplateFor();
    if (carTemplate) {
        const model = carTemplate.clone(true);
        drsWing = model.getObjectByName('drsWing');
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
            if (Q.envMap) {
                o.material.envMap = envTexture();
                o.material.envMapIntensity = night ? 0.12 : 0.3; // the studio reflection would glow at night
                if (o.material.name === 'livery') { o.material.metalness = 0.1; o.material.roughness = 0.35; }
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
    const tag = id === clientState.me ? null : nameTag(lp.username, lp.color);
    if (tag) root.add(tag);
    singlePass(root);
    return {
        root,
        wheels,
        teamId: lp.teamId,
        ghost: false,
        tag,
        drsWing,
        drsAngle: 0,
        suspPitch: 0,
        suspRoll: 0,
        prevSpeed: 0,
        smokeTimer: 0
    };
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
        } else {
            r.position.y = ROAD_DRAW_Y;
            r.rotation.z = 0;
            r.rotation.x = 0;
        }

        // Dynamic suspension pitch tilt (accel squat / brake dive) and body roll
        const curSpeedMs = (s.speed || 0) / scale;
        const dtSafe = Math.max(0.001, dt);
        const aLong = Math.max(-28, Math.min(20, (curSpeedMs - car.prevSpeed) / dtSafe));
        car.prevSpeed = curSpeedMs;

        // Pitch: Accel squat (+pitch lifts nose) / Brake dive (-pitch dips nose)
        const targetPitch = Math.max(-0.042, Math.min(0.035, aLong * 0.0024));
        car.suspPitch += (targetPitch - car.suspPitch) * Math.min(1, dtSafe * 12);
        r.rotation.z += car.suspPitch;

        // Roll: Centripetal body lean towards outside of turn
        const latG = (curSpeedMs * curSpeedMs / 130) * (s.steer || 0);
        const targetRoll = -Math.max(-0.045, Math.min(0.045, latG * 0.022));
        car.suspRoll += (targetRoll - car.suspRoll) * Math.min(1, dtSafe * 12);
        r.rotation.x += car.suspRoll;

        // Articulated DRS rear wing flap: physically opens when DRS is active
        if (car.drsWing) {
            const targetDrsAngle = s.drs ? -0.34 : 0;
            car.drsAngle += (targetDrsAngle - car.drsAngle) * Math.min(1, dtSafe * 16);
            car.drsWing.rotation.z = car.drsAngle;
        }

        // Tire smoke particle system: Launch burnout, hard acceleration, turning slip, brake lockup
        car.smokeTimer = (car.smokeTimer || 0) + dtSafe;
        if (car.smokeTimer >= 0.025) {
            car.smokeTimer = 0;
            const isMe = id === clientState.me;
            const myThrottle = isMe ? (input?.throttle || 0) : 0;
            const myBrake = isMe ? (input?.brake || 0) : 0;
            const mySteer = isMe ? Math.abs(input?.steer || 0) : Math.abs(s.steer || 0);

            // 1. High acceleration / standing launch burnout
            const isLaunchBurnout = (myThrottle > 0.45 && curSpeedMs < 20) || (aLong > 2.2 && curSpeedMs < 25);
            // 2. High-speed cornering / tire slide & slip
            const isTurningSlip = (mySteer > 0.035 && curSpeedMs > 4.5) || (Math.abs(car.suspRoll || 0) > 0.010 && curSpeedMs > 6.0);
            // 3. Heavy braking lockup
            const isBrakeLockup = (myBrake > 0.35 && curSpeedMs > 4.5) || (aLong < -3.8 && curSpeedMs > 5.0);
            // 4. Handbrake drift
            const isHandbrakeSlide = isMe && !!input?.handbrake && curSpeedMs > 2.0;

            if (isLaunchBurnout || isTurningSlip || isBrakeLockup || isHandbrakeSlide) {
                const cosA = Math.cos(s.angle), sinA = Math.sin(s.angle);
                const halfTrack = 0.85 * scale;
                const axleDist = 1.6 * scale;

                if (isLaunchBurnout || isHandbrakeSlide) {
                    // Rear tires burnout
                    const rx = r.position.x - cosA * axleDist;
                    const rz = r.position.z - sinA * axleDist;
                    emitSmoke(rx - sinA * halfTrack, r.position.y, rz + cosA * halfTrack, s.angle, curSpeedMs, 1.2);
                    emitSmoke(rx + sinA * halfTrack, r.position.y, rz - cosA * halfTrack, s.angle, curSpeedMs, 1.2);
                } else if (isTurningSlip) {
                    // Turning slip: smoke from rear tires and outside front tire
                    const rx = r.position.x - cosA * axleDist;
                    const rz = r.position.z - sinA * axleDist;
                    emitSmoke(rx - sinA * halfTrack, r.position.y, rz + cosA * halfTrack, s.angle, curSpeedMs, 0.95);
                    emitSmoke(rx + sinA * halfTrack, r.position.y, rz - cosA * halfTrack, s.angle, curSpeedMs, 0.95);
                    const fx = r.position.x + cosA * axleDist;
                    const fz = r.position.z + sinA * axleDist;
                    const outSide = (s.steer || 0) > 0 ? 1 : -1;
                    emitSmoke(fx - outSide * sinA * halfTrack, r.position.y, fz + outSide * cosA * halfTrack, s.angle, curSpeedMs, 0.85);
                } else if (isBrakeLockup) {
                    // Front tires lockup
                    const fx = r.position.x + cosA * axleDist;
                    const fz = r.position.z + sinA * axleDist;
                    emitSmoke(fx - sinA * halfTrack, r.position.y, fz + cosA * halfTrack, s.angle, curSpeedMs, 1.0);
                    emitSmoke(fx + sinA * halfTrack, r.position.y, fz - cosA * halfTrack, s.angle, curSpeedMs, 1.0);
                }
            }
        }
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
        const isWatch = watching();
        const focusId = isWatch && spectateId && gs[spectateId] ? spectateId : clientState.me;
        const meCar = gs[focusId];
        const isFocusCar = id === focusId;
        const noCollision = clientState.settings?.collisions === false;
        const isGhost = !!s.ghost;

        let targetOpacity = 1.0;
        let isTransparent = false;

        if (isFocusCar) {
            // Our car stays same (solid, opaque)
            targetOpacity = 1.0;
            isTransparent = false;
        } else if (noCollision || isGhost) {
            // In no-collision mode or when ghost is on:
            const distM = meCar ? Math.hypot(s.x - meCar.x, s.y - meCar.y) / scale : 999;
            if (noCollision && distM < 10) {
                // When other cars are within 10m in no-collision mode, smoothly reduce their opacity
                // based on proximity factor so they don't visually clutter with 4-5 cars on top of each other!
                const t = Math.max(0, Math.min(1, (distM - 1.2) / 8.8)); // 0 at ~1.2m, 1 at 10m
                targetOpacity = Math.max(0.12, Math.min(0.60, 0.12 + 0.48 * t));
                isTransparent = true;
                if (distM < 5) {
                    for (const w of car.wheels) w.userData.show = false;
                }
            } else if (isGhost) {
                targetOpacity = 0.5;
                isTransparent = true;
            } else if (noCollision) {
                targetOpacity = 0.85;
                isTransparent = true;
            }
        }

        if (car.lastOpacity !== targetOpacity) {
            car.lastOpacity = targetOpacity;
            car.ghost = isTransparent;
            car.root.traverse((o) => {
                if (!o.material || o.isSprite) return;
                const mat = o.material;
                if (mat.transparent !== isTransparent) {
                    mat.transparent = isTransparent;
                    mat.needsUpdate = true;
                }
                mat.opacity = targetOpacity;
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
    for (const [pkt, at] of clientState.netIn.splice(0)) {
        if (!netBuf.push(pkt, at) || !predictor || myIdx === undefined) continue; // duplicate / stale: dropped
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
        } else {
            let out = carPose.get(i), st = carState.get(i);
            if (!out) { out = {}; st = {}; carPose.set(i, out); carState.set(i, st); }
            // 'present': where the server has them now (matches the hitbox); 'smooth': interpolated, slightly behind
            pose = othersMode === 'smooth' ? sample(netBuf, renderT, i, out, st, scale) : samplePresent(netBuf, presentT, i, out, st, scale);
            if (!pose) continue;
            decodeFlags(pose.flags, p);
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
                if (counts[k - 1] < mesh.instanceMatrix.count) mesh.setMatrixAt(counts[k - 1]++, o.matrixWorld);
            });
        }
    }
    wheelBatch.forEach((mesh, k) => { mesh.count = counts[k]; mesh.instanceMatrix.needsUpdate = true; });
}

// ---------- camera ----------
const look = new THREE.Vector3();
let camHeading = 0;

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
    if (!car) return;
    const p = car.root.position;
    // Camera sits exactly behind the car; only its swing round corners is smoothed
    const target = -car.root.rotation.y; // back to server heading
    if (snapCamera) { camHeading = target; snapCamera = false; }
    const d = target - camHeading;
    camHeading += Math.atan2(Math.sin(d), Math.cos(d)) * (1 - Math.exp(-CAM_TURN_SMOOTH * dt));
    const h = camHeading;
    // Height: the road behind the car (so the camera rises before a crest, not into it), never below the car's own level
    const bx = p.x - Math.cos(h) * CHASE_BACK_M * scale, bz = p.z - Math.sin(h) * CHASE_BACK_M * scale;
    camera.position.set(bx, Math.max(p.y, roadY(bx, bz, h)) + CHASE_UP_M * scale, bz);
    look.set(p.x + Math.cos(h) * LOOK_AHEAD_M * scale, p.y + 1 * scale, p.z + Math.sin(h) * LOOK_AHEAD_M * scale);
    camera.lookAt(look);
    // Moved in whole shadow-map texels so shadow edges don't shimmer as the car drives
    const q = snapLight({ x: p.x, y: p.y, z: p.z }, SUN_OFF, 720 / (Q.shadows || 1024));
    sun.position.set(q.x + SUN_OFF.x, q.y + SUN_OFF.y, q.z + SUN_OFF.z);
    sun.target.position.set(q.x, q.y, q.z);
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
        const lp = clientState.players[r.id];
        const li = document.createElement('li');
        const gap = r.position > 1 && r.bestLap !== null && pole !== null ? `  +${(r.bestLap - pole).toFixed(3)}` : '';
        li.textContent = `P${r.position}  ${lp ? lp.username : '—'}  ${r.bestLap === null ? 'no time' : fmtTime(r.bestLap)}${gap}`;
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
        const lp = clientState.players[r.id] || clientState.gameState?.[r.id], c = resultCells(r, fmtTime);
        const li = document.createElement('li');
        li.className = (r.id === clientState.me ? 'me ' : '') + (r.position <= 3 && !r.dnf ? 'podium' : '');
        const team = span('rr-team');
        team.style.background = teamInfo[lp?.teamId]?.chatColor || '#888';
        const best = span('rr-best' + (r.id === res.fastestLapId ? ' fl' : ''), r.bestLap === null ? '—' : fmtTime(r.bestLap));
        if (r.id === res.fastestLapId) best.insertAdjacentHTML('afterbegin', STOPWATCH + ' ');
        li.append(span('rr-pos', r.position), team, span('rr-name', lp?.username || '—'), span('rr-chg ' + c.changeCls, c.change),
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
    const inSess = inSession();
    const paused = !!clientState.paused && !clientState.resuming && inSess, host = amHost() && inSess;
    $('hud-host').classList.toggle('hidden', !host);
    if (!inSess) hostPanel = false;
    const show = paused || hostPanel;
    $('session-panel').classList.toggle('hidden', !show);
    if (!show) return;
    $('hc-title').textContent = paused ? 'PAUSED' : host ? 'SESSION CONTROL' : 'RACE MENU';
    $('hc-note').textContent = !paused ? '' : host ? 'The session is paused for everyone.' : 'The host has paused the session.';
    $('hc-note').classList.toggle('hidden', !paused);
    $('hc-close').classList.toggle('hidden', false);
    $('hc-host').classList.toggle('hidden', !host);
    $('hc-foot').textContent = host ? 'Esc resumes and closes · restart and remove act for everyone' : 'Esc closes menu · Leave Race permanently retires';
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
// Opening it pauses the session for everyone (if host, once the lights are out); closing it (Esc, ✕, Resume) resumes
const canPause = () => ['QUALIFYING', 'RACE'].includes(clientState.status);
function toggleHostPanel() {
    if (!inSession()) return;
    const isHost = amHost();
    const held = clientState.paused && !clientState.resuming;
    hostPanel = !(hostPanel || held);
    if (hostPanel) {
        releaseKeys();
        if (isHost && canPause() && !held) socket.emit('pause_session', true); // also calls off a resume count under way
    } else if (isHost && held) socket.emit('pause_session', false); // the server counts everyone in, then resumes
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
const codeOf = (id) => { const lp = clientState.players[id]; return lp ? driverCode(lp.username) : '---'; };

// F1 TV-style purple card when anyone sets the session's fastest lap
let flTimer;
window.showFastestLap = (fl) => {
    const card = $('fl-card'), lp = clientState.players[fl.id];
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

function updateHUD(withTower = true) {
    const gs = clientState.gameState;
    if (!gs) return;
    const isWatch = watching();
    if (isWatch && (!spectateId || !gs[spectateId])) {
        const ranked = rankedCarIds();
        spectateId = ranked.find(id => id !== clientState.me) || ranked[0] || null;
    }
    const followId = isWatch && spectateId && gs[spectateId] ? spectateId : clientState.me;
    const target = gs[followId] || gs[clientState.me];
    const isTargetMe = followId === clientState.me;
    const fastest = clientState.fastestLap?.time ?? Infinity; // the server's session fastest lap (kept if its holder leaves)
    const sec = (s) => sectorClass(s, clientState.sessionBest, clientState.sessionBestIds); // live: purple → green when beaten

    $('hud-total').innerText = Object.keys(gs).length;
    // Finished or spectating: say whose car is on screen and how to switch
    const w = isWatch, wo = $('watch-overlay'), so = $('spectator-overlay');
    if (isSpectator()) {
        wo.classList.add('hidden');
        if (so) {
            const followedName = clientState.players[followId]?.username || '';
            const spText = so.querySelector('p');
            if (spText) spText.textContent = followedName ? `Watching ${followedName} · ← → to switch car` : 'Race in progress · ← → to switch car';
        }
    } else {
        wo.classList.toggle('hidden', !w);
        if (w) $('watch-name').textContent = clientState.players[followId]?.username || '';
    }
    $('hud-rank').innerText = target ? target.rank : '--';
    $('hud-lap').innerText = target ? lapLabel(target.lap) : '--';
    $('hud-laps').textContent = target && clientState.status !== 'QUALIFYING' ? `/${clientState.settings.maxLaps}` : '';
    $('hud-speed').innerText = target ? kmh(target.speed) : '--';

    // Target car lap times: purple while it's the session fastest, green once beaten (still your personal best)
    const curEl = $('lt-current');
    curEl.innerText = target && target.curLap !== null && target.curLap !== undefined ? fmtTime(target.curLap) : '--';
    curEl.classList.toggle('t-red', !!target && target.lapValid === false);
    const lastEl = $('lt-last');
    const deleted = !!target && target.lastValid === false;
    lastEl.innerText = target && target.lastLap !== null && target.lastLap !== undefined ? fmtTime(target.lastLap) + (deleted ? ' DELETED' : '') : '--';
    const lastCls = target ? lastLapClass(target.lastLap, target.bestLap, clientState.fastestLap?.time, deleted) : '';
    for (const c of ['t-red', 't-purple', 't-green']) lastEl.classList.toggle(c, c === lastCls);
    $('lt-best').innerText = target && target.bestLap !== null && target.bestLap !== undefined ? fmtTime(target.bestLap) : '--';
    const delta = target && !deleted ? lapDelta(target.lastLap, target.bestLap) : null;
    $('lt-delta').textContent = delta ? delta.text : '';
    $('lt-delta').className = delta ? delta.cls : '';
    for (let i = 0; i < 3; i++) {
        const el = $(`sec-${i + 1}`);
        let s = null;
        if (isTargetMe) s = clientState.mySectors[i];
        else if (liveSec[followId]?.[i]) s = liveSec[followId][i];
        else if (target?.bestLapSectors?.[i] !== null && target?.bestLapSectors?.[i] !== undefined) s = { time: target.bestLapSectors[i], valid: true };
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
    if (clientState.status === 'QUALIFYING' && sess) {
        bar = `QUALIFYING ${fmtClock(sess.endsAt - (clientState.pausedAt ?? Date.now()))}`; // frozen while paused
        if (target) bar += target.finished ? ` · QUALIFYING COMPLETE — P${target.rank}` : target.curLap === null ? (target.inPit ? ' · PIT LANE' : ' · OUT LAP') : ` · LAP ${target.lap + 1}/${clientState.settings.qualiLaps ?? 2}`;
    } else if (clientState.status === 'RACE' || clientState.status === 'FINISHED') {
        const leader = Object.values(gs).find(p => p.rank === 1);
        const lap = target ? target.lap : leader ? leader.lap : 0;
        bar = `LAP ${lapLabel(lap)}/${clientState.settings.maxLaps}`; // racing: it's in the LAP box
    }
    $('session-bar').textContent = bar;
    $('pit-limiter').classList.toggle('hidden', !(target && target.limiter));
    $('drs-badge').className = !target ? 'drs-off' : target.drs ? 'drs-open' : target.drsAvailable ? 'drs-avail' : 'drs-off';
    let hint = '';
    if (target && clientState.trackData) {
        const t = clientState.trackData, total = t.cum[t.path.length];
        drsIdx = trackIndex(t.path, target.x, target.y, drsIdx, t.width);
        const lapS = (((t.cum[drsIdx] - (t.startS || 0)) % total) + total) % total;
        hint = drsHint({ mode: clientState.status === 'QUALIFYING' ? 'quali' : 'race', inPit: target.inPit, drs: target.drs, drsAvailable: target.drsAvailable, lap: target.lap, inZone: inDrsZone(t.drsZones || [], lapS) });
    }
    $('drs-hint').textContent = hint;

    if (withTower) {
        // Timing tower
        const quali = clientState.status === 'QUALIFYING' || clientState.status === 'QUALI_RESULTS'; // ghosts also mean collisions off
        const ol = $('leaderboard-list');
        ol.innerHTML = '';
        const sorted = Object.entries(gs).filter(([id]) => clientState.players[id]).sort((a, b) => a[1].rank - b[1].rank);
        const rows = sorted.map(([, p]) => ({ gap: p.gap, lapsDown: p.lapsDown || 0 }));
        const codes = sorted.map(([id]) => driverCode(clientState.players[id].username));
        const el = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
        // Top 10, or top 9 plus your own row when you're further back
        const mine = sorted.findIndex(([id]) => id === clientState.me);
        const shown = mine >= 10 ? [...sorted.keys()].slice(0, 9).concat(mine) : [...sorted.keys()].slice(0, 10);
        shown.forEach((i, n) => {
            const [id, p] = sorted[i];
            const lp = clientState.players[id];
            const li = el('li', (id === clientState.me ? 'me' : '') + (n > 0 && i !== shown[n - 1] + 1 ? ' gapline' : ''));
            const team = el('span', 'tt-team');
            team.style.background = teamInfo[lp.teamId]?.chatColor || '#888';
            // Three-letter code like the TV graphic, unless two drivers share it
            const name = el('span', 'tt-name', codes.indexOf(codes[i]) !== codes.lastIndexOf(codes[i]) ? lp.username.slice(0, 8) : codes[i]);
            li.append(el('span', 'tt-pos', p.rank), team, name);
            if (p.inPit && !quali) li.append(el('span', 'tt-tag', 'PIT'));
            if (p.penalty && !clientState.settings?.hidePenaltiesDuringRace) li.append(el('span', 'tt-tag pen', `+${p.penalty}s`));
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
    updateRadar();
}

const radarBubblesMap = new Map();

function updateRadar() {
    const gs = clientState.gameState;
    const radarContainer = $('proximity-radar');
    if (!radarContainer) return;

    if (!gs || clientState.status === 'LOBBY' || !camera) {
        radarContainer.classList.add('hidden');
        for (const [id, bState] of radarBubblesMap.entries()) bState.el?.remove();
        radarBubblesMap.clear();
        return;
    }

    const isWatch = watching();
    const followId = isWatch && spectateId && gs[spectateId] ? spectateId : clientState.me;
    const me = gs[followId];
    if (!me) {
        radarContainer.classList.add('hidden');
        for (const [id, bState] of radarBubblesMap.entries()) bState.el?.remove();
        radarBubblesMap.clear();
        return;
    }

    const W = window.innerWidth, H = window.innerHeight;
    const pad = 28;
    const minX = pad + 22, maxX = W - pad - 22;
    const minY = pad + 22, maxY = H - pad - 22;
    const halfW = (maxX - minX) / 2;
    const halfH = (maxY - minY) / 2;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const mePos = new THREE.Vector3(me.x, cars[followId]?.root ? cars[followId].root.position.y : ROAD_DRAW_Y, me.y);
    const activeIds = new Set();

    for (const id in gs) {
        if (id === followId) continue;
        const p = gs[id];
        const lp = clientState.players[id];
        if (!lp) continue;

        const carRoot = cars[id]?.root;
        const carPos = carRoot ? carRoot.position.clone() : new THREE.Vector3(p.x, roadY ? roadY(p.x, p.y, p.angle) : ROAD_DRAW_Y, p.y);

        // Distance limit extended to 200 meters
        const distM = mePos.distanceTo(carPos) / scale;
        if (distM > 200) continue;

        // Transform into camera local coordinates
        const camSpace = carPos.clone().applyMatrix4(camera.matrixWorldInverse);

        // Project into screen Normalized Device Coordinates (NDC)
        const ndc = carPos.clone().project(camera);

        // Visibility check: If in front of camera and within visible viewport bounds, do not show bubble
        const isVisible = (camSpace.z < 0 && ndc.x >= -0.92 && ndc.x <= 0.92 && ndc.y >= -0.92 && ndc.y <= 0.92);
        if (isVisible) continue;

        activeIds.add(id);

        // Direction in screen space:
        // camSpace.x: negative = left, positive = right
        // camSpace.z: positive = behind (down towards bottom edge), negative = ahead (up towards top edge)
        const dirX = camSpace.x;
        const dirY = camSpace.z;
        const len = Math.hypot(dirX, dirY) || 1e-5;
        const ndx = dirX / len;
        const ndy = dirY / len;

        // Raycast from (midX, midY) in direction (ndx, ndy) to screen edge box
        const absNdx = Math.abs(ndx);
        const absNdy = Math.abs(ndy);
        let s = 1;
        if (absNdx * halfH > absNdy * halfW) {
            s = halfW / (absNdx || 1e-5);
        } else {
            s = halfH / (absNdy || 1e-5);
        }

        const posX = midX + ndx * s;
        const posY = midY + ndy * s;

        // Angle in degrees for directional pointer
        const arrowAngleDeg = Math.atan2(ndy, ndx) * (180 / Math.PI);

        // 3-letter driver code uppercase
        const shortName = (lp.username || 'CAR').trim().slice(0, 3).toUpperCase();
        const teamColor = lp.color || '#38bdf8';
        const isDanger = distM < 12;
        const isFarDot = distM > 105;

        // Dynamic scale: 105m-30m = 0.70..1.00; <30m = 1.00..1.35x max growth!
        let targetScale = 1.0;
        if (distM > 105) {
            targetScale = 0.60;
        } else if (distM > 30) {
            targetScale = 0.70 + 0.30 * (1 - (distM - 30) / 75);
        } else {
            targetScale = 1.00 + 0.35 * (1 - Math.max(0, distM) / 30);
        }

        let bState = radarBubblesMap.get(id);
        if (!bState) {
            const bubble = document.createElement('div');
            bubble.className = 'offscreen-bubble';
            bubble.innerHTML = `
                <div class="bubble-pointer"></div>
                <div class="bubble-circle">
                    <span class="bubble-tag"></span>
                    <span class="bubble-dist"></span>
                </div>
            `;
            radarContainer.appendChild(bubble);
            bState = { el: bubble, x: posX, y: posY, angle: arrowAngleDeg, scale: targetScale, init: false };
            radarBubblesMap.set(id, bState);
        }

        // Exponential smoothing for fluid non-jitter edge movement
        if (!bState.init) {
            bState.x = posX;
            bState.y = posY;
            bState.angle = arrowAngleDeg;
            bState.scale = targetScale;
            bState.init = true;
        } else {
            const lerpFactor = 0.16;
            bState.x += (posX - bState.x) * lerpFactor;
            bState.y += (posY - bState.y) * lerpFactor;

            let diff = arrowAngleDeg - bState.angle;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            bState.angle += diff * lerpFactor;
            bState.scale += (targetScale - bState.scale) * lerpFactor;
        }

        const bubble = bState.el;
        bubble.style.transform = `translate3d(${bState.x.toFixed(1)}px, ${bState.y.toFixed(1)}px, 0)`;
        bubble.style.setProperty('--team-color', teamColor);
        bubble.style.setProperty('--bubble-scale', bState.scale.toFixed(3));
        bubble.classList.toggle('danger', isDanger);
        bubble.classList.toggle('bubble-dot', isFarDot);

        const circle = bubble.querySelector('.bubble-circle');
        if (circle && !isFarDot) {
            circle.style.transform = `scale(${bState.scale.toFixed(3)})`;
        } else if (circle && isFarDot) {
            circle.style.transform = 'none';
        }

        const pointer = bubble.querySelector('.bubble-pointer');
        if (pointer) pointer.style.transform = `rotate(${bState.angle.toFixed(1)}deg)`;

        if (!isFarDot) {
            const tag = bubble.querySelector('.bubble-tag');
            if (tag && tag.textContent !== shortName) tag.textContent = shortName;

            const distEl = bubble.querySelector('.bubble-dist');
            if (distEl) distEl.textContent = `${Math.round(distM)}m`;
        }
    }

    // Remove bubbles for cars that entered the viewport or are no longer tracked
    for (const [id, bState] of radarBubblesMap.entries()) {
        if (!activeIds.has(id)) {
            bState.el.remove();
            radarBubblesMap.delete(id);
        }
    }

    radarContainer.classList.toggle('hidden', activeIds.size === 0);
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

    // Mini Legend in top-left
    mm.font = 'bold 9px Outfit, sans-serif';
    mm.textBaseline = 'middle';
    const legendItems = [
        { label: 'S1', color: '#38bdf8' },
        { label: 'S2', color: '#fbbf24' },
        { label: 'S3', color: '#ec4899' },
        { label: 'DRS', color: '#22c55e' }
    ];
    let lx = 6;
    for (const item of legendItems) {
        mm.fillStyle = item.color;
        mm.beginPath();
        mm.arc(lx + 4, 10, 3, 0, Math.PI * 2);
        mm.fill();
        mm.fillStyle = 'rgba(255,255,255,0.85)';
        mm.fillText(item.label, lx + 9, 10);
        lx += mm.measureText(item.label).width + 16;
    }

    if (t.pit) {
        mm.strokeStyle = 'rgba(255,255,255,0.35)';
        mm.lineWidth = 2;
        mm.beginPath();
        t.pit.path.filter((_, i) => t.pit.cum[i] >= t.pit.closeS)
            .forEach((p, i) => (i ? mm.lineTo(mx(p.x), my(p.y)) : mm.moveTo(mx(p.x), my(p.y))));
        mm.stroke();
    }

    // Sectors: split lap into Sector 1, 2, and 3
    const n = t.path.length;
    const totalLap = t.cum[n];
    const s2 = t.checkpoints && t.sectorCps ? (t.checkpoints[t.sectorCps[1]]?.s ?? totalLap / 3) : totalLap / 3;
    const s3 = t.checkpoints && t.sectorCps ? (t.checkpoints[t.sectorCps[2]]?.s ?? (2 * totalLap) / 3) : (2 * totalLap) / 3;
    const sectorColors = ['#38bdf8', '#fbbf24', '#ec4899'];
    const getSector = (s) => (s < s2 ? 0 : s < s3 ? 1 : 2);
    const inDrs = (s) => (t.drsZones || []).some(z => (z.startS <= z.endS ? s >= z.startS && s < z.endS : s >= z.startS || s < z.endS));

    // Base track stroke: colored by Sector
    mm.lineWidth = 3.5;
    mm.lineCap = 'round';
    mm.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
        const nextI = (i + 1) % n;
        const p1 = t.path[i], p2 = t.path[nextI];
        const lapS = (((t.cum[i] - (t.startS || 0)) % totalLap) + totalLap) % totalLap;
        const sec = getSector(lapS);
        mm.strokeStyle = sectorColors[sec];
        mm.beginPath();
        mm.moveTo(mx(p1.x), my(p1.y));
        mm.lineTo(mx(p2.x), my(p2.y));
        mm.stroke();
    }

    // Highlight DRS Zones as a parallel neon green strip alongside the track (sectors remain 100% clear)
    if (t.drsZones && t.drsZones.length) {
        mm.lineWidth = 2.5;
        mm.strokeStyle = '#22c55e';
        mm.lineCap = 'round';
        for (let i = 0; i < n; i++) {
            const nextI = (i + 1) % n;
            const p1 = t.path[i], p2 = t.path[nextI];
            const lapS = (((t.cum[i] - (t.startS || 0)) % totalLap) + totalLap) % totalLap;
            if (inDrs(lapS)) {
                const sx1 = mx(p1.x), sy1 = my(p1.y);
                const sx2 = mx(p2.x), sy2 = my(p2.y);
                const dx = sx2 - sx1, dy = sy2 - sy1;
                const len = Math.hypot(dx, dy) || 1;
                const nx = -dy / len, ny = dx / len;
                const offset = 4.5;
                mm.beginPath();
                mm.moveTo(sx1 + nx * offset, sy1 + ny * offset);
                mm.lineTo(sx2 + nx * offset, sy2 + ny * offset);
                mm.stroke();
            }
        }
    }

    // Start / Finish Line perpendicular hash
    if (t.start !== undefined && t.path[t.start]) {
        const sp = t.path[t.start];
        const nextP = t.path[(t.start + 1) % n];
        const dirX = nextP.x - sp.x, dirY = nextP.y - sp.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const nx = -dirY / len, ny = dirX / len;
        const markW = 6 / k; // ~6px in canvas units
        mm.strokeStyle = '#ffffff';
        mm.lineWidth = 2.5;
        mm.beginPath();
        mm.moveTo(mx(sp.x - nx * markW), my(sp.y - ny * markW));
        mm.lineTo(mx(sp.x + nx * markW), my(sp.y + ny * markW));
        mm.stroke();
    }

    const isWatch = watching();
    const focusId = isWatch && spectateId && gs[spectateId] ? spectateId : clientState.me;

    // 1) Draw opponents first with strong dark borders so they stand out clearly over any sector or DRS lines
    for (const id in gs) {
        if (id === focusId) continue;
        const lp = clientState.players[id];
        if (!lp) continue;
        const px = mx(gs[id].x), py = my(gs[id].y);
        mm.fillStyle = '#000000';
        mm.beginPath();
        mm.arc(px, py, 5.2, 0, Math.PI * 2);
        mm.fill();
        mm.fillStyle = lp.color;
        mm.beginPath();
        mm.arc(px, py, 4.0, 0, Math.PI * 2);
        mm.fill();
        mm.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        mm.lineWidth = 1;
        mm.stroke();
    }

    // 2) Draw focused car (own car or spectated car) LAST on top with radiant halo & heading pointer
    if (focusId && gs[focusId] && clientState.players[focusId]) {
        const fp = clientState.players[focusId];
        const fg = gs[focusId];
        const fx = mx(fg.x), fy = my(fg.y);

        // Soft outer glowing halo
        mm.fillStyle = 'rgba(255, 255, 255, 0.38)';
        mm.beginPath();
        mm.arc(fx, fy, 9.5, 0, Math.PI * 2);
        mm.fill();

        // Dark outline
        mm.fillStyle = '#000000';
        mm.beginPath();
        mm.arc(fx, fy, 7.5, 0, Math.PI * 2);
        mm.fill();

        // White contrast ring
        mm.strokeStyle = '#ffffff';
        mm.lineWidth = 2.4;
        mm.beginPath();
        mm.arc(fx, fy, 6.2, 0, Math.PI * 2);
        mm.stroke();

        // Inner car color disc
        mm.fillStyle = fp.color;
        mm.beginPath();
        mm.arc(fx, fy, 4.8, 0, Math.PI * 2);
        mm.fill();

        // Direction pointer (chevron pointing in car heading)
        const dirAng = fg.angle;
        const tipX = fx + Math.cos(dirAng) * 9.5, tipY = fy + Math.sin(dirAng) * 9.5;
        mm.beginPath();
        mm.moveTo(tipX, tipY);
        mm.lineTo(fx + Math.cos(dirAng + 2.45) * 5.2, fy + Math.sin(dirAng + 2.45) * 5.2);
        mm.lineTo(fx + Math.cos(dirAng) * 2.5, fy + Math.sin(dirAng) * 2.5);
        mm.lineTo(fx + Math.cos(dirAng - 2.45) * 5.2, fy + Math.sin(dirAng - 2.45) * 5.2);
        mm.closePath();
        mm.fillStyle = '#ffffff';
        mm.fill();
        mm.strokeStyle = '#000000';
        mm.lineWidth = 1;
        mm.stroke();
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
let autoMs = 0, autoFrames = 0; // auto-pick: frame time while driving
const stats = new URLSearchParams(location.search).has('stats') ? Object.assign(document.createElement('div'), { id: 'stats' }) : null;
if (stats) document.body.appendChild(stats);
if (stats) window.lanraceDebug = { renderer, scene, camera, freeCam: false }; // ?stats=1: profiling / looking around from the console

// Sound + gear HUD: gearboxes for your car and every other car (cheap), audio frame in metres (track plane)
const ownBox = new Gearbox(), remoteBoxes = new Map(), soundOthers = [];
const ownFrame = { rpm: 0, load: 0, limiter: false, pit: false, speedMs: 0 };
const listenerFrame = { x: 0, y: 0, fx: 1, fy: 0, vx: 0, vy: 0 }, sndFrame = { own: null, others: soundOthers, listener: listenerFrame };
const silentFrame = { own: null, others: [], listener: listenerFrame };
const camDir = new THREE.Vector3();
let lastDrs = false, hudLit = -1, hudFlash = null, hudGear = '';
function updateSound(dt) {
    const gs = clientState.gameState, me = gs[clientState.me], racing = !!me && !isSpectator();
    const isWatch = watching();
    const followId = racing && !isWatch ? clientState.me : spectateId; // dash and engine: the car on screen
    let hud = null, hudSpeed = 0, followVx = 0, followVy = 0;
    soundOthers.length = 0;
    for (const id in gs) {
        if (racing && !isWatch && id === clientState.me) continue;
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
    if (racing && !isWatch) {
        const v = me.speed / scale, g = ownBox.update(v, input.throttle, dt, !!me.limiter);
        for (const e of g.events) Sound.event(e === 'up' ? 'shift_up' : 'shift_down');
        if (!!me.drs !== lastDrs) { lastDrs = !!me.drs; Sound.event('drs'); }
        ownFrame.rpm = g.rpm; ownFrame.load = input.throttle; ownFrame.limiter = g.limiter; ownFrame.pit = g.pit; ownFrame.speedMs = v;
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
    updateSmokeParticles(dt);
    updateCars(dt);
    updateWheelBatch();
    if (!window.lanraceDebug?.freeCam) updateCamera(dt);
    skyDome.position.copy(camera.position);
    skyDome.scale.setScalar(camera.far * 0.9);
    if (paused) Sound.update(silentFrame); else updateSound(dt);
    if (!compiling) renderer.render(scene, camera); // a draw before the shaders are ready compiles them there and then (a ~1.6 s freeze)

    if (now - lastHud > 66) { // HUD and minimap at 15 Hz, timing tower at 4 Hz
        updateHUD(now - lastTower > 250);
        if (now - lastTower > 250) lastTower = now;
        drawMinimap();
        colourLine();
        lastHud = now;
    }
    if (netstatsOn && now - lastNetstats > 250) { lastNetstats = now; drawNetstats(); }

    fpsFrames++;
    const me = clientState.gameState[clientState.me];
    if (choice === 'auto' && !store.get('lanrace.quality.auto') && me && Math.abs(me.speed) > 0) {
        autoMs += dt * 1000;
        autoFrames++;
        if (autoMs > 5000) {
            const picked = autoPick(autoMs / autoFrames, level, window.devicePixelRatio);
            store.set('lanrace.quality.auto', picked); // used from the next race
        }
    }
    if (now - fpsSince > 1500) { // lobby, loading or a background tab: not a real measurement
        fpsFrames = 0;
        fpsSince = now;
    } else if (now - fpsSince >= 1000) {
        const fps = (fpsFrames * 1000) / (now - fpsSince);
        window.lanraceFps = fps; // network log telemetry (socket.js)
        const next = adaptStep(res, fps);
        if (next.ratio !== res.ratio) renderer.setPixelRatio(next.ratio);
        res = next;
        fpsHist.push(fps);
        if (fpsHist.length > 6) fpsHist.shift();
        if (!capWarned && res.noDrop && frameCapped(fpsHist)) { // lowering resolution didn't help: a real cap
            capWarned = true;
            window.showBanner?.('30 FPS CAP — plug in the charger or turn off Chrome Energy Saver');
        }
        if (stats) stats.textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.calls} calls · ${res.ratio.toFixed(2)}× · ${level}${choice === 'auto' ? ' (auto)' : ''}`;
        fpsFrames = 0;
        fpsSince = now;
    }
}

window.initGameVisuals = () => {
    window.lanraceAudio?.stopEngineTest?.();
    netBuf = new SnapshotBuffer();
    // New session: predict from the new grid (reset on our first entry); spectators never get one, so never predict
    predictor = new Predictor(clientState.trackData, clientState.gameState?.[clientState.me]?.assist || 'off', clientState.settings);
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
