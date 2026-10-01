import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { keyboardStep, gamepadInput, changed } from './input.js';

// World units per metre come from the track JSON (track.scale = 6).
const WHEEL_RADIUS_M = 0.36;  // scripts/car_parts.py WHEEL_RADIUS
const WALL_OFFSET = 80;       // src/game/Player.js invisible wall beyond the track edge
const CHASE_BACK_M = 10, CHASE_UP_M = 4, LOOK_AHEAD_M = 6;
const CAR_SMOOTH = 25, CAM_TURN_SMOOTH = 8; // 1/s; time-based so lag doesn't grow at low frame rates
const KERB_TURN = 0.05;
const TAG_FULL_M = 40, TAG_GONE_M = 120; // name labels fade out between these camera distances       // rad per path segment (~10 m) → radius under ~200 m gets kerbs
const PIT_RUNOFF_M = 2; // src/game/Game.js barrier outside the pit lane
const teamInfo = {};
fetch('teams.json').then(r => r.json()).then((list) => { for (const t of list) teamInfo[t.id] = t; });

const canvas = document.getElementById('game-canvas');
const minimap = document.getElementById('minimap');
const mm = minimap.getContext('2d');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const SKY = 0x9cc8ef;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 3000, 12000);

const camera = new THREE.PerspectiveCamera(60, 1, 2, 20000);

scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x4f7a2a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -400, right: 400, top: 400, bottom: -400, near: 10, far: 4000 });
scene.add(sun, sun.target);

function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- input ----------
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
let input = { throttle: 0, brake: 0, steer: 0 };
let touchInput = null;
let lastSent = null, lastSentAt = 0;
let spectateIndex = 0;

function isSpectator() {
    return !!clientState.players[clientState.me]?.isSpectating || !clientState.gameState?.[clientState.me];
}

function onKey(e, down) {
    if (document.activeElement === chatInput) return;
    const key = e.key.toLowerCase();
    if (down && clientState.status !== 'LOBBY' && isSpectator()) {
        if (key === 'arrowleft') spectateIndex--;
        if (key === 'arrowright') spectateIndex++;
    }
    const k = KEYMAP[key];
    if (!k) return;
    // Presses are ignored in the lobby (typing a name), releases always count so no key stays stuck
    if (down && clientState.status === 'LOBBY') return;
    keys[k] = down;
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));

function sendInput(now, force = false) {
    // ≤ 30 Hz on change, plus a 10 Hz resend: UDP may drop a packet and a lost "throttle off" must not stick
    if (!force && (now - lastSentAt < 33 || (!changed(input, lastSent) && now - lastSentAt < 100))) return;
    window.sendUDPInput(input);
    lastSent = { ...input };
    lastSentAt = now;
}

function pollInput(dt, now) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const pad = gamepadInput(pads.find(Boolean));
    input = pad || touchInput || keyboardStep(input, keys, dt);
    sendInput(now);
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

function coloredMesh(pos, col) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }));
    m.receiveShadow = true;
    return m;
}

