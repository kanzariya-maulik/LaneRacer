// DOM Elements
const screenLobby = document.getElementById('lobby-screen');
const screenGame = document.getElementById('game-screen');
const playersList = document.getElementById('players-list');
const chatMsgs = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

const btnJoin = document.getElementById('btn-join');
const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');

const inputUser = document.getElementById('username');
const teamGrid = document.getElementById('team-grid');
const controlsPanel = document.getElementById('player-controls');
const hostSettings = document.getElementById('host-settings');

const setTrack = document.getElementById('setting-track');
const setLaps = document.getElementById('setting-laps');
const setQuali = document.getElementById('setting-quali');
const setCollisions = document.getElementById('setting-collisions');
const settingsView = document.getElementById('settings-view');
const MAX_RACERS = 22; // src/lobby.js: grid slots per track
const graphicsSelect = document.getElementById('graphics-select');
try { graphicsSelect.value = localStorage.getItem('lanrace.quality') || 'auto'; } catch (e) { /* storage blocked: Auto */ }
if (!graphicsSelect.value) graphicsSelect.value = 'auto';
graphicsSelect.addEventListener('change', () => {
    (window.lanraceMem ||= {})['lanrace.quality'] = graphicsSelect.value; // applies even when storage is blocked
    try { localStorage.setItem('lanrace.quality', graphicsSelect.value); } catch (e) { /* not remembered */ }
    document.getElementById('graphics-note').textContent = graphicsSelect.value === 'high' || window.lanraceQuality?.level === 'high'
        ? ' Applies next race (anti-aliasing after a page reload)' : ' Applies next race';
});
const lineSelect = document.getElementById('line-select');
try { lineSelect.value = localStorage.getItem('lanrace.line') || 'corners'; } catch (e) { /* storage blocked: default */ }
if (!lineSelect.value) lineSelect.value = 'corners';
lineSelect.addEventListener('change', () => {
    (window.lanraceMem ||= {})['lanrace.line'] = lineSelect.value; // applies even when storage is blocked
    try { localStorage.setItem('lanrace.line', lineSelect.value); } catch (e) { /* not remembered */ }
});

// Personal choices, remembered per browser: assist (sent to the server) and how other cars are drawn
function remembered(id, key, fallback, onChange) {
    const sel = document.getElementById(id);
    try { sel.value = localStorage.getItem(key) || fallback; } catch (e) { /* storage blocked: default */ }
    if (!sel.value) sel.value = fallback;
    (window.lanraceMem ||= {})[key] = sel.value;
    sel.addEventListener('change', () => {
        window.lanraceMem[key] = sel.value;
        try { localStorage.setItem(key, sel.value); } catch (e) { /* not remembered */ }
        onChange?.(sel.value);
    });
    return sel;
}
const assistSelect = remembered('assist-select', 'lanrace.assist', 'full', (v) => window.setAssist?.(v));
remembered('others-select', 'lanrace.others', 'present');
const volumeRange = document.getElementById('volume-range');
try { volumeRange.value = localStorage.getItem('lanrace.volume') ?? 70; } catch (e) { /* default */ }
volumeRange.addEventListener('input', () => window.lanraceAudio?.setVolume(volumeRange.value / 100));
remembered('engine-select', 'lanrace.engine', 'all', (v) => window.lanraceAudio?.setMode(v));
window.setAssist = (v) => { // lobby select and the in-race Q key both land here
    assistSelect.value = v;
    window.lanraceMem['lanrace.assist'] = v;
    try { localStorage.setItem('lanrace.assist', v); } catch (e) { /* not remembered */ }
    if (lastJoin) lastJoin.assist = v;
    if (clientState.players[clientState.me]) socket.emit('set_assist', v); // joined (also after a reconnect)
    window.onAssistChange?.(v);
};

let isJoined = false;
let amReady = false;
let teams = [];
let selectedTeam = null;

fetch('teams.json').then(r => r.json()).then((list) => { teams = list; window.updateLobbyUI(); }); // team names in the driver list too

function teamCounts() {
    const counts = {};
    for (const p of Object.values(clientState.players)) counts[p.teamId] = (counts[p.teamId] || 0) + 1;
    return counts;
}

function renderTeamGrid() {
    const counts = teamCounts();
    // Start on the first team with a free seat so the hero shows a car; any card click changes it before joining
    if (!isJoined && !teams.some((t) => t.id === selectedTeam && (counts[t.id] || 0) < t.maxPlayers)) {
        selectedTeam = teams.find((t) => (counts[t.id] || 0) < t.maxPlayers)?.id ?? null;
    }
    teamGrid.innerHTML = '';
    for (const t of teams) {
        const n = counts[t.id] || 0;
        const full = n >= t.maxPlayers;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'team-card' + (t.id === selectedTeam ? ' selected' : '') + (full ? ' full' : '');
        card.disabled = isJoined || (full && t.id !== selectedTeam);
        card.setAttribute('aria-pressed', t.id === selectedTeam);
        card.title = t.name;
        card.style.setProperty('--team', t.chatColor);

        const img = document.createElement('img');
        img.src = `liveries/${t.id}-thumb.png`;
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'team-name';
        name.textContent = t.name;
        const count = document.createElement('span');
        count.className = 'team-count';
        count.textContent = `${t.car} · ${n}/${t.maxPlayers}`;

        card.append(img, name, count);
        card.addEventListener('click', () => { selectedTeam = t.id; renderTeamGrid(); });
        teamGrid.appendChild(card);
    }
    renderHero();
}

