// Records today's car motion so the shared-simulation refactor can prove it changed nothing.
// Run once BEFORE moving any physics code: node test/fixtures/make-drive-golden.js
const fs = require('fs');
const path = require('path');
const Game = require('../../src/game/Game');
const Track = require('../../src/game/Track');
const Physics = require('../../src/game/Physics');

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const io = { emit() {}, volatile: { emit() {} } };

function trace() {
    const out = {};
    for (const id of Track.TRACK_IDS) {
        const t = Track.load(id), rand = rng(1234 + id.length);
        const g = new Game(io, [{ id: 'a', username: 'A', teamId: 'redbull', assist: 'full' }], t, { maxLaps: 99, qualifying: false }, () => {});
        g.frozen = false;
        const p = g.players.a, rows = [];
        let wild = null;
        for (let k = 0; k < 2000; k++) {
            // Mostly follow the track (laps, kerbs, braking zones) with noise; every 30 ticks maybe something wild (walls, grass, spins)
            if (k % 30 === 0) wild = rand() < 0.3 ? { steer: rand() * 2 - 1, throttle: rand() < 0.6 ? 1 : 0, brake: rand() < 0.3 ? 1 : 0 } : null;
            const n = Physics.nearestOnTrack(p.x, p.y, t), ah = t.path[(n.i + 4) % t.path.length];
            let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            p.input = { steer: Math.max(-1, Math.min(1, d * 2 + (rand() - 0.5) * 0.6)), throttle: rand() < 0.9 ? 1 : 0, brake: rand() < 0.05 ? 1 : 0, drs: rand() < 0.3, ...wild };
            g.drive(p);
            if (k % 100 === 99) rows.push([p.x, p.y, p.vx, p.vy, p.angle, p.speed, p.steer].map((v) => v + 0).concat([!!p.inPit, !!p.limiter])); // + 0: JSON has no -0
        }
        out[id] = rows;
    }
    return out;
}

module.exports = { trace };
if (require.main === module) {
    fs.writeFileSync(path.join(__dirname, 'drive-golden.json'), JSON.stringify(trace()));
    console.log('wrote drive-golden.json');
}
