// The circuit's barriers as polylines where they really stand (build data), hashed into a grid so a car tests only the
// few segments near it. Shared by the server and the client's predictor (drive.js).
import Physics from './physics.js';

const CELL_M = 20, REACH_M = 4; // grid cell; a car's box reaches under 3 m from its origin

// walls: [{ kind, pts: [{ x, y }], level?: { i } }] (world units). Each cell lists [wall, segment] pairs in wall order
export function wallIndex(walls, scale) {
    const cell = CELL_M * scale, cells = new Map();
    walls.forEach((w, k) => {
        for (let i = 0; i + 1 < w.pts.length; i++) {
            const a = w.pts[i], b = w.pts[i + 1];
            for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= Math.floor(Math.max(a.x, b.x) / cell); cx++)
                for (let cy = Math.floor(Math.min(a.y, b.y) / cell); cy <= Math.floor(Math.max(a.y, b.y) / cell); cy++) {
                    const key = cx * 100003 + cy;
                    if (!cells.has(key)) cells.set(key, []);
                    cells.get(key).push(k, i);
                }
        }
    });
    return { walls, cell, cells, scale };
}

// Segments in the cells a box touches: Map wall → sorted segment indices (each once)
function near(index, x0, y0, x1, y1, pad) {
    const { cell, cells } = index, out = new Map();
    for (let cx = Math.floor((Math.min(x0, x1) - pad) / cell); cx <= Math.floor((Math.max(x0, x1) + pad) / cell); cx++)
        for (let cy = Math.floor((Math.min(y0, y1) - pad) / cell); cy <= Math.floor((Math.max(y0, y1) + pad) / cell); cy++) {
            const list = cells.get(cx * 100003 + cy);
            if (!list) continue;
            for (let q = 0; q < list.length; q += 2) {
                let s = out.get(list[q]);
                if (!s) out.set(list[q], (s = new Set()));
                s.add(list[q + 1]);
            }
        }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([k, s]) => [index.walls[k], [...s].sort((a, b) => a - b)]);
}

// The move (x0, y0) → (p.x, p.y) against every wall near it, wall by wall as drive.js always did: a crossed segment
// undoes the move, then the car's box is pushed out of the segment it pokes deepest into. accept(wall): which walls
// apply to this car (a bridge's walls only to cars on that level). Returns whether anything was hit
export function collideWalls(p, x0, y0, index, scale, accept = null) {
    let hit = false;
    for (const [w, segs] of near(index, x0, y0, p.x, p.y, REACH_M * scale)) {
        if (accept && !accept(w)) continue;
        for (const i of segs) {
            const cross = Physics.crossWall(x0, y0, p.x, p.y, [w.pts[i], w.pts[i + 1]]);
            if (cross) { p.x = x0 + cross.nx * 0.5; p.y = y0 + cross.ny * 0.5; Physics.bounce(p, cross.nx, cross.ny); hit = true; break; }
        }
        let best = null;
        for (const i of segs) {
            const ov = Physics.wallOverlap(p, [w.pts[i], w.pts[i + 1]], scale);
            if (ov && (!best || ov.depth > best.depth)) best = ov;
        }
        if (best) { p.x += best.nx * best.depth; p.y += best.ny * best.depth; Physics.bounce(p, best.nx, best.ny); hit = true; }
    }
    return hit;
}

// Distance from (x, y) along unit (nx, ny) to the first wall, Infinity if none within maxDist
export function rayToWall(index, x, y, nx, ny, maxDist) {
    let best = Infinity;
    const step = index.cell / 2;
    for (let d = 0; d < maxDist && d < best; d += step) {
        const ax = x + nx * d, ay = y + ny * d, bx = x + nx * Math.min(maxDist, d + step), by = y + ny * Math.min(maxDist, d + step);
        for (const [w, segs] of near(index, ax, ay, bx, by, 0)) for (const i of segs) {
            const a = w.pts[i], b = w.pts[i + 1], ex = b.x - a.x, ey = b.y - a.y, den = nx * ey - ny * ex;
            if (!den) continue;
            const t = ((a.x - x) * ey - (a.y - y) * ex) / den, u = ((a.x - x) * ny - (a.y - y) * nx) / den;
            if (t >= 0 && t <= maxDist && u >= 0 && u <= 1) best = Math.min(best, t);
        }
    }
    return best;
}
