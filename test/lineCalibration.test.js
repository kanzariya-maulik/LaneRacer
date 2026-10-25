// Corner limits as the car really holds them (src/game/lineCalibration.js, scripts/calibrate-lines.mjs): stored per track,
// applied to the racing line, the bots and the braking help
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Track = require('../src/game/Track');
const Game = require('../src/game/Game');
const { fillGrid } = require('../src/game/bots/roster');

const DATA = path.join(__dirname, '..', 'data', 'tracks');

for (const id of Track.TRACK_IDS) {
    test(`${id}: limits stored for this track's shape, every scale between 0.95 and 1.25`, () => {
        const file = path.join(DATA, `${id}.limits.json`);
        assert.ok(fs.existsSync(file), 'no limits file: run node scripts/calibrate-lines.mjs');
        const L = JSON.parse(fs.readFileSync(file, 'utf8')), t = Track.load(id);
        assert.strictEqual(L.points, t.path.length, 'stale: the track changed shape since calibration');
        assert.strictEqual(L.help.length, t.path.length);
        L.help.forEach((s, i) => assert.ok(s >= 0.95 && s <= 1.25, `point ${i}: ${s}`));
    });
}

// A lone pro bot (pace 1), its best lap and wide moments, on a track built with or without the stored limits
function lone(t) {
    let wide = 0;
    const g = new Game({ emit: (e, d) => { if (e === 'track_limits' && d.kind === 'wide') wide++; }, volatile: { emit() {} } }, fillGrid([], 'pro', 3, 1), t,
        { maxLaps: 4, qualifying: false, tyreWear: false, ghostStart: false, collisions: true, formationLap: false }, () => {});
    const p = Object.values(g.players)[0];
    p.ai.pace = 1;
    g.update(); g.release();
    for (let k = 0; k < 60 * 400 && p.lap < 3; k++) g.update();
    return { best: p.bestLap, wide };
}

test('monza, calibrated: a lone pro bot is over 1 s a lap faster than on the grip model\'s line, clean, within 1.5 % of the new lapS', () => {
    const t = Track.load('monza'), before = lone(Track.load('monza', null)), after = lone(t);
    assert.ok(after.best <= before.best - 1, `best ${after.best.toFixed(2)} s vs ${before.best.toFixed(2)} s on the grip model's line`);
    assert.ok(after.best <= t.racingLine.lapS * 1.015, `best ${after.best.toFixed(2)} s vs lapS ${t.racingLine.lapS}`);
    assert.strictEqual(after.wide, 0);
});

const { driveLap } = require('../src/game/lineFollower');
for (const id of ['monza', 'spa', 'silverstone', 'suzuka', 'monaco', 'interlagos']) {
    test(`${id}, calibrated: a lone pro bot drives the true limits cleanly, within 1 % of the exact line follower`, () => {
        const t = Track.load(id), bot = lone(t), ref = driveLap(Track.load(id), '100,0', { aim: 1 });
        assert.strictEqual(bot.wide, 0, `${bot.wide} wide moments`);
        assert.ok(bot.best <= ref.time * 1.01, `bot ${bot.best?.toFixed(2)} s vs follower ${ref.time.toFixed(2)} s`);
    });
}
