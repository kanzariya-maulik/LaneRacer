// Qualifying texts (pure; node-tested)
export const fmtLap = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function clockText(c, me = {}) {
    if ((c.qphase || c.phase) === 'flag') return 'FINISH YOUR LAP'; // quali_clock carries the segment phase as qphase
    if (c.format === 'oneshot') return me.onTimedLap ? 'ONE-SHOT · FLYING LAP' : 'ONE-SHOT · OUT-LAP';
    return c.format === 'full' ? `Q${c.segment} · ${mmss(c.endsInMs)}` : `QUALIFYING · ${mmss(c.endsInMs)}`;
}
export function lapBanner(e, survive) {
    if (!e.valid) return null;
    if (e.pole) return 'PROVISIONAL POLE';
    if (e.pos > survive) return `STILL IN THE DROP ZONE — P${e.pos}`;
    if (e.prevPos && e.pos < e.prevPos) return `IMPROVED P${e.prevPos} → P${e.pos}`;
    return null;
}

const TYRE_NAMES = { S: 'SOFTS', M: 'MEDIUMS', H: 'HARDS' };
export const boxBanner = (call, c) => `BOX ${call === 'next' ? 'NEXT' : 'THIS'} LAP — ${TYRE_NAMES[c] || ''}`.trim();

// Session time left on the quali clock: counts down from the server's last word, held while the host has paused
export const clockLeftMs = (qc, now) => qc.endsInMs - ((qc.frozen ?? now) - qc.at);
