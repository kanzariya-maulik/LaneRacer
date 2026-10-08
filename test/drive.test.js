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
test('median: a car on either leg swerving across at the Fairmont median is stopped on its own side', () => {
    const t = Track.load('monaco'), md = t.medians[0], c = md[md.length >> 1], s = 30 * t.scale;
    assert.strictEqual(t.medians.length, 1, 'the only median on the calendar');
    // both legs: the point of each nearest the median's middle
    const legs = t.path.map((q, i) => i).filter((i) => Math.hypot(t.path[i].x - c.x, t.path[i].y - c.y) < t.width)
        .reduce((acc, i) => (acc.some((j) => Math.abs(t.cum[j] - t.cum[i]) < 60 * t.scale) ? acc : [...acc, i]), []);
    assert.strictEqual(legs.length, 2, 'two legs beside the median');
    for (const i of legs) {
        const p0 = t.path[i], side = (q) => Math.sign((q.x - c.x) * (p0.x - c.x) + (q.y - c.y) * (p0.y - c.y)); // + = this leg's side
        const angle = Math.atan2(c.y - p0.y, c.x - p0.x); // straight at the median
        const p = { x: p0.x, y: p0.y, angle, vx: Math.cos(angle) * s, vy: Math.sin(angle) * s, speed: s, steer: 0, assist: 'off', roadI: i };
        for (let k = 0; k < 60; k++) D.driveCar(p, COAST, t, 1 / 60);
        assert.strictEqual(side(p), 1, `car from the leg at ${(t.cum[i] / t.scale).toFixed(0)} m crossed the median`);
    }
});
