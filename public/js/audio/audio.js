// LanRace sound: the AudioContext, your car's engine synth, the 4 nearest other cars in 3D (HRTF + Doppler), one-shots, wind,
// music player, and recording slots (public/sounds/manifest.json). Everything is driven by game3d.js through update()/event().
import { pickVoices } from './voices.js';
import { doppler, pickLoops, engineFx } from './mix.js';
import { V8Synth } from './v8.js';
import * as S from './sfx.js';
import { music, TRACKS } from './music.js';

export { music, TRACKS };

const MAX_OTHERS = 4, MAX_DIST_M = 300, REF_M = 15, PICK_EVERY_S = 0.25;
const OWN_GAIN = 0.55, OTHER_GAIN = 0.6;
const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not remembered */ } },
};

let ctx = null, master = null, noise = null, wind = null, hasWorklet = false, starting = null, ready = false;
let slots = {}, muted = false, ownVoice = null, lastPick = -1, broken = false, engineKind = 'none';
let volume = Math.min(1, Math.max(0, +(store.get('lanrace.volume') ?? 70) / 100));
let mode = ['all', 'mine', 'off'].includes(store.get('lanrace.engine')) ? store.get('lanrace.engine') : 'all';
let engineType = ['v6', 'muscle', 'screamer', 'rotary', 'boxer', 'v10', 'v8', 'v12'].includes(store.get('lanrace.engineType')) ? store.get('lanrace.engineType') : 'v6';
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
    window.lanraceAudio = { init, unlock, update, event, setVolume, setMode, setEngineType, setMusicTrack, setMusicVolume, toggleMute, debug, music };
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
    const limiter = ctx.createDynamicsCompressor(); // a full grid at the start can sum past 1.0
    limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    master.connect(limiter).connect(ctx.destination);
    noise = S.makeNoise(ctx);
    wind = S.makeWind(ctx, master, noise);
    music.init(ctx, master);

    starting = (async () => {
        // AudioWorklet needs a secure context (https or localhost): LAN players on http://<ip> get the same synth
        // through a ScriptProcessor instead
        try { await ctx.audioWorklet.addModule('js/audio/v8-worklet.js'); hasWorklet = true; engineKind = 'worklet'; }
        catch (e) { engineKind = ctx.createScriptProcessor ? 'script' : 'osc'; console.info(`[LanRace] engine sound via ${engineKind}`); }
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

// One engine voice: recorded loops (slot) > engine worklet > oscillator fallback; optional 3D panner
function makeVoice(spatial, profile = engineType) {
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
            setProfile() {},
            stop() { parts.forEach((p) => p.src.stop()); out.disconnect(); },
        };
    }
    if (hasWorklet) {
        const node = new AudioWorkletNode(ctx, 'v8', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { profile } });
        node.connect(out);
        const P = { rpm: node.parameters.get('rpm'), load: node.parameters.get('load'), cut: node.parameters.get('cut'), stutter: node.parameters.get('stutter'), crackle: node.parameters.get('crackle') };
        return {
            out, panner,
            set(rpm, load, cut, stutter, crackle) {
                P.rpm.value = rpm; P.load.value = load; P.cut.value = cut; P.stutter.value = stutter; P.crackle.value = crackle;
            },
            setProfile(p) { node.port.postMessage({ profile: p }); },
            stop() { node.port.postMessage('stop'); node.disconnect(); out.disconnect(); },
        };
    }
    if (ctx.createScriptProcessor) { // same synth on the main thread (insecure origins have no AudioWorklet)
        const node = ctx.createScriptProcessor(1024, 0, 1), synth = new V8Synth(ctx.sampleRate, (Math.random() * 4294967295) >>> 0, profile);
        const target = { rpm: 4500, load: 0, cut: 0, stutter: 0, crackle: 0 }, p = { rpm: 4500, load: 0, cut: 0, stutter: 0, crackle: 0 };
        let snap = true;
        node.onaudioprocess = (e) => {
            const outBuf = e.outputBuffer.getChannelData(0);
            for (let i = 0; i < outBuf.length; i += 128) { // 128-sample sub-blocks, eased like the worklet
                p.rpm = snap ? target.rpm : p.rpm + (target.rpm - p.rpm) * 0.35; snap = false;
                p.load += (target.load - p.load) * 0.25;
                p.cut = target.cut; p.stutter = target.stutter; p.crackle = target.crackle;
                synth.render(outBuf.subarray(i, i + 128), Math.min(128, outBuf.length - i), p);
            }
        };
        node.connect(out);
        return {
            out, panner,
            set(rpm, load, cut, stutter, crackle) { target.rpm = rpm; target.load = load; target.cut = cut; target.stutter = stutter; target.crackle = crackle; },
            setProfile(p) { synth.setProfile(p); },
            stop() { node.onaudioprocess = null; node.disconnect(); out.disconnect(); },
        };
    }
    // Last resort: saw at the firing frequency + square an octave down, through a low-pass
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
        setProfile() {},
        stop() { saw.stop(); sq.stop(); out.disconnect(); },
    };
}

