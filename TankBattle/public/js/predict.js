// Zero-Lag Client-Side Prediction & Server Reconciliation for TankBattle LAN

const BASE_SPEED = 2.4;
const TANK_SIZE = 26;

export class ClientPredictor {
    constructor() {
        this.predictedTank = null;
        this.unacknowledgedInputs = [];
        this.snapBuffer = []; // Snapshot history buffer for remote tank interpolation
    }

    init(initialTank) {
        if (!initialTank) return;
        this.predictedTank = {
            id: initialTank.id,
            x: initialTank.x,
            y: initialTank.y,
            dir: initialTank.dir,
            moving: false,
            tier: initialTank.tier || 1
        };
    }

    // Immediately predict local movement upon client key input
    predictLocal(input, mapManager) {
        if (!this.predictedTank || !mapManager) return;

        const tank = this.predictedTank;
        tank.dir = input.dir;
        tank.moving = input.moving;

        if (input.moving) {
            const speed = BASE_SPEED + (tank.tier >= 2 ? 0.4 : 0);
            let vx = 0;
            let vy = 0;
            if (tank.dir === 'UP') vy = -speed;
            if (tank.dir === 'DOWN') vy = speed;
            if (tank.dir === 'LEFT') vx = -speed;
            if (tank.dir === 'RIGHT') vx = speed;

            const nextX = tank.x + vx;
            const nextY = tank.y + vy;

            // Simple client check against walls to avoid predicting into solid blocks
            if (!mapManager.isTankBlocked(nextX, nextY, TANK_SIZE)) {
                tank.x = nextX;
                tank.y = nextY;
            }
        }
    }

    // Reconcile client prediction against authoritative server snapshot
    reconcile(serverTank) {
        if (!this.predictedTank || !serverTank) return;

        const errX = serverTank.x - this.predictedTank.x;
        const errY = serverTank.y - this.predictedTank.y;
        const dist = Math.hypot(errX, errY);

        if (dist > 35) {
            // Hard snap if huge desync
            this.predictedTank.x = serverTank.x;
            this.predictedTank.y = serverTank.y;
        } else if (dist > 1.5) {
            // Smooth correction
            this.predictedTank.x += errX * 0.25;
            this.predictedTank.y += errY * 0.25;
        }

        this.predictedTank.tier = serverTank.tier;
        this.predictedTank.alive = serverTank.alive;
        this.predictedTank.shield = serverTank.shield;
        this.predictedTank.lives = serverTank.lives;
        this.predictedTank.foliage = serverTank.foliage;
    }

    getPos() {
        return this.predictedTank ? { x: this.predictedTank.x, y: this.predictedTank.y, dir: this.predictedTank.dir, moving: this.predictedTank.moving } : null;
    }
}
