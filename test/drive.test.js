const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');
const Physics = require('../src/game/Physics');

let D;
before(async () => { D = await import('../public/js/sim/drive.js'); });
const io = { emit() {}, volatile: { emit() {} } };

test('driveCar moves a car exactly like Game.drive', () => {
    const t = Track.load('monza');
    const g = new Game(io, [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 9, qualifying: false }, () => {});
    const p = g.players.a, q = JSON.parse(JSON.stringify(p));
    p.input = q.input = { steer: 0.3, throttle: 1, brake: 0, drs: false };
    for (let k = 0; k < 300; k++) { g.drive(p); D.driveCar(q, q.input, t, 1 / 60); }
    for (const f of ['x', 'y', 'vx', 'vy', 'angle', 'speed', 'steer']) assert.strictEqual(q[f], p[f], f);
});

test('driveCar on the client copy of the track (JSON round trip, as sent in game_init) matches the server', () => {
    const Tr = require('../src/game/Track');
    for (const id of Tr.TRACK_IDS) {
        const t = Tr.load(id), wire = JSON.parse(JSON.stringify(t));
        const a = { ...JSON.parse(JSON.stringify(t.startPositions[0])), vx: 0, vy: 0, speed: 0, steer: 0, assist: 'full', tow: 0 };
        a.lastSafeX = a.x; a.lastSafeY = a.y;
        const b = { ...a };
        for (let k = 0; k < 900; k++) {
            const input = { steer: Math.sin(k / 40), throttle: 1, brake: k % 200 > 180 ? 1 : 0, drs: false };
            D.driveCar(a, input, t, 1 / 60); D.driveCar(b, input, wire, 1 / 60);
        }
        for (const f of ['x', 'y', 'vx', 'vy', 'angle']) assert.strictEqual(b[f], a[f], `${id} ${f}`);
    }
});

test('driveCar feels the real hills: full throttle up Raidillon (Spa) ends slower than the same run with the hills flattened', () => {
    const spa = Track.load('spa'), flat = { ...spa, grade: null, vcurv: null };
    const i = spa.cum.findIndex((c) => c / spa.scale >= 1150), a = spa.path[i], b = spa.path[i + 1]; // climbing out of Eau Rouge
    const run = (t) => {
        const p = { x: a.x, y: a.y, angle: Math.atan2(b.y - a.y, b.x - a.x), vx: 0, vy: 0, speed: 0, steer: 0, assist: 'off' };
        const v0 = 60 * t.scale; p.vx = Math.cos(p.angle) * v0; p.vy = Math.sin(p.angle) * v0; p.speed = v0;
        for (let k = 0; k < 90; k++) { // steer at the centreline 3 points ahead
            const n = Physics.nearestOnTrack(p.x, p.y, t), ah = t.path[(n.i + 3) % t.path.length];
            let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            D.driveCar(p, { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, d * 3)) }, t, 1 / 60);
        }
        return { v: p.speed / t.scale, grade: p.grade };
    };
    const hill = run(spa), level = run(flat);
    assert.ok(hill.grade > 0.05, `grade felt ${hill.grade}`);
    assert.ok(hill.v < level.v - 1, `uphill ${hill.v.toFixed(1)} m/s vs flat ${level.v.toFixed(1)} m/s`);
});

// Suzuka's bridge: the back straight over the road beneath, each level with its own walls
const suzuka = Track.load('suzuka'), bridge = suzuka.bridges[0];
const launch = (rd, turn, v) => { // at the crossing on road rd, heading turned by `turn` (rad), v m/s
    const angle = rd.angle + turn, s = v * suzuka.scale;
    return { x: bridge.x, y: bridge.y, angle, vx: Math.cos(angle) * s, vy: Math.sin(angle) * s, speed: s, steer: 0, assist: 'off', roadI: rd.i }; // arrived along rd
};
const outward = (rd, p) => (-Math.sin(rd.angle) * (p.x - bridge.x) + Math.cos(rd.angle) * (p.y - bridge.y)) / suzuka.scale; // m right
const COAST = { throttle: 0, brake: 0, steer: 0 };

