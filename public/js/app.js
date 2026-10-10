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
const setPenalties = document.getElementById('setting-penalties');
const setTrackLimits = document.getElementById('setting-track-limits');
const setHidePenalties = document.getElementById('setting-hide-penalties');
const setBot = document.getElementById('setting-bot');
const setMaxSpeed = document.getElementById('setting-max-speed');
const setAcceleration = document.getElementById('setting-acceleration');
const setTime = document.getElementById('setting-time');
const settingsView = document.getElementById('settings-view');
const MAX_RACERS = 22; // src/lobby.js: grid slots per track

try {
    const savedHostSettings = JSON.parse(localStorage.getItem('lanrace.hostSettings'));
    if (savedHostSettings && typeof savedHostSettings === 'object') {
        if (savedHostSettings.trackId && setTrack) setTrack.value = savedHostSettings.trackId;
        if (savedHostSettings.maxLaps && setLaps) setLaps.value = savedHostSettings.maxLaps;
        if (savedHostSettings.timeOfDay && setTime) setTime.value = savedHostSettings.timeOfDay;
        if (savedHostSettings.qualifying !== undefined && setQuali) setQuali.value = savedHostSettings.qualifying ? '1' : '0';
        if (savedHostSettings.outLaps && setOutLaps) setOutLaps.value = savedHostSettings.outLaps;
        if (savedHostSettings.qualiLaps && setQualiLaps) setQualiLaps.value = savedHostSettings.qualiLaps;
        if (savedHostSettings.collisions !== undefined && setCollisions) setCollisions.value = savedHostSettings.collisions ? '1' : '0';
        if (savedHostSettings.contactPenalties !== undefined && setPenalties) setPenalties.value = savedHostSettings.contactPenalties ? '1' : '0';
        if (savedHostSettings.hidePenaltiesDuringRace !== undefined && setHidePenalties) setHidePenalties.value = savedHostSettings.hidePenaltiesDuringRace ? '1' : '0';
        if (savedHostSettings.trackLimits !== undefined && setTrackLimits) setTrackLimits.value = savedHostSettings.trackLimits ? '1' : '0';
        if (savedHostSettings.botCar !== undefined && setBot) setBot.value = savedHostSettings.botCar ? '1' : '0';
        if (savedHostSettings.maxSpeed !== undefined && setMaxSpeed) setMaxSpeed.value = savedHostSettings.maxSpeed;
        if (savedHostSettings.acceleration !== undefined && setAcceleration) setAcceleration.value = savedHostSettings.acceleration;
    }
} catch (e) {}
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

// ── Assist sliders ──────────────────────────────────────────────────────────
const assistBrakeSlider = document.getElementById('assist-brake-slider');
const assistBrakeVal    = document.getElementById('assist-brake-val');

