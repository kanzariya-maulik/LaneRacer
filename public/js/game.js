const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let isRunning = false;
let camera = { x: 0, y: 0, zoom: 1 };

const inputs = { up: false, down: false, left: false, right: false };

// Key Bindings
window.addEventListener('keydown', (e) => {
    if(clientState.status === 'LOBBY' || document.activeElement === chatInput) return;
    switch(e.key.toLowerCase()) {
        case 'w': case 'arrowup': inputs.up = true; break;
        case 's': case 'arrowdown': inputs.down = true; break;
        case 'a': case 'arrowleft': inputs.left = true; break;
        case 'd': case 'arrowright': inputs.right = true; break;
    }
    sendInput();
});

window.addEventListener('keyup', (e) => {
    if(clientState.status === 'LOBBY' || document.activeElement === chatInput) return;
    switch(e.key.toLowerCase()) {
        case 'w': case 'arrowup': inputs.up = false; break;
        case 's': case 'arrowdown': inputs.down = false; break;
        case 'a': case 'arrowleft': inputs.left = false; break;
        case 'd': case 'arrowright': inputs.right = false; break;
    }
    sendInput();
});

function sendInput() {
    // window.sendUDPInput is defined in socket.js:
    // sends exclusively over WebRTC UDP DataChannel
    if (window.sendUDPInput) {
        window.sendUDPInput(inputs);
    }
}

// Window resizing
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // initial

// --- VIRTUAL JOYSTICK FOR MOBILE ---
const joyZone = document.getElementById('joystick-zone');
const joyBase = document.getElementById('joystick-base');
const joyKnob = document.getElementById('joystick-knob');

let isTouching = false;
let joyCenter = { x: 0, y: 0 };

if ('ontouchstart' in window) {
    joyZone.style.display = 'block';
}

joyBase.addEventListener('touchstart', (e) => {
    e.preventDefault(); // stop scrolling
    const rect = joyBase.getBoundingClientRect();
    joyCenter.x = rect.left + rect.width / 2;
    joyCenter.y = rect.top + rect.height / 2;
    isTouching = true;
    updateJoystick(e.touches[0]);
}, {passive: false});

joyBase.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if(!isTouching) return;
    updateJoystick(e.touches[0]);
}, {passive: false});

joyBase.addEventListener('touchend', (e) => {
    e.preventDefault();
    isTouching = false;
    joyKnob.style.transform = `translate(-50%, -50%)`;
    inputs.up = false; inputs.down = false; inputs.left = false; inputs.right = false;
    sendInput();
}, {passive: false});

function updateJoystick(touch) {
    let dx = touch.clientX - joyCenter.x;
    let dy = touch.clientY - joyCenter.y;
    const max = 50; 
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
    
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const threshold = 15;
    inputs.right = dx > threshold;
    inputs.left  = dx < -threshold;
    inputs.down  = dy > threshold;
    inputs.up    = dy < -threshold;
    sendInput();
}

// Exposed to app.js and socket.js
window.initGameVisuals = () => {
    if(!isRunning) {
        isRunning = true;
        requestAnimationFrame(gameLoop);
    }
}

function gameLoop() {
    if (clientState.status !== 'LOBBY') {
        render();
        updateHUD();
    }
    if (isRunning) {
        requestAnimationFrame(gameLoop);
    }
}

