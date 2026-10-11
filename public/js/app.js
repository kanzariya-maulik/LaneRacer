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
const setOutLaps = document.getElementById('setting-outlaps');
const setQualiLaps = document.getElementById('setting-qualilaps');
const setCollisions = document.getElementById('setting-collisions');
const setGhost = document.getElementById('setting-ghost');
const setTyres = document.getElementById('setting-tyres');
const setPenalties = document.getElementById('setting-penalties');
const setTime = document.getElementById('setting-time');
const setHelp = document.getElementById('setting-help');
const setHelpBrake = document.getElementById('setting-help-brake');
const setHelpSteer = document.getElementById('setting-help-steer');
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
    if (!sel) return null;
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

let lastJoin = null; // declared before the assist restore below reads it (join / reconnect state)

// ── Driver help: braking Off / Low / High, steering Off / On (sent as 'steer,brake' percent) ──
const helpBrake = document.getElementById('help-brake');
const helpSteer = document.getElementById('help-steer');
const BRAKE_HINTS = { 0: 'Off: you brake and lift. Fastest if you brake late', 50: 'Low: saves you if you would miss a corner, costs time', 100: 'High: brakes and lifts for you, a few % slower a lap' };
let helpLevels = { steer: 100, brake: 100 };

// Same snapping as carphysics.snapAssist: old slider values land on the nearest level
function parseHelp(str) {
    if (str === 'off') return { steer: 0, brake: 0 };
    const [s, b] = String(str).split(',').map(Number);
    if (!Number.isFinite(s) || !Number.isFinite(b)) return { steer: 100, brake: 100 };
    return { steer: s >= 50 ? 100 : 0, brake: b < 25 ? 0 : b < 75 ? 50 : 100 };
}
const fixedHelp = () => (clientState.settings?.help?.mode === 'fixed' ? clientState.settings.help : null);

function renderHelp() {
    const fixed = fixedHelp(), lv = fixed || helpLevels;
    for (const [group, v] of [[helpBrake, lv.brake], [helpSteer, lv.steer]]) {
        group.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', +b.dataset.v === v); b.disabled = !!fixed; });
    }
    document.getElementById('help-brake-hint').textContent = BRAKE_HINTS[lv.brake];
    document.getElementById('help-note').textContent = fixed ? 'Set by the host for everyone' : 'Q cycles braking help during a race';
}

function applyAssistString(str) {
    helpLevels = parseHelp(str);
    const v = `${helpLevels.steer},${helpLevels.brake}`;
    (window.lanraceMem ||= {})['lanrace.assist'] = v;
    if (lastJoin) lastJoin.assist = v;
    renderHelp();
    if (!fixedHelp()) window.onAssistChange?.(v); // fixed: the car keeps the host's levels
    try { localStorage.setItem('lanrace.assist', v); } catch (e) { /* blocked */ }
    if (clientState.players?.[clientState.me]) socket.emit('set_assist', v);
}

helpBrake.addEventListener('click', (e) => { const v = e.target.dataset?.v; if (v !== undefined) applyAssistString(`${helpLevels.steer},${v}`); });
helpSteer.addEventListener('click', (e) => { const v = e.target.dataset?.v; if (v !== undefined) applyAssistString(`${v},${helpLevels.brake}`); });

// Global entry point used by game3d.js (Q key / gamepad) and the auto-restore below
window.setAssist = (v) => applyAssistString(v);

// Restore saved assist on page load
(function restoreAssist() {
    try {
        const saved = localStorage.getItem('lanrace.assist');
        applyAssistString(saved || '100,100');
    } catch (e) {
        applyAssistString('100,100');
    }
})();

// Other remembered selects
remembered('others-select', 'lanrace.others', 'present');
const volumeRange = document.getElementById('volume-range');
try { volumeRange.value = localStorage.getItem('lanrace.volume') ?? 70; } catch (e) { /* default */ }
volumeRange.addEventListener('input', () => window.lanraceAudio?.setVolume(volumeRange.value / 100));
remembered('engine-select', 'lanrace.engine', 'all', (v) => window.lanraceAudio?.setMode(v));
remembered('engine-type-select', 'lanrace.engineType', 'v8', (v) => window.lanraceAudio?.setEngineType(v));

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

// Name and team stay editable after joining, but only in the lobby (mid-session the car and livery are in use)
const canEditProfile = () => !isJoined || clientState.status === 'LOBBY';

