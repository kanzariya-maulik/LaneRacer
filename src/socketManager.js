const Game = require('./game/Game');
const webrtcManager = require('./webrtcManager');

// Global game state
const state = {
    status: 'LOBBY', // LOBBY, COUNTDOWN, RACE, FINISHED
    players: {},
    hostId: null,
    settings: {
        trackId: 1,
        maxLaps: 3,
        maxSpeed: 400
    }
};

let gameInstance = null;

function setupSocketManager(io) {
    io.on('connection', (socket) => {
        console.log(`Player connected: ${socket.id}`);

        // ── WebRTC Signaling ─────────────────────────────────────────────────
        // Set up a WebRTC peer for this socket; inputs from the UDP channel are
        // forwarded into the game engine exactly like Socket.IO inputs.
        webrtcManager.setupPeer(socket, (id, inputData) => {
            if (gameInstance && state.status === 'RACE') {
                gameInstance.handleInput(id, inputData);
            }
        });

        // Handle joining the lobby
        socket.on('join_lobby', (data) => {
            const isFirstPlayer = Object.keys(state.players).length === 0;

            state.players[socket.id] = {
                id: socket.id,
                username: data.username.slice(0, 15),
                color: data.color || '#ff0000',
                isReady: false,
                isSpectating: state.status !== 'LOBBY'
            };

            if (isFirstPlayer) {
                state.hostId = socket.id;
            }

            socket.emit('lobby_state_sync', {
                players: state.players,
                hostId: state.hostId,
                status: state.status,
                settings: state.settings
            });

            socket.broadcast.emit('player_joined', state.players[socket.id]);
        });

        // Chat
        socket.on('chat_msg', (msg) => {
            const player = state.players[socket.id];
            if (!player) return;
            io.emit('chat_msg', {
                username: player.username,
                color: player.color,
                msg: msg.slice(0, 100)
            });
        });

        // Ready toggle
        socket.on('toggle_ready', (isReady) => {
            if (state.status !== 'LOBBY' || !state.players[socket.id]) return;
            state.players[socket.id].isReady = isReady;
            io.emit('player_ready_sync', { id: socket.id, isReady });
        });

        // Host settings
        socket.on('update_settings', (settings) => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            state.settings = { ...state.settings, ...settings };
            io.emit('settings_updated', state.settings);
        });

        // Start Game
        socket.on('start_game', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;

            let allReady = true;
            for (let id in state.players) {
                if (id !== state.hostId && !state.players[id].isReady && !state.players[id].isSpectating) {
                    allReady = false;
                }
            }

            if (!allReady) {
                socket.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: 'Not all players are ready!' });
                return;
            }

            state.status = 'COUNTDOWN';
            io.emit('status_change', 'COUNTDOWN');

            let countdown = 3;
            const timer = setInterval(() => {
                io.emit('countdown', countdown);
                countdown--;
                if (countdown < 0) {
                    clearInterval(timer);
                    startGame(io);
                }
            }, 1000);
        });

        // Input fallback: only active if UDP channel is not yet open
        socket.on('input', (inputData) => {
            if (!webrtcManager.hasOpenChannel(socket.id)) {
                if (gameInstance && state.status === 'RACE') {
                    gameInstance.handleInput(socket.id, inputData);
                }
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            console.log(`Player disconnected: ${socket.id}`);

            // Clean up WebRTC peer
            webrtcManager.cleanup(socket.id);

            if (state.players[socket.id]) {
                delete state.players[socket.id];
                io.emit('player_left', socket.id);

                if (socket.id === state.hostId) {
                    const remainingPlayers = Object.keys(state.players);
                    if (remainingPlayers.length > 0) {
                        state.hostId = remainingPlayers[0];
                        io.emit('lobby_state_sync', state);
                    } else {
                        state.hostId = null;
                        if (gameInstance) {
                            gameInstance.stop();
                            gameInstance = null;
                        }
                        state.status = 'LOBBY';
                    }
                }
            }
        });
    });
}

function startGame(io) {
    state.status = 'RACE';

    const activePlayers = [];
    for (const [id, player] of Object.entries(state.players)) {
        if (!player.isSpectating) {
            activePlayers.push(player);
        }
    }

    gameInstance = new Game(io, activePlayers, state.settings, webrtcManager, () => {
        state.status = 'FINISHED';
        io.emit('status_change', 'FINISHED');

        setTimeout(() => {
            state.status = 'LOBBY';
            for (let id in state.players) {
                state.players[id].isReady = false;
                state.players[id].isSpectating = false;
            }
            io.emit('lobby_state_sync', state);
            gameInstance = null;
        }, 5000);
    });

    io.emit('status_change', 'RACE');
    gameInstance.start();
}

module.exports = setupSocketManager;
