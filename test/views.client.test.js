const { test, before } = require('node:test');
const assert = require('node:assert');
let V;
before(async () => { V = await import('../public/js/views.js'); });

test('views cycle chase → chase far → T-cam → cockpit → chase; junk and unknown start in chase', () => {
    assert.deepStrictEqual(V.VIEWS, ['chase', 'far', 'tcam', 'cockpit']);
    assert.strictEqual(V.nextView('chase'), 'far');
    assert.strictEqual(V.nextView('far'), 'tcam');
    assert.strictEqual(V.nextView('tcam'), 'cockpit');
    assert.strictEqual(V.nextView('cockpit'), 'chase');
    assert.strictEqual(V.nextView('helicopter'), 'chase');
    assert.strictEqual(V.viewOf('cockpit'), 'cockpit');
    for (const junk of ['helicopter', null, undefined, '', 3]) assert.strictEqual(V.viewOf(junk), 'chase');
    assert.strictEqual(V.onboard('chase'), false);
    assert.strictEqual(V.onboard('far'), false);
    assert.ok(V.onboard('tcam') && V.onboard('cockpit'));
    assert.deepStrictEqual(V.VIEW_FOV, { chase: 60, far: 60, tcam: 75, cockpit: 75 });
});

test('chase cameras as the F1 games: low and close behind the car, chase far a little further and higher', () => {
    const { chase, far } = V.CHASE;
    assert.ok(chase.back >= 4 && chase.back <= 5.5 && chase.up >= 1.1 && chase.up <= 1.5, 'close: just over the rear wing');
    assert.ok(far.back > chase.back && far.up > chase.up && far.back <= 7 && far.up <= 2);
    for (const c of [chase, far]) assert.ok(c.ahead > 0 && c.lookUp <= 0.5, 'looking down the road ahead');
});

test('cockpit eye sits inside the helmet (outward faces culled from inside), T-cam above the airbox pod', () => {
    const [x, y, z] = V.EYE.cockpit, h = { c: [0.18, 0, 0.74], r: [0.13, 0.115, 0.13] }; // carShape.js helmet ellipsoid
    const k = ((x - h.c[0]) / h.r[0]) ** 2 + ((y - h.c[1]) / h.r[1]) ** 2 + ((z - h.c[2]) / h.r[2]) ** 2;
    assert.ok(k < 1, `eye outside the helmet (${k.toFixed(2)})`);
    const [tx, ty, tz] = V.EYE.tcam;
    assert.ok(tx <= 0.08 && tx >= -0.02 && ty === 0 && tz > 0.985, 'T-cam over the pod (x -0.02..0.08, top z 0.985)');
    assert.ok(V.EYE_TILT.tcam < 0 && V.EYE_TILT.cockpit <= 0);
    assert.ok(V.WHEEL_POS[0] > x && V.WHEEL_POS[0] < 0.58, 'wheel ahead of the eye, behind the halo pillar (x 0.58)');
});

test('wheel angle: ±90° at full lock, clamped, right is positive; car frame to three.js', () => {
    assert.strictEqual(V.wheelAngle(0), 0);
    assert.strictEqual(V.wheelAngle(1), Math.PI / 2);
    assert.strictEqual(V.wheelAngle(-1), -Math.PI / 2);
    assert.strictEqual(V.wheelAngle(3), Math.PI / 2);
    assert.strictEqual(V.wheelAngle(undefined), 0);
    assert.deepStrictEqual(V.toThree([1, 2, 3]), [1, 3, -2]);
});

test('shadowHalf is gone: cascaded shadows fit themselves', () => {
    assert.strictEqual(V.shadowHalf, undefined);
});

test('eye and wheel per car: the model\'s own markers, the procedural values without them', () => {
    assert.deepStrictEqual(V.eyeFor('cockpit', null), V.EYE.cockpit);
    assert.deepStrictEqual(V.eyeFor('tcam', {}), V.EYE.tcam);
    // from the real car's eye marker: cockpit just over the halo bar, T-cam above and behind the helmet
    const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-9);
    const c = V.eyeFor('cockpit', { eye: [0.2, 0, 0.8] }), t = V.eyeFor('tcam', { eye: [0.2, 0, 0.8] });
    assert.ok(near(c, [0.08, 0, 1.04]), `cockpit ${c}`);
    assert.ok(near(t, [-0.14, 0, 1.2]), `tcam ${t}`);
    assert.ok(V.EYE_TILT.tcam < V.EYE_TILT.cockpit, 'T-cam looks down onto the helmet and wheel');
    assert.deepStrictEqual(V.wheelPosFor({}), V.WHEEL_POS);
    assert.deepStrictEqual(V.wheelPosFor(null), V.WHEEL_POS);
    assert.deepStrictEqual(V.wheelPosFor({ wheelPos: [0.7, 0, 0.6] }), [0.7, 0, 0.6]);
});

test('front wheels steer anti-Ackermann as an F1 car: the inner wheel turns less than the outer one', () => {
    const [l, r] = V.frontSteer(0.3); // turning right: the right wheel is the inner one
    assert.ok(r > 0 && l > r, `left ${l} right ${r}`);
    const [l2, r2] = V.frontSteer(-0.3); // turning left: the left wheel is inner
    assert.ok(l2 < 0 && r2 < l2, `left ${l2} right ${r2}`);
    assert.ok(Math.abs((l + r) / 2 - 0.3) < 1e-9, 'the mean is the steering angle');
    assert.deepStrictEqual(V.frontSteer(0), [0, 0]);
});

test('cars drawn and collided at CAR_SCALE of real size (a touch smaller beside the track), the hitbox the same', async () => {
    const Physics = (await import('../public/js/sim/physics.js')).default;
    assert.ok(Physics.CAR_SCALE >= 0.85 && Physics.CAR_SCALE < 1, `${Physics.CAR_SCALE}`);
    assert.ok(Math.abs(Physics.CAR_HALF_LENGTH_M - 2.74 * Physics.CAR_SCALE) < 1e-9 && Math.abs(Physics.CAR_HALF_WIDTH_M - 1.0 * Physics.CAR_SCALE) < 1e-9);
});
