const { test } = require('node:test');
const assert = require('node:assert');
const golden = require('./fixtures/drive-golden.json');
const { trace } = require('./fixtures/make-drive-golden');

// Not bit-identical: Math.sin/cos/atan2 differ in the last digits between platforms (macOS vs Windows), so allow
// rounding noise but nothing a physics change could hide in. Re-record after changing track data:
// node test/fixtures/make-drive-golden.js
const same = (a, b) => (typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : a === b);

test('car motion matches the recorded trace (10,000 random inputs over 5 tracks)', () => {
    const now = trace();
    for (const id of Object.keys(golden)) {
        assert.strictEqual(now[id].length, golden[id].length, `${id} trace length`);
        golden[id].forEach((row, r) => row.forEach((v, k) => assert.ok(same(now[id][r][k], v), `${id} motion changed at row ${r}, field ${k}: ${now[id][r][k]} vs ${v}`)));
    }
});
