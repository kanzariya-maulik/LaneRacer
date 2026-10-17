// node scripts/build-overlay.js <id> <outDir>: the circuit's build data over aerial imagery every 200 m, to check by eye.
// Gravel yellow, asphalt run-off cyan, grass green, paint magenta, kerbs red, barriers white (fence: orange), centreline blue.
// Imagery: Esri, Maxar, Earthstar Geographics (checking only, not stored in the repo).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { imagery, px, py } = require('./survey-track');
const { geo } = require('./import-build');

const S = 400, EVERY_M = 200;
const COL = { gravel: [255, 220, 0], asphalt: [0, 230, 255], grass: [60, 220, 60], paint: [255, 0, 255], astroturf: [120, 255, 120], kerb: [255, 40, 40], barrier: [255, 255, 255], fence: [255, 140, 0], centre: [60, 120, 255] };

async function overlay(id, out) {
    const DATA = path.join(__dirname, '..', 'data', 'tracks'), raw = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
    const build = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.build.json`), 'utf8')), { toLL } = geo(raw.osmFit);
    const C = raw.path.map((p) => [p.x / raw.scale, -p.y / raw.scale]);
    const lines = [[[...C, C[0]], COL.centre]];
    for (const s of build.surfaces) lines.push([[...s.poly, s.poly[0]], COL[s.kind]]);
    for (const b of build.barriers) lines.push([b.pts, b.fence ? COL.fence : COL.barrier]);
    const { pixel } = await imagery(id, C.map(toLL));
    fs.mkdirSync(out, { recursive: true });
    let along = 0;
    for (let i = 0; i < C.length; i++) {
        if (i) along += Math.hypot(C[i][0] - C[i - 1][0], C[i][1] - C[i - 1][1]);
        if (i && Math.floor(along / EVERY_M) === Math.floor((along - Math.hypot(C[i][0] - C[i - 1][0], C[i][1] - C[i - 1][1])) / EVERY_M)) continue;
        const ll = toLL(C[i]), cx = Math.round(px(ll.lon)) - S / 2, cy = Math.round(py(ll.lat)) - S / 2, img = [];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.push(pixel(cx + x, cy + y));
        for (const [pts, col] of lines) for (let k = 1; k < pts.length; k++) {
            const a = toLL(pts[k - 1]), b = toLL(pts[k]), ax = px(a.lon) - cx, ay = py(a.lat) - cy, bx = px(b.lon) - cx, by = py(b.lat) - cy;
            if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax >= S && bx >= S) || (ay >= S && by >= S)) continue;
            const st = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) || 1;
            for (let q = 0; q <= st; q++) { const x = Math.round(ax + ((bx - ax) * q) / st), y = Math.round(ay + ((by - ay) * q) / st); if (x >= 0 && y >= 0 && x < S && y < S) img[y * S + x] = col; }
        }
        const bmp = Buffer.alloc(54 + S * S * 3);
        bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(S, 18); bmp.writeInt32LE(-S, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
        img.forEach((c, k) => { bmp[54 + k * 3] = c[2]; bmp[55 + k * 3] = c[1]; bmp[56 + k * 3] = c[0]; });
        const f = path.join(out, `${String(Math.round(along)).padStart(4, '0')}`);
        fs.writeFileSync(f + '.bmp', bmp);
        execFileSync('sips', ['-s', 'format', 'png', f + '.bmp', '--out', f + '.png'], { stdio: 'ignore' });
        fs.unlinkSync(f + '.bmp');
    }
    console.log(`${id}: overlays in ${out}`);
}

if (require.main === module) overlay(process.argv[2], process.argv[3]).catch((e) => { console.error(e); process.exit(1); });
