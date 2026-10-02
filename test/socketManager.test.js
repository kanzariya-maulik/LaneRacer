const test = require('node:test');
const assert = require('node:assert');
const setupSocketManager = require('../src/socketManager');
const Track = require('../src/game/Track');

const monza = Track.load('monza');
// No real WebRTC in tests: game_state goes over the fake Socket.IO
const noNet = { setupPeer() {}, hasOpenChannel: () => false, cleanup() {}, broadcastGameState: (s, io) => io.volatile.emit('game_state', s) };

function fakeIo() {
    const io = {
        handlers: {},
        sent: [],
        on(ev, fn) { this.handlers[ev] = fn; },
        emit(ev, data) { this.sent.push([ev, data]); },
        volatile: { emit() {} },
    };
    io.connect = (id) => {
        const s = {
            id,
            handlers: {},
            sent: [],
            on(ev, fn) { this.handlers[ev] = fn; },
            emit(ev, data) { this.sent.push([ev, data]); },
            broadcast: { emit() {} },
            fire(ev, data) { this.handlers[ev]?.(data); },
        };
        io.handlers.connection(s);
        return s;
    };
    io.events = (name) => io.sent.filter(([ev]) => ev === name).map(([, d]) => d);
    return io;
}

// Node's mock Date jumps to the end of a tick() call, so walk virtual time in 1 ms steps like the game loop polls
function advance(t, ms) {
    for (let k = 0; k < ms; k++) t.mock.timers.tick(1);
}

// Each test leaves the shared server state empty by disconnecting everyone
function join(io, id, teamId, quali) {
    const s = io.connect(id);
    s.fire('join_lobby', { username: id.toUpperCase(), teamId });
    if (quali !== undefined) s.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualifying: !!quali });
    else s.fire('toggle_ready', true);
    return s;
}

test('everyone leaving during countdown cancels it, so a new host gets exactly one race', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');
    advance(t, 2000);
    a.fire('disconnect');

    const b = join(io, 'b', 'haas', 0);
    b.fire('start_game');
    advance(t, 10000);
    assert.strictEqual(io.events('status_change').filter(s => s === 'RACE').length, 1, 'stale lights started a second race');
    b.fire('disconnect');
});

test('lights: 1..5 one per second, out 0.5–2.5 s later; throttle before lights out is a jump start', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');
    const init = io.events('game_init').at(-1);
    const car = init.players.a, x0 = car.x;

    advance(t, 5000);
    assert.deepStrictEqual(io.events('lights').map(l => l.count), [1, 2, 3, 4, 5]);
    assert.strictEqual(car.x, x0, 'car moved with no input');
    a.fire('input', { throttle: 1, brake: 0, steer: 0 }); // too early: lights out comes 0.5–2.5 s after light 5
    advance(t, 499);
    assert.ok(!io.events('lights').some(l => l.count === 0), 'lights out too early');
    advance(t, 2001);
    assert.ok(io.events('lights').some(l => l.count === 0), 'lights never went out');
    assert.ok(io.events('status_change').includes('RACE'));
    assert.strictEqual(car.penalty, 10, 'jump start should cost 10 s');
    advance(t, 1000);
    assert.notStrictEqual(car.x, x0);
    a.fire('disconnect');
});

test('qualifying → results → race grid in best-lap order', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    assert.deepStrictEqual(io.events('status_change'), ['QUALIFYING']);
    const quali = io.events('game_init').at(-1);
    assert.strictEqual(quali.mode, 'quali');

    Object.assign(quali.players.a, { bestLap: 85, finished: true });
    Object.assign(quali.players.b, { bestLap: 80, finished: true });
    advance(t, 50);
    assert.ok(io.events('status_change').includes('QUALI_RESULTS'));
    assert.deepStrictEqual(io.events('quali_results').at(-1).map(r => [r.id, r.position]), [['b', 1], ['a', 2]]);

    advance(t, 8000);
    assert.strictEqual(io.events('status_change').at(-1), 'COUNTDOWN');
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(race.players.b.x, monza.startPositions[0].x);
    assert.strictEqual(race.players.a.x, monza.startPositions[1].x);
    a.fire('disconnect');
    b.fire('disconnect');
});

test('no quali times → join-order grid', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    advance(t, 360 * 1000 + 100); // nobody ever crosses the line: the 6-minute cap ends quali
    advance(t, 8000);
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(race.players.a.x, monza.startPositions[0].x);
    assert.strictEqual(race.players.b.x, monza.startPositions[1].x);
    a.fire('disconnect');
    b.fire('disconnect');
});

test('disconnect during results drops driver from the grid', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    const quali = io.events('game_init').at(-1);
    Object.assign(quali.players.a, { bestLap: 85, finished: true });
    Object.assign(quali.players.b, { bestLap: 80, finished: true });
    advance(t, 50);
    b.fire('disconnect');
    advance(t, 8000);
    const race = io.events('game_init').at(-1);
    assert.deepStrictEqual(Object.keys(race.players), ['a']);
    assert.strictEqual(race.players.a.x, monza.startPositions[0].x);
    a.fire('disconnect');
});

test('late joiner during qualifying gets the running session', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 1);
    a.fire('start_game');
    const c = io.connect('c');
    c.fire('join_lobby', { username: 'C', teamId: 'haas' });
    assert.ok(c.sent.some(([ev, d]) => ev === 'game_init' && d.mode === 'quali'));
    a.fire('disconnect');
    c.fire('disconnect');
});

test('empty grid at lights out does not leave the server stuck in RACE', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');                       // COUNTDOWN, a is the only racer
    const c = io.connect('c');
    c.fire('join_lobby', { username: 'C', teamId: 'haas' }); // spectator
    a.fire('disconnect');                       // grid empties before lights out; c becomes host
    advance(t, 15000);
    advance(t, 16000); // results screen (FINISH_MS 15 s), then lobby. node's mock timers run timeouts scheduled inside an interval callback on the next tick() call
    assert.strictEqual(io.events('lobby_state_sync').at(-1).status, 'LOBBY');
    assert.ok(!io.events('status_change').includes('RACE'), 'stale lights timer flipped status to RACE');
    c.fire('update_settings', { qualifying: false });
    c.fire('start_game');
    assert.strictEqual(io.events('status_change').at(-1), 'COUNTDOWN', 'new host could not start');
    c.fire('disconnect');
});

test('everyone drives with full assist, whatever the client asks for', () => {
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const s = io.connect('a');
    s.fire('join_lobby', { username: 'A', teamId: 'ferrari', assist: 'off' });
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'full');
    s.fire('disconnect');
});
