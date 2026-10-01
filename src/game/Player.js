const Physics = require('./Physics');

class PlayerPhysics {
    static update(player, dt, track, maxSpeed) {
        // Constants
        const ACCELERATION = maxSpeed * 2;
        const DECELERATION = maxSpeed * 1.5;
        const TURN_SPEED = 3.5; 
        const OFF_TRACK_MULTIPLIER = 0.3; // Speed is heavily capped off road

        // Physics distance calculation
        const distFromTrackCenter = Physics.getDistanceFromTrack(player.x, player.y, track);
        const trackRadius = track.width / 2;
        const isOffTrack = distFromTrackCenter > trackRadius;

        // Rigid wall limit (80px outside the track radius is an invisible bouncy wall)
        if (distFromTrackCenter > trackRadius + 80) {
            // Revert back to a known safe position to prevent sticking
            player.x = player.lastSafeX || player.x;
            player.y = player.lastSafeY || player.y;
            player.speed = -maxSpeed * 0.2; // Small bump backwards
        } else {
            // Only memorize safe track location
            if (distFromTrackCenter < trackRadius + 60) {
                player.lastSafeX = player.x;
                player.lastSafeY = player.y;
            }
        }

        // 1. Calculate max achievable speed
        const currentMaxSpeed = isOffTrack ? maxSpeed * OFF_TRACK_MULTIPLIER : maxSpeed;

        // 2. Handle Inputs
        const input = player.input;
        
        if (input.up) {
            player.speed += ACCELERATION * dt;
        } else if (input.down) {
            player.speed -= ACCELERATION * 0.8 * dt; // Braking/Reverse
        } else {
            // Natural deceleration
            if (player.speed > 0) {
                player.speed -= DECELERATION * dt;
                if (player.speed < 0) player.speed = 0;
            } else if (player.speed < 0) {
                player.speed += DECELERATION * dt;
                if (player.speed > 0) player.speed = 0;
            }
        }

        // Apply Speed Limits
        if (player.speed > currentMaxSpeed) {
            if (isOffTrack) {
                // Apply harsh friction if off track
                player.speed -= DECELERATION * 2 * dt;
            } else {
                player.speed = currentMaxSpeed;
            }
        }
        
        // Reverse max speed
        const reverseMax = currentMaxSpeed * 0.4;
        if (player.speed < -reverseMax) {
            player.speed = -reverseMax;
        }

        // 3. Turning (only if moving)
        if (Math.abs(player.speed) > 5) {
            const turnDir = player.speed > 0 ? 1 : -1;
            if (input.left) {
                player.angle -= TURN_SPEED * dt * turnDir;
            }
            if (input.right) {
                player.angle += TURN_SPEED * dt * turnDir;
            }
        }

        // 4. Update Position
        player.x += Math.cos(player.angle) * player.speed * dt;
        player.y += Math.sin(player.angle) * player.speed * dt;
    }
}

module.exports = PlayerPhysics;
