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
    for (let i = 0; i < 60; i++) {
        if (i % 6 === 0) g.handleInput('a', { throttle: 1, brake: 0, steer: 0 }); // clients resend every 100 ms
        g.update();
    }
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

// DRS zone 0 at Monza is the main straight; s values are lap distances from the start line
const Z = () => monza.drsZones[0];
const lapPos = (s) => { const q = Track.pointAt(monza.path, monza.cum, monza.startS + s); return { x: q.x, y: q.y, angle: q.angle }; };

test('DRS: within 1 s at detection, from lap 2, opens on the button, closes on the brake', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas')], monza, RACE, () => {});
    g.release();
    const { a, b } = g.players, z = Z(), d = z.detectS, sc = monza.scale;
    a.lap = b.lap = 1;
    g.time = 50; g.updateDrs(a, d - sc, d + sc);           // a crosses detection first: nobody ahead
    g.time = 50.6; g.updateDrs(b, d - sc, d + sc);         // b 0.6 s behind: eligible
    const inZone = z.startS + 50 * sc;
    b.input = { throttle: 1, brake: 0, steer: 0, drs: false };
    g.updateDrs(b, inZone - sc, inZone);
    assert.ok(b.drsAvailable && !b.drs, 'available but not opened yet');
    b.input.drs = true;
    g.updateDrs(b, inZone, inZone + sc);
    assert.ok(b.drs, 'button opens DRS');
    b.input = { throttle: 0, brake: 1, steer: 0, drs: true };
    g.updateDrs(b, inZone + sc, inZone + 2 * sc);
    assert.ok(!b.drs, 'braking closes DRS');
    a.input = { throttle: 1, brake: 0, steer: 0, drs: true };
    g.updateDrs(a, inZone - sc, inZone);
    assert.ok(!a.drsAvailable && !a.drs, 'leader has no DRS');
});

test('DRS: not on lap 1, and more than 1 s behind is not enough', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas')], monza, RACE, () => {});
    g.release();
    const { a, b } = g.players, z = Z(), d = z.detectS, sc = monza.scale, inZone = z.startS + 50 * sc;
    g.time = 20; g.updateDrs(a, d - sc, d + sc);
    g.time = 20.5; g.updateDrs(b, d - sc, d + sc);
    b.input = { throttle: 1, brake: 0, steer: 0, drs: true };
    g.updateDrs(b, inZone - sc, inZone);
    assert.ok(!b.drs, 'no DRS on lap 1');
    a.lap = b.lap = 1;
    g.time = 100; g.updateDrs(a, d - sc, d + sc);
    g.time = 101.5; g.updateDrs(b, d - sc, d + sc);
    g.updateDrs(b, inZone - sc, inZone);
    assert.ok(!b.drsAvailable, '1.5 s behind is too far');
});

test('DRS: free to use in the zones in qualifying', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    const a = g.players.a, inZone = Z().startS + 50 * monza.scale;
    a.input = { throttle: 1, brake: 0, steer: 0, drs: true };
    g.updateDrs(a, inZone - monza.scale, inZone);
    assert.ok(a.drs);
    g.updateDrs(a, Z().endS + 10 * monza.scale, Z().endS + 11 * monza.scale);
    assert.ok(!a.drs && !a.drsAvailable, 'closes after the zone');
});

test('slipstream: right behind another car cuts drag; alongside or far behind does not', () => {
    const g = new Game(io, [lp('a'), lp('b', 'haas'), lp('c', 'mclaren')], monza, RACE, () => {});
    g.release();
    const { a, b, c } = g.players, sc = monza.scale;
    Object.assign(a, lapPos(1000 * sc));
    Object.assign(b, lapPos(985 * sc));    // 15 m behind a
    Object.assign(c, lapPos(800 * sc));    // 200 m behind
    g.updateTow();
    assert.ok(b.tow > 0.05, `tow ${b.tow}`);
    assert.strictEqual(a.tow, 0);
    assert.strictEqual(c.tow, 0);
    const side = lapPos(1000 * sc);
    Object.assign(b, { x: side.x - Math.sin(side.angle) * 4 * sc, y: side.y + Math.cos(side.angle) * 4 * sc, angle: side.angle });
    g.updateTow();
    assert.strictEqual(b.tow, 0, 'alongside is no tow');
});