function updateSliderTrack(slider) {
    if (!slider) return;
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

function getAssistString() {
    const b = assistBrakeSlider ? +assistBrakeSlider.value : 100;
    return `100,${b}`;
}

function applyAssistString(str, instantSave = false) {
    // Steer is always 100. Brake assists from 0% to 100%
    const s = 100;
    let b = 100;
    if (str === 'off' || str === '100,0' || str === '0,0') {
        b = 0;
    } else if (str === 'full' || str === '100,100') {
        b = 100;
    } else {
        const parts = String(str).split(',');
        if (parts.length >= 2) {
            const pb = parseFloat(parts[1]);
            if (Number.isFinite(pb)) b = Math.max(0, Math.min(100, Math.round(pb)));
        } else if (parts.length === 1) {
            const pb = parseFloat(parts[0]);
            if (Number.isFinite(pb)) b = Math.max(0, Math.min(100, Math.round(pb)));
        }
    }
    if (assistBrakeSlider) { assistBrakeSlider.value = b; updateSliderTrack(assistBrakeSlider); }
    if (assistBrakeVal)    assistBrakeVal.textContent = `${b}%`;
    const v = `${s},${b}`;
    (window.lanraceMem ||= {})['lanrace.assist'] = v;
    if (lastJoin) lastJoin.assist = v;
    window.onAssistChange?.(v);
    if (instantSave) {
        try { localStorage.setItem('lanrace.assist', v); } catch (e) { /* blocked */ }
        if (clientState.players?.[clientState.me]) socket.emit('set_assist', v);
    } else {
        debouncedSaveAssist(v);
    }
}

function onAssistSliderInput() {
    if (assistBrakeSlider) { updateSliderTrack(assistBrakeSlider); if (assistBrakeVal) assistBrakeVal.textContent = `${assistBrakeSlider.value}%`; }
    applyAssistString(getAssistString(), false);
}

assistBrakeSlider?.addEventListener('input', onAssistSliderInput);

let _saveAssistTimer = null;
function debouncedSaveAssist(v) {
    clearTimeout(_saveAssistTimer);
    _saveAssistTimer = setTimeout(() => {
        try { localStorage.setItem('lanrace.assist', v); } catch (e) { /* blocked */ }
        if (clientState.players?.[clientState.me]) socket.emit('set_assist', v);
    }, 300);
}

// Global entry point used by game3d.js (Q key / gamepad) and the auto-restore below
window.setAssist = (v, instantSave = false) => { applyAssistString(v, instantSave); };

// Restore saved assist on page load
(function restoreAssist() {
    try {
        const saved = localStorage.getItem('lanrace.assist');
        applyAssistString(saved || '100,100', true);
    } catch (e) {
        applyAssistString('100,100', true);
    }
})();

// Other remembered selects
remembered('others-select', 'lanrace.others', 'present');
const volumeRange = document.getElementById('volume-range');
try { volumeRange.value = localStorage.getItem('lanrace.volume') ?? 70; } catch (e) { /* default */ }
volumeRange.addEventListener('input', () => window.lanraceAudio?.setVolume(volumeRange.value / 100));
remembered('engine-select', 'lanrace.engine', 'all', (v) => window.lanraceAudio?.setMode(v));
remembered('engine-type-select', 'lanrace.engineType', 'v8', (v) => window.lanraceAudio?.setEngineType(v));
remembered('autobrake-select', 'lanrace.autobrake', 'on', (v) => { (window.lanraceMem ||= {})['lanrace.autobrake'] = v; });
remembered('music-select', 'lanrace.music', 'off', (v) => window.lanraceAudio?.setMusicTrack?.(v));
const musicVolumeRange = document.getElementById('music-volume-range');
if (musicVolumeRange) {
    try { musicVolumeRange.value = localStorage.getItem('lanrace.musicVolume') ?? 50; } catch (e) { /* default */ }
    musicVolumeRange.addEventListener('input', () => window.lanraceAudio?.setMusicVolume?.(musicVolumeRange.value / 100));
}

// ── Audio Preview & Test Controls ─────────────────────────────────────────
const btnTestEngine = document.getElementById('btn-test-engine');
const engineTypeSelect = document.getElementById('engine-type-select');
if (btnTestEngine) {
    btnTestEngine.addEventListener('click', () => {
        const audio = window.lanraceAudio;
        if (!audio) return;
        const selected = engineTypeSelect?.value || 'v8';
        audio.testEngine(selected, (isPlaying) => {
            btnTestEngine.innerHTML = isPlaying ? '&#9632; Stop' : '&#9654; Test';
            btnTestEngine.classList.toggle('playing', isPlaying);
        });
    });
    engineTypeSelect?.addEventListener('change', () => {
        if (window.lanraceAudio?.isEngineTesting?.()) {
            window.lanraceAudio.stopEngineTest((isPlaying) => {
                btnTestEngine.innerHTML = isPlaying ? '&#9632; Stop' : '&#9654; Test';
                btnTestEngine.classList.toggle('playing', isPlaying);
            });
        }
    });
}

const btnTestMusic = document.getElementById('btn-test-music');
const musicSelect = document.getElementById('music-select');
if (btnTestMusic) {
    const updateMusicBtn = (isPlaying) => {
        btnTestMusic.innerHTML = isPlaying ? '&#9632; Stop' : '&#9654; Test';
        btnTestMusic.classList.toggle('playing', isPlaying);
    };

    btnTestMusic.addEventListener('click', () => {
        const audio = window.lanraceAudio;
        if (!audio) return;
        let track = musicSelect?.value || 'synthwave';
        if (track === 'off') {
            track = 'synthwave';
            if (musicSelect) musicSelect.value = 'synthwave';
            try { localStorage.setItem('lanrace.music', 'synthwave'); } catch (e) {}
        }
        audio.testMusic(track, updateMusicBtn);
    });

    musicSelect?.addEventListener('change', () => {
        const audio = window.lanraceAudio;
        if (audio?.music?.isPlaying) {
            if (musicSelect.value === 'off') {
                audio.stopMusic(updateMusicBtn);
            } else {
                audio.music.play(musicSelect.value);
                updateMusicBtn(true);
            }
        }
    });
}

let isJoined = false;
let amReady = true;
let wasKicked = false;
let teams = [];
let selectedTeam = null;
try {
    selectedTeam = localStorage.getItem('lanrace.teamId') || null;
    const savedName = localStorage.getItem('lanrace.username');
    if (savedName && inputUser) inputUser.value = savedName;
} catch (e) {}

let persistentSessionId = null;
try {
    persistentSessionId = localStorage.getItem('lanrace.sessionId');
    if (!persistentSessionId) {
        persistentSessionId = 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('lanrace.sessionId', persistentSessionId);
    }
} catch (e) {
    persistentSessionId = 's_' + Math.random().toString(36).slice(2, 10);
}

function autoJoinLobby() {
    if (isJoined || wasKicked || !teams.length || !socket?.connected) return;
    const counts = teamCounts();
    if (!selectedTeam || (counts[selectedTeam] || 0) >= (teams.find(t => t.id === selectedTeam)?.maxPlayers || 2)) {
        selectedTeam = teams.find(t => (counts[t.id] || 0) < t.maxPlayers)?.id || teams[0]?.id;
    }
    const savedName = localStorage.getItem('lanrace.username');
    const username = (inputUser.value.trim() || savedName || `Driver ${Math.floor(Math.random() * 900 + 100)}`).slice(0, 15);
    inputUser.value = username;
    try {
        localStorage.setItem('lanrace.username', username);
        if (selectedTeam) localStorage.setItem('lanrace.teamId', selectedTeam);
    } catch (e) {}
    lastJoin = { username, teamId: selectedTeam, assist: getAssistString(), sessionId: persistentSessionId };
    socket.emit('join_lobby', lastJoin);
    setJoinedUI(true);
    amReady = true;
}

fetch('teams.json').then(r => r.json()).then((list) => {
    teams = list;
    autoJoinLobby();
    window.updateLobbyUI();
}); // team names in the driver list too

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

function renderNameField() {
    inputUser.disabled = !canEditProfile();
    btnJoin.textContent = isJoined ? 'Save' : 'Join ▶';
    btnJoin.classList.add('hidden'); // auto-join: manual join button not needed
}

let _saveNameTimer = null;
inputUser.addEventListener('input', () => {
    const name = inputUser.value.trim();
    try { localStorage.setItem('lanrace.username', name); } catch (e) {}
    clearTimeout(_saveNameTimer);
    if (isJoined && name && name.length <= 15) {
        _saveNameTimer = setTimeout(() => {
            socket.emit('update_profile', { username: name });
        }, 400);
    }
});
inputUser.addEventListener('blur', () => {
    clearTimeout(_saveNameTimer);
    const name = inputUser.value.trim();
    if (isJoined && name && name.length <= 15) {
        socket.emit('update_profile', { username: name });
    }
});
inputUser.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inputUser.blur();
});

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
            selectedTeam = t.id;
            try { localStorage.setItem('lanrace.teamId', selectedTeam); } catch (e) {}
            if (isJoined) socket.emit('update_profile', { teamId: t.id });
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

