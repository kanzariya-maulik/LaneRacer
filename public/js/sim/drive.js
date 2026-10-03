// The car's own motion for one tick: assist, tyres, pit wall, barriers, pit lane limiter.
// Shared: the server runs it for every car, the browser runs it to predict its own car.
import { C, step } from './carphysics.js';
import Physics from './physics.js';
import { brakeAssist } from './assist.js';

export const WALL_OFFSET = 80;     // world units past the track edge; Track.js checkpoints use the same
export const PIT_RUNOFF_M = 2;     // barrier this far outside the pit lane edge
export const KERB_M = 1.5;         // kerbs past the track edge drive like asphalt
export const PIT_LIMIT_KMH = 80;
export const DRS_DRAG = 0.78;      // drag with the flap open (~+29 km/h top speed)

// Distance along the pit lane of a nearestOnPath result
export const pitAlong = (pit, n) => pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);

// Barrier response: n points from the barrier back toward the car
export function bounce(p, nx, ny) {
    const vn = -(p.vx * nx + p.vy * ny); // speed into the barrier
    const v = Math.hypot(p.vx, p.vy);
    if (vn > 0) { p.vx += vn * nx; p.vy += vn * ny; }
    // Speed loss scales with how square-on the hit is: head-on keeps WALL_KEEP, a graze keeps almost all
    const impact = v > 0 ? Math.max(0, vn) / v : 0;
    const keep = 1 - (1 - C.WALL_KEEP) * impact;
    p.vx *= keep;
    p.vy *= keep;
    p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
}

// In the pit lane = on pit asphalt and off the track's (where they overlap, it's track); limiter caps speed
export function updatePitState(p, t, near, nearPit) {
    const pit = t.pit;
    p.pitS = pitAlong(pit, nearPit);
    p.inPit = nearPit.dist <= pit.width / 2 && near.dist > t.width / 2 && p.pitS >= pit.closeS; // closed entry isn't pit lane
    p.limiter = p.inPit && p.pitS >= pit.limStart && p.pitS <= pit.limEnd;
    if (p.limiter) {
        const max = (PIT_LIMIT_KMH / 3.6) * t.scale, v = Math.hypot(p.vx, p.vy);
        if (v > max) {
            p.vx *= max / v;
            p.vy *= max / v;
            p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
        }
    }
}

export function driveCar(p, input, t, dt) {
    const scale = t.scale, pit = t.pit;
    const x0 = p.x, y0 = p.y;
    const nearPit = (x, y) => (pit ? Physics.nearestOnPath(x, y, pit.path, false) : null);
    const before = Physics.nearestOnTrack(p.x, p.y, t), beforePit = nearPit(p.x, p.y);
    const grass = before.dist > t.width / 2 + KERB_M * scale && !(beforePit && beforePit.dist <= pit.width / 2 && pitAlong(pit, beforePit) >= pit.closeS);
    const aMode = p.assist ? String(p.assist).toLowerCase() : 'full';
    const isNumAssist = aMode.includes(',') && parseInt(aMode.split(',')[1] || '0', 10) > 0;
    const hasBrakeAssist = (aMode === 'full' || aMode === 'high' || aMode === 'medium' || aMode === 'brake' || isNumAssist) && !p.inPit;
    const used = hasBrakeAssist ? brakeAssist(p, input, t, before, p.assist) : input;
    p.dragMul = (p.drs ? DRS_DRAG : 1) * (1 - (p.tow || 0));
    step(p, used, dt, scale, grass, p.assist);

    // Pit wall: a move across it is undone
    const hit = pit && (Physics.crossWall(x0, y0, p.x, p.y, pit.wall) || Physics.crossWall(x0, y0, p.x, p.y, pit.closeWall));
    if (hit) {
        p.x = x0 + hit.nx * 0.5;
        p.y = y0 + hit.ny * 0.5;
        bounce(p, hit.nx, hit.ny);
    }
    // …and the pit entry barrier stops the whole car body, not just its centre
    // ponytail: the pit wall stays centre-only — on the 1.5×-wide tracks it sits ~0.6 m past the line, inside the kerb
    const o = pit && Physics.wallOverlap(p, pit.closeWall, scale);
    if (o) { p.x += o.nx * o.depth; p.y += o.ny * o.depth; bounce(p, o.nx, o.ny); }

    // Barrier: outside both the track's run-off and the pit lane's
    const wallDist = t.width / 2 + WALL_OFFSET;
    const pitDist = pit && pit.width / 2 + PIT_RUNOFF_M * scale;
    const after = Physics.nearestOnTrack(p.x, p.y, t), afterPit = nearPit(p.x, p.y);
    // The pit lane upstream of the closure barrier is off-limits (no pit stops)
    const afterS = afterPit && pitAlong(pit, afterPit);
    const overTrack = after.dist - wallDist, overPit = afterPit && afterS >= pit.closeS ? afterPit.dist - pitDist : Infinity;
    if (overTrack > 0 && overPit > 0) {
        const [near, lim] = overPit < overTrack ? [afterPit, pitDist] : [after, wallDist];
        const nx = (p.x - near.px) / near.dist, ny = (p.y - near.py) / near.dist;
        p.x = near.px + nx * (lim - 1);
        p.y = near.py + ny * (lim - 1);
        bounce(p, -nx, -ny);
    }
    // Barrier stops the car body: pull the centre in by how far the rectangle reaches toward it
    const edge = Physics.nearestOnTrack(p.x, p.y, t), edgePit = nearPit(p.x, p.y);
    const reach = (n) => n.dist > 1e-9 ? Physics.carReach(p, (p.x - n.px) / n.dist, (p.y - n.py) / n.dist, scale) : 0;
    const inTrack = edge.dist + reach(edge) <= wallDist;
    const inPitLane = edgePit && pitAlong(pit, edgePit) >= pit.closeS && edgePit.dist + reach(edgePit) <= pitDist;
    if (!inTrack && !inPitLane && edge.dist <= wallDist && !(edgePit && edgePit.dist <= pitDist && pitAlong(pit, edgePit) >= pit.closeS)) {
        const nx = (p.x - edge.px) / edge.dist, ny = (p.y - edge.py) / edge.dist;
        const lim = wallDist - reach(edge);
        p.x = edge.px + nx * lim; p.y = edge.py + ny * lim;
        bounce(p, -nx, -ny);
    }

    if (pit) updatePitState(p, t, after, afterPit);

    if ([p.x, p.y, p.vx, p.vy, p.angle].every(Number.isFinite)) {
        p.lastSafeX = p.x;
        p.lastSafeY = p.y;
    } else {
        p.x = p.lastSafeX; p.y = p.lastSafeY;
        p.vx = p.vy = p.speed = 0;
        if (!Number.isFinite(p.angle)) p.angle = 0;
    }
    return after;
}
