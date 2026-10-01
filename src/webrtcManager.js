const nodeDataChannel = require('node-datachannel');

// Optional: reduce logging noise
try {
    nodeDataChannel.initLogger('WARN');
} catch (e) {}

// Open and still hearing from the client: a channel that went quiet (WiFi roam, IP change) can take ICE tens of
// seconds to report as failed, so judge it by traffic instead
const QUIET_MS = 500;
const live = (peer) => peer.isOpen && peer.dc && peer.dc.isOpen() && (peer.lastRx === undefined || Date.now() - peer.lastRx < QUIET_MS);

class WebRTCManager {
    constructor() {
        this.peers = {}; // [socketId]: { pc, dc, isOpen: false, pingTime: 0 }
    }

    setupPeer(socket, onInput) {
        try {
            const pc = new nodeDataChannel.PeerConnection(socket.id, {
                iceServers: [
                    'stun:stun.l.google.com:19302' // STUN fallback for WAN, works directly on LAN
                ]
            });

            // CRITICAL: Register callbacks BEFORE creating the DataChannel.
            // In node-datachannel, createDataChannel triggers offer creation immediately;
            // if onLocalDescription is registered after createDataChannel, the offer is missed!
            pc.onLocalDescription((sdp, type) => {
                console.log(`[WebRTC] Server generated ${type} for player ${socket.id}`);
                socket.emit('webrtc_offer', { sdp, type });
            });

            pc.onLocalCandidate((candidate, mid) => {
                socket.emit('webrtc_candidate', { candidate, mid });
            });

            // Client Answer
            socket.on('webrtc_answer', (data) => {
                try {
                    pc.setRemoteDescription(data.sdp, data.type);
                    console.log(`[WebRTC] Server applied SDP answer from ${socket.id}`);
                } catch (err) {
                    console.warn(`[WebRTC] setRemoteDescription error for ${socket.id}:`, err.message);
                }
            });

            // Client ICE Candidate
            socket.on('webrtc_candidate', (data) => {
                try {
                    if (data && data.candidate) {
                        pc.addRemoteCandidate(data.candidate, data.mid);
                    }
                } catch (err) {
                    console.warn(`[WebRTC] addRemoteCandidate error for ${socket.id}:`, err.message);
                }
            });

            // Create UDP DataChannel: unordered & zero retransmissions (Pure UDP semantics)
            const dc = pc.createDataChannel('gameDataUDP', {
                ordered: false,
                maxRetransmits: 0
            });

            const peerRecord = {
                pc,
                dc,
                isOpen: false,
                socket
            };

            this.peers[socket.id] = peerRecord;

            // DataChannel Lifecycle
            dc.onOpen(() => {
                peerRecord.isOpen = true;
                peerRecord.lastRx = Date.now();
                console.log(`[WebRTC] 🚀 UDP DataChannel OPEN for player: ${socket.id}`);
                // Notify client that UDP is active
                dc.sendMessage(JSON.stringify({ type: 'UDP_READY', timestamp: Date.now() }));
            });

            dc.onClosed(() => {
                peerRecord.isOpen = false;
                console.log(`[WebRTC] UDP DataChannel closed for player: ${socket.id}`);
            });

            dc.onError((err) => {
                console.warn(`[WebRTC] DataChannel error for ${socket.id}:`, err);
            });

            // Handle Incoming UDP Messages from Client (Inputs & Pings)
            dc.onMessage((msg) => {
                peerRecord.lastRx = Date.now(); // liveness: clients send inputs at least 10 times a second
                try {
                    const data = JSON.parse(msg);
                    if (data.type === 'INPUT') {
                        if (onInput) onInput(socket.id, data.payload);
                    } else if (data.type === 'PING') {
                        // Echo ping back immediately for latency calculation
                        dc.sendMessage(JSON.stringify({ type: 'PONG', clientTime: data.clientTime }));
                    }
                } catch (e) {
                    // Fast path: if raw inputs object sent
                    if (typeof msg === 'string' && msg.startsWith('{') && onInput) {
                        try {
                            const parsed = JSON.parse(msg);
                            if (parsed.up !== undefined) {
                                onInput(socket.id, parsed);
                            }
                        } catch (err) {}
                    }
                }
            });

        } catch (err) {
            console.error(`[WebRTC] Failed to initialize peer for ${socket.id}:`, err);
        }
    }

    broadcastGameState(stateSync, io) {
        const payload = JSON.stringify({ type: 'STATE', data: stateSync });
        const viaUDP = new Set();

        for (const [id, peer] of Object.entries(this.peers)) {
            if (live(peer)) {
                try {
                    peer.dc.sendMessage(payload);
                    viaUDP.add(id);
                } catch (err) {
                    peer.isOpen = false;
                }
            }
        }

        // Socket.IO only for sockets still without an open channel (handshake, failed WebRTC, visitors), so one slow
        // peer doesn't double everyone's traffic
        if (io) for (const [id, sock] of io.sockets.sockets) if (!viaUDP.has(id)) sock.volatile.emit('game_state', stateSync);
    }

    hasOpenChannel(socketId) {
        const peer = this.peers[socketId];
        return !!peer && live(peer);
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