// Flat band between two sideways offsets, only on segments where keep(i)
function strip(path, from, to, y, keep, colorAt) {
    const a = offsetPoints(path, from), b = offsetPoints(path, to);
    const pos = [], col = [];
    for (let i = 0; i < path.length; i++) {
        if (!keep(i)) continue;
        const j = (i + 1) % path.length;
        const c = colorAt(i);
        pos.push(a[i].x, y, a[i].y, b[i].x, y, b[i].y, b[j].x, y, b[j].y,
                 a[i].x, y, a[i].y, b[j].x, y, b[j].y, a[j].x, y, a[j].y);
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    return coloredMesh(pos, col);
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

function gridBoxes(slots) {
    slots.forEach((g, i) => {
        const fx = Math.cos(g.angle), fy = Math.sin(g.angle);
        const bar = flat(0.4 * scale, 2.6 * scale, 0xf2f2f2);
        bar.position.set(g.x + fx * 3 * scale, 0.9, g.y + fy * 3 * scale);
        bar.rotation.y = -g.angle;
        world.add(bar);
        const num = textPlane(String(i + 1), 1.6 * scale, 1.6 * scale, 'rgba(0,0,0,0)');
        num.geometry.rotateX(-Math.PI / 2);
        num.position.set(g.x + fx * 4.6 * scale, 0.95, g.y + fy * 4.6 * scale);
        num.rotation.y = facing(g.angle);
        world.add(num);
    });
}

function buildPit(pit) {
    const n = pit.path.length, ph = pit.width / 2, s = pit.trackSide;
    const inner = (i) => i >= 1 && i <= n - 3; // end segments would use wrapped normals
    const open = (i) => inner(i) && pit.cum[i] >= pit.closeS; // nothing drawn on the closed pit entry
    world.add(strip(pit.path, -ph, ph, 0.55, open, solid('#3a3f47')));
    const line = 0.3 * scale;
    world.add(strip(pit.path, ph - line, ph, 0.85, open, solid('#f2f2f2')));
    world.add(strip(pit.path, -ph, -ph + line, 0.85, open, solid('#f2f2f2')));

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

    for (const g of pit.garages) {
        const info = teamInfo[g.teamId] || { name: g.teamId, chatColor: '#888888' };
        const c = side(g, g.angle, -s * (back + 2.5 * scale));
        const building = new THREE.Mesh(new THREE.BoxGeometry(18 * scale, 6 * scale, 5 * scale), new THREE.MeshStandardMaterial({ color: 0x2b2f36 }));
        building.position.set(c.x, 3 * scale, c.y);
        building.rotation.y = -g.angle;
        building.castShadow = true;
        world.add(building);
        const f = side(g, g.angle, -s * (back - 0.1 * scale));
        const sign = textPlane(info.name.toUpperCase(), 17 * scale, 1.6 * scale, info.chatColor);
        sign.position.set(f.x, 5 * scale, f.y);
        sign.rotation.y = s > 0 ? -g.angle : Math.PI - g.angle; // face the pit lane
        world.add(sign);
        for (const b of g.boxes) {
            const mark = flat(6 * scale, 2.6 * scale, info.chatColor, 0.45);
            mark.position.set(b.x, 0.8, b.y);
            mark.rotation.y = -b.angle;
            world.add(mark);
        }
    }
}

const solid = (hex) => { const c = new THREE.Color(hex); return () => c; };

function buildWorld(t) {
    if (world) {
        scene.remove(world);
        world.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const id in cars) delete cars[id];

    scale = t.scale;
    world = new THREE.Group();
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

    world.add(strip(path, -half, half, 0.6, all, solid('#3a3f47')));
    const inset = 0.5 * scale, line = 0.3 * scale;
    world.add(strip(path, half - inset - line, half - inset, 0.9, all, solid('#f2f2f2')));
    world.add(strip(path, -half + inset, -half + inset + line, 0.9, all, solid('#f2f2f2')));

    // Kerbs on corners (visual only), widened by 2 points so they don't flicker on and off
    const turny = path.map((_, i) => turnAngle(path, i) > KERB_TURN);
    const curvy = turny.map((_, i) => [-2, -1, 0, 1, 2].some((d) => turny[(i + d + n) % n]));
    const kerbW = 1.5 * scale;
    world.add(strip(path, half, half + kerbW, 0.7, (i) => curvy[i], alternate('#d62828', '#f2f2f2')));
    world.add(strip(path, -half - kerbW, -half, 0.7, (i) => curvy[i], alternate('#d62828', '#f2f2f2')));

    // Barriers exactly where the physics wall is; skipped where another part of the track is closer
    const wallOff = half + WALL_OFFSET;
    for (const dir of [1, -1]) {
        const ok = offsetPoints(path, dir * wallOff).map((p) => distToPath(p, path) > wallOff * 0.95
            && !(t.pit && distToPath(p, t.pit.path, false) < t.pit.width / 2 + (PIT_RUNOFF_M + 2) * scale));
        world.add(wall(path, dir * wallOff, 1 * scale, (i) => ok[i] && ok[(i + 1) % n], alternate('#d62828', '#f2f2f2')));
    }

    world.add(startLine(t.start, t.width));
    gridBoxes(t.startPositions);
    if (t.pit) buildPit(t.pit);
    snapCamera = true;
}

// ---------- cars ----------
let carTemplate = null;
const failedLiveries = new Set();
const liveries = {};
const texLoader = new THREE.TextureLoader();

function dropCar(id) {
    if (cars[id]) world?.remove(cars[id].root);
    delete cars[id];
}

new GLTFLoader().load('models/car.glb', (gltf) => {
    carTemplate = gltf.scene;
    for (const id in cars) dropCar(id); // replace placeholder boxes next frame
}, undefined, (err) => console.error('[LanRace] car.glb failed to load, using boxes', err));

function liveryTexture(teamId) {
    if (!liveries[teamId]) {
        const tex = texLoader.load(`liveries/${teamId}.png`, undefined, undefined, (err) => {
            console.error(`[LanRace] livery ${teamId} failed to load, using a box`, err);
            failedLiveries.add(teamId);
            for (const id in cars) if (cars[id].teamId === teamId) dropCar(id);
        });
        tex.flipY = false; // glTF UV convention
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
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

function makeCar(id) {
    const lp = clientState.players[id];
    if (!lp) return null;
    const root = new THREE.Group();
    const wheels = [];
    if (carTemplate && !failedLiveries.has(lp.teamId)) {
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
        });
        for (const name of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
            const w = model.getObjectByName(name);
            if (w) wheels.push(w);
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
    return { root, wheels, teamId: lp.teamId, ghost: false, tag };
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
        const a = 1 - Math.exp(-CAR_SMOOTH * dt);
        r.position.x += (s.x - r.position.x) * a;
        r.position.z += (s.y - r.position.z) * a;
        const d = -s.angle - r.rotation.y;
        r.rotation.y += Math.atan2(Math.sin(d), Math.cos(d)) * a;
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
            });
        }
    }
}

