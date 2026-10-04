import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { keyboardStep, gamepadInput } from './input.js';
import { LEVELS, ratioRange, resolveLevel, autoPick, adaptStep, snapLight, frameCapped } from './quality.js';
import { placeScenery, seedOf } from './scenery.js';
import { SnapshotBuffer, RenderClock, sample, samplePresent, decodeFlags } from './netsync.js';
import { Predictor, STEP_S } from './predict.js';
import { Gearbox, shiftLights } from './audio/gearbox.js';
import { estimateLoad } from './audio/mix.js';
import * as Sound from './audio/audio.js';
import { gapText, driverCode, lapDelta, stepFollow, inDrsZone, drsHint, liveSectors, resultCells } from './timing.js';
import { MODES, segmentColor, cornerMask, aheadM, trackIndex, nextMode } from './racingline.js';

// World units per metre come from the track JSON (track.scale = 6).
const WHEEL_RADIUS_M = 0.36;  // scripts/car_parts.py WHEEL_RADIUS
const WALL_OFFSET = 80;       // src/game/Player.js invisible wall beyond the track edge
const CHASE_BACK_M = 10, CHASE_UP_M = 4, LOOK_AHEAD_M = 6;
const CAM_TURN_SMOOTH = 8; // 1/s; time-based so lag doesn't grow at low frame rates
const KERB_TURN = 0.05;
const TAG_FULL_M = 40, TAG_GONE_M = 120; // name labels fade out between these camera distances       // rad per path segment (~10 m) → radius under ~200 m gets kerbs
const PIT_RUNOFF_M = 2; // src/game/Game.js barrier outside the pit lane
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
let res = { ...ratioRange(level, window.devicePixelRatio), good: 0 };
res.ratio = res.start;
renderer.setPixelRatio(res.ratio);

const SKY = 0x9cc8ef;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
const camera = new THREE.PerspectiveCamera(60, 1, 2, Q.far);
scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x4f7a2a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
const SUN_OFF = { x: 600, y: 1800, z: 400 }; // sun position relative to the shadow target
Object.assign(sun.shadow.camera, { left: -360, right: 360, top: 360, bottom: -360, near: 10, far: 4000 }); // ±60 m around your car
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
function toggleAssist() {
    if (isSpectator()) return;
    window.setAssist?.(store.get('lanrace.assist') === 'off' ? 'full' : 'off');
}
window.onAssistChange = (v) => {
    if (predictor) { predictor.assist = v; if (predictor.car) predictor.car.assist = v; }
    if (clientState.status !== 'LOBBY') window.showBanner?.(`ASSIST: ${v === 'off' ? 'OFF' : 'FULL'}`, true);
};

function isSpectator() {
    return !!clientState.players[clientState.me]?.isSpectating || !clientState.gameState?.[clientState.me];
}

