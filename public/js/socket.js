const socket = io();

// Shared Client State
let clientState = {
    me: null,
    players: {},
    hostId: null,
    status: 'LOBBY',
    settings: { trackId: 'monza', maxLaps: 3, qualifying: true },
    sessionBest: [null, null, null], // fastest valid sector times this session
    sessionBestIds: [null, null, null], // who set each (purple sector)
    fastestLap: null,                // { id, time, lap }: the session's purple lap
    mySectors: [null, null, null],   // current lap: the server's sector events { id, sector, time, valid, personalBest }
    myBestSectors: [null, null, null],
    gameState: null,
    trackData: null, // static track geometry
    netIn: [],       // fast updates waiting for game3d.js: [packet, arrival s]
    netIndex: {},    // player id -> car index in fast updates
    session: null,      // { phase, endsAt } — endsAt in local ms, null for open-ended
    qualiResults: null,
    lastTiming: null,
    net: { rttMs: null, link: 'TCP', tickMs: null, starve: {} }, // F3 stats overlay
};

// ---------- WebRTC UDP DataChannel (game_state in, inputs out); Socket.IO is signalling + fallback ----------
let rtcPeerConnection = null;
let rtcDataChannel = null;
let udpReady = false;
let pendingCandidates = []; // ICE candidates queued before remote desc is set

function setupWebRTC() {
    try {
        if (rtcPeerConnection) {
            try { rtcPeerConnection.close(); } catch (e) {}
        }
        udpReady = false;
        window.isUDPReady = false;
        rtcPeerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // When the server creates a DataChannel, this fires
        rtcPeerConnection.ondatachannel = (event) => {
            rtcDataChannel = event.channel;

            // ── CRITICAL: unordered + maxRetransmits:0 = pure UDP semantics ─
            rtcDataChannel.onopen = () => {
                udpReady = true;
                window.isUDPReady = true;
                console.log('[WebRTC] 🚀 UDP DataChannel OPEN — game traffic now over UDP!');
            };

            rtcDataChannel.onclose = () => {
                udpReady = false;
                window.isUDPReady = false;
                console.warn('[WebRTC] UDP DataChannel closed — falling back to Socket.IO');
            };

            rtcDataChannel.onerror = (err) => {
                console.warn('[WebRTC] DataChannel error:', err);
            };

            // ── Handle messages received over UDP ─────────────────────────
            rtcDataChannel.onmessage = (event) => {
                lastUdpRx = performance.now();
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'STATE') {
                        // 60 Hz game state arriving over UDP
                        onFastPacket(msg.data);
                    } else if (msg.type === 'PONG') {
                        clientState.net.rttMs = performance.now() - msg.clientTime;
                    }
                } catch (e) {}
            };
        };

        // Send ICE candidates to server via Socket.IO
        rtcPeerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_candidate', {
                    candidate: event.candidate.candidate,
                    mid: event.candidate.sdpMid
                });
            }
        };

        rtcPeerConnection.onconnectionstatechange = () => {
            console.log('[WebRTC] Connection state:', rtcPeerConnection.connectionState);
            if (rtcPeerConnection.connectionState === 'connected') {
            }
        };

    } catch (err) {
        console.warn('[WebRTC] RTCPeerConnection error:', err);
    }
}

