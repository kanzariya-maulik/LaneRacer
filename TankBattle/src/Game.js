// Authoritative 60 Hz Tank Battle Simulation Engine
const Ticker = require('./ticker');
const { loadMap } = require('./Maps');
const { updateTankPhysics } = require('./TankPhysics');
const ProjectileEngine = require('./ProjectileEngine');
const PowerupManager = require('./PowerupManager');
const webrtcManager = require('./webrtcManager');
const logger = require('./logger');

const TICK_RATE = 60;
const STEP_MS = 1000 / TICK_RATE;

class Game {
    constructor(io, settings = {}, players = {}, onGameOver = null) {
        this.io = io;
        this.settings = settings;
        this.onGameOver = onGameOver;
        this.running = false;
        this.stateSeq = 0;
        this.startTime = Date.now();

        // Load map and spawns
        const { map, spawns } = loadMap(settings.mapId, settings.teamMode);
        this.mapManager = map;
        this.spawns = spawns;

        this.projectiles = new ProjectileEngine();
        this.powerupManager = new PowerupManager();

        this.tanks = {};
        this.events = [];
        this.gridDiffs = [];
        this.eliminatedTeams = new Set();
        this.winner = null;

        // Initialize participating tanks from lobby players
        this.initTanks(players);

        // Powerup spawn interval (every 14 seconds)
        this.nextPowerupTick = 14 * TICK_RATE;

        // 60 Hz Fixed-Step Ticker
        this.ticker = new Ticker(STEP_MS, () => this.tick());
    }

    initTanks(players) {
        const teamCounters = {};

        for (const [id, p] of Object.entries(players)) {
            if (p.isSpectating) continue;

            const teamId = p.teamId || 'team-red';
            teamCounters[teamId] = teamCounters[teamId] || 0;
            const spawnList = this.spawns[teamId] || this.spawns['team-red'] || [{ x: 100, y: 100, dir: 'UP' }];
            const spawn = spawnList[teamCounters[teamId] % spawnList.length];
            teamCounters[teamId]++;

            this.tanks[id] = {
                id,
                username: p.username || 'Tanker',
                teamId,
                color: p.color || '#ff4444',
                x: spawn.x,
                y: spawn.y,
                dir: spawn.dir || 'UP',
                moving: false,
                alive: true,
                lives: this.settings.lives || 3,
                tier: 1, // 1 to 4
                shieldUntil: Date.now() + 3000, // 3s spawn invulnerability shield
                lastShootTime: 0,
                lastBombTime: 0,
                slideVx: 0,
                slideVy: 0,
                onIce: false,
                inFoliage: false,
                lastSeqProcessed: 0,
                inputQueue: [],
                kills: 0,
                bombsUsed: 0
            };
        }
    }

    start() {
        this.running = true;
        this.startTime = Date.now();
        this.ticker.start();
        logger.info(`Game started on map "${this.settings.mapId}" mode "${this.settings.mode}" with ${Object.keys(this.tanks).length} tanks.`);
    }

    stop() {
        this.running = false;
        if (this.ticker) this.ticker.stop();
        this.projectiles.clear();
        this.powerupManager.clear();
        logger.info('Game stopped.');
    }

    removePlayer(id) {
        if (this.tanks[id]) {
            this.tanks[id].alive = false;
            this.checkVictoryCondition();
        }
    }

    handleInput(id, input) {
        const tank = this.tanks[id];
        if (!tank || !tank.alive) return;
        tank.inputQueue.push(input);
    }

    handleInputs(id, batch) {
        const tank = this.tanks[id];
        if (!tank || !tank.alive) return;
        for (const item of batch) {
            if (item.seq > tank.lastSeqProcessed) {
                tank.inputQueue.push(item);
            }
        }
    }

    // Main 60 Hz simulation tick
    tick() {
        if (!this.running) return;
        this.stateSeq++;

        const now = Date.now();

        // 1. Process player inputs
        for (const tank of Object.values(this.tanks)) {
            if (!tank.alive) continue;

            // Pick the latest input or apply sequential inputs
            while (tank.inputQueue.length > 0) {
                const input = tank.inputQueue.shift();
                if (input.seq !== undefined) tank.lastSeqProcessed = input.seq;

                // Update movement physics
                updateTankPhysics(tank, input, this.mapManager, this.tanks);

                // Handle Standard Shell Fire (Space)
                if (input.shoot) {
                    const reloadMs = tank.tier >= 3 ? 180 : 300;
                    if (now - tank.lastShootTime >= reloadMs) {
                        tank.lastShootTime = now;
                        this.projectiles.spawnShell(tank);
                        this.events.push({
                            type: 'SHELL_FIRED',
                            tankId: tank.id,
                            x: tank.x,
                            y: tank.y,
                            dir: tank.dir
                        });
                    }
                }

                // Handle Thrown Bomb (Enter key)
                if (input.bomb) {
                    const cooldown = this.settings.bombCooldownMs || 2500;
                    if (now - tank.lastBombTime >= cooldown) {
                        tank.lastBombTime = now;
                        tank.bombsUsed++;
                        this.projectiles.spawnBomb(tank);
                        this.events.push({
                            type: 'BOMB_THROWN',
                            tankId: tank.id,
                            x: tank.x,
                            y: tank.y,
                            dir: tank.dir
                        });
                    }
                }
            }
        }

        // 2. Update Projectiles & Bombs
        const projResult = this.projectiles.update(
            this.mapManager,
            this.tanks,
            (event) => this.handleGameEvent(event),
            this.settings
        );
        if (projResult.gridDiffs && projResult.gridDiffs.length > 0) {
            this.gridDiffs.push(...projResult.gridDiffs);
        }

        // 3. Update Tactical Powerups
        if (this.settings.powerupsEnabled) {
            this.nextPowerupTick--;
            if (this.nextPowerupTick <= 0) {
                this.nextPowerupTick = 15 * TICK_RATE; // Next powerup in 15 seconds
                const p = this.powerupManager.spawnRandom(this.mapManager);
                if (p) {
                    this.events.push({ type: 'POWERUP_SPAWNED', powerup: p });
                }
            }

            this.powerupManager.update(this.mapManager, this.tanks, (event) => this.handleGameEvent(event));
        }

        // 4. Check Victory / Elimination
        this.checkVictoryCondition();

        // 5. Broadcast 60 Hz State Snapshot via WebRTC UDP DataChannel (or Socket.IO fallback)
        this.broadcastState();
    }