// Big car + team colours for the selected team
const heroCar = document.getElementById('hero-car');
function renderHero() {
    const t = teams.find((x) => x.id === selectedTeam);
    heroCar.hidden = !t;
    if (t && heroCar.getAttribute('src') !== `liveries/${t.id}-thumb.png`) heroCar.src = `liveries/${t.id}-thumb.png`;
    screenLobby.style.setProperty('--team', t ? t.chatColor : '#64748b');
    document.getElementById('hero-team').textContent = t ? t.name : 'Pick your team';
    document.getElementById('hero-sub').textContent = t ? `${t.car} · ${teamCounts()[t.id] || 0}/${t.maxPlayers} seats taken` : `${teams.length || 11} teams · 2 seats each`;
}

function setJoinedUI(joined) {
    isJoined = joined;
    inputUser.disabled = joined;
    btnJoin.classList.toggle('hidden', joined);
    controlsPanel.classList.toggle('hidden', !joined);
    renderTeamGrid();
}

inputUser.focus();

btnJoin.addEventListener('click', () => {
    if (!selectedTeam) return window.appendChat('SYSTEM', '#f43f5e', 'Pick a team first.');
    const username = inputUser.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    lastJoin = { username, teamId: selectedTeam, assist: assistSelect.value };
    window.lanraceAudio?.unlock(); // the click is the gesture browsers need to start sound
    socket.emit('join_lobby', lastJoin);
    setJoinedUI(true);
});

// A reconnect (WiFi drop, sleep, server restart) is a new socket the server doesn't know: join again as the same driver
let lastJoin = null;
socket.on('connect', () => {
    if (!lastJoin || !isJoined) return;
    amReady = false;
    btnReady.innerText = 'Ready Up';
    socket.emit('join_lobby', lastJoin);
});

window.handleJoinError = (reason) => {
    setJoinedUI(false);
    window.appendChat('SYSTEM', '#f43f5e', reason);
};

btnReady.addEventListener('click', () => {
    amReady = !amReady;
    socket.emit('toggle_ready', amReady);
    btnReady.innerText = amReady ? 'Unready' : 'Ready Up';
    btnReady.classList.toggle('primary', !amReady);
    btnReady.classList.toggle('success', amReady);
});

btnStart.addEventListener('click', () => {
    socket.emit('start_game');
});

function emitSettings() {
    socket.emit('update_settings', {
        trackId: setTrack.value,
        maxLaps: parseInt(setLaps.value, 10),
        qualifying: setQuali.value === '1',
        collisions: setCollisions.value === '1'
    });
}
setTrack.addEventListener('change', emitSettings);
setLaps.addEventListener('change', emitSettings);
setQuali.addEventListener('change', emitSettings);
setCollisions.addEventListener('change', emitSettings);

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value.trim() === '') return;
    if (!isJoined) return window.appendChat('SYSTEM', '#f43f5e', 'Join the lobby first to chat.');
    socket.emit('chat_msg', chatInput.value);
    chatInput.value = '';
});