function onKey(e, down) {
    if (e.target?.matches?.('input, textarea, select')) return; // typing a name or a chat line, not driving
    const key = e.key.toLowerCase();
    if (down && key === 't' && !e.repeat && clientState.status !== 'LOBBY') toggleTower();
    if (down && key === 'r' && !e.repeat && clientState.status !== 'LOBBY') toggleLine();
    if (down && key === 'q' && !e.repeat && clientState.status !== 'LOBBY') toggleAssist();
    if (down && key === 'p' && !e.repeat && clientState.status !== 'LOBBY' && clientState.hostId === clientState.me) {
        socket.emit('toggle_pause');
    }
    if (down && key === 'm' && !e.repeat) window.showBanner?.(Sound.toggleMute() ? 'SOUND: MUTED' : 'SOUND: ON', true);
    if (down && e.key === 'F3') { e.preventDefault(); netstatsOn = !netstatsOn; netstatsEl.classList.toggle('hidden', !netstatsOn); }
    if (down && clientState.status !== 'LOBBY' && isSpectator()) {
        if (key === 'arrowleft') spectateId = stepFollow(rankedCarIds(), spectateId, -1);
        if (key === 'arrowright') spectateId = stepFollow(rankedCarIds(), spectateId, 1);
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
        const autoBrake = (window.lanraceMem?.['lanrace.autobrake'] === 'on');
        input = pad || touchInput || keyboardStep(input, keys, STEP_S, autoBrake);
    }
    const stamped = {
        seq: ++inputSeq,
        steer: input.steer,
        throttle: input.throttle,
        brake: input.brake,
        drs: !!input.drs,
        handbrake: !!input.handbrake,
        explicitReverse: !!input.explicitReverse
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

// ---------- track geometry ----------
let world = null;
let scale = 6;
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

// Offset every path point sideways (positive = left of travel in screen space)
function offsetPoints(path, offset) {
    const n = path.length;
    return path.map((p, i) => {
        const prev = path[(i - 1 + n) % n], next = path[(i + 1) % n];
        let dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        return { x: p.x - dy * offset, y: p.y + dx * offset };
    });
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
    const a = offsetPoints(path, from), b = offsetPoints(path, to);
    const pos = [], col = [], uv = [];
    const rep = (opts.repeatM || 8) * scale;
    let along = 0;
    for (let i = 0; i < path.length; i++) {
        const j = (i + 1) % path.length;
        const seg = Math.hypot(path[j].x - path[i].x, path[j].y - path[i].y);
        if (keep(i)) {
            const c = colorAt(i), v0 = along / rep, v1 = (along + seg) / rep;
            pos.push(a[i].x, y, a[i].y, b[i].x, y, b[i].y, b[j].x, y, b[j].y,
                     a[i].x, y, a[i].y, b[j].x, y, b[j].y, a[j].x, y, a[j].y);
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
function wall(path, offset, height, keep, colorAt) {
    const a = offsetPoints(path, offset);
    const pos = [], col = [];
    for (let i = 0; i < path.length; i++) {
        if (!keep(i)) continue;
        const j = (i + 1) % path.length;
        const c = colorAt(i);
        pos.push(a[i].x, 0, a[i].y, a[j].x, 0, a[j].y, a[j].x, height, a[j].y,
                 a[i].x, 0, a[i].y, a[j].x, height, a[j].y, a[i].x, height, a[i].y);
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    return coloredMesh(pos, col);
}

function grassTexture(w, h) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#5f9e35'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#69a83c'; g.fillRect(0, 0, 32, 64);
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
    m.position.set(start.x, 1.0, start.y);
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
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        bars.push({ x: g.x + fx * 3 * scale, y: 0.9, z: g.y + fy * 3 * scale, angle: -g.angle });
        nums.push({ text: String(i + 1), x: g.x + fx * 4.6 * scale, y: 0.95, z: g.y + fy * 4.6 * scale, rotY: facing(g.angle), flat: true });
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
    world.add(strip(pit.path, -ph, ph, 0.55, open, solid('#3a3f47')));
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
        m.position.set(b.x, 2 * scale, b.y);
        m.rotation.y = facing(p.angle);
        world.add(m);
    };
    board(pit.closeS - 15 * scale, 'PIT CLOSED', '#d62828'); // ahead of the limiter board, seen first
    board(Math.max(pit.limStart, pit.closeS), 'PIT LIMIT 80', '#1e5bd8');
    board(pit.limEnd, 'END LIMIT', '#1e5bd8');
    board(pit.cum[n - 3], 'PIT OUT', '#2a9d3f');
    world.add(wall(pit.closeWall, 0, 1.2 * scale, (i) => i === 0, solid('#d62828')));
    for (const s0 of [Math.max(pit.limStart, pit.closeS), pit.limEnd]) {
        const p = at(s0), m = flat(0.5 * scale, pit.width, 0xf2f2f2);
        m.position.set(p.x, 0.9, p.y);
        m.rotation.y = -p.angle;
        world.add(m);
    }

    const buildings = [], signs = [], marks = [];
    for (const g of pit.garages) {
        const info = teamInfo[g.teamId] || { name: g.teamId, chatColor: '#888888' };
        const c = side(g, g.angle, -s * (back + 2.5 * scale));
        buildings.push({ x: c.x, y: 3 * scale, z: c.y, angle: -g.angle });
        const f = side(g, g.angle, -s * (back - 0.1 * scale));
        signs.push({ text: info.name.toUpperCase(), x: f.x, y: 5 * scale, z: f.y, rotY: s > 0 ? -g.angle : Math.PI - g.angle, bg: info.chatColor });
        for (const b of g.boxes) marks.push({ x: b.x, y: 0.8, z: b.y, angle: -b.angle, color: info.chatColor });
    }
    const bGeo = new THREE.BoxGeometry(18 * scale, 6 * scale, 5 * scale);
    const garagesMesh = instanced(bGeo, new THREE.MeshStandardMaterial({ color: 0x2b2f36 }), buildings);
    garagesMesh.castShadow = true;
    world.add(garagesMesh);
    world.add(atlasPlanes(signs, 17 * scale, 1.6 * scale, '#888888'));
    const mGeo = new THREE.PlaneGeometry(6 * scale, 2.6 * scale);
    mGeo.rotateX(-Math.PI / 2);
    world.add(instanced(mGeo, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45 }), marks));
}

const solid = (hex) => { const c = new THREE.Color(hex); return () => c; };

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
    const pos = new Float32Array(n * 36);
    for (let i = 0; i < n; i++) {
        const a = L[i], b = L[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
        const at = (f, s) => ({ x: a.x + tx * len * f - ty * w * s, y: a.y + ty * len * f + tx * w * s });
        const BL = at(0, 1), BR = at(0, -1), NOTCH = at(0.35, 0), FL = at(0.6, 1), FR = at(0.6, -1), TIP = at(0.95, 0);
        [BL, FL, NOTCH, FL, TIP, NOTCH, TIP, FR, NOTCH, FR, BR, NOTCH].forEach((p, v) => {
            const k = i * 36 + v * 3;
            pos[k] = p.x; pos[k + 1] = y; pos[k + 2] = p.y;
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
    // Quali → race on the same track: keep the world (rebuilding recompiles every shader and stalls the lights);
    // only the cars and the racing line are per session
    if (world && world.userData.trackId === t.id && world.userData.level === level) {
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
        const keep = new Set([asphaltTex, blobTex, envTex, ...Object.values(liveries)]);
        world.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.isInstancedMesh) o.dispose();
            for (const m of [].concat(o.material || [])) {
                if (m.map && !keep.has(m.map)) m.map.dispose();
                m.dispose();
            }
        });
    }
    for (const id in cars) delete cars[id];
    wheelBatch = null; // rebuilt in the new world

    scale = t.scale;
    world = new THREE.Group();
    world.userData = { trackId: t.id, level };
    scene.add(world);

    const path = t.path, half = t.width / 2, n = path.length;
    bounds = getBounds(path);
    const all = () => true;
    const alternate = (h1, h2) => { const a = new THREE.Color(h1), b = new THREE.Color(h2); return (i) => (i % 2 ? a : b); };

    const gw = bounds.maxX - bounds.minX + 8000, gh = bounds.maxY - bounds.minY + 8000;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshStandardMaterial({ map: grassTexture(gw, gh), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minY + bounds.maxY) / 2);
    ground.receiveShadow = true;
    world.add(ground);

    world.add(strip(path, -half, half, 0.6, all, solid('#4a505a'), { map: asphaltTexture(), repeatM: 8 }));
    const inset = 0.5 * scale, lineW = 0.3 * scale;
    world.add(strip(path, half - inset - lineW, half - inset, 0.9, all, solid('#f2f2f2'), { layer: 2 }));
    world.add(strip(path, -half + inset, -half + inset + lineW, 0.9, all, solid('#f2f2f2'), { layer: 2 }));

    // Kerbs on corners (visual only), widened by 2 points so they don't flicker on and off
    const turny = path.map((_, i) => turnAngle(path, i) > KERB_TURN);
    const curvy = turny.map((_, i) => [-2, -1, 0, 1, 2].some((d) => turny[(i + d + n) % n]));
    const kerbW = 1.5 * scale;
    world.add(strip(path, half, half + kerbW, 0.7, (i) => curvy[i], alternate('#d62828', '#f2f2f2'), { layer: 1 }));
    world.add(strip(path, -half - kerbW, -half, 0.7, (i) => curvy[i], alternate('#d62828', '#f2f2f2'), { layer: 1 }));

    const scen = placeScenery(t, Q.scenery, seedOf(t.id));
    const onSlow = (side) => {
        const mark = new Array(n).fill(false);
        for (const c of scen.slowCorners) if (c.side === side) for (let i = c.from; i !== c.to; i = (i + 1) % n) mark[i] = true;
        return mark;
    };
    const slowOut = { 1: onSlow(1), [-1]: onSlow(-1) };
    // Gravel traps on the outside of slow corners, between the kerb and the barrier (visual only)
    for (const dir of [1, -1]) {
        const from = dir > 0 ? half + kerbW : -(half + WALL_OFFSET - 1 * scale), to = dir > 0 ? half + WALL_OFFSET - 1 * scale : -(half + kerbW);
        world.add(strip(path, from, to, 0.4, (i) => slowOut[dir][i], solid('#cdb98f')));
    }
    // Rubbered-in racing line through slow corners: inside at the apex, drifting out on exit (Medium/High)
    if (Q.tyreMarks) {
        for (const c of scen.slowCorners) {
            const inside = -c.side; // the outside is c.side
            world.add(strip(path, inside * half * 0.15, inside * half * 0.55, 0.62, (i) => {
                const len = (c.to - c.from + n) % n, k = (i - c.from + n) % n;
                return k < len;
            }, solid('#1a1c20'), { opacity: 0.35, layer: 1 }));
        }
    }
    // Thin dark outer edge on the kerbs so they read at speed
    world.add(strip(path, half + kerbW - 0.2 * scale, half + kerbW, 0.72, (i) => curvy[i], solid('#5a1414'), { layer: 2 }));
    world.add(strip(path, -half - kerbW, -half - kerbW + 0.2 * scale, 0.72, (i) => curvy[i], solid('#5a1414'), { layer: 2 }));
    buildRacingLine(t);

    // Barriers exactly where the physics wall is; skipped where another part of the track is closer
    const wallOff = half + WALL_OFFSET;
    for (const dir of [1, -1]) {
        const ok = offsetPoints(path, dir * wallOff).map((p) => distToPath(p, path) > wallOff * 0.95
            && !(t.pit && distToPath(p, t.pit.path, false) < t.pit.width / 2 + (PIT_RUNOFF_M + 2) * scale));
        const redWhite = alternate('#d62828', '#f2f2f2'), tyre = solid('#1b1b1b');
        world.add(wall(path, dir * wallOff, 1 * scale, (i) => ok[i] && ok[(i + 1) % n], (i) => (slowOut[dir][i] ? tyre(i) : redWhite(i))));

    }

    // Trees: trunk + crown, two sizes, one draw each
    const trunks = [], crowns = [];
    for (const tr of scen.trees) {
        const k = tr.size === 2 ? 1.6 : 1;
        trunks.push({ x: tr.x, y: 2 * scale * k, z: tr.y, sx: k, sy: k, sz: k });
        crowns.push({ x: tr.x, y: 7 * scale * k, z: tr.y, sx: k, sy: k, sz: k });
    }
    world.add(instanced(new THREE.CylinderGeometry(0.4 * scale, 0.5 * scale, 4 * scale, 6), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 }), trunks));
    world.add(instanced(new THREE.ConeGeometry(3 * scale, 9 * scale, 7), new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 1 }), crowns));

    // Grandstands: stepped stand + coloured seats
    const stands = [], seats = [];
    for (const g of scen.grandstands) {
        stands.push({ x: g.x, y: 4 * scale, z: g.y, angle: -g.angle });
        seats.push({ x: g.x, y: 8.2 * scale, z: g.y, angle: -g.angle });
    }
    world.add(instanced(new THREE.BoxGeometry(60 * scale, 8 * scale, 12 * scale), new THREE.MeshStandardMaterial({ color: 0x9aa0a6 }), stands));
    world.add(instanced(new THREE.BoxGeometry(58 * scale, 0.6 * scale, 10 * scale), new THREE.MeshStandardMaterial({ color: 0x1e5bd8 }), seats));

    // Billboards: one atlas, facing the track
    const boards = scen.billboards.map((b) => ({
        text: b.text, x: b.x, y: 2.5 * scale, z: b.y, rotY: b.side > 0 ? -b.angle : Math.PI - b.angle,
        bg: ['#d62828', '#1e5bd8', '#2a9d3f', '#111827'][b.text.length % 4],
    }));
    if (boards.length) world.add(atlasPlanes(boards, 12 * scale, 3 * scale, '#111827'));

    world.add(startLine(t.start, t.width));
    gridBoxes(t.startPositions);
    if (t.pit) buildPit(t.pit, t);
    snapCamera = true;
}