    handleGameEvent(event) {
        this.events.push(event);

        if (event.type === 'TANK_HIT' && event.killed) {
            if (event.killerId && this.tanks[event.killerId]) {
                this.tanks[event.killerId].kills++;
            }
        } else if (event.type === 'BASE_DESTROYED') {
            const teamId = event.teamId;
            logger.info(`Eagle HQ of team ${teamId} has been destroyed!`);
            this.eliminatedTeams.add(teamId);
            // Eliminate all tanks belonging to this team
            for (const t of Object.values(this.tanks)) {
                if (t.teamId === teamId) {
                    t.alive = false;
                }
            }
        }
    }

    checkVictoryCondition() {
        if (this.winner) return;

        const mode = this.settings.mode || 'attack_defense';

        if (mode === 'attack_defense') {
            // Base Defence: Check surviving Eagle HQs
            const aliveEagles = [];
            for (const eagle of this.mapManager.eagles.values()) {
                if (eagle.alive) aliveEagles.push(eagle.teamId);
            }

            if (aliveEagles.length === 1 && this.mapManager.eagles.size > 1) {
                this.endGame(aliveEagles[0], 'All enemy Eagle HQs destroyed!');
            } else if (aliveEagles.length === 0) {
                this.endGame('draw', 'All bases obliterated!');
            }
        } else {
            // Deathmatch: Check surviving teams/tanks
            const livingTeams = new Set();
            let livingTankCount = 0;
            let lastLivingTank = null;

            for (const t of Object.values(this.tanks)) {
                if (t.alive) {
                    livingTeams.add(t.teamId);
                    livingTankCount++;
                    lastLivingTank = t;
                }
            }

            if (this.settings.teamMode === 'ffa') {
                if (livingTankCount === 1) {
                    this.endGame(lastLivingTank.id, `${lastLivingTank.username} is the last tank standing!`);
                } else if (livingTankCount === 0) {
                    this.endGame('draw', 'Mutual annihilation!');
                }
            } else {
                if (livingTeams.size === 1 && Object.keys(this.tanks).length > 1) {
                    const winningTeam = Array.from(livingTeams)[0];
                    this.endGame(winningTeam, `Team ${winningTeam} eliminated all opposition!`);
                } else if (livingTeams.size === 0) {
                    this.endGame('draw', 'All tanks destroyed!');
                }
            }
        }
    }

    endGame(winner, reason) {
        this.winner = winner;
        logger.info(`Game over! Winner: ${winner}. Reason: ${reason}`);

        const results = {
            winner,
            reason,
            tanks: Object.values(this.tanks).map(t => ({
                id: t.id,
                username: t.username,
                teamId: t.teamId,
                kills: t.kills,
                bombsUsed: t.bombsUsed,
                alive: t.alive
            }))
        };

        this.events.push({ type: 'MATCH_WINNER', winner, reason, results });
        this.broadcastState();

        this.stop();
        if (this.onGameOver) {
            this.onGameOver(results);
        }
    }

    broadcastState() {
        const time = (Date.now() - this.startTime) / 1000;

        // Compact tank state for fast network delta
        const tankList = Object.values(this.tanks).map(t => ({
            id: t.id,
            x: Math.round(t.x * 10) / 10,
            y: Math.round(t.y * 10) / 10,
            dir: t.dir,
            moving: t.moving,
            alive: t.alive,
            lives: t.lives,
            tier: t.tier,
            shield: t.shieldUntil && t.shieldUntil > Date.now(),
            foliage: t.inFoliage,
            ice: t.onIce,
            kills: t.kills,
            ackSeq: t.lastSeqProcessed,
            bombReady: (Date.now() - t.lastBombTime) >= (this.settings.bombCooldownMs || 2500)
        }));

        const shellList = this.projectiles.shells.map(s => ({
            id: s.id,
            x: Math.round(s.x * 10) / 10,
            y: Math.round(s.y * 10) / 10,
            dir: s.dir,
            pierce: s.canPierceSteel
        }));

        const bombList = this.projectiles.bombs.map(b => ({
            id: b.id,
            x: Math.round(b.x * 10) / 10,
            y: Math.round(b.y * 10) / 10,
            radius: b.radius,
            fuse: b.lifetime
        }));

        const eagleList = Array.from(this.mapManager.eagles.values()).map(e => ({
            teamId: e.teamId,
            col: e.col,
            row: e.row,
            alive: e.alive
        }));

        const snapshot = {
            seq: this.stateSeq,
            time: Math.round(time * 100) / 100,
            tanks: tankList,
            shells: shellList,
            bombs: bombList,
            eagles: eagleList,
            powerups: this.powerupManager.powerups,
            gridDiffs: this.gridDiffs,
            events: this.events
        };

        webrtcManager.broadcastGameState(snapshot, this.io);

        // Reset per-frame event buffers
        this.events = [];
        this.gridDiffs = [];
    }
}

module.exports = Game;
