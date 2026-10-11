// Dual-Grid Sub-Tile Destructible Map Manager
// 26x26 Macro blocks (32x32px each) -> 52x52 Micro sub-tiles (16x16px each)

class MapManager {
    constructor(cols = 26, rows = 26, tileSize = 32) {
        this.cols = cols;
        this.rows = rows;
        this.tileSize = tileSize;
        this.subSize = tileSize / 2; // 16px
        this.width = cols * tileSize;
        this.height = rows * tileSize;

        // Tile IDs:
        // 0: Empty, 1: Brick, 2: Steel, 3: Water, 4: Foliage, 5: Ice, 9: Eagle HQ, 10: Destroyed Eagle
        this.grid = new Uint8Array(cols * rows);

        // Bitmask for brick blocks: 4 bits per macro-block (0b1111 = 15 = all 4 quarters intact)
        // Bit 0: Top-Left (row 0, col 0) = 1
        // Bit 1: Top-Right (row 0, col 1) = 2
        // Bit 2: Bottom-Left (row 1, col 0) = 4
        // Bit 3: Bottom-Right (row 1, col 1) = 8
        this.brickMasks = new Uint8Array(cols * rows).fill(0b1111);

        // Team Eagles: teamId -> { col, row, alive }
        this.eagles = new Map();

        // Backup for iron wall temporary modifications: idx -> { type, mask }
        this.ironWallBackups = new Map();
        this.ironWallTimer = null;
    }

