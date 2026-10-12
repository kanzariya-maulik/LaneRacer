// src/game/bots/strategy.js
// AI strategy: a legal tyre plan per bot, box calls when the plan or the wear says so, undercuts, and the release press.
// Uses only the controls a human has (setBoxCall, setNextCompound, the throttle).
const { COMPOUNDS } = require('../../../public/js/sim/tyres.js');
const { state } = require('./driver');

const WEAR_CAP = 0.75; // a stint ends before this much wear (the grip cliff starts at 0.8)
const PLANS = [['M', 'H'], ['H', 'M'], ['S', 'H'], ['S', 'M', 'S'], ['S', 'H', 'S']];

// Laps per stint: each at least 1 and within cap × life × race; the rest shared out, weighted toward room left
function split(compounds, maxLaps, cap, rng) {
    const most = compounds.map((c) => Math.floor(cap * COMPOUNDS[c].life * maxLaps + 1e-9));
    if (compounds.length > maxLaps || most.some((m) => m < 1) || most.reduce((a, b) => a + b, 0) < maxLaps) return null;
    const laps = compounds.map(() => 1);
    for (let left = maxLaps - laps.length; left > 0; left--) {
        const room = laps.map((l, i) => Math.max(0, most[i] - l)), total = room.reduce((a, b) => a + b, 0);
        let pick = rng() * total, i = 0;
        while (pick >= room[i]) pick -= room[i++];
        laps[i]++;
    }
    return compounds.map((c, i) => ({ compound: c, laps: laps[i] }));
}

function planRace(level, maxLaps, tyreWear, rng) {
    if (!tyreWear || maxLaps < 2) return [{ compound: 'S', laps: maxLaps }];
    const twoStopWeight = (level === 'hard' || level === 'pro' ? 2 : 1) * (maxLaps >= 15 ? 2 : 0.5);
    for (const cap of [WEAR_CAP, 1, Infinity]) { // short races may not fit under the cliff: then the rule wins
        const ok = PLANS.map((pl) => split(pl, maxLaps, cap, rng)).filter(Boolean);
        if (!ok.length) continue;
        const w = ok.map((s) => (s.length === 3 ? twoStopWeight : 2));
        let pick = rng() * w.reduce((a, b) => a + b, 0), i = 0;
        while (pick >= w[i]) pick -= w[i++];
        return ok[i];
    }
    return [{ compound: 'M', laps: maxLaps - 1 }, { compound: 'H', laps: 1 }]; // unreachable for maxLaps ≥ 2
}

function raceTick(p, ctx, b) {
    const g = ctx.game, maxLaps = g.settings.maxLaps || 1;
    if (!b.plan) Object.assign(b, { plan: planRace(p.ai.level, maxLaps, g.settings.tyreWear !== false, ctx.rng), stint: 0, stintLap: 0, stopsSeen: 0, lapSeen: -1, stuckLaps: 0 }); // -1: the first decision is on the grid lap
    if (ctx.frozen && !b.fitted) { g.setNextCompound(p.id, b.plan[0].compound); b.fitted = true; }
    // Release from the box: a press after this driver's delay (the game auto-releases at 0.5 s anyway)
    b.press = p.stop?.phase === 'hold' && p.stop.age >= p.ai.release;
    if (p.stop?.phase === 'lane') b.wantPit = false;
    if (p.stops > b.stopsSeen) { b.stopsSeen = p.stops; b.stint = Math.min(b.stint + 1, b.plan.length - 1); b.stintLap = p.lap; }
    if (p.lap === b.lapSeen || ctx.frozen || p.finished) return;
    // Once a lap, on crossing the line: undercut bookkeeping, then the box decision
    b.lapSeen = p.lap;
    b.stuckLaps = b.followS > 0.6 * (p.lastLap || 90) ? b.stuckLaps + 1 : 0;
    b.followS = 0;
    if (p.boxCall || p.inPit) return;
    const rule = p.compoundsUsed.length < 2 && g.settings.tyreWear !== false && maxLaps >= 2;
    if (p.lap >= maxLaps - 1 && !rule) return;                                     // the last lap: never
    const last = b.stint >= b.plan.length - 1;
    const lapsIn = p.lap - b.stintLap, planned = b.plan[b.stint].laps;
    const lapM = ctx.track.cum[ctx.track.path.length] / ctx.track.scale;
    const perLap = Math.max(p.wearPerM * lapM, lapsIn >= 1 ? p.wear / lapsIn : 0);
    const undercut = (p.ai.level === 'hard' || p.ai.level === 'pro') && b.stuckLaps >= 2 && lapsIn >= 0.7 * planned;
    const due = !last && (lapsIn + 1 >= planned || p.wear + perLap > WEAR_CAP + 0.05 || undercut);
    if (due || (rule && p.lap >= maxLaps - 2)) {
        const next = last ? (p.compoundsUsed.includes('H') ? 'M' : 'H') : b.plan[b.stint + 1].compound;
        g.setNextCompound(p.id, next);
        g.setBoxCall(p.id, true);
        b.wantPit = true;
    }
}

// Exit window per level, as shares of the segment clock: later = more track evolution, never too late for a lap
const EXIT = { easy: [0, 0.6], medium: [0.3, 0.7], hard: [0.55, 0.75], pro: [0.55, 0.75] };

function qualiTick(p, ctx, b) {
    const g = ctx.game, q = g.quali, lap = q.refS / 1.15; // a racing lap at pace (refS carries a 15 % margin)
    if (p.qualiOut || !q) return;
    if (b.seg !== q.segment) { // a new segment: plan this one's first exit
        const [lo, hi] = EXIT[p.ai.level] || EXIT.medium, len = Math.max(0, q.endsAt - ctx.time);
        Object.assign(b, { seg: q.segment, runs: 0, timed: 0, wantPit: false, exitAt: ctx.time + len * (lo + (hi - lo) * ctx.rng()) });
        b.exitAt = Math.max(ctx.time, Math.min(b.exitAt, q.endsAt - 2.8 * lap));
    }
    const parked = p.stop?.phase === 'wait';
    if (parked) {
        if (p.compound !== 'S') g.setNextCompound(p.id, 'S'); // parked: fitted at once
        if (b.wantPit || b.timed) { // back from a run: go again only from the drop zone (or with no time) and with time for it
            b.runs++; b.timed = 0; b.wantPit = false;
            const rank = g.segmentRanking().findIndex((e) => e.id === p.id) + 1;
            const atRisk = p.segBest === null || (q.format === 'full' && rank > g.survivors());
            b.exitAt = atRisk && q.endsAt - ctx.time > 2.8 * lap ? ctx.time + 3 : Infinity;
        }
        b.press = q.phase === 'running' && ctx.time >= b.exitAt && g.canLeaveBox(p);
        return;
    }
    b.press = false;
    // On track: count finished timed laps; two of them (or no time for another), or the flag, and it's the in-lap
    if (p.lap !== b.timedSeen) { if (b.timedSeen !== undefined && p.lastLap !== null) b.timed++; b.timedSeen = p.lap; }
    const noTime = q.endsAt - ctx.time < lap;
    if (b.timed >= 2 || (b.timed >= 1 && noTime) || (q.phase === 'flag' && p.lapStart === null)) b.wantPit = true;
}

function tick(p, ctx) {
    const b = state(p);
    if (ctx.mode === 'race') raceTick(p, ctx, b);
    else qualiTick(p, ctx, b);
}

module.exports = { planRace, tick, WEAR_CAP };
