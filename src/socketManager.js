const Game = require('./game/Game');
const Track = require('./game/Track');
const lobby = require('./lobby');
const { withNetSim } = require('./netsim');
const Logger = require('./logger');

const TRACKS = Track.loadAll(); // throws at startup if track data is missing
const RESULTS_MS = 8000;
const FINISH_MS = 15000; // results screen time before everyone returns to the lobby

const state = {
    status: 'LOBBY', // LOBBY, QUALIFYING, QUALI_RESULTS, COUNTDOWN, RACE, FINISHED
    players: {},
    hostId: null,
    settings: { trackId: 'monza', maxLaps: 3, qualifying: true, collisions: true }
};

let gameInstance = null;

// Prediction clients send sequenced batches; bots and old tabs send one plain input
function applyInput(id, inputData) {
    if (!gameInstance) return;
    const batch = lobby.sanitizeInputs(inputData);
    if (batch) gameInstance.handleInputs(id, batch);
    else gameInstance.handleInput(id, lobby.sanitizeInput(inputData));
}
const applyInputLater = withNetSim(applyInput); // NET_SIM: fake WiFi on incoming inputs too

// Every session timer goes through later() so an empty server can cancel them all at once
const timers = new Set();
function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
}
function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
}

function lobbySnapshot() {
    return { players: state.players, hostId: state.hostId, status: state.status, settings: state.settings };
}

function setStatus(io, status) {
    state.status = status;
    io.emit('status_change', status);
}

let net = null; // WebRTC UDP transport (src/webrtcManager.js); tests pass a stub

const ipProfileCache = {}; // Cache profiles by client IP address for seamless cross-IP recovery