function fade(voice, gain) {
    if (voice.target === gain) return; // only schedule on change
    voice.target = gain;
    voice.out.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
}

// Never let a sound problem take the renderer down: the first error switches audio off for this page
export function update(frame) {
    if (!ready || broken || ctx.state !== 'running') return; // not unlocked/loaded yet, muted or hidden: nothing to do
    try { mixFrame(frame); } catch (e) {
        broken = true;
        console.error('[LanRace] sound disabled after an error', e);
        try { master.gain.value = 0; } catch (e2) { /* nothing more to do */ }
    }
}

function mixFrame(frame) {
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
        if (!ownVoice) ownVoice = makeVoice(false, engineType);
        let rpm = o.rpm, load = o.load;
        if (now < blipUntil) { rpm = Math.min(18000, rpm + 1500); load = 1; }
        const fx = engineFx(rpm, load, o.pit, o.limiter);
        ownVoice.set(rpm, load, now < cutUntil ? 1 : 0, fx.stutter, now < crackleUntil ? 1 : fx.crackle);
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
            if (!v) { v = pool.pop() || makeVoice(true, 'v8'); others.set(c.id, v); }
            const dx = c.x - L.x, dy = c.y - L.y, d = Math.hypot(dx, dy) || 1;
            const vr = ((c.vx - L.vx) * dx + (c.vy - L.vy) * dy) / d; // > 0: moving away
            if (v.panner.positionX) { v.panner.positionX.value = c.x; v.panner.positionY.value = 0.5; v.panner.positionZ.value = c.y; }
            else v.panner.setPosition(c.x, 0.5, c.y);
            const fx = engineFx(c.rpm, c.load, c.pit, c.limiter);
            v.set(c.rpm * doppler(vr), c.load, 0, fx.stutter, fx.crackle);
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
    if ((name === 'shift_up' || name === 'shift_down') && mode === 'off') return;
    if (slots[name] && !Array.isArray(slots[name])) return S.playBuffer(ctx, master, slots[name]);
    if (name === 'beep') S.beep(ctx, master, 1000, 0.12);
    else if (name === 'lights_out') S.beep(ctx, master, 1600, 0.3);
    else if (name === 'drs') S.clunk(ctx, master, noise);
    else if (name === 'shift_up') S.bark(ctx, master, noise);
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

export function setEngineType(type) {
    if (!['v6', 'muscle', 'screamer', 'rotary', 'boxer', 'v10', 'v8', 'v12'].includes(type)) return;
    engineType = type;
    store.set('lanrace.engineType', type);
    if (ownVoice) ownVoice.setProfile?.(type);
}

export function setMusicTrack(trackId) {
    music.setTrack(trackId);
}

export function setMusicVolume(vol) {
    music.setVolume(vol);
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
    const audible = (ownVoice && ownVoice.target > 0 ? 1 : 0) + [...others.values()].filter((v) => v.target > 0).length;
    return { state: ctx ? ctx.state : 'none', worklet: hasWorklet, engine: engineKind, voices: (ownVoice ? 1 : 0) + others.size, audible, slots: Object.keys(slots), mode, volume, muted, broken, musicTrack: music.currentTrack };
}
