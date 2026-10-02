# LanRace Sound — Design Spec

Date: 2026-10-02
Status: Approved in chat (sound source, scope, parts 1–2); pending written-spec review
Branch: `develop`

## Goal

LanRace has no sound today. Add the sound of a 2006–2013 F1 car:
- your own car's 2.4 L V8, following RPM and throttle;
- the other cars around you, heard in 3D;
- start-light beeps.

Everything is synthesised in the browser. A recording slot lets licensed recordings replace any synthesised sound later, without code changes.

**Out of scope:**
- crowd and ambience;
- chimes for fastest lap or purple sectors;
- tyre squeal, kerb rumble, impacts and other contact sounds (a later version);
- any change to physics, netcode or the server.

## Reference facts

- **Engine:** 2006–2013 cars used a 2.4 L 90° V8, rev-limited to 18,000 RPM, with about 720–750 hp. They had 7-speed seamless-shift gearboxes.
- **Firing frequency:** four-stroke, so 4 firings per revolution. That gives a fundamental of RPM/60 × 4: 1,200 Hz at 18,000 RPM and 300 Hz at 4,500 RPM.
- **Start lights:** the real red lights make no sound. Beeps per light are a convention of F1 games, used here as agreed.

## 1. What you hear

### Gearbox model (client-side, cosmetic)

**Gearing.** 7 gears, each reaching 18,000 RPM at:

| Gear | Speed at 18,000 RPM |
|---|---|
| 1 | 130 km/h |
| 2 | 168 km/h |
| 3 | 205 km/h |
| 4 | 248 km/h |
| 5 | 292 km/h |
| 6 | 335 km/h |
| 7 | 375 km/h |

7th covers top speed with DRS and slipstream, so a normal lap never hits the limiter.

**RPM.** `rpm = speed × 18000 / gearTop[g]`, floored at 4,500 (idle).

**Launch.** At standstill or crawling in 1st, holding throttle raises RPM toward a launch speed of 11,000 RPM (grid revving).

**Shifting.**
- **Upshift** at 17,800 RPM while accelerating.
- **Downshift** when the next lower gear would sit below 16,000 RPM and the car is braking or coasting, one gear at a time with at least 0.12 s between shifts.
- **Shift events** are reported: `up`, `down`, `limiter` (at 18,000 RPM with throttle) and `pitLimiter` (pit-lane limiter on).

**Throttle for other cars.** They don't send throttle, so it's estimated from acceleration: more than +2 m/s² counts as throttle; braking or less than −3 m/s² counts as off-throttle.

### Your car

- **V8 voice:** RPM and load (throttle) drive it continuously.
- **Upshift:** about 25 ms ignition cut plus a short bark.
- **Downshift:** about 60 ms throttle blip, and a crackle burst.
- **Off-throttle above 8,000 RPM:** random pops and crackles, about 6–12 per second, fading with RPM.
- **Rev limiter:** cuts at about 30 Hz, bouncing the RPM.
- **Pit-lane limiter:** a distinctive stutter: about 12 Hz cut at roughly 9,000 RPM.
- **DRS:** a mechanical clunk when the flap opens and when it closes.
- **Wind:** filtered noise, gain ∝ (speed/90 m/s)², with a cutoff that rises with speed.

### Other cars

- **Voices:** the 4 nearest other cars to the camera get a V8 voice each, inside 300 m. Voices are re-assigned at 4 Hz with hysteresis, so a voice isn't handed back and forth between two cars at nearly the same distance.
- **3D placement:**
  - Each voice is an `HRTF` `PannerNode` at the car's position, with inverse distance roll-off (ref 15 m, rolloff 1).
  - Doppler is applied manually: pitch is multiplied by `c/(c + v_radial)`, with c = 343 m/s and clamped to 0.8–1.25.
  - The listener follows the camera.
- **Ghost cars** (quali, or collisions off) are still heard.
- **Spectators** hear all cars this way, with no "own car" voice.

### Start

- **Each red light:** a 1 kHz beep, 120 ms.
- **Lights out:** a 1.6 kHz tone, 300 ms.
- **Grid revving** comes from the launch-RPM behaviour above, for your car and the cars near you.

### HUD: gear and shift lights

**Gear number.** A large gear number sits above the speed display.

**Shift lights.** A row of 15 lights, like an F1 steering wheel:
- **lights 1–5, green:** light from 13,000 RPM;
- **lights 6–10, red:** up to 16,500 RPM;
- **lights 11–15, blue:** up to 17,800 RPM;
- **all 15 flash:** on the rev limiter.

The HUD follows your car only; spectators see the car they're following.

### Controls

**Lobby, saved in `localStorage`:**
- master volume slider, 0–100%, default 70%;
- "Engine sound: All cars / Mine only / Off".

**In game:** **M** toggles mute, with a banner.

**Unlock:** the audio context is created on the first user gesture (Join click or a keypress), as browsers require.

