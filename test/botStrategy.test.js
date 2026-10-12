// test/botStrategy.test.js
const test = require('node:test');
const assert = require('node:assert');
const { planRace } = require('../src/game/bots/strategy');
const { rngOf, fillGrid } = require('../src/game/bots/roster');
const { COMPOUNDS } = require('../public/js/sim/tyres.js');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');

test('every plan for 2…50 laps: laps add up, two compounds, stints under the cliff where any plan allows it', () => {
    for (const level of ['easy', 'medium', 'hard', 'pro']) for (let laps = 2; laps <= 50; laps++) for (let s = 0; s < 5; s++) {
        const plan = planRace(level, laps, true, rngOf(laps * 10 + s));
        assert.strictEqual(plan.reduce((a, x) => a + x.laps, 0), laps, `${level} ${laps}`);
        assert.ok(new Set(plan.map((x) => x.compound)).size >= 2, `${level} ${laps}: ${JSON.stringify(plan)}`);
        assert.ok(plan.every((x) => x.laps >= 1));
        if (laps >= 8) for (const x of plan) assert.ok(x.laps <= 0.75 * COMPOUNDS[x.compound].life * laps + 1e-9, `${level} ${laps}: ${JSON.stringify(plan)}`);
    }
});

test('no stop with tyre wear off or a 1-lap race: Softs, flat out', () => {
    assert.deepStrictEqual(planRace('pro', 10, false, rngOf(1)), [{ compound: 'S', laps: 10 }]);
    assert.deepStrictEqual(planRace('pro', 1, true, rngOf(1)), [{ compound: 'S', laps: 1 }]);
});

test('the grid gets a spread of strategies', () => {
    const plans = new Set(Array.from({ length: 21 }, (_, i) => planRace('hard', 20, true, rngOf(i)).map((x) => x.compound).join('')));
    assert.ok(plans.size >= 3, [...plans].join(' '));
});

test('a bot race: it pits on its plan, uses two compounds, never boxes on the last lap', () => {
    const t = Track.load('monza'), bot = fillGrid([], 'pro', 3)[0];
    bot.ai.mistake = 0;
    const io = { emit() {}, volatile: { emit() {} } };
    let done = false;
    const g = new Game(io, [bot], t, { maxLaps: 4, qualifying: false, tyreWear: true, ghostStart: false, rng: rngOf(9) }, () => { done = true; });
    const p = g.players[bot.id];
    g.update(); // grid: start tyre fitted from the plan
    assert.strictEqual(p.compound, p.bot.plan[0].compound);
    g.release();
    let lastLapCall = false, prevCall = null;
    for (let k = 0; k < 60 * 600 && !done; k++) {
        g.update();
        if (p.lap === 3 && p.boxCall && !prevCall) lastLapCall = true; // a new call on the last lap (one from the lap before stays on until serviced)
        prevCall = p.boxCall;
    }
    assert.ok(p.finished, 'finished');
    assert.ok(p.stops >= 1, 'pitted');
    assert.ok(p.compoundsUsed.length >= 2, `${p.compoundsUsed}`);
    assert.strictEqual(p.penalty, 0);
    assert.ok(['perfect', 'auto'].includes(p.lastStop.release), p.lastStop.release);
    assert.strictEqual(lastLapCall, false);
});

test('qualifying: every bot goes out on Softs, sets a time, comes back in and parks', () => {
    const t = Track.load('monza'), bots = fillGrid([], 'hard', 4).slice(0, 3);
    bots.forEach((b) => { b.ai.mistake = 0; });
    const io = { emit() {}, volatile: { emit() {} } };
    let results = null;
    const g = new Game(io, bots, t, { maxLaps: 3, qualifying: true, qualiFormat: 'short', qualiScale: 0.6, tyreWear: true, rng: rngOf(2) }, (r) => { results = r; }, 'quali');
    for (let k = 0; k < 60 * 900 && !results; k++) g.update();
    assert.ok(results, 'session ended');
    for (const b of bots) {
        const p = g.players[b.id];
        assert.ok(results.find((r) => r.id === b.id).time !== null, `${b.username}: no time`);
        assert.strictEqual(p.compound, 'S');
    }
});
