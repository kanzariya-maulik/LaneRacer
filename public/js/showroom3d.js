import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let renderer = null;
let scene = null;
let camera = null;
let carGroup = null;
let carMesh = null;
let currentTeamId = 'mercedes';
let rimLight = null;

const texLoader = new THREE.TextureLoader();
const liveryCache = {};

function getLiveryTexture(teamId) {
    if (!liveryCache[teamId]) {
        const tex = texLoader.load(`liveries/${teamId}.png`);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        liveryCache[teamId] = tex;
    }
    return liveryCache[teamId];
}

function initShowroom() {
    const canvas = document.getElementById('lobby-3d-canvas');
    if (!canvas) return;

    const width = canvas.clientWidth || 130;
    const height = canvas.clientHeight || 56;

    renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82; // Subtle, dark-theme cockpit exposure

    scene = new THREE.Scene();

    // Studio Environment Reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    // Camera angled slightly elevated to frame the rotating F1 car in the header
    camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 1.25, 4.8);
    camera.lookAt(0, 0, 0);

    // Muted, High-End Studio Lighting (not washed out)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(3, 4, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x64748b, 0.6);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const topLight = new THREE.DirectionalLight(0x94a3b8, 0.7);
    topLight.position.set(0, 6, 0);
    scene.add(topLight);

    rimLight = new THREE.PointLight(0x38bdf8, 1.5, 10);
    rimLight.position.set(0, 1.5, -2.5);
    scene.add(rimLight);

    scene.add(new THREE.HemisphereLight(0xcfd8dc, 0x0b1120, 0.65));

    // Car Turntable Group (centered inside header mini-stage)
    carGroup = new THREE.Group();
    carGroup.position.set(0, -0.08, 0);
    scene.add(carGroup);

    // Load car model
    const loader = new GLTFLoader();
    loader.load('models/car.glb', (gltf) => {
        carMesh = gltf.scene;

        carMesh.traverse((o) => {
            if (!o.isMesh) return;
            o.visible = true; // Ensure wheels & all parts are visible
            if (o.material) {
                o.material = o.material.clone();
                if (o.material.name === 'livery') {
                    o.material.roughness = 0.38;
                    o.material.metalness = 0.15;
                } else if (o.material.name === 'rim') {
                    o.material.roughness = 0.35;
                    o.material.metalness = 0.75;
                } else if (o.material.name === 'tyre') {
                    o.material.roughness = 0.95;
                    o.material.metalness = 0.02;
                }
            }
        });

        carGroup.add(carMesh);

        // Apply selected team
        const savedTeam = localStorage.getItem('lanrace.teamId') || 'mercedes';
        applyTeam(savedTeam);
    }, undefined, (err) => {
        console.warn('[Showroom3D] car.glb load error:', err);
    });

    // Handle Window Resize
    const resizeHandler = () => {
        if (!canvas || !renderer || !camera) return;
        const w = canvas.clientWidth || 130;
        const h = canvas.clientHeight || 56;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    };

    window.addEventListener('resize', resizeHandler);
    setTimeout(resizeHandler, 100);

    // Start Animation Loop
    animate();
}

export function applyTeam(teamId) {
    currentTeamId = teamId || 'mercedes';
    if (!carMesh) return;

    const tex = getLiveryTexture(currentTeamId);
    carMesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.name === 'livery') {
            o.material.map = tex;
            o.material.color.set(0xffffff);
            o.material.needsUpdate = true;
        }
    });

    // Update rim accent light color based on team
    const teamColors = {
        'redbull': 0x3671c6,
        'mercedes': 0x27f4d2,
        'ferrari': 0xe8002d,
        'mclaren': 0xff8000,
        'astonmartin': 0x229971,
        'alpine': 0xff87bc,
        'williams': 0x64c4ff,
        'alphatauri': 0x5e8faa,
        'alfaromeo': 0xc92d4b,
        'haas': 0xb6babd,
        'redbull-suzuka': 0xe10600
    };
    if (rimLight && teamColors[currentTeamId]) {
        rimLight.color.setHex(teamColors[currentTeamId]);
    }
}

function animate() {
    requestAnimationFrame(animate);

    const lobby = document.getElementById('lobby-screen');
    if (!lobby || lobby.classList.contains('hidden') || lobby.style.display === 'none') {
        return; // Sleep rendering loop when playing in game
    }

    if (carGroup) {
        carGroup.rotation.y += 0.009; // Smooth 360-degree rotation
    }

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// Global hook for app.js
window.set3DShowroomTeam = applyTeam;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShowroom);
} else {
    initShowroom();
}
