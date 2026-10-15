# LanRace Render Pipeline (WebGPU, physical sky, post-processing) — Design Spec

Date: 2026-10-15
Status: Approved in chat (sections 1–4), pending written-spec review
Builds on: `develop` at `e1d55bd` (bot standing starts, T-cam)

## Goal

First of three sub-projects toward an F1-game look in the browser (next: a detailed Blender car with animations, then a hero track at full detail). This one rebuilds how the game draws: WebGPU renderer, physical sky and real reflections, cascaded shadows, and a post-processing chain (ambient occlusion, bloom, motion blur, temporal anti-aliasing), with quality levels that keep weak laptops playable. Private LAN game for friends on a mix of gaming PCs and laptops.

## What exists today

- `game3d.js`: `THREE.WebGLRenderer` (antialias fixed at load), import map `three` → `three.module.js`. No custom shaders: only `MeshStandardMaterial`, `MeshBasicMaterial`, `PointsMaterial`, so materials carry over to the node system unchanged.
- Sky: vertex-coloured dome (zenith → horizon gradient) per circuit from `themes.js` `SKIES` (`top`, `horizon`, `sun`, `power`, `elevation`, `azimuth`, `hemi`); `NIGHTS` per circuit add stars and floodlight sun. Linear `Fog` to the horizon colour.
- Light: `HemisphereLight` + one `DirectionalLight` sun with a single shadow box (±360 units chase, ±120 onboard via `shadowHalf`), moved in whole texels by `snapLight`. Blob shadow under every car.
- Reflections: `RoomEnvironment` PMREM on car materials (Medium/High), dimmed at night.
- Onboard views: two-pass render (world, `clearDepth`, then the followed car on layer 1 with `fpCam`, near 0.06).
- `quality.js`: `LEVELS` low / medium / high (pixel ratio range, antialias, shadow map size, scenery density, far, fog, envMap, tyre marks, anisotropy); `autoPick` after 5 s of driving; `adaptStep` lowers/raises pixel ratio once a second; `frameCapped` warns about a 30 fps cap.
- `carview.html`: standalone dev page with its own import map and `WebGLRenderer`. Workers (`livery-worker.js`, `terrain-worker.js`) do not use three.js.
- three r186 (`node_modules/three`) ships everything needed: `three.webgpu.js`, `RenderPipeline`, `TRAANode`, `TAAUNode`, `FSR1Node`, `SMAANode`, `FXAANode`, `GTAONode`, `SSRNode`, `BloomNode`, `MotionBlur`, `GodraysNode`, `LensflareNode`, `CSMShadowNode`, `SkyMesh`, `reversedDepthBuffer`. No new dependency.

## Decisions

| Topic | Decision |
|---|---|
| Renderer | `WebGPURenderer` from `three/webgpu`; automatic WebGL2 backend where WebGPU is missing. `await renderer.init()` before the loop starts |
| Import map | `index.html`: `three` and `three/webgpu` → `three.webgpu.js`, `three/tsl` → `three.tsl.js`, `three/addons/` unchanged. One three instance for game code and addons |
| `carview.html` | Unchanged (own import map, `WebGLRenderer`); it is a dev page |
| Depth | `reversedDepthBuffer: true`; main camera near 0.06 units (1 cm), far `Q.far` |
| Onboard views | One pass. `fpCam`, layer-1 swapping, `setLayered`/`ownWheels` layer moves and the background juggling are deleted; the followed car's own wheel meshes still stand in for the wheel batch in onboard views (visibility only) |
| Resolution | Render at an internal scale, upscale to the canvas: FSR1 on low/medium, TAAU on high/ultra. `adaptStep` keeps its rules and drives the internal scale instead of `setPixelRatio`; device pixel ratio cap stays per level |
| Sky (day) | `SkyMesh` replaces the gradient dome; sun direction from the theme's `elevation`/`azimuth`; `turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG` added per `SKIES` entry (clear, hazy, overcast, evening) |
| Sky (night) | Current dark gradient dome + stars + floodlight sun kept |
| Environment | Sky (day) or night dome rendered once per session into a PMREM → `scene.environment`. `RoomEnvironment` removed. Hemisphere light kept as a small fill (intensity scaled down per theme) |
| Fog | Kept, colour matched to the sky's horizon |
| Shadows | `CSMShadowNode` on the sun replaces the single box; `snapLight` (`quality.js`) and `shadowHalf` (`views.js`) have no other user, so they and their tests are deleted; CSM fits and stabilises its own cascades. Cascades and map size per level (table below). Blob shadow only on low |
| Car paint | Livery material → `MeshPhysicalMaterial` with clearcoat 1, clearcoat roughness 0.08, roughness 0.35. Rim metalness 0.9 roughness 0.3; tyre roughness 0.85 with sheen 0.2 |
| Asphalt | Roughness map (procedural canvas noise, generated once) on the road material |
| Tone mapping | `AgXToneMapping`; `toneMappingExposure` per sky entry (`exposure` field, default 1) |
| Sun glare | `LensflareNode` + `GodraysNode`, ultra only, day only |

