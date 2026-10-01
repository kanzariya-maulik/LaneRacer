const test = require('node:test');
const assert = require('node:assert');
const lobby = require('../src/lobby');

const TRACK_IDS = ['monza', 'spa'];
const DEFAULTS = { trackId: 'monza', maxLaps: 3, qualiMinutes: 3 };

test('teams.json has 11 liveries capped at 2', () => {
    assert.strictEqual(lobby.TEAMS.length, 11);
    for (const t of lobby.TEAMS) assert.strictEqual(t.maxPlayers, 2);
    assert.ok(lobby.TEAMS.some(t => t.id === 'redbull-suzuka'));
});

test('sanitizeUsername', () => {
    assert.strictEqual(lobby.sanitizeUsername('  Max  '), 'Max');
    assert.strictEqual(lobby.sanitizeUsername('A'.repeat(40)).length, 15);
    for (const bad of [undefined, null, 42, {}, '', '   ']) {
        assert.match(lobby.sanitizeUsername(bad), /^Player\d+$/);
    }
});

test('sanitizeChat', () => {
    assert.strictEqual(lobby.sanitizeChat(' hi '), 'hi');
    assert.strictEqual(lobby.sanitizeChat('x'.repeat(500)).length, 100);
    for (const bad of [undefined, null, 42, {}, '', '  ']) assert.strictEqual(lobby.sanitizeChat(bad), null);
});

test('sanitizeSettings clamps and ignores garbage', () => {
    assert.deepStrictEqual(lobby.sanitizeSettings(DEFAULTS, null, TRACK_IDS), DEFAULTS);
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'monaco', maxLaps: '7', qualiMinutes: 99, maxSpeedKmh: 300, evil: 1 }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 3, qualiMinutes: 10 },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'spa', maxLaps: 0, qualiMinutes: -2 }, TRACK_IDS),
        { trackId: 'spa', maxLaps: 1, qualiMinutes: 0 },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { maxLaps: 4.6, qualiMinutes: NaN }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 5, qualiMinutes: 3 },
    );
});

test('sanitizeInput clamps analog values', () => {
    assert.deepStrictEqual(lobby.sanitizeInput({ throttle: 2, brake: -1, steer: -3 }), { throttle: 1, brake: 0, steer: -1 });
    assert.deepStrictEqual(lobby.sanitizeInput({ throttle: 0.5, brake: NaN, steer: '1' }), { throttle: 0.5, brake: 0, steer: 0 });
    assert.deepStrictEqual(lobby.sanitizeInput(null), { throttle: 0, brake: 0, steer: 0 });
});

test('sanitizeInput legacy booleans', () => {
    assert.deepStrictEqual(lobby.sanitizeInput({ up: true, left: 1 }), { throttle: 1, brake: 0, steer: -1 });
    assert.deepStrictEqual(lobby.sanitizeInput({ down: true, right: true }), { throttle: 0, brake: 1, steer: 1 });
});

test('canJoinTeam rejects unknown team', () => {
    assert.deepStrictEqual(lobby.canJoinTeam({}, 'monaco-team'), { ok: false, reason: 'Unknown team' });
    assert.strictEqual(lobby.canJoinTeam({}, undefined).ok, false);
});

test('canJoinTeam rejects third player on a team', () => {
    const players = {};
    for (const id of ['a', 'b']) {
        const res = lobby.canJoinTeam(players, 'ferrari');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.team.id, 'ferrari');
        players[id] = { id, teamId: 'ferrari' };
    }
    assert.deepStrictEqual(lobby.canJoinTeam(players, 'ferrari'), { ok: false, reason: 'Ferrari is full' });
    assert.strictEqual(lobby.canJoinTeam(players, 'haas').ok, true);
});

test('pickRacers caps at 20 and skips spectators', () => {
    const players = {};
    for (let i = 0; i < 22; i++) players[`p${i}`] = { id: `p${i}`, isSpectating: false };
    players.spec = { id: 'spec', isSpectating: true };
    const { racers, overflow } = lobby.pickRacers(players);
    assert.strictEqual(racers.length, 20);
    assert.deepStrictEqual(overflow.map(p => p.id), ['p20', 'p21']);
    assert.ok(!racers.some(p => p.id === 'spec'));
});
