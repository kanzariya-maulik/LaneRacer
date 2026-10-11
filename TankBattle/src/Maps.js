// Arena Map Generator for TankBattle LAN
// Maps: The Citadel, The Velocity Oval, The Orbital Ring
const MapManager = require('./MapManager');

function createCitadelMap(teamMode = '2teams') {
    const map = new MapManager(26, 26, 32);

    // Helper: fill rect with tile type
    const fill = (c1, r1, c2, r2, type) => {
        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                map.setTile(c, r, type);
            }
        }
    };

    // 1. Surrounding perimeter: open with strategic steel corner pillars
    map.setTile(0, 0, 2); map.setTile(25, 0, 2);
    map.setTile(0, 25, 2); map.setTile(25, 25, 2);

    // 2. Fortified central corridors and brick battlements
    // Center divider with breakable brick gates
    fill(4, 12, 10, 13, 1);
    fill(15, 12, 21, 13, 1);
    // Center steel bunker pillars
    map.setTile(12, 11, 2); map.setTile(13, 11, 2);
    map.setTile(12, 14, 2); map.setTile(13, 14, 2);

    // Water moats dividing quadrants
    fill(12, 5, 13, 8, 3);
    fill(12, 17, 13, 20, 3);

    // Forest / Foliage patches for ambush flanking
    fill(2, 6, 4, 9, 4);
    fill(21, 6, 23, 9, 4);
    fill(2, 16, 4, 19, 4);
    fill(21, 16, 23, 19, 4);

    // Ice crossroad patches for sliding drift
    fill(8, 7, 9, 8, 5);
    fill(16, 7, 17, 8, 5);
    fill(8, 17, 9, 18, 5);
    fill(16, 17, 17, 18, 5);

    // Tactical brick alleys
    fill(6, 2, 7, 5, 1);
    fill(18, 2, 19, 5, 1);
    fill(6, 20, 7, 23, 1);
    fill(18, 20, 19, 23, 1);

    fill(2, 2, 3, 4, 1);
    fill(22, 2, 23, 4, 1);
    fill(2, 21, 3, 23, 1);
    fill(22, 21, 23, 23, 1);

    // Bases and Eagle HQs according to teamMode
    const spawns = {};
    if (teamMode === '2teams' || teamMode === 'ffa') {
        // Red HQ at Bottom (row 24, col 12)
        map.registerEagle('team-red', 12, 24);
        // Surrounding protective brick fortification
        map.setTile(11, 23, 1); map.setTile(12, 23, 1); map.setTile(13, 23, 1);
        map.setTile(11, 24, 1);                         map.setTile(13, 24, 1);
        map.setTile(11, 25, 1);                         map.setTile(13, 25, 1);

        // Blue HQ at Top (row 1, col 12)
        map.registerEagle('team-blue', 12, 1);
        map.setTile(11, 0, 1);                          map.setTile(13, 0, 1);
        map.setTile(11, 1, 1);                          map.setTile(13, 1, 1);
        map.setTile(11, 2, 1); map.setTile(12, 2, 1); map.setTile(13, 2, 1);

        spawns['team-red'] = [
            { x: 9 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' },
            { x: 15 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' },
            { x: 8 * 32 + 16, y: 23 * 32 + 16, dir: 'UP' },
            { x: 16 * 32 + 16, y: 23 * 32 + 16, dir: 'UP' }
        ];
        spawns['team-blue'] = [
            { x: 9 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' },
            { x: 15 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' },
            { x: 8 * 32 + 16, y: 2 * 32 + 16, dir: 'DOWN' },
            { x: 16 * 32 + 16, y: 2 * 32 + 16, dir: 'DOWN' }
        ];
    } else if (teamMode === '4teams') {
        // Red: Bottom-Left, Blue: Top-Right, Green: Top-Left, Yellow: Bottom-Right
        map.registerEagle('team-red', 1, 24);
        fill(0, 23, 2, 23, 1); map.setTile(2, 24, 1); map.setTile(2, 25, 1);

        map.registerEagle('team-blue', 24, 1);
        fill(23, 2, 25, 2, 1); map.setTile(23, 0, 1); map.setTile(23, 1, 1);

        map.registerEagle('team-green', 1, 1);
        fill(0, 2, 2, 2, 1); map.setTile(2, 0, 1); map.setTile(2, 1, 1);

        map.registerEagle('team-yellow', 24, 24);
        fill(23, 23, 25, 23, 1); map.setTile(23, 24, 1); map.setTile(23, 25, 1);

        spawns['team-red'] = [{ x: 3 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' }];
        spawns['team-blue'] = [{ x: 22 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' }];
        spawns['team-green'] = [{ x: 3 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' }];
        spawns['team-yellow'] = [{ x: 22 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' }];
    } else if (teamMode === '3teams') {
        map.registerEagle('team-red', 12, 24);
        map.registerEagle('team-blue', 22, 3);
        map.registerEagle('team-green', 3, 3);
        spawns['team-red'] = [{ x: 10 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' }];
        spawns['team-blue'] = [{ x: 20 * 32 + 16, y: 4 * 32 + 16, dir: 'DOWN' }];
        spawns['team-green'] = [{ x: 5 * 32 + 16, y: 4 * 32 + 16, dir: 'DOWN' }];
    }

    return { map, spawns };
}

function createVelocityOvalMap(teamMode = '2teams') {
    const map = new MapManager(26, 26, 32);
    const fill = (c1, r1, c2, r2, type) => {
        for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
                map.setTile(c, r, type);
            }
        }
    };

    // Stadium Oval Geometry:
    // Top Straight (rows 2-5): Sniper Alley flanked by Water Moat (rows 6-7, cols 7-18)
    // Central Island (rows 10-15, cols 6-19): Brick & Steel with central cross-corridor cut
    // Bottom Straight (rows 20-23): Ambush Trench flanked by Forest (row 18) and Ice tracks (row 19)
    // Semicircles on Left (cols 1-5) and Right (cols 20-24)

    // Outer border steel corners
    fill(0, 0, 25, 0, 2);
    fill(0, 25, 25, 25, 2);

    // 1. Top Straight Water Moat (bullets pass through, tanks blocked!)
    fill(7, 6, 18, 7, 3);

    // 2. Bottom Straight Forest & Ice Trench
    fill(7, 18, 18, 18, 4); // Forest
    fill(7, 19, 18, 19, 5); // Ice

    // 3. Central Island Divider
    fill(7, 10, 11, 15, 1); // West brick block
    fill(14, 10, 18, 15, 1); // East brick block
    map.setTile(12, 10, 2); map.setTile(13, 10, 2); // Steel anchors
    map.setTile(12, 15, 2); map.setTile(13, 15, 2);
    // Destructible brick cross-cut in center (cols 12-13, rows 11-14 are destructible brick)
    fill(12, 11, 13, 14, 1);

    // 4. Curved loop wall segments (Pill / Oval shape)
    // Left Semicircle curved wall
    map.setTile(4, 2, 2); map.setTile(3, 3, 1); map.setTile(2, 4, 1); map.setTile(1, 5, 2);
    map.setTile(4, 23, 2); map.setTile(3, 22, 1); map.setTile(2, 21, 1); map.setTile(1, 20, 2);

    // Right Semicircle curved wall
    map.setTile(21, 2, 2); map.setTile(22, 3, 1); map.setTile(23, 4, 1); map.setTile(24, 5, 2);
    map.setTile(21, 23, 2); map.setTile(22, 22, 1); map.setTile(23, 21, 1); map.setTile(24, 20, 2);

    // Bases for Velocity Oval:
    const spawns = {};
    if (teamMode === '2teams' || teamMode === 'ffa') {
        // Red Eagle inside Left Semicircle loop (col 2, row 12)
        map.registerEagle('team-red', 2, 12);
        map.setTile(1, 11, 1); map.setTile(2, 11, 1); map.setTile(3, 11, 1);
        map.setTile(3, 12, 1);
        map.setTile(1, 13, 1); map.setTile(2, 13, 1); map.setTile(3, 13, 1);

        // Blue Eagle inside Right Semicircle loop (col 23, row 12)
        map.registerEagle('team-blue', 23, 12);
        map.setTile(22, 11, 1); map.setTile(23, 11, 1); map.setTile(24, 11, 1);
        map.setTile(22, 12, 1);
        map.setTile(22, 13, 1); map.setTile(23, 13, 1); map.setTile(24, 13, 1);

        spawns['team-red'] = [
            { x: 3 * 32 + 16, y: 8 * 32 + 16, dir: 'UP' },
            { x: 3 * 32 + 16, y: 16 * 32 + 16, dir: 'DOWN' },
            { x: 1 * 32 + 16, y: 8 * 32 + 16, dir: 'UP' },
            { x: 1 * 32 + 16, y: 16 * 32 + 16, dir: 'DOWN' }
        ];
        spawns['team-blue'] = [
            { x: 22 * 32 + 16, y: 8 * 32 + 16, dir: 'UP' },
            { x: 22 * 32 + 16, y: 16 * 32 + 16, dir: 'DOWN' },
            { x: 24 * 32 + 16, y: 8 * 32 + 16, dir: 'UP' },
            { x: 24 * 32 + 16, y: 16 * 32 + 16, dir: 'DOWN' }
        ];
    } else {
        // 4 teams at 4 straight entrances
        map.registerEagle('team-red', 1, 22);
        map.registerEagle('team-blue', 24, 3);
        map.registerEagle('team-green', 1, 3);
        map.registerEagle('team-yellow', 24, 22);

        spawns['team-red'] = [{ x: 3 * 32 + 16, y: 22 * 32 + 16, dir: 'UP' }];
        spawns['team-blue'] = [{ x: 22 * 32 + 16, y: 3 * 32 + 16, dir: 'DOWN' }];
        spawns['team-green'] = [{ x: 3 * 32 + 16, y: 3 * 32 + 16, dir: 'DOWN' }];
        spawns['team-yellow'] = [{ x: 22 * 32 + 16, y: 22 * 32 + 16, dir: 'UP' }];
    }

    return { map, spawns };
}

function createOrbitalRingMap(teamMode = '2teams') {
    const map = new MapManager(26, 26, 32);
    const centerC = 12.5;
    const centerR = 12.5;

    // Concentric circles:
    // Outer Radius ~ 11.5 tiles (Ice drifting track)
    // Middle Radius ~ 7.5 tiles (Brick fortress)
    // Inner Core Radius ~ 3.5 tiles (Water moat surrounding central sanctum)

    for (let r = 0; r < 26; r++) {
        for (let c = 0; c < 26; c++) {
            const dist = Math.hypot(c - centerC, r - centerR);
            const angle = Math.atan2(r - centerR, c - centerC); // -PI to PI

            // 8 Radial Spokes angles: 0, PI/4, PI/2, 3PI/4, PI, -3PI/4, -PI/2, -PI/4
            let isSpoke = false;
            for (let k = 0; k < 8; k++) {
                const spokeAngle = -Math.PI + k * (Math.PI / 4);
                let diff = Math.abs(angle - spokeAngle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                if (diff < 0.16) {
                    isSpoke = true;
                    break;
                }
            }

            // Outer ring ice track
            if (dist >= 10.2 && dist <= 11.8) {
                map.setTile(c, r, 5); // Ice
            }
            // Middle ring brick barricades
            else if (dist >= 6.8 && dist <= 8.8) {
                if (isSpoke) {
                    map.setTile(c, r, 1); // Destructible brick gate along spoke
                } else {
                    map.setTile(c, r, (r + c) % 5 === 0 ? 2 : 1); // Mostly brick with steel pillars
                }
            }
            // Inner Core Water Moat
            else if (dist >= 3.8 && dist <= 5.2) {
                if (isSpoke) {
                    map.setTile(c, r, 0); // Bridge over water
                } else {
                    map.setTile(c, r, 3); // Water moat!
                }
            }
            // Forest patches in middle quadrants
            else if (dist >= 8.9 && dist <= 9.8 && (c % 4 === 0)) {
                map.setTile(c, r, 4); // Foliage
            }
        }
    }

    // Inner Core Center Altar (Steel corner pillars)
    map.setTile(11, 11, 2); map.setTile(14, 11, 2);
    map.setTile(11, 14, 2); map.setTile(14, 14, 2);

    // Spawns and Eagle bases
    const spawns = {};
    if (teamMode === '2teams' || teamMode === 'ffa') {
        // North (12:00) vs South (06:00)
        map.registerEagle('team-red', 12, 23);
        map.setTile(11, 22, 1); map.setTile(12, 22, 1); map.setTile(13, 22, 1);
        map.setTile(11, 23, 1);                         map.setTile(13, 23, 1);

        map.registerEagle('team-blue', 12, 2);
        map.setTile(11, 3, 1); map.setTile(12, 3, 1); map.setTile(13, 3, 1);
        map.setTile(11, 2, 1);                         map.setTile(13, 2, 1);

        spawns['team-red'] = [
            { x: 10 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' },
            { x: 14 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' }
        ];
        spawns['team-blue'] = [
            { x: 10 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' },
            { x: 14 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' }
        ];
    } else if (teamMode === '4teams') {
        // 12:00, 03:00, 06:00, 09:00
        map.registerEagle('team-blue', 12, 2);
        map.registerEagle('team-yellow', 23, 12);
        map.registerEagle('team-red', 12, 23);
        map.registerEagle('team-green', 2, 12);

        spawns['team-blue'] = [{ x: 12 * 32 + 16, y: 1 * 32 + 16, dir: 'DOWN' }];
        spawns['team-yellow'] = [{ x: 24 * 32 + 16, y: 12 * 32 + 16, dir: 'LEFT' }];
        spawns['team-red'] = [{ x: 12 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' }];
        spawns['team-green'] = [{ x: 1 * 32 + 16, y: 12 * 32 + 16, dir: 'RIGHT' }];
    } else if (teamMode === '3teams') {
        map.registerEagle('team-red', 12, 23);
        map.registerEagle('team-blue', 22, 6);
        map.registerEagle('team-green', 3, 6);

        spawns['team-red'] = [{ x: 12 * 32 + 16, y: 24 * 32 + 16, dir: 'UP' }];
        spawns['team-blue'] = [{ x: 23 * 32 + 16, y: 5 * 32 + 16, dir: 'DOWN' }];
        spawns['team-green'] = [{ x: 2 * 32 + 16, y: 5 * 32 + 16, dir: 'DOWN' }];
    }

    return { map, spawns };
}

function loadMap(mapId = 'citadel', teamMode = '2teams') {
    switch (mapId) {
        case 'velocity_oval':
            return createVelocityOvalMap(teamMode);
        case 'orbital_ring':
            return createOrbitalRingMap(teamMode);
        case 'citadel':
        default:
            return createCitadelMap(teamMode);
    }
}

module.exports = {
    loadMap,
    createCitadelMap,
    createVelocityOvalMap,
    createOrbitalRingMap
};
