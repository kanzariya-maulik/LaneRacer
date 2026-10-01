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

// Each test leaves the shared server state empty by disconnecting everyone
function join(io, id, teamId, quali) {
    const s = io.connect(id);
    s.fire('join_lobby', { username: id.toUpperCase(), teamId });
    if (quali !== undefined) s.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualifying: !!quali });
    else s.fire('toggle_ready', true);
    return s;
}

test('everyone leaving during countdown cancels it, so a new host gets exactly one race', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');
    t.mock.timers.tick(2000);
    a.fire('disconnect');

    const b = join(io, 'b', 'haas', 0);
    b.fire('start_game');
    t.mock.timers.tick(10000);
    assert.strictEqual(io.events('status_change').filter(s => s === 'RACE').length, 1, 'stale lights started a second race');
    b.fire('disconnect');
});

test('lights: 1..5 one per second, out 0.5–2.5 s later; cars held until then', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');
    a.fire('input', { throttle: 1, brake: 0, steer: 0 });
    const init = io.events('game_init').at(-1);
    const car = init.players.a, x0 = car.x;

    t.mock.timers.tick(5000);
    assert.deepStrictEqual(io.events('lights').map(l => l.count), [1, 2, 3, 4, 5]);
    t.mock.timers.tick(499);
    assert.ok(!io.events('lights').some(l => l.count === 0), 'lights out too early');
    assert.strictEqual(car.x, x0, 'car moved before lights out');
    t.mock.timers.tick(2001);
    assert.ok(io.events('lights').some(l => l.count === 0), 'lights never went out');
    assert.ok(io.events('status_change').includes('RACE'));
    t.mock.timers.tick(1000);
    assert.notStrictEqual(car.x, x0, 'held throttle should launch at lights out');
    a.fire('disconnect');
});

test('qualifying → results → race grid in best-lap order', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
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
    t.mock.timers.tick(50);
    assert.ok(io.events('status_change').includes('QUALI_RESULTS'));
    assert.deepStrictEqual(io.events('quali_results').at(-1).map(r => [r.id, r.position]), [['b', 1], ['a', 2]]);

    t.mock.timers.tick(8000);
    assert.strictEqual(io.events('status_change').at(-1), 'COUNTDOWN');
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(race.players.b.x, monza.startPositions[0].x);
    assert.strictEqual(race.players.a.x, monza.startPositions[1].x);
    a.fire('disconnect');
    b.fire('disconnect');
});

test('no quali times → join-order grid', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    t.mock.timers.tick(360 * 1000 + 100); // nobody ever crosses the line: the 6-minute cap ends quali
    t.mock.timers.tick(8000);
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(race.players.a.x, monza.startPositions[0].x);
    assert.strictEqual(race.players.b.x, monza.startPositions[1].x);
    a.fire('disconnect');
    b.fire('disconnect');
});

test('disconnect during results drops driver from the grid', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 1);
    const b = join(io, 'b', 'haas');
    a.fire('start_game');
    const quali = io.events('game_init').at(-1);
    Object.assign(quali.players.a, { bestLap: 85, finished: true });
    Object.assign(quali.players.b, { bestLap: 80, finished: true });
    t.mock.timers.tick(50);
    b.fire('disconnect');
    t.mock.timers.tick(8000);
    const race = io.events('game_init').at(-1);
    assert.deepStrictEqual(Object.keys(race.players), ['a']);
    assert.strictEqual(race.players.a.x, monza.startPositions[0].x);
    a.fire('disconnect');
});

test('late joiner during qualifying gets the running session', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
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
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = join(io, 'a', 'ferrari', 0);
    a.fire('start_game');                       // COUNTDOWN, a is the only racer
    const c = io.connect('c');
    c.fire('join_lobby', { username: 'C', teamId: 'haas' }); // spectator
    a.fire('disconnect');                       // grid empties before lights out; c becomes host
    t.mock.timers.tick(15000);
    t.mock.timers.tick(6000); // node's mock timers run timeouts scheduled inside an interval callback on the next tick() call
    assert.strictEqual(io.events('lobby_state_sync').at(-1).status, 'LOBBY');
    assert.ok(!io.events('status_change').includes('RACE'), 'stale lights timer flipped status to RACE');
    c.fire('update_settings', { qualifying: false });
    c.fire('start_game');
    assert.strictEqual(io.events('status_change').at(-1), 'COUNTDOWN', 'new host could not start');
    c.fire('disconnect');
});

test('assist chosen on join and changed in the lobby; garbage becomes off', () => {
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const s = io.connect('a');
    s.fire('join_lobby', { username: 'A', teamId: 'ferrari', assist: 'full' });
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'full');
    s.fire('set_assist', 'bogus');
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'off');
    s.fire('set_assist', 'steering');
    assert.strictEqual(io.events('lobby_state_sync').at(-1).players.a.assist, 'steering');
    s.fire('disconnect');
});
