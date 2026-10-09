// Test driver that follows a track's racing line through the real Game loop.
// Limits: a bot, not an ideal driver. It steers by pure pursuit (a chord to a point ahead cuts a little inside the line)
// and corrects speed proportionally a moment late, so it ends up a few % off the flying-lap profile.
const Track = require('../../src/game/Track');
const RL = require('../../src/game/RacingLine');
const Game = require('../../src/game/Game');
const Physics = require('../../src/game/Physics');
const { C, parseAssist } = require('../../src/game/CarPhysics');
const { KERB_M } = require('../../public/js/sim/drive.js');

const quietIo = { emit() {}, volatile: { emit() {} } };
let tracks = null;
const trackOf = (t) => (typeof t === 'string' ? (tracks ||= Track.loadAll())[t] : t);

// driver 'limit': throttle/brake to aim × the line's speed; 'flat': throttle 1, never brakes (for braking-help tests).
// flying: time lap 2 (rolling start), to compare with the flying-lap profile; otherwise lap 1 from the grid.
// worn: tyres fully worn all lap. offsetM: follow the line moved this far to the driver's right.
function driveLap(track, assist, { driver = 'limit', aim = 1.0, offsetM = 0, worn = false, flying = true } = {}) {
    const t = trackOf(track), sc = t.scale, rl = t.racingLine, n = t.path.length;
    const L = RL.linePoints(t.path, rl.offset.map((o) => o + offsetM * sc));
    const k = RL.curvatures(L, sc), steerHelp = parseAssist(assist).steer;
    const g = new Game(quietIo, [{ id: 'a', username: 'A', teamId: 'redbull', assist }], t,
        { maxLaps: flying ? 2 : 1, qualifying: false, tyreWear: worn }, () => {});
    g.frozen = false;
    const p = g.players.a;
    const d2 = (i) => (L[i].x - p.x) ** 2 + (L[i].y - p.y) ** 2;
    let i = 0;
    for (let q = 1; q < n; q++) if (d2(q) < d2(i)) i = q;
    let time = 0, off = 0, walls = 0;
    while (time < 400 && !p.finished) {
        if (worn) p.wear = 1;
        while (d2((i + 1) % n) < d2(i)) i = (i + 1) % n; // nearest line point, followed forward
        const v = p.speed / sc;
        // Pure pursuit: aim at the line 0.3 s ahead (at least 8 m), steer onto the arc through it
        const look = Math.max(8, 0.3 * v) * sc;
        let j = i;
        while (Math.sqrt(d2(j)) < look) j = (j + 1) % n;
        const h = (j - 1 + n) % n, dh = Math.sqrt(d2(h)), dj = Math.sqrt(d2(j)), f = dj > dh ? Math.max(0, (look - dh) / (dj - dh)) : 1;
        const dx = L[h].x + f * (L[j].x - L[h].x) - p.x, dy = L[h].y + f * (L[j].y - L[h].y) - p.y, ld = Math.hypot(dx, dy) / sc;
        const alpha = Math.atan2(Math.sin(Math.atan2(dy, dx) - p.angle), Math.cos(Math.atan2(dy, dx) - p.angle));
        const wheel = Math.atan((C.WHEELBASE * 2 * Math.sin(alpha)) / ld);
        // Full lock as carphysics computes it: the steering help adds lock at low speed, grip caps it at speed
        const grip = C.MU * (p.tyreGrip ?? 1) * (C.MASS * C.G + 0.5 * C.RHO * C.CLA * v * v);
        const blend = Math.max(0, Math.min(1, (C.ASSIST_OFF_KMH - v * 3.6) / (C.ASSIST_OFF_KMH - C.ASSIST_FULL_KMH)));
        const lock = Math.min(((1 + C.ASSIST_STEER * steerHelp * blend) * C.MAX_STEER) / (1 + v / C.STEER_FADE),
            Math.atan((C.WHEELBASE * (C.LAT_ASSIST * grip / C.MASS) * C.YAW_ASSIST) / Math.max(v * v, 1)));
        const steer = Math.max(-1, Math.min(1, wheel / lock));
        // Speed: the line's speed a short way ahead, so braking starts in time
        const target = aim * rl.speed[(i + 2) % n];
        // Friction circle (as carphysics): leave the cornering grip the line needs here, use the rest to drive or brake
        const spare = grip * Math.sqrt(Math.max(0, 1 - ((v * v * k[i] * C.MASS) / (C.LAT_ASSIST * grip)) ** 2));
        const throttle = Math.min((target - v) / 2, spare / Math.min(C.POWER / Math.max(v, 1), C.TRACTION * grip));
        const brake = Math.min((v - target) / 2, spare / ((1 - C.BRAKE_STEER_GIVE * Math.abs(steer)) * grip));
        p.input = driver === 'flat' ? { steer, throttle: 1, brake: 0 }
            : { steer, throttle: Math.max(0, Math.min(1, throttle)), brake: Math.max(0, Math.min(1, brake)) };
        const v0 = p.speed;
        g.update();
        time += g.dt;
        const near = Physics.nearestOnTrack(p.x, p.y, t, p.roadI);
        if (!p.inPit && near.dist > t.width / 2 + KERB_M * sc) off++;
        if (v0 / sc > 15 && p.speed < v0 * 0.7 && !p.finished) walls++; // finishing parks the car, not a wall
    }
    return { time: !p.finished ? Infinity : flying ? p.lastLap : time, off, walls, finished: p.finished };
}

module.exports = { driveLap };
