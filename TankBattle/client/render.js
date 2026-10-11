// client/render.js
import {
  CANVAS_W,
  CANVAS_H,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
  GRID_TILES_X,
  GRID_TILES_Y,
  GRID_CELLS_X,
  GRID_CELLS_Y,
  TILE_SIZE,
  CELL_SIZE,
  TILE_EMPTY,
  TILE_BRICK,
  TILE_STEEL,
  TILE_WATER,
  TILE_TREES,
  TILE_ICE,
  PALETTE,
  WATER_ANIM_TICKS
} from '/shared/constants.js';
import { drawText, drawChar } from './font.js';

export class Renderer {
  constructor(canvas, atlas) {
    this.canvas = canvas;
    this.atlas = atlas;
    this.screenCtx = canvas.getContext('2d');
    this.screenCtx.imageSmoothingEnabled = false;

    // Off-screen 256x240 buffer
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = CANVAS_W;
    this.offscreen.height = CANVAS_H;
    this.ctx = this.offscreen.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.scale = 1;
    this.animTick = 0;
    this.updateScale();
    window.addEventListener('resize', () => this.updateScale());
  }

  updateScale() {
    const scaleX = Math.floor(window.innerWidth / CANVAS_W);
    const scaleY = Math.floor(window.innerHeight / CANVAS_H);
    this.scale = Math.max(1, Math.min(scaleX, scaleY));

    this.canvas.width = CANVAS_W * this.scale;
    this.canvas.height = CANVAS_H * this.scale;
    this.screenCtx.imageSmoothingEnabled = false;
  }

  clear(color = PALETTE.GRAY_BG) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Draw the NES layout frame (gray border, black playfield, right HUD area)
  drawLayout() {
    this.ctx.fillStyle = PALETTE.GRAY_BG;
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    this.ctx.fillStyle = PALETTE.BLACK;
    this.ctx.fillRect(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H);
  }

  // Draw Stage Intro / Curtain screen (File 02 §6.2)
  drawStageIntro(stageNum = 1, curtainProgress = 0, map = null, entities = null, tick = 0) {
    if (curtainProgress <= 0) {
      // Solid gray screen with centered "STAGE N" in black text
      this.clear(PALETTE.GRAY_BG);
      const text = `STAGE ${stageNum}`;
      drawText(this.ctx, text, 96, 112, PALETTE.BLACK);
    } else {
      // Curtain opening: render battlefield underneath if available, or base layout
      if (map) {
        this.renderScene(map, entities || {}, tick);
      } else {
        this.drawLayout();
      }

      // Draw top and bottom sliding gray curtain bars shrinking outward
      const curtainH = Math.floor((CANVAS_H / 2) * (1 - Math.min(1, curtainProgress)));
      if (curtainH > 0) {
        this.ctx.fillStyle = PALETTE.GRAY_BG;
        this.ctx.fillRect(0, 0, CANVAS_W, curtainH);
        this.ctx.fillRect(0, CANVAS_H - curtainH, CANVAS_W, curtainH);
      }
    }
  }

  // Draw the HUD right panel (x = 224 to 256)
  drawHUD(hudData = {}) {
    const {
      enemiesRemaining = 20,
      p1Lives = 3,
      p2Lives = null,
      stageNum = 1
    } = hudData;

    // 1. Enemy reserve icons: 2 columns x 10 rows at (232, 16)
    // One icon removed each time an enemy spawns (from bottom-right up)
    for (let i = 0; i < enemiesRemaining; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const iconX = 232 + col * 8;
      const iconY = 16 + row * 8;
      this.ctx.drawImage(this.atlas.hud.enemyIcon, iconX, iconY);
    }

    // 2. Player 1 lives block
    // "IP" label at (232, 136)
    drawText(this.ctx, 'IP', 232, 136, PALETTE.BLACK);
    // Yellow mini tank icon at (232, 144)
    this.ctx.drawImage(this.atlas.hud.p1LifeIcon, 232, 144);
    // Life digit at (240, 144)
    drawText(this.ctx, String(Math.max(0, p1Lives)), 240, 144, PALETTE.BLACK);

    // 3. Player 2 lives block (if present)
    if (p2Lives !== null && p2Lives !== undefined) {
      drawText(this.ctx, 'IIP', 232, 154, PALETTE.BLACK);
      this.ctx.drawImage(this.atlas.hud.p2LifeIcon, 232, 162);
      drawText(this.ctx, String(Math.max(0, p2Lives)), 240, 162, PALETTE.BLACK);
    }

    // 4. Stage flag icon at (232, 176)
    this.ctx.drawImage(this.atlas.hud.flag, 232, 176);
    // Stage number at (240, 192)
    const stageStr = String(stageNum);
    const stageX = stageStr.length > 1 ? 232 : 240;
    drawText(this.ctx, stageStr, stageX, 192, PALETTE.BLACK);
  }

