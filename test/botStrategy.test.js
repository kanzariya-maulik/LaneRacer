// test/botStrategy.test.js
const test = require('node:test');
const assert = require('node:assert');
const { planRace } = require('../src/game/bots/strategy');
const { rngOf, fillGrid } = require('../src/game/bots/roster');
const { COMPOUNDS, gripOf } = require('../public/js/sim/tyres.js');
const Game = require('../src/game/Game');
const Track = require('../src/game/Track');

test('every plan for 2…100 laps: laps add up, two compounds from 5 laps (the rule), every stint at least a lap', () => {
    for (const level of ['easy', 'medium', 'hard', 'pro']) for (let laps = 2; laps <= 100; laps++) for (let s = 0; s < 3; s++) {
        const plan = planRace(level, laps, true, rngOf(laps * 10 + s));
        assert.strictEqual(plan.reduce((a, x) => a + x.laps, 0), laps, `${level} ${laps}`);
        if (laps >= 5) assert.ok(new Set(plan.map((x) => x.compound)).size >= 2, `${level} ${laps}: ${JSON.stringify(plan)}`);
        assert.ok(plan.every((x) => x.laps >= 1));
    }
});

// Race time of a plan by the planner's own model: laps at 1/√grip over each stint's wear, plus each stop's loss
const modelTime = (plan, laps, { lapS, pitLossS }) => plan.reduce((t, x) => {
    for (let k = 0; k < x.laps; k++) t += lapS / Math.sqrt(gripOf(x.compound, (k + 0.5) / (COMPOUNDS[x.compound].life * laps)));
    return t;
}, (plan.length - 1) * pitLossS);

test('pro strategy: the fastest plan by race time — one stop in short races, never a stop it does not pay for', () => {
    const cost = { lapS: 80, pitLossS: 20 };
    for (const laps of [5, 8]) assert.strictEqual(planRace('pro', laps, true, rngOf(1), cost).length, 2, `${laps} laps`);
    for (const laps of [3, 4]) { // a sprint: no rule, so no stop when running one set to the flag is quicker
        const best = planRace('pro', laps, true, rngOf(1), cost), t = modelTime(best, laps, cost);
        for (const c of 'SMH') assert.ok(t <= modelTime([{ compound: c, laps }], laps, cost) + 1e-6, `${laps} laps: ${JSON.stringify(best)} beaten by no-stop ${c}`);
    }
    for (const laps of [3, 10, 25, 50]) {
        const best = planRace('pro', laps, true, rngOf(2), cost), t = modelTime(best, laps, cost);
        for (const seq of ['SM', 'MH', 'SH', 'HM', 'SMS', 'SHS', 'MHM', 'SMH']) for (let a = 1; a < laps - seq.length + 2; a++) {
            const rest = laps - a, plan = seq.length === 2 ? [{ compound: seq[0], laps: a }, { compound: seq[1], laps: rest }]
                : [{ compound: seq[0], laps: a }, { compound: seq[1], laps: Math.ceil(rest / 2) }, { compound: seq[2], laps: Math.floor(rest / 2) }];
            if (plan.some((x) => x.laps < 1)) continue;
            assert.ok(t <= modelTime(plan, laps, cost) + 1e-6, `${laps} laps: ${JSON.stringify(best)} ${t.toFixed(2)} beaten by ${JSON.stringify(plan)}`);
        }
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
    const g = new Game(io, [bot], t, { maxLaps: 5, qualifying: false, tyreWear: true, ghostStart: false, rng: rngOf(9) }, () => { done = true; });
    const p = g.players[bot.id];
    g.update(); // grid: start tyre fitted from the plan
    assert.strictEqual(p.compound, p.bot.plan[0].compound);
    g.release();
    let lastLapCall = false, prevCall = null;
    for (let k = 0; k < 60 * 600 && !done; k++) {
        g.update();
        if (p.lap === 4 && p.boxCall && !prevCall) lastLapCall = true; // a new call on the last lap (one from the lap before stays on until serviced)
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

test('the mandatory stop always happens: two teammates who both still need it are never held off until the flag', () => {
    const t = Track.load('monza'), [a, b] = fillGrid([], 'pro', 5).filter((x, i, all) => all.findIndex((y) => y.teamId === x.teamId) !== i || all.filter((y) => y.teamId === x.teamId).length === 2).slice(0, 2);
    assert.strictEqual(a.teamId, b.teamId);
    for (const x of [a, b]) x.ai.mistake = 0;
    let done = false;
    const g = new Game({ emit() {}, volatile: { emit() {} } }, [a, b], t, { maxLaps: 3, qualifying: false, tyreWear: true, ghostStart: true, formationLap: false, rng: rngOf(4) }, () => { done = true; });
    g.update();
    for (const id of [a.id, b.id]) g.players[id].bot.plan = [{ compound: 'M', laps: 2 }, { compound: 'H', laps: 1 }]; // the same lap for both
    g.release();
    for (let k = 0; k < 60 * 600 && !done; k++) g.update();
    for (const id of [a.id, b.id]) assert.strictEqual(g.players[id].penalty, 0, `${id} took the tyre-rule penalty`);
});

// The tyre rule's fallback is a last resort, not the plan: in a short race it called bots in on the grid lap ("2 laps or
// fewer to go" was already true), overriding plans that stop a lap later
test('5-lap race: nobody is called in before their plan says', () => {
    const Game = require('../src/game/Game'), Track = require('../src/game/Track');
    const g = new Game({ emit() {}, volatile: { emit() {} } }, fillGrid([], 'pro', 5, 22), Track.load('monza'), { maxLaps: 5, qualifying: false, rng: rngOf(7) }, () => {});
    g.release();
    const early = new Set();
    for (let k = 0; k < 60 * 700 && !Object.values(g.players).every((p) => p.finished); k++) {
        g.update();
        for (const p of Object.values(g.players)) if (p.boxCall && p.lap === 0 && p.bot?.plan?.[0].laps > 1) early.add(p.id); // a 1-lap first stint is called on lap 0
    }
    assert.deepStrictEqual([...early], [], 'called in before their plan');
});

// A 3-lap race is a sprint (tyres.js stopRule): with the two-compound rule, 22 cars and one box per team overflowed the
// pit lane and the last-lap call brought in everyone left. Now nobody has to stop, and nobody is called in late.
test('3-lap race of 22 bots: a sprint, no last-lap pit rush, everyone finishes unpenalised for tyres', () => {
    const Game = require('../src/game/Game'), Track = require('../src/game/Track');
    const g = new Game({ emit() {}, volatile: { emit() {} } }, fillGrid([], 'pro', 3, 22), Track.load('monza'), { maxLaps: 3, qualifying: false, rng: rngOf(7) }, () => {});
    g.release();
    const late = new Set(), prev = {};
    for (let k = 0; k < 60 * 400 && !Object.values(g.players).every((p) => p.finished); k++) {
        g.update();
        for (const p of Object.values(g.players)) { if (p.boxCall && !prev[p.id] && p.lap === 2) late.add(p.id); prev[p.id] = p.boxCall; }
    }
    const ps = Object.values(g.players);
    assert.deepStrictEqual([...late], [], 'called in on the last lap');
    assert.strictEqual(ps.filter((p) => p.finished).length, 22);
    assert.deepStrictEqual(ps.filter((p) => p.compoundsUsed.length < 2 && p.penalty >= 22).map((p) => p.id), [], 'tyre penalty in a sprint');
});
