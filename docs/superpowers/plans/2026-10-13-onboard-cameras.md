# Onboard Cameras (T-cam + Cockpit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Race in first person: `V` cycles Chase → T-cam → Cockpit; the cockpit has a turning steering wheel with a live display, drawn in a second close-range pass so nothing clips, with sharper sun shadows up close.

**Architecture:** A pure `views.js` holds the view list, eye points and small maths (node-tested). `carModel.js` gains `buildSteeringWheel`. `game3d.js` puts the camera on the followed car's world matrix in onboard views, and after the normal world render clears depth and draws only that car (three.js layer 1) with a 1 cm near-plane camera, reusing the frame's shadow map.

**Tech Stack:** three.js r186 (ES modules in the browser, importable from node for tests), node:test, plain DOM/CSS.

**Spec:** `docs/superpowers/specs/2026-10-13-onboard-cameras-design.md`

## Global Constraints

- 1 m = `scale` world units (6 on every track); car frame in `carShape.js`: x forward, y left, z up, metres; three.js car frame: `(x, z, -y)`.
- Views: `['chase', 'tcam', 'cockpit']`; FOV chase 60, T-cam 60, cockpit 75.
- Second-pass camera: near 0.06 units (1 cm), far 60 units (10 m), layer 1 only.
- Shadow box half-size: 360 units chase, 120 units onboard; texel snap step `2 * half / mapSize`.
- `V` = camera everywhere outside the lobby; after-finish "your car / watching" swap moves to `F`.
- Remembered view key: `lanrace.view` via the existing `store` (localStorage + `lanraceMem`).
- No mirror reflections, camera shake, nose cam or seat/FOV settings.
- Code comments match the codebase: one plain line saying why, no headers.

## Review Focus

1. **Pit stop from an onboard view** — the TV pit camera must take over smoothly and the second pass must be off while it does (else your car draws over the crew). Owned by Task 4 (`layeredNow` excludes `pitBlend > 0.001`); checked in Task 5's browser run.
2. **Switching the followed car** (spectating ← → or after finishing) — layer 1 and the wheel must leave the old car, or two cars draw over the world. Owned by Task 4 (`setLayered`); checked in Task 5.
3. **Box fallback car** (no car template) — onboard views must fall back to chase without throwing. Owned by Task 4 (`car.model` null → `'chase'`).
4. **Stored view value is junk** (`lanrace.view = 'helicopter'` from an old build or hand edit) — must start in chase. Owned by Task 1 (`viewOf` test).
5. **Low graphics level (shadows off)** — onboard views still render; shadow box code must not divide by a 0 map size. Owned by Task 4 (`Q.shadows || 1024`), checked in Task 5.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `public/js/views.js` | Create | View list and names, FOV, eye points, wheel position, `nextView`, `viewOf`, `onboard`, `wheelAngle`, `shadowHalf`, `toThree` |
| `test/views.client.test.js` | Create | Node tests for `views.js` |
| `public/js/carModel.js` | Modify | `buildSteeringWheel(canvas, glove)` |
| `test/steeringWheel.client.test.js` | Create | Node test: size, spin, draw |
| `public/js/carShape.js` | Modify | Halo 64 segments; mirror part + dark glass on the mirror face |
| `public/js/game3d.js` | Modify | View state, keys, onboard camera pose, shadow box, layers, second pass, wheel attach/spin/display |
| `public/index.html` | Modify | Camera button |
| `public/css/style.css` | Modify | Camera button (touch), cockpit hides gear/speed/rev lights |

---

### Task 1: `views.js` — view list, eye points, small maths

**Files:**
- Create: `public/js/views.js`
- Test: `test/views.client.test.js`

**Interfaces:**
- Produces (used by Tasks 2, 4):
  - `VIEWS: string[]` = `['chase', 'tcam', 'cockpit']`
  - `VIEW_NAMES: { chase: 'CHASE', tcam: 'T-CAM', cockpit: 'COCKPIT' }`
  - `VIEW_FOV: { chase: 60, tcam: 60, cockpit: 75 }`
  - `EYE: { tcam: [x, y, z], cockpit: [x, y, z] }` car frame metres
  - `EYE_TILT: { tcam: number, cockpit: number }` radians, negative = looking down
  - `WHEEL_POS: [x, y, z]` car frame metres
  - `nextView(v: string): string`, `viewOf(stored: any): string`, `onboard(v: string): boolean`
  - `wheelAngle(steer: number): number` (−π/2 … π/2), `shadowHalf(v: string): number`
  - `toThree([x, y, z]): [x, z, -y]`

