const { test, before } = require('node:test');
const assert = require('node:assert');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');

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
