const { test, before } = require('node:test');
const assert = require('node:assert');
let C, THREE;
before(async () => { THREE = await import('three'); C = await import('../public/js/carModels.js'); });

// A glTF stand-in shaped like the pipeline's output (y up): LODs, wheel markers with extras, eye/head/wheel_pos
function fakeGltf() {
    const scene = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ name: 'livery' });
    for (const name of ['lod_near', 'lod_far']) { const m = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 2), mat); m.name = name; scene.add(m); }
    const marker = (name, p, extras = {}) => { const o = new THREE.Object3D(); o.name = name; o.position.set(...p); o.userData = extras; scene.add(o); };
    marker('wheel_FL', [1.8, 0.37, -0.83], { radius: 0.37, width: 0.39 });
    marker('wheel_FR', [1.8, 0.37, 0.83], { radius: 0.37, width: 0.39 });
    marker('wheel_RL', [-1.8, 0.38, -0.8], { radius: 0.38, width: 0.41 });
    marker('wheel_RR', [-1.8, 0.38, 0.8], { radius: 0.38, width: 0.41 });
    marker('eye', [0.45, 0.74, 0]); marker('head', [0.37, 0.76, 0]); marker('wheel_pos', [0.74, 0.62, 0]);
    return { scene };
}

test('carModels: a failed load falls back once', async () => {
    let calls = 0;
    const load = () => { calls++; return Promise.reject(new Error('404')); };
    assert.strictEqual(await C.loadTeamCar('nosuchteam', load), null);
    assert.strictEqual(await C.loadTeamCar('nosuchteam', load), null);
    assert.strictEqual(calls, 1);
});

test('carModels: markers in the car frame (x forward, y left, z up), one request per team', async () => {
    let calls = 0;
    const load = (url) => { calls++; assert.match(url, /models\/cars\/testteam\.glb$/); return Promise.resolve(fakeGltf()); };
    const a = await C.loadTeamCar('testteam', load);
    await C.loadTeamCar('testteam', load);
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(a.eye.map((v) => +v.toFixed(3)), [0.45, 0, 0.74]);
    assert.deepStrictEqual(a.wheels.wheel_FL.pos.map((v) => +v.toFixed(3)), [1.8, 0.83, 0.37]);
    assert.strictEqual(a.wheels.wheel_RR.radius, 0.38);
    assert.strictEqual(a.wheels.wheel_RR.width, 0.41);
    assert.ok(a.near && a.far && a.head && a.wheelPos);
});

test('carModels: each car gets its own materials (a ghost fades only that car)', async () => {
    const a = await C.loadTeamCar('testteam2', () => Promise.resolve(fakeGltf()));
    const mats = (g) => { const m = []; g.traverse((o) => o.isMesh && m.push(o.material)); return m; };
    const g1 = C.cloneForCar(a, 45), g2 = C.cloneForCar(a, 45);
    assert.ok(g1.isLOD && g1.levels.length === 2 && g1.levels[1].distance === 45);
    const m1 = mats(g1), m2 = mats(g2);
    assert.ok(m1.length === 2 && m2.length === 2);
    for (const m of m1) assert.ok(!m2.includes(m) && !mats(a.near).includes(m));
});

test('carModels: Low draws the far model only', () => {
    assert.strictEqual(C.detailFor('low'), 'far');
    assert.strictEqual(C.detailFor('medium'), 'near');
    assert.strictEqual(C.detailFor('high'), 'near');
});
