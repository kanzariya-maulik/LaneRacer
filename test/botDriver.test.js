// test/botDriver.test.js
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const { fillGrid, rngOf } = require('../src/game/bots/roster');

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

test('mistakes: forced at every corner, the bot is slower but recovers and keeps lapping', () => {
    const clean = lone(tracks.silverstone, 'medium', 2, 1.05).times[1];
    const bot = fillGrid([], 'medium', 11)[0];
    bot.ai.pace = 1.05; bot.ai.mistake = 1;
    const g = new Game(io, [bot], tracks.silverstone, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const p = g.players[bot.id];
    let kinds = new Set();
    for (let k = 0; k < 60 * 400 && p.lap < 2; k++) { g.update(); if (p.bot?.err) kinds.add(p.bot.err.kind); }
    assert.strictEqual(p.lap, 2, 'stuck after a mistake');
    assert.ok(p.lastLap > clean, `mistake lap ${p.lastLap} vs clean ${clean}`);
    assert.ok(kinds.size >= 1);
});

test('no mistakes with a car alongside or close behind', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, ph = t.racingLine.phase;
    let i = 0;
    for (let k = 1; k < ph.length; k++) if (ph[k] === 2 && ph[k - 1] !== 2) { i = k; break; }
    const P = t.path[i], Q = t.path[i + 1], ang = Math.atan2(Q.y - P.y, Q.x - P.x);
    const me = { x: P.x, y: P.y, angle: ang, speed: 60 * t.scale, ai: { pace: 1, aggression: 0.5, mistake: 1, reaction: 0 }, lap: 1, rank: 1, tyreGrip: 1 };
    const side = { x: P.x - Math.sin(ang) * 3 * t.scale, y: P.y + Math.cos(ang) * 3 * t.scale, speed: 60 * t.scale, lap: 1, rank: 2 };
    state(me).prevPhase = 0;
    drive(me, { track: t, cars: [me, side], time: 50, frozen: false, mode: 'race', dt: 1 / 60, rng: () => 0, toEntryM: () => 1e9 });
    assert.strictEqual(state(me).err, null);
});

test('start: no throttle before the bot reacts, then it goes', () => {
    const bot = fillGrid([], 'easy', 2)[0];
    bot.ai.reaction = 0.4; bot.ai.bog = 0;
    const g = new Game(io, [bot], tracks.monza, RACE, () => {});
    g.update();
    assert.strictEqual(g.players[bot.id].input.throttle, 0, 'lights still on');
    g.release();
    for (let k = 0; k < 20; k++) g.update(); // 0.33 s
    assert.strictEqual(g.players[bot.id].input.throttle, 0, 'before its reaction time');
    for (let k = 0; k < 10; k++) g.update();
    assert.ok(g.players[bot.id].input.throttle > 0, 'after it');
    assert.strictEqual(g.players[bot.id].jumpStart, false);
});

// Final review fixes
const mk = (t, i, side = 0, v = 0, extra = {}) => {
    const P = t.path[i], Q = t.path[(i + 1) % t.path.length], ang = Math.atan2(Q.y - P.y, Q.x - P.x);
    return { x: P.x - Math.sin(ang) * side * t.scale, y: P.y + Math.cos(ang) * side * t.scale, angle: ang, speed: v * t.scale, lap: 1, rank: 1, tyreGrip: 1, ...extra };
};
const ctxOf = (t, cars, time) => ({ track: t, cars, time, frozen: false, mode: 'race', dt: 1 / 60, rng: () => 0.99, toEntryM: () => 1e9 });

test('review: a bot queued at a standstill behind a stopped car never reverses into the car behind it', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, i = 300, off = t.racingLine.offset[i] / t.scale;
    const me = mk(t, i, off, 0, { ai: { pace: 1, aggression: 0, mistake: 0, reaction: 0 } });
    const front = mk(t, ahead(t, i, 9), t.racingLine.offset[ahead(t, i, 9)] / t.scale, 0, { rank: 2 });
    const back = mk(t, (i - 1 + t.path.length) % t.path.length, off, 0, { rank: 3 });
    for (let k = 0; k < 240; k++) drive(me, ctxOf(t, [me, front, back], 10 + k / 60));
    assert.ok(!(state(me).reverse > 0), 'reversed with a car right behind');
});

