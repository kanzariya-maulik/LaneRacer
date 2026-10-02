// NET_SIM=latencyMs,jitterMs,lossPct fakes bad WiFi for tests and headless measurement. Off unless set.
function parseNetSim(str) {
    const m = /^(\d+),(\d+),(\d+(?:\.\d+)?)$/.exec(str || '');
    return m ? { latency: +m[1], jitter: +m[2], loss: +m[3] } : null;
}

function planDelivery(sim, rand = Math.random) {
    if (rand() * 100 < sim.loss) return null;
    return Math.max(0, sim.latency + (rand() * 2 - 1) * sim.jitter);
}

// fn delivered after a simulated delay (or dropped); with no simulation, called straight away
function withNetSim(fn, sim = parseNetSim(process.env.NET_SIM)) {
    if (!sim) return fn;
    return (...args) => {
        const d = planDelivery(sim);
        if (d !== null) setTimeout(() => fn(...args), d);
    };
}

module.exports = { parseNetSim, planDelivery, withNetSim };
