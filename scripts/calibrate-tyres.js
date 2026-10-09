// node scripts/calibrate-tyres.js: mean raw tyre load (tyres.js wearLoad × LOAD_TYPICAL) over a clean lap on each circuit,
// driven by the steering assist's own bot (steer at the centreline 3 points ahead, throttle to the safe speed)
const Track = require('../src/game/Track');
const Physics = require('../src/game/Physics');
(async () => {
    const D = await import('../public/js/sim/drive.js'), T = await import('../public/js/sim/tyres.js');
    const means = [];
    for (const id of Track.TRACK_IDS) {
        const t = Track.load(id), s = t.startPositions[0];
        const p = { x: s.x, y: s.y, angle: s.angle, vx: 0, vy: 0, speed: 0, steer: 0, assist: 'full', tow: 0, lastSafeX: s.x, lastSafeY: s.y };
        let sum = 0, metres = 0;
        const total = t.cum[t.path.length] / t.scale;
        while (metres < total) {
            const n = Physics.nearestOnTrack(p.x, p.y, t, p.roadI), ah = t.path[(n.i + 3) % t.path.length];
            let d = Math.atan2(ah.y - p.y, ah.x - p.x) - p.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
            const v = Math.hypot(p.vx, p.vy) / t.scale, want = t.safeSpeed[(n.i + 2) % t.path.length];
            const input = { steer: Math.max(-1, Math.min(1, d * 3)), throttle: v < want ? 1 : 0, brake: v > want + 2 ? 1 : 0, drs: false };
            const x0 = p.x, y0 = p.y;
            D.driveCar(p, input, t, 1 / 60);
            const m = Math.hypot(p.x - x0, p.y - y0) / t.scale;
            sum += m * T.wearLoad(p.latUse || 0, input.brake, p.slip || 0) * T.LOAD_TYPICAL; metres += m;
        }
        means.push(sum / metres);
        console.log(id.padEnd(12), (sum / metres).toFixed(3));
    }
    console.log('LOAD_TYPICAL =', (means.reduce((a, b) => a + b, 0) / means.length).toFixed(2));
})();
