const { test } = require('node:test');
const assert = require('node:assert');
const net = require('../src/webrtcManager');

test('UDP fallback goes over Socket.IO only to sockets without an open channel', () => {
    const got = [];
    const sock = (id) => ({ id, volatile: { emit: (ev) => got.push([id, ev]) } });
    const io = { sockets: { sockets: new Map([['udp', sock('udp')], ['tcp', sock('tcp')], ['visitor', sock('visitor')]]) },
        volatile: { emit: () => got.push(['ALL', 'game_state']) } };
    const sent = [];
    net.peers = { udp: { isOpen: true, dc: { isOpen: () => true, sendMessage: (m) => sent.push(m) } }, tcp: { isOpen: false, dc: null } };
    net.broadcastGameState({ s: 1, t: 0, c: [] }, io);
    assert.strictEqual(sent.length, 1, 'UDP peer gets it over the DataChannel');
    assert.deepStrictEqual(got.sort(), [['tcp', 'game_state'], ['visitor', 'game_state']], 'no broadcast to everyone');
    net.peers = {};
});
