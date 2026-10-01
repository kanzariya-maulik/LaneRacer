const test = require('node:test');
const assert = require('node:assert');
const Physics = require('../src/game/Physics');

const S = 6;
const car = (x, y, angleDeg = 0, vx = 0, vy = 0) =>
    ({ x: x * S, y: y * S, angle: (angleDeg * Math.PI) / 180, vx: vx * S, vy: vy * S });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('side by side 2.3 m apart does not collide (old 3 m circle did)', () => {
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(0, 2.3), S), null);
    assert.ok(2.3 * S < 2 * 18, 'old circle hitbox (radius 18) would have reported a hit');
});

test('nose to tail 5.4 m apart collides along the length axis', () => {
    const hit = Physics.carOverlap(car(0, 0), car(5.4, 0), S);
    assert.ok(hit);
    close(hit.depth, 0.2 * S);
    close(hit.nx, -1);
    close(hit.ny, 0);
});

test('car rotated 90°: collides at 3.5 m, clear at 3.9 m', () => {
    const hit = Physics.carOverlap(car(0, 0), car(3.5, 0, 90), S);
    assert.ok(hit);
    close(hit.depth, 0.3 * S);
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(3.9, 0, 90), S), null);
});

test('car rotated 45°: SAT separates at 5.3 m even though x-extents overlap', () => {
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(5.3, 0, 45), S), null);
    const hit = Physics.carOverlap(car(0, 0), car(4.9, 0, 45), S);
    assert.ok(hit);
    // min overlap is on b's sideways axis: 2.8·√½ + 1·√½ + 1 − 4.9·√½
    close(hit.depth, (2.8 * Math.SQRT1_2 + Math.SQRT1_2 + 1 - 4.9 * Math.SQRT1_2) * S);
});

test('resolve separates the cars', () => {
    const a = car(0, 0), b = car(5, 0.5, 10);
    assert.ok(Physics.resolveCarCollision(a, b, S));
    const after = Physics.carOverlap(a, b, S);
    assert.ok(after === null || after.depth < 1e-6);
});

test('rear-ender: front car speeds up, rear car slows, momentum kept', () => {
    const a = car(0, 0, 0, 30, 0);   // behind, faster
    const b = car(5.4, 0, 0, 20, 0); // in front
    Physics.resolveCarCollision(a, b, S);
    assert.ok(b.vx > 20 * S);
    assert.ok(a.vx < 30 * S);
    close(a.vx + b.vx, 50 * S);
});

test('nearestOnTrack finds the closest point on the loop', () => {
    const track = { path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const n = Physics.nearestOnTrack(50, -20, track);
    close(n.dist, 20);
    close(n.px, 50);
    close(n.py, 0);
});
