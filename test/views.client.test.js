const { test, before } = require('node:test');
const assert = require('node:assert');
let V;
before(async () => { V = await import('../public/js/views.js'); });

test('views cycle chase → T-cam → cockpit → chase; junk and unknown start in chase', () => {
    assert.deepStrictEqual(V.VIEWS, ['chase', 'tcam', 'cockpit']);
    assert.strictEqual(V.nextView('chase'), 'tcam');
    assert.strictEqual(V.nextView('tcam'), 'cockpit');
    assert.strictEqual(V.nextView('cockpit'), 'chase');
    assert.strictEqual(V.nextView('helicopter'), 'chase');
    assert.strictEqual(V.viewOf('cockpit'), 'cockpit');
    for (const junk of ['helicopter', null, undefined, '', 3]) assert.strictEqual(V.viewOf(junk), 'chase');
    assert.strictEqual(V.onboard('chase'), false);
    assert.ok(V.onboard('tcam') && V.onboard('cockpit'));
    assert.deepStrictEqual(V.VIEW_FOV, { chase: 60, tcam: 75, cockpit: 75 });
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
    assert.deepStrictEqual(V.eyeFor('cockpit', { eye: [0.2, 0, 0.8] }), [0.2, 0, 0.8]);
    const t = V.eyeFor('tcam', { eye: [0.2, 0, 0.8] });
    [0.04, 0, 1.08].forEach((v, k) => assert.ok(Math.abs(t[k] - v) < 1e-9, `tcam ${t}`));
    assert.deepStrictEqual(V.wheelPosFor({}), V.WHEEL_POS);
    assert.deepStrictEqual(V.wheelPosFor(null), V.WHEEL_POS);
    assert.deepStrictEqual(V.wheelPosFor({ wheelPos: [0.7, 0, 0.6] }), [0.7, 0, 0.6]);
});