- [ ] **Step 1: Write the failing test**

Create `test/views.client.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
let V;
before(async () => { V = await import('../public/js/views.js'); });

test('views cycle chase → T-cam → cockpit → chase; junk and unknown start in chase', () => {
    assert.deepStrictEqual(V.VIEWS, ['chase', 'tcam', 'cockpit']);
    assert.strictEqual(V.nextView('chase'), 'tcam');
    assert.strictEqual(V.nextView('tcam'), 'cockpit');
    assert.strictEqual(V.nextView('cockpit'), 'chase');
    assert.strictEqual(V.nextView('helicopter'), 'chase');
    assert.strictEqual(V.viewOf('cockpit'), 'cockpit');
    for (const junk of ['helicopter', null, undefined, '', 3]) assert.strictEqual(V.viewOf(junk), 'chase');
    assert.strictEqual(V.onboard('chase'), false);
    assert.ok(V.onboard('tcam') && V.onboard('cockpit'));
    assert.deepStrictEqual(V.VIEW_FOV, { chase: 60, tcam: 60, cockpit: 75 });
});

test('cockpit eye sits inside the helmet (outward faces culled from inside), T-cam above the airbox pod', () => {
    const [x, y, z] = V.EYE.cockpit, h = { c: [0.18, 0, 0.74], r: [0.13, 0.115, 0.13] }; // carShape.js helmet ellipsoid
    const k = ((x - h.c[0]) / h.r[0]) ** 2 + ((y - h.c[1]) / h.r[1]) ** 2 + ((z - h.c[2]) / h.r[2]) ** 2;
    assert.ok(k < 1, `eye outside the helmet (${k.toFixed(2)})`);
    const [tx, ty, tz] = V.EYE.tcam;
    assert.ok(tx <= 0.08 && tx >= -0.02 && ty === 0 && tz > 0.985, 'T-cam over the pod (x -0.02..0.08, top z 0.985)');
    assert.ok(V.EYE_TILT.tcam < 0 && V.EYE_TILT.cockpit <= 0);
    assert.ok(V.WHEEL_POS[0] > x && V.WHEEL_POS[0] < 0.58, 'wheel ahead of the eye, behind the halo pillar (x 0.58)');
});

test('wheel angle: ±90° at full lock, clamped, right is positive; shadow box per view; car frame to three.js', () => {
    assert.strictEqual(V.wheelAngle(0), 0);
    assert.strictEqual(V.wheelAngle(1), Math.PI / 2);
    assert.strictEqual(V.wheelAngle(-1), -Math.PI / 2);
    assert.strictEqual(V.wheelAngle(3), Math.PI / 2);
    assert.strictEqual(V.wheelAngle(undefined), 0);
    assert.strictEqual(V.shadowHalf('chase'), 360);
    assert.strictEqual(V.shadowHalf('tcam'), 120);
    assert.strictEqual(V.shadowHalf('cockpit'), 120);
    assert.deepStrictEqual(V.toThree([1, 2, 3]), [1, 3, -2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/views.client.test.js`
Expected: FAIL — `Cannot find module '.../public/js/views.js'`

- [ ] **Step 3: Write the implementation**

Create `public/js/views.js`:

```js
// Onboard cameras: chase → T-cam → cockpit. Pure, shared by game3d.js and the node tests.
// Eye points in carShape.js's car frame (x forward, y left, z up, metres). The cockpit eye is inside the helmet: its faces
// point out, so from inside they're culled and the helmet needs no hiding. Calibration knobs: tune by eye in the browser.
export const VIEWS = ['chase', 'tcam', 'cockpit'];
export const VIEW_NAMES = { chase: 'CHASE', tcam: 'T-CAM', cockpit: 'COCKPIT' };
export const VIEW_FOV = { chase: 60, tcam: 60, cockpit: 75 };
export const EYE = { tcam: [0.03, 0, 1.02], cockpit: [0.20, 0, 0.68] };
export const EYE_TILT = { tcam: -0.10, cockpit: -0.05 }; // nose down a touch: the road ahead fills the lower frame
export const WHEEL_POS = [0.45, 0, 0.66];

export const nextView = (v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length];
export const viewOf = (stored) => (VIEWS.includes(stored) ? stored : 'chase');
export const onboard = (v) => v === 'tcam' || v === 'cockpit';
export const wheelAngle = (steer) => Math.max(-1, Math.min(1, steer || 0)) * (Math.PI / 2);
export const shadowHalf = (v) => (onboard(v) ? 120 : 360); // ±20 m round the car onboard: ~3× sharper texels
export const toThree = ([x, y, z]) => [x, z, -y];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/views.client.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/views.js test/views.client.test.js
git commit -m "Onboard views: view cycle, eye points, wheel angle, shadow box per view"
```

