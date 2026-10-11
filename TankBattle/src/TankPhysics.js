// Tank Movement, Corner Assist, Ice Sliding, and Collision Physics

const TANK_SIZE = 26;
const BASE_SPEED = 2.4; // pixels per 60Hz tick
const ICE_FRICTION = 0.94; // Slide momentum multiplier on ice

function applyCornerAssist(tank, requestedDir, mapManager) {
    const sub = mapManager.subSize; // 16px
    const half = sub / 2;

    if (requestedDir === 'UP' || requestedDir === 'DOWN') {
        // Nudge horizontal X to nearest sub-tile lane center
        const nearestCenterX = Math.round((tank.x - half) / sub) * sub + half;
        const diffX = nearestCenterX - tank.x;
        if (Math.abs(diffX) <= 6) {
            const nudge = Math.sign(diffX) * Math.min(Math.abs(diffX), 1.5);
            if (!mapManager.isTankBlocked(tank.x + nudge, tank.y, TANK_SIZE)) {
                tank.x += nudge;
            }
        }
    } else if (requestedDir === 'LEFT' || requestedDir === 'RIGHT') {
        // Nudge vertical Y to nearest sub-tile lane center
        const nearestCenterY = Math.round((tank.y - half) / sub) * sub + half;
        const diffY = nearestCenterY - tank.y;
        if (Math.abs(diffY) <= 6) {
            const nudge = Math.sign(diffY) * Math.min(Math.abs(diffY), 1.5);
            if (!mapManager.isTankBlocked(tank.x, tank.y + nudge, TANK_SIZE)) {
                tank.y += nudge;
            }
        }
    }
}

function updateTankPhysics(tank, input, mapManager, allTanks) {
    if (!tank.alive) return;

    // Boosted speed if tank has tier upgrades
    const speed = BASE_SPEED + (tank.tier >= 2 ? 0.4 : 0);

    const onIce = mapManager.isIceAt(tank.x, tank.y);
    tank.onIce = onIce;

    if (input.moving) {
        // Turn immediately to requested direction
        if (tank.dir !== input.dir) {
            applyCornerAssist(tank, input.dir, mapManager);
            tank.dir = input.dir;
        }

        let vx = 0;
        let vy = 0;
        if (tank.dir === 'UP') vy = -speed;
        if (tank.dir === 'DOWN') vy = speed;
        if (tank.dir === 'LEFT') vx = -speed;
        if (tank.dir === 'RIGHT') vx = speed;

        tank.slideVx = vx;
        tank.slideVy = vy;

        const nextX = tank.x + vx;
        const nextY = tank.y + vy;

        // Check map obstacle collision
        if (!mapManager.isTankBlocked(nextX, nextY, TANK_SIZE)) {
            // Check collision against other tanks
            let blockedByTank = false;
            for (const other of Object.values(allTanks)) {
                if (other.id !== tank.id && other.alive) {
                    if (Math.abs(nextX - other.x) < TANK_SIZE && Math.abs(nextY - other.y) < TANK_SIZE) {
                        blockedByTank = true;
                        break;
                    }
                }
            }

            if (!blockedByTank) {
                tank.x = nextX;
                tank.y = nextY;
                tank.moving = true;
            } else {
                tank.moving = false;
            }
        } else {
            tank.moving = false;
        }
    } else {
        // Not actively pressing move key: check ice slide momentum!
        if (onIce && (Math.abs(tank.slideVx) > 0.2 || Math.abs(tank.slideVy) > 0.2)) {
            tank.slideVx *= ICE_FRICTION;
            tank.slideVy *= ICE_FRICTION;

            const nextX = tank.x + tank.slideVx;
            const nextY = tank.y + tank.slideVy;

            if (!mapManager.isTankBlocked(nextX, nextY, TANK_SIZE)) {
                tank.x = nextX;
                tank.y = nextY;
                tank.moving = true;
            } else {
                tank.slideVx = 0;
                tank.slideVy = 0;
                tank.moving = false;
            }
        } else {
            tank.slideVx = 0;
            tank.slideVy = 0;
            tank.moving = false;
        }
    }

    // Concealment in forest
    tank.inFoliage = mapManager.isFoliageAt(tank.x, tank.y);
}

module.exports = {
    TANK_SIZE,
    BASE_SPEED,
    applyCornerAssist,
    updateTankPhysics
};
