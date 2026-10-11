const { test, before } = require('node:test');
const assert = require('node:assert');
let T;
before(async () => { T = await import('../public/js/qualiText.js'); });

test('clock text per format and phase', () => {
    assert.strictEqual(T.clockText({ format: 'full', segment: 2, phase: 'running', endsInMs: 252000 }), 'Q2 · 4:12');
    assert.strictEqual(T.clockText({ format: 'short', segment: 1, phase: 'running', endsInMs: 340000 }), 'QUALIFYING · 5:40');
    assert.strictEqual(T.clockText({ format: 'oneshot', phase: 'running' }, { onTimedLap: false }), 'ONE-SHOT · OUT-LAP');
    assert.strictEqual(T.clockText({ format: 'oneshot', phase: 'running' }, { onTimedLap: true }), 'ONE-SHOT · FLYING LAP');
    assert.strictEqual(T.clockText({ format: 'full', segment: 1, phase: 'flag' }), 'FINISH YOUR LAP');
});

test('lap banners', () => {
    assert.strictEqual(T.lapBanner({ valid: true, pos: 3, prevPos: 7, pole: false }, 4), 'IMPROVED P7 → P3');
    assert.strictEqual(T.lapBanner({ valid: true, pos: 8, prevPos: 8, pole: false }, 6), 'STILL IN THE DROP ZONE — P8');
    assert.strictEqual(T.lapBanner({ valid: true, pos: 1, prevPos: 2, pole: true }, 4), 'PROVISIONAL POLE');
    assert.strictEqual(T.lapBanner({ valid: false }, 4), null);
    assert.strictEqual(T.fmtLap(81.403), '1:21.403');
});

test('box banner names the tyres', () => {
    assert.strictEqual(T.boxBanner('this', 'S'), 'BOX THIS LAP — SOFTS');
    assert.strictEqual(T.boxBanner('next', 'H'), 'BOX NEXT LAP — HARDS');
});