// The server's copy of me wins: keep the picker, the name field and a reconnect's rejoin in step with it
function syncProfile() {
    const me = isJoined && clientState.players[clientState.me];
    if (!me) return;
    selectedTeam = me.teamId;
    if (lastJoin) Object.assign(lastJoin, { username: me.username, teamId: me.teamId });
    if (document.activeElement !== inputUser) inputUser.value = me.username;
}

// Joined: the Join button becomes Save, shown only while the typed name differs from the current one
function renderNameField() {
    const me = isJoined && clientState.players[clientState.me];
    inputUser.disabled = !canEditProfile();
    btnJoin.textContent = isJoined ? 'Save' : 'Join ▶';
    btnJoin.classList.toggle('hidden', isJoined && (!me || !canEditProfile() || inputUser.value.trim() === me.username || !inputUser.value.trim()));
}
inputUser.addEventListener('input', renderNameField);
inputUser.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnJoin.classList.contains('hidden')) btnJoin.click(); });

function renderTeamGrid() {
    syncProfile();
    renderNameField();
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
        card.disabled = !canEditProfile() || (full && t.id !== selectedTeam);
        card.setAttribute('aria-pressed', t.id === selectedTeam);
        card.title = t.name;
        card.style.setProperty('--team', t.chatColor);

        const swatch = document.createElement('span');
        swatch.className = 'team-swatch';
        const name = document.createElement('span');
        name.className = 'team-name';
        name.textContent = t.name;
        const count = document.createElement('span');
        count.className = 'team-count';
        count.textContent = `${n}/${t.maxPlayers}`;
        count.setAttribute('aria-label', `${n} of ${t.maxPlayers} seats taken`);

        card.append(swatch, name, count);
        card.addEventListener('click', () => {
            if (t.id === selectedTeam) return;
            if (isJoined) return socket.emit('update_profile', { teamId: t.id }); // switches once the server says the seat is free
            selectedTeam = t.id;
            renderTeamGrid();
        });
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
    controlsPanel.classList.toggle('hidden', !joined);
    renderTeamGrid();
}

inputUser.focus();
// Wide, tall screens have room for My settings next to the teams: start it open there
if (matchMedia('(min-width: 1281px) and (min-height: 900px)').matches) document.querySelector('.my-settings').open = true;

const compoundSelect = document.getElementById('compound-select');
try { compoundSelect.value = localStorage.getItem('lanrace.compound') || 'M'; } catch (e) { /* storage blocked */ }
compoundSelect.addEventListener('change', () => {
    try { localStorage.setItem('lanrace.compound', compoundSelect.value); } catch (e) { /* storage blocked */ }
    socket.emit('set_compound', compoundSelect.value);
});

btnJoin.addEventListener('click', () => {
    if (isJoined) { // Save: a new name for the driver already on the grid
        socket.emit('update_profile', { username: inputUser.value });
        inputUser.blur();
        return;
    }
    if (!selectedTeam) return window.appendChat('SYSTEM', '#f43f5e', 'Pick a team first.');
    const username = inputUser.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    lastJoin = { username, teamId: selectedTeam, assist: `${helpLevels.steer},${helpLevels.brake}`, compound: compoundSelect.value };
    window.lanraceAudio?.unlock(); // the click is the gesture browsers need to start sound
    socket.emit('join_lobby', lastJoin);
    setJoinedUI(true);
});

// Removed by the host: back to the join screen (and not auto-rejoined on a reconnect); joining again is allowed
socket.on('kicked', () => {
    lastJoin = null;
    amReady = false;
    setJoinedUI(false);
    window.appendChat('SYSTEM', '#f43f5e', 'You were removed by the host. You can join again.');
});

// A reconnect (WiFi drop, sleep, server restart) is a new socket the server doesn't know: join again as the same driver
socket.on('connect', () => {
    if (!lastJoin || !isJoined) return;
    amReady = false;
    btnReady.innerText = 'Ready Up';
    socket.emit('join_lobby', lastJoin);
});

