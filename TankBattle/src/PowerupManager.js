// Tactical Battlefield Powerups Manager

const TYPES = ['star', 'bomb', 'shield', 'shovel', 'clock', 'life'];

class PowerupManager {
    constructor() {
        this.powerups = [];
        this.nextId = 1;
        this.spawnTimer = 0;
    }

    spawnRandom(mapManager) {
        // Pick an empty tile
        for (let attempt = 0; attempt < 30; attempt++) {
            const col = 2 + Math.floor(Math.random() * (mapManager.cols - 4));
            const row = 2 + Math.floor(Math.random() * (mapManager.rows - 4));
            const type = mapManager.getTile(col, row);

            if (type === 0 || type === 5) { // Empty or Ice
                const pType = TYPES[Math.floor(Math.random() * TYPES.length)];
                const powerup = {
                    id: this.nextId++,
                    type: pType,
                    x: col * mapManager.tileSize + mapManager.tileSize / 2,
                    y: row * mapManager.tileSize + mapManager.tileSize / 2,
                    col,
                    row,
                    expiresAt: Date.now() + 25000 // 25s despawn timer
                };
                this.powerups.push(powerup);
                return powerup;
            }
        }
        return null;
    }

    update(mapManager, tanks, onEvent) {
        const now = Date.now();
        // Remove expired powerups
        this.powerups = this.powerups.filter(p => p.expiresAt > now);

        // Check tank pickup
        const collectedIds = new Set();
        for (const p of this.powerups) {
            for (const t of Object.values(tanks)) {
                if (!t.alive) continue;
                if (Math.hypot(t.x - p.x, t.y - p.y) < 22) {
                    collectedIds.add(p.id);
                    this.applyPowerup(p.type, t, mapManager, onEvent);
                    onEvent({
                        type: 'POWERUP_COLLECT',
                        tankId: t.id,
                        powerupType: p.type,
                        x: p.x,
                        y: p.y
                    });
                    break;
                }
            }
        }

        this.powerups = this.powerups.filter(p => !collectedIds.has(p.id));
    }

    applyPowerup(type, tank, mapManager, onEvent) {
        if (type === 'star') {
            tank.tier = Math.min(4, (tank.tier || 1) + 1);
        } else if (type === 'shield') {
            tank.shieldUntil = Date.now() + 10000; // 10s shield
        } else if (type === 'bomb') {
            tank.lastBombTime = 0; // Instant bomb cooldown reset
        } else if (type === 'life') {
            tank.lives = (tank.lives || 3) + 1;
        } else if (type === 'shovel') {
            // Reinforce base walls
            const diffs = mapManager.reinforceBase(tank.teamId, 15000);
            if (diffs.length > 0) {
                onEvent({ type: 'BASE_REINFORCED', teamId: tank.teamId, diffs });
                setTimeout(() => {
                    const revertDiffs = mapManager.restoreBaseFortifications();
                    if (revertDiffs.length > 0) {
                        onEvent({ type: 'BASE_UNREINFORCED', teamId: tank.teamId, diffs: revertDiffs });
                    }
                }, 15000);
            }
        } else if (type === 'clock') {
            onEvent({ type: 'CLOCK_FREEZE', byTeamId: tank.teamId, durationMs: 5000 });
        }
    }

    clear() {
        this.powerups = [];
    }
}

module.exports = PowerupManager;
