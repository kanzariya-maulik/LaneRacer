const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
const CarPhysics = require('../src/game/CarPhysics');

const io = { emit() {}, volatile: { emit() {} } };
const monza = Track.load('monza');
const lp = (id, teamId = 'ferrari') => ({ id, username: id.toUpperCase(), teamId });
const RACE = { maxLaps: 3, qualiMinutes: 0 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

// Teleport p through checkpoints in order; each call to lap() ends on the start line
function crossLine(g, p, t) {
    g.time = t;
    const cp = g.track.checkpoints[0];
    p.x = cp.x; p.y = cp.y;
    g.checkLapProgress(p);
}
function lap(g, p, startTime, seconds) {
    const cps = g.track.checkpoints;
    for (let k = 1; k <= cps.length; k++) {
        const target = (p.checkpoint + 1) % cps.length;
        g.time = startTime + (seconds * k) / cps.length;
        p.x = cps[target].x; p.y = cps[target].y;
        g.checkLapProgress(p);
    }
}

test('rankPlayers: finished by finish order, then lap, checkpoint, distance to next', () => {
    const cps = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
    const players = [
        { id: 'a', lap: 0, checkpoint: 1, x: 150, y: 0, finished: false },
        { id: 'b', lap: 1, checkpoint: 0, x: 0, y: 0, finished: false },
        { id: 'c', lap: 0, checkpoint: 1, x: 110, y: 0, finished: false },
        { id: 'd', lap: 3, checkpoint: 0, x: 0, y: 0, finished: true, finishOrder: 2 },
        { id: 'e', lap: 3, checkpoint: 0, x: 0, y: 0, finished: true, finishOrder: 1 },
    ];
    assert.deepStrictEqual(Game.rankPlayers(players, cps).map(p => p.id), ['e', 'd', 'b', 'a', 'c']);
});

test('players start on grid slots at rest', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    assert.strictEqual(g.players.a.x, monza.startPositions[0].x);
    assert.strictEqual(g.players.b.y, monza.startPositions[1].y);
    assert.strictEqual(g.players.a.angle, monza.startPositions[0].angle);
    assert.strictEqual(g.players.a.vx, 0);
    assert.strictEqual(g.players.a.teamId, 'ferrari');
});

test('race cars stay put before lights out even at full throttle, then drive', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const a = g.players.a, x0 = a.x, y0 = a.y;
    g.handleInput('a', { throttle: 1, brake: 0, steer: 0 });
    for (let i = 0; i < 60; i++) g.update();
    assert.strictEqual(a.x, x0);
    assert.strictEqual(a.y, y0);
    g.release();
    for (let i = 0; i < 60; i++) g.update();
    assert.ok(Math.hypot(a.x - x0, a.y - y0) > 3 * monza.scale, 'should launch > 3 m in 1 s');
});

test('removing last unfinished racer ends race', () => {
    let finishedCalls = 0;
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => finishedCalls++);
    g.release();
    g.players.a.finished = true;
    g.update();
    assert.strictEqual(finishedCalls, 0);
    g.removePlayer('b');
    g.update();
    assert.strictEqual(finishedCalls, 1);
});

test('game_state fields', () => {
    let sent = null;
    const spyIo = { emit() {}, volatile: { emit: (ev, data) => { if (ev === 'game_state') sent = data; } } };
    const g = new Game(spyIo, [lp('a')], monza, RACE, () => {});
    g.update();
    assert.deepStrictEqual(Object.keys(sent.a).sort(),
        ['angle', 'bestLap', 'checkpoint', 'curLap', 'finished', 'gap', 'ghost', 'inPit', 'lap', 'lapsDown', 'lastLap', 'limiter', 'rank', 'speed', 'steer', 'x', 'y']);
    assert.strictEqual(sent.a.rank, 1);
    assert.strictEqual(sent.a.ghost, false);
});

test('initPayload carries players, track and mode', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {}, 'quali');
    const p = g.initPayload();
    assert.strictEqual(p.track.id, 'monza');
    assert.strictEqual(p.mode, 'quali');
    assert.ok(p.players.a);
});

