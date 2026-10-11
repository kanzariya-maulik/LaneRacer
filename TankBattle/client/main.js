// client/main.js
// Battle City complete state machine & game flow orchestration

import { Renderer } from './render.js';
import { SpriteAtlas } from './sprites.js';
import { UIScreens } from './ui_screens.js';
import { BattleCitySim } from '/shared/sim.js';
import {
  DIR_UP,
  DIR_RIGHT,
  DIR_DOWN,
  DIR_LEFT,
  DIR_NONE
} from '/shared/constants.js';

let renderer;
let atlas;
let uiScreens;
let sim;

// Preloaded stage templates
const stages = {};

// Hi-Score persistence
let hiScore = 20000;
try {
  const saved = localStorage.getItem('battle_city_hiscore');
  if (saved) hiScore = Math.max(hiScore, parseInt(saved, 10));
} catch (e) {}

// Game flow states (File 08 §1):
// 'TITLE', 'STAGE_INTRO', 'PLAYING', 'PAUSED', 'STAGE_CLEAR_WAIT', 'TALLY', 'GAME_OVER_ANIM', 'GAME_OVER_SCREEN'
let clientState = 'TITLE';
let stateTimer = 0;

// Title screen variables
let titleSelection = 0; // 0=1P, 1=2P, 2=CONSTRUCTION
let titleLogoY = 180;   // scrolls up to 56

// Stage Intro variables
let currentStageNum = 1;
let curtainProgress = 0; // 0 = closed, 1 = fully open

// Game Over rising text
let gameOverY = 216; // rises from 216 up to 104

// Tally screen animation
let tallyState = {
  stageNum: 1,
  hiScore: 20000,
  p1Score: 0,
  kills: { basic: 0, fast: 0, power: 0, armor: 0 },
  counts: { basic: 0, fast: 0, power: 0, armor: 0 },
  currentTypeIndex: 0,
  tickCounter: 0,
  showTotal: false,
  holdTimer: 0
};

// Input tracking
const keysHeld = new Set();
let lastDir = DIR_NONE;
let fireRequested = false;

async function init() {
  const canvas = document.getElementById('game-canvas');
  atlas = new SpriteAtlas();
  atlas.init();

  renderer = new Renderer(canvas, atlas);
  uiScreens = new UIScreens(atlas);

  sim = new BattleCitySim(Date.now() & 0xffff);

  // Preload stage definitions
  try {
    const res1 = await fetch('/shared/stages/stage01.json');
    stages[1] = await res1.json();
    const res2 = await fetch('/shared/stages/stage02.json');
    stages[2] = await res2.json();
  } catch (err) {
    console.error('Failed to preload stages:', err);
  }

  setupInput(canvas);
  requestAnimationFrame(loop);
}

function setupInput(canvas) {
  // Mouse / Touch click to select options & start
  const handlePointerStart = (clientX, clientY) => {
    if (clientState === 'TITLE') {
      const rect = canvas.getBoundingClientRect();
      const localY = (clientY - rect.top) / renderer.scale;
      // Menu items are around y: 144 (1P), 160 (2P), 176 (CONSTRUCTION)
      if (localY >= 155 && localY < 172) {
        titleSelection = 1; // 2 PLAYERS
      } else if (localY >= 172) {
        titleSelection = 2; // CONSTRUCTION
      } else {
        titleSelection = 0; // 1 PLAYER
      }
      startStage(1);
    } else if (clientState === 'TALLY') {
      if (!tallyState.showTotal) {
        tallyState.counts = { ...tallyState.kills };
        tallyState.showTotal = true;
      } else {
        startStage(currentStageNum + 1);
      }
    } else if (clientState === 'GAME_OVER_SCREEN') {
      clientState = 'TITLE';
      titleLogoY = 56;
    }
  };

  canvas.addEventListener('click', (e) => {
    handlePointerStart(e.clientX, e.clientY);
  });

  window.addEventListener('keydown', (e) => {
    // Prevent default browser scrolling
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) {
      e.preventDefault();
    }

    keysHeld.add(e.code);

    // Title screen controls
    if (clientState === 'TITLE') {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        titleSelection = (titleSelection + 2) % 3;
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        titleSelection = (titleSelection + 1) % 3;
      } else if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1') {
        titleSelection = 0; // 1 PLAYER
        startStage(1);
      } else if (e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2') {
        titleSelection = 1; // 2 PLAYERS
        startStage(1);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'KeyJ' || e.code === 'KeyZ') {
        startStage(1);
      }
      return;
    }

    // Pause toggle
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (clientState === 'PLAYING') {
        clientState = 'PAUSED';
      } else if (clientState === 'PAUSED') {
        clientState = 'PLAYING';
      }
      return;
    }

    // Skip / Advance Tally screen
    if (clientState === 'TALLY') {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
        if (!tallyState.showTotal) {
          tallyState.counts = { ...tallyState.kills };
          tallyState.showTotal = true;
        } else {
          startStage(currentStageNum + 1);
        }
      }
      return;
    }

    // Gameplay direction inputs
    if (e.code === 'KeyW' || e.code === 'ArrowUp') lastDir = DIR_UP;
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') lastDir = DIR_RIGHT;
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') lastDir = DIR_DOWN;
    else if (e.code === 'KeyA' || e.code === 'ArrowLeft') lastDir = DIR_LEFT;

    // Fire buttons: Enter, Space, J, Z
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'KeyJ' || e.code === 'KeyZ') {
      fireRequested = true;
    }

    // Debug: Toggle star level (T key)
    if (e.code === 'KeyT') {
      const p = sim.tanks.find(t => t.team === 'player' && t.id === 1);
      if (p) p.stars = (p.stars + 1) % 4;
    }
  });

  window.addEventListener('keyup', (e) => {
    keysHeld.delete(e.code);

    if (isDirCode(e.code, lastDir)) {
      lastDir = DIR_NONE;
      if (keysHeld.has('KeyW') || keysHeld.has('ArrowUp')) lastDir = DIR_UP;
      else if (keysHeld.has('KeyD') || keysHeld.has('ArrowRight')) lastDir = DIR_RIGHT;
      else if (keysHeld.has('KeyS') || keysHeld.has('ArrowDown')) lastDir = DIR_DOWN;
      else if (keysHeld.has('KeyA') || keysHeld.has('ArrowLeft')) lastDir = DIR_LEFT;
    }

    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'KeyJ' || e.code === 'KeyZ') {
      fireRequested = false;
    }
  });
}

