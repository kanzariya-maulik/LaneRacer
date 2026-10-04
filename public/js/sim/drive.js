// The car's own motion for one tick: assist, tyres, pit wall, barriers, pit lane limiter.
// Shared: the server runs it for every car, the browser runs it to predict its own car.
import { C, step } from './carphysics.js';
import Physics from './physics.js';
import { brakeAssist } from './assist.js';
import { slopeAt, roadAt } from './elevation.js';

export const WALL_OFFSET = 80;     // world units past the track edge, unless the track sets wallOffset; Track.js uses the same
export const PIT_RUNOFF_M = 2;     // barrier this far outside the pit lane edge
export const KERB_M = 1.5;         // kerbs past the track edge drive like asphalt
export const PIT_LIMIT_KMH = 80;    // unless the circuit sets its own (circuits.json pitLimitKmh: Zandvoort 60)
export const DRS_DRAG = 0.78;      // drag with the flap open (~+29 km/h top speed)
const BRIDGE_ROAD = 6;             // points either side of a bridge wall's own road that it applies to

// Is (x, y) within reach of the pit lane (its bounding box, grown by the barrier distance)? Cached per pit lane
const pitBoxes = new WeakMap(), FAR_PIT = { dist: Infinity, px: 0, py: 0, i: 0, t: 0 };
function nearPitBox(pit, x, y) {
    let b = pitBoxes.get(pit);
    if (!b) {
        const m = pit.width * 2 + 200; // world units: well past the pit barrier
        b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const q of pit.path) { b.x0 = Math.min(b.x0, q.x - m); b.y0 = Math.min(b.y0, q.y - m); b.x1 = Math.max(b.x1, q.x + m); b.y1 = Math.max(b.y1, q.y + m); }
        pitBoxes.set(pit, b);
    }
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

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
        const max = ((pit.limitKmh || PIT_LIMIT_KMH) / 3.6) * t.scale, v = Math.hypot(p.vx, p.vy);
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
    // The pit lane only matters near it: elsewhere a far-away answer without searching it (3 of these a tick)
    const nearPit = (x, y) => (!pit ? null : nearPitBox(pit, x, y) ? Physics.nearestOnPath(x, y, pit.path, false) : FAR_PIT);
    const before = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), beforePit = nearPit(p.x, p.y);
    const grass = before.dist > t.width / 2 + KERB_M * scale && !(beforePit && beforePit.dist <= pit.width / 2 && pitAlong(pit, beforePit) >= pit.closeS);
    // The road this car is on (followed from last tick, so it keeps its level at a bridge), and how that road climbs
    const road = slopeAt(t, p.x, p.y, p.angle, p.roadI); // hills: gravity, crests and compressions (flat without track z)
    p.grade = road.grade; p.vcurv = road.vcurv;
    if (road.i !== undefined) p.roadI = road.i;
    const used = p.assist === 'full' && !p.inPit ? brakeAssist(p, input, t, before) : input;
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

    // Bridges (Suzuka): parapets on the deck and the walls of the underpass, each only for cars on its own level
    if (t.bridges && t.bridges.length) {
        const mine = (p.roadI = roadAt(t, p.x, p.y, p.angle, p.roadI).i), n = t.path.length;
        for (const b of t.bridges) for (const w of b.walls) {
            const g = Math.abs(w.i - mine);
            if (Math.min(g, n - g) > BRIDGE_ROAD) continue;
            const seg = w.pts, cross = Physics.crossWall(x0, y0, p.x, p.y, seg); // follows the road's curve
            if (cross) { p.x = x0 + cross.nx * 0.5; p.y = y0 + cross.ny * 0.5; bounce(p, cross.nx, cross.ny); }
            const ov = Physics.wallOverlap(p, seg, scale);
            if (ov) { p.x += ov.nx * ov.depth; p.y += ov.ny * ov.depth; bounce(p, ov.nx, ov.ny); }
        }
    }

    // Barrier: outside both the track's run-off and the pit lane's
    const wallDist = t.width / 2 + (t.wallOffset ?? WALL_OFFSET);
    const pitDist = pit && pit.width / 2 + PIT_RUNOFF_M * scale;
    const after = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), afterPit = nearPit(p.x, p.y);
    // The pit lane upstream of the closure barrier is off-limits (no pit stops)
    const afterS = afterPit && pitAlong(pit, afterPit);
    // No barrier where the track opens between two nearby legs (Track.js openWalls: the infield of a hairpin)
    const open = (n) => {
        if (!t.openWall) return false;
        const a = t.path[n.i], b = t.path[(n.i + 1) % t.path.length];
        return !!t.openWall[-(b.y - a.y) * (p.x - n.px) + (b.x - a.x) * (p.y - n.py) > 0 ? 0 : 1][n.i];
    };
    const overTrack = open(after) ? -Infinity : after.dist - wallDist, overPit = afterPit && afterS >= pit.closeS ? afterPit.dist - pitDist : Infinity;
    if (overTrack > 0 && overPit > 0) {
        const [near, lim] = overPit < overTrack ? [afterPit, pitDist] : [after, wallDist];
        const nx = (p.x - near.px) / near.dist, ny = (p.y - near.py) / near.dist;
        p.x = near.px + nx * (lim - 1);
        p.y = near.py + ny * (lim - 1);
        bounce(p, -nx, -ny);
    }
    // Barrier stops the car body: pull the centre in by how far the rectangle reaches toward it
    const edge = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), edgePit = nearPit(p.x, p.y);
    const reach = (n) => n.dist > 1e-9 ? Physics.carReach(p, (p.x - n.px) / n.dist, (p.y - n.py) / n.dist, scale) : 0;
    const inTrack = edge.dist + reach(edge) <= wallDist || open(edge);
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
