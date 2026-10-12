// test/botSession.test.js
const test = require('node:test');
const assert = require('node:assert');
const setupSocketManager = require('../src/socketManager');

const noNet = { setupPeer() {}, hasOpenChannel: () => false, cleanup() {}, broadcastGameState: (s, io) => io.volatile.emit('game_state', s) };
function fakeIo() {
    const io = { handlers: {}, sent: [], ticks: 0, on(ev, fn) { this.handlers[ev] = fn; }, emit(ev, data) { this.sent.push([ev, data]); } };
    io.volatile = { emit() { io.ticks++; } }; // game_state: counted, not stored
    io.connect = (id) => {
        const s = { id, handlers: {}, sent: [], on(ev, fn) { this.handlers[ev] = fn; }, emit(ev, data) { this.sent.push([ev, data]); }, broadcast: { emit() {} }, fire(ev, data) { this.handlers[ev]?.(data); } };
        io.handlers.connection(s);
        return s;
    };
    io.events = (name) => io.sent.filter(([ev]) => ev === name).map(([, d]) => d);
    return io;
}
const advance = (t, ms) => { for (let k = 0; k < ms; k++) t.mock.timers.tick(1); };

test('solo host with AI drivers on: a full 22-car grid, bots marked, team seats respected', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = io.connect('a');
    a.fire('join_lobby', { username: 'A', teamId: 'ferrari' });
    a.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualifying: false, aiDrivers: true, aiLevel: 'hard' });
    a.fire('start_game');
    const init = io.events('game_init').at(-1), cars = Object.values(init.players);
    assert.strictEqual(cars.length, 22);
    assert.strictEqual(cars.filter((c) => c.isBot).length, 21);
    assert.strictEqual(cars.filter((c) => c.teamId === 'ferrari').length, 2);
    a.fire('disconnect');
    advance(t, 100);
});

test('bots keep their qualifying places on the race grid; the lobby clears them; the last human leaving stops it all', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const io = fakeIo();
    setupSocketManager(io, noNet);
    const a = io.connect('a');
    a.fire('join_lobby', { username: 'A', teamId: 'ferrari' });
    a.fire('update_settings', { trackId: 'monza', maxLaps: 1, qualiFormat: 'short', qualiScale: 0.02, aiDrivers: true, aiLevel: 'easy' });
    a.fire('start_game');
    const quali = io.events('game_init').at(-1);
    const botId = Object.keys(quali.players).find((id) => quali.players[id].isBot);
    Object.assign(quali.players[botId], { segBest: 70, segAt: 1 }); // pole for one bot
    advance(t, 13000 + 8000);
    const race = io.events('game_init').at(-1);
    assert.strictEqual(race.mode, 'race');
    assert.strictEqual(Object.keys(race.players).length, 22, 'bots made the race grid');
    assert.strictEqual(race.index[botId], 0, 'the pole bot starts first');
    a.fire('disconnect');
    const ticks = io.ticks;
    advance(t, 1000);
    assert.strictEqual(io.ticks, ticks, 'game stopped with no humans left');
});