test('bridge: a car on the upper road drives straight over, untouched by the underpass walls beneath it', () => {
    const p = launch(bridge.upper, 0, 60);
    for (let k = 0; k < 40; k++) D.driveCar(p, COAST, suzuka, 1 / 60);
    assert.ok(p.speed / suzuka.scale > 55, `slowed to ${(p.speed / suzuka.scale).toFixed(1)} m/s`);
});

for (const level of ['lower', 'upper']) {
    test(`bridge: a car on the ${level} road swerving at the side wall is stopped by it`, () => {
        const rd = bridge[level], p = launch(rd, 1.2, 30), wall = suzuka.width / 2 / suzuka.scale + 1;
        for (let k = 0; k < 30; k++) D.driveCar(p, COAST, suzuka, 1 / 60); // ~70 deg at the wall, still alongside it
        assert.ok(outward(rd, p) < wall + 0.1, `went ${outward(rd, p).toFixed(1)} m out, wall at ${wall.toFixed(1)} m`);
    });
}

// Monaco's Fairmont hairpin: the way in and the way out run side by side, a median barrier between them
test("Fairmont: a car on either leg swerving across at the hairpin's two close legs is stopped on its own side", () => {
    const t = Track.load('monaco'), P = t.path, n = P.length, total = t.cum[n], s = 30 * t.scale;
    // the closest two points far apart along the lap: the way into the Fairmont hairpin and the way out, ~14 m apart
    let best = null;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const gap = Math.min(t.cum[j] - t.cum[i], total - (t.cum[j] - t.cum[i])), d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y);
        if (gap > 100 * t.scale && (!best || d < best.d)) best = { i, j, d };
    }
    assert.ok(best.d < 20 * t.scale, `closest legs ${best.d / t.scale} m apart`);
    const c = { x: (P[best.i].x + P[best.j].x) / 2, y: (P[best.i].y + P[best.j].y) / 2 };
    for (const i of [best.i, best.j]) {
        const p0 = P[i], side = (q) => Math.sign((q.x - c.x) * (p0.x - c.x) + (q.y - c.y) * (p0.y - c.y)); // + = this leg's side
        const angle = Math.atan2(c.y - p0.y, c.x - p0.x); // straight at the other leg
        const p = { x: p0.x, y: p0.y, angle, vx: Math.cos(angle) * s, vy: Math.sin(angle) * s, speed: s, steer: 0, assist: 'off', roadI: i };
        for (let k = 0; k < 60; k++) D.driveCar(p, COAST, t, 1 / 60);
        assert.strictEqual(side(p), 1, `car from the leg at ${(t.cum[i] / t.scale).toFixed(0)} m crossed to the other`);
    }
});

test('tyre wear is identical on the server and the client copy of the track', () => {
    const t = Track.load('suzuka'), wire = JSON.parse(JSON.stringify(t));
    const a = { ...JSON.parse(JSON.stringify(t.startPositions[0])), vx: 0, vy: 0, speed: 0, steer: 0, assist: 'full', tow: 0,
        compound: 'S', wear: 0, wearPerM: 1 / 3000, tyreGrip: 1.06 };
    a.lastSafeX = a.x; a.lastSafeY = a.y;
    const b = { ...a };
    for (let k = 0; k < 900; k++) {
        const input = { steer: Math.sin(k / 40), throttle: 1, brake: k % 200 > 180 ? 1 : 0, drs: false };
        D.driveCar(a, input, t, 1 / 60); D.driveCar(b, input, wire, 1 / 60);
    }
    assert.ok(a.wear > 0);
    for (const f of ['x', 'y', 'wear', 'tyreGrip']) assert.strictEqual(b[f], a[f], f);
});

test('assistBrake: set only when the braking help brakes harder than the driver', () => {
    const t = Track.load('monza'), io = { emit() {}, volatile: { emit() {} } };
    for (const [assist, expect] of [['100,100', true], ['0,0', false]]) {
        const g = new Game(io, [{ id: 'a', username: 'a', teamId: 'ferrari', assist }], t, { maxLaps: 3, qualifying: false }, () => {});
        const p = g.players.a, s0 = t.start, v = 85 * t.scale;
        Object.assign(p, { vx: Math.cos(s0.angle) * v, vy: Math.sin(s0.angle) * v, speed: v });
        let seen = false;
        for (let k = 0; k < 60 * 20 && !seen; k++) { D.driveCar(p, { throttle: 1, brake: 0, steer: 0, drs: false }, t, 1 / 60); seen = !!p.assistBrake; }
        assert.strictEqual(seen, expect, assist);
    }
});

