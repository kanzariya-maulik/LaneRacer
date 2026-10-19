// The circuit's barriers as built, per kind, exactly on the physics barrier lines (track.build.barriers): concrete blocks,
// triple Armco on posts, stacked tyres, TecPro blocks, and the debris fence on top. barrierPlacements is plain numbers (the
// node tests check it); buildBarriers turns it into one merged mesh or one instanced batch per piece type.
// Heights: ground(x, y) and road(x, y) give world-unit heights; every piece stands from the lower of the two (0.3 m
// into it, so no gap shows on a bank) to its height above the higher.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PIECE_M = 4;      // concrete, rails and fence in pieces this long at most: each piece follows the ground
const SINK_M = 0.3;     // pieces start this far under the ground
const ARMCO = { post: 2, rails: [0.05, 0.37, 0.69], rail: 0.31, depth: 0.12 }; // three rails, 0.31 m profiles, posts every 2 m
const TYRE = { r: 0.3, tall: 0.25, every: 0.6 };  // stacked tyres, as tall as the barrier
const TECPRO = { len: 1.5, tall: 1.2, deep: 0.6 };
const FENCE_POST_M = 4;
const CONCRETE_DEEP_M = 0.6;

// Points every `every` m along a polyline (world units), each with its heading, distance along, segment and share of it
function walk(pts, sc, every, fn) {
    let along = 0, next = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y) / sc;
        if (!len) continue;
        const rot = Math.atan2(b.y - a.y, b.x - a.x);
        for (; next <= along + len + 1e-9; next += every) { const f = (next - along) / len; fn(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, rot, next, i, f); }
        along += len;
    }
}

// Pieces of at most PIECE_M along a polyline: { x, z (centre), rot, len (m), ax, ay, bx, by, i (segment), f0, f1 (its ends' shares) }
function pieces(pts, sc) {
    const out = [];
    let along = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y) / sc, n = Math.ceil(len / PIECE_M);
        if (!len) continue;
        for (let k = 0; k < n; k++) {
            const f0 = k / n, f1 = (k + 1) / n, ax = a.x + (b.x - a.x) * f0, ay = a.y + (b.y - a.y) * f0, bx = a.x + (b.x - a.x) * f1, by = a.y + (b.y - a.y) * f1;
            out.push({ x: (ax + bx) / 2, z: (ay + by) / 2, rot: Math.atan2(b.y - a.y, b.x - a.x), len: len / n, ax, ay, bx, by, i, f0, f1, along: along + (len * (f0 + f1)) / 2 });
        }
        along += len;
    }
    return out;
}