// Server sends us its offer → we answer
socket.on('webrtc_offer', async (data) => {
    console.log('[WebRTC] Received offer from server');
    if (!rtcPeerConnection) setupWebRTC();
    try {
        await rtcPeerConnection.setRemoteDescription(
            new RTCSessionDescription({ type: data.type, sdp: data.sdp })
        );

        const answer = await rtcPeerConnection.createAnswer();
        await rtcPeerConnection.setLocalDescription(answer);

        // Flush any ICE candidates that arrived before remote description
        for (const c of pendingCandidates) {
            try {
                await rtcPeerConnection.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {}
        }
        pendingCandidates = [];

        socket.emit('webrtc_answer', {
            sdp: answer.sdp,
            type: answer.type
        });
        console.log('[WebRTC] Sent SDP answer to server');
    } catch (err) {
        console.warn('[WebRTC] Error handling offer:', err);
    }
});

// Server relays ICE candidates
socket.on('webrtc_candidate', async (data) => {
    try {
        if (data && data.candidate) {
            const candidate = { candidate: data.candidate, sdpMid: data.mid };
            if (rtcPeerConnection && rtcPeerConnection.remoteDescription) {
                await rtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                // Queue it — remote description or connection not set yet
                pendingCandidates.push(candidate);
            }
        }
    } catch (err) {
        console.warn('[WebRTC] addIceCandidate error:', err);
    }
});

// ── Send game input — WebRTC UDP first, socket during handshake ─────────────
let lastUdpRx = 0;
window.sendUDPInput = function(batch) {
    if (udpReady && rtcDataChannel && rtcDataChannel.readyState === 'open') {
        try {
            rtcDataChannel.send(JSON.stringify({ type: 'INPUT', payload: batch }));
            // Still hearing the server over UDP: done. Quiet for 0.5 s (WiFi roam): send the socket copy too
            if (performance.now() - lastUdpRx < 500) return;
        } catch (e) {
            udpReady = false;
        }
    }
    // Fallback to socket while UDP channel is establishing
    socket.emit('input', batch);
};

// Ping once a second for the stats overlay: over UDP when it's live, else a Socket.IO ack
setInterval(() => {
    const t = performance.now();
    if (udpReady && rtcDataChannel && rtcDataChannel.readyState === 'open' && t - lastUdpRx < 500) {
        clientState.net.link = 'UDP';
        try { rtcDataChannel.send(JSON.stringify({ type: 'PING', clientTime: t })); } catch (e) { /* next second */ }
    } else {
        clientState.net.link = 'TCP';
        socket.emit('net_ping', t, (back) => { clientState.net.rttMs = performance.now() - back; });
    }
    showPing(clientState.net.rttMs); // last second's reading
}, 1000);

// Ping on the HUD and in the lobby header, coloured for a LAN: green < 35 ms, amber < 80 ms, red beyond
function showPing(rtt) {
    const level = rtt === null ? '' : rtt < 35 ? 'good' : rtt < 80 ? 'fair' : 'bad';
    for (const id of ['hud-ping', 'lobby-ping']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.textContent = rtt === null ? '—' : Math.round(rtt);
        el.dataset.level = level;
    }
}

// Every 2 s: this browser's view of the link, for the server's network log (logs/latency.log)
setInterval(() => {
    if (!socket.connected) return;
    const n = window.lanraceNet || {};
    socket.emit('latency_telemetry', {
        rttMs: clientState.net.rttMs, link: clientState.net.link, jitterMs: n.jitterMs, lossPct: n.lossPct,
        delayMs: n.delayMs, predErrCm: n.predErrCm, fps: window.lanraceFps,
    });
}, 2000);
socket.on('net_stats', (s) => { clientState.net.tickMs = s.tickMs; clientState.net.starve = s.starve || {}; });


// Fast updates are queued; game3d.js drains them into its snapshot buffer every frame
function onFastPacket(pkt) {
    if (!pkt || !Array.isArray(pkt.c)) return;
    clientState.netIn.push([pkt, performance.now() / 1000]);
    if (clientState.netIn.length > 120) clientState.netIn.shift(); // background tab: keep only the last 2 s
}

socket.on('connect', () => {
    clientState.me = socket.id;
    setupWebRTC(); // negotiate UDP right away so it's open before the race
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
        clientState.paused = false;
    }
    if (window.updateLobbyUI) window.updateLobbyUI();
    if (window.updateSettingsUI) window.updateSettingsUI();
    window.renderSessionPanel?.(); // the host may have changed
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
    if (status === 'LOBBY') clientState.paused = false;
    if (window.handleStatusChange) window.handleStatusChange(status);
    window.renderSessionPanel?.();
});


socket.on('game_init', (data) => {
    clientState.gameState = data.players;
    clientState.trackData = data.track;
    clientState.netIndex = data.index || {};
    clientState.netIn = [];
    clientState.sessionBest = data.bestSectors ? [...data.bestSectors] : [null, null, null];
    clientState.sessionBestIds = data.bestSectorIds ? [...data.bestSectorIds] : [null, null, null];
    clientState.fastestLap = data.fastestLap || null;
    clientState.raceResults = null;
    if (data.session) clientState.session = { phase: data.session.phase, endsAt: Date.now() + data.session.endsInMs };
    clientState.mySectors = [null, null, null];
    clientState.myBestSectors = [null, null, null];
    clientState.paused = !!data.paused; // a late joiner can arrive mid-pause
    if (window.initGameVisuals) window.initGameVisuals();
    if (clientState.paused) window.onPaused?.(true); else window.renderSessionPanel?.(); // a new session: no resume banner
});