function isDirCode(code, dir) {
  if (dir === DIR_UP && (code === 'KeyW' || code === 'ArrowUp')) return true;
  if (dir === DIR_RIGHT && (code === 'KeyD' || code === 'ArrowRight')) return true;
  if (dir === DIR_DOWN && (code === 'KeyS' || code === 'ArrowDown')) return true;
  if (dir === DIR_LEFT && (code === 'KeyA' || code === 'ArrowLeft')) return true;
  return false;
}

function startStage(stageNum) {
  currentStageNum = stageNum;
  clientState = 'STAGE_INTRO';
  stateTimer = 0;
  curtainProgress = 0;

  const stageData = stages[stageNum] || stages[1];
  const numPlayers = titleSelection === 1 ? 2 : 1;
  sim.initStage(stageData, numPlayers);
}

let lastTime = performance.now();
const MS_PER_TICK = 1000 / 60;
let accumulator = 0;
let frameTick = 0;

function loop(now) {
  const dt = Math.min(100, now - lastTime);
  lastTime = now;
  accumulator += dt;

  while (accumulator >= MS_PER_TICK) {
    accumulator -= MS_PER_TICK;
    frameTick++;
    updateState();
  }

  render();
  requestAnimationFrame(loop);
}

function updateState() {
  stateTimer++;

  if (clientState === 'TITLE') {
    if (titleLogoY > 56) titleLogoY -= 1.5;
  } else if (clientState === 'STAGE_INTRO') {
    // Stage intro displays "STAGE N" on gray for ~45 frames, then curtain opens
    if (stateTimer > 45) {
      curtainProgress += 0.04; // opens smoothly over ~25 frames
      if (curtainProgress >= 1.0) {
        curtainProgress = 1.0;
        clientState = 'PLAYING';
      }
    }
  } else if (clientState === 'PLAYING') {
    const p1Inputs = { dir: lastDir, fire: fireRequested };
    sim.step({ 1: p1Inputs });

    // Check sim state transitions
    if (sim.state === 'GAME_OVER_ANIM') {
      clientState = 'GAME_OVER_ANIM';
      stateTimer = 0;
      gameOverY = 216;
    } else if (sim.state === 'STAGE_CLEAR_WAIT') {
      clientState = 'STAGE_CLEAR_WAIT';
      stateTimer = 0;
    }
  } else if (clientState === 'STAGE_CLEAR_WAIT') {
    sim.step({});
    if (sim.state === 'TALLY') {
      initTallyScreen();
    }
  } else if (clientState === 'TALLY') {
    updateTallyScreen();
  } else if (clientState === 'GAME_OVER_ANIM') {
    // Red text rises from 216 to 104
    if (gameOverY > 104) gameOverY -= 0.5;
    if (stateTimer >= 220) {
      clientState = 'GAME_OVER_SCREEN';
      stateTimer = 0;
      saveHiScore();
    }
  } else if (clientState === 'GAME_OVER_SCREEN') {
    if (stateTimer >= 180) {
      clientState = 'TITLE';
      titleLogoY = 56;
    }
  }
}

