// High-Resolution 2D Canvas Game Renderer for Battle Tanks LAN
// Features sub-tile brick degradation, steel textures, animated water, foliage concealment, and particle effects

export class GameRenderer {
    constructor(canvas, radarCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.radarCanvas = radarCanvas;
        this.radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;

        this.tileSize = 32;
        this.subSize = 16;
        this.cols = 26;
        this.rows = 26;
        this.width = 832;
        this.height = 832;

        this.mapData = null;
        this.particles = [];
        this.floatingTexts = [];
        this.screenShake = 0;
        this.animTime = 0;
    }

    setMapData(mapData) {
        this.mapData = {
            cols: mapData.cols,
            rows: mapData.rows,
            tileSize: mapData.tileSize,
            grid: new Uint8Array(mapData.grid),
            brickMasks: new Uint8Array(mapData.brickMasks),
            eagles: mapData.eagles || []
        };
    }

    applyGridDiffs(diffs) {
        if (!this.mapData || !diffs) return;
        for (const diff of diffs) {
            if (diff.idx !== undefined) {
                if (diff.type !== undefined) this.mapData.grid[diff.idx] = diff.type;
                if (diff.mask !== undefined) this.mapData.brickMasks[diff.idx] = diff.mask;
            }
        }
    }

    addExplosion(x, y, isBig = false, isBomb = false) {
        const count = isBomb ? 35 : (isBig ? 20 : 10);
        const radius = isBomb ? 54 : (isBig ? 28 : 14);

        if (isBomb) {
            this.screenShake = Math.max(this.screenShake, 14);
        } else if (isBig) {
            this.screenShake = Math.max(this.screenShake, 6);
        }

        // Blast ring
        this.particles.push({
            type: 'ring',
            x,
            y,
            radius: 4,
            maxRadius: radius,
            color: isBomb ? '#ff5500' : '#ffaa00',
            alpha: 1.0,
            life: 1.0,
            decay: isBomb ? 0.035 : 0.06
        });

        // Sparks & debris
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * (isBomb ? 6.5 : 4.0);
            this.particles.push({
                type: 'spark',
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * (isBomb ? 4 : 2.5),
                color: ['#ff3300', '#ff9900', '#ffea00', '#ffffff'][Math.floor(Math.random() * 4)],
                alpha: 1.0,
                life: 1.0,
                decay: 0.04 + Math.random() * 0.04
            });
        }
    }

    addFloatingText(text, x, y, color = '#ffea00') {
        this.floatingTexts.push({
            text,
            x,
            y,
            color,
            alpha: 1.0,
            vy: -1.2,
            life: 1.0,
            decay: 0.02
        });
    }

    render(snapshot, localPlayerId, predictedPos = null) {
        this.animTime += 0.016;
        const ctx = this.ctx;
        ctx.save();

        // Screen Shake
        if (this.screenShake > 0) {
            const shakeX = (Math.random() - 0.5) * this.screenShake;
            const shakeY = (Math.random() - 0.5) * this.screenShake;
            ctx.translate(shakeX, shakeY);
            this.screenShake *= 0.88;
            if (this.screenShake < 0.2) this.screenShake = 0;
        }

        // 1. Clear Arena Ground
        ctx.fillStyle = '#0f141c';
        ctx.fillRect(0, 0, this.width, this.height);

        // Ground grid pattern
        ctx.strokeStyle = '#161e2a';
        ctx.lineWidth = 1;
        for (let x = 0; x <= this.width; x += this.tileSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.height);
            ctx.stroke();
        }
        for (let y = 0; y <= this.height; y += this.tileSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.width, y);
            ctx.stroke();
        }

        // 2. Render Terrain (Base layers: Water, Ice, Bricks, Steel, Eagle)
        this.renderTerrain(ctx);

        // 3. Render Powerups
        if (snapshot && snapshot.powerups) {
            this.renderPowerups(ctx, snapshot.powerups);
        }

        // 4. Render Projectiles (Shells & Bombs)
        if (snapshot) {
            this.renderBombs(ctx, snapshot.bombs || []);
            this.renderShells(ctx, snapshot.shells || []);
        }

        // 5. Render Tanks
        if (snapshot && snapshot.tanks) {
            this.renderTanks(ctx, snapshot.tanks, localPlayerId, predictedPos);
        }

        // 6. Render Foliage Canopy Layer (renders on top of tanks for concealment)
        this.renderFoliageLayer(ctx, localPlayerId, snapshot ? snapshot.tanks : []);

        // 7. Render Particles & Floating Combat Texts
        this.renderParticles(ctx);

        ctx.restore();

        // 8. Render Tactical Radar Minimap
        if (this.radarCtx && snapshot) {
            this.renderRadar(snapshot, localPlayerId);
        }
    }

    renderTerrain(ctx) {
        if (!this.mapData) return;
        const { cols, rows, tileSize, subSize, grid, brickMasks } = this.mapData;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const type = grid[idx];
                const x = c * tileSize;
                const y = r * tileSize;

                if (type === 0) continue; // Empty

                // 3: Water (Animated Waves)
                if (type === 3) {
                    ctx.fillStyle = '#115599';
                    ctx.fillRect(x, y, tileSize, tileSize);

                    // Wave ripple lines
                    ctx.strokeStyle = '#2288dd';
                    ctx.lineWidth = 1.5;
                    const waveOff = Math.sin(this.animTime * 4 + c * 0.5 + r * 0.5) * 3;
                    ctx.beginPath();
                    ctx.moveTo(x + 2, y + 10 + waveOff);
                    ctx.lineTo(x + tileSize - 2, y + 10 + waveOff);
                    ctx.moveTo(x + 2, y + 22 - waveOff);
                    ctx.lineTo(x + tileSize - 2, y + 22 - waveOff);
                    ctx.stroke();
                    continue;
                }

                // 5: Ice Track (Slick reflections)
                if (type === 5) {
                    ctx.fillStyle = '#88ccee';
                    ctx.fillRect(x, y, tileSize, tileSize);
                    ctx.fillStyle = '#bbf0ff';
                    ctx.fillRect(x + 2, y + 2, tileSize - 4, 3);
                    ctx.fillStyle = '#66aacc';
                    ctx.fillRect(x + 2, y + tileSize - 5, tileSize - 4, 3);
                    continue;
                }

                // 2: Steel Block (Indestructible metallic plate with rivets)
                if (type === 2) {
                    const grad = ctx.createLinearGradient(x, y, x + tileSize, y + tileSize);
                    grad.addColorStop(0, '#e0e6ed');
                    grad.addColorStop(0.5, '#99a6b5');
                    grad.addColorStop(1, '#505d6e');
                    ctx.fillStyle = grad;
                    ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

                    // Inner border
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 3, y + 3, tileSize - 6, tileSize - 6);

                    // Corner rivets
                    ctx.fillStyle = '#222d3d';
                    ctx.fillRect(x + 4, y + 4, 2, 2);
                    ctx.fillRect(x + tileSize - 6, y + 4, 2, 2);
                    ctx.fillRect(x + 4, y + tileSize - 6, 2, 2);
                    ctx.fillRect(x + tileSize - 6, y + tileSize - 6, 2, 2);
                    continue;
                }

                // 1: Destructible Brick Wall (Rendered in 4 individual 16x16 sub-quadrants)
                if (type === 1) {
                    const mask = brickMasks[idx];
                    for (let subR = 0; subR < 2; subR++) {
                        for (let subC = 0; subC < 2; subC++) {
                            const bit = 1 << (subR * 2 + subC);
                            if (mask & bit) {
                                const qX = x + subC * subSize;
                                const qY = y + subR * subSize;

                                // Sub-tile brick texture
                                ctx.fillStyle = '#c84418'; // Brick terracotta
                                ctx.fillRect(qX, qY, subSize, subSize);

                                // Mortar crevices
                                ctx.fillStyle = '#e87744';
                                ctx.fillRect(qX + 1, qY + 1, subSize - 2, 3);
                                ctx.fillRect(qX + 1, qY + 9, subSize - 2, 3);

                                ctx.fillStyle = '#5a1d08'; // Dark shadow
                                ctx.fillRect(qX, qY + 7, subSize, 1.5);
                                ctx.fillRect(qX, qY + 15, subSize, 1.5);
                                ctx.fillRect(qX + 7, qY, 1.5, 7);
                            }
                        }
                    }
                    continue;
                }

                // 9: Eagle HQ (Royal Golden Phoenix/Eagle Monument)
                if (type === 9) {
                    ctx.fillStyle = '#2b1d0c';
                    ctx.fillRect(x, y, tileSize, tileSize);

                    // Golden Pedestal
                    ctx.fillStyle = '#d4af37';
                    ctx.fillRect(x + 4, y + 18, tileSize - 8, 10);

                    // Glowing Golden Eagle Crest
                    const glow = Math.sin(this.animTime * 5) * 4;
                    ctx.fillStyle = '#ffe066';
                    ctx.beginPath();
                    // Head & Beak
                    ctx.arc(x + 16, y + 10, 5, 0, Math.PI * 2);
                    // Flapping wings
                    ctx.moveTo(x + 6 - glow * 0.3, y + 12);
                    ctx.lineTo(x + 16, y + 6);
                    ctx.lineTo(x + 26 + glow * 0.3, y + 12);
                    ctx.lineTo(x + 16, y + 18);
                    ctx.closePath();
                    ctx.fill();

                    // Crest eye
                    ctx.fillStyle = '#ff2222';
                    ctx.fillRect(x + 17, y + 9, 2, 2);
                    continue;
                }

                // 10: Destroyed Eagle Ruins
                if (type === 10) {
                    ctx.fillStyle = '#222222';
                    ctx.fillRect(x, y, tileSize, tileSize);
                    // Broken rubble & smoking skull
                    ctx.fillStyle = '#777777';
                    ctx.fillRect(x + 6, y + 12, 8, 8);
                    ctx.fillRect(x + 18, y + 16, 7, 6);
                    ctx.fillStyle = '#ff4400';
                    ctx.fillRect(x + 14, y + 10, 4, 4); // Glowing ember
                    continue;
                }
            }
        }
    }

    renderFoliageLayer(ctx, localPlayerId, tanks) {
        if (!this.mapData) return;
        const { cols, rows, tileSize, grid } = this.mapData;

        // Check if local player is inside any foliage
        let localInBush = false;
        const localTank = tanks.find(t => t.id === localPlayerId);
        if (localTank && localTank.foliage) localInBush = true;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                if (grid[idx] !== 4) continue; // 4: Foliage

                const x = c * tileSize;
                const y = r * tileSize;

                ctx.save();
                // If local player is inside bushes, make foliage slightly translucent so they see their surroundings
                ctx.globalAlpha = localInBush ? 0.65 : 0.95;

                ctx.fillStyle = '#1e7b26';
                ctx.fillRect(x, y, tileSize, tileSize);

                // Leaf textures
                ctx.fillStyle = '#32b03e';
                ctx.beginPath();
                ctx.arc(x + 8, y + 8, 6, 0, Math.PI * 2);
                ctx.arc(x + 24, y + 8, 6, 0, Math.PI * 2);
                ctx.arc(x + 16, y + 20, 8, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#145c1c';
                ctx.fillRect(x + 4, y + 14, 4, 4);
                ctx.fillRect(x + 20, y + 14, 4, 4);

                ctx.restore();
            }
        }
    }

    renderTanks(ctx, tanks, localPlayerId, predictedPos) {
        for (const t of tanks) {
            if (!t.alive) continue;

            const isLocal = t.id === localPlayerId;
            let drawX = t.x;
            let drawY = t.y;
            let drawDir = t.dir;
            let moving = t.moving;

            if (isLocal && predictedPos) {
                drawX = predictedPos.x;
                drawY = predictedPos.y;
                drawDir = predictedPos.dir;
                moving = predictedPos.moving;
            }

            // Concealment stealth: if in foliage and not local player, render as faint shadow or hidden!
            ctx.save();
            if (t.foliage) {
                ctx.globalAlpha = isLocal ? 0.7 : 0.2;
            }

            ctx.translate(drawX, drawY);

            // Rotate based on direction
            let angle = 0;
            if (drawDir === 'RIGHT') angle = Math.PI / 2;
            if (drawDir === 'DOWN')  angle = Math.PI;
            if (drawDir === 'LEFT')  angle = -Math.PI / 2;
            ctx.rotate(angle);

            // Tank Chassis (Treads & Hull)
            const hullColor = t.color || '#ff4444';

            // Left Tread
            ctx.fillStyle = '#222933';
            ctx.fillRect(-13, -13, 6, 26);
            // Right Tread
            ctx.fillRect(7, -13, 6, 26);

            // Tread animation grooves when moving
            if (moving) {
                ctx.fillStyle = '#445566';
                const treadOff = Math.floor(this.animTime * 30) % 6;
                for (let ty = -12 + treadOff; ty < 12; ty += 6) {
                    ctx.fillRect(-13, ty, 6, 2);
                    ctx.fillRect(7, ty, 6, 2);
                }
            }

            // Center Hull
            ctx.fillStyle = hullColor;
            ctx.fillRect(-8, -11, 16, 22);

            // Armor detailing / tier upgrades
            ctx.fillStyle = '#ffffff';
            if (t.tier >= 2) {
                // Tier 2: double front armor stripe
                ctx.fillRect(-6, -10, 12, 2);
            }
            if (t.tier >= 3) {
                // Tier 3: golden heavy armor plating
                ctx.fillStyle = '#ffbb00';
                ctx.fillRect(-5, -6, 10, 12);
            }
            if (t.tier >= 4) {
                // Tier 4: Steel piercer badge
                ctx.fillStyle = '#00ffff';
                ctx.fillRect(-3, -3, 6, 6);
            }

            // Turret & Cannon Barrel
            ctx.fillStyle = '#111620';
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.fill();

            // Cannon Barrel pointing UP (0 radians)
            ctx.fillStyle = t.tier >= 4 ? '#00e5ff' : '#222933';
            ctx.fillRect(-2, -18, 4, 14);

            // Shield Bubble
            if (t.shield) {
                ctx.save();
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 2.5;
                const shieldPulse = Math.sin(this.animTime * 8) * 2;
                ctx.beginPath();
                ctx.arc(0, 0, 18 + shieldPulse, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
                ctx.fill();
                ctx.restore();
            }

            ctx.restore(); // Undo rotation & translation

            // Draw Tank Name Tag & Health Pips (Always upright)
            ctx.save();
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = isLocal ? '#00ffff' : '#ffffff';
            ctx.fillText(t.username || 'Tanker', drawX, drawY - 18);

            // Lives indicators (small pips)
            const lives = Math.max(0, t.lives || 1);
            const startX = drawX - (lives * 6) / 2;
            for (let i = 0; i < lives; i++) {
                ctx.fillStyle = '#22ff55';
                ctx.fillRect(startX + i * 6, drawY - 26, 4, 4);
            }

            ctx.restore();
        }
    }

    renderShells(ctx, shells) {
        for (const s of shells) {
            ctx.save();
            ctx.translate(s.x, s.y);

            // Glowing bullet shell
            ctx.fillStyle = s.pierce ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(0, 0, s.pierce ? 4.5 : 3.5, 0, Math.PI * 2);
            ctx.fill();

            // Shell tracer aura
            ctx.strokeStyle = s.pierce ? 'rgba(0, 255, 255, 0.4)' : 'rgba(255, 170, 0, 0.4)';
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.restore();
        }
    }

    // Heavy Bombs thrown with ENTER key
    renderBombs(ctx, bombs) {
        for (const b of bombs) {
            ctx.save();
            ctx.translate(b.x, b.y);

            // Shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.ellipse(2, 6, 8, 4, 0, 0, Math.PI * 2);
            ctx.fill();

            // Bomb Body (Glossy Black Explosive Sphere)
            ctx.fillStyle = '#151518';
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ff3300';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Sizzling Fuse with Animated Spark
            ctx.strokeStyle = '#aa7733';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -7);
            ctx.lineTo(4, -13);
            ctx.stroke();

            // Spark flash
            const sparkColor = Math.random() > 0.5 ? '#ffff00' : '#ff3300';
            ctx.fillStyle = sparkColor;
            ctx.beginPath();
            ctx.arc(4, -13, 3 + Math.random() * 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    renderPowerups(ctx, powerups) {
        for (const p of powerups) {
            ctx.save();
            ctx.translate(p.x, p.y);

            // Pulsing background plate
            const pulse = Math.sin(this.animTime * 6) * 2;
            ctx.fillStyle = '#222d3d';
            ctx.fillRect(-12 - pulse * 0.5, -12 - pulse * 0.5, 24 + pulse, 24 + pulse);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-12 - pulse * 0.5, -12 - pulse * 0.5, 24 + pulse, 24 + pulse);

            // Icon by powerup type
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px sans-serif';

            if (p.type === 'star') {
                ctx.fillText('⭐', 0, 0);
            } else if (p.type === 'bomb') {
                ctx.fillText('💣', 0, 0);
            } else if (p.type === 'shield') {
                ctx.fillText('🛡️', 0, 0);
            } else if (p.type === 'shovel') {
                ctx.fillText('⛏️', 0, 0);
            } else if (p.type === 'clock') {
                ctx.fillText('⏱️', 0, 0);
            } else if (p.type === 'life') {
                ctx.fillText('❤️', 0, 0);
            }

            ctx.restore();
        }
    }

    renderParticles(ctx) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= p.decay;

            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);

            if (p.type === 'ring') {
                p.radius += (p.maxRadius - p.radius) * 0.25;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 4 * p.life;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.stroke();
            } else if (p.type === 'spark') {
                p.x += p.vx;
                p.y += p.vy;
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }

            ctx.restore();
        }

        // Floating combat texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.life -= ft.decay;
            ft.y += ft.vy;

            if (ft.life <= 0) {
                this.floatingTexts.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = Math.max(0, ft.life);
            ctx.font = 'bold 13px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, ft.x, ft.y);
            ctx.restore();
        }
    }

    renderRadar(snapshot, localPlayerId) {
        const rctx = this.radarCtx;
        const rw = this.radarCanvas.width;
        const rh = this.radarCanvas.height;

        rctx.fillStyle = '#0a0f16';
        rctx.fillRect(0, 0, rw, rh);

        const scaleX = rw / this.width;
        const scaleY = rh / this.height;

        // Draw Bases / Eagles
        if (snapshot.eagles) {
            for (const e of snapshot.eagles) {
                rctx.fillStyle = e.alive ? '#ffd700' : '#555555';
                const ex = (e.col * this.tileSize + 16) * scaleX;
                const ey = (e.row * this.tileSize + 16) * scaleY;
                rctx.beginPath();
                rctx.arc(ex, ey, 4, 0, Math.PI * 2);
                rctx.fill();
            }
        }

        // Draw Tanks
        if (snapshot.tanks) {
            for (const t of snapshot.tanks) {
                if (!t.alive) continue;
                const isLocal = t.id === localPlayerId;
                rctx.fillStyle = isLocal ? '#00ffff' : (t.color || '#ff4444');
                const tx = t.x * scaleX;
                const ty = t.y * scaleY;
                rctx.fillRect(tx - 2, ty - 2, 4, 4);
            }
        }
    }
}