function render() {
    const track = clientState.trackData;
    const players = clientState.gameState;
    const me = players ? players[clientState.me] : null;

    if (!track || !players) return;

    // 2. Camera Setup
    if (me && !clientState.players[clientState.me]?.isSpectating) {
        // Follow player tightly to remove high-speed blurring
        const targetX = me.x - canvas.width / 2;
        const targetY = me.y - canvas.height / 2;
        camera.x += (targetX - camera.x) * 0.4;
        camera.y += (targetY - camera.y) * 0.4;
    } else {
        // Just center the map for spectators
        const bounds = getTrackBounds(track);
        camera.x = bounds.minX - 100;
        camera.y = bounds.minY - 100;
        let neededWidth = bounds.maxX - bounds.minX + 200;
        camera.zoom = canvas.width / neededWidth;
        if(camera.zoom > 1) camera.zoom = 1;
    }

    ctx.save();
    if(camera.zoom !== 1) {
        ctx.scale(camera.zoom, camera.zoom);
    }
    ctx.translate(-camera.x, -camera.y);

    // Grid Background (drawn world coordinates in visible area)
    const size = 60;
    // Draw base dark green
    ctx.fillStyle = '#9bd008'; 
    ctx.fillRect(camera.x, camera.y, canvas.width / camera.zoom, canvas.height / camera.zoom);
    // Draw lighter green tiles
    ctx.fillStyle = '#aadb15'; 
    const startX = Math.floor(camera.x / size) * size;
    const startY = Math.floor(camera.y / size) * size;
    const w = canvas.width / camera.zoom;
    const h = canvas.height / camera.zoom;
    for (let x = startX; x < startX + w + size; x += size) {
        for (let y = startY; y < startY + h + size; y += size) {
            if ((Math.abs(Math.floor(x/size)) % 2 === 0) !== (Math.abs(Math.floor(y/size)) % 2 === 0)) {
                ctx.fillRect(x, y, size, size);
            }
        }
    }

    // 3. Draw Track Surface
    // Tire Wall Base (Outer Boundary) - Balanced 80px limit (width + 160)
    drawTrackLayer(track, '#a8a29e', track.width + 165);      // Concrete base
    drawTrackLayer(track, '#f8fafc', track.width + 160);      // White solid tires underneath
    drawTrackLayer(track, '#ef4444', track.width + 160, true);// Red dashed tires on top
    
    // Draw the green grassy interior buffer zone before the wall
    drawTrackLayer(track, '#65a30d', track.width + 140);

    // Actual Asphalt Road
    drawTrackLayer(track, '#1e293b', track.width + 8);        // Dark Asphalt Edge
    drawTrackLayer(track, '#334155', track.width);            // Asphalt
    drawTrackLayer(track, '#fef08a', 4, true);                // Yellow dashed center line

    // Draw Checkpoints
    drawStartLine(track);

    // 4. Draw Cars
    for (let id in players) {
        drawCar(players[id], clientState.players[id]);
    }

    ctx.restore();
}

function getTrackBounds(track) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    track.path.forEach(p => {
        if(p.x < minX) minX = p.x;
        if(p.y < minY) minY = p.y;
        if(p.x > maxX) maxX = p.x;
        if(p.y > maxY) maxY = p.y;
    });
    return {minX, minY, maxX, maxY};
}

function drawTrackLayer(track, color, width, isDashed = false) {
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    
    // Draw Checkers 
    if (isDashed) {
        ctx.setLineDash([25, 25]);
    } else {
        ctx.setLineDash([]);
    }

    const path = track.path;
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    // Reset dash
    ctx.setLineDash([]);
}

function drawStartLine(track) {
    ctx.save();
    const p1 = track.path[0];
    const p2 = track.path[1];
    if (!p1 || !p2) return;

    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    ctx.translate(p1.x, p1.y);
    ctx.rotate(angle + Math.PI/2);
    
    const w = track.width;
    const h = 20; 
    const rows = 2; 
    const cols = Math.floor(w / 10);
    const sqW = w / cols;
    const sqH = h / rows;

    ctx.translate(-w/2, -h/2);

    // Thick border around finish line
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#000';
            ctx.fillRect(c * sqW, r * sqH, sqW, sqH);
        }
    }
    
    ctx.restore();
}

