// test/sim.test.js
// Acceptance test for Step 4: Deterministic headless simulation core

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Step 4: Deterministic simulation runs 600 ticks identically twice', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );

  const seed = 12345;

  // Run 1
  const sim1 = new BattleCitySim(seed);
  sim1.initStage(stageData, 1);

  // Scripted inputs for 600 ticks
  const scriptedInputs = [];
  for (let t = 0; t < 600; t++) {
    const dir = t % 120 < 30 ? CONST.DIR_UP :
                t % 120 < 60 ? CONST.DIR_RIGHT :
                t % 120 < 90 ? CONST.DIR_DOWN : CONST.DIR_LEFT;
    const fire = t % 40 === 0;
    scriptedInputs.push({ 1: { dir, fire } });
  }

  for (let t = 0; t < 600; t++) {
    sim1.step(scriptedInputs[t]);
  }
  const hash1 = sim1.hashState();

  // Run 2
  const sim2 = new BattleCitySim(seed);
  sim2.initStage(stageData, 1);

  for (let t = 0; t < 600; t++) {
    sim2.step(scriptedInputs[t]);
  }
  const hash2 = sim2.hashState();

  assert.strictEqual(sim1.tick, 600);
  assert.strictEqual(sim2.tick, 600);
  assert.strictEqual(hash1, hash2, `State hashes must be identical: ${hash1} !== ${hash2}`);
});

test('Step 4: Sim snapshot structure contains all entities and state data', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );
  const sim = new BattleCitySim(42);
  sim.initStage(stageData, 1);

  const snap = sim.snapshot();
  assert.strictEqual(snap.tick, 0);
  assert.ok(Array.isArray(snap.tanks));
  assert.ok(Array.isArray(snap.bullets));
  assert.ok(snap.eagle !== undefined);
  assert.ok(snap.hud !== undefined);
  assert.strictEqual(snap.hud.enemiesLeft, 20);
});
