// A track that lives through a session: rubber laid down on the racing line (darker and smoother as laps are driven,
// most where cars brake and turn) and skid marks where cars lock up or slide. Plain numbers (no three.js): game3d.js uploads them,
// trackMaterials.js asphaltMaterial draws them.
import { smoothPath } from './scenery.js';

// How much darker the asphalt gets: the line up to 30 % at level 1 (1.6 m core, Gaussian falloff), a locked tyre's pass
// 20 % (a streak), skids at most 45 %, everything together at most 50 % (dark grey, never black)
export const RUBBER = { maxDark: 0.3, totalDark: 0.5, smooth: 0.15, coreM: 0.8, sigmaM: 0.9 };
export const SKID = { stamp: 0.2, cap: 0.45, latM: 16, texLat: 0.1, texAlong: 0.25, rows: 4096 }; // ±16 m, 0.1 x 0.25 m texels

// How rubbered-in the track is after this many laps (all cars together): 0.15 fresh, near 1 after a long weekend
export const rubberLevel = (lapsDriven) => 0.15 + 0.85 * (1 - Math.exp(-lapsDriven / 25));

// Per smooth-curve point: [racing line lateral offset (m, + right), weight 0..1]. Weight 1 in braking zones (the safe speed
// drops 15 % or more within 150 m) and at apexes (a local minimum of the safe speed), 0.5 elsewhere
export function rubberProfile(t) {
    const sc = t.scale, P = t.path, n = P.length, V = t.safeSpeed, top = Math.max(...V), { up } = smoothPath(P, sc, t.cum);
    const raw = V.map((v, i) => {
        let lowest = v;
        for (let j = i, d = 0; d <= 150 * sc && j < i + n; d += t.cum[(j % n) + 1] - t.cum[j % n], j++) lowest = Math.min(lowest, V[j % n]);
        const apex = v < top && v <= V[(i - 1 + n) % n] && v <= V[(i + 1) % n];
        return lowest <= 0.85 * v || apex ? 1 : 0.5;
    });
    const w = raw.map((_, i) => Math.max(raw[(i - 1 + n) % n], raw[i], raw[(i + 1) % n])); // the zone's ends hold through the upsampling
    const off = up(t.racingLine.offset.map((o) => o / sc)), wt = up(w), out = new Float32Array(off.length * 2);
    off.forEach((o, k) => { out[k * 2] = o; out[k * 2 + 1] = wt[k]; });
    return out;
}

// Skid marks in track space (lap metres, lateral metres): one byte per 0.1 m x 0.25 m texel, the lap folded into columns of
// 4096 rows (1024 m) side by side. 255 = the cap. stamp() writes, darkness() reads; `dirty` tells game3d.js to upload
export class SkidLayer {
    constructor(t) {
        this.lapM = t.cum[t.path.length] / t.scale;
        this.colW = Math.round((2 * SKID.latM) / SKID.texLat);
        this.colM = SKID.rows * SKID.texAlong;
        this.cols = Math.ceil(this.lapM / this.colM);
        this.width = this.colW * this.cols;
        this.height = SKID.rows;
        this.data = new Uint8Array(this.width * this.height);
        this.dirty = false;
    }
    texel(lap, lat) {
        lap = ((lap % this.lapM) + this.lapM) % this.lapM;
        const c = Math.floor(lap / this.colM), row = Math.floor((lap - c * this.colM) / SKID.texAlong), x = Math.floor((lat + SKID.latM) / SKID.texLat);
        return x < 0 || x >= this.colW ? -1 : row * this.width + c * this.colW + x;
    }
    // a tyre's contact patch (0.3 m wide) at lap / lat metres, strength 0..1
    stamp(lap, lat, strength) {
        const add = Math.round(((SKID.stamp / SKID.cap) * 255) * Math.min(1, strength));
        if (add <= 0) return;
        for (const d of [-SKID.texLat, 0, SKID.texLat]) {
            const i = this.texel(lap, lat + d);
            if (i >= 0) this.data[i] = Math.min(255, this.data[i] + add);
        }
        this.dirty = true;
    }
    darkness(lap, lat) { const i = this.texel(lap, lat); return i < 0 ? 0 : (this.data[i] / 255) * SKID.cap; }
    clear() { this.data.fill(0); this.dirty = true; }
}