function initTallyScreen() {
  clientState = 'TALLY';
  stateTimer = 0;
  const p1 = sim.tanks.find(t => t.id === 1) || { score: 0, kills: {} };

  tallyState = {
    stageNum: currentStageNum,
    hiScore,
    p1Score: p1.score || 0,
    kills: {
      basic: p1.kills?.basic || 0,
      fast: p1.kills?.fast || 0,
      power: p1.kills?.power || 0,
      armor: p1.kills?.armor || 0
    },
    counts: { basic: 0, fast: 0, power: 0, armor: 0 },
    currentTypeIndex: 0,
    tickCounter: 0,
    showTotal: false,
    holdTimer: 0
  };
}

function updateTallyScreen() {
  const types = ['basic', 'fast', 'power', 'armor'];

  if (tallyState.currentTypeIndex < types.length) {
    const key = types[tallyState.currentTypeIndex];
    const target = tallyState.kills[key];

    tallyState.tickCounter++;
    if (tallyState.tickCounter >= 4) {
      tallyState.tickCounter = 0;
      if (tallyState.counts[key] < target) {
        tallyState.counts[key]++;
      } else {
        tallyState.currentTypeIndex++;
      }
    }
  } else if (!tallyState.showTotal) {
    tallyState.showTotal = true;
    tallyState.holdTimer = 0;
  } else {
    tallyState.holdTimer++;
    if (tallyState.holdTimer >= 150) { // ~2.5s hold
      startStage(currentStageNum + 1);
    }
  }
}

function saveHiScore() {
  const p1 = sim.tanks.find(t => t.id === 1);
  if (p1 && p1.score > hiScore) {
    hiScore = p1.score;
    try {
      localStorage.setItem('battle_city_hiscore', String(hiScore));
    } catch (e) {}
  }
}

function render() {
  if (clientState === 'TITLE') {
    const treadFrame = Math.floor(frameTick / 4) % 2;
    uiScreens.drawTitleScreen(renderer.ctx, {
      logoY: titleLogoY,
      selection: titleSelection,
      treadFrame,
      hiScore,
      p1Score: 0
    });
  } else if (clientState === 'STAGE_INTRO') {
    const snap = sim.snapshot();
    renderer.drawStageIntro(currentStageNum, curtainProgress, sim.map, {
      tanks: snap.tanks,
      bullets: snap.bullets,
      explosions: snap.explosions,
      item: snap.item,
      hud: {
        enemiesRemaining: snap.hud.enemiesLeft,
        p1Lives: snap.hud.lives[0] !== undefined ? snap.hud.lives[0] : 3,
        p2Lives: snap.hud.lives[1],
        stageNum: currentStageNum
      }
    }, frameTick);
  } else if (clientState === 'PLAYING' || clientState === 'PAUSED' || clientState === 'STAGE_CLEAR_WAIT') {
    const snap = sim.snapshot();
    renderer.renderScene(sim.map, {
      tanks: snap.tanks,
      bullets: snap.bullets,
      explosions: snap.explosions,
      item: snap.item,
      hud: {
        enemiesRemaining: snap.hud.enemiesLeft,
        p1Lives: snap.hud.lives[0] !== undefined ? snap.hud.lives[0] : 3,
        p2Lives: snap.hud.lives[1],
        stageNum: currentStageNum
      }
    }, frameTick);

    if (clientState === 'PAUSED') {
      uiScreens.drawPause(renderer.ctx, frameTick);
    }
  } else if (clientState === 'GAME_OVER_ANIM') {
    const snap = sim.snapshot();
    renderer.renderScene(sim.map, {
      tanks: snap.tanks,
      bullets: snap.bullets,
      explosions: snap.explosions,
      item: snap.item,
      hud: {
        enemiesRemaining: snap.hud.enemiesLeft,
        p1Lives: snap.hud.lives[0] !== undefined ? snap.hud.lives[0] : 0,
        stageNum: currentStageNum
      }
    }, frameTick);

    uiScreens.drawGameOverRise(renderer.ctx, gameOverY);
  } else if (clientState === 'GAME_OVER_SCREEN') {
    uiScreens.drawGameOverScreen(renderer.ctx);
  } else if (clientState === 'TALLY') {
    uiScreens.drawTally(renderer.ctx, tallyState);
  }

  renderer.present();
}

window.addEventListener('DOMContentLoaded', init);
