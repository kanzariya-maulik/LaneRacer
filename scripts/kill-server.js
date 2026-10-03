const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const port = parseInt(process.env.PORT || process.argv[2] || '3232', 10);
const pidFile = path.join(__dirname, '..', '.lanrace.pid');

function killPids(pids) {
  const currentPid = process.pid;
  for (const pidStr of pids) {
    const pid = parseInt(pidStr, 10);
    if (!pid || isNaN(pid) || pid === currentPid || pid <= 4) continue;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch (e) {
      // Ignored if already dead
    }
  }
}

function killWindows() {
  const pids = new Set();

  // 1. Check netstat for port
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const localAddr = parts[1];
        const state = parts[3] || parts[2];
        if (localAddr && (localAddr.endsWith(`:${port}`) || localAddr === `[::]:${port}`)) {
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(parseInt(pid, 10))) {
            pids.add(pid);
          }
        }
      }
    }
  } catch (e) {}

  // 2. Check PowerShell NetTCPConnection
  try {
    const psCmd = `powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`;
    const psOut = execSync(psCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of psOut.split(/\r?\n/)) {
      const pid = line.trim();
      if (pid && !isNaN(parseInt(pid, 10))) {
        pids.add(pid);
      }
    }
  } catch (e) {}

  // 3. Kill any node process executing server.js
  try {
    const psCmd2 = `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { \\$_.CommandLine -like '*server.js*' } | Select-Object -ExpandProperty ProcessId"`;
    const psOut2 = execSync(psCmd2, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of psOut2.split(/\r?\n/)) {
      const pid = line.trim();
      if (pid && !isNaN(parseInt(pid, 10))) {
        pids.add(pid);
      }
    }
  } catch (e) {}

  killPids(pids);
}

function killUnix() {
  // 1. fuser
  try {
    execSync(`fuser -k -9 ${port}/tcp`, { stdio: 'ignore' });
  } catch (e) {}

  // 2. lsof
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = out.trim().split(/\s+/).filter(Boolean);
    killPids(pids);
  } catch (e) {}

  // 3. pkill
  try {
    execSync(`pkill -9 -f "node.*server.js"`, { stdio: 'ignore' });
  } catch (e) {}
}

function cleanPidFile() {
  if (fs.existsSync(pidFile)) {
    try {
      const pid = fs.readFileSync(pidFile, 'utf8').trim();
      if (pid) killPids([pid]);
    } catch (e) {}
    try {
      fs.unlinkSync(pidFile);
    } catch (e) {}
  }
}

function main() {
  cleanPidFile();
  if (process.platform === 'win32') {
    killWindows();
  } else {
    killUnix();
  }
  // Brief pause to allow OS socket release
  const start = Date.now();
  while (Date.now() - start < 200) {
    // sync busywait 200ms
  }
  cleanPidFile();
}

main();