// ---------- cars & particle systems ----------
let carTemplate = null;
let sportsCarTemplate = null;
const failedLiveries = new Set();
const liveries = {};
const texLoader = new THREE.TextureLoader();

class SmokeParticleSystem {
    constructor(parentScene, maxParticles = 240) {
        this.maxParticles = maxParticles;
        this.particles = [];
        this.index = 0;
        
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, 'rgba(240, 240, 248, 0.7)');
        grad.addColorStop(0.4, 'rgba(215, 220, 230, 0.4)');
        grad.addColorStop(1, 'rgba(200, 205, 215, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(c);

        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.InstancedMesh(geo, mat, maxParticles);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 4;
        parentScene.add(this.mesh);

        this.dummy = new THREE.Object3D();
        for (let i = 0; i < maxParticles; i++) {
            this.dummy.position.set(0, -9999, 0);
            this.dummy.scale.set(0, 0, 0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            this.particles.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, maxAge: 1, size: 1, rot: 0, vRot: 0 });
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    emit(x, y, z, vx, vy, speed, intensity = 1.0) {
        const p = this.particles[this.index];
        p.active = true;
        p.x = x + (Math.random() - 0.5) * 0.4;
        p.y = y + 0.2 + Math.random() * 0.2;
        p.z = z + (Math.random() - 0.5) * 0.4;
        p.vx = vx * 0.12 + (Math.random() - 0.5) * 1.5;
        p.vy = 0.6 + Math.random() * 1.0;
        p.vz = vy * 0.12 + (Math.random() - 0.5) * 1.5;
        p.age = 0;
        p.maxAge = 0.7 + Math.random() * 0.5;
        p.size = (2.0 + Math.random() * 1.5) * Math.min(2.5, intensity);
        p.rot = Math.random() * Math.PI * 2;
        p.vRot = (Math.random() - 0.5) * 2;
        this.index = (this.index + 1) % this.maxParticles;
    }

    update(dt, cam) {
        let needsUpdate = false;
        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.particles[i];
            if (!p.active) continue;
            p.age += dt;
            if (p.age >= p.maxAge) {
                p.active = false;
                this.dummy.position.set(0, -9999, 0);
                this.dummy.scale.set(0, 0, 0);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                needsUpdate = true;
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            p.rot += p.vRot * dt;

            const progress = p.age / p.maxAge;
            const currentSize = p.size * (1 + progress * 2.2);
            this.dummy.position.set(p.x, p.y, p.z);
            if (cam) this.dummy.quaternion.copy(cam.quaternion);
            this.dummy.scale.set(currentSize, currentSize, currentSize);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            needsUpdate = true;
        }
        if (needsUpdate) this.mesh.instanceMatrix.needsUpdate = true;
    }
}

const smokeSystem = new SmokeParticleSystem(scene);

function createProceduralSportsCar(colorHex, vClass = 'tuner') {
    const group = new THREE.Group();
    const isNascar = vClass === 'nascar';
    const isGT3 = vClass === 'gt3';

    const bodyMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: isNascar ? 0.15 : 0.35,
        roughness: isNascar ? 0.45 : 0.28,
        envMap: Q.envMap ? envTexture() : null,
        envMapIntensity: 0.45
    });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x181c24, metalness: 0.2, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x090d16, metalness: 0.1, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x070b14, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.88 });
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x38bdf8, emissiveIntensity: 1.4, roughness: 0.1 });
    const taillightMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff1122, emissiveIntensity: 1.5, roughness: 0.2 });
    const intercoolerMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.3 });
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.3, roughness: 0.4 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 });
    const rimMat = new THREE.MeshStandardMaterial({ color: isNascar ? 0xfacc15 : 0xe2e8f0, metalness: 0.85, roughness: 0.2 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, metalness: 0.05 });

    // 1. Lower chassis tub & floor undertray
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 1.96), darkMat);
    floor.position.set(0, 0.14, 0);
    group.add(floor);

    // Side aero ground-effect skirts
    const skirtL = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.14), carbonMat);
    skirtL.position.set(0, 0.12, 1.0);
    const skirtR = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.14), carbonMat);
    skirtR.position.set(0, 0.12, -1.0);
    group.add(skirtL, skirtR);

    // 2. Main lower body / fuselage
    const mainBody = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.44, 1.84), bodyMat);
    mainBody.position.set(0, 0.36, 0);
    mainBody.castShadow = true;
    group.add(mainBody);

    // 3. Widebody aerodynamic fender flares (FL, FR, RL, RR)
    const flareFL = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.36, 0.22), bodyMat);
    flareFL.position.set(1.35, 0.42, 0.98);
    const flareFR = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.36, 0.22), bodyMat);
    flareFR.position.set(1.35, 0.42, -0.98);
    const flareRL = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.38, 0.24), bodyMat);
    flareRL.position.set(-1.35, 0.44, 0.99);
    const flareRR = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.38, 0.24), bodyMat);
    flareRR.position.set(-1.35, 0.44, -0.99);
    flareFL.castShadow = flareFR.castShadow = flareRL.castShadow = flareRR.castShadow = true;
    group.add(flareFL, flareFR, flareRL, flareRR);

    // 4. Sloped Hood with air extractor vents
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.2, 1.58), bodyMat);
    hood.position.set(1.22, 0.52, 0);
    hood.rotation.z = -0.06;
    hood.castShadow = true;
    group.add(hood);

    const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.75), carbonMat);
    hoodVent.position.set(1.1, 0.62, 0);
    hoodVent.rotation.z = -0.06;
    group.add(hoodVent);

    // 5. Cabin & Fastback greenhouse glass
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.42, 1.34), glassMat);
    cabin.position.set(-0.16, 0.78, 0);
    cabin.castShadow = true;
    group.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.06, 1.22), bodyMat);
    roof.position.set(-0.2, 0.99, 0);
    roof.castShadow = true;
    group.add(roof);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.38, 1.26), glassMat);
    windshield.position.set(0.62, 0.74, 0);
    windshield.rotation.z = 0.48;
    group.add(windshield);

    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.34, 1.22), glassMat);
    rearGlass.position.set(-0.95, 0.74, 0);
    rearGlass.rotation.z = -0.38;
    group.add(rearGlass);

    // 6. Front Splitter, Grille & Intercooler
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 2.08), carbonMat);
    splitter.position.set(2.2, 0.12, 0);
    group.add(splitter);

    const wingletL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), carbonMat);
    wingletL.position.set(2.25, 0.19, 1.04);
    const wingletR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), carbonMat);
    wingletR.position.set(2.25, 0.19, -1.04);
    group.add(wingletL, wingletR);

    // Front Intercooler Radiator core
    const intercooler = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.92), intercoolerMat);
    intercooler.position.set(2.18, 0.28, 0);
    group.add(intercooler);

    // Front Bumper Canards (dive planes)
    const canardL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.28), carbonMat);
    canardL.position.set(2.05, 0.32, 0.94);
    canardL.rotation.y = 0.3; canardL.rotation.z = -0.15;
    const canardR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.28), carbonMat);
    canardR.position.set(2.05, 0.32, -0.94);
    canardR.rotation.y = -0.3; canardR.rotation.z = -0.15;
    group.add(canardL, canardR);

    // Headlights (Projector LED with cyan glow)
    const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.36), headlightMat);
    hlL.position.set(2.12, 0.46, 0.68);
    const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.36), headlightMat);
    hlR.position.set(2.12, 0.46, -0.68);
    group.add(hlL, hlR);

    // 7. Rear Diffuser, Exhaust & Taillights
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 1.76), darkMat);
    diffuser.position.set(-2.08, 0.18, 0);
    diffuser.rotation.z = -0.12;
    group.add(diffuser);

    // Quad / Dual Titanium Exhaust Tips
    const exGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.25, 12);
    exGeo.rotateZ(Math.PI / 2);
    const exMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95, roughness: 0.2 });
    for (const zOff of [-0.62, -0.48, 0.48, 0.62]) {
        const ex = new THREE.Mesh(exGeo, exMat);
        ex.position.set(-2.22, 0.22, zOff);
        group.add(ex);
    }

    // Rear LED Taillight Bar
    const tlBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.62), taillightMat);
    tlBar.position.set(-2.14, 0.54, 0);
    group.add(tlBar);

    // 8. Rear Spoiler / Wing (GT3 / Swan-Neck or NASCAR Ducktail)
    if (isNascar) {
        // Muscular NASCAR Ducktail Blade Spoiler
        const ducktail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 1.72), carbonMat);
        ducktail.position.set(-2.05, 0.72, 0);
        ducktail.rotation.z = -0.28;
        ducktail.castShadow = true;
        group.add(ducktail);
    } else {
        // High-Downforce Swan-Neck GT Drift Wing
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 2.05), carbonMat);
        wing.position.set(-2.05, 1.12, 0);
        wing.rotation.z = 0.05;
        wing.castShadow = true;
        group.add(wing);

        const endL = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.04), carbonMat);
        endL.position.set(-2.05, 1.12, 1.04);
        const endR = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.04), carbonMat);
        endR.position.set(-2.05, 1.12, -1.04);
        group.add(endL, endR);

        const pylonL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.05), darkMat);
        pylonL.position.set(-1.95, 0.9, 0.55);
        pylonL.rotation.z = -0.15;
        const pylonR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.05), darkMat);
        pylonR.position.set(-1.95, 0.9, -0.55);
        pylonR.rotation.z = -0.15;
        group.add(pylonL, pylonR);
    }

    // 9. Wheel Assemblies (Tire + Multi-spoke Rim + Brake Disc & Stationary Caliper)
    const wheels = [];
    const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 24);
    tireGeo.rotateX(Math.PI / 2);
    const rimLipGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.33, 20);
    rimLipGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.34, 12);
    hubGeo.rotateX(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.045, 0.24, 0.33);
    const discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 18);
    discGeo.rotateX(Math.PI / 2);

    const coords = [
        { name: 'wheel_FL', pos: [1.35, 0.36, 0.95], left: true },
        { name: 'wheel_FR', pos: [1.35, 0.36, -0.95], left: false },
        { name: 'wheel_RL', pos: [-1.35, 0.36, 0.95], left: true },
        { name: 'wheel_RR', pos: [-1.35, 0.36, -0.95], left: false },
    ];

    for (const c of coords) {
        const wGroup = new THREE.Group();
        wGroup.name = c.name;
        wGroup.position.set(c.pos[0], c.pos[1], c.pos[2]);

        // Rotating hub assembly (rolls around Z axis when driving)
        const rollGroup = new THREE.Group();
        rollGroup.name = `${c.name}_roll`;

        const tire = new THREE.Mesh(tireGeo, tireMat);
        tire.castShadow = true;
        rollGroup.add(tire);

        const rimLip = new THREE.Mesh(rimLipGeo, rimMat);
        rollGroup.add(rimLip);

        const centerHub = new THREE.Mesh(hubGeo, darkMat);
        rollGroup.add(centerHub);

        // 5-spoke star concave drift wheel pattern
        for (let s = 0; s < 5; s++) {
            const spoke = new THREE.Mesh(spokeGeo, rimMat);
            spoke.rotation.z = (s * Math.PI * 2) / 5;
            rollGroup.add(spoke);
        }

        const disc = new THREE.Mesh(discGeo, discMat);
        rollGroup.add(disc);

        wGroup.add(rollGroup);
        wGroup.userData.rollGroup = rollGroup;
        wGroup.userData.isProcedural = true;

        // Stationary Brake Caliper (mounted on hub, steers with Y but does not roll on Z)
        const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.08), caliperMat);
        caliper.position.set(0.08, 0.12, c.left ? -0.06 : 0.06);
        wGroup.add(caliper);

        group.add(wGroup);
        wheels.push(wGroup);
    }

    return { model: group, wheels };
}

