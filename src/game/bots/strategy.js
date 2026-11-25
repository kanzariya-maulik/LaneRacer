// src/game/bots/strategy.js
// AI strategy: a legal tyre plan per bot, box calls when the plan or the wear says so, undercuts, and the release press.
// Uses only the controls a human has (setBoxCall, setNextCompound, the throttle).
const { COMPOUNDS, gripOf, stopRule } = require('../../../public/js/sim/tyres.js');
const { state } = require('./driver');

const WEAR_CAP = 0.75; // the grip cliff starts at 0.8 (kept for callers)
const PIT_BUSY = 3; // cars already in or heading for the pit lane: a bot waits a lap (unless it's the last chance for the tyre rule)
// Near-best plans each level may pick from (share of race time over the fastest): pros always take the fastest
const SPREAD = { pro: 0, hard: 0.004, medium: 0.015, easy: 0.04 };
const SEQS = [];
for (const a of 'SMH') for (const b of 'SMH') { if (a !== b) SEQS.push(a + b); for (const c of 'SMH') if (new Set(a + b + c).size >= 2 && b !== a && c !== b) SEQS.push(a + b + c); }

// What a stop costs on this track: the pit lane at the limiter against the same distance at racing pace, plus the stop
function pitLossS(track) {
    const pit = track?.pit, lapS = track?.racingLine?.lapS || 90;
    if (!pit) return 22;
    const laneM = pit.cum[pit.cum.length - 1] / track.scale, lapM = track.cum[track.path.length] / track.scale;
    return laneM / ((pit.limitKmh || 80) / 3.6) - laneM / (lapM / lapS) + 2.5 + 3; // + stationary, + slowing in / getting going
}

// The race plan with the least race time: each lap at 1 / √grip of its wear (how the car slows: Bot driver and physics), each
// stop at the track's pit loss. Wear per lap = 1 / (life × race laps) at typical load (tyres.js). Order of stints doesn't
// change the time, so equal plans differ only in order: lower levels pick among the near-best for a spread of strategies
function planRace(level, maxLaps, tyreWear, rng, cost = { lapS: 90, pitLossS: 22 }) {
    if (!tyreWear || maxLaps < 2) return [{ compound: 'S', laps: maxLaps }];
    const stint = {}; // stint[c][n]: time for n laps on a fresh set of c
    for (const c of 'SMH') {
        stint[c] = [0];
        for (let k = 0; k < maxLaps; k++) stint[c].push(stint[c][k] + cost.lapS / Math.sqrt(gripOf(c, (k + 0.5) / (COMPOUNDS[c].life * maxLaps))));
    }
    const all = stopRule(maxLaps, tyreWear) ? [] : [...'SMH'].map((c) => ({ seq: [c], laps: [maxLaps], t: stint[c][maxLaps] })); // a sprint: no stop is a plan too
    for (const seq of SEQS) {
        if (seq.length > maxLaps) continue;
        if (seq.length === 2) for (let a = 1; a < maxLaps; a++) all.push({ seq, laps: [a, maxLaps - a], t: stint[seq[0]][a] + stint[seq[1]][maxLaps - a] + cost.pitLossS });
        else for (let a = 1; a < maxLaps - 1; a++) for (let b = 1; a + b < maxLaps; b++) {
            const c = maxLaps - a - b;
            all.push({ seq, laps: [a, b, c], t: stint[seq[0]][a] + stint[seq[1]][b] + stint[seq[2]][c] + 2 * cost.pitLossS });
        }
    }
    const best = Math.min(...all.map((x) => x.t)), near = all.filter((x) => x.t <= best * (1 + (SPREAD[level] ?? SPREAD.medium)) + 1e-9);
    const pick = near[Math.floor(rng() * near.length)];
    return [...pick.seq].map((compound, i) => ({ compound, laps: pick.laps[i] }));
}

