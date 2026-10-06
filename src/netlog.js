// Network log: one line per event in logs/latency.log, for finding out afterwards whose connection went bad and when.
// Rotated to latency.log.old at 5 MB, so a long LAN party can't fill the disk. Silent under `node --test`.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'logs');
const FILE = path.join(DIR, 'latency.log');
const MAX_BYTES = 5 * 1024 * 1024;
const enabled = !process.env.NODE_TEST_CONTEXT;
let bytes = null; // file size, read once then tracked

function log(msg) {
    if (!enabled) return;
    const line = `${new Date().toISOString()} ${msg}\n`;
    try {
        if (bytes === null) {
            fs.mkdirSync(DIR, { recursive: true });
            bytes = fs.existsSync(FILE) ? fs.statSync(FILE).size : 0;
        }
        if (bytes + line.length > MAX_BYTES) { fs.renameSync(FILE, FILE + '.old'); bytes = 0; }
        fs.appendFileSync(FILE, line);
        bytes += line.length;
    } catch (e) { /* logging must never take the game down */ }
}

// A number from a client report: finite and within range, else null
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

// The browser's own readings (every 2 s), checked at the trust boundary
function sanitizeTelemetry(d) {
    if (!d || typeof d !== 'object') return null;
    return {
        rttMs: num(d.rttMs, 60000), jitterMs: num(d.jitterMs, 60000), lossPct: num(d.lossPct, 100),
        delayMs: num(d.delayMs, 60000), predErrCm: num(d.predErrCm, 1e7), fps: num(d.fps, 1000),
        link: d.link === 'UDP' ? 'UDP' : 'TCP',
    };
}

module.exports = { log, sanitizeTelemetry };