btnJoin.addEventListener('click', () => {
    if (isJoined) {
        socket.emit('update_profile', { username: inputUser.value.trim() });
        inputUser.blur();
        return;
    }
    autoJoinLobby();
});

// Removed by the host: back to the join screen (and not auto-rejoined on a reconnect); joining again is allowed
socket.on('kicked', () => {
    wasKicked = true;
    lastJoin = null;
    amReady = false;
    setJoinedUI(false);
    window.appendChat('SYSTEM', '#f43f5e', 'You were removed by the host. Refresh to rejoin.');
});

// A reconnect (WiFi drop, sleep, server restart) is a new socket the server doesn't know: join again as the same driver
socket.on('connect', () => {
    if (!lastJoin || !isJoined) {
        autoJoinLobby();
        return;
    }
    amReady = true;
    btnReady.innerText = 'Unready';
    btnReady.classList.remove('primary');
    btnReady.classList.add('success');
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
    updateLobbyTrackPreview();
    const settings = {
        trackId: setTrack.value,
        timeOfDay: setTime.value,
        maxLaps: parseInt(setLaps.value, 10),
        qualifying: setQuali.value === '1',
        outLaps: parseInt(setOutLaps.value, 10),
        qualiLaps: parseInt(setQualiLaps.value, 10),
        collisions: setCollisions.value === '1',
        contactPenalties: setPenalties.value === '1',
        hidePenaltiesDuringRace: setHidePenalties ? setHidePenalties.value === '1' : false,
        trackLimits: setTrackLimits ? setTrackLimits.value === '1' : true,
        botCar: setBot ? setBot.value === '1' : false,
        maxSpeed: setMaxSpeed ? (parseInt(setMaxSpeed.value, 10) || 340) : 340,
        acceleration: setAcceleration ? (parseInt(setAcceleration.value, 10) || 100) : 100
    };
    try { localStorage.setItem('lanrace.hostSettings', JSON.stringify(settings)); } catch (e) {}
    socket.emit('update_settings', settings);
}

// ── Track Previews & Custom Track Dropdown ──────────────────────────────
let trackPreviews = {};

function drawTrackSimple(canvas, trackId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const d = trackPreviews[trackId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!d || !d.path || !d.path.length) return;

    const pad = Math.min(canvas.width, canvas.height) * 0.12;
    const b = d.bounds || { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const cw = canvas.width - pad * 2;
    const ch = canvas.height - pad * 2;
    const scale = Math.min(cw / bw, ch / bh);
    const ox = pad + (cw - bw * scale) / 2;
    const oy = pad + (ch - bh * scale) / 2;

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < d.path.length; i++) {
        const [x, y] = d.path[i];
        const px = ox + (x - b.minX) * scale;
        const py = oy + (y - b.minY) * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(1.8, Math.min(3.2, canvas.width / 45));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Start-finish indicator dot
    const [sx, sy] = d.path[0];
    const spx = ox + (sx - b.minX) * scale;
    const spy = oy + (sy - b.minY) * scale;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(spx, spy, ctx.lineWidth * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

const lobbyTrackCanvas = document.getElementById('lobby-track-preview');
const lobbyTrackName = document.getElementById('lobby-track-name');
const trackDropdownTrigger = document.getElementById('track-dropdown-trigger');
const trackDropdownThumb = document.getElementById('track-dropdown-thumb');
const trackDropdownLabel = document.getElementById('track-dropdown-label');
const trackDropdownMenu = document.getElementById('track-dropdown-menu');

function updateLobbyTrackPreview() {
    const trackId = setTrack?.value || clientState?.settings?.trackId || 'monza';
    const trackOpt = Array.from(setTrack?.options || []).find(o => o.value === trackId);
    const trackName = trackOpt?.textContent || trackPreviews[trackId]?.name || trackId;

    if (lobbyTrackName) lobbyTrackName.textContent = trackName.toUpperCase();
    if (lobbyTrackCanvas) drawTrackSimple(lobbyTrackCanvas, trackId);
    if (trackDropdownThumb) drawTrackSimple(trackDropdownThumb, trackId);
    if (trackDropdownLabel) trackDropdownLabel.textContent = trackName;

    if (trackDropdownMenu) {
        const items = trackDropdownMenu.querySelectorAll('.track-dropdown-item');
        items.forEach(it => {
            it.classList.toggle('selected', it.dataset.value === trackId);
        });
    }
}

function renderTrackDropdown() {
    if (!trackDropdownMenu || !setTrack) return;
    trackDropdownMenu.innerHTML = '';
    const options = Array.from(setTrack.options).filter(o => o.style.display !== 'none');
    for (const opt of options) {
        const item = document.createElement('div');
        item.className = 'track-dropdown-item' + (opt.value === setTrack.value ? ' selected' : '');
        item.dataset.value = opt.value;

        const thumb = document.createElement('canvas');
        thumb.width = 46;
        thumb.height = 30;
        thumb.className = 'track-item-thumb';

        const label = document.createElement('span');
        label.className = 'track-item-label';
        label.textContent = opt.textContent;

        item.append(thumb, label);
        item.addEventListener('click', () => {
            setTrack.value = opt.value;
            emitSettings();
            updateLobbyTrackPreview();
            trackDropdownMenu.classList.add('hidden');
        });

        trackDropdownMenu.appendChild(item);
        drawTrackSimple(thumb, opt.value);
    }
    updateLobbyTrackPreview();
}

if (trackDropdownTrigger && trackDropdownMenu) {
    trackDropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        trackDropdownMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#track-dropdown')) {
            trackDropdownMenu.classList.add('hidden');
        }
    });
}

fetch('tracks-preview.json')
    .then(r => r.json())
    .then(data => {
        trackPreviews = data;
        renderTrackDropdown();
    })
    .catch(err => {
        console.warn('Failed to load track previews:', err);
    });

setTrack.addEventListener('change', () => {
    updateLobbyTrackPreview();
    emitSettings();
});
setLaps.addEventListener('change', emitSettings);
setQuali.addEventListener('change', emitSettings);
setOutLaps.addEventListener('change', emitSettings);
setQualiLaps.addEventListener('change', emitSettings);
setCollisions.addEventListener('change', emitSettings);
setPenalties.addEventListener('change', emitSettings);
setTime.addEventListener('change', emitSettings);
setTrackLimits?.addEventListener('change', emitSettings);
setHidePenalties?.addEventListener('change', emitSettings);
setBot?.addEventListener('change', emitSettings);

let settingsInputTimeout = null;
const debouncedEmitSettings = () => {
    clearTimeout(settingsInputTimeout);
    settingsInputTimeout = setTimeout(emitSettings, 350);
};
setMaxSpeed?.addEventListener('input', debouncedEmitSettings);
setMaxSpeed?.addEventListener('change', emitSettings);
setAcceleration?.addEventListener('input', debouncedEmitSettings);
setAcceleration?.addEventListener('change', emitSettings);

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value.trim() === '') return;
    if (!isJoined) return window.appendChat('SYSTEM', '#f43f5e', 'Join the lobby first to chat.');
    socket.emit('chat_msg', chatInput.value);
    chatInput.value = '';
});

