const test = require('node:test');
const assert = require('node:assert');
const Assist = require('../src/game/Assist');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
const at = (m) => monza.safeSpeed[monza.cum.findIndex(c => c >= m * monza.scale)];

test('safe speed: flat out on the straight, ~90 km/h at the first chicane', () => {
    assert.strictEqual(at(300), Assist.MAX_SAFE);
    let min = Infinity;
    for (let m = 800; m < 1300; m += 10) min = Math.min(min, at(m));
    assert.ok(min * 3.6 > 70 && min * 3.6 < 110, `${(min * 3.6).toFixed(0)} km/h`);
});

test('safe speed: a straight line is flat out', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 60, y: 0 }));
    for (const v of Assist.safeSpeeds(line, 6).slice(3, -3)) assert.strictEqual(v, Assist.MAX_SAFE);
});
