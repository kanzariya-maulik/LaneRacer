// test/combat.test.js
// Acceptance test for Step 6: Bullets, destruction, and combat

import test from 'node:test';
import assert from 'node:assert';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

test('Step 6(a): Shooting full brick tile head-on: 2 shots clear 8px, 4 shots clear 16px', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 48 });
  p.spawnFrames = 0;
  p.dir = CONST.DIR_UP;

  // Full brick tile at (tx=2, ty=1) -> cells (4,2), (5,2) [top cell row] and (4,3), (5,3) [bottom cell row]
  const cBottom1 = 3 * CONST.GRID_CELLS_X + 4;
  const cBottom2 = 3 * CONST.GRID_CELLS_X + 5;
  const cTop1 = 2 * CONST.GRID_CELLS_X + 4;
  const cTop2 = 2 * CONST.GRID_CELLS_X + 5;

  sim.map.cellType[cBottom1] = CONST.TILE_BRICK;
  sim.map.brickBits[cBottom1] = CONST.BRICK_FULL;
  sim.map.cellType[cBottom2] = CONST.TILE_BRICK;
  sim.map.brickBits[cBottom2] = CONST.BRICK_FULL;
  sim.map.cellType[cTop1] = CONST.TILE_BRICK;
  sim.map.brickBits[cTop1] = CONST.BRICK_FULL;
  sim.map.cellType[cTop2] = CONST.TILE_BRICK;
  sim.map.brickBits[cTop2] = CONST.BRICK_FULL;

  // Shot 1: fired UP, hits bottom cell row's bottom quarters
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(sim.map.brickBits[cBottom1], 0b0011, 'Shot 1 removes bottom quarters');

  // Shot 2: fired UP, clears bottom cell row completely (8px depth cleared!)
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(sim.map.brickBits[cBottom1], 0, 'Shot 2 removes remaining quarters of bottom cell');
  assert.strictEqual(sim.map.cellType[cBottom1], CONST.TILE_EMPTY, 'Bottom cell now empty');

  // Shot 3: penetrates to top cell row, removes bottom quarters
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(sim.map.brickBits[cTop1], 0b0011, 'Shot 3 removes bottom quarters of top cell');

  // Shot 4: clears top cell row completely (16px depth cleared!)
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(sim.map.cellType[cTop1], CONST.TILE_EMPTY, 'Shot 4 clears top cell completely');
});

test('Step 6(b): Star-3 bullet clears 8 px (whole cell) per shot', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 48 });
  p.spawnFrames = 0;
  p.stars = 3; // Tier 3
  p.dir = CONST.DIR_UP;

  const cIdx = 3 * CONST.GRID_CELLS_X + 4;
  sim.map.cellType[cIdx] = CONST.TILE_BRICK;
  sim.map.brickBits[cIdx] = CONST.BRICK_FULL;

  // Fire 1 shot from Star-3 tank
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});

  assert.strictEqual(sim.map.brickBits[cIdx], 0, 'Star 3 shot clears whole 8px cell in 1 hit');
  assert.strictEqual(sim.map.cellType[cIdx], CONST.TILE_EMPTY);
});

test('Step 6(c): Bullet vs steel: leaves intact (star 0-2), destroys (star 3)', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 48 });
  p.spawnFrames = 0;
  p.dir = CONST.DIR_UP;

  const steelIdx = 3 * CONST.GRID_CELLS_X + 4;
  sim.map.cellType[steelIdx] = CONST.TILE_STEEL;

  // Star 0: blocked, steel intact
  p.stars = 0;
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(sim.map.cellType[steelIdx], CONST.TILE_STEEL, 'Star 0 cannot break steel');

  // Star 3: destroys steel cell
  p.stars = 3;
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(sim.map.cellType[steelIdx], CONST.TILE_EMPTY, 'Star 3 breaks steel');
});

test('Step 6(d): Bullet vs bullet: opposing player and enemy bullets cancel', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 100 });
  p.spawnFrames = 0;
  p.dir = CONST.DIR_UP;

  const e = {
    id: 99,
    team: 'enemy',
    kind: 'basic',
    x16: 32 << CONST.FP_SHIFT,
    y16: 40 << CONST.FP_SHIFT,
    dir: CONST.DIR_DOWN,
    bulletsInFlight: 0,
    spawnFrames: 0,
    hp: 1
  };
  sim.tanks.push(e);

  // Both fire towards each other
  sim.tryFireBullet(p);
  sim.tryFireBullet(e);

  assert.strictEqual(sim.bullets.length, 2, 'Two bullets in flight');

  // Advance until collision
  for (let t = 0; t < 20; t++) {
    sim.step({});
    if (sim.bullets.length === 0) break;
  }

  assert.strictEqual(sim.bullets.length, 0, 'Both opposing bullets must cancel out');
  assert.ok(sim.events.some(ev => ev.e === 'bullet_cancelled'));
});

test('Step 6(e): Fast bullet never tunnels through a 4-px wall', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 48 });
  p.spawnFrames = 0;
  p.stars = 1; // Fast bullet (6 px/f)
  p.dir = CONST.DIR_UP;

  // Thin 4-px wall (bottom-half quarters only) at cell (4, 3)
  const thinIdx = 3 * CONST.GRID_CELLS_X + 4;
  sim.map.cellType[thinIdx] = CONST.TILE_BRICK;
  sim.map.brickBits[thinIdx] = CONST.BRICK_BL | CONST.BRICK_BR; // 4px thin slice

  // Fire fast bullet
  sim.step({ 1: { dir: CONST.DIR_UP, fire: true } });

  // Run sim ticks
  for (let t = 0; t < 10; t++) {
    sim.step({});
  }

  // Fast bullet must have collided with the 4-px wall without tunneling through
  assert.strictEqual(sim.map.brickBits[thinIdx], 0, 'Bullet hit and consumed thin wall');
  assert.strictEqual(sim.bullets.length, 0, 'Bullet stopped at thin wall without tunneling');
});
