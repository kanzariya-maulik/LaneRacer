// test/powerups.test.js
// Acceptance test for Step 9: Power-ups, durations, and scoring rules

import test from 'node:test';
import assert from 'node:assert';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

test('Step 9(a): Star powerup upgrades star tier (capped at 3) and awards 500 pts', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;
  p.stars = 0;
  p.score = 0;

  // Star 1
  sim.applyPowerup(p, 'star');
  assert.strictEqual(p.stars, 1);
  assert.strictEqual(p.score, 500);

  // Star 2 & 3
  sim.applyPowerup(p, 'star');
  assert.strictEqual(p.stars, 2);
  sim.applyPowerup(p, 'star');
  assert.strictEqual(p.stars, 3);

  // Capped at 3
  sim.applyPowerup(p, 'star');
  assert.strictEqual(p.stars, 3);
  assert.strictEqual(p.score, 2000);
});

test('Step 9(b): Helmet grants 600 frames of invulnerability shield', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;
  p.shield = 0;

  sim.applyPowerup(p, 'helmet');
  assert.strictEqual(p.shield, CONST.HELMET_SHIELD_FRAMES);
});

test('Step 9(c): Clock freezes all enemies for 600 frames', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;

  const enemy = {
    id: 10,
    team: 'enemy',
    kind: 'basic',
    x16: 64 << CONST.FP_SHIFT,
    y16: 64 << CONST.FP_SHIFT,
    dir: CONST.DIR_DOWN,
    hp: 1,
    spawnFrames: 0,
    bulletsInFlight: 0
  };
  sim.tanks.push(enemy);

  sim.applyPowerup(p, 'clock');
  assert.strictEqual(sim.clockTimer, CONST.CLOCK_FREEZE_FRAMES);

  const startY16 = enemy.y16;
  // Step sim for 10 ticks while clock is active
  for (let t = 0; t < 10; t++) {
    sim.step({});
  }
  assert.strictEqual(enemy.y16, startY16, 'Enemy must remain frozen while clock is active');
  assert.strictEqual(sim.clockTimer, CONST.CLOCK_FREEZE_FRAMES - 10);
});

test('Step 9(d): Shovel reinforces fortress with steel and reverts to fresh full bricks', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;

  // Fortress brick cell
  const fortressIdx = 22 * CONST.GRID_CELLS_X + 12;
  sim.map.cellType[fortressIdx] = CONST.TILE_BRICK;
  sim.map.brickBits[fortressIdx] = CONST.BRICK_FULL;

  // Apply shovel
  sim.applyPowerup(p, 'shovel');
  assert.strictEqual(sim.shovelTimer, CONST.SHOVEL_FRAMES);
  assert.strictEqual(sim.map.cellType[fortressIdx], CONST.TILE_STEEL, 'Fortress becomes steel');

  // Advance shovel timer to expiration (1200 frames)
  for (let t = 0; t < CONST.SHOVEL_FRAMES; t++) {
    sim.step({});
  }

  assert.strictEqual(sim.shovelTimer, 0);
  assert.strictEqual(sim.map.cellType[fortressIdx], CONST.TILE_BRICK, 'Reverts to brick');
  assert.strictEqual(sim.map.brickBits[fortressIdx], CONST.BRICK_FULL, 'Restored to fresh full bricks');
});

test('Step 9(e): Grenade destroys active enemies on field, leaves spawning stars intact', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;

  const activeEnemy = {
    id: 10,
    team: 'enemy',
    kind: 'basic',
    x16: 64 << CONST.FP_SHIFT,
    y16: 64 << CONST.FP_SHIFT,
    dir: CONST.DIR_DOWN,
    hp: 1,
    spawnFrames: 0,
    bulletsInFlight: 0
  };
  const spawningEnemy = {
    id: 11,
    team: 'enemy',
    kind: 'basic',
    x16: 96 << CONST.FP_SHIFT,
    y16: 0 << CONST.FP_SHIFT,
    dir: CONST.DIR_DOWN,
    hp: 1,
    spawnFrames: 45, // In spawn star phase
    bulletsInFlight: 0
  };
  sim.tanks.push(activeEnemy);
  sim.tanks.push(spawningEnemy);

  sim.applyPowerup(p, 'grenade');

  assert.strictEqual(sim.tanks.includes(activeEnemy), false, 'Active enemy destroyed by grenade');
  assert.strictEqual(sim.tanks.includes(spawningEnemy), true, 'Spawning star enemy survives grenade');
});

test('Step 9(f): Tank powerup adds +1 reserve life', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;
  p.lives = 3;

  sim.applyPowerup(p, 'tank');
  assert.strictEqual(p.lives, 4);
});

test('Step 9(g): Scoring values (100/200/300/400/500) and 20,000 extra life', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;
  p.score = 19600;
  p.lives = 3;

  // Destroy basic tank (+100) -> 19700
  sim.destroyTank({ id: 2, team: 'enemy', kind: 'basic', x16: 0, y16: 0, hp: 0 }, p);
  assert.strictEqual(p.score, 19700);
  assert.strictEqual(p.lives, 3);

  // Pick up powerup (+500) -> 20200 (crosses 20k boundary)
  sim.applyPowerup(p, 'star');
  assert.strictEqual(p.score, 20200);
  assert.strictEqual(p.lives, 4, 'Crossing 20,000 threshold awards +1 extra life');
});
