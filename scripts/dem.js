// Ground height from a Copernicus GLO-30 elevation tile (ESA / AWS open data, 1 arc-second ≈ 30 m, float32 metres
// above the EGM2008 geoid): a GeoTIFF reader for just what those tiles use (tiled, DEFLATE, floating-point predictor)
// and a bilinear sampler. For circuits with no F1 car positions to take heights from (Buddh: last raced in 2013).
const fs = require('fs');
const zlib = require('zlib');

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

function readTiff(file) {
    const buf = fs.readFileSync(file);
    if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error(`${file}: not a little-endian TIFF`);
    const ifd = buf.readUInt32LE(4), count = buf.readUInt16LE(ifd), tags = {};
    for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12, tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), n = buf.readUInt32LE(e + 4);
        const size = TYPE_SIZE[type] * n, at = size <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
        const val = [];
        for (let i = 0; i < n; i++) {
            const o = at + i * TYPE_SIZE[type];
            val.push(type === 3 ? buf.readUInt16LE(o) : type === 4 ? buf.readUInt32LE(o) : type === 12 ? buf.readDoubleLE(o) : type === 16 ? Number(buf.readBigUInt64LE(o)) : buf[o]);
        }
        tags[tag] = val;
    }
    const W = tags[256][0], H = tags[257][0], tw = tags[322][0], th = tags[323][0];
    if (tags[259][0] !== 8 || tags[339][0] !== 3 || tags[258][0] !== 32) throw new Error(`${file}: expected DEFLATE float32 tiles`);
    const predictor = tags[317] ? tags[317][0] : 1, across = Math.ceil(W / tw);
    const [, , , lon0, lat0] = tags[33922], [dlon, dlat] = tags[33550];
    const cache = new Map();
    const tile = (tx, ty) => {
        const key = ty * across + tx;
        if (cache.has(key)) return cache.get(key);
        const raw = zlib.inflateSync(buf.subarray(tags[324][key], tags[324][key] + tags[325][key]));
        const out = new Float32Array(tw * th);
        if (predictor === 3) { // floating point: bytes split into planes (most significant first), then differenced along each row
            const row = new Uint8Array(tw * 4), dv = new DataView(out.buffer);
            for (let y = 0; y < th; y++) {
                const r = raw.subarray(y * tw * 4, (y + 1) * tw * 4);
                for (let i = 1; i < r.length; i++) r[i] = (r[i] + r[i - 1]) & 255;
                row.set(r);
                for (let x = 0; x < tw; x++) dv.setUint32((y * tw + x) * 4, (row[x] << 24 | row[tw + x] << 16 | row[2 * tw + x] << 8 | row[3 * tw + x]) >>> 0, true);
            }
        } else out.set(new Float32Array(raw.buffer, raw.byteOffset, tw * th));
        cache.set(key, out);
        return out;
    };
    const px = (x, y) => tile(Math.floor(x / tw), Math.floor(y / th))[(y % th) * tw + (x % tw)];
    // Height (m) at (lat, lon), bilinear between pixel centres (the tile's tie point is a pixel corner)
    return (lat, lon) => {
        const u = (lon - lon0) / dlon - 0.5, v = (lat0 - lat) / dlat - 0.5, x = Math.floor(u), y = Math.floor(v), fu = u - x, fv = v - y;
        if (x < 0 || y < 0 || x + 1 >= W || y + 1 >= H) throw new Error(`${lat},${lon} outside ${file}`);
        return px(x, y) * (1 - fu) * (1 - fv) + px(x + 1, y) * fu * (1 - fv) + px(x, y + 1) * (1 - fu) * fv + px(x + 1, y + 1) * fu * fv;
    };
}

module.exports = { readTiff };