// ---------- camera ----------
const look = new THREE.Vector3();
let camHeading = 0;

function followedCar() {
    if (!isSpectator()) return cars[clientState.me];
    const gs = clientState.gameState;
    const ids = Object.keys(gs).filter((id) => cars[id]).sort((a, b) => gs[a].rank - gs[b].rank);
    if (!ids.length) return null;
    return cars[ids[((spectateIndex % ids.length) + ids.length) % ids.length]];
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
    sun.position.set(p.x + 600, 1800, p.z + 400);
    sun.target.position.copy(p);
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

let flashTimer = null, bannerTimer = null;
window.showSectorFlash = (n, time, delta, cls) => {
    const el = $('sector-flash');
    el.textContent = `S${n} ${time.toFixed(3)}` + (delta === null ? '' : `  ${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(3)}`);
    el.className = cls;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.add('hidden'), 2000);
};
window.showBanner = (text) => {
    const el = $('race-msg');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.add('hidden'), 3000);
};

function updateHUD() {
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
    for (let i = 0; i < 3; i++) {
        const el = $(`sec-${i + 1}`), s = racing ? clientState.mySectors[i] : null;
        el.textContent = s ? `S${i + 1} ${s.time.toFixed(3)}` : `S${i + 1}`;
        el.className = `sec ${s ? s.cls : ''}`;
    }

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

    // Timing tower
    const quali = Object.values(gs).some(p => p.ghost);
    const ol = $('leaderboard-list');
    ol.innerHTML = '';
    Object.entries(gs).sort((a, b) => a[1].rank - b[1].rank).slice(0, 10).forEach(([id, p]) => {
        const lp = clientState.players[id];
        if (!lp) return;
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'tt-name';
        name.textContent = `${p.rank}. ${lp.username}${p.penalty ? ` +${p.penalty}s` : ''}`;
        const time = document.createElement('span');
        if (quali) {
            time.textContent = p.rank === 1 ? fmtTime(p.bestLap) : p.gap === null ? fmtTime(p.bestLap) : `+${p.gap.toFixed(3)}`;
            if (p.bestLap !== null && p.bestLap === fastest) time.className = 't-purple';
        } else if (p.finished && p.rank === 1) {
            time.textContent = 'WINNER';
        } else {
            time.textContent = p.rank === 1 ? 'LEADER' : p.lapsDown > 0 ? `+${p.lapsDown} L` : p.gap === null ? '' : `+${p.gap.toFixed(3)}`;
        }
        if (quali) {
            const bars = document.createElement('span');
            bars.className = 'tt-sectors';
            (p.bestLapSectors || [null, null, null]).forEach((s, i) => {
                const b = document.createElement('i');
                const best = clientState.sessionBest[i];
                if (s !== null) b.className = best !== null && s <= best + 1e-9 ? 'sb-purple' : 'sb-yellow';
                bars.appendChild(b);
            });
            li.append(name, bars, time);
        } else {
            li.append(name, time);
        }
        ol.appendChild(li);
    });
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
function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (clientState.status === 'LOBBY') return;
    pollInput(dt, now);
    if (!world || !clientState.gameState) return;
    updateCars(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    updateHUD();
    drawMinimap();
}

window.initGameVisuals = () => {
    buildWorld(clientState.trackData);
    sendInput(performance.now(), true); // resend what's held when a new session starts
};
renderer.setAnimationLoop(frame);
// game_init may have arrived while this module (and three.js) was still loading
if (clientState.trackData) window.initGameVisuals();
