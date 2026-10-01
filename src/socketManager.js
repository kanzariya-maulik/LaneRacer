const Game = require('./game/Game');

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

        // Handle joining the lobby
        socket.on('join_lobby', (data) => {
            const isFirstPlayer = Object.keys(state.players).length === 0;
            
            state.players[socket.id] = {
                id: socket.id,
                username: data.username.slice(0, 15), // Max 15 chars
                color: data.color || '#ff0000',
                isReady: false,
                isSpectating: state.status !== 'LOBBY'
            };

            if (isFirstPlayer) {
                state.hostId = socket.id;
            }

            // Sync full state to the new player
            socket.emit('lobby_state_sync', {
                players: state.players,
                hostId: state.hostId,
                status: state.status,
                settings: state.settings
            });

            // Tell others
            socket.broadcast.emit('player_joined', state.players[socket.id]);
        });

        // Chat functionality
        socket.on('chat_msg', (msg) => {
            const player = state.players[socket.id];
            if (!player) return;
            // Broadcast to everyone
            io.emit('chat_msg', {
                username: player.username,
                color: player.color,
                msg: msg.slice(0, 100) // limit length
            });
        });

        // Ready toggle
        socket.on('toggle_ready', (isReady) => {
            if (state.status !== 'LOBBY' || !state.players[socket.id]) return;
            state.players[socket.id].isReady = isReady;
            io.emit('player_ready_sync', { id: socket.id, isReady });
        });

        // Host settings changes
        socket.on('update_settings', (settings) => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            state.settings = { ...state.settings, ...settings };
            io.emit('settings_updated', state.settings);
        });

        // Start Game
        socket.on('start_game', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            
            // Check if everyone else is ready
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

            // Start countdown
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
        
        // Handle Game Inputs
        socket.on('input', (inputData) => {
            if (gameInstance && state.status === 'RACE') {
                gameInstance.handleInput(socket.id, inputData);
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            console.log(`Player disconnected: ${socket.id}`);
            if (state.players[socket.id]) {
                delete state.players[socket.id];
                io.emit('player_left', socket.id);

                // Auto-reassign host
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
                        state.status = 'LOBBY'; // Reset when empty
                    }
                }
            }
        });
    });
}

function startGame(io) {
    state.status = 'RACE';
    
    // Clear old spectating statuses except for those who joined naturally as spectators
    const activePlayers = [];
    for (const [id, player] of Object.entries(state.players)) {
        if (!player.isSpectating) {
            activePlayers.push(player);
        }
    }

    // Initialize Game engine
    gameInstance = new Game(io, activePlayers, state.settings, () => {
        // Callback when game finishes
        state.status = 'FINISHED';
        io.emit('status_change', 'FINISHED');
        
        // Reset to lobby after 5 seconds
        setTimeout(() => {
            state.status = 'LOBBY';
            for(let id in state.players) {
                state.players[id].isReady = false;
                state.players[id].isSpectating = false; // Reset spec state
            }
            io.emit('lobby_state_sync', state);
            gameInstance = null;
        }, 5000);
    });

    io.emit('status_change', 'RACE');
    gameInstance.start();
}

module.exports = setupSocketManager;
