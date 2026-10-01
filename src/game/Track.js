class Track {
    static getTrack(id) {
        switch (id) {
            case 1:
                return this.createOvalTrack();
            case 2:
                // Figure 8
                return this.createFigure8Track();
            case 3:
                return this.createComplexTrack();
            default:
                return this.createOvalTrack();
        }
    }

    static createOvalTrack() {
        // A simple oval track math path
        // 2 long straights, 2 half circles
        const path = [];
        const resolution = 20;

        // Top straight
        for(let i = 200; i <= 800; i += 50) path.push({x: i, y: 200});
        
        // Right semi-circle
        for(let a = -Math.PI/2; a <= Math.PI/2; a += Math.PI/resolution) {
            path.push({ x: 800 + Math.cos(a)*200, y: 400 + Math.sin(a)*200 });
        }

        // Bottom straight
        for(let i = 800; i >= 200; i -= 50) path.push({x: i, y: 600});

        // Left semi-circle
        for(let a = Math.PI/2; a <= 3*Math.PI/2; a += Math.PI/resolution) {
            path.push({ x: 200 + Math.cos(a)*200, y: 400 + Math.sin(a)*200 });
        }

        return {
            id: 1,
            name: "Beginner Oval",
            path: path,
            width: 160,
            startAngle: 0,
            startPositions: [
                {x: 400, y: 160}, {x: 400, y: 240},
                {x: 350, y: 160}, {x: 350, y: 240},
                {x: 300, y: 160}, {x: 300, y: 240},
                {x: 250, y: 160}, {x: 250, y: 240}
            ],
            checkpoints: [
                {x: 500, y: 200, radius: 100},
                {x: 900, y: 400, radius: 100},
                {x: 500, y: 600, radius: 100},
                {x: 100, y: 400, radius: 100}
            ]
        };
    }

    static createFigure8Track() {
        // Simple figure-8 style track
        const path = [];
        const resolution = 30;

        // Right Loop
        for(let a = -Math.PI; a <= Math.PI; a += Math.PI/resolution) {
            // we omit the crossing part slightly
            if (a > 3*Math.PI/4 || a < -3*Math.PI/4) continue;
            path.push({ x: 700 + Math.cos(a)*250, y: 400 + Math.sin(a)*250 });
        }
        
        // Left Loop
        for(let a = 0; a <= 2*Math.PI; a += Math.PI/resolution) {
            if (a < Math.PI/4 || a > 7*Math.PI/4) continue;
            path.push({ x: 300 + Math.cos(a)*250, y: 400 + Math.sin(a)*250 });
        }

        return {
            id: 2,
            name: "Infinity Loop",
            path: path,
            width: 140,
            startAngle: -Math.PI/2,
            startPositions: [
                {x: 700, y: 110}, {x: 700, y: 190},
                {x: 650, y: 110}, {x: 650, y: 190},
                {x: 600, y: 110}, {x: 600, y: 190}
            ],
            checkpoints: [
                {x: 700, y: 150, radius: 100},
                {x: 950, y: 400, radius: 100},
                {x: 700, y: 650, radius: 100},
                {x: 300, y: 650, radius: 100},
                {x: 50, y: 400, radius: 100},
                {x: 300, y: 150, radius: 100}
            ]
        };
    }

    static createComplexTrack() {
        const path = [];
        const MathPI2 = Math.PI * 2;
        const points = 150;
        
        for (let i = 0; i < points; i++) {
            const angle = (i / points) * MathPI2;
            // Procedurally generated wobbly circle causing many curves
            const r = 350 + Math.sin(angle * 5) * 110 + Math.cos(angle * 2) * 60;
            
            path.push({
                x: 600 + Math.cos(angle) * r * 1.2, // stretch horizontal slightly
                y: 500 + Math.sin(angle) * r
            });
        }
        
        // At angle 0, r = 350 + 0 + 60 = 410. x = 600 + 410*1.2 = 1092, y = 500.
        // The path direction at angle 0 moves towards angle > 0 (increases y) so it faces down. (PI/2)

        return {
            id: 3,
            name: "Twisty Circuit",
            path: path,
            width: 140,
            startAngle: Math.PI / 2,
            startPositions: [
                {x: 1092, y: 500}, {x: 1042, y: 500},
                {x: 1092, y: 440}, {x: 1042, y: 440},
                {x: 1092, y: 380}, {x: 1042, y: 380}
            ],
            checkpoints: [
                {x: 600, y: 800, radius: 250},
                {x: 200, y: 500, radius: 250},
                {x: 600, y: 200, radius: 250}
            ]
        };
    }
}

module.exports = Track;
