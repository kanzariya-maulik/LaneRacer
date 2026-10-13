const { test, before } = require('node:test');
const assert = require('node:assert');
let M, THREE, V;
before(async () => { THREE = await import('three'); M = await import('../public/js/carModel.js'); V = await import('../public/js/views.js'); });

// A canvas stand-in: every 2D call is a no-op
const fakeCanvas = () => { const ctx = new Proxy({}, { get: () => () => {} }); return { width: 0, height: 0, getContext: () => ctx }; };

test('steering wheel: F1-sized, in front of the cockpit eye, turns with steering, display redraws, on layer 1', () => {
    const w = M.buildSteeringWheel(fakeCanvas(), '#00a19c');
    const box = new THREE.Box3().setFromObject(w.root), size = box.getSize(new THREE.Vector3());
    assert.ok(size.z > 0.27 && size.z < 0.36, `width with the gloves on ${size.z.toFixed(3)} m`); // rim 0.20 + grips at ±0.12 + gloves
    assert.ok(Math.abs(w.root.position.x - V.WHEEL_POS[0]) < 1e-9 && Math.abs(w.root.position.y - V.WHEEL_POS[2]) < 1e-9);
    w.spin.rotation.x = Math.PI / 2;
    w.root.updateMatrixWorld(true);
    const turned = new THREE.Box3().setFromObject(w.spin).getSize(new THREE.Vector3());
    assert.ok(turned.z < size.z, 'a quarter turn stands the rim on end');
    const tex = w.root.getObjectByName('wheelDisplay').material.map, v0 = tex.version;
    w.draw({ gear: '7', kmh: '298', lit: 9, drs: true });
    assert.ok(tex.version > v0, 'display texture flagged for upload');
    let meshes = 0;
    w.root.traverse((o) => { if (o.isMesh) { meshes++; assert.ok(o.layers.isEnabled(0) && o.layers.isEnabled(1), o.name); } });
    assert.ok(meshes >= 5, 'rim, two grips, display, two gloves');
    w.setGlove('#ff8000');
    assert.strictEqual(w.root.getObjectByName('glove').material.color.getHexString(), 'ff8000');
});
