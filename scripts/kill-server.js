// Ultra-fast cross-platform server killer for LAN Race
// Frees the port and kills running server instances in < 200ms
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const port = parseInt(process.env.PORT || process.argv[2] || '3232', 10);
const pidFile = path.join(__dirname, '..', '.lanrace.pid');

function isPortInUse(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (err) => {
      resolve(err.code === 'EADDRINUSE');
    });
    s.once('listening', () => {
      s.close(() => resolve(false));
    });
    s.listen(p, '0.0.0.0');
  });
}

function getPidsFromNetstat(targetPort) {
  const pids = new Set();
  try {
    const out = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const portPattern = `:${targetPort}`;
    const lines = out.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(portPattern)) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const localAddr = parts[1];
        if (localAddr && (localAddr.endsWith(portPattern) || localAddr === `[::]${portPattern}`)) {
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && pid > 4 && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }
    }
  } catch (e) {}
  return pids;
}

function getPidFromFile() {
  if (fs.existsSync(pidFile)) {
    try {
      const content = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(content, 10);
      if (pid && pid > 4 && pid !== process.pid) return pid;
    } catch (e) {}
  }
  return null;
}

function killPids(pids) {
  const validPids = Array.from(pids).filter(
    (pid) => pid && !isNaN(pid) && pid !== process.pid && pid > 4
  );
  if (validPids.length === 0) return;

  // 1. Direct TerminateProcess / SIGKILL (instant, 0ms)
  for (const pid of validPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {}
  }

  // 2. On Windows: batch taskkill with tree kill (/T) for child processes
  if (process.platform === 'win32') {
    try {
      const args = validPids.map((p) => `/PID ${p}`).join(' ');
      execSync(`taskkill /F /T ${args}`, { stdio: 'ignore', windowsHide: true });
    } catch (e) {}
  }
}

function killUnix(targetPort) {
  // 1. lsof
  try {
    const out = execSync(`lsof -ti :${targetPort}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = out.trim().split(/\s+/).map((p) => parseInt(p, 10)).filter(Boolean);
    killPids(pids);
  } catch (e) {}

  // 2. fuser
  try {
    execSync(`fuser -k -9 ${targetPort}/tcp`, { stdio: 'ignore' });
  } catch (e) {}

  // 3. pkill
  try {
    execSync(`pkill -9 -f "node.*server.js"`, { stdio: 'ignore' });
  } catch (e) {}
}

function cleanPidFile() {
  if (fs.existsSync(pidFile)) {
    try {
      fs.unlinkSync(pidFile);
    } catch (e) {}
  }
}

async function main() {
  const filePid = getPidFromFile();
  const portUsed = await isPortInUse(port);

  // If port is free and no pid file exists, exit immediately! (< 10ms)
  if (!portUsed && !filePid) {
    cleanPidFile();
    process.exit(0);
  }

  const pids = new Set();
  if (filePid) pids.add(filePid);

  if (process.platform === 'win32') {
    const netPids = getPidsFromNetstat(port);
    for (const p of netPids) pids.add(p);
    killPids(pids);
  } else {
    killPids(pids);
    killUnix(port);
  }

  cleanPidFile();

  // Fast async poll for socket release (up to 300ms max, checks every 20ms)
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    const stillInUse = await isPortInUse(port);
    if (!stillInUse) break;
    await new Promise((r) => setTimeout(r, 20));
  }

  process.exit(0);
}

main();
