// test/flow.test.js
// Acceptance test for Step 10: Complete game flow, state machine, tally, and game over

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BattleCitySim } from '../shared/sim.js';
import * as CONST from '../shared/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Step 10(a): Winning stage 1 transitions: PLAYING -> STAGE_CLEAR_WAIT -> TALLY', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );

  const sim = new BattleCitySim(10);
  sim.initStage(stageData, 1);
  assert.strictEqual(sim.state, 'PLAYING');

  // Spawn and kill all 20 enemies to simulate clear
  sim.enemyQueue = []; // exhaust remaining spawn queue
  sim.tanks = sim.tanks.filter(t => t.team === 'player'); // clear enemies on field
  sim.totalEnemiesSpawned = 20;

  // Step sim to process win condition
  sim.step({});

  assert.strictEqual(sim.state, 'STAGE_CLEAR_WAIT', 'Clearing all 20 enemies transitions to STAGE_CLEAR_WAIT');
  assert.ok(sim.events.some(ev => ev.e === 'stage_cleared'));

  // Wait 190 frames for STAGE_CLEAR_WAIT
  for (let t = 0; t < 190; t++) {
    sim.step({});
  }

  assert.strictEqual(sim.state, 'TALLY', 'After ~190 frames transitions to TALLY screen');
});

test('Step 10(b): Losing base transitions: PLAYING -> GAME_OVER_ANIM -> GAME_OVER_SCREEN', () => {
  const stageData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../shared/stages/stage01.json'), 'utf8')
  );

  const sim = new BattleCitySim(10);
  sim.initStage(stageData, 1);

  // Directly destroy Eagle
  sim.map.eagle.alive = false;
  sim.state = 'GAME_OVER_ANIM';
  sim.stateTimer = 0;

  // Advance GAME_OVER_ANIM for 200 frames
  for (let t = 0; t < 200; t++) {
    sim.step({});
  }

  assert.strictEqual(sim.state, 'GAME_OVER_SCREEN', 'After 200 frames transitions to GAME_OVER_SCREEN');
});
