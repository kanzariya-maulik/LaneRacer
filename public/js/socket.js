const socket = io();

// Shared Client State
let clientState = {
    me: null,
    players: {},
    hostId: null,
    status: 'LOBBY',
    settings: { trackId: 'monza', maxLaps: 3, qualifying: true },
    sessionBest: [null, null, null], // fastest valid sector times this session
    mySectors: [null, null, null],   // current lap: { time, cls }
    myBestSectors: [null, null, null],
    gameState: null,
    trackData: null, // static track geometry
    session: null,      // { phase, endsAt } — endsAt in local ms, null for open-ended
    qualiResults: null,
    lastTiming: null,
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
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'STATE') {
                        // 60 Hz game state arriving over UDP
                        mergeGameState(msg.data);
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
window.sendUDPInput = function(inputs) {
    if (udpReady && rtcDataChannel && rtcDataChannel.readyState === 'open') {
        try {
            rtcDataChannel.send(JSON.stringify({ type: 'INPUT', payload: inputs }));
            return;
        } catch (e) {
            udpReady = false;
        }
    }
    // Fallback to socket while UDP channel is establishing
    socket.emit('input', inputs);
};


function mergeGameState(stateSync) {
    for (const id in stateSync) {
        if (clientState.gameState && clientState.gameState[id]) Object.assign(clientState.gameState[id], stateSync[id]);
    }
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
    clientState.sessionBest = [null, null, null];
    clientState.mySectors = [null, null, null];
    clientState.myBestSectors = [null, null, null];
    if (window.initGameVisuals) window.initGameVisuals();
});

// This comes in 60 times a second
// Socket.IO game_state: fallback until the UDP channel is open
socket.on('game_state', (stateSync) => {
    if (!udpReady) mergeGameState(stateSync);
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
    if (t.sessionBest) clientState.sessionBest = [...t.sessionBest]; // completed valid laps only
    clientState.lastTiming = t;
    if (t.id === clientState.me) {
        const el = document.getElementById('lt-last');
        el.classList.remove('t-flash');
        void el.offsetWidth; // restart the animation
        el.classList.add('t-flash');
    }
});

socket.on('sector', (s) => {
    const i = s.sector - 1;
    if (s.id !== clientState.me) return;
    const cls = !s.valid ? 'sec-grey' : s.sessionBest ? 'sec-purple' : s.personalBest ? 'sec-green' : 'sec-yellow';
    const prev = clientState.myBestSectors[i];
    if (s.personalBest) clientState.myBestSectors[i] = s.time;
    if (s.sector === 1) clientState.mySectors = [null, null, null];
    clientState.mySectors[i] = { time: s.time, cls };
    if (window.showSectorFlash) window.showSectorFlash(s.sector, s.time, prev === null ? null : s.time - prev, cls);
});

socket.on('track_limits', (e) => {
    if (e.id !== clientState.me || !window.showBanner) return;
    window.showBanner(e.kind === 'deleted' ? 'TRACK LIMITS — LAP DELETED'
        : e.kind === 'warning' ? `TRACK LIMITS — WARNING ${e.count}/2`
        : `+5s PENALTY (total +${e.penalty}s)`);
});
