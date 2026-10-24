// When a browser may tell the server it's ready for the start (game3d.js getReady). "One frame drawn" wasn't it: on a
// cold shader cache the GPU then compiled ~100 pipelines for 12-15 s (the page stuck in queue.submit), so the lights and
// the formation lap ran while that screen was frozen. Ready = the grid's real car models in, every pipeline compiled,
// and the GPU keeping up. Pure, node-tested.

// Every grid team's model loaded, or known to have none (its file failed: the procedural car is final), and the tyres
// and helmet in (cars are rebuilt with them, new pipelines)
export function modelsReady({ gridTeams, loaded, failed, parts }) {
    return !!parts && gridTeams.every((t) => loaded.has(t) || failed.has(t));
}

// Frames in a row that finished quickly (frame time, ms) with no pipeline still compiling (pending: their objects aren't
// drawn yet, so those frames are quick for the wrong reason). One slow frame (a texture upload) starts the count again.
// A machine that never gets that quick still goes after maxMs: it must not hold everyone's start
export class Settle {
    constructor({ quickMs = 50, need = 5, maxMs = 20000 } = {}) {
        Object.assign(this, { quickMs, need, maxMs, run: 0, spent: 0, ready: false, gaveUp: false });
    }

    frame(ms, pending = 0) {
        if (this.ready) return;
        this.spent += ms;
        this.run = ms < this.quickMs && !pending ? this.run + 1 : 0;
        if (this.run >= this.need) this.ready = true;
        else if (this.spent >= this.maxMs) this.ready = this.gaveUp = true;
    }
}

// No frame ever waits for a shader. three builds a pipeline it hasn't seen synchronously at its first draw (r186:
// Pipelines.updateForRender passes no promise list) and Chrome holds every frame until the GPU process has compiled it:
// 10 s frozen on a cold cache (post passes, shadow maps, anything new mid-race). Given a list it compiles in the
// background and the draw skips that object until it's ready (Renderer._renderObjectDirect: pipelines.isReady): an object
// can show a few frames late, nothing freezes. Only for draws made inside during(): the frames. A one-shot capture (sky
// cube, environment map) is drawn once, so it stays synchronous or it would keep the empty result.
// `pending`: how many are still compiling (getReady waits for 0)
export function backgroundPipelines(r) {
    let on = false;
    const count = { pending: 0, during(draw) { on = true; try { return draw(); } finally { on = false; } } }, pipes = r._pipelines;
    if (!pipes?.getForRender) return count;
    pipes.updateForRender = (ro) => {
        if (!on) return pipes.getForRender(ro);
        const list = [];
        pipes.getForRender(ro, list);
        for (const p of list) { count.pending++; p.finally(() => count.pending--); }
    };
    return count;
}

// A compile in progress (postfx.js compile) holds the scene pass's target and outputs on the renderer across its awaits:
// three builds the node shaders against them then. Anything else drawn meanwhile (a frame, the environment map, the sky
// cube) inherited them and got shaders for the wrong outputs ("structures must have at least one member"). The outermost
// render() puts whichever of them is still the held one aside for its draw; passes inside it set their own
export function guardHeldTargets(r) {
    const render = r.render.bind(r);
    let depth = 0;
    r.render = (...args) => {
        const h = r.compileHold, rt = r.getRenderTarget(), m = r.getMRT();
        const dropRT = !depth && h && rt === h.rt, dropMRT = !depth && h && m === h.mrt;
        if (dropRT) r.setRenderTarget(null);
        if (dropMRT) r.setMRT(null);
        depth++;
        try { return render(...args); } finally {
            depth--;
            if (dropRT) r.setRenderTarget(rt);
            if (dropMRT) r.setMRT(m);
        }
    };
}