test('review: ghost cars are not traffic (they cannot be hit)', () => {
    const { drive, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, i = 300, j = ahead(t, i, 20);
    const me = mk(t, i, t.racingLine.offset[i] / t.scale, 60, { ai: { pace: 1, aggression: 0.5, mistake: 0, reaction: 0 } });
    const ghost = mk(t, j, t.racingLine.offset[j] / t.scale, 0, { ghost: true, rank: 2 });
    assert.strictEqual(drive(me, ctxOf(t, [me, ghost], 50)).brake, 0);
});

test('review: in the pit lane a bot brakes for a slower car just ahead in the lane', () => {
    const { drive } = require('../src/game/bots/driver');
    const t = tracks.monza, sc = t.scale, pit = t.pit, Drive = require('../public/js/sim/drive.js');
    const at = (s) => Drive.pointOnPath(pit, s * sc);
    const a = at(100), b = at(108);
    const me = { x: a.x, y: a.y, angle: a.angle, speed: 20 * sc, inPit: true, pitS: 100 * sc, box: { s: 400 * sc }, lap: 1, rank: 1, tyreGrip: 1, ai: { pace: 1, aggression: 0.5, mistake: 0, reaction: 0 } };
    const slow = { x: b.x, y: b.y, angle: b.angle, speed: 2 * sc, inPit: true, pitS: 108 * sc, lap: 1, rank: 2 };
    const out = drive(me, ctxOf(t, [me, slow], 50));
    assert.ok(out.brake > 0 && out.throttle === 0, JSON.stringify(out));
});

// Standing start, ghost start on (the lobby default): a real launch from the grid, then a fight into turn 1
test('standing start: bots hold their grid columns off the line, race each other into turn 1, then take the line', () => {
    const bots = fillGrid([], 'medium', 7).slice(0, 20);
    const g = new Game(io, bots, tracks.monza, { ...RACE, maxLaps: 2, ghostStart: true, rng: rngOf(1) }); // seeded: on Math.random about 1 run in 25 kept every place
    g.update(); g.release();
    const cars = () => Object.values(g.players);
    const order = () => cars().sort((a, b) => a.rank - b.rank).map((p) => p.id).join();
    for (let k = 0; k < 60; k++) g.update(); // 1 s: lights out, launched
    const early = order();
    for (let k = 0; k < 120; k++) g.update(); // 3 s after lights out
    const spread = cars().filter((p) => Math.abs(p.bot?.lane ?? 0) > 1).length;
    assert.ok(spread >= 8, `${spread} of 20 still out of the line's column at 3 s (grid slots held)`);
    for (let k = 0; k < 60 * 30; k++) g.update(); // past turn 1
    assert.ok(cars().every((p) => !p.bot?.start), 'start phase over by turn 1');
    assert.notStrictEqual(order(), early, 'places changed on the run to and through turn 1');
    assert.ok(cars().every((p) => p.lap >= 1 || p.speed > 0), 'nobody stopped');
});

for (const v0 of [10, 0]) test(`a bot in the Ascari gravel at ${v0} m/s gets back on the road`, async () => {
    const D = await import('../public/js/sim/drive.js');
    const t = Track.load('monza'), P = t.path, n = P.length, sc = t.scale; // own copy: the gravel added below stays here
    // Ascari: the slowest point 3.6–4.4 km into the lap; a gravel trap on its right from the kerb out 40 m, 150 m long
    const lapM = (i) => ((((t.cum[i] - t.startS) % t.cum[n]) + t.cum[n]) % t.cum[n]) / sc;
    let apex = -1;
    for (let i = 0; i < n; i++) if (lapM(i) > 3600 && lapM(i) < 4400 && (apex < 0 || t.safeSpeed[i] < t.safeSpeed[apex])) apex = i;
    const norm = (i) => { const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return [-(b.y - a.y) / l, (b.x - a.x) / l]; };
    const out = [], inn = [];
    for (let i = apex - 8; i <= apex + 8; i++) { const k = (i + n) % n, [nx, ny] = norm(k), e = t.edgeR[k] + t.kerbR[k] + 0.5 * sc; inn.push({ x: P[k].x + nx * e, y: P[k].y + ny * e }); out.push({ x: P[k].x + nx * (e + 40 * sc), y: P[k].y + ny * (e + 40 * sc) }); }
    t.build.surfaces.push({ kind: 'gravel', poly: [...inn, ...out.reverse()], src: 'test' });
    const bot = fillGrid([], 'medium', 11)[0];
    bot.ai.mistake = 0;
    const g = new Game(io, [bot], t, { ...RACE, rng: () => 0.5 }, () => {});
    g.release();
    const p = g.players[bot.id], [nx, ny] = norm(apex), b = P[(apex + 1) % n], ang = Math.atan2(b.y - P[apex].y, b.x - P[apex].x), off = t.edgeR[apex] + t.kerbR[apex] + 5 * sc; // 5 m into the gravel (the generated barrier stands 13 m out)
    Object.assign(p, { x: P[apex].x + nx * off, y: P[apex].y + ny * off, angle: ang, vx: Math.cos(ang) * v0 * sc, vy: Math.sin(ang) * v0 * sc, speed: v0 * sc, roadI: apex });
    assert.strictEqual(D.surfaceUnder(t, require('../src/game/Physics').nearestOnTrack(p.x, p.y, t), p.x, p.y), 'gravel', 'starts in the gravel');
    let back = -1, prev = v0, hits = 0;
    for (let k = 0; k < 60 * 15 && back < 0; k++) {
        g.update();
        const v = Math.abs(p.speed) / sc;
        if (prev > 10 && v < prev * 0.75) hits++;
        prev = v;
        const nr = require('../src/game/Physics').nearestOnTrack(p.x, p.y, t);
        if (D.surfaceUnder(t, nr, p.x, p.y) === 'road') back = k;
    }
    assert.ok(back >= 0, 'still off the road after 15 s');
    assert.strictEqual(hits, 0, 'hit a wall getting out');
});

// Review (pro bots crashing): most contacts were rear-ends — a car physically right in front, but off the follower's planned
// lane (squeezed, rejoining, steering lag), wasn't "in my path", so the follow cap never braked for it
test('a bot brakes for a car physically in front of it even when that car is off its planned lane', () => {
    const D = require('../src/game/bots/driver'), t = tracks.monza, sc = t.scale, L = D.lineOf(t), here = 40;
    const at = (metres, lane, speed) => {
        const j = D.ahead(t, here, metres), q = L.pts[j], N = L.N[j], k = t.path[(j + 1) % t.path.length], ang = Math.atan2(k.y - t.path[j].y, k.x - t.path[j].x);
        return { x: q.x + N.x * lane * sc, y: q.y + N.y * lane * sc, angle: ang, speed: speed * sc, vx: Math.cos(ang) * speed * sc, vy: Math.sin(ang) * speed * sc, lap: 0, rank: 9 };
    };
    // me 3.4 m off the line (squeezed there) but planning the line itself; a slow car 15 m ahead exactly in front of me
    const me = Object.assign(at(0, 3.4, 25), { id: 'me', ai: { ...fillGrid([], 'pro', 1)[0].ai, mistake: 0 }, tyreGrip: 1, lap: 0, rank: 5 });
    D.state(me).lane = 0; me.bot.start = null; me.bot.idx = here;
    const slow = Object.assign(at(15, 3.4, 5), { id: 's' });
    const r = D.scan(me, { track: t, cars: [me, slow], mode: 'race' }, 25);
    assert.strictEqual(r.ahead?.o, slow, 'the car in front of me is not seen as ahead');
    // side by side (overlapping, a metre ahead and 1.9 m across) is alongside, not in front: stopping for it jammed the chicanes
    const beside = Object.assign(at(1, 3.4 + 1.9, 25), { id: 'beside' });
    const r2 = D.scan(me, { track: t, cars: [me, beside], mode: 'race' }, 25);
    assert.notStrictEqual(r2.ahead?.o, beside, 'a car alongside counted as in front');
});

// Review (pro bots crashing): in a queue every car is "faster" than the one ahead; pulling out into an occupied lane caused
// the turn-1 pile-ups. A pass starts only into a clear lane
test('a bot held up by a slower car stays in line while both passing lanes are taken', () => {
    const D = require('../src/game/bots/driver'), t = tracks.monza, sc = t.scale, L = D.lineOf(t), here = 40;
    const at = (metres, lane, speed) => { // a car this far down the lap from `here`, `lane` m off the racing line
        const j = D.ahead(t, here, metres), q = L.pts[j], N = L.N[j], k = t.path[(j + 1) % t.path.length], ang = Math.atan2(k.y - t.path[j].y, k.x - t.path[j].x);
        return { x: q.x + N.x * lane * sc, y: q.y + N.y * lane * sc, angle: ang, speed: speed * sc, vx: Math.cos(ang) * speed * sc, vy: Math.sin(ang) * speed * sc, lap: 0, rank: 9 };
    };
    // the queue: me at 10 m/s, a car 12 m ahead crawling, cars in both passing lanes just behind me
    const me = Object.assign(at(0, 0, 10), { id: 'me', ai: { ...fillGrid([], 'pro', 1)[0].ai, mistake: 0 }, tyreGrip: 1, lap: 0, rank: 5 });
    const cars = [me, Object.assign(at(12, 0, 3), { id: 'slow' }), Object.assign(at(-7, 3.5, 11), { id: 'left' }), Object.assign(at(-7, -3.5, 11), { id: 'right' })];
    const ctx = { track: t, cars, mode: 'race', time: 30, dt: 1 / 60, rng: () => 0.5, frozen: false, toEntryM: () => 1e9 };
    for (let k = 0; k < 10; k++) D.drive(me, ctx);
    assert.strictEqual(me.bot.passSide, 0, `pulled out to ${me.bot.passSide}`);
    cars.splice(2, 2); // the lanes clear: now it goes
    for (let k = 0; k < 10; k++) D.drive(me, ctx);
    assert.notStrictEqual(me.bot.passSide, 0);
});

// A lone pro bot (pace 1) on lap 2: seconds spent per path point, and how many "wide" moments
function loneLap(t, tyreGrip = null) {
    let wide = 0;
    const g = new Game({ emit: (e, d) => { if (e === 'track_limits' && d.kind === 'wide') wide++; }, volatile: { emit() {} } }, fillGrid([], 'pro', 3, 1), t, { ...RACE, maxLaps: 4 }, () => {});
    const p = Object.values(g.players)[0];
    p.ai.pace = 1; p.ai.mistake = 0; // a clean lap: no random driver error (one in 1000 corners ran it wide now and then)
    g.update(); g.release();
    const spent = new Array(t.path.length).fill(0), speed = new Array(t.path.length).fill(0);
    for (let k = 0; k < 60 * 400 && p.lap < 3; k++) {
        if (tyreGrip !== null) p.tyreGrip = tyreGrip;
        g.update();
        if (p.lap === 2) { spent[p.bot.idx] += 1 / 60; speed[p.bot.idx] = p.speed / t.scale; }
    }
    return { spent, speed, wide, lap: spent.reduce((a, b) => a + b, 0) };
}

test('worn hard tyres: slower through corners than new mediums, and still clean', () => {
    const fresh = loneLap(tracks.monza, 1), worn = loneLap(tracks.monza, 0.85);
    assert.ok(worn.lap > fresh.lap + 0.5, `worn ${worn.lap.toFixed(2)} vs fresh ${fresh.lap.toFixed(2)}`);
    assert.strictEqual(worn.wide, 0, 'ran wide on worn tyres');
    assert.strictEqual(fresh.wide, 0, 'ran wide on fresh tyres');
});


// Racecraft at the limit (docs/superpowers/specs/2026-10-24-race-at-the-limit-design.md)
const braking = (t) => { const ph = t.racingLine.phase; for (let k = 1; k < ph.length; k++) if (ph[k] === 2 && ph[k - 1] === 0) return k; return 0; };

test('pro dive: a committed move on the inside is kept into the braking zone, not given up for not being alongside yet', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, i = braking(t) + 1, j = ahead(t, i, 4); // into the braking zone, their gearbox 4 m ahead
    const me = mk(t, i, t.racingLine.offset[i] / t.scale - 2, 75, { ai: { pace: 1, aggression: 0.95, mistake: 0, reaction: 0 } });
    const them = mk(t, j, t.racingLine.offset[j] / t.scale, 72, { rank: 1 });
    me.rank = 2;
    const b = state(me);
    b.passSide = -1; b.passCar = them; b.prevPhase = 2;
    drive(me, ctxOf(t, [me, them], 100));
    assert.strictEqual(b.passSide, -1, 'gave up the dive');
});

