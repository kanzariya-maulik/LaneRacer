const test = require('node:test');
const assert = require('node:assert');
const { convert, SCALE } = require('../scripts/import-tracks');

test('convert scales, flips y, keeps every 2nd point, uses median width', () => {
    const csv = [
        '# x_m,y_m,w_tr_right_m,w_tr_left_m',
        '0,0,5,5',
        '1,1,4,4',
        '2,2,6,6',
        '3,3,5,5',
        '',
    ].join('\n');
    const t = convert(csv, { id: 't', name: 'Test' });
    assert.strictEqual(SCALE, 6);
    assert.strictEqual(t.id, 't');
    assert.strictEqual(t.name, 'Test');
    assert.strictEqual(t.scale, 6);
    assert.deepStrictEqual(t.path, [{ x: 0, y: 0 }, { x: 12, y: -12 }]);
    // widths sorted [8, 10, 10, 12] → median index 2 → 10 m × 2 × 6
    assert.strictEqual(t.width, 120);
});