---

### Task 2: Steering wheel model

**Files:**
- Modify: `public/js/carModel.js` (append after `buildCar`)
- Test: `test/steeringWheel.client.test.js`

**Interfaces:**
- Consumes: `WHEEL_POS`, `toThree` from `./views.js` (Task 1)
- Produces (used by Task 4):
  - `buildSteeringWheel(canvas: HTMLCanvasElement-like, glove?: string)` → `{ root: THREE.Group, spin: THREE.Group, setGlove(color: string): void, draw(s: { gear: string, kmh: string, lit: number, drs: boolean }): void }`
  - `root` is in the car model's frame (metres; parent it to the scaled model). `spin.rotation.x = wheelAngle(steer)` turns it (positive = clockwise from the driver = right). Every mesh has layers 0 and 1 enabled.

- [ ] **Step 1: Write the failing test**

Create `test/steeringWheel.client.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
let M, THREE;
before(async () => { THREE = await import('three'); M = await import('../public/js/carModel.js'); });

// A canvas stand-in: every 2D call is a no-op
const fakeCanvas = () => { const ctx = new Proxy({}, { get: () => () => {} }); return { width: 0, height: 0, getContext: () => ctx }; };

test('steering wheel: F1-sized, in front of the cockpit eye, turns with steering, display redraws, on layer 1', () => {
    const w = M.buildSteeringWheel(fakeCanvas(), '#00a19c');
    const box = new THREE.Box3().setFromObject(w.root), size = box.getSize(new THREE.Vector3());
    assert.ok(size.z > 0.27 && size.z < 0.36, `width with the gloves on ${size.z.toFixed(3)} m`); // rim 0.20 + grips at ±0.12 + gloves
    assert.ok(Math.abs(w.root.position.x - 0.45) < 1e-9 && Math.abs(w.root.position.y - 0.66) < 1e-9);
    w.spin.rotation.x = Math.PI / 2;
    w.root.updateMatrixWorld(true);
    const turned = new THREE.Box3().setFromObject(w.spin).getSize(new THREE.Vector3());
    assert.ok(turned.z < size.z, 'a quarter turn stands the rim on end');
    const tex = w.root.getObjectByName('wheelDisplay').material.map, v0 = tex.version;
    w.draw({ gear: '7', kmh: '298', lit: 9, drs: true });
    assert.ok(tex.version > v0, 'display texture flagged for upload');
    let meshes = 0;
    w.root.traverse((o) => { if (o.isMesh) { meshes++; assert.ok(o.layers.isEnabled(0) && o.layers.isEnabled(1), o.name); } });
    assert.ok(meshes >= 5, 'rim, two grips, display, two gloves');
    w.setGlove('#ff8000');
    assert.strictEqual(w.root.getObjectByName('glove').material.color.getHexString(), 'ff8000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/steeringWheel.client.test.js`
Expected: FAIL — `M.buildSteeringWheel is not a function`

- [ ] **Step 3: Write the implementation**

In `public/js/carModel.js`, add to the imports:

```js
import { WHEEL_POS, toThree } from './views.js';
```

Append after `buildCar`:

```js
// The steering wheel, cockpit view only (one, on the car the camera follows): an F1 rim with grips, a display, two gloves.
// Model frame (metres, three.js: x forward, y up, z right). spin turns about the column: +x = clockwise from the driver = right.
export function buildSteeringWheel(canvas, glove = '#e10600') {
    const root = new THREE.Group(), spin = new THREE.Group();
    root.name = 'steeringWheel';
    root.position.set(...toThree(WHEEL_POS));
    root.rotation.z = 0.35; // top leaning back toward the driver
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
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8), gloveMat);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/steeringWheel.client.test.js`
Expected: PASS. If `CanvasTexture` complains about the fake canvas in node, give the fake canvas `nodeName: 'CANVAS'` — do not change the production code for the test.

