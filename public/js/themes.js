// What each circuit's surroundings look like: land, sky and light, trees, city, sea, mountains, a landmark. Used by
// scenery.js (what goes where) and game3d.js (how it's drawn)

// Ground colours (two tones for the mown stripes), the hemisphere light's ground bounce, the verge grass
export const LANDS = {
    park:   { ground: ['#5f9e35', '#69a83c'], speck: '#4f8a2b', bounce: 0x4f7a2a, verge: '#5f9e35' },
    forest: { ground: ['#4e8a2e', '#57943a'], speck: '#3f7424', bounce: 0x3e6a22, verge: '#55923a' },
    dry:    { ground: ['#8fa24a', '#9aab55'], speck: '#7d8f3c', bounce: 0x7a7a3a, verge: '#7f9a45' },
    desert: { ground: ['#d8b98a', '#dfc294'], speck: '#c4a274', bounce: 0xb89a6a, verge: '#c9b07c' },
    dunes:  { ground: ['#b9b27a', '#c4bc86'], speck: '#8f9a55', bounce: 0x9a9460, verge: '#7f9a4f' },
    city:   { ground: ['#8b8d8f', '#929496'], speck: '#7a7c7e', bounce: 0x6f7378, verge: '#6f9a45' },
};

// Sky gradient (zenith, horizon = fog), sun colour and strength, sun height and bearing (degrees), sky light strength
export const SKIES = {
    clear:    { top: '#5f9fe0', horizon: '#c9e2f5', sun: '#ffffff', power: 2.3, elevation: 55, azimuth: 35, hemi: 1.4 },
    hazy:     { top: '#7fb0de', horizon: '#dbe6ee', sun: '#fff6e8', power: 2.0, elevation: 45, azimuth: 60, hemi: 1.5 },
    overcast: { top: '#9fb2c4', horizon: '#d5dbe0', sun: '#f2f2f2', power: 1.4, elevation: 60, azimuth: 20, hemi: 1.8 },
    evening:  { top: '#3d5f9c', horizon: '#f2b27a', sun: '#ffc68a', power: 2.0, elevation: 14, azimuth: 250, hemi: 1.1 },
};

// Night, per circuit, as the place really is after dark: the sky and its horizon glow from the nearest city's lights
// (sodium orange over the big cities, near black in the Ardennes and the Styrian hills), how many stars that light pollution
// leaves, and the race floodlights (sun: colour, power, height) that light the track; windows: share of lit windows.
// Sakhir is the real night race (~500 light columns of white floodlight); the others get the same kind of rig to race by
const night = (top, horizon, stars, windows, o = {}) => ({ top, horizon, stars, windows, sun: '#eef2ff', power: 1.6, elevation: 72, azimuth: 30, hemi: 0.45, ...o });
export const NIGHTS = {
    monza:       night('#0b1020', '#2c2a33', 0.3, 0.5),                        // Milan's glow to the south, dark royal park
    spa:         night('#05080f', '#10141c', 0.95, 0.4, { hemi: 0.35 }),       // Ardennes forest: black, full star field
    silverstone: night('#0c0f18', '#26252b', 0.45, 0.45, { hemi: 0.5 }),       // rural Northamptonshire, cloud lit from below
    suzuka:      night('#0a0f1e', '#272834', 0.4, 0.55),                       // Suzuka city and the lit Ferris wheel
    sakhir:      night('#0a1226', '#3a2c26', 0.15, 0.6, { sun: '#f4f6ff', power: 2.2, hemi: 0.55 }), // the real night race: desert, Manama amber
    interlagos:  night('#14121a', '#4a3226', 0.05, 0.75, { hemi: 0.55 }),      // inside São Paulo: heavy orange skyglow
    cota:        night('#090d1a', '#2a2630', 0.4, 0.5),                        // Austin on the north-west horizon
    zandvoort:   night('#070b16', '#1d2029', 0.55, 0.55),                      // seaside town, the North Sea black beyond
    spielberg:   night('#04070e', '#0e121a', 1, 0.35, { hemi: 0.35 }),         // Styrian Alps: the darkest sky here
    montreal:    night('#0d1020', '#34292b', 0.15, 0.7),                       // island in the river, downtown skyline lit
    hungaroring: night('#0a0e1b', '#2b2730', 0.35, 0.5),                       // Budapest's glow to the south-west
    monaco:      night('#0e1222', '#3e2f2a', 0.1, 0.85, { hemi: 0.6 }),        // the harbour city lit all around the streets
    imola:       night('#090d1a', '#25242c', 0.45, 0.55),                      // town and the Santerno valley
    buddh:       night('#13111a', '#4a3324', 0.05, 0.6, { hemi: 0.55 }),       // Greater Noida, Delhi's orange glow to the north-west
};
export const nightOf = (id) => NIGHTS[id] || night('#090d1a', '#25242c', 0.4, 0.5);

// trees: share of each kind; density: × the base count; city: 0 none, 1 a distant skyline, 2 the streets are lined (Monaco)
export const THEMES = {
    monza:       { land: 'park',   sky: 'clear',    trees: { broad: 0.8, pine: 0.2 }, density: 1.6, city: 0 },
    spa:         { land: 'forest', sky: 'overcast', trees: { pine: 0.8, broad: 0.2 }, density: 2.0, city: 0, mountains: true },
    silverstone: { land: 'park',   sky: 'overcast', trees: { broad: 1 }, density: 0.6, city: 0 },
    suzuka:      { land: 'park',   sky: 'hazy',     trees: { broad: 0.6, pine: 0.4 }, density: 1.3, city: 0, landmark: 'wheel' },
    sakhir:      { land: 'desert', sky: 'evening',  trees: { palm: 1 }, density: 0.25, city: 1 },
    interlagos:  { land: 'park',   sky: 'hazy',     trees: { broad: 0.7, palm: 0.3 }, density: 1.0, city: 1 },
    cota:        { land: 'dry',    sky: 'clear',    trees: { broad: 1 }, density: 0.5, city: 0, landmark: 'tower' },
    zandvoort:   { land: 'dunes',  sky: 'hazy',     trees: { pine: 1 }, density: 0.6, city: 1, sea: true },
    spielberg:   { land: 'forest', sky: 'clear',    trees: { pine: 0.9, broad: 0.1 }, density: 1.5, city: 0, mountains: true },
    montreal:    { land: 'park',   sky: 'clear',    trees: { broad: 1 }, density: 1.4, city: 1, sea: true },
    hungaroring: { land: 'dry',    sky: 'clear',    trees: { broad: 0.8, pine: 0.2 }, density: 1.0, city: 0 },
    monaco:      { land: 'city',   sky: 'clear',    trees: { palm: 1 }, density: 0.6, city: 2, sea: true, mountains: true },
    imola:       { land: 'park',   sky: 'hazy',     trees: { broad: 0.8, pine: 0.2 }, density: 1.3, city: 1 },
    buddh:       { land: 'dry',    sky: 'hazy',     trees: { broad: 1 }, density: 0.8, city: 1 },     // the Yamuna plain, Greater Noida's towers
};
export const DEFAULT_THEME = { land: 'park', sky: 'clear', trees: { pine: 1 }, density: 1, city: 0 };
export const themeOf = (id) => THEMES[id] || DEFAULT_THEME;
