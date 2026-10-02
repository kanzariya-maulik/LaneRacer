// LanRace sound: the AudioContext, your car's V8, the 4 nearest other cars in 3D (HRTF + Doppler), one-shots, wind,
// and the recording slot (public/sounds/manifest.json). Everything is driven by game3d.js through update()/event().
import { pickVoices } from './voices.js';
import { doppler, pickLoops } from './mix.js';
import * as S from './sfx.js';

const MAX_OTHERS = 4, MAX_DIST_M = 300, REF_M = 15, PICK_EVERY_S = 0.25;
const OWN_GAIN = 0.55, OTHER_GAIN = 0.6;
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not remembered */ } },
};

let ctx = null, master = null, noise = null, wind = null, hasWorklet = false, starting = null, ready = false;
let slots = {}, muted = false, ownVoice = null, lastPick = -1;
let volume = Math.min(1, Math.max(0, +(store.get('lanrace.volume') ?? 70) / 100));
let mode = ['all', 'mine', 'off'].includes(store.get('lanrace.engine')) ? store.get('lanrace.engine') : 'all';
const others = new Map();   // car id → voice
const pool = [];            // free voices for other cars
let picked = [];
let cutUntil = 0, blipUntil = 0, crackleUntil = 0;

export function init() {
    const go = () => { unlock(); };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden || muted) ctx.suspend(); else ctx.resume();
    });
    window.lanraceAudio = { init, unlock, update, event, setVolume, setMode, toggleMute, debug };
}

// Browsers only start audio from a user gesture: the first click/key (Join counts) creates the context
export function unlock() {
    if (ctx) { if (ctx.state === 'suspended' && !muted && !document.hidden) ctx.resume(); return starting; }
    try {
        ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch (e) {
        console.warn('[LanRace] no audio', e);
        return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    noise = S.makeNoise(ctx);
    wind = S.makeWind(ctx, master, noise);
    starting = (async () => {
        try { await ctx.audioWorklet.addModule('js/audio/v8-worklet.js'); hasWorklet = true; }
        catch (e) { console.warn('[LanRace] AudioWorklet unavailable, simple engine sound', e); }
        slots = await loadSlots();
        ready = true; // voices are only built once we know worklet vs fallback vs recordings
    })();
    return starting;
}

// Recording slot: { "engine_onboard": [{ "rpm": 9000, "file": "v8_9k.ogg" }], "drs": "drs.ogg", ... }
async function loadSlots() {
    let manifest = {};
    try {
        const r = await fetch('sounds/manifest.json');
        if (r.ok) manifest = await r.json();
    } catch (e) { /* no manifest: synth only */ }
    const decode = async (file) => {
        try { return await ctx.decodeAudioData(await (await fetch(`sounds/${file}`)).arrayBuffer()); }
        catch (e) { console.warn(`[LanRace] sound ${file} failed, using the synth`, e); return null; }
    };
    const out = {};
    for (const [name, v] of Object.entries(manifest)) {
        if (Array.isArray(v)) {
            const loops = [];
            for (const l of v) { const buffer = await decode(l.file); if (buffer && l.rpm > 0) loops.push({ rpm: l.rpm, buffer }); }
            loops.sort((a, b) => a.rpm - b.rpm);
            if (loops.length) out[name] = loops;
        } else if (typeof v === 'string') {
            const buffer = await decode(v);
            if (buffer) out[name] = buffer;
        }
    }
    return out;
}

// One engine voice: recorded loops (slot) > V8 worklet > oscillator fallback; optional 3D panner
function makeVoice(spatial) {
    const out = ctx.createGain();
    out.gain.value = 0;
    let panner = null;
    if (spatial) {
        panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: REF_M, maxDistance: MAX_DIST_M, rolloffFactor: 1 });
        out.connect(panner).connect(master);
    } else out.connect(master);
    const loops = slots[spatial ? 'engine_external' : 'engine_onboard'];
    if (loops) {
        const parts = loops.map((l) => {
            const src = ctx.createBufferSource(), g = ctx.createGain();
            src.buffer = l.buffer; src.loop = true; g.gain.value = 0;
            src.connect(g).connect(out); src.start();
            return { src, g, rpm: l.rpm };
        });
        return {
            out, panner,
            set(rpm, load, cut) {
                const m = pickLoops(loops, rpm), t = ctx.currentTime, on = cut > 0.5 ? 0.05 : 0.35 + 0.65 * load;
                parts.forEach((p, i) => {
                    const w = i === m.a ? m.wa : i === m.b ? m.wb : 0;
                    p.g.gain.setTargetAtTime(w * on, t, 0.01);
                    p.src.playbackRate.setTargetAtTime(rpm / p.rpm, t, 0.01);
                });
            },
            stop() { parts.forEach((p) => p.src.stop()); out.disconnect(); },
        };
    }
    if (hasWorklet) {
        const node = new AudioWorkletNode(ctx, 'v8', { numberOfInputs: 0, outputChannelCount: [1] });
        node.connect(out);
        const P = { rpm: node.parameters.get('rpm'), load: node.parameters.get('load'), cut: node.parameters.get('cut'), stutter: node.parameters.get('stutter'), crackle: node.parameters.get('crackle') };
        return {
            out, panner,
            set(rpm, load, cut, stutter, crackle) {
                P.rpm.value = rpm; P.load.value = load; P.cut.value = cut; P.stutter.value = stutter; P.crackle.value = crackle;
            },
            stop() { node.port.postMessage('stop'); node.disconnect(); out.disconnect(); },
        };
    }
    // Fallback: saw at the firing frequency + square an octave down, through a low-pass
    const saw = ctx.createOscillator(), sq = ctx.createOscillator(), lp = ctx.createBiquadFilter(), mix = ctx.createGain();
    saw.type = 'sawtooth'; sq.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 3000; mix.gain.value = 0.25;
    saw.connect(lp); sq.connect(lp); lp.connect(mix).connect(out);
    saw.start(); sq.start();
    return {
        out, panner,
        set(rpm, load, cut) {
            const f = (rpm / 60) * 4, t = ctx.currentTime;
            saw.frequency.setTargetAtTime(f, t, 0.01); sq.frequency.setTargetAtTime(f / 2, t, 0.01);
            mix.gain.setTargetAtTime(cut > 0.5 ? 0.01 : 0.1 + 0.2 * load, t, 0.01);
        },
        stop() { saw.stop(); sq.stop(); out.disconnect(); },
    };
}

