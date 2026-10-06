const test = require('node:test');
const assert = require('node:assert');
const { sanitizeTelemetry } = require('../src/netlog');

test('telemetry from a browser: numbers in range kept, anything else becomes null', () => {
    assert.deepStrictEqual(sanitizeTelemetry({ rttMs: 12.5, jitterMs: 3, lossPct: 2, delayMs: 40, predErrCm: 1.2, fps: 60, link: 'UDP' }),
        { rttMs: 12.5, jitterMs: 3, lossPct: 2, delayMs: 40, predErrCm: 1.2, fps: 60, link: 'UDP' });
    const bad = sanitizeTelemetry({ rttMs: -1, jitterMs: 'x', lossPct: 150, delayMs: NaN, predErrCm: Infinity, fps: null, link: 'evil\nline' });
    assert.deepStrictEqual(bad, { rttMs: null, jitterMs: null, lossPct: null, delayMs: null, predErrCm: null, fps: null, link: 'TCP' });
    assert.strictEqual(sanitizeTelemetry('nope'), null);
});
