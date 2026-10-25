// How hard the bots race: 22 pro bots, 5 laps, per track and seed. Best/median lap ÷ the line's lapS, overtakes between
// cars on track (not pit stops), collisions, DNFs, cars that made their stop.
// node scripts/bot-race.mjs --tracks monza,spa --seeds 1,2,3 [--level pro] [--laps 5] [--out file.json]
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const Game = require('../src/game/Game.js');
const Track = require('../src/game/Track.js');
const { fillGrid, rngOf } = require('../src/game/bots/roster.js');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const tracks = arg('tracks', 'monza,spa,silverstone,suzuka,monaco,interlagos').split(',');
const seeds = arg('seeds', '1,2,3').split(',').map(Number), level = arg('level', 'pro'), laps = +arg('laps', 5);
const SAMPLE_S = 0.25, NEAR_M = 60, CLEAR_M = 3; // order checked 4× a second; a pass = from CLEAR_M behind to CLEAR_M ahead, within NEAR_M

function race(id, seed) {
    const t = Track.load(id), sc = t.scale, lapM = t.cum[t.path.length] / sc;
    let collisions = 0;
    const io = { emit: (e, d) => { if (e === 'track_limits' && d.kind === 'collision') collisions++; }, volatile: { emit() {} } };
    const g = new Game(io, fillGrid([], level, 3, 22), t, { maxLaps: laps, qualifying: false, tyreWear: true, collisions: true, contactPenalties: true, ghostStart: true, formationLap: false, rng: rngOf(seed) }, () => {}, 'race');
    g.update(); g.release();
    const cars = Object.values(g.players);
    // Each car's distance driven, unwrapped across the line (lap counters and lapS don't reset on the same tick)
    const odo = cars.map(() => 0), last = cars.map((p) => (p.lapS ?? 0) / sc), side = new Map();
    let overtakes = 0, nextSample = 0;
    for (let k = 0; k < 60 * 60 * 12 && !g.classified; k++) {
        g.update();
        if (g.time < nextSample) continue;
        nextSample = g.time + SAMPLE_S;
        cars.forEach((p, i) => { const s = (p.lapS ?? 0) / sc; let d = s - last[i]; if (d < -lapM / 2) d += lapM; if (d > lapM / 2) d -= lapM; odo[i] += d; last[i] = s; });
        for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
            const a = cars[i], b = cars[j], key = i * 64 + j, gap = odo[i] - odo[j];
            if (a.finished || b.finished || a.inPit || b.inPit || a.stop || b.stop || Math.abs(gap) > NEAR_M) { side.delete(key); continue; }
            const now = gap > CLEAR_M ? 1 : gap < -CLEAR_M ? -1 : 0, was = side.get(key);
            if (!now) continue; // side by side: no verdict yet
            if (was && was !== now) overtakes++;
            side.set(key, now);
        }
    }
    const ref = t.racingLine.lapS, best = cars.map((p) => p.bestLap).filter((x) => x > 0).sort((a, b) => a - b);
    return {
        best: +best[0].toFixed(2), bestRatio: +(best[0] / ref).toFixed(4), medianRatio: +(best[best.length >> 1] / ref).toFixed(4),
        overtakes, collisions, dnfs: cars.filter((p) => p.dnf).length, stopped: cars.filter((p) => p.stops >= 1).length, raceS: Math.round(g.time),
    };
}

const out = {};
for (const id of tracks) {
    out[id] = {};
    for (const seed of seeds) {
        out[id][seed] = race(id, seed);
        console.log(id, seed, JSON.stringify(out[id][seed]));
    }
}
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 1));
