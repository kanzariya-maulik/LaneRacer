// WebRTC UDP DataChannel Manager using node-datachannel
// Zero-lag 60 Hz UDP transport with automatic Socket.IO fallback

let nodeDataChannel = null;
try {
    nodeDataChannel = require('node-datachannel');
    try {
        nodeDataChannel.initLogger('WARN', () => {});
    } catch (e) {}
    console.log('[WebRTC] node-datachannel initialized successfully for UDP transport');
} catch (err) {
    console.warn('[WebRTC] node-datachannel not available, using Socket.IO fallback:', err.message);
}

const QUIET_MS = 600;
const isLive = (peer) => peer && peer.isOpen && peer.dc && peer.dc.isOpen() && (peer.lastRx === undefined || Date.now() - peer.lastRx < QUIET_MS);

class WebRTCManager {
    constructor() {
        this.peers = {}; // [socketId]: { pc, dc, isOpen: false, lastRx }
    }

    setupPeer(socket, onInput) {
        if (!nodeDataChannel) return;

        try {
            const pc = new nodeDataChannel.PeerConnection(socket.id, {
                iceServers: [
                    'stun:stun.l.google.com:19302'
                ]
            });

            // Register SDP & candidate handlers before creating channel
            pc.onLocalDescription((sdp, type) => {
                socket.emit('webrtc_offer', { sdp, type });
            });

            pc.onLocalCandidate((candidate, mid) => {
                socket.emit('webrtc_candidate', { candidate, mid });
            });

            socket.on('webrtc_answer', (data) => {
                try {
                    pc.setRemoteDescription(data.sdp, data.type);
                } catch (err) {
                    console.warn(`[WebRTC] SDP answer error for ${socket.id}:`, err.message);
                }
            });

            socket.on('webrtc_candidate', (data) => {
                try {
                    if (data && data.candidate) {
                        pc.addRemoteCandidate(data.candidate, data.mid);
                    }
                } catch (err) {
                    console.warn(`[WebRTC] candidate error for ${socket.id}:`, err.message);
                }
            });

            // Pure UDP semantics: unordered & zero retransmits
            const dc = pc.createDataChannel('tankDataUDP', {
                ordered: false,
                maxRetransmits: 0
            });

            const peerRecord = { pc, dc, isOpen: false, socket };
            this.peers[socket.id] = peerRecord;

            dc.onOpen(() => {
                peerRecord.isOpen = true;
                peerRecord.lastRx = Date.now();
                console.log(`[WebRTC] 🚀 UDP DataChannel OPEN for player: ${socket.id}`);
                try {
                    dc.sendMessage(JSON.stringify({ type: 'UDP_READY', timestamp: Date.now() }));
                } catch (e) {}
            });

            dc.onClosed(() => {
                peerRecord.isOpen = false;
                console.log(`[WebRTC] UDP DataChannel closed for player: ${socket.id}`);
            });

            dc.onError((err) => {
                console.warn(`[WebRTC] DataChannel error for ${socket.id}:`, err);
            });

            dc.onMessage((msg) => {
                peerRecord.lastRx = Date.now();
                try {
                    const data = JSON.parse(msg);
                    if (data.type === 'INPUT') {
                        if (onInput) onInput(socket.id, data.payload);
                    } else if (data.type === 'PING') {
                        dc.sendMessage(JSON.stringify({ type: 'PONG', clientTime: data.clientTime }));
                    }
                } catch (e) {
                    // Raw input object fast path
                    if (typeof msg === 'string' && msg.startsWith('{') && onInput) {
                        try {
                            const parsed = JSON.parse(msg);
                            if (parsed.inputs || parsed.dir !== undefined) {
                                onInput(socket.id, parsed);
                            }
                        } catch (err) {}
                    }
                }
            });

        } catch (err) {
            console.error(`[WebRTC] Error initializing peer for ${socket.id}:`, err.message);
        }
    }

    broadcastGameState(stateSnapshot, io) {
        const payload = JSON.stringify({ type: 'STATE', data: stateSnapshot });
        const viaUDP = new Set();

        for (const [id, peer] of Object.entries(this.peers)) {
            if (isLive(peer)) {
                try {
                    peer.dc.sendMessage(payload);
                    viaUDP.add(id);
                } catch (err) {
                    peer.isOpen = false;
                }
            }
        }

        // Send via volatile Socket.IO to any player not yet on UDP
        if (io) {
            for (const [id, sock] of io.sockets.sockets) {
                if (!viaUDP.has(id)) {
                    sock.volatile.emit('game_state', stateSnapshot);
                }
            }
        }
    }

    hasOpenChannel(socketId) {
        const peer = this.peers[socketId];
        return isLive(peer);
    }

    cleanup(socketId) {
        const peer = this.peers[socketId];
        if (peer) {
            try {
                if (peer.dc) peer.dc.close();
                if (peer.pc) peer.pc.close();
            } catch (e) {}
            delete this.peers[socketId];
        }
    }
}

module.exports = new WebRTCManager();
