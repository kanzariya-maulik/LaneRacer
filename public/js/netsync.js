// Snapshot buffer + interpolation for the 60 Hz fast updates. Pure, shared by game3d.js and the node tests.
// Packet: { s: seq, t: session clock (s, never frozen), g: race time (s),
//           c: [[idx, x, y, angle, speed, steer, flags, vx, vy, tow, lastSeq], ...] }
export const INTERP_S = 0.05;     // fixed delay (tests); the game uses the adaptive targetDelayS()
export const EXTRAP_MAX_S = 0.25; // past the newest snapshot, dead-reckon on the arc this long, then hold
export const TICK_S = 1 / 60;
export const MIN_DELAY_S = 0.035, MAX_DELAY_S = 0.15;  // adaptive interpolation delay range
export const DILATION = 0.05;     // render clock may run 5% fast or slow to reach the target delay
export const RECOVER_S = 0.1;     // blend from a dead-reckoned pose back to real data over this long
export const BUFFER_S = 1;
const WHEELBASE_M = 3.6;          // CarPhysics.C.WHEELBASE
const OFFSET_DRIFT = 0.05;        // how fast the clock estimate follows packets that arrive later than the best seen
const NEW_SESSION_GAP = 600;      // seq this far below the newest (10 s of ticks) = the server started a new session
const JITTER_WINDOW_S = 2;
export const FLAGS = { inPit: 1, limiter: 2, drs: 4, drsAvailable: 8, finished: 16, lapValid: 32, ghost: 64 }; // matches Game.FLAGS

export function decodeFlags(f, out = {}) {
    for (const k in FLAGS) out[k] = (f & FLAGS[k]) !== 0;
    return out;
}

const toSnap = (pkt) => ({ s: pkt.s, t: pkt.t, g: pkt.g, cars: new Map(pkt.c.map((e) => [e[0], e])) });
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class SnapshotBuffer {
    constructor() {
        this.snaps = [];     // ordered by seq
        this.reset();
    }

    reset() {
        this.snaps = [];
        this.offset = null;  // local arrival time minus server time, from the least-delayed packets
        this.lastNow = -Infinity;
        this.jitterS = 0;    // RFC 3550 smoothed jitter
        this.dev = [];       // [arrival, |transit change|] over the last 2 s, for the p95
        this.lastTransit = null;
        this.received = 0;
        this.expected = 0;
        this.firstS = null;
    }

    push(pkt, arrivalS) {
        let newest = this.snaps.at(-1);
        if (newest && pkt.s < newest.s - NEW_SESSION_GAP) { // seq restarted: a new session, the buffer held a straggler
            this.reset();
            newest = undefined;
        }
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
            if (this.lastTransit !== null) {
                const d = Math.abs(o - this.lastTransit);
                this.jitterS += (d - this.jitterS) / 16;
                this.dev.push([arrivalS, d]);
                while (this.dev[0][0] < arrivalS - JITTER_WINDOW_S) this.dev.shift();
            }
            this.lastTransit = o;
        }
        this.received++;
        if (this.firstS === null || pkt.s < this.firstS) this.firstS = pkt.s;
        this.expected = Math.max(this.expected, this.snaps.at(-1).s - this.firstS + 1);
        while (this.snaps.length > 2 && this.snaps.at(-1).t - this.snaps[0].t > BUFFER_S) this.snaps.shift();
        return true;
    }

    get jitterP95S() {
        if (!this.dev.length) return 0;
        const d = this.dev.map((x) => x[1]).sort((a, b) => a - b);
        return d[Math.floor((d.length - 1) * 0.95)];
    }

    // Interpolation delay: two ticks plus room for the arrival spread actually seen
    targetDelayS() {
        return Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, 2 * TICK_S + 2 * this.jitterP95S));
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

// Render time for remote cars: eases toward (server now − target delay) by stretching time ±5%, never jumping back
export class RenderClock {
    constructor() { this.t = null; this.rate = 1; }

    advance(dtS, serverNowS, targetDelayS) {
        const want = serverNowS - targetDelayS;
        // Start, stall or hitch: further off than the largest delay we'd ever choose means resync, not a slow 5% crawl back
        if (this.t === null || Math.abs(want - this.t) > MAX_DELAY_S + 0.05) { this.t = want; this.rate = 1; return this.t; }
        this.rate = 1 + Math.max(-DILATION, Math.min(DILATION, (want - this.t) * 2));
        this.t += dtS * this.rate;
        return this.t;
    }
}