**Suspend:** audio is suspended while muted or while the tab is hidden.

## 2. Architecture

New files in `public/js/audio/`:

| File | Role |
|---|---|
| `gearbox.js` | Pure. `new Gearbox()`, `.update(speedMs, throttle, dt) → { gear, rpm, events: [] }`, `shiftLights(rpm) → { lit: 0..15, flash }`. Unit-tested in Node. |
| `v8.js` | Pure DSP. `V8Synth(sampleRate)` with `.render(out, n, { rpm, load, cut })`. Writes `n` mono samples: a per-cylinder combustion pulse train in a flat-plane firing order (even 90° intervals). Pulse sharpness and amplitude grow with load. The signal goes through two exhaust resonators (comb at the primary length plus a biquad band near 2×firing) and soft-clip saturation. `cut` gives silence (ignition cut) with a small residual. No allocation in `render`. Unit-tested in Node. |
| `v8-worklet.js` | `AudioWorkletProcessor` `'v8'` wrapping `V8Synth`. Takes `rpm`, `load` and `cut` as k-rate `AudioParam`s, smoothed per block. |
| `sfx.js` | Synthesised one-shots: beep, lights-out tone, DRS clunk (filtered noise burst plus a low thump), crackle and pop (short noise bursts through a band-pass), shift bark. Also the looped wind. All built on shared buffers. |
| `audio.js` | Owns the `AudioContext`. Handles: master gain, mute, volume, unlock, suspend on hide; the own-car voice; the 4-voice pool for other cars (allocation, panners, Doppler, listener); event → sfx dispatch; the recording slot. Public API: `Audio.init()`, `Audio.update(frame)`, `Audio.event(name, data)`, `Audio.setVolume(v)`, `Audio.setMode(m)`, `Audio.toggleMute()`. |
| `voices.js` | Pure. `pickVoices(cars, listener, current, n=4, maxDist, hysteresis) → ids`. Unit-tested. |

### Recording slot

On init, `audio.js` fetches `public/sounds/manifest.json`. A missing file means "synth only".

Manifest entries:
- `engine_onboard` / `engine_external`: `[{ rpm, file }]` loops. Played with an RPM-crossfade voice: the two loops nearest the current RPM, each with `playbackRate = rpm / loopRpm`.
- One-shots by name, e.g. `beep`, `lights_out`, `drs`, `crackle`, `shift_up`.

A file that fails to load or decode logs `console.warn` and keeps the synth. An empty `public/sounds/manifest.json` (`{}`) ships, with a README note on the format.

### Data flow per frame (in `game3d.js`)

- **Your car:**
  - input throttle and brake come from the predictor's latest input;
  - speed comes from the predicted car;
  - `inPit`, `limiter` and `drs` come from flags.

  These pass to `gearbox.update`, which yields `{ gear, rpm, events }` for the HUD and audio.
- **Other cars:** their poses from `applyNet` feed one gearbox per car (kept in a `Map`) for the voiced cars only.
- **Events:**
  - `lights` (count 1–5 beeps; 0 is lights out), from the existing handler;
  - DRS open and close, from your flag changes;
  - shift, limiter and crackle events, from the gearbox.
- **Throttling:** `Audio.update` runs at frame rate. Per-frame work allocates nothing, and voice allocation runs at 4 Hz.

### Failure handling

- **No `AudioWorklet`:** fall back to a simple oscillator voice (saw at the firing frequency plus a square at half, through a low-pass). The game works the same.
- **Audio context creation fails:** the game runs silent; the HUD gear and shift lights still work.
- **CPU budget:** at most 5 V8 voices (yours plus 4). The worklet must render a 128-sample block for 5 voices in under 0.5 ms on this Mac (measured headless).

## Testing

**Node:**
- **gearbox:**
  - upshift points;
  - never above 18,000 RPM in steady driving;
  - downshift sequence while braking from 300 to 80 km/h, with each RPM after a shift ≤ 17,800;
  - launch RPM;
  - pit-limiter event;
  - shift-light thresholds and limiter flash.
- **v8:**
  - dominant spectral peak within ±5% of RPM/60 × 4 at 6k, 12k and 18k RPM (DFT over 0.2 s);
  - output stays in [−1, 1];
  - `cut = 1` gives RMS below 10% of uncut;
  - no NaN after an RPM step change.
- **voices:** nearest-N, max distance, hysteresis keeps the current set when distances differ by less than 10%.

**Headless browser:**
- audio initialises after a simulated gesture, with no console errors;
- the worklet loads;
- voice count is ≤ 5 with 7 cars;
- render-block timing is within budget;
- the HUD gear and shift lights update while driving;
- M mutes.

## Global constraints

- No new npm dependencies; Web Audio only.
- No server or netcode changes.
- Commits on `develop`, no trailers.
- Never commit `refs/`, `image*.png` or `scripts/__pycache__/*.pyc`.
- Don't touch port 3232; use 3333 for headless runs.
