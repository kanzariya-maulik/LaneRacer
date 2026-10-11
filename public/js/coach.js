// Live coach (pure; node-tested): rates each corner against the racing line and gives one short tip at a time.
// Corners: a braking run (phase 2) plus its corner run (phase 1), merged when closer than MERGE_M (a chicane is one)
export const GAP_S = 4, SHOW_S = 2.5;
const TIP_MAX = 3, QUIET_AFTER = 3, STEWARD_HOLD_S = 4, CONTACT_QUIET_S = 5;
const MERGE_M = 60, WINDOW_M = 150, WIDE_AFTER_M = 30, EARLY_M = 20, SLOW_K = 0.85, APEX_M = 2, ENTRY_K = 0.4, BRAKE_ON = 0.2;

const lapM = (t) => t.cum[t.path.length] / t.scale;
const heading = (P, i) => { const n = P.length, a = P[i], b = P[(i + 1) % n]; return Math.atan2(b.y - a.y, b.x - a.x); };

export function cornersOf(rl, t) {
    const n = rl.phase.length, at = (i) => t.cum[i] / t.scale, L = lapM(t);
    const fwd = (a, b) => (((at(b) - at(a)) % L) + L) % L;
    const runs = [];
    for (let i = 0; i < n; i++) {
        if (rl.phase[i] !== 2 || rl.phase[(i - 1 + n) % n] === 2) continue;
        let e = i;
        while (rl.phase[(e + 1) % n] === 2 && (e + 1) % n !== i) e = (e + 1) % n;
        while (rl.phase[(e + 1) % n] === 1 && (e + 1) % n !== i) e = (e + 1) % n;
        runs.push({ brakeI: i, endI: e });
    }
    const merged = [];
    for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && fwd(last.endI, r.brakeI) < MERGE_M) last.endI = r.endI; else merged.push({ ...r });
    }
    if (merged.length > 1 && fwd(merged[merged.length - 1].endI, merged[0].brakeI) < MERGE_M) merged[0].brakeI = merged.pop().brakeI;
    return merged.map(({ brakeI, endI }) => {
        let apexI = brakeI;
        for (let k = brakeI; ; k = (k + 1) % n) { if (rl.speed[k] < rl.speed[apexI]) apexI = k; if (k === endI) break; }
        const d = heading(t.path, endI) - heading(t.path, brakeI), turn = Math.sign(Math.round(Math.atan2(Math.sin(d), Math.cos(d)) * 1000));
        return { brakeI, apexI, endI, brakeS: at(brakeI), endS: at(endI), vApex: rl.speed[apexI], turn };
    });
}

export function linePoint(rl, t, i) {
    const P = t.path, n = P.length, p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, o = rl.offset[i];
    return { x: p.x - ((b.y - a.y) / len) * o, y: p.y + ((b.x - a.x) / len) * o };
}

export function pastLine(t, i, x, y) {
    if (!t.edgeR) return false;
    const P = t.path, n = P.length, a = P[i], b = P[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)), px = a.x + dx * u, py = a.y + dy * u;
    const right = -dy * (x - px) + dx * (y - py) > 0, e = right ? t.edgeR : (t.edgeL || t.edgeR);
    return Math.hypot(x - px, y - py) > e[i] + (e[(i + 1) % n] - e[i]) * u + 1 * t.scale;
}

