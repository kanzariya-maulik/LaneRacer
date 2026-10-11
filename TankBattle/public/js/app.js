// Main Battle Tanks LAN Client Coordinator
import { RetroTankAudio } from './RetroTankAudio.js';
import { NetworkClient } from './socket.js';
import { InputManager } from './input.js';
import { ClientPredictor } from './predict.js';
import { GameRenderer } from './renderer.js';

class TankBattleApp {
    constructor() {
        this.audio = new RetroTankAudio();
        this.predictor = new ClientPredictor();
        this.renderer = null;
        this.network = null;
        this.inputManager = null;

        this.latestSnapshot = null;
        this.currentStatus = 'LOBBY'; // LOBBY, COUNTDOWN, PLAYING, GAME_OVER
        this.currentSettings = {};
        this.localPlayerId = null;
        this.isHost = false;

        // Bomb cooldown client tracker
        this.lastBombThrowLocalTime = 0;
        this.bombCooldownMs = 2500;

        this.initUIElements();
        this.initRenderer();
        this.initNetwork();
        this.initInput();
        this.bindUIEvents();

        // Start render ticker
        requestAnimationFrame(() => this.loop());
    }

    initUIElements() {
        this.screens = {
            lobby: document.getElementById('screen-lobby'),
            game: document.getElementById('screen-game'),
            countdown: document.getElementById('screen-countdown'),
            gameOver: document.getElementById('modal-gameover')
        };

        // Lobby elements
        this.usernameInput = document.getElementById('input-username');
        this.btnJoin = document.getElementById('btn-join-lobby');
        this.btnStartGame = document.getElementById('btn-start-game');
        this.selectMap = document.getElementById('select-map');
        this.selectMode = document.getElementById('select-mode');
        this.selectTeamMode = document.getElementById('select-team-mode');
        this.inputLives = document.getElementById('input-lives');
        this.playerListContainer = document.getElementById('player-roster');
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.btnSendChat = document.getElementById('btn-send-chat');

        // HUD elements
        this.hudEagleStatus = document.getElementById('hud-eagle-status');
        this.hudLives = document.getElementById('hud-lives');
        this.hudBombBadge = document.getElementById('hud-bomb-badge');
        this.hudNetBadge = document.getElementById('hud-net-badge');
        this.hudKillFeed = document.getElementById('hud-kill-feed');
        this.countdownNumber = document.getElementById('countdown-number');

        // Game Over elements
        this.winnerBanner = document.getElementById('gameover-winner');
        this.winnerReason = document.getElementById('gameover-reason');
        this.scoreboardBody = document.getElementById('gameover-scoreboard');
        this.btnReturnLobby = document.getElementById('btn-return-lobby');
    }

    initRenderer() {
        const canvas = document.getElementById('game-canvas');
        const radarCanvas = document.getElementById('radar-canvas');
        this.renderer = new GameRenderer(canvas, radarCanvas);
    }

    initNetwork() {
        this.network = new NetworkClient(
            (snapshot) => this.onStateSnapshot(snapshot),
            (lobbySnapshot) => this.onLobbyUpdate(lobbySnapshot),
            (gameStartData) => this.onGameStart(gameStartData),
            (gameOverResults) => this.onGameOver(gameOverResults),
            (chatMsg) => this.onChatMessage(chatMsg),
            (toast) => this.addFeedToast(toast)
        );
    }

    initInput() {
        this.inputManager = new InputManager(
            () => {
                // Bomb fired (ENTER)
                const now = Date.now();
                if (now - this.lastBombThrowLocalTime >= this.bombCooldownMs) {
                    this.lastBombThrowLocalTime = now;
                    this.audio.playBombThrow();
                }
            },
            () => {
                // Shell fired (SPACE)
                this.audio.playFire();
            }
        );
    }

