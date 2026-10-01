// DOM Elements
const screenLobby = document.getElementById('lobby-screen');
const screenGame = document.getElementById('game-screen');
const playersList = document.getElementById('players-list');
const chatMsgs = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// Buttons
const btnJoin = document.getElementById('btn-join');
const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');

// Inputs
const inputUser = document.getElementById('username');
const inputColor = document.getElementById('car-color');
const controlsPanel = document.getElementById('player-controls');
const hostSettings = document.getElementById('host-settings');

const setTrack = document.getElementById('setting-track');
const setLaps = document.getElementById('setting-laps');
const setSpeed = document.getElementById('setting-speed');

let isJoined = false;
let amReady = false;
let selectedColor = '#ef4444';

const swatches = document.querySelectorAll('.swatch');
const customColorInput = document.getElementById('car-color');
const customColorWrapper = document.querySelector('.custom-color-wrapper');

swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        swatches.forEach(s => s.classList.remove('selected'));
        customColorWrapper.classList.remove('selected');
        
        swatch.classList.add('selected');
        selectedColor = swatch.getAttribute('data-color');
    });
});

customColorInput.addEventListener('input', (e) => {
    swatches.forEach(s => s.classList.remove('selected'));
    customColorWrapper.classList.add('selected');
    selectedColor = e.target.value;
});

// Attempt to auto-focus username
inputUser.focus();

btnJoin.addEventListener('click', () => {
    const username = inputUser.value.trim() || `Player${Math.floor(Math.random()*1000)}`;
    const color = selectedColor;
    
    socket.emit('join_lobby', { username, color });
    
    inputUser.disabled = true;
    swatches.forEach(s => s.style.pointerEvents = 'none');
    customColorInput.disabled = true;
    customColorWrapper.style.pointerEvents = 'none';
    btnJoin.classList.add('hidden');
    controlsPanel.classList.remove('hidden');
    isJoined = true;
});

btnReady.addEventListener('click', () => {
    amReady = !amReady;
    socket.emit('toggle_ready', amReady);
    btnReady.innerText = amReady ? 'Unready' : 'Ready Up';
    if(amReady) {
        btnReady.classList.remove('primary');
        btnReady.classList.add('success');
    } else {
        btnReady.classList.add('primary');
        btnReady.classList.remove('success');
    }
});

btnStart.addEventListener('click', () => {
    socket.emit('start_game');
});

// Settings Changes
function emitSettings() {
    socket.emit('update_settings', { 
        trackId: parseInt(setTrack.value), 
        maxLaps: parseInt(setLaps.value),
        maxSpeed: parseInt(setSpeed.value) * 5 // Scale the UI 160 back up to internal 800
    });
}
setTrack.addEventListener('change', emitSettings);
setLaps.addEventListener('change', emitSettings);
setSpeed.addEventListener('change', emitSettings);

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if(chatInput.value.trim() === '') return;
    if(!isJoined) return alert("Join lobby first to chat");
    
    socket.emit('chat_msg', chatInput.value);
    chatInput.value = '';
});

// View Updates Exported to window
window.updateLobbyUI = () => {
    // 1. Update Players List
    playersList.innerHTML = '';
    const myId = clientState.me;
    let amHost = clientState.hostId === myId;
    
    for (const [id, player] of Object.entries(clientState.players)) {
        const li = document.createElement('li');
        li.className = 'player-item';
        
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'player-color';
        colorIndicator.style.backgroundColor = player.color;
        
        const nameNode = document.createElement('span');
        nameNode.className = 'player-name';
        nameNode.innerText = player.username + (id === myId ? ' (You)' : '');
        
        const statusNode = document.createElement('span');
        statusNode.className = 'player-status';
        
        if (player.isSpectating) {
            statusNode.classList.add('spectating');
            statusNode.innerText = 'Spectating';
        } else if (id === clientState.hostId) {
            statusNode.classList.add('host');
            statusNode.innerText = 'Host';
        } else if (player.isReady) {
            statusNode.classList.add('ready');
            statusNode.innerText = 'Ready';
        } else {
            statusNode.innerText = 'Waiting';
        }

        li.appendChild(colorIndicator);
        li.appendChild(nameNode);
        li.appendChild(statusNode);
        playersList.appendChild(li);
    }
    
    // 2. Update Host Settings Visibility
    if (amHost) {
        hostSettings.classList.remove('hidden');
        btnReady.classList.add('hidden'); // host doesn't need to ready up
    } else {
        hostSettings.classList.add('hidden');
        if (isJoined) btnReady.classList.remove('hidden');
    }

    // 3. View Switch check
    if(clientState.status !== 'LOBBY' && !clientState.players[myId]?.isSpectating) {
        screenLobby.classList.add('hidden');
        screenGame.classList.remove('hidden');
    } else if (clientState.status === 'LOBBY') {
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        
        // Reset local ready state visually
        amReady = false;
        btnReady.innerText = 'Ready Up';
        btnReady.classList.add('primary');
        btnReady.classList.remove('success');
    } else if (clientState.players[myId]?.isSpectating) {
        // If spectating a running game
        screenLobby.classList.add('hidden');
        screenGame.classList.remove('hidden');
        document.getElementById('spectator-overlay').classList.remove('hidden');
    }
};

window.updateSettingsUI = () => {
    setTrack.value = clientState.settings.trackId;
    setLaps.value = clientState.settings.maxLaps;
    if(clientState.settings.maxSpeed) {
        setSpeed.value = clientState.settings.maxSpeed / 5; // Scale internal 800 down to UI 160
    }
};

window.appendChat = (username, color, msg) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-author" style="color:${color}">${username}:</span> <span>${msg}</span>`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
};

window.handleStatusChange = (status) => {
    const cdOverlay = document.getElementById('countdown-overlay');
    const spOverlay = document.getElementById('spectator-overlay');
    
    if (status === 'COUNTDOWN') {
        screenLobby.classList.add('hidden');
        screenGame.classList.remove('hidden');
        cdOverlay.classList.remove('hidden');
        if(clientState.players[clientState.me]?.isSpectating) {
            spOverlay.classList.remove('hidden');
        } else {
            spOverlay.classList.add('hidden');
        }
    } else if (status === 'RACE') {
        cdOverlay.classList.add('hidden');
    } else if (status === 'FINISHED') {
        cdOverlay.classList.remove('hidden');
        document.getElementById('countdown-text').innerText = 'FINISH!';
    } else if (status === 'LOBBY') {
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        cdOverlay.classList.add('hidden');
        spOverlay.classList.add('hidden');
    }
};
