// test/enemies.test.js
// Acceptance test for Step 8: Enemy waves, types, carrier flags, and AI

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Step 8(a): Stage 1 spawns exactly 20 enemies (18 B, 2 F), max 4 simultaneously alive', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );

  const sim = new BattleCitySim(100);
  sim.initStage(stageData, 1);

  assert.strictEqual(sim.enemyQueue.length, 20);
  const basicCount = sim.enemyQueue.filter(k => k === 'basic').length;
  const fastCount = sim.enemyQueue.filter(k => k === 'fast').length;
  assert.strictEqual(basicCount, 18);
  assert.strictEqual(fastCount, 2);

  let spawnedSoFar = 0;
  const spawnedKinds = [];

  // Simulate enough ticks to spawn enemies while killing them off to test wave pacing
  for (let t = 0; t < 5000; t++) {
    sim.step({});

    const aliveEnemies = sim.tanks.filter(t => t.team === 'enemy');
    assert.ok(aliveEnemies.length <= CONST.MAX_ALIVE_1P, `Max alive must not exceed 4 (was ${aliveEnemies.length})`);

    // Periodically eliminate an enemy to allow next spawn
    if (aliveEnemies.length >= 4 && t % 100 === 0) {
      const e = aliveEnemies[0];
      sim.tanks = sim.tanks.filter(t => t.id !== e.id);
    }

    if (sim.totalEnemiesSpawned > spawnedSoFar) {
      spawnedSoFar = sim.totalEnemiesSpawned;
      const last = sim.tanks.find(t => t.team === 'enemy' && t.spawnIndex === spawnedSoFar - 1);
      if (last) spawnedKinds.push(last.kind);
    }

    if (sim.totalEnemiesSpawned === 20 && sim.enemyQueue.length === 0) break;
  }

  assert.strictEqual(sim.totalEnemiesSpawned, 20, 'Must spawn exactly 20 enemies');
});

test('Step 8(b): Gate rotation: spawns rotate left -> center -> right', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );

  const sim = new BattleCitySim(100);
  sim.initStage(stageData, 1);

  const gateSpawns = [];
  for (let t = 0; t < 800; t++) {
    sim.step({});
    const spawnedEvent = sim.events.find(ev => ev.e === 'spawn_enemy');
    if (spawnedEvent) {
      const enemy = sim.tanks.find(t => t.id === spawnedEvent.id);
      gateSpawns.push(enemy.x16 >> CONST.FP_SHIFT);
    }
    if (gateSpawns.length >= 3) break;
  }

  assert.strictEqual(gateSpawns.length, 3);
  assert.strictEqual(gateSpawns[0], 0, 'First gate is left (x=0)');
  assert.strictEqual(gateSpawns[1], 96, 'Second gate is center (x=96)');
  assert.strictEqual(gateSpawns[2], 192, 'Third gate is right (x=192)');
});

test('Step 8(c): Carriers flag at indices 3, 10, 17', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );

  const sim = new BattleCitySim(100);
  sim.initStage(stageData, 1);

  const carriers = [];
  for (let t = 0; t < 5000; t++) {
    sim.step({});
    const spawnedEvent = sim.events.find(ev => ev.e === 'spawn_enemy');
    if (spawnedEvent) {
      const enemy = sim.tanks.find(t => t.id === spawnedEvent.id);
      if (enemy.carrier) {
        carriers.push(enemy.spawnIndex);
      }
      // Clear enemies so wave continues
      sim.tanks = sim.tanks.filter(t => t.id !== enemy.id);
    }
    if (sim.totalEnemiesSpawned === 20) break;
  }

  assert.deepStrictEqual(carriers, [3, 10, 17], 'Carriers must be spawn indices 3, 10, 17');
});

test('Step 8(d): Armor tank takes 4 hits to destroy', () => {
  const sim = new BattleCitySim(1);
  const armorEnemy = {
    id: 10,
    team: 'enemy',
    kind: 'armor',
    x16: 64 << CONST.FP_SHIFT,
    y16: 64 << CONST.FP_SHIFT,
    dir: CONST.DIR_DOWN,
    hp: 4,
    spawnFrames: 0,
    frozen: 999,
    bulletsInFlight: 0,
    carrier: false
  };
  sim.tanks.push(armorEnemy);

  const p = sim.spawnPlayer(1, 'P1', { x: 64, y: 120 });
  p.spawnFrames = 0;
  p.dir = CONST.DIR_UP;

  // Hit 1
  sim.tryFireBullet(p);
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(armorEnemy.hp, 3, 'Hit 1 reduces armor HP to 3');
  assert.strictEqual(sim.tanks.includes(armorEnemy), true);

  // Hit 2
  sim.tryFireBullet(p);
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(armorEnemy.hp, 2, 'Hit 2 reduces armor HP to 2');
  assert.strictEqual(sim.tanks.includes(armorEnemy), true);

  // Hit 3
  sim.tryFireBullet(p);
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(armorEnemy.hp, 1, 'Hit 3 reduces armor HP to 1');
  assert.strictEqual(sim.tanks.includes(armorEnemy), true);

  // Hit 4
  sim.tryFireBullet(p);
  while (sim.bullets.length > 0) sim.step({});
  assert.strictEqual(armorEnemy.hp, 0, 'Hit 4 destroys armor tank');
  assert.strictEqual(sim.tanks.includes(armorEnemy), false);
});
