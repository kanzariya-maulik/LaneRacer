const os = require('os');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const setupSocketManager = require('./src/socketManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Disable browser caching during active gameplay and development
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
// Three.js served locally so LAN play works without internet
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

// Set up socket logic
setupSocketManager(io);

function getLocalIps() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['localhost'];
}

const PORT = process.env.PORT || 3232;

let retried = false;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && !retried) {
    retried = true;
    console.warn(`\n[Port ${PORT}] Port busy, cleaning previous instances...`);
    try {
      require('child_process').execSync(`node "${path.join(__dirname, 'scripts', 'kill-server.js')}" ${PORT}`, { stdio: 'ignore' });
    } catch (e) {}
    setTimeout(() => {
      server.listen(PORT, '0.0.0.0');
    }, 300);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIps();
  console.log('\n--- LAN RACE SERVER ACTIVE ---');
  console.log(`> Host Locally:  http://localhost:${PORT}`);
  console.log(`> Host on LAN / Hotspot:`);
  ips.forEach((ip) => console.log(`  ▶ http://${ip}:${PORT}`));
  console.log('------------------------------\n');
});