## Post-processing chain

One `RenderPipeline`. The scene pass writes colour, depth, normals and velocity (MRT) when the level uses an effect that needs them.

1. GTAO from depth + normals (medium and up).
2. SSR from depth + normals + metalness/roughness (ultra).
3. Bloom (medium and up); threshold so only sun glints, floodlights, brake lights bloom.
4. Motion blur from velocity (high and up); the followed car's own pixels are excluded via velocity relative to the camera (it moves with the camera, so its velocity is ~0).
5. Anti-aliasing / upscaling: FXAA (low), SMAA (medium), TRAA or TAAU when the internal scale is below 1 (high, ultra).
6. Tone mapping (AgX) and output colour space; vignette on all levels except low; film grain on ultra.

Each node is created only when its level enables it; switching level rebuilds the pipeline.

## Quality levels (`quality.js` `LEVELS`)

| Level | Effects | Shadows (cascades × map) | Internal scale | Upscaler |
|---|---|---|---|---|
| low | FXAA | off (blob) | 0.5–1 | FSR1 |
| medium | GTAO, bloom, SMAA, vignette | 2 × 1024 | 0.6–1 | FSR1 |
| high | + TRAA, motion blur | 3 × 2048 | 0.75–1 | TAAU |
| ultra | + SSR, god rays, lens flare, film grain | 4 × 4096 | 1 | TAAU |

Existing fields (scenery, far, fog, tyreMarks, anisotropy) stay; ultra copies high's values for them. New fields per level: `cascades`, `scale` (start/min/max), `upscaler`, `effects` (list).

- `autoPick`: < 22 ms → low, < 11.8 ms → high (as now); new: < 7 ms on high → ultra. On the WebGL2 backend the picked level is one step lower.
- Graphics menu (`index.html` select read by `app.js`): adds "Ultra". Stored values (`lanrace.quality`, `lanrace.quality.auto`) stay valid.
- fps overlay text adds the backend: `… · high · webgpu`.

## Failure handling

- WebGPU unavailable or `requestAdapter` fails: WebGL2 backend (three does this); level one step lower.
- `device.lost`: rebuild the renderer and pipeline at one level lower, rebuild the world's materials; a banner says `GRAPHICS RESET — LOWERED TO <LEVEL>`.
- A post node throws while building: that effect is dropped from the chain, one `console.warn`, race continues.
- Shader warm-up: `compileAsync` with the existing 5 s cap; the grid countdown covers it.

## Testing

- Node (`node --test`): `LEVELS` has the new fields on every level; ultra is reachable from `autoPick`; the WebGL2 step-down; `adaptStep` returns an internal scale within the level's range. All existing tests (962) stay green.
- Headless Chrome from the CLI on port 3299 (never 3232), muted, killing only its own PIDs: screenshots of chase, T-cam and cockpit on each level, day and night, at Monza, Monaco and Spa; halo and wheel unclipped in the single pass; no console errors.
- fps per level on the M1 Pro logged before and after; low must not be slower than today's low.

## Out of scope

Blender car model and its animations, hero track art, weather and rain, wet-track reflections, time of day changing during a race, `carview.html` port.
