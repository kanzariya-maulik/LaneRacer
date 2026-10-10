const test = require('node:test');
const assert = require('node:assert');
const lobby = require('../src/lobby');

const TRACK_IDS = ['monza', 'spa'];
const DEFAULTS = { trackId: 'monza', maxLaps: 3, qualifying: true };

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
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'monaco', maxLaps: '7', qualifying: 'yes', maxSpeedKmh: 300, evil: 1 }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 3, qualifying: true },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { trackId: 'spa', maxLaps: 0, qualifying: false }, TRACK_IDS),
        { trackId: 'spa', maxLaps: 1, qualifying: false },
    );
    assert.deepStrictEqual(
        lobby.sanitizeSettings(DEFAULTS, { maxLaps: 4.6, qualiMinutes: 5 }, TRACK_IDS),
        { trackId: 'monza', maxLaps: 5, qualifying: true },
    );
});

test('sanitizeInput clamps analog values', () => {
    assert.deepStrictEqual(lobby.sanitizeInput({ throttle: 2, brake: -1, steer: -3 }), { throttle: 1, brake: 0, steer: -1, drs: false });
    assert.deepStrictEqual(lobby.sanitizeInput({ throttle: 0.5, brake: NaN, steer: '1' }), { throttle: 0.5, brake: 0, steer: 0, drs: false });
    assert.deepStrictEqual(lobby.sanitizeInput(null), { throttle: 0, brake: 0, steer: 0, drs: false });
});