export function createCoach(corners, t, rl, opts = {}) {
    const L = lapM(t), at = (i) => t.cum[i] / t.scale, rel = (s, from) => (((s - from) % L) + L) % L;
    const st = { last: -Infinity, tips: {}, streak: corners.map(() => 0), cur: null, intro: !!opts.intro, lap: null, lapClean: true, cleanLaps: 0, nudged: false, towSince: null };
    const inWindow = (c, s) => rel(s, c.brakeS - WINDOW_M) <= rel(c.endS + WIDE_AFTER_M, c.brakeS - WINDOW_M);
    const say = (f, text, tone) => {
        if (f.t - st.last < GAP_S || f.t - (f.stewardAt ?? -Infinity) < STEWARD_HOLD_S) return null;
        st.last = f.t;
        return { text, tone };
    };
    const tip = (f, key, text) => {
        if ((st.tips[key] || 0) >= TIP_MAX) return null;
        const m = say(f, text, 'tip');
        if (m) st.tips[key] = (st.tips[key] || 0) + 1;
        return m;
    };

    function record(f, s) {
        const r = st.cur, c = corners[r.k];
        const before = rel(s, c.brakeS - WINDOW_M) < WINDOW_M, inCorner = rel(s, c.brakeS) <= rel(c.endS, c.brakeS);
        if (r.entry === undefined) { r.entry = f.speed; if (f.speed < ENTRY_K * c.vApex) r.skip = true; }
        if (f.ghostOverlap || f.t - (f.stewardAt ?? -Infinity) < CONTACT_QUIET_S) r.skip = true;
        if (r.prevS !== undefined && rel(s, r.prevS) > rel(r.prevS, s)) r.skip = true; // moved backwards along the lap: spun or reversing
        r.prevS = s;
        const braking = f.brake > BRAKE_ON || f.assistBrake;
        if (r.brakeAt === null && braking && (before || inCorner)) {
            r.brakeAt = s;
            r.early = before ? WINDOW_M - rel(s, c.brakeS - WINDOW_M) : 0;
            r.help = !(f.brake > BRAKE_ON);
        }
        if (inCorner) r.vMin = Math.min(r.vMin, f.speed);
        const apexS = at(c.apexI), d = Math.min(rel(s, apexS), rel(apexS, s));
        if (inCorner && d < r.apexD) { const q = linePoint(rl, t, c.apexI); r.apexD = d; r.apexMiss = Math.hypot(f.x - q.x, f.y - q.y) / t.scale; }
        if (f.wide && rel(s, c.brakeS) <= rel(c.endS + WIDE_AFTER_M, c.brakeS)) r.wide = true;
    }

    function verdict() {
        const r = st.cur, c = corners[r.k];
        if (r.skip || r.vMin === Infinity) return null;
        let v;
        if (r.wide) v = ['Too fast in — missed the apex', 'bad'];
        else if (!r.help && r.early > EARLY_M) v = [`Braked ${Math.round(r.early / 5) * 5} m early — brake later`, 'warn'];
        else if (r.vMin < SLOW_K * c.vApex) v = ['Slow mid-corner — carry more speed', 'warn'];
        else if (r.apexMiss > APEX_M) v = ['Missed the apex — aim for the inside kerb', 'warn'];
        else v = ['Perfect corner', 'good'];
        if (v[1] !== 'good') { st.lapClean = false; st.streak[r.k] = 0; return v; }
        st.streak[r.k]++;
        return st.streak[r.k] > QUIET_AFTER ? null : v;
    }

    return {
        update(f) {
            if (st.lap !== null && f.lap > st.lap) { st.cleanLaps = st.lapClean ? st.cleanLaps + 1 : 0; st.lapClean = true; }
            st.lap = f.lap;
            if (f.t - (f.stewardAt ?? -Infinity) < CONTACT_QUIET_S) st.lapClean = false;
            if (st.intro) { st.intro = false; return say(f, 'Coach on — C to turn off', 'tip'); }
            if (f.inPit) { st.cur = null; return null; }
            const s = at(f.i);
            let v = null;
            if (st.cur && !inWindow(corners[st.cur.k], s)) { v = verdict(); st.cur = null; }
            if (!st.cur) {
                const k = corners.findIndex((c) => inWindow(c, s));
                if (k >= 0) st.cur = { k, brakeAt: null, early: 0, help: false, vMin: Infinity, apexD: Infinity, apexMiss: 0, wide: false, skip: f.mode === 'race' && f.lap === 0 && k === 0 };
            }
            if (st.cur) record(f, s);
            if (v) return say(f, v[0], v[1]);
            return this.tips ? this.tips(f, s) : null;
        },
    };
}