- [ ] **Step 5: Run the full suite, then commit**

Run: `npm test 2>&1 | grep -E "^✖|ℹ (pass|fail)"`
Expected: `ℹ fail 0`

```bash
git add public/js/carModel.js test/steeringWheel.client.test.js
git commit -m "Steering wheel: F1 rim, grips, team gloves and a live display, for the cockpit view"
```

---

### Task 3: Close-up car detail — smoother halo, mirror glass

**Files:**
- Modify: `public/js/carShape.js:116` (halo), `:121` (mirror part), `:278-279` (paint rule)
- Test: existing `test/assets.test.js` (triangle budget: high ≤ 40 000; today 37 092)

**Interfaces:**
- Consumes: nothing new. Produces: nothing new (same `bodyArrays`, one more part name `'mirror'`).

- [ ] **Step 1: Halo from 40 to 64 segments along its length**

In `public/js/carShape.js`, the halo line ends `0.03, { nu: 40 }));` — change `nu: 40` to `nu: 64`:

```js
    P.push(tube('halo', [[-0.10, 0.30, 0.60], [0.05, 0.28, 0.77], [0.35, 0.17, 0.83], [0.58, 0.0, 0.81], [0.35, -0.17, 0.83], [0.05, -0.28, 0.77], [-0.10, -0.30, 0.60]], 0.03, { nu: 64, nv: 16 }));
```

(`nv: 16` rounds the tube's cross-section too; it's 0.4 m from the cockpit eye.)

- [ ] **Step 2: Mirror housings get their own part name**

Change the mirror line from part `'chassis'` to `'mirror'`:

```js
    mirror((s) => ellipsoid('mirror', [0.74, 0.56 * s, 0.68], [0.05, 0.10, 0.032], { nu: 8, nv: 14 })); // FIA box: x 0.65-0.83, y 0.47-0.68
```

- [ ] **Step 3: Paint the mirror face as dark glass**

In `common` (line ~278), add a rule at the end of the returned list, after the T-cam rule:

```js
    [wings, (t) => t.is(...WINGS)], [halo, (t) => t.is('halo')], ['#ff1b1b', (t) => t.is('light')], ['#ffd400', (t) => t.is('tcam') && t.z > 0.975],
    ['#0b1016', (t) => t.is('mirror') && t.x < 0.735]]; // the mirror glass faces the driver
```

The housing still takes the body colour from the first rule (`[body, () => true]`), as it did as `'chassis'`. Check any team rule that names `'chassis'` and was meant to include the mirrors: `grep -n "'chassis'" public/js/carShape.js` — if a team paints `'chassis'`, add `'mirror'` to that `t.is(...)` call so the housing keeps its colour.

- [ ] **Step 4: Run the asset tests and the full suite**

Run: `node --test test/assets.test.js && npm test 2>&1 | grep -E "^✖|ℹ (pass|fail)"`
Expected: PASS, `ℹ fail 0`. Print the new counts: `node -e "import('./public/js/carShape.js').then(S=>{for(const d of ['low','mid','high'])console.log(d,S.bodyArrays(d).idx.length/3)})"` — high must stay under 40 000.

- [ ] **Step 5: Commit**

```bash
git add public/js/carShape.js
git commit -m "Car close up: rounder halo, dark glass on the mirror faces"
```

---

### Task 4: Onboard views in the game — keys, pose, shadow box, two-pass render, wheel

**Files:**
- Modify: `public/js/game3d.js` (imports; state near `toggleCoach` ~line 175; `onKey` ~line 246-265; lights ~line 116-121; `makeCar` ~line 1589-1633; `updateCamera` ~line 1799-1828; `frame` ~line 2400-2420)
- Modify: `public/index.html` (camera button inside the HUD, next to `#tyre-card`)
- Modify: `public/css/style.css` (append)

**Interfaces:**
- Consumes: Task 1 `VIEW_NAMES, VIEW_FOV, EYE, EYE_TILT, nextView, viewOf, onboard, wheelAngle, shadowHalf, toThree`; Task 2 `buildSteeringWheel`.
- Produces: `window.lanraceDebug`-free; module state `view`, `activeView`, `layered`, `steeringWheel`. `makeCar` now returns `{ id, root, model, wheels, teamId, ghost, tag }` (`model` null for the box fallback).

