const { test } = require('node:test');
const assert = require('node:assert');
const golden = require('./fixtures/drive-golden.json');
const { trace } = require('./fixtures/make-drive-golden');

test('car motion is bit-identical to the recorded trace (10,000 random inputs over 5 tracks)', () => {
    const now = trace();
    for (const id of Object.keys(golden)) assert.deepStrictEqual(now[id], golden[id], `${id} motion changed`);
});
