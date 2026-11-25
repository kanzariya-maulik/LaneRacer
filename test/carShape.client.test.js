// The procedural car (public/js/carShape.js): every triangle faces out, as its smooth normals say (front faces are the
// only ones drawn: an inside-out triangle is a hole in the car)
const { test, before } = require('node:test');
const assert = require('node:assert');

let C;
before(async () => { C = await import('../public/js/carShape.js'); });

for (const detail of ['low', 'mid', 'high']) test(`${detail}: no triangle turned against its own normals`, () => {
    const { pos, nrm, idx } = C.bodyArrays(detail), bad = [];
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], N = (i) => [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
    for (let k = 0; k < idx.length; k += 3) {
        const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map(P), u = a.map((v, q) => b[q] - v), w = a.map((v, q) => c[q] - v);
        const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], area = Math.hypot(...f) / 2;
        if (area < 1e-6) continue; // a pole's zero-area triangles (nothing to see)
        const n = [0, 1, 2].map((q) => N(idx[k])[q] + N(idx[k + 1])[q] + N(idx[k + 2])[q]);
        if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] < 0) bad.push(k / 3);
    }
    assert.deepStrictEqual(bad.length, 0, `${bad.length} inside-out triangles`);
});
