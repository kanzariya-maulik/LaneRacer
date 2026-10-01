const socket = io();

// ============================================================================
// Shared Client State
// ============================================================================
let clientState = {
    me: null,
    players: {},
    hostId: null,
    status: 'LOBBY',
    settings: { trackId: 1, maxLaps: 3, maxSpeed: 400 },
    gameState: null,
    trackData: null
};

// ============================================================================
// WebRTC: UDP DataChannel Setup
// The server sends an SDP offer via Socket.IO (signaling channel).
// Once the DataChannel is open all 120 Hz game_state updates arrive over UDP.
// Inputs (keyboard/joystick) are also sent back over UDP when open.
// ============================================================================
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
                updateTransportBadge(true);
                sendUDPPing();
            };

            rtcDataChannel.onclose = () => {
                udpReady = false;
                window.isUDPReady = false;
                console.warn('[WebRTC] UDP DataChannel closed — falling back to Socket.IO');
                updateTransportBadge(false);
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
                    } else if (msg.type === 'PONG') {
                        // Round-trip latency display
                        const rtt = Date.now() - msg.clientTime;
                        updateLatencyBadge(rtt);
                    } else if (msg.type === 'UDP_READY') {
                        sendUDPPing();
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
                updateTransportBadge(true);
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

function sendUDPPing() {
    if (!udpReady || !rtcDataChannel) return;
    try {
        rtcDataChannel.send(JSON.stringify({ type: 'PING', clientTime: Date.now() }));
        // Keep pinging every 2 seconds for live latency display
        setTimeout(sendUDPPing, 2000);
    } catch (e) {}
}

function mergeGameState(stateSync) {
    for (let id in stateSync) {
        if (clientState.gameState && clientState.gameState[id]) {
            Object.assign(clientState.gameState[id], stateSync[id]);
        }
    }
}

// ── Transport badge (UDP vs TCP) ─────────────────────────────────────────────
function updateTransportBadge(isUDP) {
    const el = document.getElementById('transport-badge');
    if (!el) return;
    if (isUDP) {
        el.className = 'transport-badge udp';
        el.textContent = '⚡ UDP';
    } else {
        el.className = 'transport-badge tcp';
        el.textContent = '🔌 CONNECTING...';
    }
}
window.updateTransportBadge = updateTransportBadge;

// ── Latency badge (RTT over UDP) ─────────────────────────────────────────────
function updateLatencyBadge(rttMs) {
    const el = document.getElementById('latency-badge');
    if (!el) return;
    el.textContent = `${rttMs}ms`;
    el.style.color = rttMs < 10 ? '#10b981' : rttMs < 30 ? '#f59e0b' : '#ef4444';
}

// ============================================================================
// Socket.IO Lobby Events (these always go over TCP — that's correct)
// ============================================================================
socket.on('connect', () => {
    clientState.me = socket.id;
    // Start WebRTC negotiation immediately so UDP is ready before the race
    setupWebRTC();
});

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

socket.on('status_change', (status) => {
    clientState.status = status;
    if (window.handleStatusChange) window.handleStatusChange(status);
    updateTransportBadge(udpReady);
});

socket.on('countdown', (count) => {
    const el = document.getElementById('countdown-text');
    if (el) el.innerText = count > 0 ? count : 'GO!';
});

socket.on('game_init', (data) => {
    clientState.gameState = data.players;
    clientState.trackData = data.track;
    updateTransportBadge(udpReady);
    if (window.initGameVisuals) window.initGameVisuals();
    // Start UDP latency pings once game begins
    if (udpReady) sendUDPPing();
});

// Socket.IO game_state fallback: only processes if UDP channel is not yet open
socket.on('game_state', (stateSync) => {
    if (!udpReady) {
        mergeGameState(stateSync);
    }
});

