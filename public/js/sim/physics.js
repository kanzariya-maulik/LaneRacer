// Collision box = car.glb from front wing tip (+2.92 m) to rear wing (−2.56 m), wheel to wheel (±0.98 m).
// Its middle sits ahead of the car's origin (between the axles), so the box is offset forward.
const CAR_HALF_LENGTH_M = 2.74;
const CAR_CENTER_OFFSET_M = 0.18;
const CAR_HALF_WIDTH_M = 1.0;
const RESTITUTION = 0.3;
const HINT_SPAN = 10; // segments (~100 m) either side of a car's last road point

class Physics {
    // ponytail: linear scan over all segments; add a grid/spatial index if 20-car ticks get slow
    static getDistanceFromTrack(x, y, track) {
        // Find distance to the closest track segment
        let minDistance = Infinity;
        
        // Track.path is an array of points creating a loop
        const path = track.path;
        
        for (let i = 0; i < path.length; i++) {
            const p1 = path[i];
            const p2 = path[(i + 1) % path.length];
            
            // Distance from point to line segment
            const dist = this.distToSegmentSquared({x, y}, p1, p2);
            if (dist < minDistance) {
                minDistance = dist;
            }
        }
        
        return Math.sqrt(minDistance);
    }

    static distToSegmentSquared(p, v, w) {
        const l2 = this.distSquared(v, w);
        if (l2 === 0) return this.distSquared(p, v);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return this.distSquared(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
    }

    static distSquared(v, w) {
        return (v.x - w.x)*(v.x - w.x) + (v.y - w.y)*(v.y - w.y);
    }

    // Nearest point on a polyline; closed = the last point joins back to the first
    static nearestOnPath(x, y, path, closed = true) {
        const n = closed ? path.length : path.length - 1;
        let best = { d2: Infinity, px: x, py: y, i: 0, t: 0 };
        for (let i = 0; i < n; i++) {
            const v = path[i], w = path[(i + 1) % path.length];
            const l2 = this.distSquared(v, w);
            let t = l2 ? ((x - v.x) * (w.x - v.x) + (y - v.y) * (w.y - v.y)) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = v.x + t * (w.x - v.x), py = v.y + t * (w.y - v.y);
            const d2 = (x - px) ** 2 + (y - py) ** 2;
            if (d2 < best.d2) best = { d2, px, py, i, t };
        }
        return { dist: Math.sqrt(best.d2), px: best.px, py: best.py, i: best.i, t: best.t };
    }

    // hint: the segment this car was on last tick; then only the ~200 m around it is searched (a car moves ~1.5 m a tick),
    // with the full search as the fallback when it's not there (a reset, a teleport)
    static nearestOnTrack(x, y, track, hint) {
        const P = track.path, n = P.length;
        if (hint === undefined || hint === null || n < 2 * HINT_SPAN) return this.nearestOnPath(x, y, P);
        let bd2 = Infinity, bi = 0, bt = 0, bx = x, by = y;
        for (let k = -HINT_SPAN; k <= HINT_SPAN; k++) {
            const i = (((hint + k) % n) + n) % n, v = P[i], w = P[(i + 1) % n], ex = w.x - v.x, ey = w.y - v.y, l2 = ex * ex + ey * ey;
            const t = l2 ? Math.max(0, Math.min(1, ((x - v.x) * ex + (y - v.y) * ey) / l2)) : 0, px = v.x + t * ex, py = v.y + t * ey;
            const d2 = (x - px) ** 2 + (y - py) ** 2;
            if (d2 < bd2) { bd2 = d2; bi = i; bt = t; bx = px; by = py; }
        }
        if (Math.sqrt(bd2) > track.width * 3) return this.nearestOnPath(x, y, P);
        return { dist: Math.sqrt(bd2), px: bx, py: by, i: bi, t: bt };
    }

    // First wall segment the move a→b crosses; n points back to a's side
    static crossWall(ax, ay, bx, by, wall) {
        for (let i = 0; i + 1 < wall.length; i++) {
            const p = wall[i], q = wall[i + 1];
            const ex = q.x - p.x, ey = q.y - p.y;
            const sa = ex * (ay - p.y) - ey * (ax - p.x);
            const sb = ex * (by - p.y) - ey * (bx - p.x);
            if (sa === 0 || sa * sb > 0) continue;
            const fx = bx - ax, fy = by - ay;
            if ((fx * (p.y - ay) - fy * (p.x - ax)) * (fx * (q.y - ay) - fy * (q.x - ax)) > 0) continue;
            const k = (sa > 0 ? 1 : -1) / (Math.hypot(ex, ey) || 1);
            return { nx: -ey * k, ny: ex * k };
        }
        return null;
    }

    // How far the car's box reaches from its origin along unit normal n (rectangle support distance, box offset forward)
    static carReach(car, nx, ny, scale) {
        const fx = Math.cos(car.angle), fy = Math.sin(car.angle), along = fx * nx + fy * ny;
        return scale * (CAR_HALF_LENGTH_M * Math.abs(along) + CAR_HALF_WIDTH_M * Math.abs(-fy * nx + fx * ny) + CAR_CENTER_OFFSET_M * along);
    }

    // Car rectangle against a wall polyline: deepest poke-through and the way out (n from wall to car)
    static wallOverlap(car, wall, scale) {
        let best = null;
        for (let i = 0; i + 1 < wall.length; i++) {
            const a = wall[i], b = wall[i + 1], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
            if (!l2) continue;
            const t = Math.max(0, Math.min(1, ((car.x - a.x) * ex + (car.y - a.y) * ey) / l2));
            const dx = car.x - (a.x + t * ex), dy = car.y - (a.y + t * ey), d = Math.hypot(dx, dy);
            if (d < 1e-9) continue;
            const nx = dx / d, ny = dy / d, depth = this.carReach(car, -nx, -ny, scale) - d; // box reach toward the wall
            if (depth > 0 && (!best || depth > best.depth)) best = { nx, ny, depth };
        }
        return best;
    }

    // Separating-axis test for two oriented car rectangles; normal points from b to a
    static carOverlap(a, b, scale) {
        const hl = CAR_HALF_LENGTH_M * scale, hw = CAR_HALF_WIDTH_M * scale, off = CAR_CENTER_OFFSET_M * scale;
        const dx = a.x + Math.cos(a.angle) * off - (b.x + Math.cos(b.angle) * off);
        const dy = a.y + Math.sin(a.angle) * off - (b.y + Math.sin(b.angle) * off); // between box centres
        const reach = 2 * Math.hypot(hl, hw); // ~6 m: further apart can't touch
        if (dx * dx + dy * dy > reach * reach) return null;
        const radius = (c, n) => {
            const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
            return hl * Math.abs(fx * n.x + fy * n.y) + hw * Math.abs(-fy * n.x + fx * n.y);
        };
        let best = null;
        for (const c of [a, b]) {
            const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
            for (const n of [{ x: fx, y: fy }, { x: -fy, y: fx }]) {
                const dist = dx * n.x + dy * n.y;
                const depth = radius(a, n) + radius(b, n) - Math.abs(dist);
                if (depth <= 0) return null;
                if (!best || depth < best.depth) {
                    const s = dist < 0 ? -1 : 1;
                    best = { nx: n.x * s, ny: n.y * s, depth };
                }
            }
        }
        return best;
    }

    static resolveCarCollision(a, b, scale) {
        const hit = this.carOverlap(a, b, scale);
        if (!hit) return false;
        const { nx, ny, depth } = hit;
        a.x += (nx * depth) / 2; a.y += (ny * depth) / 2;
        b.x -= (nx * depth) / 2; b.y -= (ny * depth) / 2;
        const vRel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vRel < 0) { // closing: equal masses swap part of their speed along the normal
            const j = (-(1 + RESTITUTION) * vRel) / 2;
            a.vx += j * nx; a.vy += j * ny;
            b.vx -= j * nx; b.vy -= j * ny;
        }
        return true;
    }
}

Physics.CAR_HALF_LENGTH_M = CAR_HALF_LENGTH_M;
Physics.CAR_HALF_WIDTH_M = CAR_HALF_WIDTH_M;
Physics.CAR_CENTER_OFFSET_M = CAR_CENTER_OFFSET_M;

export default Physics;
