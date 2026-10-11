// Hybrid WebRTC UDP + Socket.IO Network Client for TankBattle LAN

export class NetworkClient {
    constructor(onStateSnapshot, onLobbyUpdate, onGameStart, onGameOver, onChat, onEventToast) {
        this.onStateSnapshot = onStateSnapshot;
        this.onLobbyUpdate = onLobbyUpdate;
        this.onGameStart = onGameStart;
        this.onGameOver = onGameOver;
        this.onChat = onChat;
        this.onEventToast = onEventToast;

        this.socket = null;
        this.rtcPeer = null;
        this.dataChannel = null;
        this.isUDPReady = false;
        this.playerId = null;
        this.isHost = false;
        this.rttMs = 0;
        this.lastPingSent = 0;

        this.initSocket();
    }

    initSocket() {
        // Connect via Socket.IO
        this.socket = window.io ? window.io() : null;
        if (!this.socket) {
            console.error('[Network] Socket.IO client library not loaded!');
            return;
        }

        this.socket.on('connect', () => {
            console.log('[Network] Connected to Battle Tanks Server via Socket.IO:', this.socket.id);
            this.playerId = this.socket.id;
            this.setupWebRTC();
            this.startPingLoop();
        });

        this.socket.on('joined_ack', (data) => {
            this.playerId = data.playerId;
            this.isHost = data.isHost;
            if (this.onLobbyUpdate) this.onLobbyUpdate(data.snapshot);
        });

        this.socket.on('lobby_update', (snapshot) => {
            if (this.onLobbyUpdate) this.onLobbyUpdate(snapshot);
        });

        this.socket.on('game_start', (data) => {
            if (this.onGameStart) this.onGameStart(data);
        });

        this.socket.on('game_state', (snapshot) => {
            // TCP Fallback state delivery if UDP is not yet connected
            if (!this.isUDPReady && this.onStateSnapshot) {
                this.onStateSnapshot(snapshot);
            }
        });

        this.socket.on('game_over', (results) => {
            if (this.onGameOver) this.onGameOver(results);
        });

        this.socket.on('chat_broadcast', (msg) => {
            if (this.onChat) this.onChat(msg);
        });

        this.socket.on('server_pong', (clientTime) => {
            this.rttMs = Math.round(performance.now() - clientTime);
        });

        // WebRTC Signaling Events
        this.socket.on('webrtc_offer', async (data) => {
            try {
                if (!this.rtcPeer) this.setupWebRTC();
                await this.rtcPeer.setRemoteDescription(new RTCSessionDescription(data));
                const answer = await this.rtcPeer.createAnswer();
                await this.rtcPeer.setLocalDescription(answer);
                this.socket.emit('webrtc_answer', { sdp: answer.sdp, type: answer.type });
                console.log('[WebRTC] Answer generated and dispatched to server');
            } catch (err) {
                console.warn('[WebRTC] Offer handling error:', err.message);
            }
        });

        this.socket.on('webrtc_candidate', (data) => {
            try {
                if (this.rtcPeer && data && data.candidate) {
                    this.rtcPeer.addIceCandidate(new RTCIceCandidate({
                        candidate: data.candidate,
                        sdpMid: data.mid
                    }));
                }
            } catch (err) {
                console.warn('[WebRTC] ICE candidate error:', err.message);
            }
        });
    }

    setupWebRTC() {
        try {
            if (this.rtcPeer) {
                try { this.rtcPeer.close(); } catch (e) {}
            }

            this.rtcPeer = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            this.rtcPeer.onicecandidate = (event) => {
                if (event.candidate && this.socket) {
                    this.socket.emit('webrtc_candidate', {
                        candidate: event.candidate.candidate,
                        mid: event.candidate.sdpMid
                    });
                }
            };

            // Server creates DataChannel; client receives it in ondatachannel
            this.rtcPeer.ondatachannel = (event) => {
                this.dataChannel = event.channel;

                this.dataChannel.onopen = () => {
                    this.isUDPReady = true;
                    console.log('[WebRTC] 🚀 UDP DataChannel OPEN — Ultra-low latency active!');
                };

                this.dataChannel.onclose = () => {
                    this.isUDPReady = false;
                    console.warn('[WebRTC] DataChannel closed — Falling back to Socket.IO');
                };

                this.dataChannel.onerror = (err) => {
                    console.warn('[WebRTC] DataChannel error:', err);
                };

                this.dataChannel.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'STATE' && this.onStateSnapshot) {
                            this.onStateSnapshot(msg.data);
                        } else if (msg.type === 'PONG') {
                            this.rttMs = Math.round(performance.now() - msg.clientTime);
                        }
                    } catch (e) {}
                };
            };
        } catch (err) {
            console.warn('[WebRTC] PeerConnection error:', err.message);
        }
    }

    // Send input batch at 60 Hz (UDP preferred, Socket.IO fallback)
    sendInput(inputBatch) {
        const payload = { inputs: inputBatch };

        if (this.isUDPReady && this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(JSON.stringify({ type: 'INPUT', payload }));
                return;
            } catch (err) {
                this.isUDPReady = false;
            }
        }

        // Socket.IO fallback
        if (this.socket && this.socket.connected) {
            this.socket.volatile.emit('tank_input', payload);
        }
    }

    joinLobby(username, teamId) {
        if (this.socket) {
            this.socket.emit('join_lobby', { username, teamId });
        }
    }

    selectTeam(teamId) {
        if (this.socket) {
            this.socket.emit('select_team', { teamId });
        }
    }

    updateSettings(settings) {
        if (this.socket) {
            this.socket.emit('update_settings', settings);
        }
    }

    startGame() {
        if (this.socket) {
            this.socket.emit('start_game');
        }
    }

    sendChat(text) {
        if (this.socket) {
            this.socket.emit('chat_send', text);
        }
    }

    returnToLobby() {
        if (this.socket) {
            this.socket.emit('return_to_lobby');
        }
    }

    startPingLoop() {
        setInterval(() => {
            const now = performance.now();
            if (this.isUDPReady && this.dataChannel && this.dataChannel.readyState === 'open') {
                try {
                    this.dataChannel.send(JSON.stringify({ type: 'PING', clientTime: now }));
                    return;
                } catch (e) {}
            }
            if (this.socket && this.socket.connected) {
                this.socket.emit('client_ping', now);
            }
        }, 1500);
    }

    getStatus() {
        return {
            connected: this.socket && this.socket.connected,
            isUDP: this.isUDPReady,
            rttMs: this.rttMs,
            transport: this.isUDPReady ? 'UDP (WebRTC)' : 'TCP (Socket.IO)'
        };
    }
}