socket.on('profile_error', (reason) => window.appendChat('SYSTEM', '#f43f5e', reason));

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
        timeOfDay: setTime.value,
        maxLaps: parseInt(setLaps.value, 10),
        qualifying: setQuali.value === '1',
        outLaps: parseInt(setOutLaps.value, 10),
        qualiLaps: parseInt(setQualiLaps.value, 10),
        collisions: setCollisions.value === '1',
        ghostStart: setGhost.value === '1',
        tyreWear: setTyres.value === '1',
        contactPenalties: setPenalties.value === '1',
        help: { mode: setHelp.value, brake: +setHelpBrake.value, steer: +setHelpSteer.value }
    });
}
setTrack.addEventListener('change', emitSettings);
setLaps.addEventListener('change', emitSettings);
setQuali.addEventListener('change', emitSettings);
setOutLaps.addEventListener('change', emitSettings);
setQualiLaps.addEventListener('change', emitSettings);
setCollisions.addEventListener('change', emitSettings);
setGhost.addEventListener('change', emitSettings);
setTyres.addEventListener('change', emitSettings);
setPenalties.addEventListener('change', emitSettings);
setTime.addEventListener('change', emitSettings);
[setHelp, setHelpBrake, setHelpSteer].forEach((el) => el.addEventListener('change', emitSettings));

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
        if (amHost && id !== myId) { // the host can remove anyone else
            const kick = Object.assign(document.createElement('button'), { className: 'kick-btn', textContent: '✕', title: `Remove ${player.username}` });
            kick.setAttribute('aria-label', `Remove ${player.username}`);
            kick.addEventListener('click', () => socket.emit('kick_player', id));
            li.append(kick);
        }
        playersList.appendChild(li);
    });
    // A few open grid slots so a quiet lobby still reads as a grid waiting to fill
    for (let i = entries.length; i < Math.min(MAX_RACERS, Math.max(12, entries.length + 1)); i++) {
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
    setTime.value = clientState.settings.timeOfDay === 'night' ? 'night' : 'day';
    setQuali.value = clientState.settings.qualifying ? '1' : '0';
    setOutLaps.value = clientState.settings.outLaps ?? 1;
    setQualiLaps.value = clientState.settings.qualiLaps ?? 2;
    document.querySelectorAll('.quali-only').forEach((el) => el.classList.toggle('hidden', !clientState.settings.qualifying));
    setCollisions.value = clientState.settings.collisions === false ? '0' : '1';
    setGhost.value = clientState.settings.ghostStart === false ? '0' : '1';
    setTyres.value = clientState.settings.tyreWear === false ? '0' : '1';
    setPenalties.value = clientState.settings.contactPenalties === false ? '0' : '1';
    const help = clientState.settings.help || { mode: 'choose', steer: 100, brake: 100 };
    setHelp.value = help.mode;
    setHelpBrake.value = String(help.brake);
    setHelpSteer.value = String(help.steer);
    document.querySelectorAll('.help-fixed-only').forEach((el) => el.classList.toggle('hidden', help.mode !== 'fixed'));
    renderHelp();
    document.querySelectorAll('.collisions-only').forEach((el) => el.classList.toggle('hidden', clientState.settings.collisions === false));

    // Header chips and the read-only view non-hosts see
    const s = clientState.settings;
    const track = setTrack.selectedOptions[0]?.textContent || s.trackId;
    const out = s.outLaps ?? 1, timed = s.qualiLaps ?? 2, quali = s.qualifying ? `${out} out + ${timed} timed` : 'Off';
    const time = s.timeOfDay === 'night' ? 'Night' : 'Day';
    const rows = [['Track', track], ['Time', time], ['Laps', s.maxLaps], ['Qualifying', quali], ['Collisions', s.collisions === false ? 'Off' : s.contactPenalties === false ? 'On, no penalties' : 'On, penalties'], ['Tyre wear', s.tyreWear === false ? 'Off' : 'On'],
        ['Driver help', help.mode === 'fixed' ? `Same for all: braking ${{ 0: 'Off', 50: 'Low', 100: 'High' }[help.brake]}, steering ${help.steer ? 'On' : 'Off'}` : 'Each driver chooses']];
    settingsView.replaceChildren(...rows.map(([k, v]) => {
        const d = document.createElement('div');
        d.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
        return d;
    }));
    document.getElementById('session-summary').replaceChildren(...[track, time, `${s.maxLaps} ${s.maxLaps === 1 ? 'lap' : 'laps'}`,
        s.qualifying ? `Quali ${out}+${timed}` : 'Quali off', `Collisions ${s.collisions === false ? 'off' : 'on'}`]
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
    renderTeamGrid(); // name and team lock for the session, unlock back in the lobby
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
        cdOverlay.classList.remove('hidden', 'resume', 'go', 'tick'); // not the resume count's look
        document.getElementById('countdown-label').classList.add('hidden');
        document.getElementById('countdown-text').innerText = 'FINISH!';
    }
};