function dropCar(id) {
    if (cars[id]) world?.remove(cars[id].root);
    delete cars[id];
}

new GLTFLoader().load('models/car.glb', (gltf) => {
    carTemplate = gltf.scene;
    for (const id in cars) dropCar(id); // replace placeholder boxes next frame
}, undefined, (err) => console.error('[LanRace] car.glb failed to load, using boxes', err));

new GLTFLoader().load('models/sports_car.glb', (gltf) => {
    sportsCarTemplate = gltf.scene;
    for (const id in cars) dropCar(id);
}, undefined, () => {});

function liveryTexture(teamId) {
    if (!liveries[teamId]) {
        const tex = texLoader.load(`liveries/${teamId}.png`, undefined, undefined, (err) => {
            console.error(`[LanRace] livery ${teamId} failed to load, using a box`, err);
            failedLiveries.add(teamId);
            for (const id in cars) if (cars[id].teamId === teamId) dropCar(id);
        });
        tex.flipY = false; // glTF UV convention
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Q.anisotropy;
        liveries[teamId] = tex;
    }
    return liveries[teamId];
}

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
function blobShadow() {
    if (!blobTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
        grad.addColorStop(0, 'rgba(0,0,0,0.55)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        blobTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4 * scale, 2.8 * scale), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 1;
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
    let wheels = [];
    const isDrift = (clientState.settings?.mode === 'formula-d' || clientState.isDriftMode);
    const vClass = clientState.settings?.vehicleClass || 'tuner';

    if (isDrift && sportsCarTemplate) {
        const model = sportsCarTemplate.clone(true);
        model.scale.setScalar(scale);
        root.add(model);
        for (const name of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
            const w = model.getObjectByName(name);
            if (w) wheels.push(w);
        }
    } else if (isDrift) {
        const proc = createProceduralSportsCar(lp.color, vClass);
        proc.model.scale.setScalar(scale);
        root.add(proc.model);
        wheels = proc.wheels;
    } else if (carTemplate && !failedLiveries.has(lp.teamId)) {
        const model = carTemplate.clone(true);
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
                o.material.envMapIntensity = 0.3;
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
    // Your own car has no label: it would sit in the middle of the chase-cam view
    const tag = id === clientState.me ? null : nameTag(lp.username, lp.color);
    if (tag) root.add(tag);
    if (!Q.shadows) root.add(blobShadow());
    return { root, wheels, teamId: lp.teamId, ghost: false, tag, isDrift: !!isDrift };
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
            car.root.position.set(s.x, 0, s.y);
            car.root.rotation.y = -s.angle;
            world.add(car.root);
            cars[id] = car;
        }
        const r = car.root;
        r.position.x = s.x;
        r.position.z = s.y;
        r.rotation.y = -s.angle;
        const far = camera.position.distanceTo(r.position) > 300 * scale; // wheels unreadable that far: 4 fewer draws per car
        for (const w of car.wheels) w.userData.show = !far;
        for (const w of car.wheels) {
            const roll = w.userData.rollGroup || w;
            roll.rotation.z -= (s.speed / (WHEEL_RADIUS_M * scale)) * dt;
        }
        // +steer turns toward +z (right); a +y rotation points the wheel toward -z, so negate
        car.wheels[0] && (car.wheels[0].rotation.y = -(s.steer || 0)); // wheel_FL
        car.wheels[1] && (car.wheels[1].rotation.y = -(s.steer || 0)); // wheel_FR

        // Smoke emission during drift or handbrake
        const slip = s.driftAngle || (Math.abs(s.steer || 0) * 35);
        const isSlipping = (slip >= 15 && Math.abs(s.speed) > 20) || (id === clientState.me && input.handbrake && Math.abs(s.speed) > 10);
        if (isSlipping) {
            const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
            const rlX = s.x - cos * 1.35 * scale - sin * 0.95 * scale;
            const rlZ = s.y - sin * 1.35 * scale + cos * 0.95 * scale;
            const rrX = s.x - cos * 1.35 * scale + sin * 0.95 * scale;
            const rrZ = s.y - sin * 1.35 * scale - cos * 0.95 * scale;
            const vx = s.vx || Math.cos(s.angle) * s.speed;
            const vy = s.vy || Math.sin(s.angle) * s.speed;
            const intensity = Math.min(2.0, slip / 30);
            smokeSystem.emit(rlX, 0, rlZ, vx / scale, vy / scale, s.speed / scale, intensity);
            smokeSystem.emit(rrX, 0, rrZ, vx / scale, vy / scale, s.speed / scale, intensity);
        }

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
        if (cars[id].isDrift) continue; // Formula-D cars have distinct high-detail procedural wheels
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
    if (!isSpectator()) return cars[clientState.me];
    spectateId = stepFollow(rankedCarIds(), spectateId, 0);
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
    camera.position.set(p.x - Math.cos(h) * CHASE_BACK_M * scale, CHASE_UP_M * scale, p.z - Math.sin(h) * CHASE_BACK_M * scale);
    look.set(p.x + Math.cos(h) * LOOK_AHEAD_M * scale, 1 * scale, p.z + Math.sin(h) * LOOK_AHEAD_M * scale);
    camera.lookAt(look);
    // Moved in whole shadow-map texels so shadow edges don't shimmer as the car drives
    const q = snapLight({ x: p.x, y: 0, z: p.z }, SUN_OFF, 720 / (Q.shadows || 1024));
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
    const me = gs[clientState.me];
    const racing = me && !isSpectator();
    const fastest = Math.min(...Object.values(gs).map(p => (p.bestLap === null ? Infinity : p.bestLap)));

    $('hud-total').innerText = Object.keys(gs).length;
    $('hud-rank').innerText = racing ? me.rank : '--';
    $('hud-lap').innerText = racing ? lapLabel(me.lap) : '--';
    $('hud-speed').innerText = racing ? kmh(me.speed) : '--';

    // Own lap times: purple = fastest overall, green = personal best
    const curEl = $('lt-current');
    curEl.innerText = racing ? fmtTime(me.curLap) : '--';
    curEl.classList.toggle('t-red', !!racing && me.lapValid === false);
    const lastEl = $('lt-last');
    const deleted = !!racing && me.lastValid === false;
    lastEl.innerText = racing ? fmtTime(me.lastLap) + (deleted ? ' DELETED' : '') : '--';
    lastEl.classList.toggle('t-red', deleted);
    lastEl.classList.toggle('t-purple', !deleted && !!racing && me.lastLap !== null && me.lastLap === fastest);
    lastEl.classList.toggle('t-green', !deleted && !!racing && me.lastLap !== null && me.lastLap === me.bestLap && me.lastLap !== fastest);
    $('lt-best').innerText = racing ? fmtTime(me.bestLap) : '--';
    const delta = racing && !deleted ? lapDelta(me.lastLap, me.bestLap) : null;
    $('lt-delta').textContent = delta ? delta.text : '';
    $('lt-delta').className = delta ? delta.cls : '';
    for (let i = 0; i < 3; i++) {
        const el = $(`sec-${i + 1}`), s = racing ? clientState.mySectors[i] : null;
        el.children[1].textContent = s ? s.time.toFixed(3) : `S${i + 1}`;
        el.className = `sec ${s ? s.cls : ''}`;
        const best = clientState.sessionBest[i]; // purple sector: the session's best and who holds it
        el.lastElementChild.textContent = best === null ? '' : `${best.toFixed(3)} ${codeOf(clientState.sessionBestIds[i])}`;
    }
    const fl = clientState.fastestLap;
    $('lt-fl').textContent = fl ? fmtTime(fl.time) : '--';
    $('lt-fl-who').textContent = fl ? codeOf(fl.id) : '';

    // Session bar
    const sess = clientState.session;
    let bar = '';
    if (clientState.status === 'QUALIFYING' && sess) {
        bar = `QUALIFYING ${fmtClock(sess.endsAt - Date.now())}`;
        if (racing) bar += me.finished ? ` · QUALIFYING COMPLETE — P${me.rank}` : me.curLap === null ? (me.inPit ? ' · PIT LANE' : ' · OUT LAP') : ` · LAP ${me.lap + 1}/2`;
    } else if (clientState.status === 'RACE' || clientState.status === 'FINISHED') {
        const leader = Object.values(gs).find(p => p.rank === 1);
        const lap = racing ? me.lap : leader ? leader.lap : 0;
        bar = `LAP ${lapLabel(lap)}/${clientState.settings.maxLaps}`;
    }
    $('session-bar').textContent = bar;
    $('pit-limiter').classList.toggle('hidden', !(racing && me.limiter));
    $('drs-badge').className = !racing ? 'drs-off' : me.drs ? 'drs-open' : me.drsAvailable ? 'drs-avail' : 'drs-off';
    let hint = '';
    if (racing && clientState.trackData) {
        const t = clientState.trackData, total = t.cum[t.path.length];
        drsIdx = trackIndex(t.path, me.x, me.y, drsIdx, t.width);
        const lapS = (((t.cum[drsIdx] - (t.startS || 0)) % total) + total) % total;
        const condZone = inDrsZone(t.drsZones || [], lapS);
        const condGap = me.drsAvailable || (clientState.status === 'QUALIFYING' && !me.inPit);

        let fill = 0;
        if (me.drs) fill = 100;
        else if (condZone && condGap) fill = 100;
        else if (condZone || condGap) fill = 50;
        else fill = 0;

        const drsFillEl = $('drs-progress-fill');
        if (drsFillEl) drsFillEl.style.width = `${fill}%`;

        hint = drsHint({ mode: clientState.status === 'QUALIFYING' ? 'quali' : 'race', inPit: me.inPit, drs: me.drs, drsAvailable: me.drsAvailable, lap: me.lap, inZone: condZone });
    }
    $('drs-hint').textContent = hint;

    const isDriftMode = clientState.settings?.mode === 'formula-d';
    const driftHud = $('drift-hud');
    if (driftHud) {
        driftHud.classList.toggle('hidden', !isDriftMode || !racing);
        if (isDriftMode && racing) {
            $('drift-total-score').innerText = Math.floor(me.driftScore || 0).toLocaleString();
            $('drift-combo-points').innerText = `+${Math.floor(me.driftCombo || 0)}`;
            $('drift-multiplier-badge').innerText = `${(me.driftMultiplier || 1.0).toFixed(1)}x`;
            const angleDeg = Math.round(me.driftAngle || 0);
            $('drift-angle-val').innerText = `${angleDeg}°`;

            const msgEl = $('drift-status-msg');
            if (msgEl) {
                if (me.driftSpinout) {
                    msgEl.innerText = 'SPINOUT!';
                    msgEl.className = 'spinout';
                } else if (angleDeg >= 30) {
                    msgEl.innerText = 'GREAT ANGLE!';
                    msgEl.className = 'great';
                } else if (angleDeg >= 15) {
                    msgEl.innerText = 'DRIFTING';
                    msgEl.className = 'drifting';
                } else {
                    msgEl.innerText = '';
                    msgEl.className = '';
                }
            }

            const clipEl = $('drift-clip-notify');
            if (clipEl) {
                clipEl.classList.toggle('hidden', !me.driftClipping);
            }
        }
    }

    if (withTower) {
        // Timing tower
        const ttHead = $('tt-head');
        if (ttHead && ttHead.firstElementChild) {
            ttHead.firstElementChild.textContent = isDriftMode ? 'DRIFT RANK' : 'TIMING';
        }
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
            if (p.penalty) li.append(el('span', 'tt-tag pen', `+${p.penalty}s`));
            if (clientState.fastestLap?.id === id) { // purple stopwatch: fastest lap of the session
                const fl = el('span', 'tt-fl');
                fl.innerHTML = STOPWATCH;
                li.append(fl);
            }
            const gap = gapText(rows, i, towerMode);
            const time = el('span', 'tt-gap');
            if (isDriftMode) {
                time.textContent = `${Math.floor(p.driftScore || 0).toLocaleString()} pts`;
                time.classList.add('lead');
            } else if (quali) {
                time.textContent = gap ? gap : fmtTime(p.bestLap);
                if (p.bestLap !== null && p.bestLap === fastest) time.classList.add('t-purple');
                const bars = el('span', 'tt-sectors');
                // On a timed lap: live bars for this lap (purple / green / yellow / grey); otherwise their best lap's sectors
                const live = p.lapStart !== null && p.lapStart !== undefined && liveSec[id];
                if (live) live.forEach((c) => bars.appendChild(el('i', c ? c.replace('sec-', 'sb-') : '')));
                else (p.bestLapSectors || [null, null, null]).forEach((s, k) => {
                    const best = clientState.sessionBest[k];
                    bars.appendChild(el('i', s === null ? '' : best !== null && s <= best + 1e-9 ? 'sb-purple' : 'sb-green'));
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
    const W = minimap.width, H = minimap.height, pad = 12;
    const k = Math.min((W - 2 * pad) / (bounds.maxX - bounds.minX), (H - 2 * pad) / (bounds.maxY - bounds.minY));
    const mx = (x) => pad + (x - bounds.minX) * k;
    const my = (y) => pad + (y - bounds.minY) * k;

    mm.clearRect(0, 0, W, H);
    if (t.pit) {
        mm.strokeStyle = 'rgba(255,255,255,0.45)';
        mm.lineWidth = 2;
        mm.beginPath();
        t.pit.path.filter((_, i) => t.pit.cum[i] >= t.pit.closeS)
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
        const lp = clientState.players[id];
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
let last = performance.now();
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

// Sound + gear HUD: gearboxes for your car and every other car (cheap), audio frame in metres (track plane)
const ownBox = new Gearbox(), remoteBoxes = new Map(), soundOthers = [];
const ownFrame = { rpm: 0, load: 0, limiter: false, pit: false, speedMs: 0 };
const listenerFrame = { x: 0, y: 0, fx: 1, fy: 0, vx: 0, vy: 0 }, sndFrame = { own: null, others: soundOthers, listener: listenerFrame };
const silentFrame = { own: null, others: [], listener: listenerFrame };
const camDir = new THREE.Vector3();
let lastDrs = false, hudLit = -1, hudFlash = null, hudGear = '';
function updateSound(dt) {
    const gs = clientState.gameState, me = gs[clientState.me], racing = !!me && !isSpectator();
    const followId = racing ? clientState.me : spectateId;
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
    pollInput(dt);
    if (!world || !clientState.gameState) { Sound.update(silentFrame); return; }
    applyNet(now / 1000, dt);
    updateCars(dt);
    updateWheelBatch();
    smokeSystem.update(dt, camera);
    updateCamera(dt);
    updateSound(dt);
    renderer.render(scene, camera);

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
    netBuf = new SnapshotBuffer();
    const isDrift = clientState.settings?.mode === 'formula-d';
    const vClass = clientState.settings?.vehicleClass || 'tuner';
    // New session: predict from the new grid (reset on our first entry); spectators never get one, so never predict
    predictor = new Predictor(clientState.trackData, clientState.gameState?.[clientState.me]?.assist || 'off', isDrift, vClass);
    sentInputs = []; carPose.clear(); carState.clear(); renderClock.t = presentClock.t = null;
    othersMode = store.get('lanrace.others') === 'smooth' ? 'smooth' : 'present';
    ownBox.reset(); remoteBoxes.clear(); lastDrs = false;
    for (const k in liveSec) delete liveSec[k]; // new session, new timing
    $('fl-card').classList.add('hidden');
    $('race-results').classList.add('hidden'); // next session: last race's classification goes
    buildWorld(clientState.trackData);
    simStep(false); // resend what's held when a new session starts
};
renderer.setAnimationLoop(frame);
// game_init may have arrived while this module (and three.js) was still loading
if (clientState.trackData) window.initGameVisuals();