window.updateLobbyUI = () => {
    playersList.innerHTML = '';
    const myId = clientState.me;
    const amHost = clientState.hostId === myId;

    const entries = Object.entries(clientState.players);
    entries.forEach(([id, player], i) => {
        const li = document.createElement('li');
        li.className = 'player-item' + (id === myId ? ' me' : '');

        const num = document.createElement('span');
        num.className = 'player-num';
        num.textContent = String(i + 1).padStart(2, '0');

        const colorIndicator = document.createElement('span');
        colorIndicator.className = 'player-color';
        colorIndicator.style.backgroundColor = player.color;

        const nameNode = document.createElement('span');
        nameNode.className = 'player-name';
        nameNode.textContent = player.username + (id === myId ? ' (You)' : '');
        const teamNode = document.createElement('span');
        teamNode.className = 'player-team';
        teamNode.textContent = teams.find((t) => t.id === player.teamId)?.name || '';
        nameNode.append(teamNode);

        const statusNode = document.createElement('span');
        statusNode.className = 'player-status';
        if (player.isSpectating) {
            statusNode.classList.add('spectating');
            statusNode.textContent = 'Spectating';
        } else if (id === clientState.hostId) {
            statusNode.classList.add('host');
            statusNode.textContent = 'Host';
        } else if (player.isReady) {
            statusNode.classList.add('ready');
            statusNode.textContent = 'Ready';
        } else {
            statusNode.textContent = 'Waiting';
        }

        li.append(num, colorIndicator, nameNode, statusNode);
        playersList.appendChild(li);
    });
    // A few open grid slots so a quiet lobby still reads as a grid waiting to fill
    for (let i = entries.length; i < Math.min(MAX_RACERS, Math.max(4, entries.length + 1)); i++) {
        const li = document.createElement('li');
        li.className = 'player-item open';
        const num = Object.assign(document.createElement('span'), { className: 'player-num', textContent: String(i + 1).padStart(2, '0') });
        li.append(num, Object.assign(document.createElement('span'), { className: 'player-color' }),
            Object.assign(document.createElement('span'), { className: 'player-name', textContent: 'Open slot' }));
        playersList.appendChild(li);
    }
    document.getElementById('driver-count').textContent = `${entries.length} / ${MAX_RACERS}`;

    if (amHost) {
        hostSettings.classList.remove('hidden');
        btnReady.classList.add('hidden');
    } else {
        hostSettings.classList.add('hidden');
        if (isJoined) btnReady.classList.remove('hidden');
    }
    settingsView.classList.toggle('hidden', amHost); // the host edits; everyone else reads

    const me = clientState.players[myId];
    const spOverlay = document.getElementById('spectator-overlay');
    if (clientState.status === 'LOBBY' || !me) {
        // Visitors who haven't joined stay in the lobby even mid-race
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        // Server state wins: syncs arrive whenever anyone joins, so don't reset a ready player
        amReady = !!me?.isReady;
        btnReady.innerText = amReady ? 'Unready' : 'Ready Up';
        btnReady.classList.toggle('primary', !amReady);
        btnReady.classList.toggle('success', amReady);
    } else {
        screenLobby.classList.add('hidden');
        screenGame.classList.remove('hidden');
        spOverlay.classList.toggle('hidden', !me.isSpectating);
    }

    renderTeamGrid();
};

window.updateSettingsUI = () => {
    setTrack.value = clientState.settings.trackId;
    setLaps.value = clientState.settings.maxLaps;
    setQuali.value = clientState.settings.qualifying ? '1' : '0';
    setCollisions.value = clientState.settings.collisions === false ? '0' : '1';

    // Header chips and the read-only view non-hosts see
    const s = clientState.settings;
    const track = setTrack.selectedOptions[0]?.textContent || s.trackId;
    const rows = [['Track', track], ['Laps', s.maxLaps], ['Qualifying', s.qualifying ? 'On' : 'Off'], ['Collisions', s.collisions === false ? 'Off' : 'On']];
    settingsView.replaceChildren(...rows.map(([k, v]) => {
        const d = document.createElement('div');
        d.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
        return d;
    }));
    document.getElementById('session-summary').replaceChildren(...[track, `${s.maxLaps} ${s.maxLaps === 1 ? 'lap' : 'laps'}`,
        `Quali ${s.qualifying ? 'on' : 'off'}`, `Collisions ${s.collisions === false ? 'off' : 'on'}`]
        .map((text) => Object.assign(document.createElement('span'), { textContent: text })));
};
window.updateSettingsUI();

window.appendChat = (username, color, msg) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const author = document.createElement('span');
    author.className = 'chat-author';
    author.style.color = color;
    author.textContent = `${username}:`;
    const body = document.createElement('span');
    body.textContent = msg;
    div.append(author, ' ', body);
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
};

window.handleStatusChange = (status) => {
    const cdOverlay = document.getElementById('countdown-overlay');
    const spOverlay = document.getElementById('spectator-overlay');
    const results = document.getElementById('quali-results');
    const raceResults = document.getElementById('race-results');
    const lights = document.getElementById('lights');

    if (status === 'LOBBY') {
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        [cdOverlay, spOverlay, results, lights].forEach(el => el.classList.add('hidden')); // the race classification stays up over the lobby
        return;
    }

    const me = clientState.players[clientState.me];
    if (!me) return; // visitors who haven't joined stay in the lobby

    screenLobby.classList.add('hidden');
    screenGame.classList.remove('hidden');
    spOverlay.classList.toggle('hidden', !me.isSpectating);
    cdOverlay.classList.add('hidden');
    results.classList.toggle('hidden', status !== 'QUALI_RESULTS');

    if (status === 'COUNTDOWN') {
        lights.classList.remove('hidden');
        lights.querySelectorAll('.light').forEach(l => l.classList.remove('on'));
    } else if (status === 'FINISHED' && !clientState.raceResults) { // the classification replaces the FINISH! banner
        cdOverlay.classList.remove('hidden');
        document.getElementById('countdown-text').innerText = 'FINISH!';
    }
};
