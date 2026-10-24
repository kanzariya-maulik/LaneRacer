// A small GLB reader for the tests (test/carModels.test.js): the JSON chunk, nodes by name with their world translation
// (glTF frame: y up) and extras, triangle counts and bounds of a node's meshes.
const fs = require('fs');

function readGlb(file) {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
    const len = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
    const parent = new Map();
    (json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
    const local = (n) => n.translation || [0, 0, 0], scl = (n) => n.scale || [1, 1, 1];
    // world position (translations and scales up the chain; the pipeline exports without rotations on these nodes)
    const world = (i) => {
        let p = [...local(json.nodes[i])];
        for (let q = parent.get(i); q !== undefined; q = parent.get(q)) { const n = json.nodes[q], s = scl(n), t = local(n); p = p.map((v, k) => v * s[k] + t[k]); }
        return p;
    };
    const nodes = new Map((json.nodes || []).map((n, i) => [n.name, { index: i, translation: world(i), extras: n.extras || {} }]));
    const under = (i) => [i, ...(json.nodes[i].children || []).flatMap(under)];
    const prims = (name) => {
        const n = nodes.get(name);
        if (!n) return [];
        return under(n.index).flatMap((i) => (json.nodes[i].mesh === undefined ? [] : json.meshes[json.nodes[i].mesh].primitives));
    };
    const triangles = (name) => prims(name).reduce((s, p) => s + (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3, 0);
    // bounds from the POSITION accessors' min/max, through the mesh node's own translation and scale (meshopt's
    // quantization stores positions as integers and puts the dequantizing transform on the node)
    const bounds = (name) => {
        const n = nodes.get(name);
        const ps = n ? under(n.index).filter((i) => json.nodes[i].mesh !== undefined).flatMap((i) => json.meshes[json.nodes[i].mesh].primitives.map((p) => {
            const a = json.accessors[p.attributes.POSITION], s = scl(json.nodes[i]), t = local(json.nodes[i]);
            const q = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1; // integers stand for -1..1 (or 0..1)
            return { min: a.min.map((v, k) => (v / q) * s[k] + t[k]), max: a.max.map((v, k) => (v / q) * s[k] + t[k]) };
        })) : [];
        if (!ps.length) return null;
        return { min: [0, 1, 2].map((k) => Math.min(...ps.map((a) => a.min[k]))), max: [0, 1, 2].map((k) => Math.max(...ps.map((a) => a.max[k]))) };
    };
    return { json, nodes, triangles, bounds, bytes: buf.length };
}

module.exports = { readGlb };