function drawCar(gameStatePlayer, lobbyStatePlayer) {
    if (!gameStatePlayer || !lobbyStatePlayer) return;

    const x = gameStatePlayer.x;
    const y = gameStatePlayer.y;
    const angle = gameStatePlayer.angle;
    const color = lobbyStatePlayer.color;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(1.5, 1.5); // Making car larger

    // Drop Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.roundRect(-15, -12, 30, 24, 4);
    ctx.fill();

    // Tires (Black with thick outline)
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    // Front tires (narrower, further forward)
    ctx.beginPath(); ctx.roundRect(10, -12, 8, 5, 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(10, 7, 8, 5, 2); ctx.fill(); ctx.stroke();
    // Rear tires (wider, further back)
    ctx.beginPath(); ctx.roundRect(-12, -14, 10, 7, 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-12, 7, 10, 7, 2); ctx.fill(); ctx.stroke();

    // F1 Front Wing
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(15, -10, 4, 20, 2); ctx.fill(); ctx.stroke();
    // Nose point
    ctx.beginPath(); ctx.moveTo(5, -4); ctx.lineTo(16, -2); ctx.lineTo(16, 2); ctx.lineTo(5, 4); ctx.fill(); ctx.stroke();

    // F1 Main Body (narrow chassis)
    ctx.beginPath(); ctx.roundRect(-10, -5, 18, 10, 3); ctx.fill(); ctx.stroke();
    // Sidepods (wider middle)
    ctx.beginPath(); ctx.roundRect(-5, -9, 10, 18, 3); ctx.fill(); ctx.stroke();

    // F1 Rear Wing
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.roundRect(-15, -10, 5, 20, 2); ctx.fill(); ctx.stroke();

    // Cockpit/Helmet (Small round circle)
    ctx.fillStyle = '#fef08a'; // bright yellow helmet
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    
    ctx.restore();

    // Name Tag Box (Cartoon style)
    ctx.save();
    ctx.translate(x, y - (36)); // Adjusted for larger car size
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; // dark pill
    ctx.beginPath();
    ctx.roundRect(-30, -12, 60, 16, 8);
    ctx.fill();
    ctx.fillStyle = lobbyStatePlayer.isReady ? '#4ade80' : '#fff';
    ctx.font = 'bold 12px Outfit, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lobbyStatePlayer.username, 0, -4);
    ctx.restore();
}

function updateHUD() {
    const players = clientState.gameState;
    const me = players ? players[clientState.me] : null;
    
    // 1. Player specific stats
    if (window.updateTransportBadge && window.isUDPReady !== undefined) {
        window.updateTransportBadge(window.isUDPReady);
    }
    if (me && !clientState.players[clientState.me]?.isSpectating) {
        document.getElementById('hud-speed').innerText = Math.abs(Math.floor(me.speed / 5)); // Scaled visual speed back to X / 5
        document.getElementById('hud-lap').innerText = me.lap + 1;
        
        // Find position
        let myPos = 1;
        const total = Object.keys(players).length;
        document.getElementById('hud-total').innerText = total;

        // Sort for simple rank: whoever has most laps + checkpoints.
        // Usually handled fully on backend, simple approximation here:
        let ranks = Object.values(players).sort((a, b) => {
            if(a.rank && a.rank > 0) return a.rank - (b.rank || 999); // Finished players first
            if(a.lap !== b.lap) return b.lap - a.lap;
            return b.checkpoint - a.checkpoint; // approximate
        });

        const rIndex = ranks.findIndex(p => p.id === clientState.me);
        if(rIndex !== -1) document.getElementById('hud-rank').innerText = rIndex + 1;

        updateLeaderboard(ranks);
    } else {
        document.getElementById('hud-speed').innerText = "--";
        // Spectator logic or empty list
        if (players) {
            updateLeaderboard(Object.values(players));
        }
    }
}

function updateLeaderboard(rankedArray) {
    const ol = document.getElementById('leaderboard-list');
    ol.innerHTML = '';
    
    // Top 5 only
    for (let i = 0; i < Math.min(5, rankedArray.length); i++) {
        const p = rankedArray[i];
        const lPlayer = clientState.players[p.id];
        if(!lPlayer) continue;
        
        const li = document.createElement('li');
        li.innerText = `${lPlayer.username} - Lap ${p.lap + 1}`;
        if(p.finished) li.innerText += ` (Done: #${p.rank})`;
        ol.appendChild(li);
    }
}
