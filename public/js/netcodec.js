// Binary fast update: the 60 Hz packet as 22 + 34 bytes per car instead of ~110 bytes of JSON per car, so a full grid
// stays inside one UDP datagram (an SCTP message split into fragments is lost whole when any fragment is).
// Shared by the server (encode) and the browser (decode); decode gives back the same { s, t, g, c } arrays as JSON did.
const HEAD = 22, CAR = 34;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

export function encodeFast(pkt) {
    const buf = new ArrayBuffer(HEAD + CAR * pkt.c.length), d = new DataView(buf);
    d.setUint8(0, 1); // format version
    d.setUint32(1, pkt.s >>> 0, true);
    d.setFloat64(5, pkt.t, true);
    d.setFloat64(13, pkt.g, true);
    d.setUint8(21, pkt.c.length);
    let o = HEAD;
    for (const e of pkt.c) {
        d.setUint8(o, e[0]);
        d.setUint8(o + 1, e[6]);
        d.setUint8(o + 2, e[12] || 0);
        d.setInt8(o + 3, clamp(e[14] ?? 0, -128, 127));
        d.setFloat32(o + 4, e[1], true);
        d.setFloat32(o + 8, e[2], true);
        d.setFloat32(o + 12, e[3], true);
        d.setInt16(o + 16, clamp(e[4] * 10, -32768, 32767), true);
        d.setInt16(o + 18, clamp(e[5] * 10000, -32768, 32767), true);
        d.setInt16(o + 20, clamp(e[7] * 10, -32768, 32767), true);
        d.setInt16(o + 22, clamp(e[8] * 10, -32768, 32767), true);
        d.setUint16(o + 24, clamp(e[9] * 1000, 0, 65535), true);
        d.setUint16(o + 26, clamp(e[11] * 65535, 0, 65535), true);
        d.setUint16(o + 28, clamp(e[13] * 10, 0, 65535), true);
        d.setInt32(o + 30, e[10], true);
        o += CAR;
    }
    return buf;
}

export function decodeFast(buf) {
    const d = buf instanceof DataView ? buf : ArrayBuffer.isView(buf) ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf);
    if (d.byteLength < HEAD || d.getUint8(0) !== 1) return null;
    const n = d.getUint8(21);
    if (d.byteLength < HEAD + CAR * n) return null;
    const c = new Array(n);
    for (let k = 0, o = HEAD; k < n; k++, o += CAR) {
        c[k] = [d.getUint8(o), d.getFloat32(o + 4, true), d.getFloat32(o + 8, true), d.getFloat32(o + 12, true),
            d.getInt16(o + 16, true) / 10, d.getInt16(o + 18, true) / 10000, d.getUint8(o + 1),
            d.getInt16(o + 20, true) / 10, d.getInt16(o + 22, true) / 10, d.getUint16(o + 24, true) / 1000,
            d.getInt32(o + 30, true), d.getUint16(o + 26, true) / 65535, d.getUint8(o + 2),
            d.getUint16(o + 28, true) / 10, d.getInt8(o + 3)];
    }
    return { s: d.getUint32(1, true), t: d.getFloat64(5, true), g: d.getFloat64(13, true), c };
}
