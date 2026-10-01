const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
const CarPhysics = require('../src/game/CarPhysics');

const io = { emit() {}, volatile: { emit() {} } };
const monza = Track.load('monza');
const lp = (id, teamId = 'ferrari') => ({ id, username: id.toUpperCase(), teamId });
const RACE = { maxLaps: 3, qualifying: false };
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

test('race cars wait on the grid without input, then launch at lights out', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const a = g.players.a, x0 = a.x, y0 = a.y;
    for (let i = 0; i < 60; i++) g.update();
    assert.strictEqual(a.x, x0);
    assert.strictEqual(a.y, y0);
    g.release();
    g.handleInput('a', { throttle: 1, brake: 0, steer: 0 });
    for (let i = 0; i < 60; i++) g.update();
    assert.ok(Math.hypot(a.x - x0, a.y - y0) > 3 * monza.scale, 'should launch > 3 m in 1 s');
    assert.strictEqual(a.penalty, 0);
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
        ['angle', 'bestLap', 'bestLapSectors', 'checkpoint', 'curLap', 'finished', 'gap', 'ghost', 'inPit', 'lap', 'lapValid', 'lapsDown', 'lastLap', 'lastValid', 'limiter', 'penalty', 'rank', 'speed', 'steer', 'x', 'y']);
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
        const g = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 1, qualifying: true }, () => {}, mode);
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
    const g = new Game(io, [lp('a'), lp('b'), lp('c')], monza, { maxLaps: 5, qualifying: false }, () => {});
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
    const g = new Game(io, [lp('a'), lp('b'), lp('c'), lp('d')], monza, { maxLaps: 3, qualifying: true }, () => {}, 'quali');
    const P = g.players;
    crossLine(g, P.a, 10); lap(g, P.a, 10, 95); lap(g, P.a, 105, 92);
    crossLine(g, P.b, 12); lap(g, P.b, 12, 90);
    assert.deepStrictEqual(Game.qualiOrder(Object.values(P)).map(p => p.id), ['b', 'a', 'c', 'd']);
    close(P.a.bestLap, 92);
    g.updateRanks();
    close(P.a.gap, 2);
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

const QUALI = { maxLaps: 3, qualifying: true };

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

test('car just off the straight before the pit wall starts is not limited', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a, pit = monza.pit;
    const i = pit.cum.findIndex(c => c >= 80 * monza.scale); // inside 60 m limiter line, before the wall
    const q = pit.path[i], c = Physics.nearestOnTrack(q.x, q.y, monza);
    const d = Math.hypot(q.x - c.px, q.y - c.py);
    const off = monza.width / 2 + 1 * monza.scale;
    p.x = c.px + ((q.x - c.px) / d) * off; p.y = c.py + ((q.y - c.py) / d) * off;
    p.lapStart = 3;
    g.updatePit(p);
    assert.ok(!p.limiter, 'limiter on beside the track with no pit wall');
    assert.strictEqual(p.lapStart, 3);
});

test('quali: out-lap, then two timed laps, then the car is parked', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a;
    crossLine(g, a, 10);                    // end of the out-lap: timing starts
    assert.strictEqual(a.lapStart, 10);
    lap(g, a, 10, 90);
    close(a.lastLap, 90);
    assert.strictEqual(a.finished, false);
    lap(g, a, 100, 88);
    close(a.lastLap, 88);
    assert.strictEqual(a.finished, true, 'two flying laps should end the run');
    assert.strictEqual(a.lap, 2);
    close(a.bestLap, 88);
    a.input = { throttle: 1, brake: 0, steer: 0 };
    const x = a.x;
    g.update();
    assert.strictEqual(a.x, x, 'parked car moved');
    assert.strictEqual(a.speed, 0);
});

test('quali ends when every car is done, or 6 minutes after the start', () => {
    let results = null;
    const g = new Game(io, [lp('a'), lp('b')], monza, QUALI, (r) => { results = r; }, 'quali');
    g.players.a.finished = true;
    g.time = 300;
    g.update();
    assert.strictEqual(results, null);
    g.time = 360;
    g.update();
    assert.deepStrictEqual(results.map(r => r.id), ['a', 'b']);

    let all = null;
    const g2 = new Game(io, [lp('a'), lp('b')], monza, QUALI, (r) => { all = r; }, 'quali');
    g2.players.a.finished = true;
    g2.players.b.finished = true;
    g2.update();
    assert.ok(all);
});

test('quali session clock is the 6-minute cap', () => {
    const sessions = [];
    const io2 = { emit(ev, d) { if (ev === 'session') sessions.push(d); }, volatile: { emit() {} } };
    const g = new Game(io2, [lp('a')], monza, QUALI, () => {}, 'quali');
    g.start();
    g.stop();
    assert.deepStrictEqual(sessions, [{ phase: 'QUALIFYING', endsInMs: 360000 }]);
});

