// test/gameover.test.js
// Acceptance test for Step 7: Eagle destruction and Game Over conditions

import test from 'node:test';
import assert from 'node:assert';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

test('Step 7(a): Shooting own base destroys Eagle and triggers GAME_OVER_ANIM', () => {
  const sim = new BattleCitySim(1);
  // Spawn player right above the base facing down
  // Eagle is at (96, 192), 16x16
  const p = sim.spawnPlayer(1, 'P1', { x: 96, y: 160 });
  p.spawnFrames = 0;
  p.dir = CONST.DIR_DOWN;

  assert.strictEqual(sim.map.eagle.alive, true);
  assert.strictEqual(sim.state, 'PLAYING');

  // Player shoots DOWN towards the Eagle
  sim.step({ 1: { dir: CONST.DIR_DOWN, fire: true } });

  // Advance ticks until bullet hits the Eagle
  for (let t = 0; t < 20; t++) {
    sim.step({});
    if (!sim.map.eagle.alive) break;
  }

  assert.strictEqual(sim.map.eagle.alive, false, 'Eagle must be destroyed by player bullet');
  assert.strictEqual(sim.state, 'GAME_OVER_ANIM', 'State must transition to GAME_OVER_ANIM');
  assert.ok(sim.events.some(ev => ev.e === 'eagle_destroyed'), 'eagle_destroyed event emitted');
});

test('Step 7(b): Enemy bullet destroying Eagle triggers GAME_OVER_ANIM', () => {
  const sim = new BattleCitySim(1);
  // Spawn enemy above eagle facing down
  const e = {
    id: 99,
    team: 'enemy',
    kind: 'basic',
    x16: 96 << CONST.FP_SHIFT,
    y16: 160 << CONST.FP_SHIFT,
    dir: CONST.DIR_DOWN,
    bulletsInFlight: 0,
    spawnFrames: 0,
    hp: 1
  };
  sim.tanks.push(e);

  sim.tryFireBullet(e);

  for (let t = 0; t < 20; t++) {
    sim.step({});
    if (!sim.map.eagle.alive) break;
  }

  assert.strictEqual(sim.map.eagle.alive, false, 'Eagle destroyed by enemy');
  assert.strictEqual(sim.state, 'GAME_OVER_ANIM');
});

test('Step 7(c): All players out of lives and dead triggers GAME_OVER_ANIM', () => {
  const sim = new BattleCitySim(1);
  const p = sim.spawnPlayer(1, 'P1', { x: 32, y: 32 });
  p.spawnFrames = 0;
  p.shield = 0;
  p.lives = 0; // No reserve lives left

  // Spawn enemy bullet to hit player
  const eBullet = {
    id: 88,
    ownerId: 99,
    team: 'enemy',
    dir: CONST.DIR_DOWN,
    speed: 3,
    fpSpeed: CONST.FP_BULLET_SPEED_SLOW,
    strong: false,
    x16: 36 << CONST.FP_SHIFT,
    y16: 28 << CONST.FP_SHIFT,
    alive: true
  };
  sim.bullets.push(eBullet);

  // Advance ticks until bullet hits player
  for (let t = 0; t < 10; t++) {
    sim.step({});
  }

  // Player is eliminated and has no reserve lives
  assert.strictEqual(sim.tanks.filter(t => t.team === 'player').length, 0);
  assert.strictEqual(sim.state, 'GAME_OVER_ANIM', 'All players dead with 0 lives triggers GAME_OVER_ANIM');
});
