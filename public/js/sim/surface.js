// What the ground is beyond the road: a 0.5 m grid painted from the circuit's surface polygons (the build data).
// Shared: the server and the client's predictor rasterize the same polygons the same way, so both feel the same gravel,
// and the renderer splats its textures from the same grid (what is drawn is what is driven).
import { C } from './carphysics.js';

export const KINDS = ['grass', 'road', 'kerb', 'asphalt', 'paint', 'astroturf', 'gravel']; // grid values; 0 = default grass
export const CELL_M = 0.5;

// How each surface grips: null = the tyre's own grip (asphalt of any kind, kerbs, painted run-off, artificial grass)
export const GRIP = {
    road: null, kerb: null, asphalt: null, paint: null, astroturf: null,
    grass: { mu: C.GRASS_MU, drag: C.GRASS_DRAG, driveG: C.GRASS_DRIVE_G },
    gravel: { mu: C.GRAVEL_MU, drag: C.GRAVEL_DRAG, driveG: C.GRAVEL_DRIVE_G },
};

// surfaces: [{ kind, poly: [{ x, y }] }] in world units, painted in order (later wins); bounds: world units.
// A cell takes a polygon's kind when its centre is inside it (even-odd); each edge is taken lowest point first, so the
// crossings are the same numbers whichever way the polygon winds
export function rasterize(surfaces, bounds, scale) {
    const cell = CELL_M * scale, x0 = Math.floor(bounds.minX / cell) * cell, y0 = Math.floor(bounds.minY / cell) * cell;
    const w = Math.ceil((bounds.maxX - x0) / cell), h = Math.ceil((bounds.maxY - y0) / cell), data = new Uint8Array(w * h);
    const xs = [];
    for (const s of surfaces) {
        const v = KINDS.indexOf(s.kind), P = s.poly;
        if (v < 0) throw new Error(`unknown surface ${s.kind}`);
        let lo = Infinity, hi = -Infinity;
        for (const p of P) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
        for (let j = Math.max(0, Math.floor((lo - y0) / cell)); j < Math.min(h, Math.ceil((hi - y0) / cell)); j++) {
            const y = y0 + (j + 0.5) * cell;
            xs.length = 0;
            for (let i = 0; i < P.length; i++) {
                let a = P[i], b = P[(i + 1) % P.length];
                if (a.y > b.y || (a.y === b.y && a.x > b.x)) [a, b] = [b, a];
                if (a.y <= y && y < b.y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
            }
            xs.sort((p, q) => p - q);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const from = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), to = Math.min(w, Math.ceil((xs[k + 1] - x0) / cell - 0.5));
                data.fill(v, j * w + from, j * w + Math.max(from, to));
            }
        }
    }
    return { x0, y0, w, h, cell, data };
}

export function surfaceAt(grid, x, y) {
    const i = Math.floor((x - grid.x0) / grid.cell), j = Math.floor((y - grid.y0) / grid.cell);
    return i < 0 || j < 0 || i >= grid.w || j >= grid.h ? 'grass' : KINDS[grid.data[j * grid.w + i]];
}