const pitS = (p) => {
    const n = Physics.nearestOnPath(p.x, p.y, monza.pit.path, false);
    return monza.pit.cum[n.i] + n.t * (monza.pit.cum[n.i + 1] - monza.pit.cum[n.i]);
};
const pitPoint = (s) => Track.pointAt(monza.pit.path, monza.pit.cum, s, false);

test('pit entry is closed: driving up the pit lane stops before the garages', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    place(p, pitPoint(monza.pit.closeS - 30 * monza.scale), 20);
    p.input = FULL;
    for (let k = 0; k < 180; k++) {
        g.drive(p);
        assert.ok(pitS(p) < monza.pit.closeS, 'car got past the pit entry barrier');
    }
});

test('garage cars still drive out of the pit lane', () => {
    const g = new Game(io, [lp('a', 'redbull-suzuka')], monza, QUALI, () => {}, 'quali');
    const p = g.players.a, s0 = pitS(p);
    p.input = FULL;
    for (let k = 0; k < 120; k++) g.drive(p);
    assert.ok(pitS(p) - s0 > 10 * monza.scale, 'garage car could not drive off');
});

test('racing line past the pit entry is not blocked', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    const e = monza.pit.path[3], c = Physics.nearestOnTrack(e.x, e.y, monza);
    const ahead = Track.pointAt(monza.path, monza.cum, monza.cum[c.i]);
    place(p, { x: c.px, y: c.py, angle: ahead.angle }, 70);
    const x0 = p.x, y0 = p.y;
    for (let k = 0; k < 60; k++) g.drive(p);
    assert.ok(Math.hypot(p.x - x0, p.y - y0) / monza.scale > 50, 'track car was stopped by the pit barrier');
});

function spy() {
    const events = [];
    return { events, io: { emit: (ev, d) => events.push([ev, d]), volatile: { emit() {} } } };
}
const sectorsOf = (events, id) => events.filter(([ev, d]) => ev === 'sector' && d.id === id).map(([, d]) => d);

test('sectors: three per lap, adding up to the lap time, with personal and session bests', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a'), lp('b')], monza, QUALI, () => {}, 'quali');
    const { a, b } = g.players;
    crossLine(g, a, 10);
    lap(g, a, 10, 90);
    const s = sectorsOf(events, 'a');
    assert.deepStrictEqual(s.map(x => x.sector), [1, 2, 3]);
    close(s.reduce((sum, x) => sum + x.time, 0), 90);
    assert.ok(s.every(x => x.valid && x.personalBest && x.sessionBest));
    assert.deepStrictEqual(a.bestLapSectors, s.map(x => x.time));

    crossLine(g, b, 12);
    lap(g, b, 12, 80);
    assert.ok(sectorsOf(events, 'b').every(x => x.sessionBest), 'faster lap should set session bests');
    lap(g, a, 100, 95);
    const slow = sectorsOf(events, 'a').slice(3);
    assert.ok(slow.every(x => !x.personalBest && !x.sessionBest));
});

test('sectors: an invalid lap never sets a best; the out-lap is untimed', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a;
    a.checkpoint = 0; // on the out-lap, crossing sector lines before the start line
    lap(g, a, 0, 60);
    assert.strictEqual(sectorsOf(events, 'a').length, 0, 'out-lap produced sector times');
    lap(g, a, 60, 90);
    a.lapValid = false;
    lap(g, a, 150, 85);
    const bad = sectorsOf(events, 'a').filter(x => x.lap === 2);
    assert.ok(bad.length === 3 && bad.every(x => !x.valid && !x.personalBest && !x.sessionBest));
    close(a.bestLap, 90);
    assert.strictEqual(a.lastValid, false);
    const timing = events.filter(([ev]) => ev === 'timing').map(([, d]) => d);
    assert.strictEqual(timing.at(-1).valid, false);
});

// A point beside Monza's start straight, on the side away from the pit lane, `m` metres from the centreline
const beside = (m) => {
    const s = monza.start, k = monza.pit.trackSide;
    return { x: s.x - Math.sin(s.angle) * k * m * monza.scale, y: s.y + Math.cos(s.angle) * k * m * monza.scale, angle: s.angle };
};
const halfM = monza.width / 2 / monza.scale;
function excursion(g, p) {
    for (const m of [0, halfM + 2, 0]) { // on track first so a previous excursion is re-armed
        const at = beside(m);
        p.x = at.x; p.y = at.y;
        g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    }
}

test('track limits: one violation per excursion, re-armed back on track', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a;
    const off = beside(halfM + 2);
    p.x = off.x; p.y = off.y;
    g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    assert.strictEqual(p.limits, 1);
    excursion(g, p);
    assert.strictEqual(p.limits, 2);
});

