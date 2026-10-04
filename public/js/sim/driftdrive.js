// Drift car motion for one tick: assist, tires, pit wall, barriers, and dynamic slip.
// Shared between server (authoritative sim) and browser (client-side prediction).
import { C, PROFILES, step } from './driftcarphysics.js';
import Physics from './physics.js';
import { brakeAssist } from './assist.js';

export const WALL_OFFSET = 80;
export const PIT_RUNOFF_M = 2;
export const KERB_M = 1.5;
export const PIT_LIMIT_KMH = 80;
export const BOOST_DRAG = 0.75; // Slingshot / nitrous boost drag reduction

export const pitAlong = (pit, n) => pit.cum[n.i] + n.t * (pit.cum[n.i + 1] - pit.cum[n.i]);

export function bounce(p, nx, ny) {
    const vn = -(p.vx * nx + p.vy * ny);
    const v = Math.hypot(p.vx, p.vy);
    if (vn > 0) { p.vx += vn * nx; p.vy += vn * ny; }
    const impact = v > 0 ? Math.max(0, vn) / v : 0;
    const keep = 1 - (1 - C.WALL_KEEP) * impact;
    p.vx *= keep;
    p.vy *= keep;
    p.speed = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
}

export function updatePitState(p, t, near, nearPit) {
    const pit = t.pit;
    p.pitS = pitAlong(pit, nearPit);
    p.inPit = nearPit.dist <= pit.width / 2 && near.dist > t.width / 2 && p.pitS >= pit.closeS;
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

export function driveDriftCar(p, input, t, dt, profileKey = 'tuner') {
    const scale = t.scale, pit = t.pit;
    const x0 = p.x, y0 = p.y;
    const nearPit = (x, y) => (pit ? Physics.nearestOnPath(x, y, pit.path, false) : null);
    const before = Physics.nearestOnTrack(p.x, p.y, t), beforePit = nearPit(p.x, p.y);
    const grass = before.dist > t.width / 2 + KERB_M * scale && !(beforePit && beforePit.dist <= pit.width / 2 && pitAlong(pit, beforePit) >= pit.closeS);
    
    // In Formula-D drift mode, use direct responsive input without F1 circuit brake interference
    const used = { ...input };
    if (input.handbrake) used.handbrake = true;

    p.dragMul = (p.drs ? BOOST_DRAG : 1) * (1 - (p.tow || 0));
    
    step(p, used, dt, scale, grass, p.assist, p.vehicleClass || profileKey);

    // Pit wall collisions
    const hit = pit && (Physics.crossWall(x0, y0, p.x, p.y, pit.wall) || Physics.crossWall(x0, y0, p.x, p.y, pit.closeWall));
    if (hit) {
        p.x = x0 + hit.nx * 0.5;
        p.y = y0 + hit.ny * 0.5;
        bounce(p, hit.nx, hit.ny);
    }
    const o = pit && Physics.wallOverlap(p, pit.closeWall, scale);
    if (o) { p.x += o.nx * o.depth; p.y += o.ny * o.depth; bounce(p, o.nx, o.ny); }

    // Outer barriers
    const wallDist = t.width / 2 + WALL_OFFSET;
    const pitDist = pit && pit.width / 2 + PIT_RUNOFF_M * scale;
    const after = Physics.nearestOnTrack(p.x, p.y, t), afterPit = nearPit(p.x, p.y);
    const afterS = afterPit && pitAlong(pit, afterPit);
    const overTrack = after.dist - wallDist, overPit = afterPit && afterS >= pit.closeS ? afterPit.dist - pitDist : Infinity;
    if (overTrack > 0 && overPit > 0) {
        const [near, lim] = overPit < overTrack ? [afterPit, pitDist] : [after, wallDist];
        const nx = (p.x - near.px) / near.dist, ny = (p.y - near.py) / near.dist;
        p.x = near.px + nx * (lim - 1);
        p.y = near.py + ny * (lim - 1);
        bounce(p, -nx, -ny);
    }
    
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

export const driveCar = driveDriftCar;