test('switchback: just passed, the bot goes straight back at the car that passed it', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, i = 200, sc = t.scale;
    const me = mk(t, i, t.racingLine.offset[i] / sc, 70, { ai: { pace: 1, aggression: 0.95, mistake: 0, reaction: 0 }, rank: 1 });
    const at = (k) => mk(t, k, t.racingLine.offset[k] / sc + 3, 72, { rank: 2, id: 'x' }); // 3 m to my side
    const other = at(i - 1); // a point (~10 m) behind me
    drive(me, ctxOf(t, [me, other], 100));
    Object.assign(other, at(ahead(t, i, 9)), { rank: 1 }); me.rank = 2; // a moment later it's ahead
    drive(me, ctxOf(t, [me, other], 101));
    assert.strictEqual(state(me).passCar, other, 'not attacking the car that just passed');
    assert.ok(state(me).passSide !== 0);
});

test('no dive into a car already turned in: past the turn-in with them ahead, the move is called off', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, ph = t.racingLine.phase;
    let i = 0; for (let k = 1; k < ph.length; k++) if (ph[k] === 1 && ph[k - 1] === 2) { i = k; break; }
    const j = ahead(t, i, 7);
    const me = mk(t, i, t.racingLine.offset[i] / t.scale - 2.5, 30, { ai: { pace: 1, aggression: 0.95, mistake: 0, reaction: 0 }, rank: 2 });
    const them = mk(t, j, t.racingLine.offset[j] / t.scale, 28, { rank: 1 });
    const b = state(me);
    b.passSide = -1; b.passCar = them; b.prevPhase = 1;
    drive(me, ctxOf(t, [me, them], 100));
    assert.strictEqual(b.passSide, 0, 'kept diving at a car already in the corner');
});

