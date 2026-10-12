const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const { inputRate } = require('../public/js/predict.js');

const io = { emit() {}, volatile: { emit() {} } };
const monza = Track.load('monza');

// Busy WiFi, in 1 ms steps: the client steps at 60 Hz (paced or not), sends newest + 5 like game3d.js, each packet
// lands 33 ms + up to 50 ms of jitter later; the server ticks at 60 Hz. Returns guessed slots and the mean spare inputs.
function wifi(paced) {
    const g = new Game(io, [{ id: 'a', username: 'A', teamId: 'ferrari' }], monza, { maxLaps: 3, qualifying: false }, () => {});
    g.frozen = false;
    const a = g.players.a, sent = [], wire = [], TICK = 1000 / 60;
    let rng = 7, acc = 0, seq = 0, nextTick = 0, starve = 0, spare = 0, n = 0, slack;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let t = 0; t < 30000; t++) {
        acc += paced ? inputRate(slack) : 1;
        while (acc >= TICK) {
            acc -= TICK;
            sent.push({ seq: ++seq, steer: 0, throttle: 1, brake: 0, drs: false });
            wire.push({ at: t + 33 + rand() * 50, list: sent.slice(-6) });
        }
        if (t >= nextTick) {
            nextTick += TICK;
            for (let k = wire.length - 1; k >= 0; k--) if (wire[k].at <= t) { g.handleInputs('a', wire[k].list); wire.splice(k, 1); }
            const before = a.starve;
            g.update();
            slack = g.fastPacket().c[0][14];                                    // the client hears it (a little later in life)
            if (t > 10000) { starve += a.starve - before; spare += a.queue.length; n++; }
        }
    }
    return { starve, spare: spare / n };
}

test('input cushion: paced steps keep a spare input through WiFi jitter, so the server stops guessing', () => {
    const fixed = wifi(false), paced = wifi(true);
    assert.ok(fixed.starve > 100, `unpaced client starves the server: ${fixed.starve} guessed slots in 20 s`);
    assert.ok(paced.starve <= fixed.starve / 10, `paced: ${paced.starve} guessed vs ${fixed.starve}`);
    assert.ok(paced.spare < 5, `cushion stays small (it delays everyone's view of us): ${paced.spare.toFixed(1)} spare`);
});

test('inputRate: fast when the server ran dry, steady with one or two spare, slow beyond', () => {
    assert.deepStrictEqual([undefined, -1, 0, 1, 2, 3].map(inputRate), [1, 1.04, 1.015, 1, 1, 0.99]);
});
