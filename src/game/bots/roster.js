// src/game/bots/roster.js
// AI drivers for the free grid seats: who they are and how good. Pure (seeded), so a test can rebuild a grid.
const TEAMS = require('../../../public/teams.json');

// pace: lap ÷ racingLine.lapS. mistake: chance per corner. reaction / release: seconds [min, max]. bog: chance of a slow getaway
const LEVELS = {
    easy:   { pace: 1.12,  aggression: 0.2,  mistake: 0.04,  reaction: [0.35, 0.45], release: [0.3, 0.8],  bog: 0.15 },
    medium: { pace: 1.05,  aggression: 0.45, mistake: 0.02,  reaction: [0.28, 0.38], release: [0.15, 0.5], bog: 0.05 },
    hard:   { pace: 1.01,  aggression: 0.7,  mistake: 0.008, reaction: [0.22, 0.3],  release: [0.05, 0.3], bog: 0 },
    pro:    { pace: 0.995, aggression: 0.9,  mistake: 0.002, reaction: [0.18, 0.24], release: [0, 0.15],   bog: 0 },
};
const SPREAD = 0.015; // ±1.5 % pace around the level

// Fictional names only (never real drivers)
const NAMES = ['Arlo Vance', 'Mika Strand', 'Teo Lindqvist', 'Ravi Sethi', 'Jonah Pryce', 'Luca Ferraro', 'Nils Achterberg',
    'Owen Hale', 'Kenji Arata', 'Mateo Quiroga', 'Felix Morrow', 'Sami Korhonen', 'Ezra Blackwood', 'Dario Conti', 'Hugo Delmas',
    'Ilya Petrenko', 'Callum Reid', 'Bruno Talavera', 'Yusuf Demir', 'Anders Holm', 'Leo Marchetti', 'Theo Garnier', 'Rafa Ibarra', 'Max Eklund'];

// mulberry32: small, fast, good enough for gameplay randomness
function rngOf(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fillGrid(humans, level, seed, max = 22) {
    const name = LEVELS[level] ? level : 'medium', L = LEVELS[name], rng = rngOf(seed);
    const pool = NAMES.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const taken = {};
    for (const h of humans) taken[h.teamId] = (taken[h.teamId] || 0) + 1;
    const between = ([a, b]) => a + (b - a) * rng();
    const bots = [];
    for (const t of TEAMS) {
        while ((taken[t.id] || 0) < t.maxPlayers && humans.length + bots.length < max) {
            taken[t.id] = (taken[t.id] || 0) + 1;
            bots.push({
                id: `ai-${bots.length + 1}`, username: pool[bots.length], teamId: t.id, color: t.chatColor,
                assist: { steer: 1, brake: 0 }, compound: 'M', isBot: true,
                ai: { level: name, pace: L.pace * (1 + (rng() * 2 - 1) * SPREAD), aggression: Math.min(1, Math.max(0, L.aggression + (rng() - 0.5) * 0.1)),
                    mistake: L.mistake * (0.75 + rng() * 0.5), reaction: between(L.reaction), release: between(L.release), bog: L.bog },
            });
        }
    }
    return bots;
}

module.exports = { LEVELS, NAMES, rngOf, fillGrid };