test('a bot far over its corner speed brakes even with the wheel at full lock (Monaco, run wide off a passing move)', () => {
    const { drive } = require('../src/game/bots/driver');
    const t = tracks.monaco, total = t.cum[t.path.length];
    const i = t.cum.findIndex((c) => c >= (t.startS + 2875 * t.scale) % total); // 20 m before the corner after the pool
    const me = mk(t, i, t.racingLine.offset[i] / t.scale + 3.4, 28.5, { ai: { pace: 1, aggression: 0.5, mistake: 0, reaction: 0 } });
    const out = drive(me, ctxOf(t, [me], 150));
    assert.ok(out.brake >= 0.5, `brake ${out.brake.toFixed(2)}, steer ${out.steer.toFixed(2)}, at 28.5 m/s for a ${t.lineLimit[i]} m/s corner`);
});

test('opening lap (after turn 1): a pro bot races calmer, no move from as far back as later in the race', () => {
    const { drive, state, ahead } = require('../src/game/bots/driver');
    const t = tracks.monza, i = 100, j = ahead(t, i, 30); // ~36 m behind a car 8 m/s slower (in reach at 33 m/s only later in the race)
    const moves = (lap) => {
        const me = mk(t, i, t.racingLine.offset[i] / t.scale, 33, { id: 'me', lap, rank: 2, ai: { level: 'pro', pace: 1, aggression: 0.95, mistake: 0, reaction: 0 } });
        const slow = mk(t, j, t.racingLine.offset[j] / t.scale, 25, { id: 'slow', lap, rank: 1 });
        drive(me, ctxOf(t, [me, slow], 50));
        return state(me).passSide !== 0;
    };
    assert.strictEqual(t.racingLine.phase[i], 0, 'test point on a straight');
    assert.strictEqual(moves(2), true, 'lap 2: goes for it');
    assert.strictEqual(moves(0), false, 'opening lap: waits until closer');
    // In the opening lap's nose-to-tail train every car has a tow: that alone is no reason to pull out
    const towed = (lap) => {
        const k = ahead(t, i, 15), me = mk(t, i, t.racingLine.offset[i] / t.scale, 33, { id: 'me', lap, rank: 2, tow: 0.1, ai: { level: 'pro', pace: 1, aggression: 0.95, mistake: 0, reaction: 0 } });
        const front = mk(t, k, t.racingLine.offset[k] / t.scale, 34.5, { id: 'front', lap, rank: 1 });
        drive(me, ctxOf(t, [me, front], 50));
        return state(me).passSide !== 0;
    };
    assert.strictEqual(towed(2), true, 'lap 2: the tow is the move');
    assert.strictEqual(towed(0), false, 'opening lap: a tow in the train is not');
});