// A plain ring (500 m radius, no pit lane), a car this far right of the centreline (m), heading along the lap at v m/s
function onRing(offM, v, surfaces = []) {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: Math.cos(i / 50 * Math.PI) * 3000, y: Math.sin(i / 50 * Math.PI) * 3000 }));
    const t = Track.build({ id: 'ring', name: 'Ring', scale: 6, width: 72, path: pts }), sc = t.scale;
    t.build.surfaces = surfaces.map((s) => ({ ...s, poly: s.poly(t) }));
    const P = t.path, a = P[10], b = P[11], l = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l, ang = Math.atan2(b.y - a.y, b.x - a.x);
    const p = { x: a.x + nx * offM * sc, y: a.y + ny * offM * sc, angle: ang, vx: Math.cos(ang) * v * sc, vy: Math.sin(ang) * v * sc, speed: v * sc, steer: 0, assist: 'off' };
    p.lastSafeX = p.x; p.lastSafeY = p.y;
    // a band beside the road from offM - 3 to offM + 3 m, a quarter lap long, as a polygon
    const band = (tt) => { const out = [], inn = []; for (let i = 5; i <= 30; i++) { const q = tt.path[i], r = tt.path[i + 1], L = Math.hypot(r.x - q.x, r.y - q.y), mx = -(r.y - q.y) / L, my = (r.x - q.x) / L; out.push({ x: q.x + mx * (offM + 3) * sc, y: q.y + my * (offM + 3) * sc }); inn.push({ x: q.x + mx * (offM - 3) * sc, y: q.y + my * (offM - 3) * sc }); } return [...out, ...inn.reverse()]; };
    return { t, p, band };
}
const coast = (t, p, s) => { for (let k = 0; k < s * 60; k++) D.driveCar(p, { steer: 0, throttle: 0, brake: 0, drs: false }, t, 1 / 60); return Math.hypot(p.vx, p.vy) / t.scale; };

test('asphalt run-off drives like asphalt; gravel slows harder than grass', () => {
    const road = onRing(0, 50), vRoad = coast(road.t, road.p, 1);
    const band = onRing(10, 50).band, off = (kind) => { const r = onRing(10, 50, [{ kind, poly: band }]); return coast(r.t, r.p, 1); };
    const vAsphalt = off('asphalt'), vGravel = off('gravel'), vGrass = off('grass');
    assert.ok(Math.abs(vAsphalt - vRoad) / vRoad < 0.005, `asphalt run-off ${vAsphalt} vs road ${vRoad} m/s`);
    assert.ok(vGravel < vGrass && vGrass < vAsphalt, `gravel ${vGravel} < grass ${vGrass} < asphalt ${vAsphalt}`);
});

test('the drawn wall stops the car', () => {
    const { t, p } = onRing(0, 80), w = t.walls[0].pts, i = Math.floor(w.length / 4), a = w[i], b = w[i + 1];
    // aim square at the middle of one barrier segment from 20 m inside it
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, l = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
    const toward = Math.hypot(mx + nx * 20 * t.scale - t.path[0].x, my + ny * 20 * t.scale - t.path[0].y) < Math.hypot(mx - nx * 20 * t.scale - t.path[0].x, my - ny * 20 * t.scale - t.path[0].y) ? 1 : -1;
    const sx = mx + toward * nx * 20 * t.scale, sy = my + toward * ny * 20 * t.scale, ang = Math.atan2(my - sy, mx - sx);
    Object.assign(p, { x: sx, y: sy, angle: ang, vx: Math.cos(ang) * 80 * t.scale, vy: Math.sin(ang) * 80 * t.scale, speed: 80 * t.scale, lastSafeX: sx, lastSafeY: sy, roadI: undefined });
    const side = (q) => Math.sign((q.x - mx) * nx + (q.y - my) * ny);
    for (let k = 0; k < 120; k++) { D.driveCar(p, { steer: 0, throttle: 1, brake: 0, drs: false }, t, 1 / 60); assert.strictEqual(side(p), toward, `through the wall at tick ${k}`); }
});
