// Interactive 3D F1 Showroom for Lobby Hero Viewport
// Renders the real 3D car model with OrbitControls, turntable auto-rotation,
// interactive zoom/inspection, and instant team livery synchronization.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadF1Model, onF1ModelReady, buildCar, applyTeamLiveryToModel, TEAM_PALETTES } from './carModel.js';

let scene, camera, renderer, controls;
let carGroup = null;
let shadowMesh = null;
let currentTeam = 'redbull';
let isActive = true;
let isInteracting = false;
let idleTimer = null;
let animFrameId = null;

const DEFAULT_CAM_POS = new THREE.Vector3(3.4, 1.25, 2.7);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.32, 0);

function createContactShadow() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Realistic ambient occlusion shadow under chassis
    const grad = ctx.createRadialGradient(128, 64, 12, 128, 64, 118);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.70)');
    grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.45)');
    grad.addColorStop(0.70, 'rgba(0, 0, 0, 0.16)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const geo = new THREE.PlaneGeometry(5.6, 2.4);
    const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.005, 0);
    return mesh;
}

function initShowroom() {
    const container = document.getElementById('hero-viewport');
    const canvas = document.getElementById('hero-canvas');
    if (!container || !canvas) return;

    // 1. Scene
    scene = new THREE.Scene();

    // 2. Camera
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 220;
    camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 50);
    camera.position.copy(DEFAULT_CAM_POS);

    // 3. Renderer with high-fidelity studio settings & transparent background
    renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    // 4. Studio Lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambLight);

    // Key Light (warm studio spotlight from front-three-quarter)
    const keyLight = new THREE.DirectionalLight(0xfff6ec, 2.4);
    keyLight.position.set(4.5, 6.0, 4.0);
    scene.add(keyLight);

    // Fill Light (cool sky tone from opposite side to accentuate contours)
    const fillLight = new THREE.DirectionalLight(0x8cb6ff, 1.4);
    fillLight.position.set(-4.5, 3.5, -4.0);
    scene.add(fillLight);

    // Strong Rim Light (rear high rim light to highlight rear wing and sidepods)
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.6);
    rimLight.position.set(-4.0, 5.0, 3.5);
    scene.add(rimLight);

    // Floor bounce underglow
    const bounceLight = new THREE.DirectionalLight(0xffffff, 0.4);
    bounceLight.position.set(0, -3.0, 0);
    scene.add(bounceLight);

    // 5. Contact Shadow
    shadowMesh = createContactShadow();
    scene.add(shadowMesh);

    // 6. OrbitControls
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.copy(DEFAULT_TARGET);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6; // Gentle showroom turntable rotation
    controls.enablePan = false;     // Keep car centered in viewport
    controls.zoomSpeed = 1.2;
    controls.rotateSpeed = 0.9;
    controls.minDistance = 2.0;    // Close-up detail inspection
    controls.maxDistance = 7.5;    // Max zoom out
    controls.maxPolarAngle = Math.PI * 0.49; // Keep camera above floor
    controls.minPolarAngle = Math.PI * 0.08; // Prevent gimbal lock at zenith

    // User Interaction handling: pause auto-rotate while inspecting, resume 2s after release
    function onInteractStart() {
        isInteracting = true;
        controls.autoRotate = false;
        clearTimeout(idleTimer);
    }

    function onInteractEnd() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            isInteracting = false;
            controls.autoRotate = true;
        }, 2000);
    }

    controls.addEventListener('start', onInteractStart);
    controls.addEventListener('end', onInteractEnd);

    // Wheel zoom idle handling
    container.addEventListener('wheel', () => {
        onInteractStart();
        onInteractEnd();
    }, { passive: true });

    // Camera reset button
    const resetBtn = document.getElementById('hero-reset-cam');
    if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetCamera();
        });
    }

    // 7. Responsive Resizing
    const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const w = entry.contentRect.width;
            const h = entry.contentRect.height;
            if (w > 0 && h > 0) {
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h, false);
            }
        }
    });
    ro.observe(container);

    // 8. Build initial car
    const initialTeam = window.selectedTeam || 'redbull';
    setTeam(initialTeam);

    // Preload 4K 2026 Red Bull RB22 model asynchronously and swap seamlessly
    loadF1Model().then(() => {
        rebuildCar();
    });
    onF1ModelReady(() => {
        rebuildCar();
    });

    // 9. Start Render Loop
    startLoop();
}

function resetCamera() {
    if (!camera || !controls) return;
    camera.position.copy(DEFAULT_CAM_POS);
    controls.target.copy(DEFAULT_TARGET);
    controls.update();
    controls.autoRotate = true;
    isInteracting = false;
    clearTimeout(idleTimer);
}

function rebuildCar() {
    if (!scene) return;
    if (carGroup) {
        scene.remove(carGroup);
        carGroup = null;
    }

    // High detail model for the showroom inspection
    carGroup = buildCar('high');
    applyTeamLiveryToModel(carGroup, currentTeam);
    scene.add(carGroup);
}

function setTeam(teamId) {
    currentTeam = teamId || 'redbull';
    rebuildCar();
}

function renderFrame() {
    if (!isActive) return;
    animFrameId = requestAnimationFrame(renderFrame);
    if (controls) controls.update();
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

function startLoop() {
    if (animFrameId !== null) return;
    isActive = true;
    const container = document.getElementById('hero-viewport');
    if (container && renderer && camera) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
        }
    }
    animFrameId = requestAnimationFrame(renderFrame);
}

function stopLoop() {
    isActive = false;
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
}

// Global hooks for app.js and socket events
window.updateHeroCar3D = (teamId) => {
    setTeam(teamId);
};

window.setHero3DActive = (active) => {
    if (active) {
        startLoop();
    } else {
        stopLoop();
    }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShowroom);
} else {
    initShowroom();
}