  // Render Map and all entities in exact authentic draw order (File 02 §5)
  renderScene(map, entities = {}, tick = 0) {
    this.animTick = tick;
    this.drawLayout();

    const {
      tanks = [],
      bullets = [],
      explosions = [],
      item = null,
      hud = {}
    } = entities;

    const ox = PLAYFIELD_X;
    const oy = PLAYFIELD_Y;

    // Layer 1: Black background (already drawn)

    // Layer 2: Ice (ground)
    for (let ty = 0; ty < GRID_TILES_Y; ty++) {
      for (let tx = 0; tx < GRID_TILES_X; tx++) {
        if (map.tileType[ty * GRID_TILES_X + tx] === TILE_ICE) {
          this.ctx.drawImage(this.atlas.terrain.ice, ox + tx * TILE_SIZE, oy + ty * TILE_SIZE);
        }
      }
    }

    // Layer 3: Water (animated 2 frames, swap every 32 ticks)
    const waterFrame = Math.floor(tick / WATER_ANIM_TICKS) % 2;
    const waterSprite = waterFrame === 0 ? this.atlas.terrain.water0 : this.atlas.terrain.water1;
    for (let ty = 0; ty < GRID_TILES_Y; ty++) {
      for (let tx = 0; tx < GRID_TILES_X; tx++) {
        if (map.tileType[ty * GRID_TILES_X + tx] === TILE_WATER) {
          this.ctx.drawImage(waterSprite, ox + tx * TILE_SIZE, oy + ty * TILE_SIZE);
        }
      }
    }

    // Layer 4: Brick Quarters, Steel, and Eagle
    // Steel & Brick Quarters (8x8 cells)
    for (let cy = 0; cy < GRID_CELLS_Y; cy++) {
      for (let cx = 0; cx < GRID_CELLS_X; cx++) {
        const idx = cy * GRID_CELLS_X + cx;
        const type = map.cellType[idx];
        const cellPx = ox + cx * CELL_SIZE;
        const cellPy = oy + cy * CELL_SIZE;

        if (type === TILE_STEEL) {
          this.ctx.drawImage(this.atlas.terrain.steel, cellPx, cellPy);
        } else if (type === TILE_BRICK) {
          const bits = map.brickBits[idx];
          if (bits === 0b1111) {
            // Full brick cell fast path
            this.ctx.drawImage(this.atlas.terrain.brickFull, cellPx, cellPy);
          } else if (bits > 0) {
            // Partial quarters
            // Quarters: 0=TL, 1=TR, 2=BL, 3=BR
            if (bits & 0b0001) this.ctx.drawImage(this.atlas.terrain.brickQuarters[0], cellPx, cellPy);
            if (bits & 0b0010) this.ctx.drawImage(this.atlas.terrain.brickQuarters[1], cellPx + 4, cellPy);
            if (bits & 0b0100) this.ctx.drawImage(this.atlas.terrain.brickQuarters[2], cellPx, cellPy + 4);
            if (bits & 0b1000) this.ctx.drawImage(this.atlas.terrain.brickQuarters[3], cellPx + 4, cellPy + 4);
          }
        }
      }
    }

    // Eagle (16x16)
    const eagleSprite = map.eagle.alive ? this.atlas.eagle.alive : this.atlas.eagle.destroyed;
    this.ctx.drawImage(eagleSprite, ox + map.eagle.x, oy + map.eagle.y);

    // Layer 5: Power-up item (blinking: visible 8 / hidden 8)
    if (item && Math.floor(tick / 8) % 2 === 0) {
      const pSprite = this.atlas.powerups[item.type];
      if (pSprite) {
        this.ctx.drawImage(pSprite, ox + item.x, oy + item.y);
      }
    }

    // Layer 6: Tanks
    for (const tank of tanks) {
      if (tank.spawnFrames > 0) {
        // Spawn star animation (scales through 4 sizes)
        const starIdx = Math.floor((tank.spawnFrames / 4) % 4);
        const starCanvas = this.atlas.stars[starIdx];
        this.ctx.drawImage(starCanvas, ox + tank.x, oy + tank.y);
      } else {
        // Active tank
        let spriteId = tank.kind || 'basic';
        if (tank.team === 'player') {
          spriteId = `${tank.kind}_s${tank.stars || 0}`;
        } else if (tank.carrier && Math.floor(tick / 8) % 2 === 0) {
          spriteId = 'carrier_red';
        } else if (tank.kind === 'armor') {
          const hp = Math.max(1, Math.min(4, tank.hp || 1));
          spriteId = `armor_hp${hp}`;
        }

        const tankSprite = this.atlas.getTank(spriteId, tank.treadFrame || 0, tank.dir || 0);
        this.ctx.drawImage(tankSprite, ox + tank.x, oy + tank.y);

        // Shield bubble (2 frames toggling every 2 ticks)
        if (tank.shield > 0) {
          const shieldFrame = Math.floor(tick / 2) % 2;
          this.ctx.drawImage(this.atlas.shields[shieldFrame], ox + tank.x - 1, oy + tank.y - 1);
        }
      }
    }

    // Layer 7: Bullets (4x4)
    for (const b of bullets) {
      this.ctx.drawImage(this.atlas.bullet, ox + b.x, oy + b.y);
    }

    // Layer 8: Explosions
    for (const exp of explosions) {
      const frames = exp.big ? this.atlas.explosions.big : this.atlas.explosions.small;
      const f = Math.min(frames.length - 1, exp.frame);
      const sprite = frames[f];
      const size = exp.big ? 32 : 16;
      this.ctx.drawImage(sprite, ox + exp.x - size / 2, oy + exp.y - size / 2);
    }

    // Layer 9: Trees / Bushes (DRAWN ABOVE TANKS AND BULLETS)
    for (let ty = 0; ty < GRID_TILES_Y; ty++) {
      for (let tx = 0; tx < GRID_TILES_X; tx++) {
        if (map.tileType[ty * GRID_TILES_X + tx] === TILE_TREES) {
          this.ctx.drawImage(this.atlas.terrain.trees, ox + tx * TILE_SIZE, oy + ty * TILE_SIZE);
        }
      }
    }

    // Layer 10: HUD
    this.drawHUD(hud);
  }

