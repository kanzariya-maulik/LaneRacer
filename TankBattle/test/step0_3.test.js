// test/step0_3.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as CONST from '../shared/constants.js';
import { GameMap } from '../shared/map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Step 0 & 1: Golden constants match spec exactly', () => {
  // File 02 §1 & §2, File 13 §A
  assert.strictEqual(CONST.CANVAS_W, 256);
  assert.strictEqual(CONST.CANVAS_H, 240);
  assert.strictEqual(CONST.PLAYFIELD_X, 16);
  assert.strictEqual(CONST.PLAYFIELD_Y, 8);
  assert.strictEqual(CONST.PLAYFIELD_W, 208);
  assert.strictEqual(CONST.PLAYFIELD_H, 208);
  assert.strictEqual(CONST.TILE_SIZE, 16);
  assert.strictEqual(CONST.CELL_SIZE, 8);
  assert.strictEqual(CONST.TANK_SIZE, 16);

  // Speeds
  assert.strictEqual(CONST.SPEED_PLAYER, 0.75);
  assert.strictEqual(CONST.SPEED_BASIC, 0.5);
  assert.strictEqual(CONST.SPEED_FAST, 1.0);
  assert.strictEqual(CONST.SPEED_POWER, 0.5);
  assert.strictEqual(CONST.SPEED_ARMOR, 0.5);

  // Bullets
  assert.strictEqual(CONST.BULLET_SPEED_SLOW, 3);
  assert.strictEqual(CONST.BULLET_SPEED_FAST, 6);

  // Spawns
  assert.deepStrictEqual(CONST.EAGLE_POS, { tx: 6, ty: 12, x: 96, y: 192 });
  assert.deepStrictEqual(CONST.P1_SPAWN_POS, { tx: 4, ty: 12, x: 64, y: 192 });
  assert.deepStrictEqual(CONST.P2_SPAWN_POS, { tx: 8, ty: 12, x: 128, y: 192 });

  // Enemies & waves
  assert.strictEqual(CONST.ENEMIES_PER_STAGE, 20);
  assert.deepStrictEqual(CONST.CARRIER_INDICES, [3, 10, 17]);
  assert.strictEqual(CONST.INITIAL_RESERVES, 3);
  assert.strictEqual(CONST.ARMOR_HP, 4);

  // Palette completeness
  assert.ok(CONST.PALETTE.GRAY_BG);
  assert.ok(CONST.PALETTE.BLACK);
  assert.ok(CONST.PALETTE.WHITE);
  assert.ok(CONST.PALETTE.BRICK_MAIN);
  assert.ok(CONST.PALETTE.STEEL_MAIN);
  assert.ok(CONST.PALETTE.P1_YELLOW);
  assert.ok(CONST.PALETTE.P2_GREEN);
  assert.ok(CONST.PALETTE.ENEMY_GRAY);
  assert.ok(CONST.PALETTE.ENEMY_RED);
});

test('Step 3: Map data model & Stage 1 layout verification', () => {
  const stagePath = path.join(__dirname, '../shared/stages/stage01.json');
  assert.ok(fs.existsSync(stagePath), 'stage01.json exists');

  const stageData = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  assert.strictEqual(stageData.stage, 1);
  assert.strictEqual(stageData.map13.length, 13);
  stageData.map13.forEach((row, i) => {
    assert.strictEqual(row.length, 13, `row ${i} must have 13 tiles`);
  });

  const map = new GameMap();
  map.loadStage(stageData);

  // Eagle must be alive at (96, 192)
  assert.strictEqual(map.eagle.alive, true);
  assert.strictEqual(map.eagle.x, 96);
  assert.strictEqual(map.eagle.y, 192);

  // Fortress around eagle: tiles (5,11), (6,11), (7,11), (5,12), (7,12) must be solid brick
  // Tile 6, 11 (cells cx=12..13, cy=22..23)
  const fortressCellIdx = 22 * CONST.GRID_CELLS_X + 12;
  assert.strictEqual(map.cellType[fortressCellIdx], CONST.TILE_BRICK);
  assert.strictEqual(map.brickBits[fortressCellIdx], CONST.BRICK_FULL);

  // P1 spawn tile (tx=4, ty=12 -> x=64, y=192) must be traversable
  assert.strictEqual(map.canOccupy(64, 192), true, 'P1 spawn area must be empty/occupiable');

  // Eagle cannot be occupied by a tank
  assert.strictEqual(map.canOccupy(96, 192), false, 'Eagle cannot be occupied');

  // Boundaries: outside playfield cannot be occupied
  assert.strictEqual(map.canOccupy(-1, 0), false);
  assert.strictEqual(map.canOccupy(0, -1), false);
  assert.strictEqual(map.canOccupy(CONST.PLAYFIELD_W, 0), false);
  assert.strictEqual(map.canOccupy(0, CONST.PLAYFIELD_H), false);
});

test('Step 3: Quarter-level brick erosion and quarter collision', () => {
  const map = new GameMap();
  // Clear map and place a single brick cell at (cx=2, cy=2) -> x=16, y=16
  const idx = 2 * CONST.GRID_CELLS_X + 2;
  map.cellType[idx] = CONST.TILE_BRICK;
  map.brickBits[idx] = CONST.BRICK_FULL; // 0b1111

  // Tank overlapping (16, 16) is blocked
  assert.strictEqual(map.canOccupy(16, 16), false);

  // A weak bullet travelling UP hits bottom quarters (0b1100: BL, BR)
  const hit1 = map.hitBrickCell(2, 2, CONST.DIR_UP, false);
  assert.strictEqual(hit1, true);
  // Bottom quarters removed, leaving top quarters (0b0011: TL, TR)
  assert.strictEqual(map.brickBits[idx], 0b0011);
  assert.strictEqual(map.cellType[idx], CONST.TILE_BRICK);

  // A second weak bullet travelling UP removes the remaining top quarters
  const hit2 = map.hitBrickCell(2, 2, CONST.DIR_UP, false);
  assert.strictEqual(hit2, true);
  assert.strictEqual(map.brickBits[idx], 0);
  assert.strictEqual(map.cellType[idx], CONST.TILE_EMPTY);

  // Now cell is empty, tank can occupy (16, 16)
  assert.strictEqual(map.canOccupy(16, 16), true);
});

test('Step 3: Shovel powerup swaps fortress to steel and back to full fresh brick', () => {
  const map = new GameMap();
  const stagePath = path.join(__dirname, '../shared/stages/stage01.json');
  map.loadStage(JSON.parse(fs.readFileSync(stagePath, 'utf8')));

  // Damage fortress brick cell at (12, 22)
  map.hitBrickCell(12, 22, CONST.DIR_UP, false);
  const idx = 22 * CONST.GRID_CELLS_X + 12;
  assert.strictEqual(map.brickBits[idx], 0b0011);

  // Shovel activates -> steel
  map.setFortressMaterial(true);
  assert.strictEqual(map.cellType[idx], CONST.TILE_STEEL);
  assert.strictEqual(map.brickBits[idx], 0);

  // Shovel expires -> reverts to FRESH FULL bricks
  map.setFortressMaterial(false);
  assert.strictEqual(map.cellType[idx], CONST.TILE_BRICK);
  assert.strictEqual(map.brickBits[idx], CONST.BRICK_FULL);
});
