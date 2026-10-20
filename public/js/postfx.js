// The post-processing chain for a level: its `effects` list (quality.js) turned into one three.js RenderPipeline.
// Browser only (WebGPURenderer). An effect that fails to build is dropped with a warning; the race goes on.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, velocity, metalness, roughness, convertToTexture, vec2, vec4, uv, float, length, smoothstep, step, mix, min, renderOutput, saturation, toneMappingExposure } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';

export function buildPost(renderer, scene, camera, effects) {
    const fx = new Set(effects), used = [], owned = []; // owned: nodes with GPU targets, freed in dispose()
    const own = (n) => { owned.push(n); return n; };
    const pipe = new THREE.RenderPipeline(renderer);
    const scenePass = own(pass(scene, camera));
    const needNormal = fx.has('ao') || fx.has('ssr'), needVel = fx.has('taau') || fx.has('traa');
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
    // GTAO sizes itself to the screen: its resolution follows the internal scale or it misreads the depth (line artifacts),
    // at half of it (AO is soft shading: no visible difference, 1.3 ms a frame back at High — 120 Hz needs 8.3 ms frames)
    const AO_RES = 0.5;
    // With TRAA its noise turns every frame and averages out; fixed, it stays on detailed surfaces (the cars) as grain
    const temporalAA = fx.has('traa') || fx.has('taau');
    let aoNode = null;
    // Not on the sky (depth at the far plane: 0 reversed, 1 otherwise): on WebGL2 GTAO rings it with noise
    const surface = renderer.reversedDepthBuffer ? step(1e-7, depth.r) : step(depth.r, 0.9999999);
    tryFx('ao', (c) => { aoNode = own(ao(depth, normal, camera)); aoNode.resolutionScale = AO_RES; aoNode.useTemporalFiltering = temporalAA;
        // its raw output is per-pixel noise (grain over the whole screen): blurred at its own half resolution, two
        // small passes (a depth-aware denoise looked the same at 16 full-resolution samples a pixel)
        const soft = own(gaussianBlur(aoNode.getTextureNode(), null, 2));
        return vec4(c.rgb.mul(mix(float(1), soft.r, surface.mul(0.8))), c.a); });
    tryFx('ssr', (c) => {
        const mr = scenePass.getTextureNode('metalrough');
        const r = own(ssr(own(convertToTexture(c)), depth, normal, { metalnessNode: mr.r, roughnessNode: mr.g, reflectNonMetals: false, camera }));
        return vec4(c.rgb.add(r.rgb.mul(r.a)), c.a);
    });
    let glow = null;
    // Bloom judges the exposed image, as a camera does: only what is far brighter than the sky glows (sun, glints,
    // floodlight lamps). Judged on raw HDR at a fixed threshold, the day sky's horizon band (brighter than 3 before a 0.4
    // exposure) glowed over every tree and wall as a milky veil, while the night lamps never reached it.
    // The physical sky's sun disc is thousands of times brighter than the scene: capped, it glows round the sun only
    const BLOOM_CAP = 8;
    tryFx('bloom', (c) => { glow = own(bloom(vec4(min(c.rgb.mul(toneMappingExposure), float(BLOOM_CAP)), c.a), 0.25, 0.4, 5)); return c.add(glow.div(toneMappingExposure)); });
    tryFx('lensflare', (c) => (glow ? c.add(own(lensflare(glow, { threshold: 4, ghostAttenuationFactor: 25 }))) : c));
    tryFx('vignette', (c) => vec4(c.rgb.mul(float(1).sub(smoothstep(0.45, 1.0, length(uv().sub(0.5)).mul(1.4)).mul(0.35))), c.a));

    // Grade (every level): ACES pulls bright colours toward white; a touch more saturation brings grass, sky and liveries back
    color = vec4(saturation(color.rgb, 1.15), color.a);

    // Temporal AA works on linear colour (tone mapping after); else the spatial AA works on the tone-mapped image
    if (fx.has('traa') || fx.has('taau')) {
        tryFx('traa', (c) => own(traa(c, depth, vel, camera)));
        tryFx('taau', (c) => own(taau(c, depth, vel, camera)));
        pipe.outputColorTransform = true;
    } else {
        pipe.outputColorTransform = false;
        // Upscale first: FXAA/SMAA size themselves to the screen and would sample a smaller input with the wrong texel size
        color = renderOutput(color);
        tryFx('fsr1', (c) => own(fsr1(c)));
        tryFx('fxaa', (c) => own(fxaa(c)));
        tryFx('smaa', (c) => own(smaa(c)));
    }
    pipe.outputNode = color;
    return {
        effects: used,
        render: () => pipe.render(),
        setScale: (s) => { scenePass.setResolutionScale(s); if (aoNode) aoNode.resolutionScale = s * AO_RES; },
        // RenderPipeline.dispose() frees only its quad material (r186): the passes' render targets are freed here
        dispose: () => { pipe.dispose(); for (const n of owned) n.dispose?.(); },
    };
}
