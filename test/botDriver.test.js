// test/botDriver.test.js
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const { fillGrid } = require('../src/game/bots/roster');

const io = { emit() {}, volatile: { emit() {} } };
const tracks = Object.fromEntries(['monza', 'monaco', 'silverstone', 'interlagos'].map((id) => [id, Track.load(id)]));
const RACE = { maxLaps: 50, qualifying: false, tyreWear: false, ghostStart: false, collisions: true };

// One bot (pace forced if given) alone on the track: lap times, wall hits (≥ 25 % speed lost in a tick), track-limit strikes
function lone(track, level, laps = 3, pace) {
    const bot = fillGrid([], level, 11)[0];
    if (pace) bot.ai.pace = pace;
    bot.ai.mistake = 0;
    const g = new Game(io, [bot], track, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const p = g.players[bot.id], times = [];
    let hits = 0, prev = 0, seen = 0;
    for (let k = 0; k < 60 * 150 * laps && times.length < laps; k++) {
        g.update();
        const v = Math.abs(p.speed) / track.scale;
        if (prev > 10 && v < prev * 0.75) hits++;
        prev = v;
        if (p.lap > seen) { seen = p.lap; if (p.lastLap !== null) times.push(p.lastLap); }
    }
    return { times, hits, strikes: p.limits, p, g };
}

for (const id of Object.keys(tracks)) {
    test(`a lone bot laps ${id} cleanly`, () => {
        const r = lone(tracks[id], 'medium', 3);
        assert.strictEqual(r.times.length, 3, `finished ${r.times.length} laps`);
        assert.strictEqual(r.hits, 0, 'hit a wall');
        assert.strictEqual(r.strikes, 0, 'track-limit strikes');
    });
}

test('pace lands in each level band on Monza and Silverstone (flying laps)', () => {
    for (const id of ['monza', 'silverstone']) {
        const t = tracks[id];
        for (const [level, target] of [['easy', 1.12], ['medium', 1.05], ['hard', 1.01], ['pro', 0.995]]) {
            const r = lone(t, level, 3, target);
            const ratio = r.times[2] / t.racingLine.lapS;
            assert.ok(Math.abs(ratio - target) <= 0.045, `${id} ${level}: lap ${r.times[2].toFixed(2)} = ${ratio.toFixed(3)} × lapS, want ${target}`);
        }
    }
});

test('bot cars carry isBot and the meta says so', () => {
    const bot = fillGrid([], 'easy', 1)[0];
    const g = new Game(io, [bot], tracks.monza, RACE, () => {});
    assert.strictEqual(g.players[bot.id].isBot, true);
    assert.ok(Game.META_FIELDS.includes('isBot'));
    assert.strictEqual(g.initPayload().players[bot.id].username, bot.username);
});