// walls: [{ kind, h, fence, pts: [{ x, y }] }] (world units) → { 'kind:piece': [{ x, z, y0, h, len?, rot, along, wall }] }
// (y0, h world units; len metres; rot radians in the x-z plane)
export function barrierPlacements(walls, sc, { ground, road }) {
    const out = {}, put = (name, q) => (out[name] ||= []).push(q);
    walls.forEach((w, wi) => {
        // the road's height looked up once per barrier point (a whole-track search each), in between interpolated
        const R = w.pts.map((q) => road(q.x, q.y)), r = (i, f) => R[i] + (R[i + 1] - R[i]) * f;
        const lo = (x, y, i, f) => Math.min(ground(x, y), r(i, f)) - SINK_M * sc, hi = (x, y, i, f) => Math.max(ground(x, y), r(i, f));
        const h = (w.h || 1) * sc, kind = { armco: 'armco', tyres: 'tyres', tecpro: 'tecpro' }[w.kind] || 'concrete';
        for (const p of pieces(w.pts, sc)) {
            const y0 = Math.min(lo(p.ax, p.ay, p.i, p.f0), lo(p.bx, p.by, p.i, p.f1)), t = Math.max(hi(p.ax, p.ay, p.i, p.f0), hi(p.bx, p.by, p.i, p.f1)) + h;
            if (kind === 'concrete') put('concrete:block', { x: p.x, z: p.z, y0, h: t - y0, len: p.len, rot: p.rot, along: p.along, wall: wi });
            if (kind === 'armco') for (const r of ARMCO.rails) put('armco:rail', { x: p.x, z: p.z, y0: t - h + r * sc, h: ARMCO.rail * sc, len: p.len, rot: p.rot, along: p.along, wall: wi });
            if (w.fence > (w.h || 1)) put('fence:mesh', { x: p.x, z: p.z, y0: t, h: (w.fence - (w.h || 1)) * sc, len: p.len, rot: p.rot, along: p.along, wall: wi });
        }
        if (kind === 'armco') walk(w.pts, sc, ARMCO.post, (x, y, rot, along, i, f) => { const y0 = lo(x, y, i, f); put('armco:post', { x, z: y, y0, h: hi(x, y, i, f) + h - y0, rot, along, wall: wi }); });
        if (kind === 'tyres') walk(w.pts, sc, TYRE.every, (x, y, rot, along, i, f) => { const y0 = lo(x, y, i, f); put('tyres:stack', { x, z: y, y0, h: hi(x, y, i, f) + h - y0, rot, along, wall: wi }); });
        if (kind === 'tecpro') walk(w.pts, sc, TECPRO.len, (x, y, rot, along, i, f) => put('tecpro:block', { x, z: y, y0: hi(x, y, i, f), h: TECPRO.tall * sc, len: TECPRO.len, rot, along, wall: wi, alt: Math.round(along / TECPRO.len) % 2 }));
        if (w.fence > (w.h || 1)) walk(w.pts, sc, FENCE_POST_M, (x, y, rot, along, i, f) => { const y0 = lo(x, y, i, f); put('fence:post', { x, z: y, y0, h: hi(x, y, i, f) + w.fence * sc - y0, rot, along, wall: wi }); });
    });
    return out;
}

