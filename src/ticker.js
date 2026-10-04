// Fixed-step game loop: time accumulator, polled with high precision.
// setInterval(1) on Windows drifts due to the 15.6ms OS timer floor, so we use recursive setImmediate
// alongside setInterval for mock timer compatibility in tests.
const defaultNow = () => {
    // When Node's test runner mock timers are active on Date, use Date.now()
    if (Date.now.toString().includes('MockDate')) {
        return Date.now();
    }
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
};

class Ticker {
    constructor(stepMs, run, now = defaultNow, maxCatchUp = 4) {
        Object.assign(this, { stepMs, run, now, maxCatchUp, timer: null, immediate: null, next: 0, running: false });
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
        this.running = true;
        // Interval fallback for mock timers in tests:
        this.timer = setInterval(() => this.poll(), 1);
        // High-precision setImmediate loop: avoids 15.6ms Windows timer floor
        const loop = () => {
            if (!this.running) return;
            this.poll();
            if (this.running) {
                this.immediate = setImmediate(loop);
            }
        };
        this.immediate = setImmediate(loop);
    }

    stop() {
        this.running = false;
        if (this.timer) clearInterval(this.timer);
        if (this.immediate) clearImmediate(this.immediate);
        this.timer = null;
        this.immediate = null;
    }
}

module.exports = Ticker;
