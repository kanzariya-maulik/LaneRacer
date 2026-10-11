// shared/sim.js
// Pure, authoritative, deterministic 60 Hz Battle City simulation core
// No DOM, no Date.now(), no Math.random(). Fixed-point positions and Mulberry32 PRNG.

import {
  FP_SHIFT,
  FP_ONE,
  FP_SPEED_PLAYER,
  FP_SPEED_BASIC,
  FP_SPEED_FAST,
  FP_SPEED_POWER,
  FP_SPEED_ARMOR,
  FP_BULLET_SPEED_SLOW,
  FP_BULLET_SPEED_FAST,
  BULLETS_MAX_PLAYER_DEFAULT,
  BULLETS_MAX_PLAYER_UPGRADED,
  BULLETS_MAX_ENEMY,
  DIR_UP,
  DIR_RIGHT,
  DIR_DOWN,
  DIR_LEFT,
  DIR_NONE,
  DIR_OFFSETS,
  SPAWN_STAR_FRAMES,
  SPAWN_SHIELD_FRAMES,
  HELMET_SHIELD_FRAMES,
  CLOCK_FREEZE_FRAMES,
  SHOVEL_FRAMES,
  SHOVEL_FLASH_FRAMES,
  FRIENDLY_FREEZE_FRAMES,
  ICE_SLIDE_FRAMES,
  RESPAWN_DELAY_FRAMES,
  ENEMIES_PER_STAGE,
  MAX_ALIVE_1P,
  MAX_ALIVE_2P,
  BASE_SPAWN_DELAY,
  MIN_SPAWN_DELAY,
  CARRIER_INDICES,
  SCORE_BASIC,
  SCORE_FAST,
  SCORE_POWER,
  SCORE_ARMOR,
  SCORE_PICKUP,
  EXTRA_LIFE_INTERVAL,
  INITIAL_RESERVES,
  P1_SPAWN_POS,
  P2_SPAWN_POS,
  ENEMY_SPAWN_TILES,
  EAGLE_POS,
  POWERUP_TYPES
} from './constants.js';
import { GameMap } from './map.js';
import { mulberry32 } from './rng.js';

export class BattleCitySim {
  constructor(seed = 1990) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.map = new GameMap();
    this.tick = 0;
    this.nextEntityId = 1;

    // Game state
    this.stageNum = 1;
    this.tanks = [];     // all live tanks (players + enemies)
    this.bullets = [];   // live bullets
    this.explosions = [];// visual explosions
    this.item = null;    // active powerup item on field

    // Game state machine (File 08)
    this.state = 'PLAYING'; // 'PLAYING', 'PAUSED', 'STAGE_CLEAR_WAIT', 'TALLY', 'GAME_OVER_ANIM', 'GAME_OVER_SCREEN'
    this.stateTimer = 0;

    // Global timers (frames)
    this.clockTimer = 0;   // freezes enemies
    this.shovelTimer = 0;  // fortress reinforced with steel

    // Wave management
    this.enemyQueue = []; // list of enemy types to spawn
    this.totalEnemiesSpawned = 0;
    this.spawnTimer = 0;
    this.spawnGateIndex = 0;
    this.numPlayers = 1;

