// Drives a local LanRace race in Chrome over the DevTools protocol: screenshots per view, fps, console errors.
// Uses its own server on PORT 3299 (never the user's 3232) and kills only what it started.
// node scripts/browser-check.mjs --track monza --level high --time day --views chase,tcam,cockpit --out <dir> [--headed] [--fps 10] [--lose] [--webgl] [--logdepth] [--at countdown] [--eval <js run before screenshots>] [--spots <json: [{ name, pos: [x, y, z], look: [x, y, z] }]>] [--bots <n>] [--cpuprofile <file>] [--vsync] [--team <name>]
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] ?? true; };
const PORT = 3299, DBG = 9299, track = arg('track', 'monza'), level = arg('level', 'high'), time = arg('time', 'day');
const views = String(arg('views', 'chase')).split(','), out = arg('out', 'shots'), fpsSecs = Number(arg('fps', 0));
const webgl = process.argv.includes('--webgl'), logdepth = process.argv.includes('--logdepth'), headed = process.argv.includes('--headed'), lose = process.argv.includes('--lose');
const extra = process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : [];
mkdirSync(out, { recursive: true });

if (execSync(`lsof -iTCP:${PORT} -sTCP:LISTEN -t || true`).toString().trim()) { console.error(`port ${PORT} busy`); process.exit(2); }
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    ...(headed ? [] : ['--headless=new']), `--remote-debugging-port=${DBG}`, '--mute-audio', '--enable-unsafe-webgpu',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${out}/.chrome`, '--window-size=1600,900', ...(process.argv.includes('--vsync') ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']), ...extra, 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', stop);
// A frozen page never answers DevTools calls: give up after 3 minutes, report what was seen, clean up
setTimeout(() => { console.log(JSON.stringify({ track, time, level, error: 'timeout: page stopped answering', errors, warnings: warnings.slice(0, 5) })); process.exit(1); }, 180000).unref();

let ws, id = 0; const pending = new Map(), errors = [], warnings = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const until = async (expr, ms = 60000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(250)) if (await evalJs(expr)) return true; throw new Error(`timeout: ${expr}`); };
const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };

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
        const text = () => d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300);
        if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(text());
        if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') warnings.push(text());
        if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: `http://localhost:${PORT}/?stats=1${webgl ? '&webgl' : ''}${logdepth ? '&logdepth' : ''}` });
    await until(`document.readyState === 'complete'`);
    await until(`location.port === '${PORT}' && document.readyState === 'complete' && !!document.getElementById('graphics-select')`);
    await evalJs(`(() => { const e = document.getElementById('graphics-select'); e.value = ${JSON.stringify(level)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
    await send('Page.reload'); await until(`document.readyState === 'complete' && !!document.getElementById('btn-join')`);
    if (arg('team')) { // a team by (part of) its name, e.g. --team mercedes
        await until(`document.querySelectorAll('.team-card').length > 0`);
        await evalJs(`[...document.querySelectorAll('.team-card')].find((c) => c.title.toLowerCase().includes(${JSON.stringify(String(arg('team')).toLowerCase())}))?.click(); true`);
    }
    await evalJs(`document.getElementById('username').value = 'Check'; document.getElementById('btn-join').click(); true`);
    await until(`!document.getElementById('host-settings').classList.contains('hidden')`);
    await evalJs(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); };
        set('setting-track', ${JSON.stringify(track)}); set('setting-time', ${JSON.stringify(time)}); set('setting-quali', 'off'); set('setting-laps', '1'); if (${JSON.stringify(arg('bots', null))}) { set('setting-ai', '1'); set('setting-ai-count', ${JSON.stringify(arg('bots', '0'))}); }
        return true; })()`);
    await wait(500);
    await evalJs(`document.getElementById('btn-start').click(); true`);
    if (arg('at', 'race') === 'countdown') { await until(`typeof clientState !== 'undefined' && clientState.status === 'COUNTDOWN'`, 120000); await wait(1500); }
    else { await until(`typeof clientState !== 'undefined' && clientState.status === 'RACE' && window.lanraceFps > 0`, 120000); await wait(3000); } // shaders warm, first frames settled
    // drive forward so the scene moves (motion blur, shadows following)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
    if (lose) { // three ignores device loss with reason 'destroyed': a real reset is simulated through onDeviceLost
        await evalJs(`(() => { const r = window.lanraceDebug.renderer; if (r.backend.device) { r.backend.device.destroy(); r.onDeviceLost({ api: 'WebGPU', message: 'simulated GPU reset', reason: 'unknown' }); } else r.backend.gl.getExtension('WEBGL_lose_context').loseContext(); return true; })()`);
        await wait(5000);
    }
    const pre = arg('eval', null);
    const evalOut = pre ? await evalJs(pre) : undefined;
    const profFile = arg('cpuprofile', null); // a CPU profile of the next 10 s (Chrome DevTools format)
    if (profFile) {
        await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start');
        await wait(10000);
        writeFileSync(profFile, JSON.stringify((await send('Profiler.stop')).result.profile));
    }
    const backend = await evalJs(`window.lanraceQuality?.backend || 'webgl'`);
    let fps = null;
    if (fpsSecs) { const s = []; for (let i = 0; i < fpsSecs; i++) { await wait(1000); s.push(await evalJs('window.lanraceFps')); } fps = Math.round(s.reduce((a, b) => a + b) / s.length); }
    for (const v of views) {
        for (let i = 0; i < 3 && (await evalJs(`window.lanraceView || 'chase'`)) !== v; i++) { await key('v', 'KeyV', 86); await wait(600); }
        await wait(400);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${out}/${track}-${time}-${level}-${v}.png`, Buffer.from(shot.result.data, 'base64'));
    }
    // free camera at each spot (world units, three.js axes), one screenshot each
    const spotsFile = arg('spots', null);
    for (const sp of spotsFile ? JSON.parse(readFileSync(spotsFile, 'utf8')) : []) {
        await evalJs(`(() => { const d = window.lanraceDebug; d.freeCam = true; d.camera.position.set(${sp.pos}); d.camera.lookAt(${sp.look}); d.camera.updateMatrixWorld(); return true; })()`);
        await wait(700);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${out}/${track}-${sp.name}.png`, Buffer.from(shot.result.data, 'base64'));
    }
    const stats = await evalJs(`document.getElementById('stats')?.textContent || ''`);
    console.log(JSON.stringify({ track, time, level: await evalJs('window.lanraceQuality?.level'), backend, fps, stats, evalOut, errors, warnings: warnings.slice(0, 5) }));
    process.exitCode = errors.length ? 1 : 0;
} catch (e) {
    console.log(JSON.stringify({ track, time, level, error: String(e), errors, serverLog: serverLog.slice(-800) }));
    process.exitCode = 1;
} finally { ws?.close(); stop(); }