test('a bot queued at the pit entry behind a stopped car holds still, never reverses into the queue (Spa Bus Stop)', () => {
    const { drive } = require('../src/game/bots/driver');
    const t = Track.load('spa'), sc = t.scale;
    const g = new Game(io, fillGrid([], 'pro', 3, 2), t, { ...RACE, formationLap: false }, () => {});
    g.update(); g.release();
    const [me, front] = Object.values(g.players);
    const put = (p, m) => { const q = Track.pointAt(t.path, t.cum, t.pit.entryS - m * sc); Object.assign(p, { x: q.x, y: q.y, angle: q.angle, vx: 0, vy: 0, speed: 0, lapS: t.pit.entryS - t.startS - m * sc }); };
    put(me, 20); put(front, 12);
    me.boxCall = 'this';
    const ctx = { track: t, cars: [me, front], mode: 'race', time: 300, dt: 1 / 60, rng: () => 0.5, frozen: false, toEntryM: (p) => g.toEntryM(p) };
    assert.ok(g.toEntryM(me) < 30, `${g.toEntryM(me)} m to the entry`);
    assert.strictEqual(drive(me, ctx).brake, 0, 'brake at a standstill reverses');
});

// Room for a car alongside is given inside the white lines: applied after the lane limits it aimed a bot past the line,
// into Spa's pit mouth (an unplanned stop, a third compound, a pit-line penalty)
test('a bot giving room to a car alongside never aims off the track', () => {
    const { drive } = require('../src/game/bots/driver'), Drive = require('../public/js/sim/drive.js');
    const t = tracks.monza, i = 300, sc = t.scale, e = t.edgeR[i] / sc;
    const me = mk(t, i, e - 1.0, 60, { id: 'me', ai: { pace: 1, aggression: 0.5, mistake: 0, reaction: 0 }, steer: 0, tyreGrip: 1, assist: { steer: 1, brake: 0 } });
    Object.assign(me, { vx: Math.cos(me.angle) * me.speed, vy: Math.sin(me.angle) * me.speed });
    let worst = -Infinity;
    for (let k = 0; k < 120; k++) {
        const n = Physics.nearestOnTrack(me.x, me.y, t), P = t.path[n.i], Q = t.path[(n.i + 1) % t.path.length], h = Math.atan2(Q.y - P.y, Q.x - P.x);
        const lat = (-Math.sin(h) * (me.x - n.px) + Math.cos(h) * (me.y - n.py)) / sc; // + = right
        worst = Math.max(worst, lat - Track.edgeAt(t, n, me.x, me.y) / sc);
        const side = { ...mk(t, n.i, lat - 0.4, me.speed / sc, { id: 'side', rank: 2 }), x: me.x - Math.sin(h) * -0.4 * sc, y: me.y + Math.cos(h) * -0.4 * sc, angle: me.angle };
        me.input = drive(me, ctxOf(t, [me, side], 50 + k / 60));
        Drive.driveCar(me, me.input, t, 1 / 60);
    }
    assert.ok(worst <= 0, `centre ${worst.toFixed(2)} m past the white line`);
});

