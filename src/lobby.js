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

const VALID_MODES = ['f1', 'formula-d'];
const VALID_CLASSES = ['tuner', 'nascar', 'gt3', 'all'];
const VALID_TIME_OF_DAY = ['day', 'night'];

function sanitizeSettings(current, incoming, trackIds) {
    if (!incoming || typeof incoming !== 'object') return current;
    const next = { ...current };
    if (trackIds.includes(incoming.trackId)) next.trackId = incoming.trackId;
    if (Number.isFinite(incoming.maxLaps)) next.maxLaps = clamp(Math.round(incoming.maxLaps), 1, 50);
    if (typeof incoming.qualifying === 'boolean') next.qualifying = incoming.qualifying;
    else if (Number.isFinite(incoming.qualifying)) next.qualifying = incoming.qualifying > 0;
    if (incoming.qualiLaps !== undefined && Number.isFinite(incoming.qualiLaps)) next.qualiLaps = clamp(Math.round(incoming.qualiLaps), 1, 5);
    if (typeof incoming.collisions === 'boolean') next.collisions = incoming.collisions;
    if (typeof incoming.botCar === 'boolean') next.botCar = incoming.botCar;
    if (typeof incoming.mode === 'string' && VALID_MODES.includes(incoming.mode.toLowerCase())) {
        next.mode = incoming.mode.toLowerCase();
    }
    if (typeof incoming.timeOfDay === 'string' && VALID_TIME_OF_DAY.includes(incoming.timeOfDay.toLowerCase())) {
        next.timeOfDay = incoming.timeOfDay.toLowerCase();
    }
    if (typeof incoming.vehicleClass === 'string' && VALID_CLASSES.includes(incoming.vehicleClass.toLowerCase())) {
        next.vehicleClass = incoming.vehicleClass.toLowerCase();
    }
    if (typeof incoming.driftSubMode === 'string') {
        next.driftSubMode = incoming.driftSubMode;
    }
    if (typeof incoming.trackLimits === 'boolean') {
        next.trackLimits = incoming.trackLimits;
    } else if (incoming.trackLimits !== undefined && (incoming.trackLimits === '0' || incoming.trackLimits === '1' || incoming.trackLimits === 0 || incoming.trackLimits === 1)) {
        next.trackLimits = incoming.trackLimits === '1' || incoming.trackLimits === 1;
    }
    if (typeof incoming.jumpStart === 'boolean') {
        next.jumpStart = incoming.jumpStart;
    } else if (incoming.jumpStart !== undefined && (incoming.jumpStart === '0' || incoming.jumpStart === '1' || incoming.jumpStart === 0 || incoming.jumpStart === 1)) {
        next.jumpStart = incoming.jumpStart === '1' || incoming.jumpStart === 1;
    }
    return next;
}

const num = (v, min, max) => (Number.isFinite(v) ? clamp(v, min, max) : 0);

function sanitizeInput(input) {
    const i = input && typeof input === 'object' ? input : {};
    if ('throttle' in i || 'brake' in i || 'steer' in i || 'handbrake' in i) {
        return {
            throttle: num(i.throttle, 0, 1),
            brake: num(i.brake, 0, 1),
            steer: num(i.steer, -1, 1),
            drs: i.drs === true,
            handbrake: i.handbrake === true,
            explicitReverse: i.explicitReverse === true
        };
    }
    // Legacy on/off keys from older clients
    return {
        throttle: i.up ? 1 : 0,
        brake: i.down ? 1 : 0,
        steer: (i.right ? 1 : 0) - (i.left ? 1 : 0),
        drs: false,
        handbrake: !!i.handbrake || !!i.space,
        explicitReverse: i.down === true
    };
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

const VALID_ASSISTS = ['off', 'low', 'medium', 'high', 'full', 'brake', 'steer', 'custom'];

function sanitizeAssist(a) {
    if (typeof a === 'string') {
        const lower = a.trim().toLowerCase();
        if (VALID_ASSISTS.includes(lower)) return lower;
        const m = lower.match(/^(\d+),(\d+)$/);
        if (m) {
            const s = clamp(parseInt(m[1], 10), 0, 100);
            const b = clamp(parseInt(m[2], 10), 0, 100);
            return `${s},${b}`;
        }
    }
    if (typeof a === 'object' && a !== null) {
        const s = Number.isFinite(a.steer) ? clamp(Math.round(a.steer), 0, 100) : 100;
        const b = Number.isFinite(a.brake) ? clamp(Math.round(a.brake), 0, 100) : 100;
        return `${s},${b}`;
    }
    return 'full';
}

module.exports = { TEAMS, MAX_RACERS, sanitizeUsername, sanitizeChat, sanitizeSettings, sanitizeInput, sanitizeInputs, sanitizeAssist, canJoinTeam, pickRacers };