test('track limits: half a car past the line is not a violation', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a, at = beside(halfM + 0.5);
    p.x = at.x; p.y = at.y;
    g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    assert.strictEqual(p.limits, 0);
});

test('quali: leaving the track deletes the lap but it is still recorded', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a;
    crossLine(g, a, 10);
    excursion(g, a);
    assert.strictEqual(a.lapValid, false);
    assert.ok(events.some(([ev, d]) => ev === 'track_limits' && d.kind === 'deleted'));
    lap(g, a, 10, 80);
    close(a.lastLap, 80);
    assert.strictEqual(a.bestLap, null);
    lap(g, a, 90, 95);
    close(a.bestLap, 95);
});

test('track limits: quali out-lap and pit lane are exempt', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a; // out-lap: lapStart null
    excursion(g, a);
    a.lapStart = 5;
    a.inPit = true;
    const off = beside(halfM + 2);
    a.x = off.x; a.y = off.y;
    g.checkLimits(a, Physics.nearestOnTrack(a.x, a.y, monza));
    assert.strictEqual(a.lapValid, true);
});

test('race: two warnings, then +5 s per violation', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a;
    for (let k = 0; k < 4; k++) excursion(g, p);
    const kinds = events.filter(([ev]) => ev === 'track_limits').map(([, d]) => d);
    assert.deepStrictEqual(kinds.map(d => d.kind), ['warning', 'warning', 'penalty', 'penalty']);
    assert.deepStrictEqual(kinds.slice(0, 2).map(d => d.count), [1, 2]);
    assert.strictEqual(p.penalty, 10);
});

test('race result is re-sorted by finish time plus penalty', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas')], monza, { maxLaps: 1, qualifying: false }, () => {});
    g.release();
    const { a, b } = g.players;
    a.penalty = 10;
    lap(g, a, 0, 100);
    lap(g, b, 0, 105);
    assert.strictEqual(a.finishOrder, 1, 'a took the flag first');
    g.update();
    assert.strictEqual(b.finishOrder, 1);
    assert.strictEqual(a.finishOrder, 2);
    assert.strictEqual(b.rank, 1);
});

test('race classification works after a driver disconnects', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas')], monza, { maxLaps: 1, qualifying: false }, () => {});
    g.release();
    lap(g, g.players.a, 0, 100);
    g.removePlayer('b');
    g.update();
    assert.strictEqual(g.players.a.finishOrder, 1);
});

test('kerbs drive like asphalt; further out is grass', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    for (const [m, asphalt] of [[halfM + 1, true], [halfM + 3, false]]) {
        place(p, beside(m), 40);
        p.input = FULL;
        const ref = { ...p };
        g.drive(p);
        CarPhysics.step(ref, FULL, g.dt, monza.scale, false);
        assert.strictEqual(Math.abs(p.speed - ref.speed) < 1e-9, asphalt, `${m.toFixed(1)} m from the centre`);
    }
});

test('leaving the pit exit onto the track is not a track-limits violation', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a, pit = monza.pit;
    for (let i = pit.path.length - 30; i < pit.path.length; i++) {
        p.x = pit.path[i].x; p.y = pit.path[i].y;
        g.updatePit(p);
        g.checkLimits(p, Physics.nearestOnTrack(p.x, p.y, monza));
    }
    assert.strictEqual(p.limits, 0);
});

test('assist choice reaches the car', () => {
    const g = new Game(io, [{ ...lp('a'), assist: 'full' }, lp('b', 'haas')], monza, RACE, () => {});
    assert.strictEqual(g.players.a.assist, 'full');
    assert.strictEqual(g.players.b.assist, 'off');
});

