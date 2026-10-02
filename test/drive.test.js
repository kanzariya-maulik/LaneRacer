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