    // Events emitted during current tick
    this.events = [];
  }

  // Initialize a stage
  initStage(stageData, numPlayers = 1) {
    this.tick = 0;
    this.numPlayers = numPlayers;
    this.stageNum = stageData.stage || 1;
    this.map.loadStage(stageData);

    this.tanks = [];
    this.bullets = [];
    this.explosions = [];
    this.item = null;
    this.clockTimer = 0;
    this.shovelTimer = 0;

    // Parse enemy wave
    this.enemyQueue = this.parseEnemyList(stageData.enemies || 'B*18,F*2');
    this.totalEnemiesSpawned = 0;
    this.spawnTimer = 30; // first enemy spawns ~0.5s after start
    this.spawnGateIndex = 0;

    // Spawn players
    this.nextEntityId = 1;
    this.spawnPlayer(this.nextEntityId++, 'P1', P1_SPAWN_POS);
    if (numPlayers >= 2) {
      this.spawnPlayer(this.nextEntityId++, 'P2', P2_SPAWN_POS);
    }
  }

  parseEnemyList(str) {
    const list = [];
    const parts = str.split(',');
    for (const p of parts) {
      const match = p.trim().match(/^([B|F|P|A])\*?(\d+)?$/i);
      if (match) {
        const code = match[1].toUpperCase();
        const count = match[2] ? parseInt(match[2], 10) : 1;
        const kind = { B: 'basic', F: 'fast', P: 'power', A: 'armor' }[code] || 'basic';
        for (let i = 0; i < count; i++) {
          list.push(kind);
        }
      }
    }
    return list;
  }

  spawnPlayer(id, kind, spawnPos) {
    const tank = {
      id,
      team: 'player',
      kind,
      x16: spawnPos.x << FP_SHIFT,
      y16: spawnPos.y << FP_SHIFT,
      dir: DIR_UP,
      desiredDir: DIR_NONE,
      moving: false,
      treadFrame: 0,
      treadCounter: 0,
      stars: 0,
      hp: 1,
      shield: SPAWN_SHIELD_FRAMES,
      frozen: 0,
      spawnFrames: SPAWN_STAR_FRAMES,
      slideFrames: 0,
      bulletsInFlight: 0,
      carrier: false,
      lives: INITIAL_RESERVES,
      score: 0,
      kills: { basic: 0, fast: 0, power: 0, armor: 0 }
    };
    this.tanks.push(tank);
    return tank;
  }

  // Pure simulation step (advances 1 frame @ 60 Hz)
  step(inputsByPlayer = {}) {
    this.events = [];
    this.tick++;

    if (this.state === 'GAME_OVER_ANIM') {
      this.stateTimer++;
      this.updateExplosions();
      if (this.stateTimer >= 200) {
        this.state = 'GAME_OVER_SCREEN';
        this.stateTimer = 0;
      }
      return this.events;
    }

    if (this.state === 'STAGE_CLEAR_WAIT') {
      this.stateTimer++;
      this.updateBullets();
      this.updateExplosions();
      if (this.stateTimer >= 190) {
        this.state = 'TALLY';
        this.stateTimer = 0;
      }
      return this.events;
    }

    // 1. Process global timers
    if (this.clockTimer > 0) this.clockTimer--;
    if (this.shovelTimer > 0) {
      this.shovelTimer--;
      if (this.shovelTimer === 0) {
        this.map.setFortressMaterial(false); // revert to full brick
        this.events.push({ e: 'shovel_off' });
      }
    }

    // 2. Spawn enemy waves
    this.updateEnemySpawning();

    // 3. Process tanks (spawning, inputs, movement)
    this.updateTanks(inputsByPlayer);

    // 4. Process bullets (movement, collision with sub-stepping)
    this.updateBullets();

    // 5. Check powerup pickup
    this.checkPowerupPickup();

    // 6. Update explosions
    this.updateExplosions();

    // 7. Check win condition (File 08 §3)
    if (this.state === 'PLAYING') {
      const aliveEnemies = this.tanks.filter(t => t.team === 'enemy').length;
      if (this.enemyQueue.length === 0 && aliveEnemies === 0 && this.totalEnemiesSpawned >= ENEMIES_PER_STAGE) {
        this.state = 'STAGE_CLEAR_WAIT';
        this.stateTimer = 0;
        this.events.push({ e: 'stage_cleared' });
      }
    }

    return this.events;
  }

  updateEnemySpawning() {
    const maxAlive = this.numPlayers === 1 ? MAX_ALIVE_1P : MAX_ALIVE_2P;
    const aliveEnemies = this.tanks.filter(t => t.team === 'enemy').length;

    if (this.enemyQueue.length > 0 && aliveEnemies < maxAlive) {
      this.spawnTimer--;
      if (this.spawnTimer <= 0) {
        // Attempt spawn at current gate
        const gate = ENEMY_SPAWN_TILES[this.spawnGateIndex];
        // Check if gate is clear of active tanks
        const gateBlocked = this.tanks.some(t => {
          const tx = t.x16 >> FP_SHIFT;
          const ty = t.y16 >> FP_SHIFT;
          return Math.abs(tx - gate.x) < 16 && Math.abs(ty - gate.y) < 16;
        });

        if (!gateBlocked) {
          const kind = this.enemyQueue.shift();
          const spawnIndex = this.totalEnemiesSpawned++;
          const isCarrier = CARRIER_INDICES.includes(spawnIndex);

          const hp = kind === 'armor' ? 4 : 1;
          const enemy = {
            id: this.nextEntityId++,
            team: 'enemy',
            kind,
            x16: gate.x << FP_SHIFT,
            y16: gate.y << FP_SHIFT,
            dir: DIR_DOWN,
            desiredDir: DIR_DOWN,
            moving: true,
            treadFrame: 0,
            treadCounter: 0,
            stars: 0,
            hp,
            shield: 0,
            frozen: 0,
            spawnFrames: SPAWN_STAR_FRAMES,
            slideFrames: 0,
            bulletsInFlight: 0,
            carrier: isCarrier,
            spawnIndex,
            aiMoveTimer: 0,
            aiBlockedTicks: 0
          };

          this.tanks.push(enemy);
          this.events.push({ e: 'spawn_enemy', id: enemy.id, kind, carrier: isCarrier });

          // Rotate gate and reset spawn delay
          this.spawnGateIndex = (this.spawnGateIndex + 1) % ENEMY_SPAWN_TILES.length;
          const delay = Math.max(
            MIN_SPAWN_DELAY,
            BASE_SPAWN_DELAY - (this.stageNum - 1) * 4 - (this.numPlayers - 1) * 20
          );
          this.spawnTimer = delay;
        }
      }
    }
  }

  updateTanks(inputsByPlayer) {
    for (const tank of this.tanks) {
      // 1. Spawning star countdown
      if (tank.spawnFrames > 0) {
        tank.spawnFrames--;
        continue;
      }

      // 2. Frozen countdown (from clock or friendly fire)
      if (tank.shield > 0) tank.shield--;
      if (tank.frozen > 0) {
        tank.frozen--;
        continue;
      }
      if (tank.team === 'enemy' && this.clockTimer > 0) {
        continue; // enemy frozen by clock powerup
      }

      // 3. Handle player input or enemy AI
      if (tank.team === 'player') {
        const input = inputsByPlayer[tank.id] || { dir: DIR_NONE, fire: false };
        this.processPlayerMovement(tank, input.dir);
        if (input.fire) {
          this.tryFireBullet(tank);
        }
      } else {
        this.processEnemyAI(tank);
      }
    }
  }

  processPlayerMovement(tank, desiredDir) {
    // If no direction held
    if (desiredDir === DIR_NONE) {
      // Check ice slide
      if (tank.slideFrames > 0) {
        tank.slideFrames--;
        this.stepTankMove(tank, tank.dir);
      } else {
        tank.moving = false;
      }
      return;
    }

    // Direction input is active
    const isHoriz = (d) => d === DIR_LEFT || d === DIR_RIGHT;
    const axisChange = (isHoriz(tank.dir) !== isHoriz(desiredDir));

    if (axisChange) {
      // Snap perpendicular coordinate to nearest multiple of 8 px
      let px = tank.x16 >> FP_SHIFT;
      let py = tank.y16 >> FP_SHIFT;

      if (isHoriz(desiredDir)) {
        // moving to horizontal: align Y to nearest 8
        py = Math.round(py / 8) * 8;
      } else {
        // moving to vertical: align X to nearest 8
        px = Math.round(px / 8) * 8;
      }

      // If snap position is valid, apply snap
      if (this.canTankOccupy(px, py, tank.id)) {
        tank.x16 = px << FP_SHIFT;
        tank.y16 = py << FP_SHIFT;
      }
    }

    tank.dir = desiredDir;
    tank.moving = true;

    // Move in direction
    const moved = this.stepTankMove(tank, desiredDir);

    // If on ice and moving stopped/released, initiate ice slide
    const curPx = tank.x16 >> FP_SHIFT;
    const curPy = tank.y16 >> FP_SHIFT;
    if (this.map.isOnIce(curPx, curPy)) {
      tank.slideFrames = ICE_SLIDE_FRAMES;
    } else {
      tank.slideFrames = 0;
    }

    // Tread animation
    if (moved) {
      tank.treadCounter++;
      if (tank.treadCounter >= 2) {
        tank.treadCounter = 0;
        tank.treadFrame = (tank.treadFrame + 1) % 2;
      }
    }
  }

  getTankSpeedUnits(tank) {
    if (tank.team === 'player') return FP_SPEED_PLAYER; // 12 units = 0.75 px
    if (tank.kind === 'fast') return FP_SPEED_FAST;     // 16 units = 1.0 px
    if (tank.kind === 'power') return FP_SPEED_POWER;   // 8 units = 0.5 px
    if (tank.kind === 'armor') return FP_SPEED_ARMOR;   // 8 units = 0.5 px
    return FP_SPEED_BASIC;                              // 8 units = 0.5 px
  }

  stepTankMove(tank, dir) {
    const speed = this.getTankSpeedUnits(tank);
    const offset = DIR_OFFSETS[dir];

    const targetX16 = tank.x16 + offset.dx * speed;
    const targetY16 = tank.y16 + offset.dy * speed;

    const targetPx = targetX16 >> FP_SHIFT;
    const targetPy = targetY16 >> FP_SHIFT;

    if (this.canTankOccupy(targetPx, targetPy, tank.id)) {
      tank.x16 = targetX16;
      tank.y16 = targetY16;
      return true;
    }
    return false;
  }

  canTankOccupy(px, py, ignoreTankId) {
    // 1. Terrain & Eagle collision
    if (!this.map.canOccupy(px, py)) return false;

    // 2. Tank vs Tank collision
    for (const other of this.tanks) {
      if (other.id === ignoreTankId || other.spawnFrames > 0) continue;
      const ox = other.x16 >> FP_SHIFT;
      const oy = other.y16 >> FP_SHIFT;
      // Overlap of two 16x16 boxes
      if (px < ox + 16 && px + 16 > ox && py < oy + 16 && py + 16 > oy) {
        return false;
      }
    }
    return true;
  }

  processEnemyAI(tank) {
    tank.age = (tank.age || 0) + 1;

    // Movement state machine
    if (tank.aiMoveTimer <= 0 || tank.aiBlockedTicks > 8) {
      this.pickEnemyDirection(tank);
      const minTimer = tank.kind === 'fast' ? 20 : 30;
      const maxTimer = tank.kind === 'fast' ? 80 : 120;
      tank.aiMoveTimer = this.rng.range(minTimer, maxTimer);
      tank.aiBlockedTicks = 0;
    }
    tank.aiMoveTimer--;

    const moved = this.stepTankMove(tank, tank.dir);
    if (!moved) {
      tank.aiBlockedTicks++;
      if (tank.aiBlockedTicks > 8) {
        this.pickEnemyDirection(tank);
        tank.aiBlockedTicks = 0;
        tank.aiMoveTimer = this.rng.range(20, 60);
      }
    } else {
      tank.aiBlockedTicks = 0;
      tank.treadCounter++;
      if (tank.treadCounter >= 2) {
        tank.treadCounter = 0;
        tank.treadFrame = (tank.treadFrame + 1) % 2;
      }
    }

    // Firing heuristics (File 06 §4.2)
    if (tank.bulletsInFlight < 1) {
      let p = tank.kind === 'armor' ? 0.008 : 0.012;
      const tx = tank.x16 >> FP_SHIFT;
      const ty = tank.y16 >> FP_SHIFT;

      // 1. Facing wall (within 1 tile / 16 px)
      const offset = DIR_OFFSETS[tank.dir];
      const checkX = tx + offset.dx * 16;
      const checkY = ty + offset.dy * 16;
      if (!this.map.canOccupy(checkX, checkY)) {
        p = 0.12;
      }

      // 2. Aligned with Eagle
      if (this.map.eagle.alive) {
        const ex = this.map.eagle.x;
        const ey = this.map.eagle.y;
        if (tank.dir === DIR_DOWN && Math.abs(tx - ex) < 12 && ty < ey) {
          p = 0.30;
        } else if (tank.dir === DIR_LEFT && Math.abs(ty - ey) < 12 && tx > ex) {
          p = 0.30;
        } else if (tank.dir === DIR_RIGHT && Math.abs(ty - ey) < 12 && tx < ex) {
          p = 0.30;
        }
      }

      // 3. Aligned with player
      for (const player of this.tanks) {
        if (player.team !== 'player' || player.spawnFrames > 0) continue;
        const px = player.x16 >> FP_SHIFT;
        const py = player.y16 >> FP_SHIFT;
        if (tank.dir === DIR_DOWN && Math.abs(tx - px) < 12 && ty < py) p = Math.max(p, 0.20);
        else if (tank.dir === DIR_UP && Math.abs(tx - px) < 12 && ty > py) p = Math.max(p, 0.20);
        else if (tank.dir === DIR_LEFT && Math.abs(ty - py) < 12 && tx > px) p = Math.max(p, 0.20);
        else if (tank.dir === DIR_RIGHT && Math.abs(ty - py) < 12 && tx < px) p = Math.max(p, 0.20);
      }

      if (this.rng.next() < p) {
        this.tryFireBullet(tank);
      }
    }
  }

  pickEnemyDirection(tank) {
    const tx = tank.x16 >> FP_SHIFT;
    const ty = tank.y16 >> FP_SHIFT;

    const weights = [10, 10, 40, 10]; // [UP, RIGHT, DOWN, LEFT]
    // Over time (>= 300 frames / 5s), raise DOWN weight to heighten base pressure
    if ((tank.age || 0) >= 300) {
      weights[DIR_DOWN] += 15;
    }

    // Bias toward Eagle horizontally
    if (this.map.eagle.x < tx) {
      weights[DIR_LEFT] += 25;
    } else if (this.map.eagle.x > tx) {
      weights[DIR_RIGHT] += 25;
    }

    // Filter out directions immediately blocked by steel or boundary
    for (let d = 0; d < 4; d++) {
      const off = DIR_OFFSETS[d];
      const testX = tx + off.dx * 8;
      const testY = ty + off.dy * 8;
      if (testX < 0 || testX + 16 > 208 || testY < 0 || testY + 16 > 208) {
        weights[d] = 0;
      }
    }

    // Weighted random selection
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let chosenDir = DIR_DOWN;
    if (totalWeight > 0) {
      let roll = this.rng.next() * totalWeight;
      for (let d = 0; d < 4; d++) {
        roll -= weights[d];
        if (roll <= 0) {
          chosenDir = d;
          break;
        }
      }
    }

    // Grid snap on axis change
    const isHoriz = (d) => d === DIR_LEFT || d === DIR_RIGHT;
    if (isHoriz(tank.dir) !== isHoriz(chosenDir)) {
      let px = tx;
      let py = ty;
      if (isHoriz(chosenDir)) py = Math.round(py / 8) * 8;
      else px = Math.round(px / 8) * 8;

      if (this.canTankOccupy(px, py, tank.id)) {
        tank.x16 = px << FP_SHIFT;
        tank.y16 = py << FP_SHIFT;
      }
    }

    tank.dir = chosenDir;
  }

  tryFireBullet(tank) {
    const maxBullets = tank.team === 'player'
      ? (tank.stars >= 2 ? BULLETS_MAX_PLAYER_UPGRADED : BULLETS_MAX_PLAYER_DEFAULT)
      : BULLETS_MAX_ENEMY;

    if (tank.bulletsInFlight >= maxBullets) return false;

    const tankPx = tank.x16 >> FP_SHIFT;
    const tankPy = tank.y16 >> FP_SHIFT;

    // Muzzle position at leading edge
    let bx = tankPx + 6;
    let by = tankPy + 6;
    if (tank.dir === DIR_UP) { by = tankPy - 4; bx = tankPx + 6; }
    else if (tank.dir === DIR_RIGHT) { bx = tankPx + 16; by = tankPy + 6; }
    else if (tank.dir === DIR_DOWN) { by = tankPy + 16; bx = tankPx + 6; }
    else if (tank.dir === DIR_LEFT) { bx = tankPx - 4; by = tankPy + 6; }

    const isFast = (tank.team === 'player' && tank.stars >= 1) || (tank.team === 'enemy' && tank.kind === 'power');
    const speed = isFast ? 6 : 3;
    const fpSpeed = isFast ? FP_BULLET_SPEED_FAST : FP_BULLET_SPEED_SLOW;
    const strong = tank.team === 'player' && tank.stars >= 3;

    const bullet = {
      id: this.nextEntityId++,
      ownerId: tank.id,
      team: tank.team,
      dir: tank.dir,
      speed,
      fpSpeed,
      strong,
      x16: bx << FP_SHIFT,
      y16: by << FP_SHIFT,
      alive: true
    };

    tank.bulletsInFlight++;
    this.bullets.push(bullet);
    this.events.push({ e: 'bullet_fired', by: tank.id, bx, by, dir: tank.dir });
    return true;
  }

  updateBullets() {
    // 1-px sub-stepping up to max bullet speed
    const maxSpeed = 6;
    for (let step = 0; step < maxSpeed; step++) {
      for (const bullet of this.bullets) {
        if (!bullet.alive) continue;
        if (step >= bullet.speed) continue; // 3 px/f bullets move only on first 3 steps

        const offset = DIR_OFFSETS[bullet.dir];
        bullet.x16 += offset.dx * FP_ONE;
        bullet.y16 += offset.dy * FP_ONE;

        const bx = bullet.x16 >> FP_SHIFT;
        const by = bullet.y16 >> FP_SHIFT;

        // Collision 1: Map bounds
        if (bx < 0 || bx + 4 > 208 || by < 0 || by + 4 > 208) {
          bullet.alive = false;
          this.spawnExplosion(bx + 2, by + 2, false);
          this.events.push({ e: 'hit_steel', x: bx, y: by });
          continue;
        }

        // Collision 2: Eagle
        if (this.map.eagle.alive) {
          if (bx < this.map.eagle.x + 16 && bx + 4 > this.map.eagle.x &&
              by < this.map.eagle.y + 16 && by + 4 > this.map.eagle.y) {
            bullet.alive = false;
            this.map.eagle.alive = false;
            this.state = 'GAME_OVER_ANIM';
            this.stateTimer = 0;
            this.spawnExplosion(this.map.eagle.x + 8, this.map.eagle.y + 8, true);
            this.events.push({ e: 'eagle_destroyed' });
            this.events.push({ e: 'game_over' });
            continue;
          }
        }

        // Collision 3: Terrain (Brick & Steel)
        const hitTerrain = this.testBulletTerrain(bullet, bx, by);
        if (hitTerrain) {
          bullet.alive = false;
          continue;
        }

        // Collision 4: Bullet vs Bullet
        for (const other of this.bullets) {
          if (other.id === bullet.id || !other.alive) continue;
          if (bullet.team !== other.team) { // Player vs Enemy bullet cancel
            const obx = other.x16 >> FP_SHIFT;
            const oby = other.y16 >> FP_SHIFT;
            if (bx < obx + 4 && bx + 4 > obx && by < oby + 4 && by + 4 > oby) {
              bullet.alive = false;
              other.alive = false;
              this.spawnExplosion(bx + 2, by + 2, false);
              this.events.push({ e: 'bullet_cancelled' });
              break;
            }
          }
        }
        if (!bullet.alive) continue;

        // Collision 5: Bullet vs Tank
        for (const target of this.tanks) {
          if (target.spawnFrames > 0) continue;
          const tx = target.x16 >> FP_SHIFT;
          const ty = target.y16 >> FP_SHIFT;

          if (bx < tx + 16 && bx + 4 > tx && by < ty + 16 && by + 4 > ty) {
            // Friendly fire: Player vs Player
            if (bullet.team === 'player' && target.team === 'player') {
              if (bullet.ownerId !== target.id) {
                bullet.alive = false;
                if (target.shield === 0) {
                  target.frozen = FRIENDLY_FREEZE_FRAMES;
                  this.events.push({ e: 'player_frozen', id: target.id });
                }
              }
              continue;
            }

            // Enemy vs Enemy: ignore
            if (bullet.team === 'enemy' && target.team === 'enemy') {
              continue;
            }

            // Enemy hits Player
            if (bullet.team === 'enemy' && target.team === 'player') {
              bullet.alive = false;
              if (target.shield > 0) continue; // shielded: bullet disappears
              this.destroyTank(target, null);
              break;
            }

            // Player hits Enemy
            if (bullet.team === 'player' && target.team === 'enemy') {
              bullet.alive = false;
              const shooter = this.tanks.find(t => t.id === bullet.ownerId);

              // Carrier drop
              if (target.carrier) {
                target.carrier = false;
                this.spawnPowerup();
              }

              target.hp--;
              if (target.hp <= 0) {
                this.destroyTank(target, shooter);
              }
              break;
            }
          }
        }
      }
    }

    // Cleanup dead bullets
    for (const b of this.bullets) {
      if (!b.alive) {
        const owner = this.tanks.find(t => t.id === b.ownerId);
        if (owner && owner.bulletsInFlight > 0) {
          owner.bulletsInFlight--;
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive);
  }

  testBulletTerrain(bullet, bx, by) {
    // Lateral cells touched by the bullet
    let cx1, cx2, cy1, cy2;
    if (bullet.dir === DIR_UP || bullet.dir === DIR_DOWN) {
      cx1 = Math.max(0, Math.floor((bx - 1) / 8));
      cx2 = Math.min(25, Math.floor((bx + 3) / 8));
      const frontY = bullet.dir === DIR_UP ? by : by + 3;
      cy1 = cy2 = Math.max(0, Math.min(25, Math.floor(frontY / 8)));
    } else {
      cy1 = Math.max(0, Math.floor((by - 1) / 8));
      cy2 = Math.min(25, Math.floor((by + 3) / 8));
      const frontX = bullet.dir === DIR_LEFT ? bx : bx + 3;
      cx1 = cx2 = Math.max(0, Math.min(25, Math.floor(frontX / 8)));
    }

    let hit = false;
    for (let cy = cy1; cy <= cy2; cy++) {
      for (let cx = cx1; cx <= cx2; cx++) {
        const idx = cy * 26 + cx;
        const type = this.map.cellType[idx];

        if (type === 2) { // Steel
          hit = true;
          if (bullet.strong) {
            this.map.removeSteelCell(cx, cy);
            this.events.push({ e: 'steel_removed', cx, cy });
          } else {
            this.events.push({ e: 'hit_steel', cx, cy });
          }
        } else if (type === 1) { // Brick
          const brickHit = this.map.hitBrickCell(cx, cy, bullet.dir, bullet.strong);
          if (brickHit) {
            hit = true;
            this.events.push({ e: 'brick_hit', cx, cy, bits: this.map.brickBits[idx] });
          }
        }
      }
    }

    if (hit) {
      this.spawnExplosion(bx + 2, by + 2, false);
    }
    return hit;
  }

  destroyTank(target, killer) {
    target.hp = 0;
    this.spawnExplosion((target.x16 >> FP_SHIFT) + 8, (target.y16 >> FP_SHIFT) + 8, true);
    this.events.push({ e: 'tank_destroyed', id: target.id, team: target.team, kind: target.kind });

    if (target.team === 'enemy') {
      const scoreMap = { basic: SCORE_BASIC, fast: SCORE_FAST, power: SCORE_POWER, armor: SCORE_ARMOR };
      const pts = scoreMap[target.kind] || 100;
      if (killer) {
        killer.score += pts;
        killer.kills[target.kind] = (killer.kills[target.kind] || 0) + 1;
        // Extra life every 20,000 points
        if (Math.floor((killer.score - pts) / EXTRA_LIFE_INTERVAL) < Math.floor(killer.score / EXTRA_LIFE_INTERVAL)) {
          killer.lives = Math.min(9, killer.lives + 1);
          this.events.push({ e: 'extra_life', playerId: killer.id });
        }
      }
      this.tanks = this.tanks.filter(t => t.id !== target.id);
    } else {
      // Player destroyed
      target.stars = 0; // reset stars on death
      if (target.lives > 0) {
        target.lives--;
        // Respawn player
        const spawnPos = target.id === 1 ? P1_SPAWN_POS : P2_SPAWN_POS;
        target.x16 = spawnPos.x << FP_SHIFT;
        target.y16 = spawnPos.y << FP_SHIFT;
        target.dir = DIR_UP;
        target.hp = 1;
        target.spawnFrames = SPAWN_STAR_FRAMES;
        target.shield = SPAWN_SHIELD_FRAMES;
        target.bulletsInFlight = 0;
      } else {
        // Player eliminated
        this.tanks = this.tanks.filter(t => t.id !== target.id);
        const playersRemaining = this.tanks.filter(t => t.team === 'player').length;
        if (playersRemaining === 0) {
          this.state = 'GAME_OVER_ANIM';
          this.stateTimer = 0;
          this.events.push({ e: 'game_over' });
        }
      }
    }
  }

  spawnPowerup() {
    const type = POWERUP_TYPES[this.rng.range(0, POWERUP_TYPES.length - 1)];
    // Deterministic random tile placement
    const tx = this.rng.range(1, 11);
    const ty = this.rng.range(1, 10);
    this.item = { type, x: tx * 16, y: ty * 16, alive: true };
    this.events.push({ e: 'powerup_spawned', type, x: this.item.x, y: this.item.y });
  }

  checkPowerupPickup() {
    if (!this.item) return;

    for (const player of this.tanks) {
      if (player.team !== 'player' || player.spawnFrames > 0) continue;
      const px = player.x16 >> FP_SHIFT;
      const py = player.y16 >> FP_SHIFT;

      if (px < this.item.x + 16 && px + 16 > this.item.x &&
          py < this.item.y + 16 && py + 16 > this.item.y) {
        this.applyPowerup(player, this.item.type);
        this.item = null;
        break;
      }
    }
  }

  applyPowerup(player, type) {
    const oldScore = player.score;
    player.score += SCORE_PICKUP;
    if (Math.floor(oldScore / EXTRA_LIFE_INTERVAL) < Math.floor(player.score / EXTRA_LIFE_INTERVAL)) {
      player.lives = Math.min(9, player.lives + 1);
      this.events.push({ e: 'extra_life', playerId: player.id });
    }
    this.events.push({ e: 'powerup_picked', type, playerId: player.id });

    switch (type) {
      case 'star':
        player.stars = Math.min(3, player.stars + 1);
        break;
      case 'helmet':
        player.shield = HELMET_SHIELD_FRAMES;
        break;
      case 'clock':
        this.clockTimer = CLOCK_FREEZE_FRAMES;
        break;
      case 'shovel':
        this.shovelTimer = SHOVEL_FRAMES;
        this.map.setFortressMaterial(true); // reinforce fortress with steel
        break;
      case 'grenade':
        // Kill all active on-field enemies
        const enemiesToKill = this.tanks.filter(t => t.team === 'enemy' && t.spawnFrames === 0);
        for (const enemy of enemiesToKill) {
          this.destroyTank(enemy, player);
        }
        break;
      case 'tank':
        player.lives = Math.min(9, player.lives + 1);
        break;
    }
  }

  spawnExplosion(x, y, big = false) {
    this.explosions.push({
      id: this.nextEntityId++,
      x,
      y,
      big,
      frame: 0,
      timer: 0,
      maxFrames: 3,
      ticksPerFrame: big ? 6 : 3
    });
  }

  updateExplosions() {
    for (const exp of this.explosions) {
      exp.timer++;
      if (exp.timer >= exp.ticksPerFrame) {
        exp.timer = 0;
        exp.frame++;
      }
    }
    this.explosions = this.explosions.filter(exp => exp.frame < exp.maxFrames);
  }

  // Create serializable state snapshot
  snapshot() {
    return {
      tick: this.tick,
      tanks: this.tanks.map(t => ({
        id: t.id,
        team: t.team,
        kind: t.kind,
        x: t.x16 >> FP_SHIFT,
        y: t.y16 >> FP_SHIFT,
        dir: t.dir,
        moving: t.moving ? 1 : 0,
        treadFrame: t.treadFrame,
        stars: t.stars,
        shield: t.shield,
        frozen: t.frozen,
        spawnFrames: t.spawnFrames,
        hp: t.hp,
        carrier: t.carrier ? 1 : 0
      })),
      bullets: this.bullets.map(b => ({
        id: b.id,
        x: b.x16 >> FP_SHIFT,
        y: b.y16 >> FP_SHIFT,
        dir: b.dir
      })),
      explosions: this.explosions.map(e => ({
        x: e.x,
        y: e.y,
        big: e.big ? 1 : 0,
        frame: e.frame
      })),
      item: this.item ? { type: this.item.type, x: this.item.x, y: this.item.y } : null,
      eagle: this.map.eagle.alive ? 1 : 0,
      clock: this.clockTimer,
      shovel: this.shovelTimer,
      hud: {
        enemiesLeft: this.enemyQueue.length + this.tanks.filter(t => t.team === 'enemy').length,
        lives: this.tanks.filter(t => t.team === 'player').map(p => p.lives),
        scores: this.tanks.filter(t => t.team === 'player').map(p => p.score)
      },
      state: this.state,
      stateTimer: this.stateTimer,
      events: [...this.events]
    };
  }

  // Fast 32-bit state hash for determinism verification
  hashState() {
    let hash = (this.tick * 31) >>> 0;
    hash = (hash ^ (this.map.eagle.alive ? 1 : 0)) >>> 0;

    for (const t of this.tanks) {
      hash = (hash * 33 + t.id) >>> 0;
      hash = (hash * 33 + t.x16) >>> 0;
      hash = (hash * 33 + t.y16) >>> 0;
      hash = (hash * 33 + t.dir) >>> 0;
      hash = (hash * 33 + t.hp) >>> 0;
      hash = (hash * 33 + t.shield) >>> 0;
    }

    for (const b of this.bullets) {
      hash = (hash * 33 + b.x16) >>> 0;
      hash = (hash * 33 + b.y16) >>> 0;
    }

    for (let i = 0; i < this.map.brickBits.length; i += 4) {
      hash = (hash * 33 + this.map.brickBits[i]) >>> 0;
    }

    return hash.toString(16);
  }
}
