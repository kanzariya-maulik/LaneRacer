// shared/map.js
// Grid model, stage loading, cell quarters, and terrain collision

import {
  GRID_TILES_X,
  GRID_TILES_Y,
  GRID_CELLS_X,
  GRID_CELLS_Y,
  TILE_SIZE,
  CELL_SIZE,
  QUARTER_SIZE,
  PLAYFIELD_W,
  PLAYFIELD_H,
  TANK_SIZE,
  TILE_EMPTY,
  TILE_BRICK,
  TILE_STEEL,
  TILE_WATER,
  TILE_TREES,
  TILE_ICE,
  TILE_EAGLE,
  BRICK_FULL,
  DIR_UP,
  DIR_RIGHT,
  DIR_DOWN,
  DIR_LEFT,
  EAGLE_POS
} from './constants.js';

export class GameMap {
  constructor() {
    this.cellType = new Uint8Array(GRID_CELLS_X * GRID_CELLS_Y); // 0 empty, 1 brick, 2 steel
    this.brickBits = new Uint8Array(GRID_CELLS_X * GRID_CELLS_Y); // 4-bit mask (0b1111)
    this.tileType = new Uint8Array(GRID_TILES_X * GRID_TILES_Y); // 0 empty, 3 water, 4 trees, 5 ice
    this.eagle = { alive: true, x: EAGLE_POS.x, y: EAGLE_POS.y, w: 16, h: 16 };
  }

  // Load a stage JSON structure
  loadStage(stageData) {
    this.cellType.fill(0);
    this.brickBits.fill(0);
    this.tileType.fill(0);
    this.eagle.alive = true;
    this.eagle.x = EAGLE_POS.x;
    this.eagle.y = EAGLE_POS.y;

    const { map13, map26, overrides } = stageData;

    if (map26 && Array.isArray(map26)) {
      // Direct 26x26 cell loading
      for (let cy = 0; cy < GRID_CELLS_Y; cy++) {
        const row = map26[cy];
        for (let cx = 0; cx < GRID_CELLS_X; cx++) {
          const ch = row[cx];
          const idx = cy * GRID_CELLS_X + cx;
          if (ch === 'B') {
            this.cellType[idx] = TILE_BRICK;
            this.brickBits[idx] = BRICK_FULL;
          } else if (ch === 'S') {
            this.cellType[idx] = TILE_STEEL;
          }
        }
      }
    } else if (map13 && Array.isArray(map13)) {
      // 13x13 Tile expansion: each 16x16 tile expands to 2x2 cells (8x8 each)
      for (let ty = 0; ty < GRID_TILES_Y; ty++) {
        const row = map13[ty];
        for (let tx = 0; tx < GRID_TILES_X; tx++) {
          const ch = row[tx];
          const tIdx = ty * GRID_TILES_X + tx;

          if (ch === 'B') {
            // Expand brick to all 4 cells
            for (let dy = 0; dy < 2; dy++) {
              for (let dx = 0; dx < 2; dx++) {
                const cx = tx * 2 + dx;
                const cy = ty * 2 + dy;
                const cIdx = cy * GRID_CELLS_X + cx;
                this.cellType[cIdx] = TILE_BRICK;
                this.brickBits[cIdx] = BRICK_FULL;
              }
            }
          } else if (ch === 'S') {
            // Expand steel to all 4 cells
            for (let dy = 0; dy < 2; dy++) {
              for (let dx = 0; dx < 2; dx++) {
                const cx = tx * 2 + dx;
                const cy = ty * 2 + dy;
                const cIdx = cy * GRID_CELLS_X + cx;
                this.cellType[cIdx] = TILE_STEEL;
              }
            }
          } else if (ch === 'W') {
            this.tileType[tIdx] = TILE_WATER;
          } else if (ch === 'T') {
            this.tileType[tIdx] = TILE_TREES;
          } else if (ch === 'I') {
            this.tileType[tIdx] = TILE_ICE;
          } else if (ch === 'E') {
            this.eagle.alive = true;
            this.eagle.x = tx * TILE_SIZE;
            this.eagle.y = ty * TILE_SIZE;
          }
        }
      }
    }

    // Apply any cell-level overrides
    if (overrides && Array.isArray(overrides)) {
      for (const ov of overrides) {
        const { cx, cy, type, bits } = ov;
        if (cx >= 0 && cx < GRID_CELLS_X && cy >= 0 && cy < GRID_CELLS_Y) {
          const idx = cy * GRID_CELLS_X + cx;
          if (type === 'brick') {
            this.cellType[idx] = TILE_BRICK;
            this.brickBits[idx] = bits !== undefined ? bits : BRICK_FULL;
          } else if (type === 'steel') {
            this.cellType[idx] = TILE_STEEL;
            this.brickBits[idx] = 0;
          } else if (type === 'empty') {
            this.cellType[idx] = TILE_EMPTY;
            this.brickBits[idx] = 0;
          }
        }
      }
    }
  }