test('fast update: compact per-car arrays with flags, at most 75 bytes per car (velocity, tow, lastSeq for prediction)', () => {
    let pkt = null;
    const io2 = { emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkt = d; } } };
    const g = new Game(io2, [lp('a'), lp('b', 'haas')], monza, QUALI, () => {}, 'quali');
    g.update();
    assert.strictEqual(pkt.s, 1);
    assert.strictEqual(typeof pkt.t, 'number');
    assert.strictEqual(pkt.c.length, 2);
    const a = pkt.c.find(e => e[0] === g.index.a);
    assert.strictEqual(a.length, 11);
    const F = Game.FLAGS;
    assert.strictEqual(a[6] & (F.inPit | F.limiter | F.ghost), F.inPit | F.limiter | F.ghost, 'garage car: in pit, limiter, ghost');
    for (const e of pkt.c) assert.ok(JSON.stringify(e).length <= 75, `${JSON.stringify(e).length} bytes`);
    assert.deepStrictEqual(g.initPayload().index, g.index);
});

test('info update: everything first, then only what changed, at most 10 Hz', () => {
    const metas = [];
    const io2 = { emit(ev, d) { if (ev === 'game_meta') metas.push(d); }, volatile: { emit() {} } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.release();
    g.update();
    assert.strictEqual(metas.length, 1);
    assert.deepStrictEqual(Object.keys(metas[0].a).sort(), [...Game.META_FIELDS].sort());
    for (let k = 0; k < 5; k++) g.update();
    assert.strictEqual(metas.length, 1, 'nothing changed: no update');
    g.players.a.penalty = 5;
    g.update(); // seq 7: due
    assert.deepStrictEqual(metas[1], { a: { penalty: 5 } });
});

test('late joiners get every field from game_init', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    const p = g.initPayload().players.a;
    for (const f of Game.META_FIELDS) assert.ok(f in p, `${f} missing from game_init`);
});

test('fast update clock keeps running through the race countdown; race time rides in g', () => {
    const pkts = [];
    const io2 = { emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkts.push(d); } } };
    const g = new Game(io2, [lp('a'), lp('b', 'haas')], monza, RACE, () => {});
    assert.ok(g.frozen, 'race starts frozen behind the lights');
    g.update(); g.update();
    assert.ok(pkts[1].t > pkts[0].t, `clock stuck at ${pkts[0].t}`);
    assert.strictEqual(pkts[1].g, 0, 'race clock waits for lights out');
});

test('race gaps never shrink down the order (cars timed at different checkpoints)', () => {
    const g = new Game(io, [lp('a'), lp('b'), lp('c')], monza, { maxLaps: 5, qualifying: false }, () => {});
    const { a, b, c } = g.players;
    Object.assign(a, { lap: 1, checkpoint: 3, progress: 19, passTimes: { 17: 90, 18: 96, 19: 100 } });
    Object.assign(b, { lap: 1, checkpoint: 3, progress: 19, passTimes: { 19: 100.95 } });   // +0.95 at checkpoint 19
    Object.assign(c, { lap: 1, checkpoint: 2, progress: 18, passTimes: { 18: 96.08 } });    // +0.08 at checkpoint 18
    g.updateRanks();
    assert.deepStrictEqual([a.rank, b.rank, c.rank], [1, 2, 3]);
    close(b.gap, 0.95);
    assert.ok(c.gap >= b.gap, `P3 gap ${c.gap} below P2 gap ${b.gap}`);
});

test('a player whose inputs stop arriving (tab hidden, connection lost) lets go of the controls', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    g.handleInput('a', { throttle: 1, brake: 0, steer: 0.5, drs: true });
    for (let k = 0; k < 10; k++) g.update();
    assert.strictEqual(g.players.a.input.throttle, 1, 'recent input is kept');
    for (let k = 0; k < 30; k++) g.update();
    assert.deepStrictEqual(g.players.a.input, { throttle: 0, brake: 0, steer: 0, drs: false });
});

