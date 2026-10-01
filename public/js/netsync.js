// Snapshot buffer + interpolation for the 60 Hz fast updates. Pure, shared by game3d.js and the node tests.
// Packet: { s: seq, t: session clock (s, never frozen), g: race time (s), c: [[idx, x, y, angle, speed, steer, flags], ...] }
export const INTERP_S = 0.05;     // other cars are drawn this far behind server time
export const EXTRAP_MAX_S = 0.1;  // past the newest snapshot, coast at most this long, then hold
export const BUFFER_S = 1;
const OFFSET_DRIFT = 0.05;        // how fast the clock estimate follows packets that arrive later than the best seen
export const FLAGS = { inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 }; // matches Game.FLAGS

export function decodeFlags(f) {
    const o = {};
    for (const k in FLAGS) o[k] = (f & FLAGS[k]) !== 0;
    return o;
}

const toSnap = (pkt) => ({ s: pkt.s, t: pkt.t, g: pkt.g, cars: new Map(pkt.c.map((e) => [e[0], e])) });
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const pose = (e) => ({ x: e[1], y: e[2], angle: e[3], speed: e[4], steer: e[5], flags: e[6] });

export class SnapshotBuffer {
    constructor() {
        this.snaps = [];     // ordered by seq
        this.offset = null;  // local arrival time minus server time, from the least-delayed packets
        this.lastNow = -Infinity;
    }

    push(pkt, arrivalS) {
        const newest = this.snaps.at(-1);
        if (this.snaps.some((x) => x.s === pkt.s)) return false;
        if (newest && pkt.s < newest.s) {
            if (pkt.t < newest.t - BUFFER_S) return false;
            const i = this.snaps.findIndex((x) => x.s > pkt.s);
            this.snaps.splice(i, 0, toSnap(pkt));
        } else {
            this.snaps.push(toSnap(pkt));
            // Late packets only nudge the estimate, so jitter can't pull the clock back; the drift follows tick-rate skew
            const o = arrivalS - pkt.t;
            if (this.offset === null || o < this.offset) this.offset = o;
            else this.offset += (o - this.offset) * OFFSET_DRIFT;
        }
        while (this.snaps.length > 2 && this.snaps.at(-1).t - this.snaps[0].t > BUFFER_S) this.snaps.shift();
        return true;
    }

    serverNow(nowS) {
        if (this.offset === null) return 0;
        this.lastNow = Math.max(this.lastNow, nowS - this.offset); // never runs backwards
        return this.lastNow;
    }

    // Race time (lap timing) at server time serverT; held still while the race clock is frozen (countdown)
    gameTime(serverT) {
        const n = this.snaps.at(-1), p = this.snaps.at(-2);
        if (!n) return 0;
        const g = n.g ?? n.t;
        if (p && (p.g ?? p.t) === g) return g;
        return g + (serverT - n.t);
    }

    latest() {
        return this.snaps.at(-1) || null;
    }
}

// Car idx at server time renderT: interpolated between snapshots, briefly extrapolated past the newest
export function sample(buf, renderT, idx) {
    const S = buf.snaps;
    for (let k = S.length - 1; k >= 0; k--) {
        const a = S[k].cars.get(idx);
        if (!a || S[k].t > renderT) continue;
        for (let j = k + 1; j < S.length; j++) {
            const b = S[j].cars.get(idx);
            if (!b) continue;
            const f = (renderT - S[k].t) / (S[j].t - S[k].t);
            return {
                x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, angle: lerpAngle(a[3], b[3], f),
                speed: a[4] + (b[4] - a[4]) * f, steer: a[5] + (b[5] - a[5]) * f, flags: f < 0.5 ? a[6] : b[6],
            };
        }
        return project(a, renderT - S[k].t);
    }
    for (const s of S) { const a = s.cars.get(idx); if (a) return pose(a); } // renderT before every snapshot
    return null;
}

export function project(e, dtS) {
    const dt = Math.max(0, Math.min(dtS, EXTRAP_MAX_S));
    return { x: e[1] + Math.cos(e[3]) * e[4] * dt, y: e[2] + Math.sin(e[3]) * e[4] * dt, angle: e[3], speed: e[4], steer: e[5], flags: e[6] };
}
