// Pure lobby rules — no sockets, so they can be unit tested.
const TEAMS = require('../public/teams.json');

const MAX_RACERS = 22; // grid slots per track (src/game/Track.js GRID_SLOTS)

function sanitizeUsername(name) {
    const clean = typeof name === 'string' ? name.trim().slice(0, 15) : '';
    return clean || `Player${Math.floor(Math.random() * 1000)}`;
}

function sanitizeChat(msg) {
    if (typeof msg !== 'string') return null;
    return msg.trim().slice(0, 100) || null;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function sanitizeSettings(current, incoming, trackIds) {
    if (!incoming || typeof incoming !== 'object') return current;
    const next = { ...current };
    if (trackIds.includes(incoming.trackId)) next.trackId = incoming.trackId;
    if (Number.isFinite(incoming.maxLaps)) next.maxLaps = clamp(Math.round(incoming.maxLaps), 1, 50);
    if (typeof incoming.qualifying === 'boolean') next.qualifying = incoming.qualifying;
    if (typeof incoming.collisions === 'boolean') next.collisions = incoming.collisions;
    if (typeof incoming.contactPenalties === 'boolean') next.contactPenalties = incoming.contactPenalties;
    if (incoming.timeOfDay === 'day' || incoming.timeOfDay === 'night') next.timeOfDay = incoming.timeOfDay;
    // Qualifying run: untimed out-laps (1 = the drive from the pits to the line), then timed laps
    if (Number.isFinite(incoming.outLaps)) next.outLaps = clamp(Math.round(incoming.outLaps), 1, 3);
    if (Number.isFinite(incoming.qualiLaps)) next.qualiLaps = clamp(Math.round(incoming.qualiLaps), 1, 10);
    return next;
}

const num = (v, min, max) => (Number.isFinite(v) ? clamp(v, min, max) : 0);

function sanitizeInput(input) {
    const i = input && typeof input === 'object' ? input : {};
    if ('throttle' in i || 'brake' in i || 'steer' in i) {
        return { throttle: num(i.throttle, 0, 1), brake: num(i.brake, 0, 1), steer: num(i.steer, -1, 1), drs: i.drs === true };
    }
    // Legacy on/off keys from older clients
    return { throttle: i.up ? 1 : 0, brake: i.down ? 1 : 0, steer: (i.right ? 1 : 0) - (i.left ? 1 : 0), drs: false };
}

// selfId: a player switching team doesn't count against a team they're already in
function canJoinTeam(players, teamId, selfId) {
    const team = TEAMS.find(t => t.id === teamId);
    if (!team) return { ok: false, reason: 'Unknown team' };
    const taken = Object.values(players).filter(p => p.teamId === teamId && p.id !== selfId).length;
    if (taken >= team.maxPlayers) return { ok: false, reason: `${team.name} is full` };
    return { ok: true, team };
}

// Join order decides who races when more than `max` players are ready
function pickRacers(players, max = MAX_RACERS) {
    const eligible = Object.values(players).filter(p => !p.isSpectating);
    return { racers: eligible.slice(0, max), overflow: eligible.slice(max) };
}

// Sequenced input batches from prediction clients: { inputs: [{ seq, steer, throttle, brake, drs }, …] } (newest + 5 resends)
function sanitizeInputs(payload) {
    if (!payload || !Array.isArray(payload.inputs)) return null;
    return payload.inputs.slice(0, 8)
        .filter((i) => i && Number.isInteger(i.seq) && i.seq >= 0)
        .map((i) => ({ seq: i.seq, ...sanitizeInput(i) }));
}

// Each player's own driving assist.
// Accepts the legacy 'full'/'off' strings OR the new numeric 'steerPct,brakePct' format (0–100 each).
// Normalised to an object { steer: 0–1, brake: 0–1 } used by carphysics / drive.
function sanitizeAssist(a) {
    if (typeof a === 'string') {
        // Legacy: 'full' → 100% both, 'off' → 0% both
        if (a === 'off') return { steer: 0, brake: 0 };
        if (a === 'full') return { steer: 1, brake: 1 };
        // New numeric format: 'steerPct,brakePct'
        const parts = a.split(',');
        if (parts.length === 2) {
            const s = parseFloat(parts[0]), b = parseFloat(parts[1]);
            if (Number.isFinite(s) && Number.isFinite(b)) {
                return { steer: clamp(s / 100, 0, 1), brake: clamp(b / 100, 0, 1) };
            }
        }
    }
    return { steer: 1, brake: 1 }; // safe default: full assist
}

module.exports = { TEAMS, MAX_RACERS, sanitizeUsername, sanitizeChat, sanitizeSettings, sanitizeInput, sanitizeInputs, sanitizeAssist, canJoinTeam, pickRacers };
