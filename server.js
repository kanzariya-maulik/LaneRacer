const os = require('os');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const setupSocketManager = require('./src/socketManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
// Three.js served locally so LAN play works without internet
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

// Set up socket logic
setupSocketManager(io);

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3232;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log('\n--- LAN RACE SERVER ACTIVE ---');
  console.log(`> Host Locally:  http://localhost:${PORT}`);
  console.log(`> Host on LAN:   http://${ip}:${PORT}`);
  console.log('------------------------------\n');
});