window.updateLobbyUI = () => {
    if (!isJoined && !wasKicked && teams.length && socket?.connected) autoJoinLobby();
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
        if (!window._hasEmittedSavedSettings) {
            window._hasEmittedSavedSettings = true;
            try {
                if (localStorage.getItem('lanrace.hostSettings')) emitSettings();
            } catch (e) {}
        }
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
        amReady = me ? (me.isReady !== false) : true;
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
    if (!clientState || !clientState.settings) return;
    setTrack.value = clientState.settings.trackId;
    updateLobbyTrackPreview();
    setLaps.value = clientState.settings.maxLaps;
    setTime.value = clientState.settings.timeOfDay === 'night' ? 'night' : 'day';
    setQuali.value = clientState.settings.qualifying ? '1' : '0';
    setOutLaps.value = clientState.settings.outLaps ?? 1;
    setQualiLaps.value = clientState.settings.qualiLaps ?? 2;
    document.querySelectorAll('.quali-only').forEach((el) => el.classList.toggle('hidden', !clientState.settings.qualifying));
    setCollisions.value = clientState.settings.collisions === false ? '0' : '1';
    setPenalties.value = clientState.settings.contactPenalties === false ? '0' : '1';
    document.querySelectorAll('.collisions-only').forEach((el) => el.classList.toggle('hidden', clientState.settings.collisions === false));
    if (setTrackLimits) setTrackLimits.value = clientState.settings.trackLimits === false ? '0' : '1';
    if (setHidePenalties) setHidePenalties.value = clientState.settings.hidePenaltiesDuringRace ? '1' : '0';
    if (setBot) setBot.value = clientState.settings.botCar ? '1' : '0';
    if (setMaxSpeed) setMaxSpeed.value = clientState.settings.maxSpeed ?? 340;
    if (setAcceleration) setAcceleration.value = clientState.settings.acceleration ?? 100;

    // Header chips and the read-only view non-hosts see
    const s = clientState.settings;
    const track = setTrack.selectedOptions[0]?.textContent || s.trackId;
    const out = s.outLaps ?? 1, timed = s.qualiLaps ?? 2, quali = s.qualifying ? `${out} out + ${timed} timed` : 'Off';
    const time = s.timeOfDay === 'night' ? 'Night' : 'Day';
    const rows = [
        ['Track', track],
        ['Time', time],
        ['Laps', s.maxLaps],
        ['Qualifying', quali],
        ['Collisions', s.collisions === false ? 'Off' : s.contactPenalties === false ? 'On, no penalties' : 'On, penalties'],
        ['Track limits', s.trackLimits === false ? 'Off' : 'On'],
        ['Penalty display', s.hidePenaltiesDuringRace ? 'Hide until finish' : 'Live in-race'],
        ['AI Bot', s.botCar ? 'On' : 'Off'],
        ['Max Speed', `${s.maxSpeed ?? 340} km/h`],
        ['Acceleration', `${s.acceleration ?? 100}%`]
    ];
    settingsView.replaceChildren(...rows.map(([k, v]) => {
        const d = document.createElement('div');
        d.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
        return d;
    }));
    document.getElementById('session-summary').replaceChildren(...[
        track,
        time,
        `${s.maxLaps} ${s.maxLaps === 1 ? 'lap' : 'laps'}`,
        s.qualifying ? `Quali ${out}+${timed}` : 'Quali off',
        `Collisions ${s.collisions === false ? 'off' : 'on'}`,
        `Limits ${s.trackLimits === false ? 'off' : 'on'}`,
        s.hidePenaltiesDuringRace ? 'Penalties hidden' : 'Penalties live',
        s.botCar ? '1 Bot' : 'No bots',
        `${s.maxSpeed ?? 340} km/h`,
        `${s.acceleration ?? 100}% accel`
    ].map((text) => Object.assign(document.createElement('span'), { textContent: text })));
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
        standingsBubbleBtn?.classList.remove('hidden');
        return;
    }

    const me = clientState.players[clientState.me];
    if (!me) return; // visitors who haven't joined stay in the lobby

    screenLobby.classList.add('hidden');
    screenGame.classList.remove('hidden');
    standingsBubbleBtn?.classList.add('hidden');
    toggleStandings(false);
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

