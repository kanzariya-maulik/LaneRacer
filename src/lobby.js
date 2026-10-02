// Pure lobby rules — no sockets, so they can be unit tested.
const TEAMS = require('../public/teams.json');

const MAX_RACERS = 20; // grid slots per track

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

function canJoinTeam(players, teamId) {
    const team = TEAMS.find(t => t.id === teamId);
    if (!team) return { ok: false, reason: 'Unknown team' };
    const taken = Object.values(players).filter(p => p.teamId === teamId).length;
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

// Each player's own driving assist: 'full' (steering + braking help) or 'off'
const sanitizeAssist = (a) => (a === 'off' ? 'off' : 'full');

module.exports = { TEAMS, MAX_RACERS, sanitizeUsername, sanitizeChat, sanitizeSettings, sanitizeInput, sanitizeInputs, sanitizeAssist, canJoinTeam, pickRacers };
