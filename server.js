const os = require('os');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const setupSocketManager = require('./src/socketManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled rejection at:', promise, 'reason:', reason);
});

// Serve static files from the public directory
// html and js: no-cache so latest code is always loaded
// 3d models, textures and sounds: cached by browser for instant loading
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));
app.use('/data/tracks', express.static(path.join(__dirname, 'data', 'tracks'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400')
}));
// Three.js served locally so LAN play works without internet
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800')
}));

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