test('race ends 60 s after the winner even if a car never finishes; it is classified DNF, last', () => {
    let ended = 0;
    const g = new Game(io, [lp('a'), lp('b'), lp('c')], monza, { maxLaps: 3, qualifying: false }, () => { ended++; });
    g.frozen = false;
    const { a, b, c } = g.players;
    Object.assign(a, { lap: 3, finished: true, finishTime: 100, finishOrder: 1 });
    g.winnerCount = 1;
    g.time = 100;
    g.firstFinishAt = 100;
    Object.assign(c, { progress: 30 });
    Object.assign(b, { progress: 20 });
    for (let k = 0; k < 59 * 60; k++) g.update();
    assert.strictEqual(ended, 0, 'still waiting for the others');
    for (let k = 0; k < 2 * 60; k++) g.update();
    assert.ok(ended >= 1, 'race over'); // the real loop stops at the first call
    assert.ok(b.dnf && c.dnf && !a.dnf);
    assert.deepStrictEqual([a.finishOrder, c.finishOrder, b.finishOrder], [1, 2, 3], 'DNF ordered by distance covered');
});

test('jump start: a car shunted off its slot by the car behind is not penalised', () => {
    const { events, io: sio } = spy();
    const g = new Game(sio, [lp('a'), lp('b', 'haas')], monza, RACE, () => {});
    const a = g.players.a;
    for (let k = 0; k < 30; k++) {
        a.x += 0.2 * monza.scale; // pushed forward, no throttle of its own
        g.update();
    }
    assert.strictEqual(a.penalty, 0);
    assert.strictEqual(events.filter(([ev, d]) => ev === 'track_limits' && d.kind === 'jump').length, 0);
});

test('late joiner: game_init carries the quali clock and the session-best sectors', () => {
    const g = new Game(io, [lp('a')], monza, QUALI, () => {}, 'quali');
    g.time = 100;
    g.bestSectors = [30.1, 40.2, 25.3];
    const init = g.initPayload();
    assert.deepStrictEqual(init.session, { phase: 'QUALIFYING', endsInMs: 260000 });
    assert.deepStrictEqual(init.bestSectors, [30.1, 40.2, 25.3]);
    assert.strictEqual(new Game(io, [lp('a')], monza, RACE, () => {}).initPayload().session, null);
});

test('input queue: one input per tick in order; a missing input is guessed in its own slot so server and client stay tick-aligned', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    const a = g.players.a, inp = (seq, steer) => ({ seq, steer, throttle: 1, brake: 0, drs: false });
    g.handleInputs('a', [inp(2, 0.2), inp(1, 0.1), inp(3, 0.3)]);   // out of order
    g.handleInputs('a', [inp(1, 0.9), inp(2, 0.9), inp(3, 0.9)]);   // redundant resend: ignored
    g.update();
    assert.strictEqual(a.lastSeq, 1);
    assert.strictEqual(a.input.steer, 0.1);
    g.update(); g.update();
    assert.strictEqual(a.lastSeq, 3);
    assert.strictEqual(a.input.steer, 0.3, 'resent copies never replace the original');
    const s0 = a.starve;
    g.update();
    assert.strictEqual(a.lastSeq, 4, 'input 4 missing: its slot runs on a repeat of input 3');
    assert.strictEqual(a.input.steer, 0.3);
    assert.strictEqual(a.starve, s0 + 1);
    g.handleInputs('a', [inp(4, 0.9), inp(5, 0.5)]);                // 4 arrives too late: its slot is gone
    g.update();
    assert.strictEqual(a.lastSeq, 5);
    assert.strictEqual(a.input.steer, 0.5);
    g.handleInputs('a', [6, 7, 8, 9, 10, 11, 12].map((s) => inp(s, 0)));
    g.update();
    assert.strictEqual(a.lastSeq, 9, 'queue capped at 4: skips ahead to the newest four');
    g.handleInputs('a', [inp(6, 0.5)]);
    g.update();
    assert.strictEqual(a.lastSeq, 10, 'an input older than one already applied is never applied');
});

