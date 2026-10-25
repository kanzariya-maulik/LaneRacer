// A driver that follows a track's racing line at its published speeds, exactly, through the real Game loop: the tests'
// check that the line is drivable, and the calibration's measure of what each corner holds (lineCalibration.js).
// Limits: a bot, not an ideal driver. It steers by pure pursuit (a chord to a point ahead cuts a little inside the line)
// and corrects speed proportionally a moment late, so it ends up a few % off the flying-lap profile.
const Track = require('./Track');
const RL = require('./RacingLine');
const Game = require('./Game');
const Physics = require('./Physics');
const { parseAssist } = require('./CarPhysics');
const { pursue, pedals } = require('./limitControl');

const OFF_LINE_FAIL_M = 4; // on the grip model's lines it strays 0.5-1.5 m (Suzuka 3.2): further, the car isn't driving the line any more
const { surfaceUnder } = require('../../public/js/sim/drive.js');

let tracks = null;
const trackOf = (t) => (typeof t === 'string' ? (tracks ||= Track.loadAll())[t] : t);

// driver 'limit': throttle/brake to aim × the line's speed; 'flat': throttle 1, never brakes (for braking-help tests).
// flying: time lap 2 (rolling start), to compare with the flying-lap profile; otherwise lap 1 from the grid.
// worn: tyres fully worn all lap. attack: the braking help attacking all lap. offsetM: follow the line moved this far to the driver's right. onFail(i): called with the
// line point of each tick off the asphalt, more than OFF_LINE_FAIL_M off the line, or a wall hit.
function driveLap(track, assist, { driver = 'limit', aim = 1.0, offsetM = 0, worn = false, attack = false, flying = true, onFail = null } = {}) {
    const t = trackOf(track), sc = t.scale, rl = t.racingLine, n = t.path.length;
    const L = RL.linePoints(t.path, rl.offset.map((o) => o + offsetM * sc));
    const k = RL.curvatures(L, sc), steerHelp = parseAssist(assist).steer;
    let i = 0, wide = 0; // wide: track-limits warnings (all wheels past the white line), as a player is judged
    const io = { emit: (e, d) => { if (e === 'track_limits' && d.kind === 'wide') { wide++; onFail?.(i); } }, volatile: { emit() {} } };
    const g = new Game(io, [{ id: 'a', username: 'A', teamId: 'redbull', assist }], t,
        { maxLaps: flying ? 2 : 1, qualifying: false, tyreWear: worn }, () => {});
    g.frozen = false;
    const p = g.players.a;
    const d2 = (i) => (L[i].x - p.x) ** 2 + (L[i].y - p.y) ** 2;
    // Distance to the line itself (the segments either side of point i), not to its points: they're ~10 m apart
    const seg = (a, b) => { const ex = L[b].x - L[a].x, ey = L[b].y - L[a].y, u = Math.max(0, Math.min(1, ((p.x - L[a].x) * ex + (p.y - L[a].y) * ey) / Math.max(1e-9, ex * ex + ey * ey)));
        return Math.hypot(L[a].x + u * ex - p.x, L[a].y + u * ey - p.y); };
    const offLine = (i) => Math.min(seg((i - 1 + n) % n, i), seg(i, (i + 1) % n));
    for (let q = 1; q < n; q++) if (d2(q) < d2(i)) i = q;
    let time = 0, off = 0, walls = 0;
    while (time < 400 && !p.finished) {
        if (worn) p.wear = 1;
        if (attack) p.attack = true; // the braking help's attack mode all lap (the game sets it beside a car ahead)
        while (d2((i + 1) % n) < d2(i)) i = (i + 1) % n; // nearest line point, followed forward
        const v = p.speed / sc;
        // Pure pursuit: aim at the line 0.3 s ahead (at least 8 m), steer onto the arc through it
        const look = Math.max(8, 0.3 * v) * sc;
        let j = i;
        while (Math.sqrt(d2(j)) < look) j = (j + 1) % n;
        const h = (j - 1 + n) % n, dh = Math.sqrt(d2(h)), dj = Math.sqrt(d2(j)), f = dj > dh ? Math.max(0, (look - dh) / (dj - dh)) : 1;
        const { steer, arc } = pursue(p, L[h].x + f * (L[j].x - L[h].x), L[h].y + f * (L[j].y - L[h].y), sc, steerHelp);
        // Speed: the line's speed a short way ahead, so braking starts in time
        const target = aim * rl.speed[(i + 2) % n];
        // The turn it is making: the line's on it, or the pursuit arc's when more than 1.5 m off it (wide out of a hairpin)
        const turn = Math.sqrt(d2(i)) / sc > 1.5 ? Math.max(Math.abs(k[i]), arc) : Math.abs(k[i]);
        const { throttle, brake } = pedals(p, sc, target, turn, steer);
        p.input = driver === 'flat' ? { steer, throttle: 1, brake: 0 } : { steer, throttle, brake };
        const v0 = p.speed;
        g.update();
        time += g.dt;
        const near = Physics.nearestOnTrack(p.x, p.y, t, p.roadI);
        if (!p.inPit && !['road', 'kerb', 'asphalt', 'paint'].includes(surfaceUnder(t, near, p.x, p.y))) { off++; onFail?.(i); } // off the asphalt
        if (v0 / sc > 15 && p.speed < v0 * 0.7 && !p.finished) { walls++; onFail?.(i); } // finishing parks the car, not a wall
        // sliding off the line it's meant to follow (on the timed lap: from its grid slot the car starts well off the line)
        if (onFail && (flying ? p.lap >= 1 : time > 10) && offLine(i) / sc > OFF_LINE_FAIL_M) onFail(i);
    }
    return { time: !p.finished ? Infinity : flying ? p.lastLap : time, off, walls, wide, finished: p.finished };
}

module.exports = { driveLap };
