// test/movement.test.js
// Acceptance test for Step 5: Player tank movement, snapping, and collisions

import test from 'node:test';
import assert from 'node:assert';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

test('Step 5(a): Axis-change grid snap: tank at x=67 turning UP snaps x->64', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 67, y: 100 });
  p.dir = CONST.DIR_RIGHT; // moving horizontally
  p.spawnFrames = 0;       // active

  // Changing axis from RIGHT to UP
  sim.processPlayerMovement(p, CONST.DIR_UP);

  const snappedPx = p.x16 >> CONST.FP_SHIFT;
  assert.strictEqual(snappedPx, 64, `x must snap to nearest multiple of 8 (67 -> 64)`);
  assert.strictEqual(p.dir, CONST.DIR_UP);
});

test('Step 5(b): Reversing direction does NOT snap coordinate', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 67, y: 100 });
  p.dir = CONST.DIR_RIGHT;
  p.spawnFrames = 0;

  // Reversing on same horizontal axis: RIGHT -> LEFT
  sim.processPlayerMovement(p, CONST.DIR_LEFT);

  // Position should have moved slightly left at player speed without snapping x to 64
  const currentPx = p.x16 >> CONST.FP_SHIFT;
  assert.notStrictEqual(currentPx, 64, `Reversing must not snap to grid`);
  assert.strictEqual(p.dir, CONST.DIR_LEFT);
});

test('Step 5(c): Cannot enter water, steel, or brick quarter', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;

  // 1. Water at tile (2, 1) -> x=32, y=16
  sim.map.tileType[1 * CONST.GRID_TILES_X + 2] = CONST.TILE_WATER;
  const canWater = sim.canTankOccupy(32, 16, p.id);
  assert.strictEqual(canWater, false, 'Tank cannot enter water');

  // 2. Steel cell at (4, 4) -> x=32, y=32
  sim.map.cellType[4 * CONST.GRID_CELLS_X + 4] = CONST.TILE_STEEL;
  const canSteel = sim.canTankOccupy(32, 32, p.id);
  assert.strictEqual(canSteel, false, 'Tank cannot enter steel');

  // 3. Brick quarter at (cx=6, cy=4) -> bottom-right quarter
  sim.map.cellType[4 * CONST.GRID_CELLS_X + 6] = CONST.TILE_BRICK;
  sim.map.brickBits[4 * CONST.GRID_CELLS_X + 6] = CONST.BRICK_BR;
  const canQuarter = sim.canTankOccupy(48, 32, p.id);
  assert.strictEqual(canQuarter, false, 'Tank cannot enter brick quarter');
});

test('Step 5(d): Gap test: fits through 16-px gap and CANNOT pass 8-px gap', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;

  // Setup vertical walls leaving a 16-px gap at x=32..48
  // Left wall at cx=3 (x=24), Right wall at cx=6 (x=48)
  sim.map.cellType[4 * CONST.GRID_CELLS_X + 3] = CONST.TILE_STEEL; // x=24
  sim.map.cellType[4 * CONST.GRID_CELLS_X + 6] = CONST.TILE_STEEL; // x=48
  // Gap is exactly 24 px wide (from x=32 to 48 is 16 px)
  assert.strictEqual(sim.canTankOccupy(32, 32, p.id), true, 'Must fit through 16px gap');

  // Now narrow gap by placing steel at cx=5 (x=40), making gap only 8 px
  sim.map.cellType[4 * CONST.GRID_CELLS_X + 5] = CONST.TILE_STEEL;
  assert.strictEqual(sim.canTankOccupy(32, 32, p.id), false, 'Cannot pass through 8px gap');
});

test('Step 5(e): Ice slide continues for ~20 ticks after input release', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 64, y: 64 });
  p.spawnFrames = 0;
  p.dir = CONST.DIR_DOWN;

  // Place ice at tile (4, 4) -> x=64, y=64
  sim.map.tileType[4 * CONST.GRID_TILES_X + 4] = CONST.TILE_ICE;

  // Move while on ice
  sim.step({ 1: { dir: CONST.DIR_DOWN, fire: false } });
  assert.strictEqual(p.slideFrames, CONST.ICE_SLIDE_FRAMES);

  const startY = p.y16;
  // Release input (DIR_NONE): tank should slide down
  for (let t = 0; t < CONST.ICE_SLIDE_FRAMES; t++) {
    sim.step({ 1: { dir: CONST.DIR_NONE, fire: false } });
  }

  assert.ok(p.y16 > startY, 'Tank must have slid forward on ice after input released');
  assert.strictEqual(p.slideFrames, 0, 'Slide frames must exhaust after ~20 ticks');
});