// LAST RACE STANDINGS WIDGET
const standingsBubbleBtn = document.getElementById('standings-bubble-btn');
const standingsBadge = document.getElementById('standings-badge');
const standingsPopup = document.getElementById('standings-popup');
const btnCloseStandings = document.getElementById('btn-close-standings');
const standingsList = document.getElementById('standings-list');
const standingsEmptyState = document.getElementById('standings-empty-state');
const standingsTrackBadge = document.getElementById('standings-track-badge');
const headerStandingsBtn = document.getElementById('header-standings-btn');
const hudStandingsBtn = document.getElementById('hud-standings-btn');

function formatStdLapTime(s) {
    if (s === null || s === undefined || isNaN(s)) return '—';
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

function formatStdTotalOrGap(r) {
    if (r.dnf) return 'DNF';
    if (r.position === 1 || r.gap === null || r.gap === undefined) return formatStdLapTime(r.total);
    return `+${Number(r.gap).toFixed(3)}`;
}

function renderStandingsPopup() {
    if (!standingsList) return;
    let data = null;
    try {
        const stored = localStorage.getItem('laneracer_last_race_results');
        if (stored) data = JSON.parse(stored);
    } catch (e) {}

    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
        standingsList.innerHTML = '';
        standingsEmptyState?.classList.remove('hidden');
        if (standingsTrackBadge) standingsTrackBadge.textContent = 'NO RACE YET';
        return;
    }

    standingsEmptyState?.classList.add('hidden');
    if (standingsTrackBadge) standingsTrackBadge.textContent = (data.track || 'RACE').toUpperCase();
    standingsList.innerHTML = '';

    for (const r of data.rows) {
        const li = document.createElement('li');
        if (r.id === clientState.me) li.classList.add('me');
        if (r.position <= 3 && !r.dnf) li.classList.add(`podium-${r.position}`);

        const posSpan = document.createElement('span');
        posSpan.className = 'std-pos';
        posSpan.textContent = r.position;

        const teamBar = document.createElement('span');
        teamBar.className = 'std-team';
        const teamObj = teams.find(t => t.id === r.teamId);
        teamBar.style.background = teamObj?.chatColor || '#888';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'std-name';
        nameSpan.textContent = r.username || '—';

        const lapsSpan = document.createElement('span');
        lapsSpan.className = 'std-laps';
        lapsSpan.textContent = r.laps ?? '0';

        const bestSpan = document.createElement('span');
        const isFastest = r.id === data.fastestLapId;
        bestSpan.className = 'std-best' + (isFastest ? ' fl' : '');
        bestSpan.textContent = (isFastest ? '⚡ ' : '') + formatStdLapTime(r.bestLap);

        const penSpan = document.createElement('span');
        penSpan.className = 'std-pen';
        penSpan.textContent = r.penalties || '—';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'std-time' + (r.dnf ? ' dnf' : '');
        timeSpan.textContent = formatStdTotalOrGap(r);

        li.append(posSpan, teamBar, nameSpan, lapsSpan, bestSpan, penSpan, timeSpan);
        standingsList.appendChild(li);
    }
}