  // Draw full sprite sheet debug view (Acceptance Step 2)
  drawSpriteSheetDebug() {
    this.clear(PALETTE.BLACK);
    drawText(this.ctx, 'SPRITE ATLAS DEBUG', 16, 8, PALETTE.TEXT_ORANGE);

    // Tanks (P1, P2, Basic, Fast, Power, Armor, Carrier)
    const sampleTanks = [
      'P1_s0', 'P1_s1', 'P1_s2', 'P1_s3',
      'P2_s0', 'basic', 'fast', 'power',
      'armor_hp4', 'armor_hp3', 'armor_hp2', 'armor_hp1',
      'carrier_red'
    ];

    let y = 24;
    for (let i = 0; i < sampleTanks.length; i++) {
      const id = sampleTanks[i];
      const rowY = y + i * 16;
      if (rowY + 16 > CANVAS_H) break;
      // 4 directions
      for (let dir = 0; dir < 4; dir++) {
        const sprite = this.atlas.getTank(id, 0, dir);
        this.ctx.drawImage(sprite, 16 + dir * 18, rowY);
      }
      drawText(this.ctx, id, 100, rowY + 4, PALETTE.WHITE);
    }

    // Terrain tiles
    const tx = 180;
    this.ctx.drawImage(this.atlas.terrain.brickFull, tx, 24);
    drawText(this.ctx, 'BRK', tx + 12, 24, PALETTE.WHITE);

    this.ctx.drawImage(this.atlas.terrain.steel, tx, 36);
    drawText(this.ctx, 'STL', tx + 12, 36, PALETTE.WHITE);

    this.ctx.drawImage(this.atlas.terrain.water0, tx, 48);
    drawText(this.ctx, 'WTR', tx + 20, 52, PALETTE.WHITE);

    this.ctx.drawImage(this.atlas.terrain.trees, tx, 68);
    drawText(this.ctx, 'TRE', tx + 20, 72, PALETTE.WHITE);

    this.ctx.drawImage(this.atlas.terrain.ice, tx, 88);
    drawText(this.ctx, 'ICE', tx + 20, 92, PALETTE.WHITE);

    this.ctx.drawImage(this.atlas.eagle.alive, tx, 108);
    drawText(this.ctx, 'EAG', tx + 20, 112, PALETTE.WHITE);

    this.ctx.drawImage(this.atlas.eagle.destroyed, tx, 128);
    drawText(this.ctx, 'DED', tx + 20, 132, PALETTE.WHITE);

    // Powerups
    const pNames = ['star', 'helmet', 'clock', 'shovel', 'grenade', 'tank'];
    pNames.forEach((name, idx) => {
      this.ctx.drawImage(this.atlas.powerups[name], tx, 148 + idx * 14);
    });
  }

  // Blit offscreen buffer to integer-scaled canvas
  present() {
    this.screenCtx.imageSmoothingEnabled = false;
    this.screenCtx.drawImage(
      this.offscreen,
      0, 0, CANVAS_W, CANVAS_H,
      0, 0, CANVAS_W * this.scale, CANVAS_H * this.scale
    );
  }
}
