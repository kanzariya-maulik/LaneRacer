// Fixed-step game loop: time accumulator, polled about every millisecond. setInterval(16.7) drifts and bunches ticks.
// Date.now (1 ms, same as the poll) so mocked timers can drive it in tests; a clock jump either way resyncs.
class Ticker {
    constructor(stepMs, run, now = () => Date.now(), maxCatchUp = 4) {
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
        // A long stall: resync, don't burst. Clock set back: resync, don't freeze until it catches up
        if (now - this.next > this.stepMs || this.next - now > 1000) this.next = now + this.stepMs;
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
