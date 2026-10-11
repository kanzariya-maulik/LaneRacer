// Projectile & Explosive Bomb Engine for Battle Tanks LAN

class ProjectileEngine {
    constructor() {
        this.shells = [];
        this.bombs = [];
        this.nextShellId = 1;
        this.nextBombId = 1;
    }

    spawnShell(tank) {
        const SPEED = 6.0; // px per tick
        let vx = 0, vy = 0, sx = tank.x, sy = tank.y;
        if (tank.dir === 'UP')    { vy = -SPEED; sy -= 18; }
        if (tank.dir === 'DOWN')  { vy =  SPEED; sy += 18; }
        if (tank.dir === 'LEFT')  { vx = -SPEED; sx -= 18; }
        if (tank.dir === 'RIGHT') { vx =  SPEED; sx += 18; }

        const shell = {
            id: this.nextShellId++,
            ownerId: tank.id,
            teamId: tank.teamId,
            x: sx,
            y: sy,
            vx,
            vy,
            dir: tank.dir,
            canPierceSteel: tank.tier >= 4
        };

        this.shells.push(shell);
        return shell;
    }

    // Thrown explosive bomb (Triggered with ENTER key)
    spawnBomb(tank) {
        const BOMB_SPEED = 4.2;
        let vx = 0, vy = 0, bx = tank.x, by = tank.y;
        if (tank.dir === 'UP')    { vy = -BOMB_SPEED; by -= 20; }
        if (tank.dir === 'DOWN')  { vy =  BOMB_SPEED; by += 20; }
        if (tank.dir === 'LEFT')  { vx = -BOMB_SPEED; bx -= 20; }
        if (tank.dir === 'RIGHT') { vx =  BOMB_SPEED; bx += 20; }

        const bomb = {
            id: this.nextBombId++,
            ownerId: tank.id,
            teamId: tank.teamId,
            x: bx,
            y: by,
            vx,
            vy,
            dir: tank.dir,
            lifetime: 28, // ~0.46s fuse flight time before automatic detonation
            radius: 54,   // Area of effect blast radius
            detonated: false
        };

        this.bombs.push(bomb);
        return bomb;
    }

