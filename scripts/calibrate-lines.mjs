// Corner limits for every track (src/game/lineCalibration.js), driven with steering help (as the bots). Writes
// data/tracks/<id>.limits.json; re-run when a track's shape changes (the game ignores a file for another shape).
// node scripts/calibrate-lines.mjs [monza,spa,...]
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const Track = require('../src/game/Track.js');
const { calibrate } = require('../src/game/lineCalibration.js');

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tracks');

for (const id of (process.argv[2] || Track.TRACK_IDS.join(',')).split(',')) {
    const t0 = Date.now(), help = calibrate(id, { steerHelp: 1 });
    writeFileSync(join(DATA, `${id}.limits.json`), JSON.stringify({ points: help.length, help }));
    console.log(id.padEnd(12), 'corners', `${Math.min(...help).toFixed(3)}-${Math.max(...help).toFixed(3)}`, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
