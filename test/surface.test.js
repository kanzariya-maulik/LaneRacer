const { test, before } = require('node:test');
const assert = require('node:assert');

let S, P;
before(async () => { S = await import('../public/js/sim/surface.js'); P = await import('../public/js/sim/carphysics.js'); });
const SC = 6, sq = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }].map((p) => ({ x: p.x * SC, y: p.y * SC }));
const BOUNDS = { minX: -20 * SC, minY: -20 * SC, maxX: 40 * SC, maxY: 40 * SC };

test('rasterize paints later polygons over earlier ones', () => {
    const g = S.rasterize([{ kind: 'asphalt', poly: sq(0, 0, 20) }, { kind: 'gravel', poly: sq(5, 5, 10) }], BOUNDS, SC);
    assert.strictEqual(S.surfaceAt(g, 10 * SC, 10 * SC), 'gravel');
    assert.strictEqual(S.surfaceAt(g, 1 * SC, 1 * SC), 'asphalt');
    assert.strictEqual(S.surfaceAt(g, -10 * SC, -10 * SC), 'grass');
    assert.strictEqual(S.surfaceAt(g, 1000 * SC, 0), 'grass'); // outside the grid
});

test('raster is deterministic and winding-independent', () => {
    const tri = [{ x: 0.3, y: 1.7 }, { x: 17.9, y: 4.2 }, { x: 6.1, y: 15.3 }].map((p) => ({ x: p.x * SC, y: p.y * SC }));
    const a = S.rasterize([{ kind: 'gravel', poly: tri }], BOUNDS, SC), b = S.rasterize([{ kind: 'gravel', poly: [...tri].reverse() }], BOUNDS, SC);
    const c = S.rasterize([{ kind: 'gravel', poly: tri }], BOUNDS, SC);
    assert.deepStrictEqual(Buffer.from(a.data), Buffer.from(b.data));
    assert.deepStrictEqual(Buffer.from(a.data), Buffer.from(c.data));
    assert.ok(a.data.some((v) => v === S.KINDS.indexOf('gravel')));
});

test('cell centre rule: a square on cell boundaries covers exactly its cells', () => {
    const g = S.rasterize([{ kind: 'gravel', poly: sq(0, 0, 2) }], BOUNDS, SC); // 2 m = 4 x 4 cells of 0.5 m
    assert.strictEqual(g.data.filter((v) => v === S.KINDS.indexOf('gravel')).length, 16);
});

test('gravel slows hard but never traps', () => {
    const car = { x: 0, y: 0, vx: 1 * SC, vy: 0, angle: 0, speed: 1 * SC };
    for (let i = 0; i < 600; i++) P.step(car, { throttle: 1, brake: 0, steer: 0 }, 1 / 60, SC, S.GRIP.gravel);
    assert.ok(car.speed / SC > 3, `crawls out: ${car.speed / SC} m/s`);
    const fast = { x: 0, y: 0, vx: 60 * SC, vy: 0, angle: 0, speed: 60 * SC }, grass = { ...fast };
    for (let i = 0; i < 120; i++) { P.step(fast, { throttle: 0, brake: 0, steer: 0 }, 1 / 60, SC, S.GRIP.gravel); P.step(grass, { throttle: 0, brake: 0, steer: 0 }, 1 / 60, SC, S.GRIP.grass); }
    assert.ok(fast.speed / SC < 40, `slows: ${fast.speed / SC} m/s`);
    assert.ok(fast.speed < grass.speed, 'gravel slower than grass');
});
