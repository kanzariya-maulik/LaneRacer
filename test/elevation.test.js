const { test, before } = require('node:test');
const assert = require('node:assert');

let E;
before(async () => { E = await import('../public/js/sim/elevation.js'); });

// A figure-8 style crossing: segment 0-1 runs east at height 0, segment 2-3 runs north over it at height 6 (a bridge)
const bridge = { scale: 6, width: 60, path: [{ x: -300, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 300 }, { x: 0, y: -300 }], z: [0, 0, 6, 6] };

test('heightAt: interpolates the nearest segment, gives the gradient along it, flat without z data', () => {
    const t = { scale: 6, width: 60, path: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }], z: [0, 10, 10, 0] };
    const mid = E.heightAt(t, 300, 20);
    assert.ok(Math.abs(mid.h - 5) < 1e-9 && Math.abs(mid.sx - 0.1) < 1e-9 && mid.sy === 0, JSON.stringify(mid));
    assert.deepStrictEqual(E.heightAt({ ...t, z: null }, 300, 0), { h: 0, sx: 0, sy: 0 });
});

test('at a bridge each car stays on its own level: the road it is heading along wins', () => {
    assert.strictEqual(E.heightAt(bridge, 0, 0, 0).h, 0, 'heading east: the lower road');
    assert.strictEqual(E.heightAt(bridge, 0, 0, -Math.PI / 2).h, 6, 'heading north (y up the screen is negative): the bridge');
});

test('profile: grade and vertical curvature from heights (a 1000 m-radius dip: + curvature, grade changing sign)', () => {
    const n = 200, pts = [], z = [];
    for (let i = 0; i < n; i++) { const s = i * 10 - 1000; pts.push({ x: s * 6, y: 0 }); z.push((s * s) / 2000); }
    const cum = [0]; for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + 60); // the wrap segment just closes the loop
    const { grade, vcurv } = E.profile(z, cum, 6);
    assert.ok(Math.abs(grade[50] - -0.5) < 0.02 && Math.abs(grade[150] - 0.5) < 0.02, `${grade[50]} ${grade[150]}`);
    assert.ok(Math.abs(vcurv[100] - 1 / 1000) < 1e-5, `${vcurv[100]}`);
});

test('slopeAt: what the car feels depends on its heading (uphill one way, downhill the other, nothing across)', () => {
    const t = { scale: 6, width: 60, path: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }], z: [0, 10, 10, 0], grade: [0.1, 0, -0.1, 0], vcurv: [0.001, 0, 0, 0] };
    assert.ok(Math.abs(E.slopeAt(t, 300, 0, 0).grade - 0.05) < 1e-9);
    assert.ok(Math.abs(E.slopeAt(t, 300, 0, Math.PI).grade + 0.05) < 1e-9);
    assert.ok(Math.abs(E.slopeAt(t, 0, 0, 0).vcurv - 0.001) < 1e-9);
});