// In the pit lane, gaps are measured along the lane: along the track, Interlagos' exit lane (25-42 m outside a bend) put
// 40 m of lane on 18 m of track; cars 12 m apart read as touching and the queue braked to a standstill for 12 s
test('pit lane traffic is measured along the lane', () => {
    const { scan } = require('../src/game/bots/driver'), t = Track.load('interlagos'), pit = t.pit, sc = t.scale;
    const at = (m) => { const q = Track.pointAt(pit.path, pit.cum, m * sc, false); return { x: q.x, y: q.y, angle: q.angle, inPit: true, speed: 10 * sc, lap: 1, rank: 2, tyreGrip: 1 }; };
    const me = { ...at(800), id: 'me', ai: { pace: 1, aggression: 0.5 } }, o = { ...at(812), id: 'o' };
    const r = scan(me, ctxOf(t, [me, o], 50), 10);
    assert.ok(r.ahead && Math.abs(r.ahead.f - 12) < 1, `ahead at ${r.ahead?.f.toFixed(2)} m`);
    assert.ok(!r.alongside, 'not alongside');
});

// Off the line nobody starts a pass in the first moments: every car ahead is "slower" while the grid pulls away, and a
// swing into the other column put each car 7.6 m behind its neighbour there, capped to its ~0 m/s: the field stopped
test('standing start: the field pulls away, nobody parks behind the car alongside-ahead', () => {
    const t = Track.load('sakhir'), g = new Game(io, fillGrid([], 'easy', 3, 22), t, { ...RACE, maxLaps: 2, rng: rngOf(1) });
    g.update(); g.release();
    const parked = {};
    let worst = 0;
    for (let k = 0; k < 60 * 15; k++) {
        g.update();
        if (g.frozen) continue;
        for (const p of Object.values(g.players)) {
            parked[p.id] = g.time > (p.ai.reaction || 0) + 0.5 && Math.abs(p.speed) / t.scale < 0.5 ? (parked[p.id] || 0) + 1 / 60 : 0;
            worst = Math.max(worst, parked[p.id]);
        }
    }
    assert.ok(worst < 2, `a car sat still ${worst.toFixed(1)} s after the start`);
});