    update(mapManager, tanks, onEvent, settings = {}) {
        const removedShellIds = new Set();
        const removedBombIds = new Set();
        const gridDiffs = [];

        // 1. Update Bombs (Movement & Detonation)
        for (const b of this.bombs) {
            b.x += b.vx;
            b.y += b.vy;
            b.lifetime--;

            // Check if bomb struck a solid wall or ran out of fuse
            const tile = mapManager.getTileAtWorld(b.x, b.y);
            const hitSolid = (tile === 1 || tile === 2 || tile === 9 || tile === 10);
            const outOfBounds = (b.x < 0 || b.x > mapManager.width || b.y < 0 || b.y > mapManager.height);

            if (b.lifetime <= 0 || hitSolid || outOfBounds) {
                b.detonated = true;
                removedBombIds.add(b.id);

                // Heavy AOE Blast!
                const blastResult = mapManager.damageArea(b.x, b.y, b.radius, true);
                if (blastResult.diffs.length > 0) {
                    gridDiffs.push(...blastResult.diffs);
                }

                onEvent({
                    type: 'BOMB_BLAST',
                    x: b.x,
                    y: b.y,
                    radius: b.radius,
                    ownerId: b.ownerId
                });

                if (blastResult.baseDestroyed) {
                    onEvent({
                        type: 'BASE_DESTROYED',
                        teamId: blastResult.baseDestroyed,
                        killerId: b.ownerId
                    });
                }

                // Check tanks caught in bomb blast radius
                for (const t of Object.values(tanks)) {
                    if (!t.alive) continue;
                    // Check team friendly fire
                    if (!settings.friendlyFire && t.teamId === b.teamId && t.id !== b.ownerId) {
                        continue;
                    }

                    const dist = Math.hypot(t.x - b.x, t.y - b.y);
                    if (dist <= b.radius + 14) {
                        if (t.shieldUntil && t.shieldUntil > Date.now()) {
                            // Shield absorbs the bomb blast!
                            t.shieldUntil = 0; // Shield breaks
                            onEvent({ type: 'SHIELD_BREAK', tankId: t.id });
                        } else {
                            t.lives -= 2; // Bomb deals heavy 2-life damage
                            const killed = t.lives <= 0;
                            if (killed) t.alive = false;
                            onEvent({
                                type: 'TANK_HIT',
                                tankId: t.id,
                                killed,
                                killerId: b.ownerId,
                                isBomb: true
                            });
                        }
                    }
                }
            }
        }

        // 2. Update Standard Shells (Movement & Wall Hit)
        for (let i = 0; i < this.shells.length; i++) {
            const s = this.shells[i];
            s.x += s.vx;
            s.y += s.vy;

            // Arena boundary check
            if (s.x < 0 || s.x > mapManager.width || s.y < 0 || s.y > mapManager.height) {
                removedShellIds.add(s.id);
                onEvent({ type: 'EXPLOSION', x: s.x, y: s.y, small: true });
                continue;
            }

            const hitResult = mapManager.damageAt(s.x, s.y, s.dir, s.canPierceSteel);
            if (hitResult.hit) {
                removedShellIds.add(s.id);
                if (hitResult.diff) {
                    gridDiffs.push(hitResult.diff);
                }
                onEvent({ type: 'EXPLOSION', x: s.x, y: s.y, small: !hitResult.destroyed });
                if (hitResult.baseDestroyed) {
                    onEvent({
                        type: 'BASE_DESTROYED',
                        teamId: hitResult.baseDestroyed,
                        killerId: s.ownerId
                    });
                }
            }
        }

        // 3. Shell vs. Shell Mid-Air Collisions (Cancel each other out!)
        for (let i = 0; i < this.shells.length; i++) {
            for (let j = i + 1; j < this.shells.length; j++) {
                const a = this.shells[i];
                const b = this.shells[j];
                if (removedShellIds.has(a.id) || removedShellIds.has(b.id)) continue;

                if (Math.hypot(a.x - b.x, a.y - b.y) < 14) {
                    removedShellIds.add(a.id);
                    removedShellIds.add(b.id);
                    onEvent({
                        type: 'MID_AIR_COLLISION',
                        x: (a.x + b.x) / 2,
                        y: (a.y + b.y) / 2
                    });
                }
            }
        }

        // 4. Shell vs. Bomb Mid-Air Collisions (Shell detonates bomb early)
        for (const s of this.shells) {
            if (removedShellIds.has(s.id)) continue;
            for (const b of this.bombs) {
                if (removedBombIds.has(b.id)) continue;
                if (Math.hypot(s.x - b.x, s.y - b.y) < 18) {
                    removedShellIds.add(s.id);
                    b.lifetime = 0; // Forces detonation on next check
                }
            }
        }

        // 5. Shell vs. Tank Collisions
        for (const s of this.shells) {
            if (removedShellIds.has(s.id)) continue;
            for (const t of Object.values(tanks)) {
                if (!t.alive || t.id === s.ownerId) continue;
                // Team check (unless friendly fire enabled or FFA)
                if (!settings.friendlyFire && t.teamId && t.teamId === s.teamId && t.teamId !== 'ffa') {
                    continue;
                }

                if (Math.abs(s.x - t.x) < 15 && Math.abs(s.y - t.y) < 15) {
                    removedShellIds.add(s.id);
                    if (t.shieldUntil && t.shieldUntil > Date.now()) {
                        // Shield absorbs hit
                        onEvent({ type: 'SHIELD_ABSORB', tankId: t.id });
                    } else {
                        t.lives--;
                        const killed = t.lives <= 0;
                        if (killed) t.alive = false;
                        onEvent({
                            type: 'TANK_HIT',
                            tankId: t.id,
                            killed,
                            killerId: s.ownerId
                        });
                    }
                    break;
                }
            }
        }

        // Cleanup removed projectiles
        this.shells = this.shells.filter(s => !removedShellIds.has(s.id));
        this.bombs = this.bombs.filter(b => !removedBombIds.has(b.id));

        return { gridDiffs };
    }

    clear() {
        this.shells = [];
        this.bombs = [];
    }
}

module.exports = ProjectileEngine;