test('quali cars are ghosts; race cars collide; finished race cars are not pushed', () => {
    for (const [mode, expectMoved] of [['quali', false], ['race', true]]) {
        const g = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 1, qualiMinutes: 1 }, () => {}, mode);
        g.release();
        const { a, b } = g.players;
        b.x = a.x + 1; b.y = a.y; b.angle = a.angle;
        const bx = b.x;
        g.update();
        assert.strictEqual(Math.abs(b.x - bx) > 1e-6, expectMoved, mode);
    }
    const g = new Game(io, [lp('a'), lp('b')], monza, RACE, () => {});
    g.release();
    const { a, b } = g.players;
    b.x = a.x + 1; b.y = a.y; b.angle = a.angle; b.finished = true;
    const bx = b.x;
    g.update();
    assert.strictEqual(b.x, bx);
});

test('wall hit at speed: car ends inside the wall line, finite, slowed', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const a = g.players.a;
    const wall = monza.width / 2 + 80;
    // Put the car just past the wall, heading straight out at 300 km/h
    const n = Physics.nearestOnTrack(a.x, a.y, monza);
    const k = monza.pit.trackSide; // away from the pit lane, which sits on the other side of the straight
    const dirX = -Math.sin(a.angle) * k, dirY = Math.cos(a.angle) * k;
    a.x = n.px + dirX * (wall + 5); a.y = n.py + dirY * (wall + 5);
    a.vx = dirX * (300 / 3.6) * monza.scale; a.vy = dirY * (300 / 3.6) * monza.scale;
    g.update();
    const after = Physics.nearestOnTrack(a.x, a.y, monza);
    assert.ok(after.dist <= wall, `${after.dist} > ${wall}`);
    assert.ok([a.x, a.y, a.vx, a.vy].every(Number.isFinite));
    assert.ok(Math.hypot(a.vx, a.vy) < 0.5 * (300 / 3.6) * monza.scale);
});

test('race lap times are recorded from lights out', () => {
    const events = [];
    const spyIo = { emit: (ev, d) => { if (ev === 'timing') events.push(d); }, volatile: { emit() {} } };
    const g = new Game(spyIo, [lp('a')], monza, RACE, () => {});
    g.release();
    const a = g.players.a;
    lap(g, a, 0, 85);
    close(a.lastLap, 85);
    lap(g, a, 85, 82);
    close(a.bestLap, 82);
    assert.deepStrictEqual(events.map(e => e.lap), [1, 2]);
});

test('race gap = time difference at the last checkpoint both passed; lapped cars show laps down', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c')], monza, { maxLaps: 5, qualiMinutes: 0 }, () => {});
    const { a, b, c } = g.players;
    Object.assign(a, { lap: 1, checkpoint: 3, progress: 19, passTimes: { 18: 96, 19: 100 } });
    Object.assign(b, { lap: 1, checkpoint: 2, progress: 18, passTimes: { 18: 97.5 } });
    Object.assign(c, { lap: 0, checkpoint: 2, progress: 2, passTimes: { 2: 20 } });
    g.updateRanks();
    assert.deepStrictEqual([a.rank, b.rank, c.rank], [1, 2, 3]);
    assert.strictEqual(a.gap, null);
    close(b.gap, 1.5);
    assert.strictEqual(c.lapsDown, 1);
    assert.strictEqual(c.gap, null);
});

test('quali: best lap sets order, no-time drivers last in join order', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c'), lp('d')], monza, { maxLaps: 3, qualiMinutes: 3 }, () => {}, 'quali');
    const P = g.players;
    crossLine(g, P.a, 10); lap(g, P.a, 10, 95); lap(g, P.a, 105, 92);
    crossLine(g, P.b, 12); lap(g, P.b, 12, 90);
    assert.deepStrictEqual(Game.qualiOrder(Object.values(P)).map(p => p.id), ['b', 'a', 'c', 'd']);
    close(P.a.bestLap, 92);
    g.updateRanks();
    close(P.a.gap, 2);
});

test('quali: lap started before the flag counts, then that car is done', () => {
    const g = new Game(io, [lp('a')], monza, { maxLaps: 3, qualiMinutes: 1 }, () => {}, 'quali'); // flag at 60 s
    const a = g.players.a;
    crossLine(g, a, 5);
    lap(g, a, 5, 50);          // ends at 55 s, before the flag
    assert.strictEqual(a.finished, false);
    lap(g, a, 55, 40);         // started before the flag, ends at 95 s
    close(a.lastLap, 40);
    assert.strictEqual(a.finished, true);
    lap(g, a, 95, 30);         // after taking the flag nothing is timed
    close(a.bestLap, 40);
});