    bindUIEvents() {
        // Unlock Web Audio on first click
        window.addEventListener('click', () => this.audio.unlock(), { once: true });
        window.addEventListener('keydown', () => this.audio.unlock(), { once: true });

        // Join / Profile update
        this.btnJoin.addEventListener('click', () => {
            const name = this.usernameInput.value.trim() || 'TankCommander';
            this.network.joinLobby(name, null);
            this.btnJoin.innerText = 'Profile Updated ✓';
            setTimeout(() => { this.btnJoin.innerText = 'Update Profile'; }, 2000);
        });

        // Team selector buttons
        document.querySelectorAll('.btn-team-pick').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const teamId = e.currentTarget.dataset.team;
                this.network.selectTeam(teamId);
                document.querySelectorAll('.btn-team-pick').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });

        // Host settings updates
        const updateHostSettings = () => {
            if (!this.isHost) return;
            this.network.updateSettings({
                mapId: this.selectMap.value,
                mode: this.selectMode.value,
                teamMode: this.selectTeamMode.value,
                lives: parseInt(this.inputLives.value, 10)
            });
        };

        this.selectMap.addEventListener('change', updateHostSettings);
        this.selectMode.addEventListener('change', updateHostSettings);
        this.selectTeamMode.addEventListener('change', updateHostSettings);
        this.inputLives.addEventListener('change', updateHostSettings);

        // Host start game
        this.btnStartGame.addEventListener('click', () => {
            if (this.isHost) {
                this.network.startGame();
            }
        });

        // Chat send
        const sendChat = () => {
            const text = this.chatInput.value.trim();
            if (text) {
                this.network.sendChat(text);
                this.chatInput.value = '';
            }
        };
        this.btnSendChat.addEventListener('click', sendChat);
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendChat();
        });

        // Mobile on-screen touch buttons
        const btnTouchBomb = document.getElementById('touch-btn-bomb');
        const btnTouchShell = document.getElementById('touch-btn-shell');
        if (btnTouchBomb) {
            btnTouchBomb.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.inputManager.triggerBomb();
            });
        }
        if (btnTouchShell) {
            btnTouchShell.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.inputManager.triggerShell();
            });
        }

        // Return to Lobby
        this.btnReturnLobby.addEventListener('click', () => {
            this.network.returnToLobby();
            this.screens.gameOver.classList.add('hidden');
        });
    }

    onLobbyUpdate(snapshot) {
        if (!snapshot) return;
        this.localPlayerId = this.network.playerId;
        this.isHost = snapshot.hostId === this.localPlayerId;
        this.currentSettings = snapshot.settings || {};

        // Update settings form
        if (snapshot.settings) {
            this.selectMap.value = snapshot.settings.mapId || 'citadel';
            this.selectMode.value = snapshot.settings.mode || 'attack_defense';
            this.selectTeamMode.value = snapshot.settings.teamMode || '2teams';
            this.inputLives.value = snapshot.settings.lives || 3;
            this.bombCooldownMs = snapshot.settings.bombCooldownMs || 2500;
        }

        // Disable settings controls for non-hosts
        const hostOnlyElements = [this.selectMap, this.selectMode, this.selectTeamMode, this.inputLives];
        hostOnlyElements.forEach(el => el.disabled = !this.isHost);

        if (this.isHost) {
            this.btnStartGame.style.display = 'block';
            this.btnStartGame.innerText = 'START BATTLE (HOST)';
        } else {
            this.btnStartGame.style.display = 'block';
            this.btnStartGame.disabled = true;
            this.btnStartGame.innerText = 'WAITING FOR HOST TO LAUNCH...';
        }

        // Render player roster
        this.playerListContainer.innerHTML = '';
        for (const p of Object.values(snapshot.players)) {
            const card = document.createElement('div');
            card.className = `player-card ${p.teamId}`;
            card.innerHTML = `
                <div class="player-color-box" style="background-color: ${p.color}"></div>
                <div class="player-info">
                    <div class="player-name">${p.username} ${p.isHost ? '<span class="badge-host">HOST</span>' : ''} ${p.id === this.localPlayerId ? '<span class="badge-you">YOU</span>' : ''}</div>
                    <div class="player-sub">${p.teamId.toUpperCase()}</div>
                </div>
            `;
            this.playerListContainer.appendChild(card);
        }

        // Switch to lobby screen if status is LOBBY
        if (snapshot.status === 'LOBBY' && this.currentStatus !== 'LOBBY') {
            this.currentStatus = 'LOBBY';
            this.showScreen('lobby');
        }
    }

    onGameStart(data) {
        this.currentStatus = 'PLAYING';
        this.showScreen('game');

        if (data.mapData) {
            this.renderer.setMapData(data.mapData);
        }

        const localTank = data.tanks.find(t => t.id === this.localPlayerId);
        if (localTank) {
            this.predictor.init(localTank);
        }

        this.addFeedToast('⚔️ BATTLE INITIATED! ENGAGE TARGETS!');
    }

    onStateSnapshot(snapshot) {
        this.latestSnapshot = snapshot;

        // Apply map sub-tile destruction diffs
        if (snapshot.gridDiffs && snapshot.gridDiffs.length > 0) {
            this.renderer.applyGridDiffs(snapshot.gridDiffs);
        }

        // Reconcile client prediction
        const localTank = (snapshot.tanks || []).find(t => t.id === this.localPlayerId);
        if (localTank) {
            this.predictor.reconcile(localTank);
            if (localTank.ackSeq !== undefined) {
                this.inputManager.acknowledge(localTank.ackSeq);
            }
        }

        // Process audio & visual game events
        if (snapshot.events) {
            for (const ev of snapshot.events) {
                this.handleIncomingEvent(ev);
            }
        }
    }

    handleIncomingEvent(ev) {
        if (ev.type === 'BOMB_BLAST') {
            this.renderer.addExplosion(ev.x, ev.y, true, true);
            this.audio.playBombBlast();
            this.addFeedToast('💣 MASSIVE BOMB DETONATION!');
        } else if (ev.type === 'EXPLOSION') {
            this.renderer.addExplosion(ev.x, ev.y, !ev.small, false);
            this.audio.playExplosion(!ev.small);
        } else if (ev.type === 'MID_AIR_COLLISION') {
            this.renderer.addExplosion(ev.x, ev.y, false, false);
            this.renderer.addFloatingText('💥 SHELL DEFLECTED', ev.x, ev.y, '#00e5ff');
            this.audio.playSteelClank();
        } else if (ev.type === 'TANK_HIT') {
            if (ev.killed) {
                this.renderer.addFloatingText('TANK DESTROYED!', 0, 0, '#ff3344');
                this.audio.playExplosion(true);
                this.addFeedToast(`💥 Tank eliminated!`);
            } else {
                this.audio.playExplosion(false);
            }
        } else if (ev.type === 'BASE_DESTROYED') {
            this.audio.playEagleAlarm();
            this.audio.playBombBlast();
            this.addFeedToast(`🚨 TEAM ${ev.teamId.toUpperCase()} EAGLE HQ DESTROYED!`);
        } else if (ev.type === 'POWERUP_COLLECT') {
            this.audio.playPowerup();
            this.renderer.addFloatingText(`+${ev.powerupType.toUpperCase()}`, ev.x, ev.y, '#ffd700');
        }
    }

    onGameOver(results) {
        this.currentStatus = 'GAME_OVER';
        this.screens.gameOver.classList.remove('hidden');

        const isWinner = results.winner === this.network.playerId || (this.predictor.predictedTank && results.winner === this.predictor.predictedTank.teamId);
        if (isWinner) {
            this.audio.playVictory();
            this.winnerBanner.innerText = '🏆 VICTORY!';
            this.winnerBanner.style.color = '#00ff66';
        } else {
            this.winnerBanner.innerText = '💀 DEFEAT';
            this.winnerBanner.style.color = '#ff3344';
        }

        this.winnerReason.innerText = results.reason || '';

        // Fill scoreboard
        this.scoreboardBody.innerHTML = '';
        for (const t of (results.tanks || [])) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${t.username}</td>
                <td>${t.teamId}</td>
                <td>${t.kills || 0}</td>
                <td>${t.bombsUsed || 0}</td>
                <td>${t.alive ? '<span style="color:#00ff66">SURVIVED</span>' : '<span style="color:#ff3344">DESTROYED</span>'}</td>
            `;
            this.scoreboardBody.appendChild(tr);
        }
    }

    onChatMessage(msg) {
        const div = document.createElement('div');
        div.className = msg.system ? 'chat-msg system' : 'chat-msg';
        if (msg.system) {
            div.innerHTML = `<span class="sys-tag">[SYS]</span> ${msg.text}`;
        } else {
            div.innerHTML = `<span class="chat-sender" style="color:${msg.color}">${msg.username}:</span> <span class="chat-text">${msg.text}</span>`;
        }
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    addFeedToast(text) {
        const item = document.createElement('div');
        item.className = 'toast-item';
        item.innerText = text;
        this.hudKillFeed.appendChild(item);
        setTimeout(() => { item.remove(); }, 4000);
    }

    showScreen(screenName) {
        Object.keys(this.screens).forEach(k => {
            if (this.screens[k]) this.screens[k].classList.add('hidden');
        });
        if (this.screens[screenName]) {
            this.screens[screenName].classList.remove('hidden');
        }
    }

    // Main 60 Hz Client Render & Input Loop
    loop() {
        if (this.currentStatus === 'PLAYING') {
            // 1. Sample inputs and batch for redundant UDP transmission
            const inputSample = this.inputManager.sample();

            // 2. Client-side prediction for zero movement latency
            if (this.renderer && this.renderer.mapManager) {
                this.predictor.predictLocal(inputSample.current, this.renderer.mapManager);
            }

            // 3. Dispatch sequenced input batch to server
            this.network.sendInput(inputSample.batch);

            // 4. Update procedural engine audio
            this.audio.updateEngine(inputSample.current.moving);

            // 5. Render Canvas Frame
            this.renderer.render(this.latestSnapshot, this.localPlayerId, this.predictor.getPos());

            // 6. Update HUD Gauges
            this.updateHUD();
        }

        requestAnimationFrame(() => this.loop());
    }

    updateHUD() {
        if (!this.latestSnapshot) return;

        // Update Network latency badge
        const net = this.network.getStatus();
        this.hudNetBadge.innerText = `${net.transport} | ${net.rttMs}ms`;
        this.hudNetBadge.className = net.isUDP ? 'badge-net udp' : 'badge-net tcp';

        // Update Bomb Cooldown Widget (ENTER key)
        const now = Date.now();
        const elapsed = now - this.lastBombThrowLocalTime;
        const bombReady = elapsed >= this.bombCooldownMs;
        if (bombReady) {
            this.hudBombBadge.innerHTML = '💣 [ENTER] BOMB READY';
            this.hudBombBadge.className = 'hud-bomb ready';
        } else {
            const pct = Math.min(100, Math.round((elapsed / this.bombCooldownMs) * 100));
            this.hudBombBadge.innerHTML = `💣 RECHARGING (${pct}%)`;
            this.hudBombBadge.className = 'hud-bomb cooldown';
        }

        // Update local lives indicator
        if (this.predictor.predictedTank) {
            const lives = this.predictor.predictedTank.lives || 0;
            this.hudLives.innerHTML = `LIVES: ${'❤️ '.repeat(Math.max(0, lives))}`;
        }

        // Update Eagle HQ status badges
        if (this.latestSnapshot.eagles) {
            let html = '';
            for (const e of this.latestSnapshot.eagles) {
                const statusIcon = e.alive ? '🦅 OK' : '💀 DESTROYED';
                const statusClass = e.alive ? 'alive' : 'dead';
                html += `<div class="eagle-badge ${e.teamId} ${statusClass}">${e.teamId.toUpperCase()}: ${statusIcon}</div>`;
            }
            this.hudEagleStatus.innerHTML = html;
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new TankBattleApp();
});