  // Get list of 8x8 cells overlapped by a bounding rectangle
  getCellsInRect(x, y, w, h) {
    const minCx = Math.max(0, Math.floor(x / CELL_SIZE));
    const maxCx = Math.min(GRID_CELLS_X - 1, Math.floor((x + w - 1) / CELL_SIZE));
    const minCy = Math.max(0, Math.floor(y / CELL_SIZE));
    const maxCy = Math.min(GRID_CELLS_Y - 1, Math.floor((y + h - 1) / CELL_SIZE));

    const cells = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        cells.push({ cx, cy, idx: cy * GRID_CELLS_X + cx });
      }
    }
    return cells;
  }

  // Check if a 16x16 tank can occupy (x, y)
  // Tested against: bounds, brick quarters, steel, water, eagle
  canOccupy(x, y, ignoreEagle = false) {
    // 1. Playfield boundary check (0, 0, 208, 208)
    if (x < 0 || y < 0 || x + TANK_SIZE > PLAYFIELD_W || y + TANK_SIZE > PLAYFIELD_H) {
      return false;
    }

    // 2. Eagle collision
    if (!ignoreEagle && this.eagle.alive) {
      if (
        x < this.eagle.x + 16 &&
        x + TANK_SIZE > this.eagle.x &&
        y < this.eagle.y + 16 &&
        y + TANK_SIZE > this.eagle.y
      ) {
        return false;
      }
    }

    // 3. Water tile collision (16x16 tiles)
    const minTx = Math.max(0, Math.floor(x / TILE_SIZE));
    const maxTx = Math.min(GRID_TILES_X - 1, Math.floor((x + TANK_SIZE - 1) / TILE_SIZE));
    const minTy = Math.max(0, Math.floor(y / TILE_SIZE));
    const maxTy = Math.min(GRID_TILES_Y - 1, Math.floor((y + TANK_SIZE - 1) / TILE_SIZE));

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.tileType[ty * GRID_TILES_X + tx] === TILE_WATER) {
          return false;
        }
      }
    }

    // 4. Cell-level collision (Steel & Brick Quarters)
    const cells = this.getCellsInRect(x, y, TANK_SIZE, TANK_SIZE);
    for (const cell of cells) {
      const { cx, cy, idx } = cell;
      const type = this.cellType[idx];

      if (type === TILE_STEEL) {
        return false;
      }

      if (type === TILE_BRICK) {
        const bits = this.brickBits[idx];
        if (bits === 0) continue;

        // Exact 4x4 quarter collision test
        const cellX = cx * CELL_SIZE;
        const cellY = cy * CELL_SIZE;

        // Quarters: 0=TL, 1=TR, 2=BL, 3=BR
        const qDefs = [
          { mask: 0b0001, qx: cellX, qy: cellY },
          { mask: 0b0010, qx: cellX + 4, qy: cellY },
          { mask: 0b0100, qx: cellX, qy: cellY + 4 },
          { mask: 0b1000, qx: cellX + 4, qy: cellY + 4 }
        ];

        for (const q of qDefs) {
          if (bits & q.mask) {
            // AABB overlap between tank [x, x+16) and quarter [qx, qx+4)
            if (
              x < q.qx + QUARTER_SIZE &&
              x + TANK_SIZE > q.qx &&
              y < q.qy + QUARTER_SIZE &&
              y + TANK_SIZE > q.qy
            ) {
              return false;
            }
          }
        }
      }
    }

    return true;
  }

  // Check if center of tank is on ice
  isOnIce(x, y) {
    const centerX = x + 8;
    const centerY = y + 8;
    if (centerX < 0 || centerX >= PLAYFIELD_W || centerY < 0 || centerY >= PLAYFIELD_H) return false;
    const tx = Math.floor(centerX / TILE_SIZE);
    const ty = Math.floor(centerY / TILE_SIZE);
    return this.tileType[ty * GRID_TILES_X + tx] === TILE_ICE;
  }

  // Check if position is under trees
  isUnderTrees(x, y) {
    const centerX = x + 8;
    const centerY = y + 8;
    if (centerX < 0 || centerX >= PLAYFIELD_W || centerY < 0 || centerY >= PLAYFIELD_H) return false;
    const tx = Math.floor(centerX / TILE_SIZE);
    const ty = Math.floor(centerY / TILE_SIZE);
    return this.tileType[ty * GRID_TILES_X + tx] === TILE_TREES;
  }

  // Brick destruction algorithm (File 05 §3)
  // Returns true if a brick was hit
  hitBrickCell(cx, cy, dir, strong = false) {
    if (cx < 0 || cx >= GRID_CELLS_X || cy < 0 || cy >= GRID_CELLS_Y) return false;
    const idx = cy * GRID_CELLS_X + cx;
    if (this.cellType[idx] !== TILE_BRICK) return false;

    let bits = this.brickBits[idx];
    if (bits === 0) return false;

    // Bit masks per direction:
    // UP hits bottom quarters first (BL, BR = 0b1100), then top (TL, TR = 0b0011)
    // DOWN hits top quarters first (TL, TR = 0b0011), then bottom (BL, BR = 0b1100)
    // LEFT hits right quarters first (TR, BR = 0b1010), then left (TL, BL = 0b0101)
    // RIGHT hits left quarters first (TL, BL = 0b0101), then right (TR, BR = 0b1010)
    const order = {
      [DIR_UP]: [0b1100, 0b0011],
      [DIR_DOWN]: [0b0011, 0b1100],
      [DIR_LEFT]: [0b1010, 0b0101],
      [DIR_RIGHT]: [0b0101, 0b1010]
    }[dir];

    const first = order[0];
    const second = order[1];

    if (bits & first) {
      bits &= ~(strong ? (first | second) : first);
    } else if (bits & second) {
      bits &= ~second;
    }

    this.brickBits[idx] = bits;
    if (bits === 0) {
      this.cellType[idx] = TILE_EMPTY;
    }

    return true;
  }

  // Remove steel cell (Star 3 bullet only)
  removeSteelCell(cx, cy) {
    if (cx < 0 || cx >= GRID_CELLS_X || cy < 0 || cy >= GRID_CELLS_Y) return false;
    const idx = cy * GRID_CELLS_X + cx;
    if (this.cellType[idx] === TILE_STEEL) {
      this.cellType[idx] = TILE_EMPTY;
      return true;
    }
    return false;
  }

  // Shovel powerup: swap the 5 fortress tiles (tile (5,11), (6,11), (7,11), (5,12), (7,12))
  // to steel or restore full bricks
  setFortressMaterial(isSteel) {
    const fortressTiles = [
      { tx: 5, ty: 11 },
      { tx: 6, ty: 11 },
      { tx: 7, ty: 11 },
      { tx: 5, ty: 12 },
      { tx: 7, ty: 12 }
    ];

    for (const t of fortressTiles) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = t.tx * 2 + dx;
          const cy = t.ty * 2 + dy;
          const idx = cy * GRID_CELLS_X + cx;
          if (isSteel) {
            this.cellType[idx] = TILE_STEEL;
            this.brickBits[idx] = 0;
          } else {
            this.cellType[idx] = TILE_BRICK;
            this.brickBits[idx] = BRICK_FULL;
          }
        }
      }
    }
  }
}