function raceTick(p, ctx, b) {
    const g = ctx.game, maxLaps = g.settings.maxLaps || 1;
    if (!b.plan) Object.assign(b, { plan: planRace(p.ai.level, maxLaps, g.settings.tyreWear !== false, ctx.rng, { lapS: (ctx.track.racingLine?.lapS || 90) * p.ai.pace, pitLossS: pitLossS(ctx.track) }), stint: 0, stintLap: 0, stopsSeen: 0, lapSeen: -1, stuckLaps: 0 }); // -1: the first decision is on the grid lap
    if (ctx.frozen && !b.fitted) { g.setNextCompound(p.id, b.plan[0].compound); b.fitted = true; }
    // Release from the box: a press after this driver's delay (the game auto-releases at 0.5 s anyway)
    b.press = p.stop?.phase === 'hold' && p.stop.age >= p.ai.release;
    if (p.stop?.phase === 'lane') b.wantPit = false;
    if (p.stops > b.stopsSeen) { b.stopsSeen = p.stops; b.stint = Math.min(b.stint + 1, b.plan.length - 1); b.stintLap = p.lap; }
    if (ctx.frozen || p.finished) return;
    // Tyre rule not met and the race nearly over (the leader's laps count: a lapped car gets the flag sooner): box now
    const rule = p.compoundsUsed.length < 2 && stopRule(maxLaps, g.settings.tyreWear);
    const mate = ctx.cars.some((o) => o !== p && o.teamId === p.teamId && (o.inPit || o.boxCall === 'this')); // one box per team: no double stack
    const busy = ctx.cars.filter((o) => o !== p && (o.inPit || o.boxCall)).length >= PIT_BUSY; // a full pit lane jams: wait a lap
    const toGo = maxLaps - Math.max(p.lap, ...ctx.cars.map((o) => o.lap)); // laps left for the leader
    // Last resort, not the plan: always on the leader's last lap (a teammate in the box or a busy lane costs seconds, the rule
    // 22); a lap earlier only once the planned stop is overdue and the lane's free. "3 to go" was true on a 3-lap race's grid,
    // "2 to go" called the whole field in the same tick
    const planPast = p.lap - b.stintLap >= b.plan[b.stint].laps;
    if (rule && !p.boxCall && !p.inPit && (toGo <= 1 || (toGo <= 2 && planPast && !busy && !mate))) return box(p, g, b);
    if (p.lap === b.lapSeen) return;
    // Once a lap, on crossing the line: undercut bookkeeping, then the box decision
    b.lapSeen = p.lap;
    b.stuckLaps = b.followS > 0.6 * (p.lastLap || 90) ? b.stuckLaps + 1 : 0;
    b.followS = 0;
    if (p.boxCall || p.inPit) return;
    if (p.lap >= maxLaps - 1 && !rule) return;                                     // the last lap: never
    const last = b.stint >= b.plan.length - 1;
    const lapsIn = p.lap - b.stintLap, planned = b.plan[b.stint].laps;
    const lapM = ctx.track.cum[ctx.track.path.length] / ctx.track.scale;
    const perLap = Math.max(p.wearPerM * lapM, lapsIn >= 1 ? p.wear / lapsIn : 0);
    const undercut = (p.ai.level === 'hard' || p.ai.level === 'pro') && b.stuckLaps >= 2 && lapsIn >= 0.7 * planned;
    const due = !last && (lapsIn + 1 >= planned || p.wear + perLap > 1 || undercut); // the plan's laps, or a set that wouldn't last the lap
    // A stop already due a lap: no more waiting for a busy lane, and a teammate in the box delays it one lap at most
    const overdue = lapsIn >= planned;
    if (due && (overdue ? !mate || lapsIn > planned : !busy && !mate)) box(p, g, b);
}

function box(p, g, b) {
    const last = b.stint >= b.plan.length - 1;
    g.setNextCompound(p.id, last ? (p.compoundsUsed.includes('H') ? 'M' : 'H') : b.plan[b.stint + 1].compound);
    g.setBoxCall(p.id, true);
    b.wantPit = true;
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

module.exports = { planRace, pitLossS, tick, WEAR_CAP };
