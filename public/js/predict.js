// Client-side prediction for your own car: run the shared simulation on your inputs straight away,
// then reconcile with the server (rewind to its state, replay unacknowledged inputs, blend out the difference).
import { driveCar } from './sim/drive.js';

export const STEP_S = 1 / 60;
export const SNAP_M = 5;              // corrections this big snap (reset, teleport)
export const BLEND_TAU_S = 0.033;     // smaller ones decay exponentially: ~100 ms to vanish
export const MAX_PENDING = 120;       // 2 s of unacknowledged inputs at most (tab stall)
export const MAX_UNACKED = 60;        // 1 s with no server answer (results screen, dead link): stop driving alone

const FIN = 16;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Predictor {
    constructor(track, assist = 'off') {
        this.track = track;
        this.assist = assist;             // must match the server's setting for this player, or every tick corrects
        this.car = null;
        this.prev = { x: 0, y: 0, angle: 0 };
        this.pending = [];
        this.off = { x: 0, y: 0, angle: 0 };
        this.lastError = 0;
        this.finished = false;
        this.lastS = -1;                  // newest server packet applied
    }

    // Server entry → simulation state
    load(e) {
        const c = this.car;
        c.x = e[1]; c.y = e[2]; c.angle = e[3]; c.speed = e[4]; c.steer = e[5];
        c.inPit = !!(e[6] & 1); c.limiter = !!(e[6] & 2); c.drs = !!(e[6] & 4);
        c.vx = e[7] ?? Math.cos(e[3]) * e[4]; c.vy = e[8] ?? Math.sin(e[3]) * e[4]; c.tow = e[9] || 0;
        c.lastSafeX = c.x; c.lastSafeY = c.y;
        this.finished = !!(e[6] & FIN);
    }

    reset(e) {
        this.car = { assist: this.assist };
        this.load(e);
        this.prev = { x: this.car.x, y: this.car.y, angle: this.car.angle };
        this.pending = [];
        this.off = { x: 0, y: 0, angle: 0 };
        this.lastS = -1;
    }

    step(input) {
        if (!this.car) return;
        this.prev.x = this.car.x; this.prev.y = this.car.y; this.prev.angle = this.car.angle;
        const k = Math.exp(-STEP_S / BLEND_TAU_S);
        this.off.x *= k; this.off.y *= k; this.off.angle *= k;
        if (this.finished) return;                        // the server parks finished cars
        this.pending.push(input);
        if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
        if (this.pending.length <= MAX_UNACKED) driveCar(this.car, input, this.track, STEP_S);
    }

    // s = the packet's server seq: an older packet arriving late (reordered UDP) is ignored — its replay inputs are gone.
    // Keyed on s, not lastSeq: lastSeq legitimately moves back when the server re-aligns a stalled client.
    onServer(e, s = Infinity) {
        if (s !== Infinity && s <= this.lastS) return;
        if (s !== Infinity) this.lastS = s;
        if (!this.car) { this.reset(e); this.lastS = s === Infinity ? -1 : s; return; }
        const lastSeq = e[10];
        if (lastSeq !== undefined && lastSeq >= 0) while (this.pending.length && this.pending[0].seq <= lastSeq) this.pending.shift();
        const bx = this.car.x, by = this.car.y, ba = this.car.angle;
        this.load(e);
        if (!this.finished) for (const input of this.pending) driveCar(this.car, input, this.track, STEP_S);
        const dx = bx - this.car.x, dy = by - this.car.y, err = Math.hypot(dx, dy);
        this.lastError = err;
        if (err < SNAP_M * this.track.scale) {
            this.off.x += dx; this.off.y += dy;
            this.off.angle += Math.atan2(Math.sin(ba - this.car.angle), Math.cos(ba - this.car.angle));
        } else {
            this.off.x = this.off.y = this.off.angle = 0;
            this.prev.x = this.car.x; this.prev.y = this.car.y; this.prev.angle = this.car.angle;
        }
    }

    // Render pose between the last two steps (alpha 0..1) plus the decaying correction; written into out
    pose(alpha, out) {
        const c = this.car;
        out.x = this.prev.x + (c.x - this.prev.x) * alpha + this.off.x;
        out.y = this.prev.y + (c.y - this.prev.y) * alpha + this.off.y;
        out.angle = lerpAngle(this.prev.angle, c.angle, alpha) + this.off.angle;
        out.speed = c.speed;
        out.steer = c.steer;
        return out;
    }
}
