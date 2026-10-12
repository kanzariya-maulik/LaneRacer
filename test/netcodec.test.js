const test = require('node:test');
const assert = require('node:assert');
const { encodeFast, decodeFast } = require('../public/js/netcodec.js');

test('binary fast update round-trips every field within its rounding', () => {
    const e = [3, 12345.6, -40000.2, 7.1234, 512.3, -0.4567, 45, -300.1, 255.4, 0.15, 98765, 0.4321, 2, 3.4, -1];
    const pkt = { s: 123456, t: 4567.891, g: 4500.123, c: [e, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0]] };
    const out = decodeFast(encodeFast(pkt));
    assert.strictEqual(out.s, 123456);
    assert.strictEqual(out.t, 4567.891);
    assert.strictEqual(out.g, 4500.123);
    const tol = [0, 0.01, 0.01, 1e-5, 0.05, 1e-4, 0, 0.05, 0.05, 1e-3, 0, 2e-5, 0, 0.05, 0];
    out.c[0].forEach((v, i) => assert.ok(Math.abs(v - e[i]) <= tol[i], `field ${i}: ${v} vs ${e[i]}`));
    assert.strictEqual(out.c[1][10], -1, 'no input applied yet');
    assert.strictEqual(out.c[1][14], 0, 'slack defaults to 0');
});

test('a full 22-car grid fits one UDP datagram, a Node Buffer decodes too, junk does not', () => {
    const car = (i) => [i, 1, 2, 3, 4, 0.1, 0, 5, 6, 0, i, 0, 0, 0, 1];
    const bin = encodeFast({ s: 1, t: 1, g: 1, c: Array.from({ length: 22 }, (_, i) => car(i)) });
    assert.ok(bin.byteLength <= 1200, `${bin.byteLength} bytes`);
    assert.strictEqual(decodeFast(Buffer.from(bin)).c.length, 22);
    assert.strictEqual(decodeFast(new ArrayBuffer(3)), null);
    assert.strictEqual(decodeFast(Buffer.from('{"type":"PONG"}')), null);
});