    setTile(col, row, type, mask = 0b1111) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
        const idx = row * this.cols + col;
        this.grid[idx] = type;
        this.brickMasks[idx] = (type === 1) ? mask : 0b1111;
    }

    getTile(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
        return this.grid[row * this.cols + col];
    }

    registerEagle(teamId, col, row) {
        this.setTile(col, row, 9);
        this.eagles.set(teamId, { teamId, col, row, alive: true });
    }

    getEagle(teamId) {
        return this.eagles.get(teamId);
    }

    getTileAtWorld(x, y) {
        const col = Math.floor(x / this.tileSize);
        const row = Math.floor(y / this.tileSize);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
        return this.grid[row * this.cols + col];
    }

    // Single point shell collision and quadrant destruction
    damageAt(worldX, worldY, dir, canPierceSteel = false) {
        const col = Math.floor(worldX / this.tileSize);
        const row = Math.floor(worldY / this.tileSize);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return { hit: true, solid: true, outOfBounds: true };
        }

        const idx = row * this.cols + col;
        const type = this.grid[idx];

        // Empty ground, foliage, ice: shells fly right through
        if (type === 0 || type === 4 || type === 5) {
            return { hit: false };
        }

        // Water: shells fly over water freely!
        if (type === 3) {
            return { hit: false };
        }

        // Steel block
        if (type === 2) {
            if (canPierceSteel) {
                this.grid[idx] = 0;
                this.brickMasks[idx] = 0;
                return { hit: true, destroyed: true, diff: { idx, type: 0, mask: 0 } };
            }
            return { hit: true, solid: true }; // Deflected without damage
        }

        // Eagle HQ hit: 1-hit kill for the base!
        if (type === 9) {
            this.grid[idx] = 10; // Transform to destroyed ruins sprite
            let destroyedTeam = 'unknown';
            for (const [teamId, eagle] of this.eagles.entries()) {
                if (eagle.col === col && eagle.row === row && eagle.alive) {
                    eagle.alive = false;
                    destroyedTeam = teamId;
                    break;
                }
            }
            return {
                hit: true,
                destroyed: true,
                baseDestroyed: destroyedTeam,
                diff: { idx, type: 10, mask: 0 }
            };
        }

        // Destroyed eagle ruin acts as solid obstacle
        if (type === 10) {
            return { hit: true, solid: true };
        }

        // Brick block sub-tile damage
        if (type === 1) {
            const localX = worldX - col * this.tileSize;
            const localY = worldY - row * this.tileSize;
            const subCol = Math.max(0, Math.min(1, Math.floor(localX / this.subSize)));
            const subRow = Math.max(0, Math.min(1, Math.floor(localY / this.subSize)));
            const subBit = 1 << (subRow * 2 + subCol);

            let mask = this.brickMasks[idx];
            if (mask & subBit) {
                // Destroy the hit quadrant
                mask &= ~subBit;
                this.brickMasks[idx] = mask;
                let newType = 1;
                if (mask === 0) {
                    this.grid[idx] = 0;
                    newType = 0;
                }
                return {
                    hit: true,
                    destroyed: true,
                    diff: { idx, type: newType, mask }
                };
            }
            // If the specific quadrant was already missing, shell may continue unless hitting adjacent
            return { hit: false };
        }

        return { hit: false };
    }

    // Heavy bomb area of effect (AOE) blast
    damageArea(centerX, centerY, radius = 48, canPierceSteel = true) {
        const diffs = [];
        let baseDestroyed = null;

        const minCol = Math.max(0, Math.floor((centerX - radius) / this.tileSize));
        const maxCol = Math.min(this.cols - 1, Math.floor((centerX + radius) / this.tileSize));
        const minRow = Math.max(0, Math.floor((centerY - radius) / this.tileSize));
        const maxRow = Math.min(this.rows - 1, Math.floor((centerY + radius) / this.tileSize));

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const idx = r * this.cols + c;
                const type = this.grid[idx];
                if (type === 0 || type === 4 || type === 5 || type === 3) continue;

                // Check distance to tile center
                const tileCenterX = c * this.tileSize + this.tileSize / 2;
                const tileCenterY = r * this.tileSize + this.tileSize / 2;
                const dist = Math.hypot(tileCenterX - centerX, tileCenterY - centerY);

                if (dist <= radius + this.tileSize * 0.4) {
                    if (type === 1) {
                        // Brick completely pulverized
                        this.grid[idx] = 0;
                        this.brickMasks[idx] = 0;
                        diffs.push({ idx, type: 0, mask: 0 });
                    } else if (type === 2 && canPierceSteel) {
                        // Steel shattered by heavy blast
                        this.grid[idx] = 0;
                        this.brickMasks[idx] = 0;
                        diffs.push({ idx, type: 0, mask: 0 });
                    } else if (type === 9) {
                        // Eagle caught in blast!
                        this.grid[idx] = 10;
                        for (const [teamId, eagle] of this.eagles.entries()) {
                            if (eagle.col === c && eagle.row === r && eagle.alive) {
                                eagle.alive = false;
                                baseDestroyed = teamId;
                                break;
                            }
                        }
                        diffs.push({ idx, type: 10, mask: 0 });
                    }
                }
            }
        }

        return { diffs, baseDestroyed };
    }

    // Sub-tile accurate tank bounding box collision check
    // Tank is represented by centered (x, y) with width & height
    isTankBlocked(x, y, size = 26) {
        const half = size / 2;
        const left = x - half;
        const right = x + half;
        const top = y - half;
        const bottom = y + half;

        // Arena boundary collision
        if (left < 0 || right > this.width || top < 0 || bottom > this.height) {
            return true;
        }

        const minCol = Math.floor(left / this.tileSize);
        const maxCol = Math.floor((right - 0.001) / this.tileSize);
        const minRow = Math.floor(top / this.tileSize);
        const maxRow = Math.floor((bottom - 0.001) / this.tileSize);

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return true;
                const idx = r * this.cols + c;
                const type = this.grid[idx];

                // Empty ground, foliage, ice allow movement
                if (type === 0 || type === 4 || type === 5) continue;

                // Steel, Water, and Eagle HQs always block tank
                if (type === 2 || type === 3 || type === 9 || type === 10) {
                    return true;
                }

                // Brick block sub-tile collision check
                if (type === 1) {
                    const mask = this.brickMasks[idx];
                    if (mask === 0) continue; // All sub-tiles destroyed, passable!

                    const tileX = c * this.tileSize;
                    const tileY = r * this.tileSize;

                    // Check overlap with each of the 4 sub-quadrants
                    for (let subR = 0; subR < 2; subR++) {
                        for (let subC = 0; subC < 2; subC++) {
                            const bit = 1 << (subR * 2 + subC);
                            if (mask & bit) {
                                const subLeft = tileX + subC * this.subSize;
                                const subRight = subLeft + this.subSize;
                                const subTop = tileY + subR * this.subSize;
                                const subBottom = subTop + this.subSize;

                                // AABB intersection
                                if (right > subLeft && left < subRight && bottom > subTop && top < subBottom) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }

        return false;
    }

    // Check if a point has ice underneath
    isIceAt(x, y) {
        return this.getTileAtWorld(x, y) === 5;
    }

    // Check if a point is in foliage (forest concealment)
    isFoliageAt(x, y) {
        return this.getTileAtWorld(x, y) === 4;
    }

    // Reinforce base: converts brick perimeter around team's Eagle into steel
    reinforceBase(teamId, durationMs = 15000) {
        const eagle = this.eagles.get(teamId);
        if (!eagle || !eagle.alive) return [];

        const diffs = [];
        const offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1,  0],          [1,  0],
            [-1,  1], [0,  1], [1,  1]
        ];

        for (const [dc, dr] of offsets) {
            const c = eagle.col + dc;
            const r = eagle.row + dr;
            if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
                const idx = r * this.cols + c;
                const currentType = this.grid[idx];
                // Only replace brick or empty fortifications
                if (currentType === 1 || currentType === 0) {
                    this.ironWallBackups.set(idx, { type: currentType, mask: this.brickMasks[idx] });
                    this.grid[idx] = 2; // Steel!
                    diffs.push({ idx, type: 2, mask: 0b1111 });
                }
            }
        }

        return diffs;
    }

    restoreBaseFortifications() {
        const diffs = [];
        for (const [idx, backup] of this.ironWallBackups.entries()) {
            this.grid[idx] = backup.type;
            this.brickMasks[idx] = backup.mask;
            diffs.push({ idx, type: backup.type, mask: backup.mask });
        }
        this.ironWallBackups.clear();
        return diffs;
    }

    // Serialize map state for initial sync
    getInitialState() {
        return {
            cols: this.cols,
            rows: this.rows,
            tileSize: this.tileSize,
            grid: Array.from(this.grid),
            brickMasks: Array.from(this.brickMasks),
            eagles: Array.from(this.eagles.values())
        };
    }
}

module.exports = MapManager;
