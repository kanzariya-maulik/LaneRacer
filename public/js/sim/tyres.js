// F1-lite tyres: three compounds, grip that fades with wear and falls off a cliff near the end, wear scaled to the race
// (a set lasts `life` of the race distance at typical racing load). Shared by the server and the browser's prediction.
export const COMPOUNDS = { S: { grip: 1.06, life: 0.40 }, M: { grip: 1.00, life: 0.65 }, H: { grip: 0.95, life: 0.90 } };
const FADE = 0.0375, CLIFF_FROM = 0.8, CLIFF = 0.09;
// Mean raw load of a clean racing lap (Task 3 calibration), so typical driving wears at exactly 1 / life
export const LOAD_TYPICAL = 1.25;

export const isCompound = (c) => c === 'S' || c === 'M' || c === 'H';

export function gripOf(compound, wear) {
    const w = Math.max(0, Math.min(1, wear || 0));
    const cliff = w > CLIFF_FROM ? CLIFF * ((w - CLIFF_FROM) / (1 - CLIFF_FROM)) ** 2 : 0;
    return COMPOUNDS[compound].grip * (1 - FADE * Math.min(w, CLIFF_FROM) - cliff);
}

export const wearPerM = (compound, lapM, laps) => 1 / (COMPOUNDS[compound].life * lapM * laps);

// latUse: share of the cornering grip in use (0-1); brake: brake input (0-1); slip: slide angle (rad)
export const wearLoad = (latUse, brake, slip) => (1 + 0.6 * latUse * latUse + 0.4 * brake + 0.8 * Math.min(1, slip / 0.21)) / LOAD_TYPICAL;

export const nextHarder = (c) => (c === 'S' ? 'M' : c === 'M' ? 'H' : 'M');