test('quali ends when everyone has taken the flag, or 150 s after it', () => {
    let results = null;
    const g = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 3, qualiMinutes: 1 }, (r) => { results = r; }, 'quali');
    g.players.a.finished = true;
    g.players.b.checkpoint = 7; // grid slots sit inside checkpoint 0's radius; keep b mid-lap so it doesn't take the flag
    g.time = 100;
    g.update();
    assert.strictEqual(results, null);
    g.time = 60 + 150 - g.dt / 2;
    g.update();
    assert.deepStrictEqual(results.map(r => r.id), ['a', 'b']);

    let all = null;
    const g2 = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 3, qualiMinutes: 1 }, (r) => { all = r; }, 'quali');
    g2.players.a.finished = true;
    g2.players.b.finished = true;
    g2.update();
    assert.ok(all);
});

test('grazing the wall at a shallow angle keeps most of the speed; head-on does not', () => {
    for (const [deg, check] of [[5, (kept) => kept > 0.85], [90, (kept) => kept < 0.5]]) {
        const g = new Game(io, [lp('a')], monza, RACE, () => {});
        g.release();
        const a = g.players.a;
        const wall = monza.width / 2 + 80;
        const n = Physics.nearestOnTrack(a.x, a.y, monza);
        const k = monza.pit.trackSide; // away from the centreline, on the side without the pit lane
        const out = { x: -Math.sin(a.angle) * k, y: Math.cos(a.angle) * k };
        const along = { x: Math.cos(a.angle), y: Math.sin(a.angle) };
        const r = (deg * Math.PI) / 180, v = (300 / 3.6) * monza.scale;
        a.x = n.px + out.x * (wall + 2); a.y = n.py + out.y * (wall + 2);
        a.vx = (along.x * Math.cos(r) + out.x * Math.sin(r)) * v;
        a.vy = (along.y * Math.cos(r) + out.y * Math.sin(r)) * v;
        a.angle = Math.atan2(a.vy, a.vx);
        g.update();
        assert.ok(check(Math.hypot(a.vx, a.vy) / v), `${deg}°: kept ${Math.hypot(a.vx, a.vy) / v}`);
    }
});

const box = (team, i = 0) => monza.pit.garages.find(g => g.teamId === team).boxes[i];
function place(p, at, speedMs = 0) {
    p.x = at.x; p.y = at.y; p.angle = at.angle;
    p.vx = Math.cos(at.angle) * speedMs * monza.scale;
    p.vy = Math.sin(at.angle) * speedMs * monza.scale;
    p.speed = speedMs * monza.scale;
}
const kmh = (p) => (Math.hypot(p.vx, p.vy) / monza.scale) * 3.6;
const FULL = { throttle: 1, brake: 0, steer: 0 };

test('pit limiter holds 80 km/h at full throttle in the limiter zone', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, box('ferrari'), 40);
    p.input = FULL;
    for (let k = 0; k < 60; k++) {
        g.drive(p);
        assert.ok(kmh(p) <= 80 + 1e-6, `${kmh(p).toFixed(1)} km/h`);
    }
    assert.ok(p.inPit && p.limiter);
    assert.ok(kmh(p) > 79, 'limiter should hold the limit, not stop the car');
});

test('no limiter on the track', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, monza.start, 60);
    p.input = FULL;
    for (let k = 0; k < 10; k++) g.drive(p);
    assert.ok(!p.inPit && !p.limiter);
    assert.ok(kmh(p) > 200);
});

test('pit lane is asphalt, not grass', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    const c = monza.pit.garages[5];
    place(p, c, 0);
    p.input = FULL;
    const ref = { ...p };
    for (let k = 0; k < 30; k++) {
        g.drive(p);
        CarPhysics.step(ref, FULL, g.dt, monza.scale, false);
    }
    close(p.speed, ref.speed);
});

test('racing line beside the pit entry is not the pit lane', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    const e = monza.pit.path[3];
    const c = Physics.nearestOnTrack(e.x, e.y, monza);
    p.x = c.px; p.y = c.py;
    g.updatePit(p);
    assert.ok(!p.inPit && !p.limiter);
});

test('pit wall blocks the straight → pit and pit → straight', () => {
    const w = monza.pit.wall[monza.pit.wall.length >> 1];
    const c = Physics.nearestOnTrack(w.x, w.y, monza);
    const wallOff = Physics.nearestOnTrack(w.x, w.y, monza).dist;
    const toPit = Math.atan2(w.y - c.py, w.x - c.px);

    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, { x: c.px, y: c.py, angle: toPit }, 30);
    p.input = FULL;
    for (let k = 0; k < 120; k++) {
        g.drive(p);
        assert.ok(!p.inPit, 'car got into the pit lane');
    }
    assert.ok(Physics.nearestOnTrack(p.x, p.y, monza).dist < wallOff);

    const q = Physics.nearestOnPath(w.x, w.y, monza.pit.path, false);
    place(p, { x: q.px, y: q.py, angle: toPit + Math.PI }, 20);
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.ok(Physics.nearestOnTrack(p.x, p.y, monza).dist > wallOff, 'car got out of the pit lane through the wall');
});