- [ ] **Step 1: Imports and view state**

Imports at the top of `game3d.js`:

```js
import { buildCar, buildSteeringWheel, liveryTexture as carLivery, WHEEL_RADIUS } from './carModel.js';
import { VIEW_NAMES, VIEW_FOV, EYE, EYE_TILT, nextView, viewOf, onboard, wheelAngle, shadowHalf, toThree } from './views.js';
```

After `toggleCoach` (≈ line 183):

```js
let view = viewOf(store.get('lanrace.view')); // chase / T-cam / cockpit, remembered
document.body.classList.toggle('view-cockpit', view === 'cockpit');
function cycleView() {
    view = nextView(view);
    store.set('lanrace.view', view);
    document.body.classList.toggle('view-cockpit', view === 'cockpit'); // the wheel's display replaces the dash's gear and revs
    window.showBanner?.(`CAMERA: ${VIEW_NAMES[view]}`, true);
}
document.getElementById('cam-btn').addEventListener('click', (e) => { e.currentTarget.blur(); if (clientState.status !== 'LOBBY') cycleView(); });
```

- [ ] **Step 2: Keys — `V` cycles the camera, `F` takes over the after-finish swap**

In `onKey`, add next to the coach line:

```js
    if (down && key === 'v' && !e.repeat && clientState.status !== 'LOBBY') cycleView();
```

and change the after-finish block's key and banner from `v` / `V TO WATCH` to `f` / `F TO WATCH`:

```js
    if (down && key === 'f' && !e.repeat && clientState.gameState?.[clientState.me]?.finished && !isSpectator()) {
        ownView = !ownView;
        window.showBanner?.(ownView ? 'YOUR CAR · F TO WATCH' : 'WATCHING', true);
    }
```

Then `grep -n "V TO\|press V\|(V)" public/js/*.js public/index.html` and update any remaining hint that means the after-finish swap.

- [ ] **Step 3: Camera button and cockpit HUD rule**

`public/index.html`, directly before `<div id="tyre-card" class="hidden">`:

```html
            <button type="button" id="cam-btn" title="Camera: chase, T-cam, cockpit (V)">CAM</button>
```

Append to `public/css/style.css`:

```css
/* Onboard cameras: a camera button on touch screens (keyboards have V); in the cockpit the wheel shows gear, speed and revs */
#cam-btn { display: none; }
body.touch #cam-btn { display: block; position: absolute; right: var(--pad); top: calc(var(--pad) + 13em); min-width: 44px; min-height: 44px; padding: 0 10px; border: 0; border-radius: 8px;
    background: rgba(0,0,0,0.6); color: #fff; font-weight: 900; letter-spacing: 0.1em; pointer-events: auto; }
body.view-cockpit #rev-lights, body.view-cockpit #cluster .cl-main { display: none; }
```

- [ ] **Step 4: `makeCar` returns its id and model**

In `makeCar`, declare `let model = null;` before `if (carTemplate) {`, change `const model = carTemplate.clone(true);` to `model = carTemplate.clone(true);`, and change the return to:

```js
    return { id, root, model, wheels, teamId: lp.teamId, ghost: false, tag };
```

- [ ] **Step 5: Lights on layer 1, the close-range camera, the layered car**

After `scene.add(sun, sun.target);` (≈ line 121):

```js
// Onboard views: after the world, depth is cleared and only the followed car (layer 1) is drawn again with a 1 cm near plane,
// so the halo and wheel never clip and the track keeps its depth precision. The lights must be on layer 1 to light it.
sun.layers.enable(1); hemi.layers.enable(1);
const fpCam = new THREE.PerspectiveCamera(60, 1, 0.06, 60);
fpCam.layers.set(1);
let activeView = 'chase', layered = null, steeringWheel = null;
function setLayered(car) {
    if (layered === car) return;
    layered?.model?.traverse((o) => o.layers.disable(1));
    car?.model?.traverse((o) => o.layers.enable(1));
    layered = car;
}
```

