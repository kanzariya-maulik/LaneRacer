# Render Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move LanRace's drawing to three.js `WebGPURenderer` with a physical sky, sky-lit reflections, cascaded shadows and a post-processing chain, with a new Ultra level and quality levels that keep weak laptops playable.

**Architecture:** `game3d.js` keeps owning the scene; the renderer swap is in place (import map → `three.webgpu.js`). Pure rules (levels, auto-pick, depth bias sign) live in `quality.js` and are node-tested. The post chain is a new browser-only module `postfx.js` that turns a level's `effects` list into a `RenderPipeline`. Onboard views drop the two-pass trick for one pass with a reversed depth buffer.

**Tech Stack:** three r186 (`three/webgpu`, `three/tsl`, `three/addons/tsl/display/*`, `CSMShadowNode`, `SkyMesh`), Node `node --test`, headless Chrome over the DevTools protocol (Node 24 global `WebSocket`).

**Spec:** `docs/superpowers/specs/2026-10-15-render-pipeline-design.md`

## Global Constraints

- No new npm dependency; everything comes from `node_modules/three` (r186).
- `carview.html` is not touched (own import map, `WebGLRenderer`).
- World scale: 1 m = 6 world units (`track.scale`). Main camera near = 0.06 units (1 cm), far = `Q.far`.
- Levels: `low`, `medium`, `high`, `ultra`, in that order. Stored values `lanrace.quality` / `lanrace.quality.auto` stay valid.
- Browser checks: port **3299** only (never 3232, the user's live server), Chrome with `--mute-audio`, kill only PIDs you started, check `lsof -iTCP:3299 -sTCP:LISTEN` first.
- Tone mapping `AgXToneMapping`. Blob shadow only on `low`.
- All existing tests stay green: `npm test`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Road layers and decals with reversed depth.** Kerbs, lines, tyre marks, racing line and blob shadow use negative `polygonOffset` to sit over the asphalt; neither three backend flips the sign for a reversed depth buffer, so they would sink under it. Expected: no flicker or missing kerbs at any distance. Pinned by the `depthBias` test (Task 1) and the far-straight screenshot (Task 7).
2. **WebGL2 browser without `EXT_clip_control`.** Reversed depth silently falls back to normal depth; with a 1 cm near plane the far track would z-fight. Expected: renderer rebuilt with `logarithmicDepthBuffer`, track clean. Pinned by Task 2 step "forced fallback".
3. **Auto level on a strong PC.** Today the auto pick is measured once and stored, so `ultra` would never be reached. Expected: a stored `high` is measured again once and can become `ultra`. Pinned by `autoPick`/`shouldMeasure` tests (Task 1).
4. **An effect that fails to compile on some GPU.** Expected: the race keeps running at the `low` chain with one console warning, not a black screen. Pinned by Task 5 forced-failure step.
5. **GPU reset mid-race** (driver reset, laptop graphics switch). Expected: picture comes back one level lower with a banner. Pinned by Task 6 forced device-loss step.

---

### Task 1: Level rules (pure)

**Files:**
- Modify: `public/js/quality.js` (whole `LEVELS`, `ratioRange` → `scaleRange` + `pixelRatio`, `autoPick`, `resolveLevel`; add `stepDown`, `shouldMeasure`, `depthBias`; delete `snapLight`)
- Modify: `public/js/views.js` (delete `shadowHalf`)
- Test: `test/quality.test.js`, `test/views.client.test.js`

**Interfaces:**
- Produces (all exported from `quality.js`):
  - `LEVELS[level]`: `{ scale: [start, min, max], dpr, effects: string[], shadows, cascades, scenery, far, fog, envMap, tyreMarks, anisotropy }`
  - `ORDER = ['low', 'medium', 'high', 'ultra']`
  - `scaleRange(level) → { start, min, max }` (internal render scale; feeds `adaptStep` as `ratio`/`min`/`max`)
  - `pixelRatio(level, dpr) → number` = `Math.min(dpr, LEVELS[level].dpr)`
  - `stepDown(level) → level`
  - `resolveLevel(choice, autoResult, backend = 'webgpu') → level`
  - `autoPick(avgFrameMs, current, dpr) → level`
  - `shouldMeasure(choice, stored) → boolean`
  - `depthBias(n, reversed) → number`
  - unchanged: `adaptStep`, `frameCapped`

- [ ] **Step 1: Write the failing tests**

In `test/quality.test.js` replace the tests `presets follow the spec table`, `ratioRange caps High…`, `resolveLevel…`, `autoPick…` and delete `snapLight…`; add the new ones:

```js
test('presets follow the spec table', () => {
    assert.deepStrictEqual(Object.keys(Q.LEVELS), ['low', 'medium', 'high', 'ultra']);
    assert.deepStrictEqual(Q.ORDER, ['low', 'medium', 'high', 'ultra']);
    for (const [name, L] of Object.entries(Q.LEVELS)) {
        for (const k of ['scale', 'dpr', 'effects', 'shadows', 'cascades', 'scenery', 'far', 'fog', 'envMap', 'tyreMarks', 'anisotropy']) assert.ok(k in L, `${name}.${k}`);
        const [s, lo, hi] = L.scale;
        assert.ok(lo <= s && s <= hi && hi <= 1 && lo > 0, `${name} scale`);
        assert.strictEqual(L.effects.includes('taau') + L.effects.includes('traa') + L.effects.includes('smaa') + L.effects.includes('fxaa'), 1, `${name}: one anti-aliasing`);
    }
    assert.deepStrictEqual([Q.LEVELS.low.shadows, Q.LEVELS.medium.shadows, Q.LEVELS.high.shadows, Q.LEVELS.ultra.shadows], [0, 1024, 2048, 4096]);
    assert.deepStrictEqual([Q.LEVELS.low.cascades, Q.LEVELS.medium.cascades, Q.LEVELS.high.cascades, Q.LEVELS.ultra.cascades], [0, 2, 3, 4]);
    assert.deepStrictEqual(Q.LEVELS.low.effects, ['fxaa', 'fsr1']);
    assert.deepStrictEqual(Q.LEVELS.ultra.scale, [1, 1, 1], 'ultra renders at full scale');
    assert.ok(Q.LEVELS.ultra.effects.includes('ssr') && !Q.LEVELS.high.effects.includes('ssr'));
    assert.deepStrictEqual([Q.LEVELS.low.scenery, Q.LEVELS.medium.scenery, Q.LEVELS.high.scenery, Q.LEVELS.ultra.scenery], [0.3, 0.6, 1, 1]);
});

test('scaleRange and pixelRatio: internal scale per level, device pixels capped per level', () => {
    assert.deepStrictEqual(Q.scaleRange('low'), { start: 0.75, min: 0.5, max: 1 });
    assert.deepStrictEqual(Q.scaleRange('high'), { start: 1, min: 0.75, max: 1 });
    assert.strictEqual(Q.pixelRatio('low', 2), 1);
    assert.strictEqual(Q.pixelRatio('high', 3), 2);
    assert.strictEqual(Q.pixelRatio('high', 1), 1);
});

test('resolveLevel: manual wins, auto uses the measurement, else Medium (Low on WebGL2)', () => {
    assert.strictEqual(Q.resolveLevel('low', 'high'), 'low');
    assert.strictEqual(Q.resolveLevel('ultra', null, 'webgl2'), 'ultra', 'a manual choice is never lowered');
    assert.strictEqual(Q.resolveLevel('auto', 'high'), 'high');
    assert.strictEqual(Q.resolveLevel('auto', 'high', 'webgl2'), 'high', 'a real measurement is kept');
    assert.strictEqual(Q.resolveLevel('auto', null), 'medium');
    assert.strictEqual(Q.resolveLevel('auto', null, 'webgl2'), 'low');
    assert.strictEqual(Q.resolveLevel('garbage', 'nope'), 'medium');
});

test('stepDown: one level lower, Low stays Low', () => {
    assert.deepStrictEqual(Q.ORDER.map(Q.stepDown), ['low', 'low', 'medium', 'high']);
});

test('autoPick: slow → Low, fast → High, very fast on High → Ultra, Ultra kept unless slow', () => {
    assert.strictEqual(Q.autoPick(25, 'medium', 1), 'low');
    assert.strictEqual(Q.autoPick(10, 'medium', 1), 'high');
    assert.strictEqual(Q.autoPick(6, 'medium', 1), 'high', 'Ultra only from a measurement taken on High');
    assert.strictEqual(Q.autoPick(16, 'medium', 1), 'medium');
    assert.strictEqual(Q.autoPick(6, 'high', 1), 'ultra');
    assert.strictEqual(Q.autoPick(9, 'high', 1), 'high');
    assert.strictEqual(Q.autoPick(10, 'ultra', 1), 'ultra');
    assert.strictEqual(Q.autoPick(25, 'ultra', 1), 'low');
});

test('shouldMeasure: auto with nothing stored, or a stored High that may be Ultra; never a manual choice', () => {
    assert.strictEqual(Q.shouldMeasure('auto', null), true);
    assert.strictEqual(Q.shouldMeasure('auto', 'high'), true);
    assert.strictEqual(Q.shouldMeasure('auto', 'medium'), false);
    assert.strictEqual(Q.shouldMeasure('auto', 'ultra'), false);
    assert.strictEqual(Q.shouldMeasure('high', null), false);
});

test('depthBias: decals pulled toward the camera with either depth direction', () => {
    assert.strictEqual(Q.depthBias(-4, false), -4);
    assert.strictEqual(Q.depthBias(-4, true), 4);
    assert.strictEqual(Q.depthBias(0, true), 0);
});
```

In `test/views.client.test.js`, in the third test, delete the three `V.shadowHalf(...)` lines and rename the test to `'wheel angle: ±90° at full lock, clamped, right is positive; car frame to three.js'`; add:

```js
test('shadowHalf is gone: cascaded shadows fit themselves', () => {
    assert.strictEqual(V.shadowHalf, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/quality.test.js test/views.client.test.js`
Expected: FAIL (`ultra` missing, `Q.ORDER`/`scaleRange`/`stepDown`/`shouldMeasure`/`depthBias` not functions, `shadowHalf` still defined).

- [ ] **Step 3: Implement**

In `public/js/quality.js` replace everything above `export function adaptStep` with:

```js
// Graphics levels and the rules that pick and adapt them. Pure, shared by game3d.js, postfx.js and the node tests.
// scale: internal render scale [start, min, max] (adaptStep moves it, the upscaler fills the screen); dpr: device-pixel cap.
// effects: the post chain in postfx.js order of meaning (one anti-aliasing each). cascades: CSM cascades (0 = no shadows).
export const LEVELS = {
    low:    { scale: [0.75, 0.5, 1], dpr: 1, effects: ['fxaa', 'fsr1'], shadows: 0, cascades: 0,
              scenery: 0.3, far: 6000, fog: 6000, envMap: false, tyreMarks: false, anisotropy: 1 },
    medium: { scale: [1, 0.6, 1], dpr: 1, effects: ['ao', 'bloom', 'vignette', 'smaa', 'fsr1'], shadows: 1024, cascades: 2,
              scenery: 0.6, far: 12000, fog: 12000, envMap: true, tyreMarks: true, anisotropy: 4 },
    high:   { scale: [1, 0.75, 1], dpr: 2, effects: ['ao', 'bloom', 'motionBlur', 'vignette', 'taau'], shadows: 2048, cascades: 3,
              scenery: 1, far: 20000, fog: 16000, envMap: true, tyreMarks: true, anisotropy: 8 },
    ultra:  { scale: [1, 1, 1], dpr: 2, effects: ['ao', 'ssr', 'bloom', 'lensflare', 'godrays', 'motionBlur', 'vignette', 'grain', 'traa'], shadows: 4096, cascades: 4,
              scenery: 1, far: 20000, fog: 16000, envMap: true, tyreMarks: true, anisotropy: 8 },
};
export const ORDER = ['low', 'medium', 'high', 'ultra'];

export function scaleRange(level) {
    const [start, min, max] = LEVELS[level].scale;
    return { start, min, max };
}

export const pixelRatio = (level, dpr) => Math.min(dpr, LEVELS[level].dpr);

export const stepDown = (level) => ORDER[Math.max(0, ORDER.indexOf(level) - 1)];

// A manual choice is kept as is. Auto: the measured level, else Medium — Low on the slower WebGL2 fallback
export function resolveLevel(choice, autoResult, backend = 'webgpu') {
    if (choice in LEVELS) return choice;
    if (autoResult in LEVELS) return autoResult;
    return backend === 'webgl2' ? 'low' : 'medium';
}

// After 5 s of driving: under ~45 fps → Low; over ~85 fps → High; over ~140 fps while on High → Ultra
export function autoPick(avgFrameMs, current, dpr) {
    if (avgFrameMs > 22) return 'low';
    if (current === 'high' && avgFrameMs < 7) return 'ultra';
    if (current === 'ultra') return 'ultra';
    if (avgFrameMs < 11.8 && dpr >= 1) return 'high';
    return current;
}

// Auto measures when nothing is stored yet, and once more from a stored High (the only way up to Ultra)
export const shouldMeasure = (choice, stored) => choice === 'auto' && (!stored || stored === 'high');

// polygonOffset pulls decals toward the camera with negative values; a reversed depth buffer needs the sign flipped
export const depthBias = (n, reversed) => (reversed && n ? -n : n);
```

Delete `snapLight` (the whole function and its comment) at the bottom of `quality.js`.

In `public/js/views.js` delete the `shadowHalf` export and its comment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/quality.test.js test/views.client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (game3d.js still imports the removed names; Task 2 fixes that and is committed right after — do not merge between the two)

```bash
git add public/js/quality.js public/js/views.js test/quality.test.js test/views.client.test.js
git commit -m "Quality levels for the new pipeline: Ultra, internal scale, effects list, depth bias sign, Ultra reachable from auto"
```

---

### Task 2: Browser check script + WebGPU renderer, one-pass onboard views

**Files:**
- Create: `scripts/browser-check.mjs` (headless Chrome driver used by Tasks 2–7)
- Modify: `public/index.html` (import map, Graphics menu)
- Modify: `public/js/game3d.js` (renderer creation, imports, `applyLevel`, onboard layer code, frame loop, fps overlay, auto-pick, polygon offsets)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces (module-level in `game3d.js`, used by Tasks 3–6): `let renderer`, `let backend` (`'webgpu' | 'webgl2'`), `let reversed` (boolean, the renderer's actual `reversedDepthBuffer`), `async function createRenderer({ logDepth })`, `let onboardCar` (the car whose onboard view is in use, or `null`). `window.lanraceQuality = { choice, level, backend }`.
- `scripts/browser-check.mjs` CLI: `node scripts/browser-check.mjs --track monza --level high --time day --views chase,tcam,cockpit --out <dir> [--headed] [--fps 10]` → writes `<dir>/<track>-<time>-<level>-<view>.png`, prints one JSON line `{ backend, level, fps, errors: [...] }`; exit code 1 if any console error.

- [ ] **Step 1: Write the browser check script**

`scripts/browser-check.mjs`:

```js
// Drives a local LanRace race in Chrome over the DevTools protocol: screenshots per view, fps, console errors.
// Uses its own server on PORT 3299 (never the user's 3232) and kills only what it started.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] ?? true; };
const PORT = 3299, DBG = 9299, track = arg('track', 'monza'), level = arg('level', 'high'), time = arg('time', 'day');
const views = String(arg('views', 'chase')).split(','), out = arg('out', 'shots'), fpsSecs = Number(arg('fps', 0)), headed = process.argv.includes('--headed');
mkdirSync(out, { recursive: true });

if (execSync(`lsof -iTCP:${PORT} -sTCP:LISTEN -t || true`).toString().trim()) { console.error(`port ${PORT} busy`); process.exit(2); }
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    ...(headed ? [] : ['--headless=new']), `--remote-debugging-port=${DBG}`, '--mute-audio', '--enable-unsafe-webgpu',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${out}/.chrome`, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', stop);

let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const until = async (expr, ms = 60000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(250)) if (await evalJs(expr)) return true; throw new Error(`timeout: ${expr}`); };

try {
    await wait(1500);
    if (/EADDRINUSE/.test(serverLog)) throw new Error('server port in use');
    let target;
    for (let i = 0; i < 40 && !target; i++, await wait(250)) target = await fetch(`http://127.0.0.1:${DBG}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id && pending.has(d.id)) { pending.get(d.id)({ result: d.result }); pending.delete(d.id); }
        if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
        if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: `http://localhost:${PORT}/?stats=1` });
    await until(`document.readyState === 'complete'`);
    await evalJs(`localStorage.setItem('lanrace.quality', ${JSON.stringify(level)}); true`);
    await send('Page.reload'); await until(`!!document.getElementById('btn-join')`);
    await evalJs(`document.getElementById('username').value = 'Check'; document.getElementById('btn-join').click(); true`);
    await until(`!document.getElementById('host-settings').classList.contains('hidden')`);
    await evalJs(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('setting-track', ${JSON.stringify(track)}); set('setting-time', ${JSON.stringify(time)}); set('setting-quali', 'off'); set('setting-laps', '1');
        document.getElementById('btn-start').click(); return true; })()`);
    await until(`typeof clientState !== 'undefined' && clientState.status === 'RACE' && window.lanraceFps > 0`, 90000);
    await wait(3000); // shaders warm, first frames settled
    const backend = await evalJs(`window.lanraceQuality?.backend || 'webgl'`);
    let fps = null;
    if (fpsSecs) { const s = []; for (let i = 0; i < fpsSecs; i++) { await wait(1000); s.push(await evalJs('window.lanraceFps')); } fps = Math.round(s.reduce((a, b) => a + b) / s.length); }
    for (const v of views) {
        // cycle with V until the wanted view is on (chase → tcam → cockpit)
        for (let i = 0; i < 3 && (await evalJs(`window.lanraceView || 'chase'`)) !== v; i++) {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
            await wait(600);
        }
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${out}/${track}-${time}-${level}-${v}.png`, Buffer.from(shot.result.data, 'base64'));
    }
    console.log(JSON.stringify({ track, time, level: await evalJs('window.lanraceQuality?.level'), backend, fps, errors }));
    process.exitCode = errors.length ? 1 : 0;
} catch (e) {
    console.log(JSON.stringify({ track, time, level, error: String(e), errors, serverLog: serverLog.slice(-800) }));
    process.exitCode = 1;
} finally { ws?.close(); stop(); }
```

`game3d.js` must expose the current view for the script: in `updateCamera`, right after `activeView = …` add `window.lanraceView = activeView;` (done in Step 5 below).

- [ ] **Step 2: Record the baseline (before any renderer change)**

Run (on this branch's Task 1 parent, i.e. `git stash` nothing — use a worktree of `develop` so the baseline is the shipped game):

```bash
git worktree add ../LanRace-baseline develop && cd ../LanRace-baseline && ln -s ../LanRace/node_modules node_modules
cp ../LanRace/scripts/browser-check.mjs scripts/
for L in low medium high; do node scripts/browser-check.mjs --track monza --level $L --views chase,cockpit --fps 10 --out ../LanRace/docs/superpowers/baseline; done
cd ../LanRace && git worktree remove --force ../LanRace-baseline
```

Expected: three JSON lines with `fps` numbers (the baseline uses `lanraceView` only for view cycling; on `develop` the script's view loop presses V three times at most — screenshots may all be chase; that is fine, the baseline is fps). Save the three lines into `docs/superpowers/baseline/fps.txt`. Do not commit the PNGs (add `docs/superpowers/baseline/*.png` and `.chrome` to `.gitignore`).

- [ ] **Step 3: Import map and menu**

`public/index.html`, replace the import map:

```html
    <script type="importmap">
        { "imports": { "three": "/vendor/three/build/three.webgpu.js", "three/webgpu": "/vendor/three/build/three.webgpu.js", "three/tsl": "/vendor/three/build/three.tsl.js", "three/addons/": "/vendor/three/examples/jsm/" } }
    </script>
```

In `#graphics-select` add after `<option value="high">High</option>`:

```html
                                    <option value="ultra">Ultra</option>
```

- [ ] **Step 4: Renderer creation**

`game3d.js` imports: change the `quality.js` import line to

```js
import { LEVELS, ORDER, scaleRange, pixelRatio, resolveLevel, autoPick, shouldMeasure, stepDown, depthBias, adaptStep, frameCapped } from './quality.js';
```

and remove `shadowHalf` from the `views.js` import.

Replace the block from `let level = resolveLevel(choice, …` through `renderer.setPixelRatio(res.ratio);` (just before `const SKY = 0x9cc8ef;`) with:

```js
// WebGPU where the browser has it, else three's WebGL2 backend. Reversed depth keeps a 1 cm near plane precise out to
// 20 km (onboard views draw in one pass); a WebGL2 without EXT_clip_control can't reverse depth: logarithmic depth instead
let renderer, backend, reversed;
async function createRenderer({ logDepth = false } = {}) {
    const r = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance',
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
```

Change the camera line to the 1 cm near plane:

```js
const camera = new THREE.PerspectiveCamera(60, 1, 0.06, Q.far);
```

- [ ] **Step 5: One-pass onboard views**

Delete these lines (around the sun/hemi setup): `sun.layers.enable(1); hemi.layers.enable(1);`, the two `fpCam` lines, `ownWheels`, and the whole `setLayered` function with its comments. Replace `let activeView = 'chase', layered = null, steeringWheel = null;` with:

```js
let activeView = 'chase', onboardCar = null, steeringWheel = null; // onboardCar: the car whose T-cam/cockpit is in use
```

In `updateCamera`:
- `if (!car) { activeView = 'chase'; setLayered(null); return; }` → `if (!car) { activeView = 'chase'; onboardCar = null; window.lanraceView = activeView; return; }`
- replace `setLayered(layeredNow ? car : null);` with `onboardCar = layeredNow ? car : null; window.lanraceView = activeView;`
- delete `steeringWheel.root.traverse((o) => o.isMesh && o.layers.enable(1));`
- delete the whole shadow-follow tail (from the comment `// Moved in whole shadow-map texels…` through `sun.target.position.set(q.x, q.y, q.z);`) — Task 4 replaces it with CSM. Until then the sun's shadow box stays where `applySky` put it (shadows look wrong between Task 2 and Task 4; expected).

In `updateWheelBatch` delete `if (cars[id] === layered) o.material.color.copy(band); // the close pass draws this tyre itself`.

In `frame`:
- `else { activeView = 'chase'; setLayered(null); }` → `else { activeView = 'chase'; onboardCar = null; }`
- replace the draw block (`renderer.render(scene, camera);` and the whole `if (activeView !== 'chase' && layered) { … }`) with `renderer.render(scene, camera);`
- in the HUD block replace `layered` with `onboardCar` (three places).

In `applyLevel` replace the body after `window.lanraceQuality.level = l;` with (shadows stay the old single map until Task 4):

```js
    renderer.shadowMap.enabled = Q.shadows > 0;
    sun.castShadow = Q.shadows > 0;
    if (Q.shadows) sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    scene.fog = new THREE.Fog(SKY, 3000, Q.fog);
    camera.far = Q.far;
    camera.updateProjectionMatrix();
    res = { ...scaleRange(l), good: 0, ratio: Math.min(scaleRange(l).max, Math.max(scaleRange(l).min, res.ratio)) };
    renderer.setPixelRatio(pixelRatio(l, window.devicePixelRatio));
```

In the fps block: `renderer.setPixelRatio(next.ratio)` → delete that line (Task 5 applies `res.ratio` as the internal scale); the stats text becomes

```js
        if (stats) stats.textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.calls} calls · ${res.ratio.toFixed(2)}× · ${level}${choice === 'auto' ? ' (auto)' : ''} · ${backend}`;
```

Auto-pick: replace `if (choice === 'auto' && !store.get('lanrace.quality.auto') && me && Math.abs(me.speed) > 0) {` with

```js
    if (!autoDone && shouldMeasure(choice, store.get('lanrace.quality.auto')) && me && Math.abs(me.speed) > 0) {
```

and inside, after `store.set('lanrace.quality.auto', picked);` add `autoDone = true; // once per page: a stored High is measured again only on the next load`. Declare `let autoDone = false;` next to `autoMs`.

- [ ] **Step 6: Depth bias sign**

Three `polygonOffset` materials: wrap every `polygonOffsetFactor` / `polygonOffsetUnits` value with `depthBias(…, reversed)`:

```js
        polygonOffset: !!opts.layer, polygonOffsetFactor: depthBias(-(opts.layer || 0), reversed), polygonOffsetUnits: depthBias(-(opts.layer || 0) * 2, reversed),
```
```js
        polygonOffset: true, polygonOffsetFactor: depthBias(-3, reversed), polygonOffsetUnits: depthBias(-6, reversed) }));
```
```js
… depthWrite: false, polygonOffset: true, polygonOffsetFactor: depthBias(-2, reversed), polygonOffsetUnits: depthBias(-4, reversed) }));
```

Run: `grep -n "polygonOffsetFactor" public/js/*.js` → every hit contains `depthBias(`.

- [ ] **Step 7: Tests and syntax**

Run: `node --check public/js/game3d.js && npm test`
Expected: no syntax error; all tests pass.

- [ ] **Step 8: Browser check**

Run: `node scripts/browser-check.mjs --track monza --level high --views chase,tcam,cockpit --fps 10 --out /tmp/lr-t2`
(use the session scratchpad dir instead of `/tmp` when one exists)
Expected: JSON with `backend: "webgpu"`, `errors: []`. If headless reports `webgl2`, rerun with `--headed` and note it. Open the three PNGs: halo and steering wheel unclipped in T-cam/cockpit, kerbs and lines visible on the asphalt in chase (not sunk under it), track far end free of flicker.

Forced fallback (Review Focus 2): in DevTools-less form, run once with Chrome flag `--disable-features=WebGPU` added to the spawn args temporarily (edit locally, don't commit) and confirm JSON `backend: "webgl2"`, clean screenshots; revert the flag.

- [ ] **Step 9: Commit**

```bash
git add scripts/browser-check.mjs public/index.html public/js/game3d.js .gitignore docs/superpowers/baseline/fps.txt
git commit -m "WebGPU renderer with WebGL2 fallback, reversed depth: onboard views in one pass, Ultra in the menu, browser check script"
```

---

### Task 3: Physical sky, sky reflections, tone mapping, materials

**Files:**
- Modify: `public/js/themes.js` (`SKIES` entries get `turbidity`, `rayleigh`, `mie`, `mieG`, `clouds`, `exposure`; `night()` gets `exposure`)
- Modify: `public/js/game3d.js` (sky, `applySky`, `envTexture`, car material setup in `makeCar`, asphalt roughness, tone mapping)
- Modify: `public/js/carModel.js:56,63-64` (livery, tyre, rim materials)
- Test: `test/scenery.test.js` (themes test lives there)

**Interfaces:**
- Consumes: `renderer`, `Q`, `scene` from Task 2.
- Produces: `function envTexture()` returns the PMREM texture of the current sky (rebuilt by `applySky`); `scene.environment` set on medium and up.

- [ ] **Step 1: Failing test** — append to `test/scenery.test.js`:

```js
test('every day sky has physical-sky settings and an exposure; nights have an exposure', async () => {
    const { SKIES, NIGHTS } = await import('../public/js/themes.js');
    for (const [name, s] of Object.entries(SKIES)) {
        assert.ok(s.turbidity >= 1 && s.turbidity <= 20, `${name} turbidity`);
        assert.ok(s.rayleigh > 0 && s.rayleigh <= 4, `${name} rayleigh`);
        assert.ok(s.mie > 0 && s.mie <= 0.1 && s.mieG > 0 && s.mieG < 1, `${name} mie`);
        assert.ok(s.clouds >= 0 && s.clouds <= 1, `${name} clouds`);
        assert.ok(s.exposure > 0 && s.exposure <= 2, `${name} exposure`);
    }
    assert.ok(SKIES.overcast.clouds > SKIES.clear.clouds && SKIES.hazy.turbidity > SKIES.clear.turbidity);
    for (const [id, n] of Object.entries(NIGHTS)) assert.ok(n.exposure > 0 && n.exposure <= 2, `${id} night exposure`);
});
```

- [ ] **Step 2: Run** `node --test test/scenery.test.js` → FAIL (`turbidity` undefined).

- [ ] **Step 3: themes.js data**

Replace the four `SKIES` lines with:

```js
    clear:    { top: '#5f9fe0', horizon: '#c9e2f5', sun: '#ffffff', power: 2.3, elevation: 55, azimuth: 35, hemi: 1.4, turbidity: 2, rayleigh: 1, mie: 0.005, mieG: 0.8, clouds: 0.25, exposure: 0.55 },
    hazy:     { top: '#7fb0de', horizon: '#dbe6ee', sun: '#fff6e8', power: 2.0, elevation: 45, azimuth: 60, hemi: 1.5, turbidity: 6, rayleigh: 1.5, mie: 0.01, mieG: 0.8, clouds: 0.4, exposure: 0.55 },
    overcast: { top: '#9fb2c4', horizon: '#d5dbe0', sun: '#f2f2f2', power: 1.4, elevation: 60, azimuth: 20, hemi: 1.8, turbidity: 10, rayleigh: 0.6, mie: 0.02, mieG: 0.7, clouds: 0.9, exposure: 0.7 },
    evening:  { top: '#3d5f9c', horizon: '#f2b27a', sun: '#ffc68a', power: 2.0, elevation: 14, azimuth: 250, hemi: 1.1, turbidity: 4, rayleigh: 2, mie: 0.008, mieG: 0.85, clouds: 0.35, exposure: 0.6 },
```

In `night = (…) => ({ … })` add `exposure: 0.9,` before `...o`.

- [ ] **Step 4: Run** `node --test test/scenery.test.js` → PASS.

- [ ] **Step 5: Sky in game3d.js**

Add import: `import { SkyMesh } from 'three/addons/objects/SkyMesh.js';`

After the `skyDome` IIFE add the day sky (the dome stays for night):

```js
// Day: a physical sky (Rayleigh/Mie scattering, clouds) lit by the circuit's sun; night keeps the dome and its stars
const daySky = new SkyMesh();
daySky.frustumCulled = false;
daySky.visible = false;
scene.add(daySky);
renderer.toneMapping = THREE.AgXToneMapping;
```

(The session's `night` flag already exists: `let windowsTex = null, crowdTex = null, night = false;`, set in `buildWorld`. Do not declare another.)

At the end of `applySky(sky)` append:

```js
    const isDay = sky.stars === undefined;
    skyDome.visible = !isDay;
    daySky.visible = isDay;
    if (isDay) {
        daySky.turbidity.value = sky.turbidity; daySky.rayleigh.value = sky.rayleigh;
        daySky.mieCoefficient.value = sky.mie; daySky.mieDirectionalG.value = sky.mieG;
        daySky.cloudCoverage.value = sky.clouds;
        daySky.sunPosition.value.set(SUN_OFF.x, SUN_OFF.y, SUN_OFF.z).normalize();
    }
    renderer.toneMappingExposure = sky.exposure ?? 1;
    // Sky light now comes from the environment map: the hemisphere light is only a small fill where there is one
    hemi.intensity = sky.hemi * (Q.envMap ? 0.35 : 1);
    scene.environmentIntensity = isDay ? 1 : 0.25;
    envTex?.dispose(); envTex = null;
    scene.environment = Q.envMap ? envTexture() : null;
```

Move the `SUN_OFF` assignment above this appended block if it is below (it is computed earlier in `applySky` — keep that order).

In `frame`, next to `skyDome.position.copy(camera.position); skyDome.scale.setScalar(camera.far * 0.9);` add:

```js
    daySky.position.copy(camera.position);
    daySky.scale.setScalar(camera.far * 0.9);
```

Replace `envTexture()` (and delete the `RoomEnvironment` import):

```js
// The session's sky as a reflection/ambient map (PMREM), built once per sky
let envTex = null;
function envTexture() {
    if (envTex) return envTex;
    const s = new THREE.Scene(), src = daySky.visible ? daySky.clone() : skyDome.clone();
    src.position.set(0, 0, 0); src.scale.setScalar(50); src.visible = true;
    s.add(src);
    envTex = new THREE.PMREMGenerator(renderer).fromScene(s, 0, 0.1, 100).texture;
    return envTex;
}
```

Delete `if (Q.envMap) (window.requestIdleCallback || setTimeout)(() => envTexture());` (the env is built in `applySky`).

In `makeCar`, replace the `if (Q.envMap) { … }` block with nothing (the scene environment lights every material); keep the `livery` map assignment.

- [ ] **Step 6: Materials**

`carModel.js:56`:

```js
    const mat = new THREE.MeshPhysicalMaterial({ name: 'livery', roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 });
```

`carModel.js:63-64`:

```js
    const tyreMat = new THREE.MeshPhysicalMaterial({ name: 'tyre', vertexColors: true, roughness: 0.85, sheen: 0.2, sheenRoughness: 0.8 });
    const coverMat = new THREE.MeshStandardMaterial({ name: 'rim', vertexColors: true, roughness: 0.3, metalness: 0.9 });
```

Asphalt roughness: in `asphaltTexture()` build a second canvas of the same size with grey noise (values 150–235, i.e. roughness 0.6–0.92) as `asphaltRough` (`THREE.CanvasTexture`, `RepeatWrapping`, `NoColorSpace`), and where the road mesh is created with `map: asphaltTexture()` pass `roughnessMap: asphaltRough` too (add `roughnessMap: opts.roughnessMap || null` to `coloredMesh`'s material and pass it from the road strip call; find it with `grep -n "asphaltTexture()" public/js/game3d.js`). Add `asphaltRough` to the `keep` set in the world teardown (`const keep = new Set([asphaltTex, blobTex, envTex]);` → include `asphaltRough`).

```js
let asphaltRough = null;
function asphaltRoughness(w, h) {
    if (asphaltRough) return asphaltRough;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 150 + Math.random() * 85; img.data.set([v, v, v, 255], i * 4); }
    g.putImageData(img, 0, 0);
    asphaltRough = new THREE.CanvasTexture(c);
    asphaltRough.wrapS = asphaltRough.wrapT = THREE.RepeatWrapping;
    return asphaltRough;
}
```

Call `asphaltRoughness(c.width, c.height)` inside `asphaltTexture()` right after `asphaltTex` is created, so both share size and repeat; set `asphaltRough.repeat.copy(asphaltTex.repeat)` wherever the asphalt repeat is set.

- [ ] **Step 7: Tests + browser**

Run: `node --check public/js/game3d.js && npm test` → all pass.
Run the check for `--time day` at monza (clear), spa, and `--time night` at monaco, level `high`, view `chase`.
Expected: `errors: []`; day: blue scattered sky with clouds, sun-coloured horizon, car paint shows a lacquer highlight and reflects the sky; night: dark dome with stars, nothing glowing. If the sky is blown out or the scene too dark, adjust that sky's `exposure` in `themes.js` (keep within the test's range) and rerun.

- [ ] **Step 8: Commit**

```bash
git add public/js/themes.js public/js/game3d.js public/js/carModel.js test/scenery.test.js
git commit -m "Physical day sky with clouds, sky reflections on every material, AgX exposure per sky, clearcoat paint, asphalt roughness"
```

---

### Task 4: Cascaded shadows

**Files:**
- Modify: `public/js/game3d.js` (`applyLevel`, `applySky` sun placement, `makeCar` blob shadow)

**Interfaces:**
- Consumes: `Q.shadows`, `Q.cascades` (Task 1), `SUN_OFF` (existing).
- Produces: `let csm` (the current `CSMShadowNode` or `null`).

- [ ] **Step 1: CSM wiring**

Add import: `import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';`

Replace the shadow lines in `applyLevel` (from `renderer.shadowMap.enabled` through `sun.shadow.map = null;`) with:

```js
    renderer.shadowMap.enabled = Q.shadows > 0;
    sun.castShadow = Q.shadows > 0;
    csm?.dispose(); csm = null;
    sun.shadow.shadowNode = null;
    if (Q.shadows) {
        sun.shadow.mapSize.set(Q.shadows, Q.shadows);
        // Cascades over the first 300 m of view: crisp on the car and kerbs, still there on far grandstands and trees
        csm = new CSMShadowNode(sun, { cascades: Q.cascades, maxFar: 300 * scaleOf(), mode: 'practical', lightMargin: 100 * scaleOf() });
        csm.fade = true;
        sun.shadow.shadowNode = csm;
    }
```

with `let csm = null;` declared next to `appliedLevel`, and `const scaleOf = () => clientState.trackData?.scale || 6; // world units per metre` next to it (check first: `grep -n "const scale\b\|let scale\b" public/js/game3d.js` — if a module-level `scale` already holds the current track scale when `applyLevel` runs, use it instead of `scaleOf()`).

Delete the old fixed shadow camera box: the line `Object.assign(sun.shadow.camera, { left: -360, … });` and its comment. Keep `sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0;`.

In `applySky`, the CSM reads the light's direction from `sun.position − sun.target.position`; after `Object.assign(SUN_OFF, …)` add:

```js
    sun.position.set(SUN_OFF.x, SUN_OFF.y, SUN_OFF.z);
    sun.target.position.set(0, 0, 0);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
```

- [ ] **Step 2: Blob shadow on Low only**

In `makeCar` replace `root.add(blobShadow(Q.shadows ? 0.75 : 1)); // contact shadow: …` with:

```js
    if (!Q.shadows) root.add(blobShadow(1)); // Low has no sun shadows: a contact shadow keeps the car on the road
```

- [ ] **Step 3: Tests + browser**

Run: `node --check public/js/game3d.js && npm test` → pass.
Run checks at monza and monaco, levels `medium`, `high`, `ultra`, `--views chase,cockpit`.
Expected: `errors: []`; car shadow sharp under the car; barrier/grandstand/tree shadows visible far down the straight; no visible seam where cascades meet (fade on); no shadow acne on the halo or bodywork. If acne shows, raise `sun.shadow.normalBias` to `0.02` and rerun.
Run at `low`: no sun shadows, blob under each car.

- [ ] **Step 4: Commit**

```bash
git add public/js/game3d.js
git commit -m "Cascaded sun shadows per level (2/3/4 cascades over 300 m), blob contact shadow only on Low"
```

---

### Task 5: Post-processing pipeline and internal scale

**Files:**
- Create: `public/js/postfx.js`
- Modify: `public/js/game3d.js` (build pipeline in `applyLevel`, draw through it in `frame`, `adaptStep` → scale)

**Interfaces:**
- Consumes: `LEVELS[level].effects` (Task 1), `renderer`, `scene`, `camera`, `sun`.
- Produces: `buildPost(renderer, scene, camera, sun, effects) → { render(), setScale(s), dispose(), effects }` from `postfx.js`.

- [ ] **Step 1: postfx.js**

```js
// The post-processing chain for a level: its `effects` list (quality.js) turned into one three.js RenderPipeline.
// Browser only (WebGPURenderer). An effect that fails to build is dropped with a warning; the race goes on.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, velocity, metalness, roughness, directionToColor, colorToDirection, vec2, vec4, uv, float, length, smoothstep, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';

export function buildPost(renderer, scene, camera, sun, effects) {
    const fx = new Set(effects), used = [];
    const pipe = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const needNormal = fx.has('ao') || fx.has('ssr'), needVel = fx.has('motionBlur') || fx.has('taau') || fx.has('traa');
    const outs = { output };
    if (needNormal) outs.normal = directionToColor(normalView);
    if (needVel) outs.velocity = velocity;
    if (fx.has('ssr')) outs.metalrough = vec2(metalness, roughness);
    scenePass.setMRT(mrt(outs));
    const depth = scenePass.getTextureNode('depth');
    const normal = needNormal ? colorToDirection(scenePass.getTextureNode('normal')) : null;
    const vel = needVel ? scenePass.getTextureNode('velocity') : null;
    let color = scenePass.getTextureNode('output');
    const tryFx = (name, f) => { if (!fx.has(name)) return; try { color = f(color); used.push(name); } catch (e) { console.warn(`postfx: ${name} dropped`, e); } };

    tryFx('ao', (c) => vec4(c.rgb.mul(ao(depth, normal, camera).getTextureNode().r), c.a));
    tryFx('ssr', (c) => {
        const mr = scenePass.getTextureNode('metalrough');
        const r = ssr(c, depth, normal, { metalnessNode: mr.r, roughnessNode: mr.g, camera });
        return vec4(c.rgb.add(r.rgb.mul(r.a)), c.a);
    });
    let glow = null;
    tryFx('bloom', (c) => { glow = bloom(c, 0.25, 0.4, 1.0); return c.add(glow); });
    tryFx('lensflare', (c) => (glow ? c.add(lensflare(glow, { threshold: 1.2, ghostAttenuationFactor: 25 })) : c));
    tryFx('godrays', (c) => c.add(godrays(depth, camera, sun).getTextureNode().mul(0.3)));
    tryFx('motionBlur', (c) => motionBlur(c, vel.mul(0.5)));
    tryFx('vignette', (c) => vec4(c.rgb.mul(float(1).sub(smoothstep(0.45, 1.0, length(uv().sub(0.5)).mul(1.4)).mul(0.35))), c.a));
    tryFx('grain', (c) => film(c, float(0.08)));

    // Temporal AA (linear colour, tone mapping after); else the spatial AA works on the tone-mapped image
    if (fx.has('traa') || fx.has('taau')) {
        tryFx('traa', (c) => traa(c, depth, vel, camera));
        tryFx('taau', (c) => taau(c, depth, vel, camera));
        pipe.outputColorTransform = true;
    } else {
        pipe.outputColorTransform = false;
        color = renderOutput(color);
        tryFx('fxaa', (c) => fxaa(c));
        tryFx('smaa', (c) => smaa(c));
        tryFx('fsr1', (c) => fsr1(c));
    }
    pipe.outputNode = color;
    return {
        effects: used,
        render: () => pipe.render(),
        setScale: (s) => scenePass.setResolutionScale(s),
        dispose: () => pipe.dispose(),
    };
}
```

Before relying on the composites above, read the doc blocks at the top of `GTAONode.js`, `SSRNode.js`, `GodraysNode.js`, `FilmNode.js` in `node_modules/three/examples/jsm/tsl/display/` and match each composite to the documented usage if it differs (the doc example wins).

- [ ] **Step 2: Wire into game3d.js**

Import: `import { buildPost } from './postfx.js';`. Declare `let post = null;` next to `csm`.

The chain depends on both the level and day/night (sun glare is day-only), and `buildWorld` always calls `applySky` right after `applyLevel`, so build it at the end of `applySky(sky)`:

```js
    post?.dispose();
    post = buildPost(renderer, scene, camera, sun, isDay ? Q.effects : Q.effects.filter((e) => e !== 'godrays' && e !== 'lensflare'));
    post.setScale(res.ratio);
```

(`frame` only draws once a world exists, so `post` is always built before the first `post.render()`.)

In `frame`, replace `renderer.render(scene, camera);` with:

```js
        try { post.render(); }
        catch (e) { // an effect that compiles on no GPU here: fall back to the Low chain once, keep racing
            console.warn('postfx: chain failed, Low chain instead', e);
            post.dispose(); post = buildPost(renderer, scene, camera, sun, LEVELS.low.effects); post.setScale(res.ratio);
        }
```

In the fps block, where Task 2 removed `renderer.setPixelRatio(next.ratio)`, add:

```js
        if (next.ratio !== res.ratio) post.setScale(next.ratio);
```

`compileAsync(scene, camera)` stays; the post materials compile on first `post.render()` while the grid countdown runs.

- [ ] **Step 3: Tests + browser**

Run: `node --check public/js/postfx.js public/js/game3d.js && npm test` → pass.
Run checks at monza day, every level, `--views chase,tcam,cockpit --fps 10`.
Expected per level, `errors: []` and:
- low: FXAA only, sharp after upscale, fps ≥ baseline low (`docs/superpowers/baseline/fps.txt`).
- medium: soft AO under the wing and where tyres meet the road, bloom only on sun glints.
- high: smooth edges on fences and the halo, motion blur on scenery and wheels while the own car stays sharp.
- ultra: + road/pit-wall reflections, sun rays and flare when facing the sun, light grain.
Record each level's fps in `docs/superpowers/baseline/fps.txt` under an `after` heading.

Forced failure (Review Focus 4): temporarily change `tryFx('ao', …)` to `tryFx('ao', () => { throw new Error('test'); })`, run `--level medium`: one `postfx: ao dropped` warning, race renders. Then make `post.render` throw once (temporary `throw` in `render`): confirm the Low-chain fallback warning and a rendered frame. Revert both.

- [ ] **Step 4: Commit**

```bash
git add public/js/postfx.js public/js/game3d.js docs/superpowers/baseline/fps.txt
git commit -m "Post chain per level: AO, SSR, bloom, flare, god rays, motion blur, temporal AA/upscale, FXAA/SMAA+FSR1; adaptive internal scale"
```

---

### Task 6: GPU reset recovery

**Files:**
- Modify: `public/js/game3d.js`

**Interfaces:**
- Consumes: `createRenderer`, `applyLevel`, `stepDown`, `envTexture`, `applySky` (Tasks 2–5).
- Produces: `function recoverRenderer()`.

- [ ] **Step 1: Implement**

After the first `renderer = await createRenderer(); …` block add the handler, and attach it to every renderer created:

```js
// GPU reset (driver crash, laptop switching graphics): a new renderer on a fresh canvas, one level lower, world kept
let recovering = false;
async function recoverRenderer(info) {
    if (recovering) return;
    recovering = true;
    console.warn('renderer lost', info?.message || info);
    renderer.setAnimationLoop(null);
    try { post?.dispose(); renderer.dispose(); } catch { /* already gone */ }
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh); canvas = fresh;
    renderer = await createRenderer({ logDepth: !reversed });
    renderer.onDeviceLost = recoverRenderer;
    renderer.debug.checkShaderErrors = false;
    renderer.toneMapping = THREE.AgXToneMapping;
    if (window.lanraceDebug) window.lanraceDebug.renderer = renderer;
    const lower = stepDown(level);
    appliedLevel = null;
    applyLevel(lower);
    applySky(currentSky);
    resize();
    window.showBanner?.(`GRAPHICS RESET — LOWERED TO ${lower.toUpperCase()}`);
    renderer.setAnimationLoop(frame);
    recovering = false;
}
renderer.onDeviceLost = recoverRenderer;
```

Required supporting changes:
- `const canvas = document.getElementById('game-canvas');` → `let canvas = …`.
- In `applySky(sky)` first line add `currentSky = sky;` and declare `let currentSky = null;` above it.
- `resize()` already uses `renderer` by name; fine.
- `grep -n "canvas\." public/js/game3d.js` — any listener added on `canvas` must be re-added to `fresh` (move such listeners into a function `bindCanvas(c)` called at start and in `recoverRenderer`). If none, nothing to do.

- [ ] **Step 2: Tests + forced loss**

Run: `node --check public/js/game3d.js && npm test` → pass.
Forced loss (Review Focus 5): start a check with `--headed --level high`, and before screenshots evaluate in the page `window.lanraceDebug.renderer.backend.device.destroy()` (add a temporary `--lose` flag to `browser-check.mjs` that does this and waits 3 s; keep the flag, it is useful). Expected: banner `GRAPHICS RESET — LOWERED TO MEDIUM`, the screenshot shows the track, `lanraceQuality.level === 'medium'`, no exception besides the `renderer lost` warning.

- [ ] **Step 3: Commit**

```bash
git add public/js/game3d.js scripts/browser-check.mjs
git commit -m "Recover from a GPU reset: fresh renderer one level lower, banner, race continues"
```

---

### Task 7: Full browser matrix and tuning

**Files:**
- Modify (tuning only): `public/js/themes.js`, `public/js/postfx.js`, `public/js/game3d.js`

- [ ] **Step 1: Matrix**

```bash
OUT=<scratchpad>/render-matrix
for T in monza monaco spa; do for TIME in day night; do for L in low medium high ultra; do
  node scripts/browser-check.mjs --track $T --time $TIME --level $L --views chase,tcam,cockpit --fps 8 --out $OUT
done; done; done | tee $OUT/results.jsonl
```

Expected: 24 lines, every `errors: []`, `backend: "webgpu"` (or note headless limits and rerun failing ones `--headed`).

- [ ] **Step 2: Look at every screenshot** for: kerbs/lines over the asphalt at distance (Review Focus 1); halo and wheel unclipped onboard; shadows present on medium+ and blob only on low; night not glowing (env 0.25, bloom only on floodlights); no black frames. Fix by tuning values only (exposure, bloom strength/threshold, AO composite strength, `normalBias`), rerun the affected cells.

- [ ] **Step 3: Performance gate**

From `results.jsonl` and `docs/superpowers/baseline/fps.txt`: low at monza must be ≥ baseline low fps − 2. If not, drop `fsr1` from low when `res.ratio === 1` is not enough — first try `LEVELS.low.scale = [0.7, 0.5, 1]` and rerun; update `test/quality.test.js` expectations if the table changes.

- [ ] **Step 4: Full suite and commit**

Run: `npm test` → all pass.

```bash
git add -A public/js docs/superpowers/baseline/fps.txt test
git commit -m "Render pipeline tuned across Monza, Monaco, Spa day and night on every level"
```
