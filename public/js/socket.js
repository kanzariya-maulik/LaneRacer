const socket = io();

// Shared Client State
let clientState = {
    me: null,
    players: {},
    hostId: null,
    status: 'LOBBY',
    settings: { trackId: 'monza', maxLaps: 3, qualiMinutes: 3 },
    gameState: null,
    trackData: null, // static track geometry
    session: null,      // { phase, endsAt } — endsAt in local ms, null for open-ended
    qualiResults: null,
    lastTiming: null,
};

socket.on('connect', () => {
    clientState.me = socket.id;
});

// LOBBY SYNCS
socket.on('lobby_state_sync', (state) => {
    clientState.players = state.players;
    clientState.hostId = state.hostId;
    clientState.status = state.status;
    clientState.settings = state.settings;
    if (state.status === 'LOBBY') {
        // Drop the finished race so the next countdown doesn't treat its data as current
        clientState.gameState = null;
        clientState.trackData = null;
        clientState.session = null;
    }
    if (window.updateLobbyUI) window.updateLobbyUI();
    if (window.updateSettingsUI) window.updateSettingsUI();
});

socket.on('join_error', (reason) => {
    if (window.handleJoinError) window.handleJoinError(reason);
});

socket.on('player_joined', (player) => {
    clientState.players[player.id] = player;
    window.appendChat('SYSTEM', '#10b981', `${player.username} joined!`);
    if (window.updateLobbyUI) window.updateLobbyUI();
});

socket.on('player_left', (id) => {
    if (clientState.gameState) delete clientState.gameState[id];
    if (clientState.players[id]) {
        window.appendChat('SYSTEM', '#f43f5e', `${clientState.players[id].username} left.`);
        delete clientState.players[id];
        if (window.updateLobbyUI) window.updateLobbyUI();
    }
});

socket.on('player_ready_sync', (data) => {
    if (clientState.players[data.id]) {
        clientState.players[data.id].isReady = data.isReady;
        if (window.updateLobbyUI) window.updateLobbyUI();
    }
});

socket.on('settings_updated', (settings) => {
    clientState.settings = settings;
    if (window.updateSettingsUI) window.updateSettingsUI();
});

socket.on('chat_msg', (data) => {
    window.appendChat(data.username, data.color, data.msg);
});

// GAME SYNCS
socket.on('status_change', (status) => {
    clientState.status = status;
    if (window.handleStatusChange) window.handleStatusChange(status);
});


socket.on('game_init', (data) => {
    clientState.gameState = data.players;
    clientState.trackData = data.track;
    if (window.initGameVisuals) window.initGameVisuals();
});

// This comes in 60 times a second
socket.on('game_state', (stateSync) => {
    // Merge updates into local state
    for(let id in stateSync) {
        if (clientState.gameState && clientState.gameState[id]) {
            Object.assign(clientState.gameState[id], stateSync[id]);
        }
    }
});

socket.on('lights', ({ count }) => {
    if (window.handleLights) window.handleLights(count);
});

socket.on('session', ({ phase, endsInMs }) => {
    clientState.session = { phase, endsAt: endsInMs === null ? null : Date.now() + endsInMs };
});

socket.on('quali_results', (list) => {
    clientState.qualiResults = list;
    if (window.showQualiResults) window.showQualiResults(list);
});

socket.on('timing', (t) => {
    clientState.lastTiming = t;
    if (t.id === clientState.me) {
        const el = document.getElementById('lt-last');
        el.classList.remove('t-flash');
        void el.offsetWidth; // restart the animation
        el.classList.add('t-flash');
    }
});
