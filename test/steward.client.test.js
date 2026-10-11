const { test, before } = require('node:test');
const assert = require('node:assert');
let S;
before(async () => { S = await import('../public/js/steward.js'); });

test('stewardText: every verdict has a headline and a tip that says what to do', () => {
    const t = (e) => S.stewardText(e);
    assert.deepStrictEqual(t({ kind: 'collision', add: 5, victim: 'RAHUL', off: false }), { head: '+5 s · You hit RAHUL', tip: 'Brake earlier when following — leave a car\'s length', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'collision', add: 10, victim: 'RAHUL', off: true }), { head: '+10 s · You pushed RAHUL off', tip: 'Leave a car\'s width on corner exits', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'hit', by: 'RAHUL', add: 5 }), { head: 'Hit by RAHUL · +5 s to RAHUL', tip: 'Not your fault — no penalty for you', tone: 'good' });
    assert.deepStrictEqual(t({ kind: 'incident', with: 'RAHUL' }), { head: 'Racing incident · no penalty', tip: 'Contact with RAHUL — not clear enough to blame either driver', tone: 'info' });
    assert.deepStrictEqual(t({ kind: 'warning', count: 2, of: 3 }), { head: 'Corner cut · warning 2/3', tip: 'Keep two wheels inside the white line', tone: 'warn' });
    assert.deepStrictEqual(t({ kind: 'flag' }), { head: 'Black & white flag', tip: 'Next corner cut = +5 s', tone: 'warn' });
    assert.deepStrictEqual(t({ kind: 'penalty', add: 5, penalty: 10 }), { head: '+5 s · Corner cut', tip: 'Keep two wheels inside the white line', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'wide' }), { head: 'Wide · lap time not counted', tip: '', tone: 'muted' });
    assert.deepStrictEqual(t({ kind: 'jump', add: 10, penalty: 10 }), { head: 'Jump start · +10 s', tip: 'Wait for all five lights to go out', tone: 'bad' });
    assert.deepStrictEqual(t({ kind: 'deleted' }), { head: 'Lap deleted · track limits', tip: 'Keep two wheels inside the white line', tone: 'warn' });
    assert.strictEqual(t({ kind: 'nope' }), null);
});
