const { test, before } = require('node:test');
const assert = require('node:assert');

let V;
before(async () => { V = await import('../public/js/audio/v8.js'); });
const SR = 48000;

function run(p, seconds = 0.4, seed = 7) {
    const s = new V.V8Synth(SR, seed), n = Math.round(SR * seconds), out = new Float32Array(n), blk = new Float32Array(128);
    for (let i = 0; i < n; i += 128) { s.render(blk, 128, p); out.set(blk.subarray(0, Math.min(128, n - i)), i); }
    return out;
}
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
function peakHz(a) { // strongest frequency 100–4000 Hz (10 Hz steps) over the last 0.2 s
    const n = SR * 0.2, x = a.subarray(a.length - n);
    let best = 0, bestF = 0;
    for (let f = 100; f <= 4000; f += 10) {
        let re = 0, im = 0;
        for (let k = 0; k < n; k++) { const w = (2 * Math.PI * f * k) / SR; re += x[k] * Math.cos(w); im += x[k] * Math.sin(w); }
        const m = re * re + im * im;
        if (m > best) { best = m; bestF = f; }
    }
    return bestF;
}

test('the dominant pitch is the V8 firing frequency (rpm/60 × 4) at 6k, 12k and 18k rpm', () => {
    for (const rpm of [6000, 12000, 18000]) {
        const want = (rpm / 60) * 4, got = peakHz(run({ rpm, load: 1 }));
        assert.ok(Math.abs(got - want) / want <= 0.05, `${rpm} rpm: peak ${got} Hz, want ${want}`);
    }
});

test('output stays within [-1, 1] at full load and under crackle', () => {
    for (const p of [{ rpm: 18000, load: 1 }, { rpm: 12000, load: 0, crackle: 1 }]) {
        const a = run(p);
        let m = 0; for (const v of a) m = Math.max(m, Math.abs(v));
        assert.ok(m <= 1, `${m}`);
    }
});

test('ignition cut silences the engine (rms < 10% of firing)', () => {
    const on = rms(run({ rpm: 15000, load: 1 })), off = rms(run({ rpm: 15000, load: 1, cut: 1 }));
    assert.ok(off < on * 0.1, `${off} vs ${on}`);
});

test('stutter (pit limiter 12 Hz) chops the sound into on/off halves', () => {
    const a = run({ rpm: 9000, load: 0.6, stutter: 12 }, 1);
    const win = SR / 24, levels = [];
    for (let i = SR * 0.25; i + win <= a.length; i += win) levels.push(rms(a, i, i + win));
    const hi = Math.max(...levels), lo = Math.min(...levels);
    assert.ok(lo < hi * 0.35, `windows ${lo.toFixed(3)}..${hi.toFixed(3)}`);
});

test('no NaN after an rpm step and extreme parameters', () => {
    const s = new V.V8Synth(SR, 3), blk = new Float32Array(128);
    for (const p of [{ rpm: 4500, load: 0 }, { rpm: 18000, load: 1 }, { rpm: 0, load: 2, cut: -1 }, { rpm: 1e9, load: NaN }, { rpm: 9000, load: 0.5 }]) {
        for (let k = 0; k < 20; k++) { s.render(blk, 128, p); for (const v of blk) assert.ok(Number.isFinite(v)); }
    }
});

test('CPU budget: 5 voices render a 128-sample block in under 0.5 ms', () => {
    const voices = [0, 1, 2, 3, 4].map((i) => new V.V8Synth(SR, i + 1)), blk = new Float32Array(128);
    const p = { rpm: 16000, load: 1, crackle: 0.3 };
    for (let k = 0; k < 200; k++) for (const v of voices) v.render(blk, 128, p); // warm up the JIT
    const t0 = process.hrtime.bigint(), N = 2000;
    for (let k = 0; k < N; k++) for (const v of voices) v.render(blk, 128, p);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    assert.ok(ms < 0.5, `${ms.toFixed(3)} ms per block`);
});
