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

test('wheel angle: ±90° at full lock, clamped, right is positive; shadow box per view; car frame to three.js', () => {
    assert.strictEqual(V.wheelAngle(0), 0);
    assert.strictEqual(V.wheelAngle(1), Math.PI / 2);
    assert.strictEqual(V.wheelAngle(-1), -Math.PI / 2);
    assert.strictEqual(V.wheelAngle(3), Math.PI / 2);
    assert.strictEqual(V.wheelAngle(undefined), 0);
    assert.strictEqual(V.shadowHalf('chase'), 360);
    assert.strictEqual(V.shadowHalf('tcam'), 120);
    assert.strictEqual(V.shadowHalf('cockpit'), 120);
    assert.deepStrictEqual(V.toThree([1, 2, 3]), [1, 3, -2]);
});
