// Socket.IO and WebRTC Signaling Manager for TankBattle LAN
const Game = require('./Game');
const lobby = require('./lobby');
const webrtcManager = require('./webrtcManager');
const logger = require('./logger');

const state = {
    status: 'LOBBY', // LOBBY, COUNTDOWN, PLAYING, GAME_OVER
    players: {},
    hostId: null,
    settings: {
        mapId: 'citadel',
        mode: 'attack_defense', // attack_defense (Eagle base) or deathmatch
        teamMode: '2teams',     // 2teams, 3teams, 4teams, ffa
        lives: 3,
        friendlyFire: false,
        powerupsEnabled: true,
        bombCooldownMs: 2500
    }
};

let gameInstance = null;
let countdownTimer = null;

function lobbySnapshot() {
    return {
        status: state.status,
        players: state.players,
        hostId: state.hostId,
        settings: state.settings,
        teams: lobby.TEAMS
    };
}

function assignDefaultTeam(socketId) {
    const counts = { 'team-red': 0, 'team-blue': 0, 'team-green': 0, 'team-yellow': 0 };
    for (const p of Object.values(state.players)) {
        if (p.id !== socketId && counts[p.teamId] !== undefined) {
            counts[p.teamId]++;
        }
    }

    if (state.settings.teamMode === 'ffa') return 'ffa';
    if (state.settings.teamMode === '2teams') {
        return counts['team-red'] <= counts['team-blue'] ? 'team-red' : 'team-blue';
    }

    // Pick team with least players
    let minTeam = 'team-red';
    let minCount = 999;
    for (const [t, c] of Object.entries(counts)) {
        if (c < minCount) {
            minCount = c;
            minTeam = t;
        }
    }
    return minTeam;
}

