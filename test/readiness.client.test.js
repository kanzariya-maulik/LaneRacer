// When a browser may tell the server it's ready for the start: the grid's real car models in, every pipeline compiled,
// and the GPU keeping up (frames finishing quickly) — not just "one frame drawn" (pure; node-tested)
const { test, before } = require('node:test');
const assert = require('node:assert');
let R;
before(async () => { R = await import('../public/js/readiness.js'); });

test('modelsReady: every grid team has its model (or none exists to wait for) and the tyres/helmet are in', () => {
    const grid = ['ferrari', 'mclaren', 'ferrari'];
    assert.strictEqual(R.modelsReady({ gridTeams: grid, loaded: new Set(['ferrari']), failed: new Set(), parts: true }), false);
    assert.strictEqual(R.modelsReady({ gridTeams: grid, loaded: new Set(['ferrari', 'mclaren']), failed: new Set(), parts: false }), false);
    assert.strictEqual(R.modelsReady({ gridTeams: grid, loaded: new Set(['ferrari', 'mclaren']), failed: new Set(), parts: true }), true);
    assert.strictEqual(R.modelsReady({ gridTeams: grid, loaded: new Set(['ferrari']), failed: new Set(['mclaren']), parts: true }), true, 'a team with no model file never arrives');
});

test('Settle: ready after enough consecutive quick frames; one slow frame (a shader compiling) starts the count again', () => {
    const s = new R.Settle({ quickMs: 50, need: 3, maxMs: 60000 });
    for (const ms of [16, 16]) s.frame(ms);
    assert.strictEqual(s.ready, false);
    s.frame(900); // a compile stall
    for (const ms of [16, 16]) s.frame(ms);
    assert.strictEqual(s.ready, false);
    s.frame(16);
    assert.strictEqual(s.ready, true);
});

test('Settle: a machine that never gets quick still goes after maxMs (never holds the grid forever)', () => {
    const s = new R.Settle({ quickMs: 50, need: 3, maxMs: 1000 });
    for (let i = 0; i < 9; i++) s.frame(120);
    assert.strictEqual(s.ready, true);
    assert.strictEqual(s.gaveUp, true);
});

test('Settle: quick frames with pipelines still compiling in the background are not ready (their objects are not drawn yet)', () => {
    const s = new R.Settle({ quickMs: 50, need: 3, maxMs: 60000 });
    for (let i = 0; i < 10; i++) s.frame(8, 4); // fast only because the 4 pending objects are skipped
    assert.strictEqual(s.ready, false);
    for (const ms of [8, 8]) s.frame(ms, 0);
    assert.strictEqual(s.ready, false);
    s.frame(8, 0);
    assert.strictEqual(s.ready, true);
});

// A fake renderer: render target / MRT state, and what each draw saw
function fakeRenderer() {
    const r = { rt: null, mrt: null, seen: [], compileHold: null,
        getRenderTarget() { return this.rt; }, setRenderTarget(t) { this.rt = t; }, getMRT() { return this.mrt; }, setMRT(m) { this.mrt = m; },
        render(inner) { this.seen.push({ rt: this.rt, mrt: this.mrt }); inner?.(); } };
    return r;
}

test('guardHeldTargets: a draw while a compile holds the scene pass target/outputs never inherits them, and gets them back after', () => {
    const r = fakeRenderer(), RT = { name: 'scenePass' }, MRT = { name: 'mrt' };
    R.guardHeldTargets(r);
    r.render(); // nothing held: untouched
    r.rt = RT; r.mrt = MRT; r.compileHold = { rt: RT, mrt: MRT };
    r.render(); // a frame / the environment map while compiling: drawn with neither
    assert.deepStrictEqual(r.seen[1], { rt: null, mrt: null });
    assert.strictEqual(r.rt, RT); assert.strictEqual(r.mrt, MRT, 'the compile gets its state back');
    const cube = { name: 'pmrem' };
    r.rt = cube; r.render(); // its own target (PMREM, sky cube): kept; only the held outputs go
    assert.deepStrictEqual(r.seen[2], { rt: cube, mrt: null });
    r.rt = RT;
    r.render(() => { r.setRenderTarget(RT); r.setMRT(MRT); r.render(); }); // a pass inside a draw sets them itself: untouched
    assert.deepStrictEqual(r.seen[4], { rt: RT, mrt: MRT });
    r.compileHold = null; r.render();
    assert.deepStrictEqual(r.seen[5], { rt: RT, mrt: MRT }, 'nothing held: never touched');
});

test('backgroundPipelines: the frame pipelines compile in the background, counted until done; one-shot renders stay synchronous', async () => {
    let done, sync = 0;
    const r = { _pipelines: { getForRender(ro, list) { if (list) list.push(new Promise((f) => { done = f; })); else sync++; }, updateForRender(ro) { this.getForRender(ro); } } };
    const count = R.backgroundPipelines(r);
    r._pipelines.updateForRender({}); // a sky cube / environment map capture: drawn once, so it must not skip anything
    assert.strictEqual(sync, 1);
    assert.strictEqual(count.pending, 0);
    count.during(() => r._pipelines.updateForRender({})); // a frame
    assert.strictEqual(count.pending, 1);
    assert.strictEqual(sync, 1);
    done(); await new Promise((f) => setTimeout(f, 0));
    assert.strictEqual(count.pending, 0);
    assert.strictEqual(R.backgroundPipelines({}).pending, 0, 'no pipelines object (another three): left alone');
});