function setupSocketManager(io, transport = require('./webrtcManager')) {
    net = transport;
    io.on('connection', (socket) => {
        const clientIp = socket.handshake?.address || socket.request?.socket?.remoteAddress;
        console.log(`Player connected: ${socket.id} (${clientIp})`);
        // WebRTC signalling over Socket.IO; inputs arriving on the UDP DataChannel go to the game like socket inputs
        net.setupPeer(socket, (id, inputData) => {
            applyInputLater(id, inputData);
        });
        // Visitors see live team counts before they join
        socket.emit('lobby_state_sync', lobbySnapshot());

        // Offer cached profile if client doesn't have one set in browser storage
        if (clientIp && ipProfileCache[clientIp]) {
            socket.emit('suggested_profile', ipProfileCache[clientIp]);
        }

        socket.on('join_lobby', (data) => {
            if (state.players[socket.id]) return;
            const check = lobby.canJoinTeam(state.players, data && data.teamId);
            if (!check.ok) return socket.emit('join_error', check.reason);

            const isFirstPlayer = Object.keys(state.players).length === 0;
            const username = lobby.sanitizeUsername(data.username);
            const teamId = check.team.id;
            const assist = lobby.sanitizeAssist(data.assist);

            state.players[socket.id] = {
                id: socket.id,
                username,
                teamId,
                color: check.team.chatColor,
                assist,
                isReady: true,
                isSpectating: state.status !== 'LOBBY'
            };

            // First human player to join becomes host, or if hostId is missing/invalid/bot
            if (!state.hostId || !state.players[state.hostId] || state.players[state.hostId].isBot) {
                state.hostId = socket.id;
            }

            Logger.player(socket.id, username, `Joined lobby (Host: ${state.hostId === socket.id}, Team: ${teamId})`);

            if (clientIp) ipProfileCache[clientIp] = { username, teamId, assist };

            // Everyone (visitors included) needs the new counts and the current host
            io.emit('lobby_state_sync', lobbySnapshot());
            socket.broadcast.emit('player_joined', state.players[socket.id]);

            // Late joiner: give them the running session so the spectator view has something to draw
            if (gameInstance && state.status !== 'LOBBY') socket.emit('game_init', gameInstance.initPayload());
        });

        socket.on('update_profile', (data) => {
            const player = state.players[socket.id];
            if (!player || state.status !== 'LOBBY') return;
            if (data.username) player.username = lobby.sanitizeUsername(data.username);
            if (data.teamId && data.teamId !== player.teamId) {
                const check = lobby.canJoinTeam(state.players, data.teamId);
                if (check.ok) {
                    player.teamId = check.team.id;
                    player.color = check.team.chatColor;
                }
            }
            if (data.assist) player.assist = lobby.sanitizeAssist(data.assist);
            if (clientIp) {
                ipProfileCache[clientIp] = { username: player.username, teamId: player.teamId, assist: player.assist };
            }
            io.emit('lobby_state_sync', lobbySnapshot());
        });

        socket.on('chat_msg', (msg) => {
            const player = state.players[socket.id];
            const clean = lobby.sanitizeChat(msg);
            if (!player || !clean) return;
            io.emit('chat_msg', { username: player.username, color: player.color, msg: clean });
        });

        socket.on('toggle_ready', (isReady) => {
            if (state.status !== 'LOBBY' || !state.players[socket.id]) return;
            state.players[socket.id].isReady = !!isReady;
            io.emit('player_ready_sync', { id: socket.id, isReady: !!isReady });
        });

function syncBotPlayer(io) {
    const BOT_ID = 'bot-ai-1';
    let changed = false;
    if (state.settings.botCar) {
        if (!state.players[BOT_ID]) {
            const botTeam = lobby.TEAMS.find(t => Object.values(state.players).filter(p => p.teamId === t.id).length < t.maxPlayers) || lobby.TEAMS[0];
            state.players[BOT_ID] = {
                id: BOT_ID,
                username: 'AI Bot (Computer)',
                teamId: botTeam.id,
                color: botTeam.chatColor || '#a855f7',
                assist: '100,100',
                isReady: true,
                isSpectating: false,
                isBot: true
            };
            changed = true;
        }
    } else if (state.players[BOT_ID]) {
        delete state.players[BOT_ID];
        changed = true;
    }
    if (changed) io.emit('lobby_state_sync', lobbySnapshot());
}

        socket.on('update_settings', (settings) => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            state.settings = lobby.sanitizeSettings(state.settings, settings, Track.TRACK_IDS);
            syncBotPlayer(io);
            io.emit('settings_updated', state.settings);
            io.emit('lobby_state_sync', lobbySnapshot());
        });

        let unpauseTimer = null;
        let unpauseCount = 0;

        socket.on('toggle_pause', () => {
            if (socket.id !== state.hostId || !gameInstance || state.status === 'LOBBY') return;
            if (unpauseTimer) {
                clearInterval(unpauseTimer);
                unpauseTimer = null;
            }
            if (!gameInstance.paused) {
                gameInstance.paused = true;
                io.emit('game_pause_sync', { paused: true, hostUsername: state.players[socket.id]?.username || 'Host' });
            } else {
                unpauseCount = 3;
                io.emit('unpause_countdown', { count: unpauseCount });
                unpauseTimer = setInterval(() => {
                    unpauseCount--;
                    io.emit('unpause_countdown', { count: unpauseCount });
                    if (unpauseCount <= 0) {
                        clearInterval(unpauseTimer);
                        unpauseTimer = null;
                        gameInstance.paused = false;
                        io.emit('game_pause_sync', { paused: false });
                    }
                }, 1000);
            }
        });

        socket.on('start_game', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;

            const notReady = Object.values(state.players)
                .some(p => p.id !== state.hostId && !p.isReady && !p.isSpectating && !p.isBot);
            if (notReady) {
                socket.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: 'Not all players are ready!' });
                return;
            }

            const { racers, overflow } = lobby.pickRacers(state.players);
            overflow.forEach((p) => { p.isSpectating = true; });
            if (overflow.length) io.emit('lobby_state_sync', lobbySnapshot());

            if (state.settings.qualifying) startQuali(io, racers);
            else startRace(io, racers);
        });

        socket.on('restart_server', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            console.log(`Host (${socket.id}) initiated server restart.`);
            io.emit('chat_msg', { username: 'SYSTEM', color: '#f43f5e', msg: 'Host is restarting the server and app...' });
            io.emit('server_restarting');

            setTimeout(() => {
                const { exec } = require('child_process');
                const isWin = process.platform === 'win32';
                const cmd = isWin ? 'node server.js' : 'make restart || (make kill-all && make all)';
                exec(cmd, (err) => {
                    if (err) console.error('Restart command output/err:', err);
                });
                setTimeout(() => process.exit(0), 500);
            }, 500);
        });

        socket.on('set_assist', (assist) => {
            const player = state.players[socket.id];
            if (!player) return;
            player.assist = lobby.sanitizeAssist(assist);
            const car = gameInstance?.players[socket.id];
            if (car) car.assist = player.assist; // takes effect on the next tick
            io.emit('lobby_state_sync', lobbySnapshot());
        });

        socket.on('net_ping', (t, ack) => { if (typeof ack === 'function') ack(t); }); // RTT for the stats overlay (TCP link)

        socket.on('input', (inputData) => {
            // Fallback while the UDP channel isn't open. Accepted in every session phase; a frozen race keeps it until lights out
            if (net.hasOpenChannel(socket.id)) return;
            applyInputLater(socket.id, inputData);
        });

        socket.on('kick_player', (targetId) => {
            if (socket.id !== state.hostId) return;
            const target = state.players[targetId];
            if (!target || target.isBot || targetId === socket.id) return;

            target.isSpectating = true;
            target.isReady = false;
            
            if (gameInstance && gameInstance.players[targetId]) {
                gameInstance.players[targetId].isSpectating = true;
            }

            io.emit('chat_msg', { username: 'SYSTEM', color: '#f43f5e', msg: `${target.username} was moved to Spectators by Host` });
            io.emit('lobby_state_sync', lobbySnapshot());
        });

        socket.on('disconnect', () => {
            console.log(`Player disconnected: ${socket.id}`);
            net.cleanup(socket.id);
            if (!state.players[socket.id]) return;

            delete state.players[socket.id];
            if (gameInstance) gameInstance.removePlayer(socket.id);
            io.emit('player_left', socket.id);

            if (socket.id === state.hostId) {
                const remainingHumans = Object.values(state.players).filter(p => !p.isBot);
                if (remainingHumans.length > 0) {
                    state.hostId = remainingHumans[0].id;
                } else {
                    state.hostId = null;
                }
            }

            const activeHumans = Object.values(state.players).filter(p => !p.isSpectating && !p.isBot);
            if (activeHumans.length === 0 && state.status !== 'LOBBY') {
                clearTimers();
                if (gameInstance) {
                    gameInstance.stop();
                    gameInstance = null;
                }
                setStatus(io, 'LOBBY');
            }
            io.emit('lobby_state_sync', lobbySnapshot());
        });
    });
}