function fade(voice, gain) { voice.out.gain.setTargetAtTime(gain, ctx.currentTime, 0.05); }

export function update(frame) {
    if (!ready || ctx.state !== 'running') return; // not unlocked/loaded yet, muted or hidden: nothing to do
    const now = ctx.currentTime, L = frame.listener, lis = ctx.listener;
    if (lis.positionX) {
        lis.positionX.value = L.x; lis.positionY.value = 1.2; lis.positionZ.value = L.y;
        lis.forwardX.value = L.fx; lis.forwardY.value = 0; lis.forwardZ.value = L.fy;
        lis.upX.value = 0; lis.upY.value = 1; lis.upZ.value = 0;
    } else {
        lis.setPosition(L.x, 1.2, L.y);
        lis.setOrientation(L.fx, 0, L.fy, 0, 1, 0);
    }

    // Your car
    const o = frame.own;
    if (o && mode !== 'off') {
        if (!ownVoice) ownVoice = makeVoice(false);
        let rpm = o.rpm, load = o.load, crackle = 0;
        if (now < blipUntil) { rpm = Math.min(18000, rpm + 1500); load = 1; }
        if (load < 0.1 && rpm > 8000) crackle = Math.min(1, (rpm - 8000) / 8000);
        if (now < crackleUntil) crackle = 1;
        const stutter = o.pit ? 12 : o.limiter ? 30 : 0;
        ownVoice.set(rpm, load, now < cutUntil ? 1 : 0, stutter, crackle);
        fade(ownVoice, OWN_GAIN);
    } else if (ownVoice) fade(ownVoice, 0);
    wind.set(o ? o.speedMs : 0);

    // Other cars: nearest 4 within 300 m, re-picked at 4 Hz
    if (mode === 'all') {
        if (now - lastPick >= PICK_EVERY_S) {
            lastPick = now;
            picked = pickVoices(frame.others, L.x, L.y, picked, MAX_OTHERS, MAX_DIST_M);
            for (const [id, v] of others) if (!picked.includes(id)) { fade(v, 0); pool.push(v); others.delete(id); }
        }
        for (const c of frame.others) {
            if (!picked.includes(c.id)) continue;
            let v = others.get(c.id);
            if (!v) { v = pool.pop() || makeVoice(true); others.set(c.id, v); }
            const dx = c.x - L.x, dy = c.y - L.y, d = Math.hypot(dx, dy) || 1;
            const vr = ((c.vx - L.vx) * dx + (c.vy - L.vy) * dy) / d; // > 0: moving away
            if (v.panner.positionX) { v.panner.positionX.value = c.x; v.panner.positionY.value = 0.5; v.panner.positionZ.value = c.y; }
            else v.panner.setPosition(c.x, 0.5, c.y);
            const crackle = c.load < 0.1 && c.rpm > 8000 ? Math.min(1, (c.rpm - 8000) / 8000) : 0;
            v.set(c.rpm * doppler(vr), c.load, 0, c.pit ? 12 : c.limiter ? 30 : 0, crackle);
            fade(v, OTHER_GAIN);
        }
    } else if (others.size) {
        for (const [id, v] of others) { fade(v, 0); pool.push(v); others.delete(id); }
        picked = [];
    }
}

export function event(name) {
    if (!ctx || ctx.state !== 'running') return; // no queued burst when the tab comes back
    const now = ctx.currentTime;
    if (name === 'shift_up') { cutUntil = now + 0.025; }
    if (name === 'shift_down') { blipUntil = now + 0.06; crackleUntil = now + 0.15; }
    if (slots[name] && !Array.isArray(slots[name])) return S.playBuffer(ctx, master, slots[name]);
    if (name === 'beep') S.beep(ctx, master, 1000, 0.12);
    else if (name === 'lights_out') S.beep(ctx, master, 1600, 0.3);
    else if (name === 'drs') S.clunk(ctx, master, noise);
    else if (name === 'shift_up' && mode !== 'off') S.bark(ctx, master, noise);
}

export function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    store.set('lanrace.volume', Math.round(volume * 100));
    if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

export function setMode(m) {
    if (!['all', 'mine', 'off'].includes(m)) return;
    mode = m;
    store.set('lanrace.engine', m);
}

export function toggleMute() {
    muted = !muted;
    if (ctx) {
        master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
        if (muted) ctx.suspend(); else if (!document.hidden) ctx.resume();
    }
    return muted;
}

export function debug() {
    return { state: ctx ? ctx.state : 'none', worklet: hasWorklet, voices: (ownVoice ? 1 : 0) + others.size, slots: Object.keys(slots), mode, volume, muted };
}
