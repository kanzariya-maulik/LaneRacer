// Fixed-step game loop: hrtime accumulator, polled about every millisecond. setInterval(16.7) drifts and bunches ticks.
class Ticker {
    constructor(stepMs, run, now = () => Number(process.hrtime.bigint()) / 1e6, maxCatchUp = 4) {
        Object.assign(this, { stepMs, run, now, maxCatchUp, timer: null, next: 0 });
    }

    poll() {
        const now = this.now();
        let n = 0;
        while (now >= this.next && n < this.maxCatchUp) {
            this.run();
            this.next += this.stepMs;
            n++;
        }
        if (now - this.next > this.stepMs) this.next = now + this.stepMs; // a long stall: resync, don't burst
    }

    start() {
        this.next = this.now();
        this.timer = setInterval(() => this.poll(), 1);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = Ticker;