// A quad strip of pieces as one mesh (blocks: boxes with world-scale UVs in metres; fence: one vertical face per piece)
function mergedBoxes(list, sc, deep, uvM) {
    const pos = [], uv = [], idx = [];
    for (const q of list) {
        const c = Math.cos(q.rot), s = Math.sin(q.rot), hl = (q.len * sc) / 2, hd = (deep * sc) / 2;
        const corner = (u, d, y) => [q.x + c * u - s * d, y, q.z + s * u + c * d];
        const face = (p, uvs) => { const b = pos.length / 3; p.forEach((v) => pos.push(...v)); uvs.forEach((v) => uv.push(...v)); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
        const L = q.len / uvM, H = q.h / sc / uvM, D = deep / uvM, y0 = q.y0, y1 = q.y0 + q.h;
        if (deep) {
            face([corner(-hl, -hd, y0), corner(hl, -hd, y0), corner(hl, -hd, y1), corner(-hl, -hd, y1)], [[0, 0], [L, 0], [L, H], [0, H]]);
            face([corner(hl, hd, y0), corner(-hl, hd, y0), corner(-hl, hd, y1), corner(hl, hd, y1)], [[0, 0], [L, 0], [L, H], [0, H]]);
            face([corner(-hl, hd, y1), corner(-hl, -hd, y1), corner(hl, -hd, y1), corner(hl, hd, y1)], [[0, 0], [D, 0], [D, L], [0, L]]); // top
            face([corner(-hl, hd, y0), corner(-hl, -hd, y0), corner(-hl, -hd, y1), corner(-hl, hd, y1)], [[0, 0], [D, 0], [D, H], [0, H]]); // ends
            face([corner(hl, -hd, y0), corner(hl, hd, y0), corner(hl, hd, y1), corner(hl, -hd, y1)], [[0, 0], [D, 0], [D, H], [0, H]]);
        } else face([corner(-hl, 0, y0), corner(hl, 0, y0), corner(hl, 0, y1), corner(-hl, 0, y1)], [[q.along / uvM - L / 2, 0], [q.along / uvM + L / 2, 0], [q.along / uvM + L / 2, H], [q.along / uvM - L / 2, H]]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

// One instanced batch: unit geometry (base at y = 0) scaled per piece
function batch(geo, mat, list, size, color) {
    const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D();
    list.forEach((q, i) => {
        o.position.set(q.x, q.y0, q.z);
        o.rotation.set(0, -q.rot, 0);
        o.scale.set(...size(q));
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (color) m.setColorAt(i, color(q));
    });
    m.castShadow = m.receiveShadow = true;
    return m;
}

// textures: trackMaterials.js loadTrackTextures (concrete, fence); heights: { ground, road }
export function buildBarriers(walls, textures, sc, heights) {
    const P = barrierPlacements(walls, sc, heights), g = new THREE.Group(), tex = (name, map) => textures?.[name]?.[map] || null;
    const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    if (P['concrete:block']) {
        const m = new THREE.Mesh(mergedBoxes(P['concrete:block'], sc, CONCRETE_DEEP_M, textures?.concrete?.sizeM?.[0] || 2),
            new THREE.MeshStandardMaterial({ color: 0xd8d4cc, map: tex('concrete', 'diff'), normalMap: tex('concrete', 'nor'), roughnessMap: tex('concrete', 'rough'), roughness: 1 }));
        m.castShadow = m.receiveShadow = true;
        g.add(m);
    }
    if (P['armco:rail']) {
        const m = new THREE.Mesh(mergedBoxes(P['armco:rail'], sc, ARMCO.depth, 1), new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.8, roughness: 0.35 }));
        m.castShadow = m.receiveShadow = true;
        g.add(m);
    }
    if (P['armco:post']) g.add(batch(unitBox, new THREE.MeshStandardMaterial({ color: 0x6b7077, metalness: 0.6, roughness: 0.5 }), P['armco:post'], (q) => [0.15 * sc, q.h, 0.15 * sc]));
    if (P['tyres:stack']) { // a stack of tyres, 1 unit tall (scaled to the stack's height): open sides, a cap on top
        const n = Math.round(1 / TYRE.tall), one = (k) => new THREE.CylinderGeometry(TYRE.r * sc, TYRE.r * sc * 0.97, 0.92 / n, 9, 1, true).translate(0, (k + 0.5) / n, 0);
        const stack = mergeGeometries([...Array.from({ length: n }, (_, k) => one(k)), new THREE.CircleGeometry(TYRE.r * sc * 0.97, 9).rotateX(-Math.PI / 2).translate(0, 1 - 0.04 / n, 0)].map((q) => q.toNonIndexed()));
        g.add(batch(stack, new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.92, side: THREE.DoubleSide }), P['tyres:stack'], (q) => [1, q.h, 1]));
    }
    if (P['tecpro:block']) { // colours unconfirmed per circuit
        const blue = new THREE.Color('#2b5cab'), red = new THREE.Color('#c0392b');
        g.add(batch(unitBox, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), P['tecpro:block'], (q) => [TECPRO.len * sc * 0.98, q.h, TECPRO.deep * sc], (q) => (q.alt ? red : blue)));
    }
    if (P['fence:mesh']) {
        const m = new THREE.Mesh(mergedBoxes(P['fence:mesh'], sc, 0, textures?.fence?.sizeM?.[0] || 2), new THREE.MeshStandardMaterial({
            color: 0xd8dde2, map: tex('fence', 'diff'), alphaMap: tex('fence', 'alpha'), alphaTest: 0.5, transparent: !tex('fence', 'alpha'), opacity: tex('fence', 'alpha') ? 1 : 0.22,
            side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5,
        }));
        g.add(m);
    }
    if (P['fence:post']) g.add(batch(unitBox, new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.5 }), P['fence:post'], (q) => [0.1 * sc, q.h, 0.1 * sc]));
    return g;
}
