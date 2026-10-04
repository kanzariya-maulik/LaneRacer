const screenLobby = document.getElementById('lobby-screen');
const screenGame = document.getElementById('game-screen');
const playersList = document.getElementById('players-list');
const chatMsgs = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatBubbleBtn = document.getElementById('chat-bubble-btn');
const chatPopup = document.getElementById('chat-popup');
const chatBadge = document.getElementById('chat-badge');
const btnCloseChat = document.getElementById('btn-close-chat');

let unreadChatCount = 0;
let isChatOpen = false;

function toggleChat(open) {
    isChatOpen = (open !== undefined) ? !!open : !isChatOpen;
    chatPopup?.classList.toggle('hidden', !isChatOpen);
    if (isChatOpen) {
        unreadChatCount = 0;
        if (chatBadge) {
            chatBadge.classList.add('hidden');
            chatBadge.textContent = '0';
        }
        if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
        setTimeout(() => chatInput?.focus(), 50);
    } else {
        chatInput?.blur();
    }
}

chatBubbleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleChat();
});

btnCloseChat?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleChat(false);
});

// FLOATING LAST RACE STANDINGS LOGIC
const floatingStandings = document.getElementById('floating-standings-container');
const standingsBubbleBtn = document.getElementById('standings-bubble-btn');
const standingsPopup = document.getElementById('standings-popup');
const btnCloseStandings = document.getElementById('btn-close-standings');
const standingsBadge = document.getElementById('standings-badge');
const standingsList = document.getElementById('standings-list');
const standingsEmptyState = document.getElementById('standings-empty-state');
const standingsTrackBadge = document.getElementById('standings-track-badge');

let isStandingsOpen = false;
let lastRaceStandings = null;
try {
    const saved = localStorage.getItem('laneracer_last_race_results');
    if (saved) lastRaceStandings = JSON.parse(saved);
} catch (e) {}

function formatRaceTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}` : s.toFixed(3);
}

function renderStandingsPopup() {
    if (!standingsList || !standingsEmptyState) return;
    standingsList.innerHTML = '';

    if (!lastRaceStandings || !lastRaceStandings.rows || lastRaceStandings.rows.length === 0) {
        standingsEmptyState.classList.remove('hidden');
        if (standingsTrackBadge) standingsTrackBadge.textContent = 'NO DATA';
        return;
    }

    standingsEmptyState.classList.add('hidden');
    if (standingsTrackBadge) {
        standingsTrackBadge.textContent = (lastRaceStandings.trackName || 'CIRCUIT').toUpperCase();
    }

    const fastestLapId = lastRaceStandings.fastestLapId;
    const myId = clientState?.me;

    lastRaceStandings.rows.forEach((r) => {
        const li = document.createElement('li');
        if (r.id === myId) li.classList.add('me');
        if (r.position === 1 && !r.dnf) li.classList.add('podium-1');
        else if (r.position === 2 && !r.dnf) li.classList.add('podium-2');
        else if (r.position === 3 && !r.dnf) li.classList.add('podium-3');

        // Team color bar
        const teamBar = document.createElement('span');
        teamBar.className = 'std-team';
        const team = (teams || DEFAULT_TEAMS).find(t => t.id === r.teamId);
        teamBar.style.background = team?.chatColor || '#64748b';

        // Position
        const pos = document.createElement('span');
        pos.className = 'std-pos';
        pos.textContent = r.position;

        // Driver name
        const name = document.createElement('span');
        name.className = 'std-name';
        name.textContent = r.username || (r.id === myId ? (inputUser?.value?.trim() || 'YOU') : `Driver ${r.id.slice(0, 4)}`);

        // Laps
        const laps = document.createElement('span');
        laps.className = 'std-laps';
        laps.textContent = r.laps ?? '—';

        // Best lap
        const best = document.createElement('span');
        best.className = 'std-best' + (r.id === fastestLapId ? ' fl' : '');
        best.textContent = r.bestLap !== null && r.bestLap !== undefined ? (r.id === fastestLapId ? '⏱️ ' : '') + formatRaceTime(r.bestLap) : '—';

        // Penalty
        const pen = document.createElement('span');
        pen.className = 'std-pen';
        pen.textContent = r.penalty ? `+${r.penalty}s` : '';

        // Total time / Gap
        const time = document.createElement('span');
        time.className = 'std-time' + (r.dnf ? ' dnf' : '');
        if (r.dnf) {
            time.textContent = 'DNF';
        } else if (r.position === 1 || r.gap === null || r.gap === undefined) {
            time.textContent = r.total ? formatRaceTime(r.total) : 'WINNER';
        } else {
            time.textContent = `+${Number(r.gap).toFixed(3)}`;
        }

        li.append(pos, teamBar, name, laps, best, pen, time);
        standingsList.appendChild(li);
    });
}

function toggleStandings(open) {
    isStandingsOpen = (open !== undefined) ? !!open : !isStandingsOpen;
    standingsPopup?.classList.toggle('hidden', !isStandingsOpen);
    if (isStandingsOpen) {
        if (standingsBadge) standingsBadge.classList.add('hidden');
        renderStandingsPopup();
    }
}

standingsBubbleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStandings();
});

btnCloseStandings?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStandings(false);
});

window.updateLastRaceStandings = (res) => {
    if (!res || !res.rows) return;
    const trackName = clientState?.trackData?.name || clientState?.settings?.trackId || 'Race Circuit';
    const myId = clientState?.me;
    const enrichedRows = res.rows.map(r => {
        const p = clientState?.players?.[r.id] || clientState?.gameState?.[r.id];
        return {
            ...r,
            username: p?.username || r.username || (r.id === myId ? inputUser?.value?.trim() : `Driver ${r.id.slice(0, 4)}`),
            teamId: p?.teamId || r.teamId || null
        };
    });

    lastRaceStandings = {
        rows: enrichedRows,
        trackName,
        fastestLapId: res.fastestLapId,
        timestamp: Date.now()
    };

    try {
        localStorage.setItem('laneracer_last_race_results', JSON.stringify(lastRaceStandings));
    } catch (e) {}

    if (standingsBadge) {
        const myRow = enrichedRows.find(r => r.id === myId);
        standingsBadge.textContent = myRow ? `P${myRow.position}` : 'NEW';
        standingsBadge.classList.remove('hidden');
    }

    if (isStandingsOpen) {
        renderStandingsPopup();
    }
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (isChatOpen) toggleChat(false);
        if (isStandingsOpen) toggleStandings(false);
    }
});

document.addEventListener('click', (e) => {
    if (isChatOpen && !document.getElementById('floating-chat-container')?.contains(e.target)) {
        toggleChat(false);
    }
    if (isStandingsOpen && !document.getElementById('floating-standings-container')?.contains(e.target)) {
        toggleStandings(false);
    }
});

const btnJoin = document.getElementById('btn-join');
const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');

const inputUser = document.getElementById('username');
const teamGrid = document.getElementById('team-grid');
const controlsPanel = document.getElementById('player-controls');
const hostSettingsColumn = document.getElementById('host-settings-column');
const hostStatusBadge = document.getElementById('host-status-badge');

const setTrack = document.getElementById('setting-track');
const setLaps = document.getElementById('setting-laps');
const setQuali = document.getElementById('setting-quali');
const setCollisions = document.getElementById('setting-collisions');
const setBot = document.getElementById('setting-bot');
const setMode = document.getElementById('setting-mode');
const setTimeOfDay = document.getElementById('setting-time-of-day');

try {
    const savedHostSettings = JSON.parse(localStorage.getItem('lanrace.hostSettings'));
    if (savedHostSettings && typeof savedHostSettings === 'object') {
        if (savedHostSettings.trackId && setTrack) setTrack.value = savedHostSettings.trackId;
        if (savedHostSettings.maxLaps && setLaps) setLaps.value = savedHostSettings.maxLaps;
        if (savedHostSettings.qualifying !== undefined && setQuali) {
            setQuali.value = savedHostSettings.qualifying ? String(savedHostSettings.qualiLaps || 2) : '0';
        }
        if (savedHostSettings.collisions !== undefined && setCollisions) setCollisions.value = savedHostSettings.collisions ? '1' : '0';
        if (savedHostSettings.botCar !== undefined && setBot) setBot.value = savedHostSettings.botCar ? '1' : '0';
        if (savedHostSettings.mode && setMode) setMode.value = savedHostSettings.mode;
        if (savedHostSettings.timeOfDay && setTimeOfDay) setTimeOfDay.value = savedHostSettings.timeOfDay;
    }
} catch (e) {}

const graphicsSelect = document.getElementById('graphics-select');
try { graphicsSelect.value = localStorage.getItem('lanrace.quality') || 'auto'; } catch (e) { /* storage blocked: Auto */ }
if (!graphicsSelect.value) graphicsSelect.value = 'auto';
graphicsSelect.addEventListener('change', () => {
    (window.lanraceMem ||= {})['lanrace.quality'] = graphicsSelect.value; // applies even when storage is blocked
    try { localStorage.setItem('lanrace.quality', graphicsSelect.value); } catch (e) { /* not remembered */ }
    const gNote = document.getElementById('graphics-note');
    if (gNote) {
        gNote.textContent = graphicsSelect.value === 'high' || window.lanraceQuality?.level === 'high'
            ? ' Applies next race (anti-aliasing after a page reload)' : ' Applies next race';
    }
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
remembered('others-select', 'lanrace.others', 'present');
remembered('autobrake-select', 'lanrace.autobrake', 'off');

const debounce = (fn, ms = 100) => {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
};

const debouncedSaveVolume = debounce((val) => {
    try { localStorage.setItem('lanrace.volume', val); } catch (e) {}
}, 120);

const debouncedSaveMusicVolume = debounce((val) => {
    try { localStorage.setItem('lanrace.musicVolume', val); } catch (e) {}
}, 120);

const debouncedSaveAssist = debounce((str) => {
    try { localStorage.setItem('lanrace.assist', str); } catch (e) {}
    if (clientState.players[clientState.me]) socket.emit('set_assist', str);
}, 80);

function updateSliderTrack(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    slider.style.setProperty('--fill-pct', `${pct}%`);
}

const volumeRange = document.getElementById('volume-range');
const volumeVal = document.getElementById('volume-val');
try {
    const v = localStorage.getItem('lanrace.volume') ?? 70;
    if (volumeRange) {
        volumeRange.value = v;
        updateSliderTrack(volumeRange);
    }
    if (volumeVal) volumeVal.textContent = `${v}%`;
} catch (e) {}
if (volumeRange) {
    updateSliderTrack(volumeRange);
    volumeRange.addEventListener('input', () => {
        const val = volumeRange.value;
        if (volumeVal) volumeVal.textContent = `${val}%`;
        updateSliderTrack(volumeRange);
        window.lanraceAudio?.setVolume(val / 100);
        debouncedSaveVolume(val);
    });
}

remembered('engine-select', 'lanrace.engine', 'all', (v) => window.lanraceAudio?.setMode(v));
remembered('engine-type-select', 'lanrace.engineType', 'v6', (v) => window.lanraceAudio?.setEngineType(v));
remembered('music-select', 'lanrace.music', 'off', (v) => window.lanraceAudio?.setMusicTrack(v));

const musicVolumeRange = document.getElementById('music-volume-range');
const musicVolumeVal = document.getElementById('music-volume-val');
if (musicVolumeRange) {
    try {
        const mv = localStorage.getItem('lanrace.musicVolume') ?? 50;
        musicVolumeRange.value = mv;
        updateSliderTrack(musicVolumeRange);
        if (musicVolumeVal) musicVolumeVal.textContent = `${mv}%`;
    } catch (e) {}
    musicVolumeRange.addEventListener('input', () => {
        const val = musicVolumeRange.value;
        if (musicVolumeVal) musicVolumeVal.textContent = `${val}%`;
        updateSliderTrack(musicVolumeRange);
        window.lanraceAudio?.setMusicVolume(val / 100);
        debouncedSaveMusicVolume(val);
    });
}

// 2 Independent Assist Sliders (Steering & Braking, 0-100%)
const assistSteerSlider = document.getElementById('assist-steer-slider');
const assistSteerVal = document.getElementById('assist-steer-val');
const assistBrakeSlider = document.getElementById('assist-brake-slider');
const assistBrakeVal = document.getElementById('assist-brake-val');

function parseAssistVal(v) {
    if (typeof v === 'object' && v !== null) {
        const steer = Number.isFinite(v.steer) ? Math.min(100, Math.max(0, Math.round(v.steer))) : 100;
        const brake = Number.isFinite(v.brake) ? Math.min(100, Math.max(0, Math.round(v.brake))) : 100;
        return { steer, brake };
    }
    if (typeof v === 'string') {
        const m = v.match(/^(\d+),(\d+)$/);
        if (m) return { steer: Math.min(100, Math.max(0, parseInt(m[1], 10))), brake: Math.min(100, Math.max(0, parseInt(m[2], 10))) };
        const lower = v.trim().toLowerCase();
        if (lower === 'off') return { steer: 0, brake: 0 };
        if (lower === 'low' || lower === 'steer') return { steer: 33, brake: 0 };
        if (lower === 'medium') return { steer: 66, brake: 50 };
        if (lower === 'full' || lower === 'high') return { steer: 100, brake: 100 };
        if (lower === 'brake') return { steer: 0, brake: 100 };
    }
    return { steer: 100, brake: 100 };
}

window.setAssist = (v, instantSave = false) => {
    const { steer, brake } = parseAssistVal(v);
    if (assistSteerSlider) {
        assistSteerSlider.value = steer;
        updateSliderTrack(assistSteerSlider);
    }
    if (assistSteerVal) assistSteerVal.textContent = `${steer}%`;
    if (assistBrakeSlider) {
        assistBrakeSlider.value = brake;
        updateSliderTrack(assistBrakeSlider);
    }
    if (assistBrakeVal) assistBrakeVal.textContent = `${brake}%`;

    const str = `${steer},${brake}`;
    (window.lanraceMem ||= {})['lanrace.assist'] = str;
    if (lastJoin) lastJoin.assist = str;
    window.onAssistChange?.(str);

    if (instantSave) {
        try { localStorage.setItem('lanrace.assist', str); } catch (e) {}
        if (clientState.players[clientState.me]) socket.emit('set_assist', str);
    } else {
        debouncedSaveAssist(str);
    }
};

function getAssistValStr() {
    const steer = assistSteerSlider ? assistSteerSlider.value : 100;
    const brake = assistBrakeSlider ? assistBrakeSlider.value : 100;
    return `${steer},${brake}`;
}

function updateAssistFromSliders() {
    if (assistSteerSlider) updateSliderTrack(assistSteerSlider);
    if (assistBrakeSlider) updateSliderTrack(assistBrakeSlider);
    window.setAssist(getAssistValStr(), false);
}

assistSteerSlider?.addEventListener('input', updateAssistFromSliders);
assistBrakeSlider?.addEventListener('input', updateAssistFromSliders);

try {
    const savedAssist = localStorage.getItem('lanrace.assist');
    if (savedAssist) window.setAssist(savedAssist, true);
    else window.setAssist('100,100', true);
} catch (e) {}

let isJoined = false;
let amReady = true; // Default ready state = true

// Default teams array guarantees team cards are rendered synchronously even before or if fetch completes
const DEFAULT_TEAMS = [
  { id: "redbull", name: "Red Bull Racing", car: "RB19", chatColor: "#3671C6", maxPlayers: 2 },
  { id: "mercedes", name: "Mercedes", car: "W14", chatColor: "#27F4D2", maxPlayers: 2 },
  { id: "ferrari", name: "Ferrari", car: "SF-23", chatColor: "#E8002D", maxPlayers: 2 },
  { id: "mclaren", name: "McLaren", car: "MCL60", chatColor: "#FF8000", maxPlayers: 2 },
  { id: "astonmartin", name: "Aston Martin", car: "AMR23", chatColor: "#229971", maxPlayers: 2 },
  { id: "alpine", name: "Alpine", car: "A523", chatColor: "#FF87BC", maxPlayers: 2 },
  { id: "williams", name: "Williams", car: "FW45", chatColor: "#64C4FF", maxPlayers: 2 },
  { id: "alphatauri", name: "AlphaTauri", car: "AT04", chatColor: "#5E8FAA", maxPlayers: 2 },
  { id: "alfaromeo", name: "Alfa Romeo", car: "C43", chatColor: "#C92D4B", maxPlayers: 2 },
  { id: "haas", name: "Haas", car: "VF-23", chatColor: "#B6BABD", maxPlayers: 2 },
  { id: "redbull-suzuka", name: "Red Bull — Suzuka Special", car: "RB21", chatColor: "#E10600", maxPlayers: 2 }
];

let teams = DEFAULT_TEAMS;
let selectedTeam = null;
let explicitTeamSelected = false;

function getCookieProfile() {
    try {
        const m = document.cookie.match(/(?:^|; )lanrace_profile=([^;]*)/);
        if (m) return JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {}
    return null;
}

function saveCookieProfile(data) {
    try {
        document.cookie = `lanrace_profile=${encodeURIComponent(JSON.stringify(data))}; max-age=31536000; path=/`;
    } catch (e) {}
}

// Persistent Profile Loading: LocalStorage -> Cookie Backup -> Server IP Suggestion
try {
    const savedName = localStorage.getItem('lanrace.username');
    const cookieData = getCookieProfile();
    if (savedName) inputUser.value = savedName;
    else if (cookieData?.username) inputUser.value = cookieData.username;

    selectedTeam = localStorage.getItem('lanrace.teamId') || cookieData?.teamId || null;
    if (selectedTeam) explicitTeamSelected = true;

    if (cookieData?.assist) {
        window.setAssist(cookieData.assist);
    }
} catch (e) {}

// Server suggested profile based on client IP address (ideal for new origins like phone hotspots 10.x.x.x)
socket.on('suggested_profile', (profile) => {
    if (!profile) return;
    if ((!inputUser.value.trim() || inputUser.value.startsWith('Player')) && profile.username) {
        inputUser.value = profile.username;
        try { localStorage.setItem('lanrace.username', profile.username); } catch (e) {}
    }
    if (profile.teamId && (!explicitTeamSelected || !isJoined)) {
        selectedTeam = profile.teamId;
        explicitTeamSelected = true;
        try {
            localStorage.setItem('lanrace.teamId', profile.teamId);
            saveCookieProfile({ username: inputUser.value.trim(), teamId: selectedTeam, assist: getAssistValStr() });
        } catch (e) {}
        renderTeamGrid();
    }
    if (profile.assist) {
        window.setAssist(profile.assist);
    }
});

inputUser.addEventListener('input', () => {
    const username = inputUser.value.trim();
    try {
        localStorage.setItem('lanrace.username', username);
        saveCookieProfile({ username, teamId: selectedTeam, assist: getAssistValStr() });
    } catch (e) {}
    if (isJoined && username) {
        socket.emit('update_profile', { username, teamId: selectedTeam, assist: getAssistValStr() });
    }
});

fetch('teams.json')
    .then(r => r.json())
    .then((list) => {
        if (Array.isArray(list) && list.length > 0) {
            teams = list;
            renderTeamGrid();
        }
    })
    .catch(() => {});

function getTeamMembers() {
    const members = {};
    if (clientState && clientState.players) {
        for (const p of Object.values(clientState.players)) {
            if (p.isBot) continue;
            if (p.teamId) {
                if (!members[p.teamId]) members[p.teamId] = [];
                members[p.teamId].push(p.username);
            }
        }
    }
    return members;
}

const teamPreviewCard = document.getElementById('team-preview-card');
const teamPreviewImg = document.getElementById('team-preview-img');
const lobbyCarBgImg = document.getElementById('lobby-car-bg-img');
const teamPreviewName = document.getElementById('team-preview-name');
const teamPreviewCar = document.getElementById('team-preview-car');
const btnOpenTeamModal = document.getElementById('btn-open-team-modal');
const btnCloseTeamModal = document.getElementById('btn-close-team-modal');
const teamSelectModal = document.getElementById('team-select-modal');

function openTeamModal() {
    teamSelectModal?.classList.remove('hidden');
    renderTeamGrid();
}

function closeTeamModal() {
    teamSelectModal?.classList.add('hidden');
}

window.openTeamModal = openTeamModal;
window.closeTeamModal = closeTeamModal;

btnOpenTeamModal?.addEventListener('click', (e) => {
    e.stopPropagation();
    openTeamModal();
});
teamPreviewCard?.addEventListener('click', openTeamModal);
btnCloseTeamModal?.addEventListener('click', closeTeamModal);
teamSelectModal?.addEventListener('click', (e) => {
    if (e.target === teamSelectModal) closeTeamModal();
});

function updateTeamPreview() {
    const active = teams.find(t => t.id === selectedTeam) || teams[0];
    if (active) {
        if (teamPreviewName) teamPreviewName.textContent = active.name;
        if (teamPreviewCar) teamPreviewCar.textContent = active.car;
        if (teamPreviewCard) teamPreviewCard.style.borderColor = active.chatColor || '#3b82f6';
        window.set3DShowroomTeam?.(active.id);
    }
}

function selectTeam(teamId) {
    if (!teamId) return;
    const target = (teams || DEFAULT_TEAMS).find(t => t.id === teamId);
    if (!target) return;

    selectedTeam = target.id;
    explicitTeamSelected = true;

    try {
        localStorage.setItem('lanrace.teamId', selectedTeam);
        saveCookieProfile({ username: inputUser.value.trim(), teamId: selectedTeam, assist: getAssistValStr() });
    } catch (e) {}

    // Optimistically update local player state
    if (clientState.me && clientState.players && clientState.players[clientState.me]) {
        clientState.players[clientState.me].teamId = selectedTeam;
        clientState.players[clientState.me].color = target.chatColor;
    }

    if (lastJoin) {
        lastJoin.teamId = selectedTeam;
    }

    // Update 3D showroom and preview card immediately
    updateTeamPreview();
    renderTeamGrid();

    // Broadcast update to server immediately if joined or connected
    const username = inputUser.value.trim() || clientState.players?.[clientState.me]?.username;
    if (isJoined || (clientState.me && clientState.players?.[clientState.me])) {
        socket.emit('update_profile', {
            username: username || `Player${Math.floor(Math.random() * 1000)}`,
            teamId: selectedTeam,
            assist: getAssistValStr()
        });
    }
}
window.selectTeam = selectTeam;

function renderTeamGrid() {
    if (!teams || teams.length === 0) teams = DEFAULT_TEAMS;

    // If no team is selected yet, initialize from connected player or first team
    if (!selectedTeam) {
        if (clientState.me && clientState.players?.[clientState.me]?.teamId) {
            selectedTeam = clientState.players[clientState.me].teamId;
        } else {
            selectedTeam = teams[0].id;
        }
    }

    // Auto-select first available team if current selected team is invalid
    if (!teams.some(t => t.id === selectedTeam)) {
        selectedTeam = teams[0].id;
    }

    updateTeamPreview();

    const members = getTeamMembers();
    if (!teamGrid) return;
    teamGrid.innerHTML = '';
    for (const t of teams) {
        const drivers = members[t.id] || [];
        const n = drivers.length;
        const isMyTeam = (clientState.me && clientState.players?.[clientState.me]?.teamId === t.id) || (t.id === selectedTeam);
        const full = n >= t.maxPlayers && !isMyTeam;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'team-card' + (t.id === selectedTeam ? ' selected' : '') + (full ? ' full' : '');
        card.disabled = full;
        card.setAttribute('aria-pressed', t.id === selectedTeam);

        const img = document.createElement('img');
        img.src = `liveries/${t.id}-thumb.png`;
        img.alt = '';
        img.onerror = () => { img.style.display = 'none'; };
        const name = document.createElement('span');
        name.className = 'team-name';
        name.textContent = t.name;

        const count = document.createElement('span');
        count.className = 'team-count';
        count.textContent = `${t.car} · ${n}/${t.maxPlayers}`;

        const driverList = document.createElement('div');
        driverList.className = 'team-drivers';
        driverList.textContent = drivers.length > 0 ? `🏎️ ${drivers.join(', ')}` : 'Vacant';

        card.append(img, name, count, driverList);
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (full) return;
            selectTeam(t.id);
            closeTeamModal();
        });
        teamGrid.appendChild(card);
    }
}

// Initial synchronous render of team grid
renderTeamGrid();

function setJoinedUI(joined) {
    isJoined = joined;
    btnJoin.classList.toggle('hidden', joined);
    const amHost = clientState.hostId === clientState.me;
    if (joined) {
        if (amHost) {
            btnStart.classList.remove('hidden');
            btnReady.classList.add('hidden');
        } else {
            btnReady.classList.remove('hidden');
            btnStart.classList.add('hidden');
        }
    } else {
        btnReady.classList.add('hidden');
        btnStart.classList.add('hidden');
    }
    renderTeamGrid();
}

inputUser.focus();

btnJoin.addEventListener('click', () => {
    if (!selectedTeam) return window.appendChat('SYSTEM', '#f43f5e', 'Pick a team first.');
    const username = inputUser.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    try {
        localStorage.setItem('lanrace.username', username);
        localStorage.setItem('lanrace.teamId', selectedTeam);
    } catch (e) {}
    amReady = true; // Default ready state = true
    lastJoin = { username, teamId: selectedTeam, assist: getAssistValStr(), isReady: true };
    window.lanraceAudio?.unlock(); // the click is the gesture browsers need to start sound
    socket.emit('join_lobby', lastJoin);
    setJoinedUI(true);
});

// A reconnect (WiFi drop, sleep, server restart) is a new socket the server doesn't know: join again as the same driver
let lastJoin = null;
socket.on('connect', () => {
    if (!lastJoin || !isJoined) return;
    socket.emit('join_lobby', lastJoin);
});

window.handleJoinError = (reason) => {
    setJoinedUI(false);
    window.appendChat('SYSTEM', '#f43f5e', reason);
};

btnReady.addEventListener('click', () => {
    amReady = !amReady;
    socket.emit('toggle_ready', amReady);
    btnReady.innerText = amReady ? 'Ready' : 'Unready';
    btnReady.classList.toggle('primary', !amReady);
    btnReady.classList.toggle('success', amReady);
});

btnStart.addEventListener('click', () => {
    socket.emit('start_game');
});

function emitSettings() {
    const qualiVal = parseInt(setQuali.value, 10);
    const settings = {
        trackId: setTrack.value,
        maxLaps: parseInt(setLaps.value, 10),
        qualifying: qualiVal > 0,
        qualiLaps: qualiVal > 0 ? qualiVal : 0,
        collisions: setCollisions.value === '1',
        botCar: setBot ? setBot.value === '1' : false,
        mode: setMode ? setMode.value : 'f1',
        timeOfDay: setTimeOfDay ? setTimeOfDay.value : 'day'
    };
    try {
        localStorage.setItem('lanrace.hostSettings', JSON.stringify(settings));
    } catch (e) {}
    socket.emit('update_settings', settings);
}
setTrack.addEventListener('change', emitSettings);
setLaps.addEventListener('change', emitSettings);
setQuali.addEventListener('change', emitSettings);
setCollisions.addEventListener('change', emitSettings);
setBot?.addEventListener('change', emitSettings);
setTimeOfDay?.addEventListener('change', emitSettings);
setMode?.addEventListener('change', () => {
    const driftTracks = ['ebisu', 'longbeach'];
    const f1Tracks = ['monza', 'spa', 'silverstone', 'suzuka', 'sakhir'];
    if (setMode.value === 'formula-d') {
        if (f1Tracks.includes(setTrack.value)) {
            setTrack.value = 'ebisu';
        }
    } else if (setMode.value === 'f1') {
        if (driftTracks.includes(setTrack.value)) {
            setTrack.value = 'monza';
        }
    }
    emitSettings();
});

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

    if (setMode && clientState.settings?.mode) {
        setMode.value = clientState.settings.mode;
    }

    for (const [id, player] of Object.entries(clientState.players)) {
        if (player.isBot) continue;

        const li = document.createElement('li');
        li.className = 'player-item';

        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'player-color';
        colorIndicator.style.backgroundColor = player.color;

        const nameNode = document.createElement('span');
        nameNode.className = 'player-name';
        nameNode.textContent = player.username + (id === myId ? ' (You)' : '');

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

        li.append(colorIndicator, nameNode, statusNode);

        if (amHost && id !== myId && !player.isBot) {
            const kickBtn = document.createElement('button');
            kickBtn.type = 'button';
            kickBtn.className = 'kick-btn';
            kickBtn.textContent = 'Kick';
            kickBtn.title = 'Move player to Spectator mode';
            kickBtn.onclick = (e) => {
                e.stopPropagation();
                socket.emit('kick_player', id);
            };
            li.appendChild(kickBtn);
        }

        playersList.appendChild(li);
    }

    if (amHost) {
        if (hostSettingsColumn) {
            hostSettingsColumn.classList.add('is-host');
            hostSettingsColumn.classList.remove('is-non-host');
        }
        if (hostStatusBadge) {
            hostStatusBadge.textContent = '👑 Host';
            hostStatusBadge.className = 'host-badge host-active';
        }
        if (setTrack) setTrack.disabled = false;
        if (setLaps) setLaps.disabled = false;
        if (setQuali) setQuali.disabled = false;
        if (setCollisions) setCollisions.disabled = false;
        if (setBot) setBot.disabled = false;
        if (setMode) setMode.disabled = false;
        if (setTimeOfDay) setTimeOfDay.disabled = false;

        btnReady.classList.add('hidden');
        if (isJoined) btnStart.classList.remove('hidden');
        else btnStart.classList.add('hidden');

        if (!window._hasEmittedSavedSettings) {
            window._hasEmittedSavedSettings = true;
            try {
                const saved = localStorage.getItem('lanrace.hostSettings');
                if (saved) emitSettings();
            } catch (e) {}
        }
    } else {
        if (hostSettingsColumn) {
            hostSettingsColumn.classList.add('is-non-host');
            hostSettingsColumn.classList.remove('is-host');
        }
        if (hostStatusBadge) {
            hostStatusBadge.textContent = '🔒 Host Only';
            hostStatusBadge.className = 'host-badge host-locked';
        }
        if (setTrack) setTrack.disabled = true;
        if (setLaps) setLaps.disabled = true;
        if (setQuali) setQuali.disabled = true;
        if (setCollisions) setCollisions.disabled = true;
        if (setBot) setBot.disabled = true;
        if (setMode) setMode.disabled = true;
        if (setTimeOfDay) setTimeOfDay.disabled = true;

        btnStart.classList.add('hidden');
        if (isJoined) btnReady.classList.remove('hidden');
        else btnReady.classList.add('hidden');
    }

    const me = clientState.players[myId];
    const spOverlay = document.getElementById('spectator-overlay');
    const floatingChat = document.getElementById('floating-chat-container');
    const floatingStandingsEl = document.getElementById('floating-standings-container');
    if (clientState.status === 'LOBBY' || !me) {
        // Visitors who haven't joined stay in the lobby even mid-race
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        if (floatingChat) floatingChat.classList.remove('hidden');
        if (floatingStandingsEl) floatingStandingsEl.classList.remove('hidden');
        // Server state wins: syncs arrive whenever anyone joins, so don't reset a ready player
        amReady = !!me?.isReady;
        btnReady.innerText = amReady ? 'Unready' : 'Ready Up';
        btnReady.classList.toggle('primary', !amReady);
        btnReady.classList.toggle('success', amReady);
    } else {
        screenLobby.classList.add('hidden');
        screenGame.classList.remove('hidden');
        if (floatingChat) {
            floatingChat.classList.add('hidden');
            toggleChat(false);
        }
        if (floatingStandingsEl) {
            floatingStandingsEl.classList.add('hidden');
            toggleStandings(false);
        }
        spOverlay.classList.toggle('hidden', !me.isSpectating);
    }

    renderTeamGrid();
};

window.updateSettingsUI = () => {
    if (!clientState || !clientState.settings) return;
    setTrack.value = clientState.settings.trackId;
    setLaps.value = clientState.settings.maxLaps;
    setQuali.value = clientState.settings.qualifying ? String(clientState.settings.qualiLaps || 2) : '0';
    setCollisions.value = clientState.settings.collisions === false ? '0' : '1';
    if (setBot) setBot.value = clientState.settings.botCar ? '1' : '0';
    if (setTimeOfDay && clientState.settings.timeOfDay) setTimeOfDay.value = clientState.settings.timeOfDay;
};

window.appendChat = (username, color, msg) => {
    if (!chatMsgs) return;
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

    if (!isChatOpen && chatBadge) {
        unreadChatCount++;
        chatBadge.textContent = unreadChatCount > 99 ? '99+' : unreadChatCount;
        chatBadge.classList.remove('hidden');
    }
};

window.handleStatusChange = (status) => {
    const cdOverlay = document.getElementById('countdown-overlay');
    const spOverlay = document.getElementById('spectator-overlay');
    const results = document.getElementById('quali-results');
    const raceResults = document.getElementById('race-results');
    const lights = document.getElementById('lights');
    const floatingChat = document.getElementById('floating-chat-container');
    const floatingStandingsEl = document.getElementById('floating-standings-container');

    if (status === 'LOBBY') {
        screenLobby.classList.remove('hidden');
        screenGame.classList.add('hidden');
        if (floatingChat) floatingChat.classList.remove('hidden');
        if (floatingStandingsEl) floatingStandingsEl.classList.remove('hidden');
        [cdOverlay, spOverlay, results, lights].forEach(el => el.classList.add('hidden')); // the race classification stays up over the lobby
        return;
    }

    const me = clientState.players[clientState.me];
    if (!me) return; // visitors who haven't joined stay in the lobby

    if (floatingChat) {
        floatingChat.classList.add('hidden');
        toggleChat(false);
    }
    if (floatingStandingsEl) {
        floatingStandingsEl.classList.add('hidden');
        toggleStandings(false);
    }

    screenLobby.classList.add('hidden');
    screenGame.classList.remove('hidden');
    spOverlay.classList.toggle('hidden', !me.isSpectating);
    cdOverlay.classList.add('hidden');
    results.classList.toggle('hidden', status !== 'QUALI_RESULTS');

    if (status === 'COUNTDOWN') {
        lights.classList.remove('hidden');
        lights.querySelectorAll('.light').forEach(l => l.classList.remove('on'));
    }
    if (status === 'FINISHED' && !clientState.raceResults) { // the classification replaces the FINISH! banner
        cdOverlay.classList.remove('hidden');
        document.getElementById('countdown-text').innerText = 'FINISH!';
    }
    const btnPause = document.getElementById('btn-pause-game');
    if (btnPause) {
        const amHost = clientState.hostId === clientState.me;
        btnPause.classList.toggle('hidden', !amHost);
    }
};

const btnPause = document.getElementById('btn-pause-game');
const btnUnpause = document.getElementById('btn-unpause-game');
const pauseModal = document.getElementById('pause-modal');
const pauseTitle = document.getElementById('pause-title');
const unpauseModal = document.getElementById('unpause-countdown-modal');
const unpauseNum = document.getElementById('unpause-countdown-number');

btnPause?.addEventListener('click', () => socket.emit('toggle_pause'));
btnUnpause?.addEventListener('click', () => socket.emit('toggle_pause'));

socket.on('game_pause_sync', (data) => {
    if (data.paused) {
        pauseModal?.classList.remove('hidden');
        unpauseModal?.classList.add('hidden');
        if (pauseTitle) pauseTitle.textContent = `GAME PAUSED BY ${data.hostUsername?.toUpperCase() || 'HOST'}`;
        const amHost = clientState.hostId === clientState.me;
        btnUnpause?.classList.toggle('hidden', !amHost);
    } else {
        pauseModal?.classList.add('hidden');
        unpauseModal?.classList.add('hidden');
    }
});

socket.on('unpause_countdown', (data) => {
    pauseModal?.classList.add('hidden');
    if (data.count > 0) {
        unpauseModal?.classList.remove('hidden');
        if (unpauseNum) unpauseNum.textContent = data.count;
    } else {
        unpauseModal?.classList.add('hidden');
    }
});

