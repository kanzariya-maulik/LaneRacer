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

// Box: half-length 2.74 m, half-width 1.0 m, centred 0.18 m ahead of the car's origin
test('nose to tail 5.4 m apart collides along the length axis', () => {
    const hit = Physics.carOverlap(car(0, 0), car(5.4, 0), S);
    assert.ok(hit);
    close(hit.depth, (2 * 2.74 - 5.4) * S); // same heading: the offsets cancel
    close(hit.nx, -1);
    close(hit.ny, 0);
});

test('car rotated 90°: collides at 3.5 m, clear at 4.0 m', () => {
    const hit = Physics.carOverlap(car(0, 0), car(3.5, 0, 90), S);
    assert.ok(hit);
    close(hit.depth, (0.18 + 2.74 + 1 - 3.5) * S); // a's box front reaches 2.92, b's side is 1.0 m from its centre
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(4.0, 0, 90), S), null);
});

test('car rotated 45°: SAT separates at 5.4 m even though x-extents overlap', () => {
    assert.strictEqual(Physics.carOverlap(car(0, 0), car(5.4, 0, 45), S), null);
    const hit = Physics.carOverlap(car(0, 0), car(4.9, 0, 45), S);
    assert.ok(hit);
    // min overlap is on b's sideways axis: 2.74·√½ + 1·√½ + 1 − (distance between box centres on that axis)
    const n = [-Math.SQRT1_2, Math.SQRT1_2], ca = [0.18, 0], cb = [4.9 + 0.18 * Math.SQRT1_2, 0.18 * Math.SQRT1_2];
    const gap = Math.abs((ca[0] - cb[0]) * n[0] + (ca[1] - cb[1]) * n[1]);
    close(hit.depth, (2.74 * Math.SQRT1_2 + Math.SQRT1_2 + 1 - gap) * S);
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

test('nearestOnPath: open path does not wrap back to the first point', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const open = Physics.nearestOnPath(10, 60, line, false);
    assert.strictEqual(open.dist, 60);
    assert.strictEqual(open.i, 0);
    assert.ok(Math.abs(open.t - 0.1) < 1e-9);
    assert.ok(Physics.nearestOnPath(10, 60, line).dist < 36, 'closed path should use the closing segment');
});

test('crossWall: crossing reports the normal back toward the side the car came from', () => {
    const wall = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const down = Physics.crossWall(50, 10, 50, -10, wall);
    assert.ok(Math.abs(down.nx) < 1e-9 && Math.abs(down.ny - 1) < 1e-9);
    const up = Physics.crossWall(50, -10, 50, 10, wall);
    assert.ok(Math.abs(up.nx) < 1e-9 && Math.abs(up.ny + 1) < 1e-9);
    assert.strictEqual(Physics.crossWall(50, 10, 50, 5, wall), null, 'same side');
    assert.strictEqual(Physics.crossWall(150, 10, 150, -10, wall), null, 'past the wall end');
    assert.strictEqual(Physics.crossWall(50, 10, 50, -10, []), null, 'no wall');
});

// ---- car hitbox matches the car model (public/js/carShape.js: body, and the wheels: pivot ± radius / half width) ----
async function carExtents() {
    const S = await import('../public/js/carShape.js'), { pos } = S.bodyArrays('high');
    let front = -Infinity, rear = Infinity, side = 0;
    for (let i = 0; i < pos.length; i += 3) { front = Math.max(front, pos[i]); rear = Math.min(rear, pos[i]); side = Math.max(side, Math.abs(pos[i + 2])); }
    for (const [x, y, w] of Object.values(S.WHEELS)) { front = Math.max(front, x + S.WHEEL_RADIUS); rear = Math.min(rear, x - S.WHEEL_RADIUS); side = Math.max(side, Math.abs(y) + w / 2); }
    return { front, rear, side };
}

test('collision box matches the car model: front wing to rear wing, wheel to wheel', async () => {
    const e = await carExtents(), off = Physics.CAR_CENTER_OFFSET_M ?? 0, hl = Physics.CAR_HALF_LENGTH_M;
    assert.ok(Math.abs(off + hl - e.front) < 0.03, `box front ${(off + hl).toFixed(2)} vs model ${e.front.toFixed(2)}`);
    assert.ok(Math.abs(off - hl - e.rear) < 0.03, `box rear ${(off - hl).toFixed(2)} vs model ${e.rear.toFixed(2)}`);
    assert.ok(Physics.CAR_HALF_WIDTH_M >= e.side - 0.005 && Physics.CAR_HALF_WIDTH_M <= e.side + 0.05, `width ${e.side}`);
});

test('nose-to-tail: cars touch where the wings touch, not before', async () => {
    const S = 6, e = await carExtents(), len = e.front - e.rear;
    const a = { x: 0, y: 0, angle: 0 };
    assert.strictEqual(Physics.carOverlap(a, { x: -(len + 0.05) * S, y: 0, angle: 0 }, S), null, '5 cm gap: no contact');
    assert.ok(Physics.carOverlap(a, { x: -(len - 0.05) * S, y: 0, angle: 0 }, S), '5 cm overlap: contact');
    const wall = [{ x: (e.front - 0.05) * S, y: -50 }, { x: (e.front - 0.05) * S, y: 50 }];
    assert.ok(Physics.wallOverlap(a, wall, S), 'front wing reaches a wall 5 cm inside its tip');
    const back = [{ x: (e.rear - 0.05) * S, y: -50 }, { x: (e.rear - 0.05) * S, y: 50 }];
    assert.strictEqual(Physics.wallOverlap(a, back, S), null, 'nothing sticks out behind the rear wing');
});