(`setLayered` on the old car also disables layer 1 on the steering wheel meshes while the wheel is still parented there; Step 6 re-parents it every frame and re-enables them, so call `setLayered` before re-parenting. The wheel's own meshes are re-enabled by `steeringWheel.root.traverse((o) => o.isMesh && o.layers.enable(1))` in Step 6.)

- [ ] **Step 6: `updateCamera` — onboard pose, shadow box, wheel**

Replace the body of `updateCamera` from `const h = camHeading;` down to and including `camera.lookAt(look);` with:

```js
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
    setLayered(layeredNow ? car : null);
    if (v === 'cockpit' && layeredNow) {
        steeringWheel ||= buildSteeringWheel(document.createElement('canvas'));
        if (steeringWheel.root.parent !== car.model) {
            car.model.add(steeringWheel.root);
            steeringWheel.setGlove(teamInfo[car.teamId]?.chatColor || '#e10600');
        }
        steeringWheel.root.traverse((o) => o.isMesh && o.layers.enable(1));
        steeringWheel.root.visible = true;
        steeringWheel.spin.rotation.x = wheelAngle(clientState.gameState?.[car.id]?.steer);
    } else if (steeringWheel) steeringWheel.root.visible = false;
    // Moved in whole shadow-map texels so shadow edges don't shimmer as the car drives; onboard, a tighter box: sharper
    const half = shadowHalf(activeView);
    if (sun.shadow.camera.right !== half) {
        Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
        sun.shadow.camera.updateProjectionMatrix();
    }
    const q = snapLight({ x: p.x, y: p.y, z: p.z }, SUN_OFF, (2 * half) / (Q.shadows || 1024));
    sun.position.set(q.x + SUN_OFF.x, q.y + SUN_OFF.y, q.z + SUN_OFF.z);
    sun.target.position.set(q.x, q.y, q.z);
}
```

and delete the old three shadow lines that followed `camera.lookAt(look);` (now inside the block above). Next to `const look = new THREE.Vector3(), pitCam = new THREE.Vector3();` add:

```js
const eyeTurn = new THREE.Quaternion(), eyeEuler = new THREE.Euler();
```

Note: the chase `camHeading` smoothing above `const h` stays, so switching back to chase doesn't swing.

- [ ] **Step 7: Second pass in `frame` and the wheel display at HUD rate**

Replace `if (!compiling) renderer.render(scene, camera);` with:

```js
    if (!compiling) { // a draw before the shaders are ready compiles them there and then (a ~1.6 s freeze)
        renderer.render(scene, camera);
        if (activeView !== 'chase' && layered) { // onboard: the followed car again over the world, with a 1 cm near plane
            fpCam.position.copy(camera.position);
            fpCam.quaternion.copy(camera.quaternion);
            if (fpCam.fov !== camera.fov || fpCam.aspect !== camera.aspect) { fpCam.fov = camera.fov; fpCam.aspect = camera.aspect; fpCam.updateProjectionMatrix(); }
            renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; // keep this frame's colour and shadow map
            renderer.clearDepth();
            renderer.render(scene, fpCam);
            renderer.autoClear = true; renderer.shadowMap.autoUpdate = true;
        }
    }
```

In the HUD block (`if (now - lastHud > 66) {`), after `updateHUD(...)`:

```js
        if (activeView === 'cockpit' && steeringWheel && layered) {
            steeringWheel.draw({ gear: hudGear, kmh: document.getElementById('hud-speed').innerText, lit: Math.max(0, hudLit), drs: !!clientState.gameState[layered.id]?.drs });
        }
```

- [ ] **Step 8: Run the suite**

Run: `npm test 2>&1 | grep -E "^✖|ℹ (pass|fail)"`
Expected: `ℹ fail 0` (game3d.js has no node tests; this guards everything else). Also syntax-check the module: `node --check public/js/game3d.js` is not valid for ES module imports of bare `three` — instead run `node -e "import('./public/js/views.js')"` and rely on Task 5's browser run for `game3d.js`.

- [ ] **Step 9: Commit**

```bash
git add public/js/game3d.js public/index.html public/css/style.css
git commit -m "Onboard cameras: V cycles chase, T-cam, cockpit; close-range second pass, tighter shadows, live steering wheel"
```

---

### Task 5: Browser check (headless Chrome over CDP, not the extension) and tuning

**Files:**
- Create (scratch, not committed): `$SCRATCH/cams.mjs` where `$SCRATCH` is the session scratchpad
- Modify (only if the screenshots demand): `public/js/views.js` constants (`EYE`, `EYE_TILT`, `WHEEL_POS`), `sun.shadow.bias` in `game3d.js`

**Interfaces:** consumes everything above; produces screenshots and, at most, retuned constants.

- [ ] **Step 1: Start the server**

Run (background): `PORT=3232 npm start`
Expected: `> Host Locally:  http://localhost:3232`

- [ ] **Step 2: Start headless Chrome with remote debugging and software WebGL**

Run (background):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=1280,720 --user-data-dir="$SCRATCH/chrome" http://localhost:3232
```

- [ ] **Step 3: Write the driver script**

Create `$SCRATCH/cams.mjs` (Node 24: global `fetch` and `WebSocket`):

```js
// Drive the real game in headless Chrome: join, start with AI, then a screenshot per camera view.
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const [page] = (await (await fetch('http://localhost:9333/json')).json()).filter((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const wait = (ms) => new Promise((r) => setTimeout(r, ms)), logs = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++n; ws.addEventListener('message', function h(e) { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); res(m.result); } }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value).join(' ')); });
await send('Runtime.enable');
const js = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });
const key = async (k) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: `Key${k.toUpperCase()}`, text: type === 'keyDown' ? k : undefined }); };
const shot = async (name) => writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await wait(1500);
await js(`document.getElementById('username').value = 'CAM'; document.getElementById('username').dispatchEvent(new Event('input')); document.querySelector('.team-card').click(); document.getElementById('btn-join').click();`);
await wait(1000);
await js(`for (const [id, v] of [['setting-quali', 'off'], ['setting-ai', '1'], ['setting-ai-count', '5']]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); } document.getElementById('btn-start').click();`);
await wait(9000); // lights out
await key('w'); await wait(4000);
await shot('1-chase');
await key('v'); await wait(800); await shot('2-tcam');
await key('v'); await wait(800); await shot('3-cockpit');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', text: 'd' }); await wait(600); await shot('4-cockpit-steer-right');
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD' });
await key('v'); await wait(800); await shot('5-back-to-chase');
console.log(logs.length ? `ERRORS:\n${logs.join('\n')}` : 'no console errors');
process.exit(0);
```

If the join/start selectors differ from the lobby markup, read `public/index.html` / `public/js/app.js` for the real ids and fix the script (the script is scratch; never change product code to suit it).

- [ ] **Step 4: Run it and look at every screenshot**

Run: `node $SCRATCH/cams.mjs $SCRATCH`
Expected: `no console errors`. Read each PNG:
- `1-chase`: unchanged chase view.
- `2-tcam`: halo and nose in frame from above the driver's helmet; full HUD; nothing clipped.
- `3-cockpit`: halo centre pillar, wheel with its display (gear, speed, rev lights), gloves, mirrors; no helmet shell across the view; dash card shows lap times but not gear/speed/rev lights.
- `4-cockpit-steer-right`: the wheel turned clockwise.
- `5-back-to-chase`: chase again, wheel gone.

- [ ] **Step 5: Tune once, re-shoot once**

If the cockpit sees mostly the cockpit lid or too much sky, adjust `EYE.cockpit[2]` (±0.02) and `EYE_TILT.cockpit`; if the wheel sits too low/high, `WHEEL_POS[2]`; if shadow acne speckles the halo or wheel, set `sun.shadow.normalBias = 0.02` in `game3d.js`. Re-run Step 4 once. Re-run `node --test test/views.client.test.js` if `views.js` changed (the eye must stay inside the helmet).

- [ ] **Step 6: Also check the review-focus cases in the same browser**

Extend the script (scratch) or run extra `js(...)` lines: press `B` and drive into the pits in cockpit view (pit camera takes over, no car drawn over the crew); set the quality level to Low via the settings (`store` key `lanrace.quality` = `low`, reload) and confirm cockpit renders. Record what was checked and what wasn't in the report.

- [ ] **Step 7: Full suite, commit any tuning**

Run: `npm test 2>&1 | grep -E "^✖|ℹ (pass|fail)"`
Expected: `ℹ fail 0`

```bash
git add public/js/views.js public/js/game3d.js
git commit -m "Onboard cameras: eye and wheel tuned from the browser check"
```

(Skip the commit if nothing changed.)