function startQuali(io, racers) {
    setStatus(io, 'QUALIFYING');
    Logger.game(`Session started: QUALIFYING with ${racers.length} racers on track ${state.settings.trackId}`);
    gameInstance = new Game(io, racers, TRACKS[state.settings.trackId], state.settings, (results) => {
        setStatus(io, 'QUALI_RESULTS');
        Logger.game(`Qualifying finished. Results: ${JSON.stringify(results)}`);
        io.emit('quali_results', results.map((r, i) => ({ id: r.id, bestLap: r.bestLap, position: i + 1 })));
        io.emit('session', { phase: 'QUALI_RESULTS', endsInMs: RESULTS_MS });
        later(() => {
            // Drivers who left during the results screen aren't on the grid
            const grid = results.map(r => state.players[r.id]).filter(Boolean);
            startRace(io, grid);
        }, RESULTS_MS);
    }, 'quali', net);
    gameInstance.start();
}

function startRace(io, grid) {
    setStatus(io, 'COUNTDOWN');
    Logger.game(`Session started: COUNTDOWN with ${grid.length} cars on track ${state.settings.trackId} (botCar: ${state.settings.botCar})`);
    const race = new Game(io, grid, TRACKS[state.settings.trackId], state.settings, () => finishRace(io), 'race', net);
    gameInstance = race;
    race.start(); // cars are drawn on the grid, frozen until lights out

    for (let n = 1; n <= 5; n++) later(() => { if (gameInstance === race) io.emit('lights', { count: n }); }, n * 1000);
    later(() => {
        if (gameInstance !== race) return; // race already ended (e.g. its grid emptied)
        io.emit('lights', { count: 0 });
        race.release();
        setStatus(io, 'RACE');
        Logger.game(`Lights out! RACE GREEN FLAG.`);
        io.emit('session', { phase: 'RACE', endsInMs: null });
    }, 5000 + 500 + Math.random() * 2000);
}

function finishRace(io) {
    clearTimers(); // pending lights must not fire after the race is over
    setStatus(io, 'FINISHED');
    Logger.game('Race completed. Entering FINISHED status.');
    later(() => {
        state.status = 'LOBBY';
        for (const id in state.players) {
            state.players[id].isReady = false;
            state.players[id].isSpectating = false;
        }
        io.emit('lobby_state_sync', lobbySnapshot());
        gameInstance = null;
        Logger.game('Session reset to LOBBY.');
    }, FINISH_MS);
}

module.exports = setupSocketManager;
