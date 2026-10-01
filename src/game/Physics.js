class Physics {
    static getDistanceFromTrack(x, y, track) {
        // Find distance to the closest track segment
        let minDistance = Infinity;
        
        // Track.path is an array of points creating a loop
        const path = track.path;
        
        for (let i = 0; i < path.length; i++) {
            const p1 = path[i];
            const p2 = path[(i + 1) % path.length];
            
            // Distance from point to line segment
            const dist = this.distToSegmentSquared({x, y}, p1, p2);
            if (dist < minDistance) {
                minDistance = dist;
            }
        }
        
        return Math.sqrt(minDistance);
    }

    static distToSegmentSquared(p, v, w) {
        const l2 = this.distSquared(v, w);
        if (l2 === 0) return this.distSquared(p, v);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return this.distSquared(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
    }

    static distSquared(v, w) {
        return (v.x - w.x)*(v.x - w.x) + (v.y - w.y)*(v.y - w.y);
    }
    
    static checkCarCollision(p1, p2) {
        // Car collision logic (Circle vs Circle)
        const CAR_RADIUS = 18; // Increased from 12 for larger car size
        const collisionDist = CAR_RADIUS * 2;
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distSq = dx*dx + dy*dy;
        
        if (distSq < collisionDist * collisionDist && distSq > 0) {
            const dist = Math.sqrt(distSq);
            // Penetration depth
            const overlap = (collisionDist - dist) / 2;
            
            // Collision normal
            const nx = dx / dist;
            const ny = dy / dist;
            
            // Resolve overlap (move players apart)
            p1.x += nx * overlap;
            p1.y += ny * overlap;
            
            p2.x -= nx * overlap;
            p2.y -= ny * overlap;
            
            // Elastic collision response (simplified)
            // Average speeds or exchange momentum. For simplicity, halve speed to simulate crash.
            p1.speed *= 0.8;
            p2.speed *= 0.8;
        }
    }
}

module.exports = Physics;