test('input queue: a client far behind the server slots (tab stall, reconnect) is re-aligned, not ignored forever', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    const a = g.players.a, inp = (seq) => ({ seq, steer: 0, throttle: 1, brake: 0, drs: false });
    g.handleInputs('a', [inp(100)]);
    for (let k = 0; k < 10; k++) g.update();                         // 9 guessed slots: lastSeq 109
    g.handleInputs('a', [inp(101), inp(102)]);
    g.update();
    assert.strictEqual(a.lastSeq, 101);
});

test('input queue: guessing stops when the client goes silent (controls released)', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    const a = g.players.a;
    g.handleInputs('a', [{ seq: 1, steer: 0, throttle: 1, brake: 0, drs: false }]);
    for (let k = 0; k < 120; k++) g.update();
    assert.ok(a.lastSeq < 1 + 0.3 * 60 + 2, `${a.lastSeq}`);
    assert.strictEqual(a.input.throttle, 0);
});

test('fast update carries velocity, tow and the last applied input for reconciliation', () => {
    let pkt = null;
    const io2 = { emit() {}, volatile: { emit(ev, d) { if (ev === 'game_state') pkt = d; } } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    for (let k = 0; k < 30; k++) { g.handleInputs('a', [{ seq: 7 + k, steer: 0, throttle: 1, brake: 0, drs: false }]); g.update(); }
    const e = pkt.c[0];
    assert.strictEqual(e.length, 11);
    assert.ok(Math.abs(e[7]) + Math.abs(e[8]) > 0, 'velocity present');
    assert.strictEqual(e[10], 36);
    assert.ok(JSON.stringify(e).length <= 75, `${JSON.stringify(e).length} bytes`);
});

test('start() runs the fixed-step loop and reports net_stats once a second', async () => {
    const stats = [];
    const io2 = { emit(ev, d) { if (ev === 'net_stats') stats.push(d); }, volatile: { emit() {} } };
    const g = new Game(io2, [lp('a')], monza, RACE, () => {});
    g.start();
    await new Promise((r) => setTimeout(r, 1150));
    g.stop();
    assert.ok(g.ticker === null, 'stop() clears the ticker');
    assert.strictEqual(stats.length, 1);
    assert.strictEqual(typeof stats[0].tickMs, 'number');
    assert.deepStrictEqual(Object.keys(stats[0].starve), ['a']);
    assert.ok(g.seq >= 66 && g.seq <= 71, `${g.seq} ticks in 1.15 s`);
});

test('input queue: re-align after a stall never re-applies inputs from the redundant window', () => {
    const g = new Game(io, [lp('a')], monza, RACE, () => {});
    g.frozen = false;
    const a = g.players.a, inp = (seq) => ({ seq, steer: 0, throttle: 1, brake: 0, drs: false });
    const win = (top) => [0, 1, 2, 3, 4, 5].map((k) => inp(top - 5 + k)).filter((i) => i.seq >= 1);
    for (let s = 1; s <= 20; s++) { g.handleInputs('a', win(s)); g.update(); }
    for (let k = 0; k < 12; k++) g.update();                         // client hitch: 12 guessed slots, lastSeq 32
    const applied = [];
    for (let s = 21; s <= 26; s++) { g.handleInputs('a', win(s)); g.update(); applied.push(a.input.seq); }
    assert.ok(applied.every((s) => s === undefined || s > 20), `re-applied ${applied}`);
    assert.deepStrictEqual(applied.filter((s) => s !== undefined), [...new Set(applied.filter((s) => s !== undefined))].sort((x, y) => x - y), 'in order, once each');
});

test('finished and DNF race cars park with zero velocity (remote clients must not dead-reckon them forward)', () => {
    const g = new Game(io, [lp('a'), lp('b')], monza, { maxLaps: 1, qualifying: false }, () => {});
    g.release();
    const { a, b } = g.players;
    Object.assign(a, { vx: 80, vy: 5, speed: 80 });
    lap(g, a, 0, 85);
    assert.ok(a.finished);
    assert.deepStrictEqual([a.vx, a.vy, a.speed], [0, 0, 0], 'finisher parked');
    Object.assign(b, { vx: 60, vy: 0, speed: 60 });
    g.time = 85 + 61;
    g.update();
    assert.ok(b.dnf);
    assert.deepStrictEqual([b.vx, b.vy, b.speed], [0, 0, 0], 'DNF parked');
});

test('session fastest lap: only a faster valid lap takes it; everyone is told who and on which lap', () => {
    const events = [];
    const spyIo = { emit: (ev, d) => { if (ev === 'fastest_lap') events.push(d); }, volatile: { emit() {} } };
    const g = new Game(spyIo, [lp('a'), lp('b')], monza, { maxLaps: 5, qualifying: false }, () => {});
    g.release();
    const { a, b } = g.players;
    lap(g, a, 0, 85);
    lap(g, b, 0, 84);
    lap(g, a, 85, 86);                                 // slower: no change
    b.lapValid = false;
    lap(g, b, 84, 80);                                 // faster but invalid: never counts
    assert.deepStrictEqual(events.map((e) => [e.id, e.lap]), [['a', 1], ['b', 1]]);
    close(events[1].time, 84);
    assert.deepStrictEqual({ id: g.fastestLap.id, lap: g.fastestLap.lap }, { id: 'b', lap: 1 });
    assert.deepStrictEqual(g.initPayload().fastestLap, g.fastestLap, 'late joiners see the holder');
});

test('session best sectors record who set them, and the timing update carries both', () => {
    const timing = [];
    const spyIo = { emit: (ev, d) => { if (ev === 'timing') timing.push(d); }, volatile: { emit() {} } };
    const g = new Game(spyIo, [lp('a'), lp('b')], monza, { maxLaps: 5, qualifying: false }, () => {});
    g.release();
    const { a, b } = g.players;
    lap(g, a, 0, 90);                                  // a: every sector 30 s
    lap(g, b, 0, 87);                                  // b: every sector 29 s
    assert.deepStrictEqual(g.bestSectorIds, ['b', 'b', 'b']);
    assert.deepStrictEqual(timing.at(-1).bestSectorIds, ['b', 'b', 'b']);
    assert.strictEqual(timing.at(-1).fastestLap.id, 'b');
    assert.deepStrictEqual(g.initPayload().bestSectorIds, ['b', 'b', 'b']);
});

test('race results: final time = finish time + penalties, order and gaps after penalties, places changed, DNF last', () => {
    const sent = [];
    const spyIo = { emit: (ev, d) => sent.push([ev, d]), volatile: { emit() {} } };
    const g = new Game(spyIo, [lp('a'), lp('b', 'haas'), lp('c', 'alpine'), lp('d', 'williams')], monza, { maxLaps: 1, qualifying: false }, () => {});
    g.release();
    const { a, b, c, d } = g.players;
    b.penalty = 5;
    lap(g, a, 0, 100);
    lap(g, b, 0, 101);
    lap(g, c, 0, 102);
    g.time = 100 + 61; d.progress = 3;
    g.update();                                         // d never finishes: DNF after the 60 s window
    const res = sent.filter(([ev]) => ev === 'race_results').map(([, r]) => r);
    assert.strictEqual(res.length, 1, 'sent once, when the race is classified');
    const rows = res[0].rows;
    assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'c', 'b', 'd']);
    assert.deepStrictEqual(rows.map((r) => r.position), [1, 2, 3, 4]);
    close(rows[2].finishTime, 101); assert.strictEqual(rows[2].penalty, 5); close(rows[2].total, 106);
    assert.strictEqual(rows[0].gap, null);
    close(rows[1].gap, 2); close(rows[2].gap, 6);
    assert.deepStrictEqual(rows.map((r) => r.change), [0, 1, -1, 0], 'b dropped a place to its penalty, c gained it');
    assert.deepStrictEqual(rows.map((r) => r.dnf), [false, false, false, true]);
    assert.strictEqual(rows[3].total, null);
    assert.strictEqual(rows[0].laps, 1);
    assert.strictEqual(res[0].fastestLapId, 'a');
    assert.ok(!sent.some(([ev, m]) => ev === 'chat_msg' && /Result after penalties/.test(m.msg)), 'results no longer go to chat');
});