function toggleStandings(open) {
    if (!standingsPopup) return;
    const shouldOpen = open !== undefined ? open : standingsPopup.classList.contains('hidden');
    if (shouldOpen) {
        renderStandingsPopup();
        standingsPopup.classList.remove('hidden');
        standingsBadge?.classList.add('hidden');
    } else {
        standingsPopup.classList.add('hidden');
    }
}

standingsBubbleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStandings();
});
headerStandingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStandings();
});
hudStandingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStandings();
});
btnCloseStandings?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStandings(false);
});

// Close popup on outside click
document.addEventListener('click', (e) => {
    if (standingsPopup && !standingsPopup.classList.contains('hidden')) {
        if (!standingsPopup.contains(e.target) && !standingsBubbleBtn?.contains(e.target) && !headerStandingsBtn?.contains(e.target) && !hudStandingsBtn?.contains(e.target)) {
            toggleStandings(false);
        }
    }
});

// Close popup on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && standingsPopup && !standingsPopup.classList.contains('hidden')) {
        toggleStandings(false);
    }
});

// Called when race_results arrives from socket
window.updateLastRaceStandings = (res) => {
    if (!res || !Array.isArray(res.rows)) return;
    const payload = {
        track: clientState.trackData?.name || res.track || 'Race',
        fastestLapId: res.fastestLapId,
        rows: res.rows.map(r => {
            const lp = clientState.players[r.id] || clientState.gameState?.[r.id];
            let pen = '';
            if (r.penaltySeconds) pen = `+${r.penaltySeconds}s`;
            else if (r.penalty) pen = `+${r.penalty}s`;
            else if (r.penalties) pen = r.penalties;
            return {
                id: r.id,
                position: r.position,
                username: lp?.username || r.username || '—',
                teamId: lp?.teamId || r.teamId || null,
                laps: r.laps,
                bestLap: r.bestLap,
                penalties: pen,
                gap: r.gap,
                total: r.total,
                dnf: !!r.dnf
            };
        })
    };
    try {
        localStorage.setItem('laneracer_last_race_results', JSON.stringify(payload));
    } catch (e) {}
    standingsBadge?.classList.remove('hidden');
    renderStandingsPopup();
};

// Initial check on load: if saved results exist, badge can show or list be ready
try {
    if (localStorage.getItem('laneracer_last_race_results')) {
        renderStandingsPopup();
    }
} catch (e) {}

// Leave Race (Abandon) Button
const btnLeaveRace = document.getElementById('btn-leave-race');
if (btnLeaveRace) {
    btnLeaveRace.addEventListener('click', () => {
        if (confirm('Leave the race? You will retire as DNF and cannot rejoin this race session.')) {
            socket.emit('abandon_race');
            document.getElementById('session-panel')?.classList.add('hidden');
            screenGame?.classList.add('hidden');
            screenLobby?.classList.remove('hidden');
        }
    });
}

socket.on('race_abandoned', () => {
    document.getElementById('session-panel')?.classList.add('hidden');
    screenGame?.classList.add('hidden');
    screenLobby?.classList.remove('hidden');
    window.appendChat('SYSTEM', '#f43f5e', 'You left the race (DNF).');
});