// Slowing for a car ahead in mid-corner goes through the grip-aware pedals: the "far over the target" full brake read the
// traffic cap as the target, and full brake on top of full lock slid cars off Suzuka's esses (13-22 a race)
test('suzuka esses: bots held up mid-corner stay on the track', () => {
    const t = Track.load('suzuka'), g = new Game(io, fillGrid([], 'pro', 3, 22), t, { maxLaps: 5, qualifying: false, rng: rngOf(2) });
    g.update(); g.release();
    let offs = 0;
    const was = {};
    for (let k = 0; k < 60 * 240; k++) {
        g.update();
        for (const p of Object.values(g.players)) {
            const n = Physics.nearestOnTrack(p.x, p.y, t), off = n.dist > Track.edgeAt(t, n, p.x, p.y) + 1 * t.scale;
            if (off && !was[p.id] && n.i >= 226 && n.i <= 240 && !p.inPit) offs++;
            was[p.id] = off;
        }
    }
    assert.ok(offs <= 2, `${offs} offs in the esses`);
});

// The path-speed limit reads the line's calibration as the speed target does: on the line's calibrated speed with a lane
// just off it (0.3-1 m, every lane change), the raw grip-model corner speed (up to 23 % lower) braked a bot flat out mid-Copse
test('a bot a little off the line through a fast corner brakes no harder than on it', () => {
    const { drive } = require('../src/game/bots/driver'), t = Track.load('silverstone'), i = 38, sc = t.scale, v = t.racingLine.speed[i + 2];
    const brakeAt = (lane) => {
        const me = mk(t, i, t.racingLine.offset[i] / sc + lane, v, { id: 'me', ai: { pace: 1, aggression: 0.5, mistake: 0, reaction: 0 }, steer: 0, assist: { steer: 1, brake: 0 } });
        Object.assign(me, { vx: Math.cos(me.angle) * me.speed, vy: Math.sin(me.angle) * me.speed });
        me.bot = { idx: null, lane, passSide: 0, defend: 0, defended: false, err: null, prevPhase: 0, followS: 0, press: false, wantPit: false, bog: false };
        return drive(me, ctxOf(t, [me], 50)).brake;
    };
    const on = brakeAt(0), off = brakeAt(0.6);
    assert.ok(off <= on + 0.05, `brake ${off.toFixed(2)} at 0.6 m off the line, ${on.toFixed(2)} on it`);
});

// The follow cap's "their speed" is along the track: a car reversing at me isn't moving away
test('a bot right behind a car reversing at it does not drive into it', () => {
    const { drive, ahead } = require('../src/game/bots/driver'), t = tracks.monza, i = 300, sc = t.scale, off = t.racingLine.offset[i] / sc;
    const me = mk(t, i, off, 0, { id: 'me', ai: { pace: 1, aggression: 0, mistake: 0, reaction: 0 } });
    Object.assign(me, { vx: 0, vy: 0 });
    const j = ahead(t, i, 7.6), front = mk(t, j, t.racingLine.offset[j] / sc, -3, { id: 'f', rank: 2 }); // 2 m bumper gap, reversing at 3 m/s
    Object.assign(front, { vx: Math.cos(front.angle) * -3 * sc, vy: Math.sin(front.angle) * -3 * sc });
    const input = drive(me, ctxOf(t, [me, front], 50));
    assert.strictEqual(input.throttle, 0, `throttle ${input.throttle}`);
});
