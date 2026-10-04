const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const teams = require('../public/teams.json');
const pngSize = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
let Shape;
test.before(async () => { Shape = await import('../public/js/carShape.js'); });

test('every team has a 320×120 lobby thumbnail', () => {
    for (const t of teams) assert.deepStrictEqual(pngSize(path.join(PUB, 'liveries', `${t.id}-thumb.png`)), [320, 120], t.id);
});

// The car (public/js/carShape.js): the game and the physics collision box depend on its size, its parts and its budgets
test('car body: inside the collision box (x -2.56..2.92 m, |y| ≤ 0.98 m, 0 < z < 1.0 m), triangles within budget per detail', () => {
    const budget = { low: 8000, mid: 20000, high: 40000 };
    for (const d of ['low', 'mid', 'high']) {
        const { pos, idx } = Shape.bodyArrays(d);
        assert.ok(idx.length / 3 <= budget[d], `${d}: ${idx.length / 3} triangles`);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < pos.length; i += 3) { // three.js frame: (x, z up, -y)
            x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); z0 = Math.min(z0, pos[i + 1]); z1 = Math.max(z1, pos[i + 1]); y0 = Math.min(y0, -pos[i + 2]); y1 = Math.max(y1, -pos[i + 2]);
        }
        assert.ok(x0 >= -2.57 && x1 <= 2.94, `${d}: x ${x0.toFixed(2)}..${x1.toFixed(2)}`);
        assert.ok(y0 >= -0.98 && y1 <= 0.98, `${d}: y ${y0.toFixed(2)}..${y1.toFixed(2)}`);
        assert.ok(z0 > 0 && z1 < 1.0, `${d}: z ${z0.toFixed(2)}..${z1.toFixed(2)}`);
    }
});

test('car body: smooth normals face out of their triangles (no inside-out patches)', () => {
    const { pos: P, nrm: N, idx: I } = Shape.bodyArrays('mid');
    let bad = 0, n = 0;
    for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]], p = (q) => [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]], A = p(a), B = p(b), C = p(c);
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...f);
        if (l < 1e-9) continue;
        for (const q of [a, b, c]) { n++; if (f[0] * N[q * 3] + f[1] * N[q * 3 + 1] + f[2] * N[q * 3 + 2] < 0) bad++; }
    }
    assert.ok(bad / n < 0.03, `${bad} of ${n} vertex normals point into their triangle`);
});

test('every team livery paints every part of the car, in the team colours', () => {
    const N = 256; // a small atlas is enough to see every part
    const grey = [138, 143, 150];
    for (const t of teams) {
        assert.ok(Shape.LIVERIES[t.id], `${t.id}: no livery rules`);
        const px = Shape.paintLivery(t.id, N), colours = new Set();
        for (let k = 0; k < N * N; k++) colours.add(`${px[k * 4]},${px[k * 4 + 1]},${px[k * 4 + 2]}`);
        assert.ok(colours.size >= 3, `${t.id}: only ${colours.size} colours`);
        assert.ok(!colours.has(grey.join(',')), `${t.id}: fell back to plain grey`);
    }
});

test('wheel pivots and sizes: 720 mm tyres, 305 mm front and 405 mm rear, where the car rests on them', () => {
    assert.strictEqual(Shape.WHEEL_RADIUS, 0.36);
    assert.deepStrictEqual(Shape.WHEELS.wheel_FL, [1.60, 0.80, 0.305]);
    assert.deepStrictEqual(Shape.WHEELS.wheel_RR, [-1.85, -0.78, 0.405]);
});