// Host pause / resume
socket.on('paused', ({ paused }) => {
    if (clientState.paused === paused) return;
    clientState.paused = paused;
    window.onPaused?.(paused);
});

// This comes in 60 times a second
// Socket.IO game_state: fallback until the UDP channel is open
// The server only sends this copy when it has no open UDP channel for us, so always take it (duplicates are dropped by seq)
socket.on('game_state', onFastPacket);

socket.on('game_meta', (diff) => {
    for (const id in diff) if (clientState.gameState && clientState.gameState[id]) Object.assign(clientState.gameState[id], diff[id]);
});

socket.on('lights', ({ count }) => {
    if (window.handleLights) window.handleLights(count);
});

socket.on('session', ({ phase, endsInMs }) => {
    clientState.session = { phase, endsAt: endsInMs === null ? null : Date.now() + endsInMs };
});

socket.on('race_results', (res) => {
    clientState.raceResults = res;
    if (window.showRaceResults) window.showRaceResults(res);
});

socket.on('quali_results', (list) => {
    clientState.qualiResults = list;
    if (window.showQualiResults) window.showQualiResults(list);
});

socket.on('timing', (t) => {
    if (t.sessionBest) clientState.sessionBest = [...t.sessionBest]; // live session bests (see session_best)
    if (t.bestSectorIds) clientState.sessionBestIds = [...t.bestSectorIds];
    if (t.fastestLap !== undefined) clientState.fastestLap = t.fastestLap;
    clientState.lastTiming = t;
    if (t.id === clientState.me) {
        // Sector bests count only from laps that end valid (same rule as the server), so colour and delta agree
        if (t.valid) clientState.mySectors.forEach((sec, i) => {
            const best = clientState.myBestSectors[i];
            if (sec && (best === null || sec.time < best)) clientState.myBestSectors[i] = sec.time;
        });
        const el = document.getElementById('lt-last');
        el.classList.remove('t-flash');
        void el.offsetWidth; // restart the animation
        el.classList.add('t-flash');
    }
});

socket.on('sector', (s) => {
    const i = s.sector - 1;
    if (window.onSectorAll) window.onSectorAll(s); // every driver: live sector bars in the timing tower
    if (s.id !== clientState.me) return;
    const cls = !s.valid ? 'sec-grey' : s.sessionBest ? 'sec-purple' : s.personalBest ? 'sec-green' : 'sec-yellow'; // the flash: colour as set
    const prev = clientState.myBestSectors[i];
    if (s.sector === 1) clientState.mySectors = [null, null, null];
    clientState.mySectors[i] = s; // the HUD colours it live (timing.js sectorClass): purple turns green when beaten
    if (window.showSectorFlash) window.showSectorFlash(s.sector, s.time, prev === null ? null : s.time - prev, cls);
});

// Live session-best sectors changed hands (or a deleted lap gave one back): every screen recolours on its next redraw
socket.on('session_best', ({ sessionBest, bestSectorIds }) => {
    clientState.sessionBest = [...sessionBest];
    clientState.sessionBestIds = [...bestSectorIds];
});

// Someone set the session's fastest lap: the purple graphic shows on every screen
socket.on('fastest_lap', (fl) => {
    clientState.fastestLap = fl;
    if (window.showFastestLap) window.showFastestLap(fl);
});

socket.on('reaction', (r) => {
    if (r.id === clientState.me && window.showBanner) window.showBanner(`REACTION ${r.time.toFixed(3)} s`, true);
});

socket.on('track_limits', (e) => {
    if (e.id !== clientState.me || !window.showBanner) return;
    window.showBanner(e.kind === 'deleted' ? 'TRACK LIMITS — LAP DELETED'
        : e.kind === 'warning' ? `TRACK LIMITS — WARNING ${e.count}/2`
        : e.kind === 'jump' ? `JUMP START — +${e.penalty}s PENALTY`
        : `+5s PENALTY (total +${e.penalty}s)`);
});
