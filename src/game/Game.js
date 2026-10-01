class Game {
    constructor(io, players, settings, onFinish) {
        this.io = io;
        this.settings = settings;
        this.onFinish = onFinish;
        
        this.TickRate = 60;
        this.dt = 1 / this.TickRate;
        
        this.players = {}; // Game player representations
        this.track = this.loadTrack(settings.trackId);
        
        // Initialize player entities
        players.forEach((p, index) => {
            this.players[p.id] = {
                id: p.id,
                username: p.username,
                color: p.color,
                x: this.track.startPositions[index % this.track.startPositions.length].x,
                y: this.track.startPositions[index % this.track.startPositions.length].y,
                angle: this.track.startAngle,
                speed: 0,
                lap: 0,
                checkpoint: 0,
                finished: false,
                rank: 0,
                input: { up: false, down: false, left: false, right: false }
            };
        });

        this.loopPath = null;
        this.winnerCount = 0;
    }

    loadTrack(trackId) {
        // Detailed math based tracks will be implemented in Track.js
        const Track = require('./Track');
        return Track.getTrack(trackId);
    }

    handleInput(id, input) {
        if (this.players[id] && !this.players[id].finished) {
            this.players[id].input = input;
        }
    }

    start() {
        this.io.emit('game_init', { players: this.players, track: this.track });
        
        this.loopPath = setInterval(() => {
            this.update();
        }, 1000 / this.TickRate);
    }

    stop() {
        if (this.loopPath) {
            clearInterval(this.loopPath);
        }
    }

    update() {
        const PlayerPhysics = require('./Player');
        const Collision = require('./Physics');

        let activePlayers = 0;
        
        const playerIds = Object.keys(this.players);
        for (let i = 0; i < playerIds.length; i++) {
            let p = this.players[playerIds[i]];
            if (p.finished) continue;

            activePlayers++;

            // 1. Process Input & Physics
            PlayerPhysics.update(p, this.dt, this.track, this.settings.maxSpeed || 400);

            // 2. Check collisions with others
            for (let j = 0; j < playerIds.length; j++) {
                if (i === j) continue;
                Collision.checkCarCollision(p, this.players[playerIds[j]]);
            }

            // 3. Track progress (checkpoints & laps)
            this.checkLapProgress(p);
        }

        // Send state to clients
        const stateSync = {};
        for (let id in this.players) {
            stateSync[id] = {
                x: this.players[id].x,
                y: this.players[id].y,
                angle: this.players[id].angle,
                speed: this.players[id].speed,
                lap: this.players[id].lap,
                rank: this.players[id].rank
            };
        }

        this.io.volatile.emit('game_state', stateSync);

        if (activePlayers === 0 && playerIds.length > 0) {
            this.stop();
            this.onFinish();
        }
    }

    checkLapProgress(p) {
        const checkPts = this.track.checkpoints;
        const targetCp = (p.checkpoint + 1) % checkPts.length;
        const cp = checkPts[targetCp];

        const dx = p.x - cp.x;
        const dy = p.y - cp.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        // Simple circle-based checkpoint zone
        if (dist < cp.radius) {
            p.checkpoint = targetCp;
            if (targetCp === 0) {
                p.lap++;
                console.log(`Player ${p.username} completed lap ${p.lap}`);
                if (p.lap >= this.settings.maxLaps) {
                    p.finished = true;
                    this.winnerCount++;
                    p.rank = this.winnerCount;
                    this.io.emit('chat_msg', { username: 'SYSTEM', color: '#ff0000', msg: `${p.username} finished in rank ${p.rank}!` });
                }
            }
        }
    }
}

module.exports = Game;
