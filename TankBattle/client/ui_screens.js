// client/ui_screens.js
// Authentic NES screens: Title, Pause, GameOver rising animation, Score Tally, and GameOver screen

import {
  CANVAS_W,
  CANVAS_H,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
  PALETTE,
  SCORE_BASIC,
  SCORE_FAST,
  SCORE_POWER,
  SCORE_ARMOR
} from '/shared/constants.js';
import { drawText } from './font.js';

export class UIScreens {
  constructor(atlas) {
    this.atlas = atlas;
  }

  // 1. Title Screen (File 02 §6.1)
  drawTitleScreen(ctx, state = {}) {
    const {
      logoY = 56,
      selection = 0, // 0 = 1 PLAYER, 1 = 2 PLAYERS, 2 = CONSTRUCTION
      treadFrame = 0,
      hiScore = 20000,
      p1Score = 0
    } = state;

    // Black background
    ctx.fillStyle = PALETTE.BLACK;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Top score labels: "I-  00" and "HI- 20000"
    drawText(ctx, 'I-', 24, 16, PALETTE.TEXT_RED);
    const scoreStr = String(p1Score).padStart(2, '0');
    drawText(ctx, scoreStr, 48, 16, PALETTE.WHITE);

    drawText(ctx, 'HI-', 112, 16, PALETTE.TEXT_RED);
    drawText(ctx, String(hiScore), 144, 16, PALETTE.TEXT_ORANGE);

    // Brick-patterned "BATTLE CITY" Logo
    this.drawBrickLogo(ctx, 40, logoY);

    // Menu options
    const menuItems = ['1 PLAYER', '2 PLAYERS', 'CONSTRUCTION'];
    const startY = 144;
    for (let i = 0; i < menuItems.length; i++) {
      const itemY = startY + i * 16;
      drawText(ctx, menuItems[i], 88, itemY, PALETTE.WHITE);

      // Yellow tank cursor facing right with animated treads
      if (i === selection) {
        const cursorSprite = this.atlas.getTank('P1_s0', treadFrame, 1); // 1 = RIGHT
        ctx.drawImage(cursorSprite, 64, itemY - 4);
      }
    }

    // Bottom copyright / credits
    drawText(ctx, 'BATTLE TANKS LAN', 64, 208, PALETTE.WHITE);
    drawText(ctx, 'FAN RECREATION', 72, 220, PALETTE.WHITE);
  }

  // Draw procedural brick-textured "BATTLE CITY" letters
  drawBrickLogo(ctx, startX, startY) {
    // Draw stylized title letters using brick palette
    ctx.fillStyle = PALETTE.BRICK_MAIN;
    // BATTLE
    drawText(ctx, 'BATTLE', startX + 16, startY, PALETTE.BRICK_LIGHT);
    drawText(ctx, 'CITY', startX + 80, startY, PALETTE.WHITE);
    // Draw brick underline / frame
    for (let x = startX; x < startX + 176; x += 8) {
      ctx.drawImage(this.atlas.terrain.brickFull, x, startY + 12);
    }
  }

  // 2. Pause Overlay (File 02 §6.4)
  drawPause(ctx, blinkPhase) {
    // Visible 32 frames, hidden 32 frames
    if (blinkPhase % 64 < 32) {
      // Centered over playfield: x ≈ 96, y ≈ 108
      drawText(ctx, 'PAUSE', 96, 108, PALETTE.TEXT_RED);
    }
  }

  // 3. Game Over Text Rise (File 02 §6.5)
  // Text rises from below playfield bottom (y=216) upward to center (y=104)
  drawGameOverRise(ctx, riseY) {
    drawText(ctx, 'GAME OVER', 88, Math.floor(riseY), PALETTE.TEXT_RED);
  }

  // 4. Black Screen with Big Game Over (File 02 §6.5)
  drawGameOverScreen(ctx) {
    ctx.fillStyle = PALETTE.BLACK;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawText(ctx, 'GAME OVER', 88, 112, PALETTE.TEXT_RED);
  }

  // 5. Score Tally Screen (File 02 §6.6)
  drawTally(ctx, state = {}) {
    const {
      stageNum = 1,
      hiScore = 20000,
      p1Score = 0,
      kills = { basic: 0, fast: 0, power: 0, armor: 0 },
      counts = { basic: 0, fast: 0, power: 0, armor: 0 },
      showTotal = false
    } = state;

    ctx.fillStyle = PALETTE.BLACK;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawText(ctx, 'HI-SCORE', 72, 24, PALETTE.TEXT_RED);
    drawText(ctx, String(hiScore), 144, 24, PALETTE.TEXT_ORANGE);

    drawText(ctx, `STAGE ${stageNum}`, 96, 44, PALETTE.WHITE);

    drawText(ctx, 'I-PLAYER', 48, 64, PALETTE.TEXT_RED);
    drawText(ctx, String(p1Score), 56, 76, PALETTE.TEXT_ORANGE);

    // 4 Rows for each enemy type
    const rows = [
      { key: 'basic', pts: SCORE_BASIC, iconId: 'basic', y: 96 },
      { key: 'fast', pts: SCORE_FAST, iconId: 'fast', y: 116 },
      { key: 'power', pts: SCORE_POWER, iconId: 'power', y: 136 },
      { key: 'armor', pts: SCORE_ARMOR, iconId: 'armor_hp1', y: 156 }
    ];

    let totalKills = 0;
    for (const r of rows) {
      const c = counts[r.key] || 0;
      const ptsTotal = c * r.pts;
      totalKills += kills[r.key] || 0;

      // PTS value
      const ptsStr = String(ptsTotal).padStart(5, ' ');
      drawText(ctx, ptsStr, 40, r.y, PALETTE.WHITE);
      drawText(ctx, 'PTS', 88, r.y, PALETTE.WHITE);

      // Kill count
      const countStr = String(c).padStart(2, ' ');
      drawText(ctx, countStr, 120, r.y, PALETTE.WHITE);

      // Arrow indicator ◄ and enemy mini sprite
      drawText(ctx, '◄', 140, r.y, PALETTE.WHITE);
      const icon = this.atlas.getTank(r.iconId, 0, 0); // facing UP
      ctx.drawImage(icon, 152, r.y - 4);
    }

    // Separator line
    ctx.fillStyle = PALETTE.WHITE;
    ctx.fillRect(88, 174, 96, 2);

    // Total kills row
    if (showTotal) {
      drawText(ctx, 'TOTAL', 72, 184, PALETTE.WHITE);
      const totalDisplay = counts.basic + counts.fast + counts.power + counts.armor;
      drawText(ctx, String(totalDisplay).padStart(2, ' '), 120, 184, PALETTE.WHITE);
    }
  }
}
