const test = require('node:test');
const assert = require('node:assert');
const {
    DriftScorer,
    MIN_DRIFT_ANGLE_DEG,
    MAX_DRIFT_ANGLE_DEG,
    SPINOUT_ANGLE_DEG,
    MIN_DRIFT_SPEED_KMH,
    COMBO_TIMEOUT_S
} = require('../src/game/DriftScorer');

const DT = 1 / 60;
const mkTrack = () => ({
    scale: 6,
    path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    checkpoints: [
        { x: 0, y: 0 },
        { x: 100, y: 100 }
    ]
});

const mkPlayer = (id = 'p1', x = 0, y = 0, vx = 50, vy = 30, angle = 0) => ({
    id,
    x,
    y,
    vx,
    vy,
    angle,
    checkpoint: 0,
    inPit: false,
    finished: false
});

test('DriftScorer constants are correctly defined', () => {
    assert.strictEqual(MIN_DRIFT_ANGLE_DEG, 15);
    assert.strictEqual(MAX_DRIFT_ANGLE_DEG, 65);
    assert.strictEqual(SPINOUT_ANGLE_DEG, 72);
    assert.strictEqual(MIN_DRIFT_SPEED_KMH, 22);
    assert.strictEqual(COMBO_TIMEOUT_S, 1.6);
});

test('update accumulates combo points and scales multiplier during drift', () => {
    const scorer = new DriftScorer();
    // vx = 60, vy = 40, angle = 0 -> slip angle ~33.7 deg, speed ~72 km/h
    const player = mkPlayer('p1', 0, 0, 60, 40, 0);
    const track = mkTrack();

    let lastResult = null;
    for (let i = 0; i < 60; i++) {
        lastResult = scorer.update(player, track, [player], DT);
    }

    assert.ok(lastResult !== null, 'returns drift telemetry event');
    assert.strictEqual(lastResult.event, 'drift');
    assert.ok(lastResult.currentCombo > 0, `combo points accumulated: ${lastResult.currentCombo}`);
    assert.ok(lastResult.multiplier > 1.0, `multiplier grew: ${lastResult.multiplier}`);
    assert.ok(lastResult.angle >= 15 && lastResult.angle <= 65, `angle recorded: ${lastResult.angle}`);
});

test('combo banks into total score when drift stops and idle timer expires', () => {
    const scorer = new DriftScorer();
    const track = mkTrack();

    // 1. Drift for 30 ticks
    const driftingPlayer = mkPlayer('p1', 0, 0, 60, 40, 0);
    for (let i = 0; i < 30; i++) {
        scorer.update(driftingPlayer, track, [driftingPlayer], DT);
    }
    const stateBefore = scorer.getPlayer('p1');
    const accumulatedCombo = stateBefore.currentCombo;
    assert.ok(accumulatedCombo > 0, 'combo accumulated');

    // 2. Straighten car (no drift angle)
    const straightPlayer = mkPlayer('p1', 0, 0, 60, 0, 0);
    let bankResult = null;
    // 1.6s at 60 Hz = 96 ticks, run 110 ticks
    for (let i = 0; i < 110; i++) {
        const res = scorer.update(straightPlayer, track, [straightPlayer], DT);
        if (res && res.event === 'banked') bankResult = res;
    }

    assert.ok(bankResult !== null, 'bank event triggered');
    assert.strictEqual(bankResult.event, 'banked');
    assert.strictEqual(bankResult.totalScore, accumulatedCombo);
    assert.strictEqual(scorer.getPlayer('p1').currentCombo, 0);
});

test('spinout (> 72°) resets combo with 0 points banked', () => {
    const scorer = new DriftScorer();
    const track = mkTrack();

    // Drift first
    const player = mkPlayer('p1', 0, 0, 60, 40, 0);
    for (let i = 0; i < 20; i++) scorer.update(player, track, [player], DT);
    assert.ok(scorer.getPlayer('p1').currentCombo > 0);

    // Spin out: vx = 10, vy = 100, angle = 0 -> slip angle ~84 deg > 72 deg
    const spinoutPlayer = mkPlayer('p1', 0, 0, 10, 100, 0);
    const spinResult = scorer.update(spinoutPlayer, track, [spinoutPlayer], DT);

    assert.ok(spinResult !== null, 'spinout event received');
    assert.strictEqual(spinResult.event, 'spinout');
    assert.strictEqual(scorer.getPlayer('p1').currentCombo, 0, 'combo wiped out');
    assert.strictEqual(scorer.getPlayer('p1').totalScore, 0, 'zero score banked');
});

test('clipping zone near checkpoint triggers clipping bonus', () => {
    const scorer = new DriftScorer();
    const track = mkTrack();
    // Position car close to next checkpoint (100, 100)
    const player = mkPlayer('p1', 98, 98, 60, 40, 0);
    player.checkpoint = 0; // next is checkpoint[1] at (100, 100)

    const res = scorer.update(player, track, [player], DT);
    assert.ok(res !== null);
    assert.strictEqual(res.bonusMsg, 'CLIPPING POINT!');
});

test('tandem chase proximity triggers multiplier bonus when following a drifting lead car', () => {
    const scorer = new DriftScorer();
    const track = mkTrack();

    // Lead car drifting ahead at (50, 0), world scale 6 -> dist = 50 / 6 = 8.3m
    const lead = mkPlayer('lead', 50, 0, 60, 40, 0);
    lead.driftAngle = 35;
    scorer.update(lead, track, [lead], DT);

    // Chase car drifting behind at (0, 0)
    const chase = mkPlayer('chase', 0, 0, 60, 40, 0);
    chase.driftAngle = 33;
    const res = scorer.update(chase, track, [lead, chase], DT);

    assert.ok(res !== null);
    assert.strictEqual(res.bonusMsg, 'TANDEM PROXIMITY!');
});

test('rankPlayers sorts by total score + current combo descending', () => {
    const scorer = new DriftScorer();
    const p1 = mkPlayer('p1');
    const p2 = mkPlayer('p2');
    const p3 = mkPlayer('p3');

    scorer.getPlayer('p1').totalScore = 1000;
    scorer.getPlayer('p2').totalScore = 3000;
    scorer.getPlayer('p3').totalScore = 2000;
    scorer.getPlayer('p3').currentCombo = 1500; // 3500 total

    const ranked = scorer.rankPlayers([p1, p2, p3]);
    assert.deepStrictEqual(ranked.map(p => p.id), ['p3', 'p2', 'p1']);
});
