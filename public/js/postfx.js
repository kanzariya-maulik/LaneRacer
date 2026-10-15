// The post-processing chain for a level: its `effects` list (quality.js) turned into one three.js RenderPipeline.
// Browser only (WebGPURenderer). An effect that fails to build is dropped with a warning; the race goes on.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, velocity, metalness, roughness, convertToTexture, vec2, vec4, uv, float, length, smoothstep, step, mix, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';

export function buildPost(renderer, scene, camera, effects) {
    const fx = new Set(effects), used = [];
    const pipe = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const needNormal = fx.has('ao') || fx.has('ssr'), needVel = fx.has('motionBlur') || fx.has('taau') || fx.has('traa');
    const outs = { output };
    if (needNormal) outs.normal = normalView; // the pass targets are half float: signed normals fit unpacked
    if (needVel) outs.velocity = velocity;
    if (fx.has('ssr')) outs.metalrough = vec2(metalness, roughness);
    scenePass.setMRT(mrt(outs));
    const depth = scenePass.getTextureNode('depth');
    const normal = needNormal ? scenePass.getTextureNode('normal') : null;
    const vel = needVel ? scenePass.getTextureNode('velocity') : null;
    let color = scenePass.getTextureNode('output');
    const tryFx = (name, f) => { if (!fx.has(name)) return; try { color = f(color); used.push(name); } catch (e) { console.warn(`postfx: ${name} dropped`, e); } };

    // Contact shadows: one pass, AO on the final colour (softened) instead of a second geometry pre-pass.
    // GTAO sizes itself to the screen: its resolution follows the internal scale or it misreads the depth (line artifacts)
    let aoNode = null;
    // Not on the sky (depth at the far plane: 0 reversed, 1 otherwise): on WebGL2 GTAO rings it with noise
    const surface = renderer.reversedDepthBuffer ? step(1e-7, depth.r) : step(depth.r, 0.9999999);
    tryFx('ao', (c) => { aoNode = ao(depth, normal, camera); return vec4(c.rgb.mul(mix(float(1), aoNode.getTextureNode().r, surface.mul(0.8))), c.a); });
    tryFx('ssr', (c) => {
        const mr = scenePass.getTextureNode('metalrough');
        const r = ssr(convertToTexture(c), depth, normal, { metalnessNode: mr.r, roughnessNode: mr.g, reflectNonMetals: false, camera });
        return vec4(c.rgb.add(r.rgb.mul(r.a)), c.a);
    });
    let glow = null;
    // Threshold above the HDR sky's own brightness: only sun glints, floodlights and lamps bloom, not the whole sky
    tryFx('bloom', (c) => { glow = bloom(c, 0.2, 0.4, 3.0); return c.add(glow); });
    tryFx('lensflare', (c) => (glow ? c.add(lensflare(glow, { threshold: 4, ghostAttenuationFactor: 25 })) : c));
    tryFx('motionBlur', (c) => motionBlur(convertToTexture(c), vel.mul(0.5)));
    tryFx('vignette', (c) => vec4(c.rgb.mul(float(1).sub(smoothstep(0.45, 1.0, length(uv().sub(0.5)).mul(1.4)).mul(0.35))), c.a));
    tryFx('grain', (c) => film(c, float(0.08)));

    // Temporal AA works on linear colour (tone mapping after); else the spatial AA works on the tone-mapped image
    if (fx.has('traa') || fx.has('taau')) {
        tryFx('traa', (c) => traa(c, depth, vel, camera));
        tryFx('taau', (c) => taau(c, depth, vel, camera));
        pipe.outputColorTransform = true;
    } else {
        pipe.outputColorTransform = false;
        // Upscale first: FXAA/SMAA size themselves to the screen and would sample a smaller input with the wrong texel size
        color = renderOutput(color);
        tryFx('fsr1', (c) => fsr1(c));
        tryFx('fxaa', (c) => fxaa(c));
        tryFx('smaa', (c) => smaa(c));
    }
    pipe.outputNode = color;
    return {
        effects: used,
        render: () => pipe.render(),
        setScale: (s) => { scenePass.setResolutionScale(s); if (aoNode) aoNode.resolutionScale = s; },
        dispose: () => pipe.dispose(),
    };
}