test('game_state carries inPit and limiter', () => {
    let sent = null;
    const io2 = { emit() {}, volatile: { emit(ev, d) { sent = d; } } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.release();
    place(g.players.a, box('haas'), 0);
    g.update();
    assert.strictEqual(sent.a.inPit, true);
    assert.strictEqual(sent.a.limiter, true);
});

test('tracks without a pit lane still drive', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: Math.cos(i / 50 * Math.PI) * 3000, y: Math.sin(i / 50 * Math.PI) * 3000 }));
    const ring = Track.build({ id: 'ring', name: 'Ring', scale: 6, width: 80, path: pts });
    const g = new Game(io, [lp('a')], ring, RACE, () => {});
    g.release();
    g.players.a.input = FULL;
    g.update();
    assert.ok(g.players.a.speed > 0);
    assert.strictEqual(g.players.a.inPit, false);
});

const QUALI = { maxLaps: 3, qualiMinutes: 1 };

test('quali cars start in their own garage box, at rest, facing pit exit', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c', 'haas')], monza, QUALI, () => {}, 'quali');
    for (const [id, b] of [['a', box('ferrari', 0)], ['b', box('ferrari', 1)], ['c', box('haas', 0)]]) {
        const p = g.players[id];
        assert.deepStrictEqual([p.x, p.y, p.angle, p.speed], [b.x, b.y, b.angle, 0], id);
    }
});

test('quali: a team with no garage starts in the first garage', () => {
    const g = new Game(io, [lp('z', 'nope')], monza, QUALI, () => {}, 'quali');
    assert.strictEqual(g.players.z.x, monza.pit.garages[0].boxes[0].x);
});

test('race cars still start on the grid', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    assert.strictEqual(g.players.a.x, monza.startPositions[0].x);
});

test('quali: out-lap from the garage; timing starts at the first line crossing after pit exit', () => {
    // redbull-suzuka is the last garage, before the line, so the car crosses the line in the pit lane
    const g = new Game(io, [lp('a', 'redbull-suzuka')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a, pit = monza.pit;
    const from = Physics.nearestOnPath(p.x, p.y, pit.path, false).i;
    let crossed = false;
    for (let i = from; i < pit.path.length; i++) {
        g.time = i * 0.1;
        p.x = pit.path[i].x; p.y = pit.path[i].y;
        g.updatePit(p);
        const before = p.checkpoint;
        g.checkLapProgress(p);
        if (before !== p.checkpoint && p.checkpoint === 0) crossed = true;
        if (p.inPit) assert.strictEqual(p.lapStart, null, 'timing started in the pit lane');
    }
    assert.ok(crossed, 'car never crossed the line in the pit lane');
    assert.ok(!p.inPit);
    lap(g, p, 20, 30); // before the 60 s flag
    assert.notStrictEqual(p.lapStart, null, 'timing never started');
    assert.strictEqual(p.lastLap, null, 'out-lap must not be timed');
});

test('quali: crossing the pit entry line cancels the timed lap', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a;
    p.x = monza.start.x; p.y = monza.start.y;
    g.updatePit(p);
    p.lapStart = 3;
    g.time = 50;
    const b = box('haas');
    p.x = b.x; p.y = b.y;
    g.updatePit(p);
    assert.strictEqual(p.lapStart, null);
});

test('race: a lap through the pit lane counts even where checkpoints are out of reach of the pit', () => {
    const tight = { ...monza, checkpoints: monza.checkpoints.map(c => ({ ...c, radius: 5 * monza.scale })) };
    const g = new Game(io, [lp('a')], tight, RACE, () => {});
    g.release();
    const p = g.players.a;
    p.checkpoint = tight.checkpoints.length - 1;
    monza.pit.path.forEach((q, i) => {
        g.time = 60 + i * 0.1;
        p.x = q.x; p.y = q.y;
        g.updatePit(p);
        g.checkLapProgress(p);
    });
    assert.strictEqual(p.lap, 1);
});
