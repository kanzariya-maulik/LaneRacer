const Game = require('./game/Game');
const Track = require('./game/Track');
const lobby = require('./lobby');
const { withNetSim } = require('./netsim');
const netlog = require('./netlog');

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
    netlog.log(`[SESSION] ${status} | track ${state.settings.trackId} | drivers ${Object.values(state.players).filter((p) => !p.isSpectating).map((p) => p.username).join(', ')}`);
}

let net = null; // WebRTC UDP transport (src/webrtcManager.js); tests pass a stub

function setupSocketManager(io, transport = require('./webrtcManager')) {
    net = transport;
    io.on('connection', (socket) => {
        console.log(`Player connected: ${socket.id}`);
        netlog.log(`[CONNECT] ${socket.id} | ${socket.handshake?.address || '?'} | ${socket.handshake?.headers?.['user-agent'] || '?'}`);
        let lastTelemetry = 0;
        // WebRTC signalling over Socket.IO; inputs arriving on the UDP DataChannel go to the game like socket inputs
        net.setupPeer(socket, (id, inputData) => {
            applyInputLater(id, inputData);
        });
        // Visitors see live team counts before they join
        socket.emit('lobby_state_sync', lobbySnapshot());

        socket.on('join_lobby', (data) => {
            if (state.players[socket.id]) return;
            const check = lobby.canJoinTeam(state.players, data && data.teamId);
            if (!check.ok) return socket.emit('join_error', check.reason);

            const isFirstPlayer = Object.keys(state.players).length === 0;
            state.players[socket.id] = {
                id: socket.id,
                username: lobby.sanitizeUsername(data.username),
                teamId: check.team.id,
                color: check.team.chatColor,
                assist: lobby.sanitizeAssist(data.assist), // each player's own choice, changeable any time
                isReady: false,
                isSpectating: state.status !== 'LOBBY'
            };
            if (isFirstPlayer) state.hostId = socket.id;
            netlog.log(`[JOIN] ${state.players[socket.id].username} (${socket.id}) | team ${check.team.id}`);

            // Everyone (visitors included) needs the new counts and the current host
            io.emit('lobby_state_sync', lobbySnapshot());
            socket.broadcast.emit('player_joined', state.players[socket.id]);

            // Late joiner: give them the running session so the spectator view has something to draw
            if (gameInstance && state.status !== 'LOBBY') socket.emit('game_init', gameInstance.initPayload());
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

        socket.on('update_settings', (settings) => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;
            state.settings = lobby.sanitizeSettings(state.settings, settings, Track.TRACK_IDS);
            io.emit('settings_updated', state.settings);
        });

        socket.on('start_game', () => {
            if (socket.id !== state.hostId || state.status !== 'LOBBY') return;

            const notReady = Object.values(state.players)
                .some(p => p.id !== state.hostId && !p.isReady && !p.isSpectating);
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

        // Every 2 s from each browser: its view of the link, logged with the server's view of this driver's inputs
        socket.on('latency_telemetry', (data) => {
            const player = state.players[socket.id], d = netlog.sanitizeTelemetry(data), now = Date.now();
            if (!player || !d || now - lastTelemetry < 1000) return; // drivers only; a flooding client can't flood the log
            lastTelemetry = now;
            const car = gameInstance?.players[socket.id], f = (v, u = '') => (v === null ? '?' : `${Math.round(v * 10) / 10}${u}`);
            netlog.log(`[NET] ${player.username} (${socket.id}) | ${d.link} ping ${f(d.rttMs, 'ms')} jitter ${f(d.jitterMs, 'ms')} ` +
                `loss ${f(d.lossPct, '%')} delay ${f(d.delayMs, 'ms')} predErr ${f(d.predErrCm, 'cm')} fps ${f(d.fps)}` +
                (car ? ` | late inputs ${car.starveLast ?? 0}/s re-syncs ${car.realigns || 0}` : ''));
        });

        socket.on('disconnect', () => {
            console.log(`Player disconnected: ${socket.id}`);
            netlog.log(`[DISCONNECT] ${state.players[socket.id]?.username ?? 'visitor'} (${socket.id})`);
            net.cleanup(socket.id);
            if (!state.players[socket.id]) return;

            delete state.players[socket.id];
            if (gameInstance) gameInstance.removePlayer(socket.id);
            io.emit('player_left', socket.id);

            if (socket.id === state.hostId) {
                const remaining = Object.keys(state.players);
                if (remaining.length > 0) {
                    state.hostId = remaining[0];
                    io.emit('lobby_state_sync', lobbySnapshot());
                } else {
                    state.hostId = null;
                    clearTimers();
                    if (gameInstance) {
                        gameInstance.stop();
                        gameInstance = null;
                    }
                    state.status = 'LOBBY';
                }
            }
        });
    });
}

function startQuali(io, racers) {
    setStatus(io, 'QUALIFYING');
    gameInstance = new Game(io, racers, TRACKS[state.settings.trackId], state.settings, (results) => {
        setStatus(io, 'QUALI_RESULTS');
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
    const race = new Game(io, grid, TRACKS[state.settings.trackId], state.settings, () => finishRace(io), 'race', net);
    gameInstance = race;
    race.start(); // cars are drawn on the grid, frozen until lights out

    for (let n = 1; n <= 5; n++) later(() => { if (gameInstance === race) io.emit('lights', { count: n }); }, n * 1000);
    later(() => {
        if (gameInstance !== race) return; // race already ended (e.g. its grid emptied)
        io.emit('lights', { count: 0 });
        race.release();
        setStatus(io, 'RACE');
        io.emit('session', { phase: 'RACE', endsInMs: null });
    }, 5000 + 500 + Math.random() * 2000);
}

function finishRace(io) {
    clearTimers(); // pending lights must not fire after the race is over
    setStatus(io, 'FINISHED');
    later(() => {
        state.status = 'LOBBY';
        for (const id in state.players) {
            state.players[id].isReady = false;
            state.players[id].isSpectating = false;
        }
        io.emit('lobby_state_sync', lobbySnapshot());
        gameInstance = null;
    }, FINISH_MS);
}

module.exports = setupSocketManager;