for (const id of Track.TRACK_IDS) {
    test(`${id}: a car on the kerb beside the closed pit entry glances off and keeps at least half its speed`, () => {
        const tr = Track.load(id), pit = tr.pit;
        const cl = Track.pointAt(pit.path, pit.cum, pit.closeS, false);
        const c = Physics.nearestOnTrack(cl.x, cl.y, tr);
        const k = -pit.trackSide; // from the track toward the pit lane
        for (const offM of [0.5, 0.9, 1.2, 1.5]) {
            const s0 = tr.cum[c.i] - 60 * tr.scale;
            const q = Track.pointAt(tr.path, tr.cum, s0);
            const off = tr.width / 2 + offM * tr.scale;
            const g = new Game(io, [lp('a')], tr, RACE, () => {});
            // Flat out where it's flat out, otherwise 90% of the stretch's corner speed (Spa's pit entry is in a chicane)
            let safe = 80;
            for (let m = -60; m <= 40; m += 10) safe = Math.min(safe, 0.9 * tr.safeSpeed[Physics.nearestOnTrack(...Object.values(Track.pointAt(tr.path, tr.cum, tr.cum[c.i] + m * tr.scale)).slice(0, 2), tr).i]);
            const p = g.players.a, v = safe * tr.scale;
            Object.assign(p, { x: q.x - Math.sin(q.angle) * k * off, y: q.y + Math.cos(q.angle) * k * off, angle: q.angle,
                vx: Math.cos(q.angle) * v, vy: Math.sin(q.angle) * v, speed: v, input: { throttle: 1, brake: 0, steer: 0 } });
            // Hold the line `offM` past the edge: steer at a point 20 m ahead at the same offset
            for (let n = 0; n < 90; n++) {
                const near = Physics.nearestOnTrack(p.x, p.y, tr);
                const ah = Track.pointAt(tr.path, tr.cum, tr.cum[near.i] + 20 * tr.scale);
                const tx = ah.x - Math.sin(ah.angle) * k * off, ty = ah.y + Math.cos(ah.angle) * k * off;
                let d = Math.atan2(ty - p.y, tx - p.x) - p.angle;
                d = Math.atan2(Math.sin(d), Math.cos(d));
                p.input = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, d * 2)) };
                g.drive(p);
            }
            assert.ok(p.speed > 0.5 * v, `${offM} m past the line: ${(p.speed / tr.scale * 3.6).toFixed(0)} km/h left`);
        }
    });
}

test('the closed pit entry is not pit lane: no limiter, no exemption', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a, pit = monza.pit;
    const q = Track.pointAt(pit.path, pit.cum, pit.closeS - 20 * monza.scale, false);
    p.x = q.x; p.y = q.y;
    g.updatePit(p);
    assert.ok(!p.inPit && !p.limiter);
});

test('a sector from a lap deleted later is never a best', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a, cps = monza.checkpoints;
    crossLine(g, a, 10);
    for (let k = 1; k <= monza.sectorCps[1]; k++) { g.time = 10 + k; a.x = cps[k].x; a.y = cps[k].y; g.checkLapProgress(a); }
    assert.ok(sectorsOf(events, 'a')[0].sessionBest, 'S1 looked purple live');
    a.lapValid = false;                 // runs wide in S2
    lap(g, a, 10 + monza.sectorCps[1], 80);
    assert.deepStrictEqual(g.bestSectors, [null, null, null]);
    assert.deepStrictEqual(a.bestSectors, [null, null, null]);
    const timing = events.filter(([ev]) => ev === 'timing').map(([, d]) => d).at(-1);
    assert.deepStrictEqual(timing.sessionBest, [null, null, null]);
});

test('race: track limits warn or penalise but never delete the lap', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.release();
    const p = g.players.a;
    excursion(g, p);
    assert.strictEqual(p.limits, 1);
    assert.strictEqual(p.lapValid, true);
});

test('walls stop the car body, not just its centre: nothing pokes through the pit entry barrier', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.players.a, [a, b] = monza.pit.closeWall;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey);
    const nx = -ey / len, ny = ex / len;           // one side of the barrier
    const angle = Math.atan2(-ny, -nx);             // facing the barrier head-on
    const start = 12 * monza.scale;
    place(p, { x: mx + nx * start, y: my + ny * start, angle }, 15);
    p.input = FULL;
    for (let k = 0; k < 120; k++) g.drive(p);
    const d = (p.x - mx) * nx + (p.y - my) * ny;   // centre's distance in front of the barrier
    assert.ok(d >= Physics.CAR_HALF_LENGTH_M * monza.scale - 1, `nose ${((Physics.CAR_HALF_LENGTH_M * monza.scale - d) / monza.scale).toFixed(2)} m through the barrier`);
});

test('jump start: moving before lights out costs 5 s, once', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    p.input = FULL;
    for (let k = 0; k < 60; k++) g.update(); // lights still on
    assert.strictEqual(p.penalty, 5);
    assert.strictEqual(events.filter(([ev, d]) => ev === 'track_limits' && d.kind === 'jump').length, 1);
    assert.strictEqual(g.time, 0, 'race clock must not run before lights out');
});

test('waiting for the lights: no penalty, and the reaction time is reported', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a')], monza, RACE, () => {});
    const p = g.players.a;
    for (let k = 0; k < 30; k++) g.update();
    g.release();
    for (let k = 0; k < 15; k++) g.update(); // 0.25 s
    p.input = FULL;
    g.update();
    assert.strictEqual(p.penalty, 0);
    const r = events.filter(([ev]) => ev === 'reaction').map(([, d]) => d);
    assert.strictEqual(r.length, 1);
    assert.ok(Math.abs(r[0].time - 0.25) < 0.02, `reaction ${r[0].time}`);
});
