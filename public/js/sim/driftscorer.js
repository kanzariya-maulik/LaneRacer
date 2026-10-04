// Real-time Drift Scoring Engine for Formula-D Mode.
// Evaluates drift telemetry at 60 Hz: slip angle, entry velocity, clipping zone proximity, tandem bonus, combo multipliers.

export const MIN_DRIFT_ANGLE_DEG = 15;
export const MAX_DRIFT_ANGLE_DEG = 65;
export const SPINOUT_ANGLE_DEG = 72;
export const MIN_DRIFT_SPEED_KMH = 22;
export const COMBO_TIMEOUT_S = 1.6; // Time to link drifts between corners

export class DriftScorer {
    constructor() {
        this.scores = {}; // playerId -> score state
    }

    initPlayer(id) {
        this.scores[id] = {
            totalScore: 0,
            currentCombo: 0,
            multiplier: 1.0,
            driftTime: 0,
            idleTime: 0,
            isDrifting: false,
            maxAngle: 0,
            avgAngle: 0,
            clipsHit: 0,
            spinout: false,
            tandemTime: 0,
            lastBonusMsg: null,
            angleDeg: 0,
            speedKmh: 0,
        };
        return this.scores[id];
    }

    getPlayer(id) {
        return this.scores[id] || this.initPlayer(id);
    }

    // Evaluate single player telemetry for one tick (dt = 1/60 s)
    update(player, track, otherPlayers = [], dt = 1 / 60) {
        const state = this.getPlayer(player.id);
        const scale = track.scale || 6;
        const vx = player.vx / scale, vy = player.vy / scale;
        const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
        const vf = vx * fx + vy * fy;
        const vl = -vx * fy + vy * fx;
        const speedKmh = Math.hypot(vx, vy) * 3.6;
        
        // Slip angle
        const slipAngleRad = Math.atan2(Math.abs(vl), Math.max(0.5, Math.abs(vf)));
        const angleDeg = slipAngleRad * (180 / Math.PI);
        state.angleDeg = +angleDeg.toFixed(1);
        state.speedKmh = +speedKmh.toFixed(1);

        // Check for spinout (> 72 degrees)
        if (angleDeg > SPINOUT_ANGLE_DEG && speedKmh > 20) {
            if (!state.spinout && state.currentCombo > 0) {
                state.spinout = true;
                state.currentCombo = 0;
                state.multiplier = 1.0;
                state.isDrifting = false;
                state.lastBonusMsg = 'SPIN OUT!';
                return { event: 'spinout', score: state.totalScore, combo: 0, angle: angleDeg };
            }
            return null;
        }

        // Active drift detection
        const isDriftingNow = angleDeg >= MIN_DRIFT_ANGLE_DEG && speedKmh >= MIN_DRIFT_SPEED_KMH && !player.inPit;

        if (isDriftingNow) {
            state.spinout = false;
            state.isDrifting = true;
            state.idleTime = 0;
            state.driftTime += dt;
            state.maxAngle = Math.max(state.maxAngle, angleDeg);

            // 1. Angle Score (higher angle up to 60° gives exponential reward)
            const normAngle = Math.min(1.0, (angleDeg - MIN_DRIFT_ANGLE_DEG) / (MAX_DRIFT_ANGLE_DEG - MIN_DRIFT_ANGLE_DEG));
            const angleScore = (normAngle * 120 + 30); // 30 - 150 pts/s

            // 2. Speed Score (high speed entry reward)
            const speedScore = Math.max(0.5, speedKmh / 60);

            // 3. Line & Corner proximity bonus
            let lineMultiplier = 1.0;
            if (track.path) {
                // If sliding through a tight radius corner, reward apex line accuracy
                const cpCount = track.checkpoints ? track.checkpoints.length : 1;
                const nextCp = track.checkpoints ? track.checkpoints[(player.checkpoint + 1) % cpCount] : null;
                if (nextCp) {
                    const distToCp = Math.hypot(player.x - nextCp.x, player.y - nextCp.y) / scale;
                    if (distToCp < 12) {
                        lineMultiplier = 1.8;
                        state.lastBonusMsg = 'CLIPPING POINT!';
                    }
                }
            }

            // 4. Tandem Chase Bonus
            let tandemMult = 1.0;
            for (const other of otherPlayers) {
                if (other.id !== player.id && !other.finished) {
                    const distM = Math.hypot(player.x - other.x, player.y - other.y) / scale;
                    // Chasing within 3m - 20m behind a car also drifting
                    if (distM >= 3 && distM <= 22 && (other.driftAngle || 0) >= 15) {
                        tandemMult = 1.6;
                        state.tandemTime += dt;
                        state.lastBonusMsg = 'TANDEM PROXIMITY!';
                        break;
                    }
                }
            }

            // Multiplier growth over continuous slide
            state.multiplier = Math.min(5.0, +(1.0 + state.driftTime * 0.25).toFixed(2));

            // Accumulate combo points
            const tickPoints = (angleScore * speedScore * lineMultiplier * tandemMult) * dt;
            state.currentCombo += Math.round(tickPoints * state.multiplier);

            return {
                event: 'drift',
                points: Math.round(tickPoints * state.multiplier),
                currentCombo: state.currentCombo,
                multiplier: state.multiplier,
                angle: state.angleDeg,
                speed: state.speedKmh,
                totalScore: state.totalScore,
                bonusMsg: state.lastBonusMsg,
            };
        } else {
            // Not drifting currently
            state.isDrifting = false;
            if (state.currentCombo > 0) {
                state.idleTime += dt;
                if (state.idleTime >= COMBO_TIMEOUT_S) {
                    // Bank the combo!
                    state.totalScore += state.currentCombo;
                    const banked = state.currentCombo;
                    state.currentCombo = 0;
                    state.multiplier = 1.0;
                    state.driftTime = 0;
                    state.idleTime = 0;
                    return { event: 'banked', banked, totalScore: state.totalScore };
                }
            }
        }
        return null;
    }

    rankPlayers(players) {
        return [...players].sort((a, b) => {
            const sA = (this.scores[a.id]?.totalScore || 0) + (this.scores[a.id]?.currentCombo || 0);
            const sB = (this.scores[b.id]?.totalScore || 0) + (this.scores[b.id]?.currentCombo || 0);
            return sB - sA;
        });
    }
}
