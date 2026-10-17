const { test, before } = require('node:test');
const assert = require('node:assert');

let W, P;
before(async () => { W = await import('../public/js/sim/walls.js'); P = (await import('../public/js/sim/physics.js')).default; });
const SC = 6, TICK = 1 / 60, V300 = (300 / 3.6) * SC; // ~14 units a tick
const car = (x, y, angle, v) => ({ x, y, angle, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, speed: v });
// Move one tick, then let the walls answer
function tick(p, index) {
    const x0 = p.x, y0 = p.y;
    p.x += p.vx * TICK; p.y += p.vy * TICK;
    return W.collideWalls(p, x0, y0, index, SC);
}

test('a 300 km/h car hits, never passes', () => {
    const index = W.wallIndex([{ kind: 'concrete', pts: [{ x: 100 * SC, y: -50 * SC }, { x: 100 * SC, y: 50 * SC }] }], SC);
    const p = car(0, 0, 0, V300);
    let hit = false;
    for (let i = 0; i < 200; i++) {
        hit = tick(p, index) || hit;
        assert.ok(p.x < 100 * SC, `through at tick ${i}: x = ${p.x / SC} m`);
        p.vx = V300; p.vy = 0; p.angle = 0; // keep re-aiming at it
    }
    assert.ok(hit);
});

test('the joint between two segments holds', () => {
    const V = [{ x: 60 * SC, y: -40 * SC }, { x: 100 * SC, y: 0 }, { x: 60 * SC, y: 40 * SC }];
    const index = W.wallIndex([{ kind: 'armco', pts: V }], SC);
    for (const a of [0, 0.001, -0.001]) {
        const p = car(0, 0, a, V300);
        for (let i = 0; i < 120; i++) {
            tick(p, index);
            assert.ok(p.x < 100 * SC - 1e-6 || Math.abs(p.y) > 1e-6, `through the vertex at angle ${a}`);
            assert.ok(p.x <= 100 * SC, `beyond the V: ${p.x / SC}`);
        }
    }
});

test('end caps: past the end is open, just inside it is wall', () => {
    const index = W.wallIndex([{ kind: 'concrete', pts: [{ x: 50 * SC, y: 0 }, { x: 50 * SC, y: 30 * SC }] }], SC);
    const past = car(0, -5 * SC, 0, V300);
    for (let i = 0; i < 60; i++) tick(past, index);
    assert.ok(past.x > 50 * SC, 'no phantom wall beyond the end');
    const inside = car(0, 1 * SC, 0, V300);
    for (let i = 0; i < 60; i++) tick(inside, index);
    assert.ok(inside.x < 50 * SC, 'stopped just inside the end');
});

test('same result as a scan of every segment', () => {
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pts = Array.from({ length: 201 }, (_, i) => ({ x: i * 5 * SC, y: Math.sin(i / 7) * 20 * SC }));
    const index = W.wallIndex([{ kind: 'concrete', pts }], SC);
    for (let k = 0; k < 1000; k++) {
        const x = rnd() * 1000 * SC, y = (rnd() - 0.5) * 60 * SC, a = rnd() * Math.PI * 2, v = rnd() * V300;
        const p = car(x, y, a, v), q = car(x, y, a, v);
        const x0 = p.x, y0 = p.y;
        p.x += p.vx * TICK; p.y += p.vy * TICK; q.x = p.x; q.y = p.y;
        W.collideWalls(p, x0, y0, index, SC);
        // brute force: the same two passes over every segment
        const cross = P.crossWall(x0, y0, q.x, q.y, pts);
        if (cross) { q.x = x0 + cross.nx * 0.5; q.y = y0 + cross.ny * 0.5; P.bounce(q, cross.nx, cross.ny); }
        const ov = P.wallOverlap(q, pts, SC);
        if (ov) { q.x += ov.nx * ov.depth; q.y += ov.ny * ov.depth; P.bounce(q, ov.nx, ov.ny); }
        assert.deepStrictEqual([p.x, p.y, p.vx, p.vy], [q.x, q.y, q.vx, q.vy], `move ${k}`);
    }
});

test('rayToWall measures the distance to the first wall', () => {
    const index = W.wallIndex([{ kind: 'concrete', pts: [{ x: 10 * SC, y: -5 * SC }, { x: 10 * SC, y: 5 * SC }] }], SC);
    assert.ok(Math.abs(W.rayToWall(index, 0, 0, 1, 0, 400 * SC) - 10 * SC) < 1e-6);
    assert.strictEqual(W.rayToWall(index, 0, 0, -1, 0, 400 * SC), Infinity);
});
