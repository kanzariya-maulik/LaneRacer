const nodeDataChannel = require('node-datachannel');
const { withNetSim } = require('./netsim');

// Optional: reduce logging noise
try {
    nodeDataChannel.initLogger('WARN');
} catch (e) {}

// Open and still hearing from the client: a channel that went quiet (WiFi roam, IP change) can take ICE tens of
// seconds to report as failed, so judge it by traffic instead
function packBinarySnapshot(stateSync) {
    if (!stateSync || !Array.isArray(stateSync.c)) return null;
    const cars = stateSync.c;
    const buf = Buffer.allocUnsafe(cars.length * 32);
    for (let i = 0; i < cars.length; i++) {
        const e = cars[i];
        const base = i * 32;
        buf.writeUInt32LE((stateSync.s >>> 0), base + 0);
        buf.writeFloatLE(stateSync.t || 0, base + 4);
        buf.writeUInt8((e[0] || 0) & 0xFF, base + 8);
        buf.writeUInt8((e[6] || 0) & 0xFF, base + 9);
        buf.writeUInt16LE((e[10] >= 0 ? e[10] : 0xFFFF) & 0xFFFF, base + 10);
        buf.writeFloatLE(e[1] || 0, base + 12);
        buf.writeFloatLE(e[2] || 0, base + 16);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((e[3] || 0) * 10000))), base + 20);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((e[4] || 0) * 100))), base + 22);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((e[5] || 0) * 10000))), base + 24);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((e[7] || 0) * 100))), base + 26);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((e[8] || 0) * 100))), base + 28);
        buf.writeUInt16LE(Math.max(0, Math.min(65535, Math.round((e[9] || 0) * 10000))), base + 30);
    }
    return buf;
}

// Open and still hearing from the client: a channel that went quiet (WiFi roam, IP change) can take ICE tens of
// seconds to report as failed, so judge it by traffic instead
const QUIET_MS = 500;
const live = (peer) => peer.isOpen && peer.dc && peer.dc.isOpen() && (peer.lastRx === undefined || Date.now() - peer.lastRx < QUIET_MS);

class WebRTCManager {
    constructor() {
        this.sendLater = withNetSim((fn) => fn()); // NET_SIM: fake WiFi delay/jitter/loss on outgoing state
        this.peers = {}; // [socketId]: { pc, dc, isOpen: false, pingTime: 0, binary: false }
    }

    setupPeer(socket, onInput) {
        try {
            const pc = new nodeDataChannel.PeerConnection(socket.id, {
                iceServers: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302'
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
                binary: true, // prefer compact binary ArrayBuffer by default
                socket
            };

            this.peers[socket.id] = peerRecord;

            // DataChannel Lifecycle
            dc.onOpen(() => {
                peerRecord.isOpen = true;
                peerRecord.lastRx = Date.now();
                console.log(`[WebRTC] 🚀 UDP DataChannel OPEN for player: ${socket.id}`);
                // Notify client that UDP is active with binary protocol support
                dc.sendMessage(JSON.stringify({ type: 'UDP_READY', binary: true, timestamp: Date.now() }));
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
                    const str = typeof msg === 'string' ? msg : msg.toString('utf8');
                    const data = JSON.parse(str);
                    if (data.type === 'INPUT') {
                        if (onInput) onInput(socket.id, data.payload);
                    } else if (data.type === 'PING') {
                        if (data.binary !== undefined) peerRecord.binary = !!data.binary;
                        // Echo ping back immediately for latency calculation
                        dc.sendMessage(JSON.stringify({ type: 'PONG', clientTime: data.clientTime }));
                    } else if (data.type === 'PROTOCOL') {
                        if (data.binary !== undefined) peerRecord.binary = !!data.binary;
                    }
                } catch (e) {
                    // Fast path: if raw inputs object sent
                    const str = typeof msg === 'string' ? msg : msg.toString('utf8');
                    if (str.startsWith('{') && onInput) {
                        try {
                            const parsed = JSON.parse(str);
                            if (parsed.up !== undefined || parsed.inputs !== undefined) {
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
        let payload = null;
        let binPayload = null;
        const viaUDP = new Set();

        for (const [id, peer] of Object.entries(this.peers)) {
            if (live(peer)) {
                // NET_SIM may deliver later (returns undefined); without it this runs now and reports failure
                const ok = this.sendLater(() => {
                    try {
                        if (peer.binary && typeof peer.dc.sendMessageBinary === 'function') {
                            if (!binPayload) binPayload = packBinarySnapshot(stateSync);
                            if (binPayload) {
                                peer.dc.sendMessageBinary(binPayload);
                                return true;
                            }
                        }
                        if (!payload) payload = JSON.stringify({ type: 'STATE', data: stateSync });
                        peer.dc.sendMessage(payload);
                        return true;
                    } catch (err) {
                        peer.isOpen = false;
                        return false;
                    }
                });
                if (ok !== false) viaUDP.add(id);
            }
        }

        // Socket.IO only for sockets still without an open channel (handshake, failed WebRTC, visitors), so one slow
        // peer doesn't double everyone's traffic
        if (io) for (const [id, sock] of io.sockets.sockets) if (!viaUDP.has(id)) this.sendLater(() => sock.volatile.emit('game_state', stateSync));
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