// Straight-line projection along heading × speed, capped
export function project(e, dtS) {
    const dt = Math.max(0, Math.min(dtS, EXTRAP_MAX_S));
    return { x: e[1] + Math.cos(e[3]) * e[4] * dt, y: e[2] + Math.sin(e[3]) * e[4] * dt, angle: e[3], speed: e[4], steer: e[5], flags: e[6] };
}

// Constant-curvature dead reckoning: yaw rate from speed and steer (bicycle model), capped at EXTRAP_MAX_S
function arc(e, dtS, scale, out) {
    const dt = Math.max(0, Math.min(dtS, EXTRAP_MAX_S)), v = e[4], a = e[3];
    const w = (v / (WHEELBASE_M * scale)) * Math.tan(e[5] || 0);
    if (Math.abs(w) < 1e-6) {
        out.x = e[1] + Math.cos(a) * v * dt; out.y = e[2] + Math.sin(a) * v * dt; out.angle = a;
    } else {
        out.x = e[1] + (v / w) * (Math.sin(a + w * dt) - Math.sin(a));
        out.y = e[2] - (v / w) * (Math.cos(a + w * dt) - Math.cos(a));
        out.angle = a + w * dt;
    }
    out.speed = v; out.steer = e[5]; out.flags = e[6];
    return out;
}

// Cubic Hermite between entries a (time ta) and b (tb), tangents from their velocities (heading × speed for old packets)
function hermite(a, b, ta, tb, renderT, out) {
    const h = tb - ta, f = (renderT - ta) / h, f2 = f * f, f3 = f2 * f;
    const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
    const avx = a[7] ?? Math.cos(a[3]) * a[4], avy = a[8] ?? Math.sin(a[3]) * a[4];
    const bvx = b[7] ?? Math.cos(b[3]) * b[4], bvy = b[8] ?? Math.sin(b[3]) * b[4];
    out.x = h00 * a[1] + h10 * h * avx + h01 * b[1] + h11 * h * bvx;
    out.y = h00 * a[2] + h10 * h * avy + h01 * b[2] + h11 * h * bvy;
    out.angle = lerpAngle(a[3], b[3], f);
    out.speed = a[4] + (b[4] - a[4]) * f;
    out.steer = a[5] + (b[5] - a[5]) * f;
    out.flags = f < 0.5 ? a[6] : b[6];
    return out;
}

const guess = {}; // scratch: where dead reckoning would have the car at recovery

// Car idx at render time: Hermite between snapshots; past the newest, dead-reckon on the arc; coming back from that,
// the gap between the two fades over RECOVER_S. out/state are per-car objects the caller keeps (no per-frame garbage);
// scale = world units per metre.
export function sample(buf, renderT, idx, out = {}, state = null, scale = 6) {
    const S = buf.snaps;
    for (let k = S.length - 1; k >= 0; k--) {
        const a = S[k].cars.get(idx);
        if (!a || S[k].t > renderT) continue;
        let b = null, tb = 0;
        for (let j = k + 1; j < S.length && !b; j++) { b = S[j].cars.get(idx) || null; tb = S[j].t; }
        if (b) {
            hermite(a, b, S[k].t, tb, renderT, out);
            if (state && state.src) { // back from dead reckoning: fade the jump out instead of popping
                arc(state.src, renderT - state.srcT, scale, guess);
                state.ox = guess.x - out.x; state.oy = guess.y - out.y;
                state.oa = Math.atan2(Math.sin(guess.angle - out.angle), Math.cos(guess.angle - out.angle));
                state.blend = RECOVER_S;
                state.src = null;
            }
        } else {
            arc(a, renderT - S[k].t, scale, out);
            if (state) { state.src = a; state.srcT = S[k].t; }
        }
        return fade(out, state, renderT);
    }
    for (const s of S) { const a = s.cars.get(idx); if (a) return arc(a, 0, scale, out); } // renderT before every snapshot
    return null;
}

function fade(out, state, renderT) {
    if (!state) return out;
    if (state.blend > 0) {
        state.blend = Math.max(0, state.blend - Math.max(0, renderT - (state.lt ?? renderT)));
        const k = state.blend / RECOVER_S;
        out.x += state.ox * k; out.y += state.oy * k; out.angle += state.oa * k;
    }
    state.lt = renderT;
    return out;
}
