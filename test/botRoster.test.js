// test/botRoster.test.js
const test = require('node:test');
const assert = require('node:assert');
const { fillGrid, LEVELS, rngOf } = require('../src/game/bots/roster');
const lobby = require('../src/lobby');
const TEAMS = require('../public/teams.json');

test('fills every free seat up to 22, humans keep theirs, no team over its seats', () => {
    const humans = [{ teamId: 'ferrari' }, { teamId: 'ferrari' }, { teamId: 'haas' }];
    const bots = fillGrid(humans, 'hard', 42);
    assert.strictEqual(humans.length + bots.length, 22);
    const count = {};
    for (const c of [...humans, ...bots]) count[c.teamId] = (count[c.teamId] || 0) + 1;
    for (const t of TEAMS) assert.ok((count[t.id] || 0) <= t.maxPlayers, `${t.id}: ${count[t.id]}`);
    assert.ok(!bots.some((b) => b.teamId === 'ferrari'), 'both Ferrari seats are human');
    assert.strictEqual(new Set(bots.map((b) => b.username)).size, bots.length, 'names unique');
    assert.strictEqual(new Set(bots.map((b) => b.id)).size, bots.length, 'ids unique');
    for (const b of bots) {
        assert.ok(b.isBot && b.id.startsWith('ai-'));
        assert.deepStrictEqual(b.assist, { steer: 1, brake: 0 }); // the braking help's safe corner speeds would cap them
        assert.ok(Math.abs(b.ai.pace / LEVELS.hard.pace - 1) <= 0.015 + 1e-9, `pace ${b.ai.pace}`);
        assert.strictEqual(b.color, TEAMS.find((t) => t.id === b.teamId).chatColor);
    }
});

test('same seed, same grid; 22 humans, no bots; unknown level plays as medium', () => {
    assert.deepStrictEqual(fillGrid([], 'pro', 7), fillGrid([], 'pro', 7));
    const full = TEAMS.flatMap((t) => [{ teamId: t.id }, { teamId: t.id }]);
    assert.strictEqual(fillGrid(full, 'easy', 1).length, 0);
    assert.strictEqual(fillGrid([], 'nonsense', 3)[0].ai.level, 'medium');
    const r = rngOf(5), xs = Array.from({ length: 1000 }, r);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('settings: aiDrivers boolean, aiLevel one of four, anything else keeps the current value', () => {
    const cur = { aiDrivers: false, aiLevel: 'medium' };
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { aiDrivers: true, aiLevel: 'pro' }, []), { aiDrivers: true, aiLevel: 'pro' });
    assert.deepStrictEqual(lobby.sanitizeSettings(cur, { aiDrivers: 'yes', aiLevel: 'god' }, []), cur);
});