test('sanitizeInput legacy booleans', () => {
    assert.deepStrictEqual(lobby.sanitizeInput({ up: true, left: 1 }), { throttle: 1, brake: 0, steer: -1, drs: false });
    assert.deepStrictEqual(lobby.sanitizeInput({ down: true, right: true }), { throttle: 0, brake: 1, steer: 1, drs: false });
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

test('pickRacers caps at 22 and skips spectators', () => {
    const players = {};
    for (let i = 0; i < 24; i++) players[`p${i}`] = { id: `p${i}`, isSpectating: false };
    players.spec = { id: 'spec', isSpectating: true };
    const { racers, overflow } = lobby.pickRacers(players);
    assert.strictEqual(racers.length, 22);
    assert.deepStrictEqual(overflow.map(p => p.id), ['p22', 'p23']);
    assert.ok(!racers.some(p => p.id === 'spec'));
});

test('sanitizeInput carries the DRS button as a strict boolean', () => {
    assert.strictEqual(lobby.sanitizeInput({ throttle: 1, brake: 0, steer: 0, drs: true }).drs, true);
    assert.strictEqual(lobby.sanitizeInput({ throttle: 1, brake: 0, steer: 0, drs: 'yes' }).drs, false);
    assert.strictEqual(lobby.sanitizeInput({ up: true }).drs, false);
});

test('sanitizeInputs: batches of sequenced inputs, clamped; legacy single inputs return null', () => {
    assert.deepStrictEqual(lobby.sanitizeInputs({ inputs: [{ seq: 5, steer: 3, throttle: 1, brake: 0, drs: true }, { seq: 'x', steer: 0 }] }),
        [{ seq: 5, steer: 1, throttle: 1, brake: 0, drs: true }]);
    assert.strictEqual(lobby.sanitizeInputs({ throttle: 1, brake: 0, steer: 0 }), null);
    assert.strictEqual(lobby.sanitizeInputs({ inputs: new Array(50).fill({ seq: 1, steer: 0, throttle: 0, brake: 0 }) }).length, 8, 'at most 8 per packet');
});

test('sanitizeSettings: collisions on/off (host), only real booleans', () => {
    assert.strictEqual(lobby.sanitizeSettings(DEFAULTS, { collisions: false }, TRACK_IDS).collisions, false);
    assert.strictEqual(lobby.sanitizeSettings({ ...DEFAULTS, collisions: false }, { collisions: 'yes' }, TRACK_IDS).collisions, false);
    assert.strictEqual(lobby.sanitizeSettings(DEFAULTS, { contactPenalties: false }, TRACK_IDS).contactPenalties, false);
    assert.strictEqual(lobby.sanitizeSettings(DEFAULTS, { contactPenalties: 0 }, TRACK_IDS).contactPenalties, DEFAULTS.contactPenalties);
});

test('sanitizeSettings: day or night, nothing else', () => {
    assert.strictEqual(lobby.sanitizeSettings(DEFAULTS, { timeOfDay: 'night' }, TRACK_IDS).timeOfDay, 'night');
    assert.strictEqual(lobby.sanitizeSettings({ ...DEFAULTS, timeOfDay: 'night' }, { timeOfDay: 'dusk' }, TRACK_IDS).timeOfDay, 'night');
});

test('sanitizeAssist: full or off, anything else falls back to full', () => {
    assert.deepStrictEqual(lobby.sanitizeAssist('off'),   { steer: 0, brake: 0 });
    assert.deepStrictEqual(lobby.sanitizeAssist('full'),  { steer: 1, brake: 1 });
    assert.deepStrictEqual(lobby.sanitizeAssist('turbo'), { steer: 1, brake: 1 }); // unknown → full
    assert.deepStrictEqual(lobby.sanitizeAssist('75,50'), { steer: 0.75, brake: 0.5 });
    assert.deepStrictEqual(lobby.sanitizeAssist('0,100'), { steer: 0, brake: 1 });
});

test('sanitizeSettings: out-laps 1–3 and timed quali laps 1–10, whole numbers, junk ignored', () => {
    const base = { trackId: 'monza', maxLaps: 3, qualifying: true, outLaps: 1, qualiLaps: 2 };
    const s = (inc) => lobby.sanitizeSettings(base, inc, ['monza']);
    assert.deepStrictEqual([s({ outLaps: 2, qualiLaps: 5 }).outLaps, s({ outLaps: 2, qualiLaps: 5 }).qualiLaps], [2, 5]);
    assert.deepStrictEqual([s({ outLaps: 0, qualiLaps: 0 }).outLaps, s({ outLaps: 0, qualiLaps: 0 }).qualiLaps], [1, 1]);
    assert.deepStrictEqual([s({ outLaps: 9, qualiLaps: 99 }).outLaps, s({ outLaps: 9, qualiLaps: 99 }).qualiLaps], [3, 10]);
    assert.strictEqual(s({ qualiLaps: 2.6 }).qualiLaps, 3);
    assert.deepStrictEqual([s({ outLaps: '2', qualiLaps: null }).outLaps, s({ outLaps: '2', qualiLaps: null }).qualiLaps], [1, 2]);
});

test('sanitizeSettings: maxSpeed (50–9999 km/h) and acceleration (10–9999%)', () => {
    const base = { trackId: 'monza', maxLaps: 3, qualifying: true, maxSpeed: 340, acceleration: 100 };
    const s = (inc) => lobby.sanitizeSettings(base, inc, ['monza']);
    assert.strictEqual(s({ maxSpeed: 450 }).maxSpeed, 450);
    assert.strictEqual(s({ maxSpeed: '500' }).maxSpeed, 500);
    assert.strictEqual(s({ maxSpeed: 20 }).maxSpeed, 50);
    assert.strictEqual(s({ maxSpeed: 9999 }).maxSpeed, 9999);
    assert.strictEqual(s({ maxSpeed: 15000 }).maxSpeed, 9999);
    assert.strictEqual(s({ maxSpeed: 'garbage' }).maxSpeed, 340);

    assert.strictEqual(s({ acceleration: 200 }).acceleration, 200);
    assert.strictEqual(s({ acceleration: '250' }).acceleration, 250);
    assert.strictEqual(s({ acceleration: 5 }).acceleration, 10);
    assert.strictEqual(s({ acceleration: 9999 }).acceleration, 9999);
    assert.strictEqual(s({ acceleration: 20000 }).acceleration, 9999);
    assert.strictEqual(s({ acceleration: NaN }).acceleration, 100);
});

