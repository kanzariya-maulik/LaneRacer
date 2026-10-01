const socket = io();

// Shared Client State
let clientState = {
    me: null,
    players: {},
    hostId: null,
    status: 'LOBBY',
    settings: { trackId: 1, maxLaps: 3, maxSpeed: 400 },
    gameState: null,
    trackData: null // static track geometry
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
    if (window.updateLobbyUI) window.updateLobbyUI();
});

socket.on('player_joined', (player) => {
    clientState.players[player.id] = player;
    window.appendChat('SYSTEM', '#10b981', `${player.username} joined!`);
    if (window.updateLobbyUI) window.updateLobbyUI();
});

socket.on('player_left', (id) => {
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

socket.on('countdown', (count) => {
    const el = document.getElementById('countdown-text');
    if (el) el.innerText = count > 0 ? count : 'GO!';
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