function setupSocketManager(io) {
    io.on('connection', (socket) => {
        logger.info(`Player connected: ${socket.id}`);

        // Register WebRTC peer for 60Hz UDP data
        webrtcManager.setupPeer(socket, (sockId, inputData) => {
            if (!gameInstance || state.status !== 'PLAYING') return;
            const batch = lobby.sanitizeInputs(inputData);
            if (batch) {
                gameInstance.handleInputs(sockId, batch);
            } else {
                gameInstance.handleInput(sockId, lobby.sanitizeInput(inputData));
            }
        });

        // 1. Join Lobby
        socket.on('join_lobby', (data) => {
            const username = lobby.sanitizeUsername(data && data.username);
            const teamId = (data && data.teamId) || assignDefaultTeam(socket.id);
            const team = lobby.TEAMS.find(t => t.id === teamId) || lobby.TEAMS[0];

            if (!state.hostId) {
                state.hostId = socket.id;
            }

            state.players[socket.id] = {
                id: socket.id,
                username,
                teamId,
                color: team.color,
                isHost: socket.id === state.hostId,
                ready: false,
                isSpectating: false,
                ping: 0
            };

            socket.emit('joined_ack', {
                playerId: socket.id,
                isHost: socket.id === state.hostId,
                snapshot: lobbySnapshot()
            });

            io.emit('lobby_update', lobbySnapshot());
            io.emit('chat_broadcast', {
                system: true,
                text: `${username} joined the battle staging area!`
            });
        });

        // 2. Team Selection
        socket.on('select_team', (data) => {
            const player = state.players[socket.id];
            if (!player || state.status !== 'LOBBY') return;

            const targetTeamId = data && data.teamId;
            if (targetTeamId === 'ffa') {
                player.teamId = 'ffa';
                player.color = '#aaaaaa';
            } else {
                const team = lobby.TEAMS.find(t => t.id === targetTeamId);
                if (team) {
                    player.teamId = team.id;
                    player.color = team.color;
                }
            }

            io.emit('lobby_update', lobbySnapshot());
        });

        // 3. Update Settings (Host Only)
        socket.on('update_settings', (incoming) => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            state.settings = lobby.sanitizeSettings(state.settings, incoming);
            io.emit('lobby_update', lobbySnapshot());
        });

        // 4. Start Game (Host Only)
        socket.on('start_game', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;

            const activePlayers = Object.values(state.players).filter(p => !p.isSpectating);
            if (activePlayers.length === 0) return;

            state.status = 'COUNTDOWN';
            io.emit('status_change', { status: 'COUNTDOWN', countdown: 3 });

            let count = 3;
            countdownTimer = setInterval(() => {
                count--;
                if (count > 0) {
                    io.emit('countdown_tick', { count });
                } else {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                    launchGameSession(io);
                }
            }, 1000);
        });

        // 5. In-Game TCP Input (Fallback when UDP is negotiating)
        socket.on('tank_input', (inputData) => {
            if (!gameInstance || state.status !== 'PLAYING') return;
            const batch = lobby.sanitizeInputs(inputData);
            if (batch) {
                gameInstance.handleInputs(socket.id, batch);
            } else {
                gameInstance.handleInput(socket.id, lobby.sanitizeInput(inputData));
            }
        });

        // 6. Ping / Pong for RTT Latency measurement
        socket.on('client_ping', (clientTime) => {
            socket.emit('server_pong', clientTime);
        });

        // 7. In-Game & Lobby Chat
        socket.on('chat_send', (msg) => {
            const player = state.players[socket.id];
            const clean = lobby.sanitizeChat(msg);
            if (!player || !clean) return;

            io.emit('chat_broadcast', {
                senderId: player.id,
                username: player.username,
                teamId: player.teamId,
                color: player.color,
                text: clean,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        });

        // 8. Return to Lobby
        socket.on('return_to_lobby', () => {
            if (socket.id !== state.hostId && state.status !== 'GAME_OVER') return;
            resetToLobby(io);
        });

        // 9. Disconnect
        socket.on('disconnect', () => {
            logger.info(`Player disconnected: ${socket.id}`);
            const leavingPlayer = state.players[socket.id];
            delete state.players[socket.id];
            webrtcManager.cleanup(socket.id);

            if (gameInstance) {
                gameInstance.removePlayer(socket.id);
            }

            if (leavingPlayer) {
                io.emit('chat_broadcast', {
                    system: true,
                    text: `${leavingPlayer.username} left the server.`
                });
            }

            // Transfer host if host left
            if (socket.id === state.hostId) {
                const remaining = Object.values(state.players);
                state.hostId = remaining.length > 0 ? remaining[0].id : null;
                if (state.hostId && state.players[state.hostId]) {
                    state.players[state.hostId].isHost = true;
                }
            }

            if (Object.keys(state.players).length === 0) {
                resetToLobby(io);
            } else {
                io.emit('lobby_update', lobbySnapshot());
            }
        });
    });
}

function launchGameSession(io) {
    if (gameInstance) {
        gameInstance.stop();
        gameInstance = null;
    }

    state.status = 'PLAYING';

    gameInstance = new Game(io, state.settings, state.players, (results) => {
        // On Game Over
        state.status = 'GAME_OVER';
        io.emit('game_over', results);
        logger.info(`Match concluded. Winner: ${results.winner}`);
    });

    // Send initial map geometry, tiles, and eagle placements to all players
    const mapInitialData = gameInstance.mapManager.getInitialState();
    io.emit('game_start', {
        settings: state.settings,
        mapData: mapInitialData,
        tanks: Object.values(gameInstance.tanks).map(t => ({
            id: t.id,
            username: t.username,
            teamId: t.teamId,
            color: t.color,
            x: t.x,
            y: t.y,
            dir: t.dir,
            lives: t.lives
        }))
    });

    gameInstance.start();
    io.emit('status_change', { status: 'PLAYING' });
}

function resetToLobby(io) {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
    if (gameInstance) {
        gameInstance.stop();
        gameInstance = null;
    }
    state.status = 'LOBBY';
    io.emit('status_change', { status: 'LOBBY' });
    io.emit('lobby_update', lobbySnapshot());
}

module.exports = setupSocketManager;
