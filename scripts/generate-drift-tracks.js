// Generator for Formula-D Drift Tracks: Ebisu Drift Touge & Long Beach Arena
const fs = require('fs');
const path = require('path');

const SCALE = 6;
const OUT_DIR = path.join(__dirname, '..', 'data', 'tracks');

// Helper to interpolate Catmull-Rom or cubic bezier loops into smooth equidistant points
function generateSmoothLoop(controlPoints, totalPoints = 450) {
    const n = controlPoints.length;
    const pts = [];

    // Evaluate cubic spline along control points
    for (let i = 0; i < totalPoints; i++) {
        const t = (i / totalPoints) * n;
        const i0 = Math.floor(t) % n;
        const i1 = (i0 + 1) % n;
        const i2 = (i0 + 2) % n;
        const im1 = (i0 - 1 + n) % n;

        const f = t - Math.floor(t);
        const f2 = f * f;
        const f3 = f2 * f;

        const p0 = controlPoints[im1];
        const p1 = controlPoints[i0];
        const p2 = controlPoints[i1];
        const p3 = controlPoints[i2];

        // Standard Catmull-Rom spline
        const x = 0.5 * ((2 * p1.x) +
            (-p0.x + p2.x) * f +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3);

        const y = 0.5 * ((2 * p1.y) +
            (-p0.y + p2.y) * f +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3);

        pts.push({ x: +x.toFixed(1), y: +y.toFixed(1) });
    }
    return pts;
}

// 1. EBISU TOUGE DRIFT ARENA (Japan)
// Smooth flowing high-speed drift bowl, wide initiation sweeper, sweeping transitions
function createEbisuTrack() {
    // Control points in game units (scaled by 6)
    const cp = [
        { x: 0, y: 0 },
        { x: 400, y: -50 },
        { x: 850, y: -180 },
        { x: 1300, y: -450 },
        { x: 1750, y: -900 },
        { x: 2050, y: -1500 },
        { x: 2100, y: -2100 },
        { x: 1850, y: -2700 },
        { x: 1400, y: -3100 },
        { x: 800, y: -3200 },
        { x: 250, y: -3000 },
        { x: -200, y: -2600 },
        { x: -500, y: -2050 },
        { x: -550, y: -1500 },
        { x: -400, y: -900 },
        { x: -200, y: -400 }
    ];

    const pathPts = generateSmoothLoop(cp, 450);

    // Generate pit lane parallel to start straight
    const pitPts = [];
    for (let i = 0; i < 60; i++) {
        const u = i / 59;
        const x = -300 + u * 1200;
        const y = 90 - u * 30;
        pitPts.push({ x: +x.toFixed(1), y: +y.toFixed(1) });
    }

    return {
        id: 'ebisu',
        name: 'Ebisu Drift Touge',
        scale: SCALE,
        width: 96,
        path: pathPts,
        pit: {
            path: pitPts,
            width: 60,
            fitM: 1.2
        }
    };
}

// 2. LONG BEACH FORMULA-D ARENA (USA)
// Iconic street drift arena: huge outer zone wall ride, sweeping keyhole, continuous drift esses
function createLongBeachTrack() {
    const cp = [
        { x: 0, y: 0 },
        { x: 500, y: 10 },
        { x: 1100, y: 40 },
        { x: 1700, y: -100 },
        { x: 2200, y: -450 },
        { x: 2500, y: -1000 },
        { x: 2550, y: -1650 },
        { x: 2300, y: -2250 },
        { x: 1750, y: -2600 },
        { x: 1100, y: -2700 },
        { x: 500, y: -2500 },
        { x: 100, y: -2100 },
        { x: 0, y: -1600 },
        { x: 150, y: -1100 },
        { x: 100, y: -550 }
    ];

    const pathPts = generateSmoothLoop(cp, 460);

    const pitPts = [];
    for (let i = 0; i < 60; i++) {
        const u = i / 59;
        const x = -200 + u * 1300;
        const y = -80 + u * 10;
        pitPts.push({ x: +x.toFixed(1), y: +y.toFixed(1) });
    }

    return {
        id: 'longbeach',
        name: 'Long Beach Drift GP',
        scale: SCALE,
        width: 102,
        path: pathPts,
        pit: {
            path: pitPts,
            width: 60,
            fitM: 1.2
        }
    };
}

function generate() {
    const ebisu = createEbisuTrack();
    const longbeach = createLongBeachTrack();

    fs.writeFileSync(path.join(OUT_DIR, 'ebisu.json'), JSON.stringify(ebisu, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'longbeach.json'), JSON.stringify(longbeach, null, 2));

    console.log(`Generated ebisu.json (${ebisu.path.length} pts, width ${ebisu.width})`);
    console.log(`Generated longbeach.json (${longbeach.path.length} pts, width ${longbeach.width})`);
}

generate();
