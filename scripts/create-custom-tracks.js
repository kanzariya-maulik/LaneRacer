const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'tracks');

// 1. OVAL-X: Semicircle + 2 parallel lines + semicircle
const R_oval = 1800; // 300m radius
const L_oval = 6000; // 1000m straights
const ptsOval = [];

// Main straight (first half): (0, -R) to (L/2, -R)
const nHalf1 = 60;
for (let i = 0; i < nHalf1; i++) {
    ptsOval.push({ x: Number(((L_oval / 2) * (i / nHalf1)).toFixed(1)), y: -R_oval });
}

// Semicircle 1 (Turn 1 & 2): centered at (L/2, 0)
const nArc1 = 113;
for (let i = 0; i < nArc1; i++) {
    const theta = -Math.PI / 2 + (Math.PI * i / nArc1);
    ptsOval.push({
        x: Number((L_oval / 2 + R_oval * Math.cos(theta)).toFixed(1)),
        y: Number((R_oval * Math.sin(theta)).toFixed(1))
    });
}

// Back straight: (L/2, R) to (-L/2, R)
const nBack = 120;
for (let i = 0; i < nBack; i++) {
    ptsOval.push({
        x: Number((L_oval / 2 - L_oval * (i / nBack)).toFixed(1)),
        y: R_oval
    });
}

// Semicircle 2 (Turn 3 & 4): centered at (-L/2, 0)
const nArc2 = 113;
for (let i = 0; i < nArc2; i++) {
    const theta = Math.PI / 2 + (Math.PI * i / nArc2);
    ptsOval.push({
        x: Number((-L_oval / 2 + R_oval * Math.cos(theta)).toFixed(1)),
        y: Number((R_oval * Math.sin(theta)).toFixed(1))
    });
}

// Main straight (second half): (-L/2, -R) to (0, -R)
const nHalf2 = 60;
for (let i = 0; i < nHalf2; i++) {
    ptsOval.push({
        x: Number((-L_oval / 2 + (L_oval / 2) * (i / nHalf2)).toFixed(1)),
        y: -R_oval
    });
}

const edgesOval = ptsOval.map(() => [6, 6]);
const zOval = ptsOval.map(() => 0);
const ovalData = {
    id: 'oval-x',
    name: 'Speedway Oval - X',
    scale: 6,
    width: 120,
    path: ptsOval,
    edges: edgesOval,
    z: zOval
};

fs.writeFileSync(path.join(DATA_DIR, 'oval-x.json'), JSON.stringify(ovalData));
fs.writeFileSync(path.join(DATA_DIR, 'oval.json'), JSON.stringify({ ...ovalData, id: 'oval' }));
console.log('Saved data/tracks/oval-x.json and oval.json with', ptsOval.length, 'points');

// 2. RING-X: Full Circle
const R_ring = 3000; // 500m radius
const nRing = 377;
const ptsRing = [];

for (let i = 0; i < nRing; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i / nRing);
    ptsRing.push({
        x: Number((R_ring * Math.cos(theta)).toFixed(1)),
        y: Number((R_ring * Math.sin(theta)).toFixed(1))
    });
}

const edgesRing = ptsRing.map(() => [6, 6]);
const zRing = ptsRing.map(() => 0);
const ringData = {
    id: 'ring-x',
    name: 'The Ring - X',
    scale: 6,
    width: 120,
    path: ptsRing,
    edges: edgesRing,
    z: zRing
};

fs.writeFileSync(path.join(DATA_DIR, 'ring-x.json'), JSON.stringify(ringData));
fs.writeFileSync(path.join(DATA_DIR, 'ring.json'), JSON.stringify({ ...ringData, id: 'ring' }));
console.log('Saved data/tracks/ring-x.json and ring.json with', ptsRing.length, 'points');

// 3. TRACK-X: 6 Symmetrical Half-Round Turns (Exact Match to User Sketch)
// - Flipped: Bigger straight (Lan 1, 7200 units / 1200m) is on TOP (y = -2160)
// - Shorter straight (Lan 2, 4800 units / 800m) is on BOTTOM (y = +2160)
// - Clockwise lapping: travels East along top, South along right, West along bottom, North along left
// - All 6 turns are semicircles with the exact same radius R = 720 world units (120m radius)
// - Bilateral vertical mirror symmetry (Left == Right across x = 0)
const R_turn = 720; // 120m radius: optimal for high-speed high-G satisfying cornering
const X1 = 3600;    // half of Lan 1 (total Lan 1 = 7200)
const X2 = 2400;    // half of Lan 2 (total Lan 2 = 4800)
const X3 = 1140;    // waist curve center position (waist gap = 840 units / 140m)

const ptsTrackX = [];

// 1. Lan 1 (Top Straight, second half): from (0, -2160) to (X1, -2160), heading East
for (let i = 0; i < 80; i++) {
    ptsTrackX.push({ x: Number((X1 * (i / 80)).toFixed(1)), y: -2160 });
}

