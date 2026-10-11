// Lobby logic and input sanitization for Battle Tanks LAN

const TEAMS = [
    { id: 'team-red', name: 'Red Vanguard', color: '#ff3344', darkColor: '#aa1122', baseName: 'North/West Red HQ' },
    { id: 'team-blue', name: 'Blue Titans', color: '#2288ff', darkColor: '#1144aa', baseName: 'South/East Blue HQ' },
    { id: 'team-green', name: 'Green Legion', color: '#00dd66', darkColor: '#008833', baseName: 'North-East Green HQ' },
    { id: 'team-yellow', name: 'Yellow Iron', color: '#ffbb00', darkColor: '#aa7700', baseName: 'South-West Yellow HQ' }
];

const MAP_IDS = ['citadel', 'velocity_oval', 'orbital_ring'];
const MODES = ['attack_defense', 'deathmatch'];

function sanitizeUsername(name) {
    const clean = typeof name === 'string' ? name.trim().slice(0, 15) : '';
    return clean || `Tanker_${Math.floor(100 + Math.random() * 900)}`;
}

function sanitizeChat(msg) {
    if (typeof msg !== 'string') return null;
    return msg.trim().slice(0, 120) || null;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function sanitizeSettings(current = {}, incoming = {}) {
    const next = {
        mapId: 'citadel',
        mode: 'attack_defense', // 'attack_defense' (Eagle Base Protect) or 'deathmatch' (Elimination)
        teamMode: '2teams',     // '2teams', '3teams', '4teams', 'ffa'
        lives: 3,               // 1 to 10
        friendlyFire: false,
        powerupsEnabled: true,
        bombCooldownMs: 2500,   // Cooldown between throwing bombs
        ...current
    };

    if (MAP_IDS.includes(incoming.mapId)) next.mapId = incoming.mapId;
    if (MODES.includes(incoming.mode)) next.mode = incoming.mode;
    if (['2teams', '3teams', '4teams', 'ffa'].includes(incoming.teamMode)) next.teamMode = incoming.teamMode;
    if (Number.isFinite(incoming.lives)) next.lives = clamp(Math.round(incoming.lives), 1, 10);
    if (typeof incoming.friendlyFire === 'boolean') next.friendlyFire = incoming.friendlyFire;
    if (typeof incoming.powerupsEnabled === 'boolean') next.powerupsEnabled = incoming.powerupsEnabled;

    return next;
}

const VALID_DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

function sanitizeInput(input) {
    if (!input || typeof input !== 'object') {
        return { dir: 'UP', moving: false, shoot: false, bomb: false };
    }
    const dir = VALID_DIRS.includes(input.dir) ? input.dir : 'UP';
    const moving = input.moving === true;
    const shoot = input.shoot === true;
    const bomb = input.bomb === true;
    return { dir, moving, shoot, bomb };
}

function sanitizeInputs(payload) {
    if (!payload || !Array.isArray(payload.inputs)) return null;
    return payload.inputs
        .slice(0, 8)
        .filter(i => i && Number.isInteger(i.seq) && i.seq >= 0)
        .map(i => ({
            seq: i.seq,
            ...sanitizeInput(i)
        }));
}

module.exports = {
    TEAMS,
    MAP_IDS,
    MODES,
    sanitizeUsername,
    sanitizeChat,
    sanitizeSettings,
    sanitizeInput,
    sanitizeInputs
};
