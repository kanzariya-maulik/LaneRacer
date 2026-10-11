// The steward card: every verdict in plain words, with one tip on what to do next time (pure; node-tested)
const LINE_TIP = 'Keep two wheels inside the white line';
export function stewardText(e) {
    switch (e.kind) {
        case 'collision': return e.off
            ? { head: `+${e.add} s · You pushed ${e.victim} off`, tip: 'Leave a car\'s width on corner exits', tone: 'bad' }
            : { head: `+${e.add} s · You hit ${e.victim}`, tip: 'Brake earlier when following — leave a car\'s length', tone: 'bad' };
        case 'hit': return { head: `Hit by ${e.by} · +${e.add} s to ${e.by}`, tip: 'Not your fault — no penalty for you', tone: 'good' };
        case 'incident': return { head: 'Racing incident · no penalty', tip: `Contact with ${e.with} — both moved`, tone: 'info' };
        case 'warning': return { head: `Corner cut · warning ${e.count}/${e.of}`, tip: LINE_TIP, tone: 'warn' };
        case 'flag': return { head: 'Black & white flag', tip: 'Next corner cut = +5 s', tone: 'warn' };
        case 'penalty': return { head: `+${e.add} s · Corner cut`, tip: LINE_TIP, tone: 'bad' };
        case 'wide': return { head: 'Wide · lap time not counted', tip: '', tone: 'muted' };
        case 'jump': return { head: `Jump start · +${e.add} s`, tip: 'Wait for all five lights to go out', tone: 'bad' };
        case 'deleted': return { head: 'Lap deleted · track limits', tip: LINE_TIP, tone: 'warn' };
        default: return null;
    }
}