// 2. Turn 1 (Top-Right): center (X1, -1440), clockwise from -pi/2 to pi/2
for (let i = 0; i < 60; i++) {
    const theta = -Math.PI / 2 + (Math.PI * i / 60);
    ptsTrackX.push({
        x: Number((X1 + R_turn * Math.cos(theta)).toFixed(1)),
        y: Number((-1440 + R_turn * Math.sin(theta)).toFixed(1))
    });
}

// 3. Lan 3 (Right): straight at y = -720, heading West from X1 (3600) to X3 (1140)
for (let i = 0; i < 60; i++) {
    ptsTrackX.push({
        x: Number((X1 - (X1 - X3) * (i / 60)).toFixed(1)),
        y: -720
    });
}

// 4. Turn 2 (Middle-Right Waist): center (X3, 0), curves inward to the left (West)
for (let i = 0; i < 60; i++) {
    const alpha = -Math.PI / 2 + (Math.PI * i / 60);
    ptsTrackX.push({
        x: Number((X3 - R_turn * Math.cos(alpha)).toFixed(1)),
        y: Number((R_turn * Math.sin(alpha)).toFixed(1))
    });
}

// 5. Lan 4 (Right): straight at y = 720, heading East from X3 (1140) to X2 (2400)
for (let i = 0; i < 35; i++) {
    ptsTrackX.push({
        x: Number((X3 + (X2 - X3) * (i / 35)).toFixed(1)),
        y: 720
    });
}

// 6. Turn 3 (Bottom-Right): center (X2, 1440), clockwise from -pi/2 to pi/2
for (let i = 0; i < 60; i++) {
    const beta = -Math.PI / 2 + (Math.PI * i / 60);
    ptsTrackX.push({
        x: Number((X2 + R_turn * Math.cos(beta)).toFixed(1)),
        y: Number((1440 + R_turn * Math.sin(beta)).toFixed(1))
    });
}

// 7. Lan 2 (Bottom Straight): straight at y = 2160, heading West from X2 (2400) to -X2 (-2400)
for (let i = 0; i < 110; i++) {
    ptsTrackX.push({
        x: Number((X2 - (2 * X2) * (i / 110)).toFixed(1)),
        y: 2160
    });
}

// 8. Turn 4 (Bottom-Left): center (-X2, 1440), clockwise from -pi/2 to pi/2
for (let i = 0; i < 60; i++) {
    const gamma = -Math.PI / 2 + (Math.PI * i / 60);
    ptsTrackX.push({
        x: Number((-X2 - R_turn * Math.cos(gamma)).toFixed(1)),
        y: Number((1440 - R_turn * Math.sin(gamma)).toFixed(1))
    });
}

// 9. Lan 4 (Left): straight at y = 720, heading East from -X2 (-2400) to -X3 (-1140)
for (let i = 0; i < 35; i++) {
    ptsTrackX.push({
        x: Number((-X2 + (X2 - X3) * (i / 35)).toFixed(1)),
        y: 720
    });
}

// 10. Turn 5 (Middle-Left Waist): center (-X3, 0), curves inward to the right (East)
for (let i = 0; i < 60; i++) {
    const delta = -Math.PI / 2 + (Math.PI * i / 60);
    ptsTrackX.push({
        x: Number((-X3 + R_turn * Math.cos(delta)).toFixed(1)),
        y: Number((-R_turn * Math.sin(delta)).toFixed(1))
    });
}

// 11. Lan 3 (Left): straight at y = -720, heading West from -X3 (-1140) to -X1 (-3600)
for (let i = 0; i < 60; i++) {
    ptsTrackX.push({
        x: Number((-X3 - (X1 - X3) * (i / 60)).toFixed(1)),
        y: -720
    });
}

// 12. Turn 6 (Top-Left): center (-X1, -1440), clockwise from -pi/2 to pi/2
for (let i = 0; i < 60; i++) {
    const epsilon = -Math.PI / 2 + (Math.PI * i / 60);
    ptsTrackX.push({
        x: Number((-X1 - R_turn * Math.cos(epsilon)).toFixed(1)),
        y: Number((-1440 - R_turn * Math.sin(epsilon)).toFixed(1))
    });
}

// 13. Lan 1 (Top Straight, first half): straight at y = -2160, heading East from -X1 (-3600) to 0
for (let i = 0; i < 80; i++) {
    ptsTrackX.push({
        x: Number((-X1 + X1 * (i / 80)).toFixed(1)),
        y: -2160
    });
}

const edgesTrackX = ptsTrackX.map(() => [6, 6]);
const zTrackX = ptsTrackX.map(() => 0);
const trackXData = {
    id: 'track-x',
    name: 'Track - X (6 Turns)',
    scale: 6,
    width: 120,
    path: ptsTrackX,
    edges: edgesTrackX,
    z: zTrackX
};

fs.writeFileSync(path.join(DATA_DIR, 'track-x.json'), JSON.stringify(trackXData));
fs.writeFileSync(path.join(DATA_DIR, 'bone-x.json'), JSON.stringify({ ...trackXData, id: 'bone-x' }));
console.log('Saved data/tracks/track-x.json and bone-x.json with', ptsTrackX.length, 'points');
