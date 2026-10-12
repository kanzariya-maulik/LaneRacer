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

const Physics = require('../src/game/Physics');

test('a faster bot passes a slower one without contact', () => {
    const [fast, slow] = fillGrid([], 'pro', 21);
    fast.ai.mistake = slow.ai.mistake = 0;
    slow.ai.pace = 1.2;
    const g = new Game(io, [slow, fast], tracks.monza, { ...RACE, rng: () => 0.5 }, () => {}); // slow on pole, fast behind
    g.release();
    let passed = false;
    for (let k = 0; k < 60 * 300 && !passed; k++) { g.update(); passed = g.players[fast.id].rank === 1; }
    assert.ok(passed, 'never got past in 5 minutes');
    assert.strictEqual(g.contacts.size, 0, 'touched');
    assert.strictEqual(g.players[fast.id].penalty, 0);
});

test('a bot behind a stopped car on the line never hits it', () => {
    const bot = fillGrid([], 'pro', 5)[0];
    bot.ai.mistake = 0;
    const t = tracks.monza, g = new Game(io, [bot, { id: 'h', username: 'H', teamId: 'haas' }], t, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const L = require('../src/game/bots/driver').lineOf(t), j = require('../src/game/bots/driver').ahead(t, 0, 400);
    Object.assign(g.players.h, { x: L.pts[j].x, y: L.pts[j].y, angle: g.players[bot.id].angle, vx: 0, vy: 0, speed: 0 });
    let touched = false;
    for (let k = 0; k < 60 * 40; k++) {
        g.players.h.input = { throttle: 0, brake: 0, steer: 0, drs: false }; // brake at a standstill would reverse
        g.players.h.inputAt = g.clock; // still "connected": no input timeout
        g.update();
        if (Physics.carOverlap(g.players[bot.id], g.players.h, t.scale)) touched = true;
    }
    assert.strictEqual(touched, false);
    assert.strictEqual(g.players[bot.id].rank, 1, 'got round it');
});

test('defending: one move toward the inside before the braking zone, never a second on that straight', () => {
    const { drive, state, insideSide, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, ph = t.racingLine.phase;
    let i = 0; // a straight point with a braking zone 150 m on (the distance the defence looks ahead)
    for (let k = 0; k < ph.length; k++) if (ph[ahead(t, k, 150)] === 2 && ph[k] === 0) { i = k; break; }
    const P = t.path[i], Q = t.path[(i + 1) % t.path.length], ang = Math.atan2(Q.y - P.y, Q.x - P.x);
    const me = { x: P.x, y: P.y, angle: ang, speed: 70 * t.scale, ai: { pace: 1, aggression: 0.9, mistake: 0, reaction: 0 }, lap: 3, rank: 1, tyreGrip: 1 };
    const back = (side) => ({ x: P.x - Math.cos(ang) * 20 * t.scale + side * -Math.sin(ang) * 2 * t.scale, y: P.y - Math.sin(ang) * 20 * t.scale + side * Math.cos(ang) * 2 * t.scale, speed: 72 * t.scale, lap: 3, rank: 2 });
    const ctx = (o) => ({ track: t, cars: [me, o], time: 100, frozen: false, mode: 'race', dt: 1 / 60, rng: () => 0.99, toEntryM: () => 1e9 });
    drive(me, ctx(back(1)));
    const side = state(me).defend;
    assert.strictEqual(side, insideSide(t, i), 'covers the inside');
    drive(me, ctx(back(-1)));
    assert.strictEqual(state(me).defend, side, 'no second move when the attacker switches');
});
