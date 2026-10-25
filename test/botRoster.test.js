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

test('settings: aiCount a whole number of bots, 1..21', () => {
    const cur = { aiCount: 21 };
    assert.strictEqual(lobby.sanitizeSettings(cur, { aiCount: 5 }, []).aiCount, 5);
    assert.strictEqual(lobby.sanitizeSettings(cur, { aiCount: 0 }, []).aiCount, 1);
    assert.strictEqual(lobby.sanitizeSettings(cur, { aiCount: 99 }, []).aiCount, 21);
    assert.strictEqual(lobby.sanitizeSettings(cur, { aiCount: 4.6 }, []).aiCount, 5);
    assert.strictEqual(lobby.sanitizeSettings(cur, { aiCount: '7' }, []).aiCount, 21);
});

test('pace: pro 1.0 spread only slower (≤ +1 %), hard 1.005, medium 1.035, easy 1.085 (±1.5 %)', () => {
    const range = (level) => { const p = []; for (let s = 1; s <= 20; s++) for (const b of fillGrid([], level, s)) p.push(b.ai.pace); return [Math.min(...p), Math.max(...p)]; };
    const [pLo, pHi] = range('pro');
    assert.ok(pLo >= 1 && pHi <= 1.01, `pro ${pLo.toFixed(4)}-${pHi.toFixed(4)}`);
    for (const [level, mid] of [['hard', 1.005], ['medium', 1.035], ['easy', 1.085]]) {
        const [lo, hi] = range(level);
        assert.ok(lo >= mid * 0.985 - 1e-9 && hi <= mid * 1.015 + 1e-9 && lo < mid && hi > mid, `${level} ${lo.toFixed(4)}-${hi.toFixed(4)}`);
    }
});
