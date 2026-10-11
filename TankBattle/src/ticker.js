// Fixed-step game loop: time accumulator, polled about every millisecond.
// Avoids drifting and bunching ticks seen with standard setInterval(16.67).
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
        // A long stall: resync, don't burst. Clock set back: resync
        if (now - this.next > this.stepMs || this.next - now > 1000) {
            this.next = now + this.stepMs;
        }
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
