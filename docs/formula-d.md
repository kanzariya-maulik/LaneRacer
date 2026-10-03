# 🏎️ Formula-D & Hybrid Sports/NASCAR Drift Expansion
**Comprehensive Engineering Architecture & Game Design Specification**

---

## 1. Vision & Concept Overview

**Formula-D** is a high-octane, competitive multiplayer mode in LaneRacer that bridges the gap between precision Formula Drift sliding, heavy V8 NASCAR-style drafting, and high-downforce GT Sports car racing. 

While the existing **F1 Mode** emphasizes maximum cornering speed, precise braking points, and aerodynamic downforce, **Formula-D Mode** introduces:
* **Dynamic Slip Dynamics**: Deep drift angles ($25^\circ - 65^\circ$), weight-transfer flicks, and counter-steer control.
* **Diverse Vehicle Classes**: Drift Tuners, V8 Muscle Stock Cars, and GT3 Supercars.
* **Drafting & Slingshot Physics**: High-speed pack racing dynamics with aggressive slipstream suction.
* **Real-time Drift Scoring & Tandem Battles**: Angle, speed, clipping point proximity, and tandem chase scoring.
* **Side-by-Side Parallel Architecture**: Zero changes or regressions to existing F1 code. The lobby host toggles between `f1` and `formula-d` modes seamlessly.

---

## 2. Vehicle Classes & Physics Profiles

The Formula-D system introduces three distinct vehicle classes, each with specialized physics characteristics and handling feels:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FORMULA-D VEHICLE CLASSES                                  │
├─────────────────────┬───────────────────────┬───────────────────────┬───────────────────────┤
│ Vehicle Class       │ Primary Attribute     │ Handling Feel         │ Key Signature Feature │
├─────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┤
│ 1. Formula-D Tuner  │ Extreme Drift Angle   │ Snappy, High Steering │ Angle Lock & Handbrake│
│                     │ (1000 HP Rear-Drive)  │ Lock, Feather Throttle│ Smoke Effects         │
├─────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┤
│ 2. NASCAR Stock Car │ Heavy Inertia & Torque│ Heavy Weight, High    │ Massive Slingshot     │
│                     │ (750 HP V8 Muscle)    │ Top Speed, Oversteer  │ Drafting Vacuum       │
├─────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┤
│ 3. GT3 Supercar     │ Grip-to-Drift Balance │ Balanced Downforce,   │ Controlled Powerslide │
│                     │ (600 HP AWD / RWD)    │ High Braking Grip     │ Out of Apexes         │
└─────────────────────┴───────────────────────┴───────────────────────┴───────────────────────┘
```

### Class Specifications:

#### 1. Formula-D Drift Tuner (e.g. Nissan Silvia S15 / Mustang RTR / Supra Spec)
* **Steering Lock**: $55^\circ - 65^\circ$ maximum front wheel angle (modified steering rack).
* **Power & Weight**: 1,000 HP, 1,200 kg.
* **Tire Model**: Wide rear tire contact patch with aggressive friction roll-off past peak slip angle.
* **Special Action**: Handbrake / E-Brake key (`Space` or Gamepad `B`) instantly locks rear wheels to break traction into entry.

#### 2. V8 Muscle Stock Car (NASCAR Style)
* **Steering Lock**: $35^\circ - 40^\circ$.
* **Power & Weight**: 750 HP V8 Naturally Aspirated, 1,550 kg (high rotational inertia).
* **Drafting Coefficient**: $2.5\times$ standard slipstream drag reduction. Creating a vacuum tunnel behind lead cars gives trailing cars a $+15-25 \text{ km/h}$ slingshot boost.
* **Sound Profile**: Deep, low-rumble American V8 cross-plane engine sound profile.

#### 3. GT3 Sports Supercar
* **Steering Lock**: $38^\circ - 42^\circ$.
* **Power & Weight**: 620 HP Twin-Turbo V8, 1,350 kg.
* **Downforce Balance**: Adjustable front/rear aerodynamic wings giving high-speed corner stability while allowing power-oversteer out of slow turns.

---

## 3. Realistic Drift & Vehicle Dynamics Physics Model

To make drifting feel tactile, rewarding, and realistic, Formula-D expands vehicle simulation using a modified **Pacejka Non-Linear Friction & Weight Transfer Model**.

```
                           FRONT OF CAR
                                ▲
                                │  Heading Vector
                                │ /
                                │/   β (Slip Angle)
               Velocity Vector  ├───┐
                       ▲        │   │
                        \       │   │
                         \      │   │
                          \     └───┘
                           \    /
                            \  /  Rear Tire Slide (Friction Drop)
                             \/
```

### Key Physics Components:

1. **Non-Linear Pacejka Tire Slip Curve**:
   * Peak lateral grip is reached at a low slip angle ($\alpha \approx 6^\circ - 10^\circ$).
   * Past peak slip, grip smoothly decays into sliding friction ($F_y$) rather than dropping off a cliff, allowing players to sustain controllable drift angles between $25^\circ$ and $60^\circ$ using precise throttle modulation.

2. **Longitudinal & Lateral Weight Transfer ($F_z$)**:
   $$\Delta F_{z,\text{long}} = \frac{m \cdot a_x \cdot h}{L}, \quad \Delta F_{z,\text{lat}} = \frac{m \cdot a_y \cdot h}{W}$$
   * Feint turns (Scandinavian Flick) shift weight to the outside front wheel, unloading the rear inner tire to initiate slides dynamically without handbrake usage.

3. **Self-Centering Steering & Counter-Steer Assistance**:
   * **Physics Feedback**: The front wheels align naturally with the velocity vector when sliding.
   * **Drift Assist Option**: Adjustable counter-steer assist for casual keyboard/gamepad players, while steering wheel / pro gamepad players can disable assist for full manual counter-steering precision.

4. **Initiation Mechanics**:
   * **Power-Oversteer**: Dumping throttle in 2nd/3rd gear overpowers rear tire traction.
   * **E-Brake / Handbrake Lock**: Instantly drops rear tire longitudinal and lateral grip coefficient to $\mu_{\text{slide}} = 0.25$.
   * **Clutch Kick**: A rapid drop in transmission coupling spikes engine torque to break rear traction during mid-corner bogging.

---

## 4. Competitive Drift Scoring & Race Modes

Formula-D introduces two distinct game sub-modes configurable in the lobby:

### Sub-Mode A: Drift Battle & Tandem Battles
Players score points continuously through corners based on four telemetry factors evaluated at 60 Hz:

$$\text{Drift Score} = \int \left( S_{\text{angle}} \cdot S_{\text{speed}} \cdot S_{\text{line}} \cdot S_{\text{smoothness}} \right) dt$$

1. **Angle Score ($S_{\text{angle}}$)**: Rewards higher slip angles ($\beta = 20^\circ \to 55^\circ$). Exceeding $70^\circ$ results in a spinout ($0$ points).
2. **Speed Score ($S_{\text{speed}}$)**: Multiplies score proportionally to entry and cornering velocity ($v$).
3. **Line & Clipping Zone Score ($S_{\text{line}}$)**: Proximity sensors along inner apex clipping points and outer wall zones grant score multipliers ($1.0\times \to 2.5\times$).
4. **Tandem Proximity Bonus**: In Tandem battles, the **Chase Car** receives multiplier bonuses for sliding within 1 to 3 metres of the **Lead Car** without making collision contact.

### Sub-Mode B: Formula-D Circuit Race (Gymkhana / NASCAR Hybrid)
* Grid race combining drift scoring points into lap-time subtractions or bonus energy boosts.
* Slingshot drafting zones enable high-speed overtakes on straights after sideways corner entries.

---

## 5. Non-Invasive Parallel Architecture Plan

To ensure that existing F1 mode remains **100% untouched and unrisked**, Formula-D is designed as a modular, parallel subsystem alongside F1:

```
                               ┌─────────────────────────┐
                               │   Lobby / Room State    │
                               │  settings.mode = 'f1'   │
                               │   or 'formula-d'        │
                               └────────────┬────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
      ┌───────────────────────────┐                   ┌───────────────────────────┐
      │   F1 Engine Pipeline      │                   │ Formula-D Engine Pipeline │
      │  (Existing, Untouched)    │                   │   (New Parallel Modules)  │
      ├───────────────────────────┤                   ├───────────────────────────┤
      │ • CarPhysics.js           │                   │ • DriftCarPhysics.js      │
      │ • drive.js                │                   │ • driftdrive.js           │
      │ • car.glb (F1 Mesh)       │                   │ • sports_car.glb / stock  │
      │ • v8-worklet.js (F1 V8)   │                   │ • muscle_v8-worklet.js    │
      │ • F1 Timing & Sector HUD  │                   │ • Drift HUD & Score Meter │
      └───────────────────────────┘                   └───────────────────────────┘
```

### Architectural Safeguards:

1. **Polymorphic Vehicle Physics Interface**:
   * The server [Game.js](file:///D:/LaneRacer/src/game/Game.js) checks `this.mode`:
     - If `mode === 'race'` or `'quali'` -> Loads `CarPhysics.js` & `drive.js`.
     - If `mode === 'formula-d'` -> Loads `DriftCarPhysics.js` & `driftdrive.js`.

2. **Isolated Asset Pipelines**:
   * **F1 Model**: `public/models/car.glb` (F1 monocoque & open wheels).
   * **Formula-D Models**: `public/models/sports_car.glb`, `public/models/stock_car.glb` generated cleanly via standalone scripts (`scripts/build-sports-car.py`).

3. **Isolated Sound Profiles**:
   * F1 18,000 RPM NA V8 engine sound synthesis remains intact in `v8-worklet.js`.
   - Formula-D uses a separate `muscle-worklet.js` (deep cross-plane V8, turbo blow-off valve pop SFX, and prolonged tire screeching audio synthesis).

4. **UI & HUD Overlay Switching**:
   * In [public/index.html](file:///D:/LaneRacer/public/index.html), a modular `#drift-hud` overlay (showing drift angle gauge, multiplier meter, and clipping zone indicators) activates only when `clientState.settings.mode === 'formula-d'`.

---

## 6. Implementation Roadmap (Post-UI & Feature Completion Phase)

| Phase | Module / Task | Description | Risk Level |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Lobby Mode Selector UI | Add mode switch (`F1 Championship` vs `Formula-D Drift`) in lobby settings | Low |
| **Phase 2** | `driftdrive.js` & `DriftCarPhysics.js` | Implement Pacejka slip curve, weight transfer, and handbrake initiation | Zero (Isolated File) |
| **Phase 3** | Sports Car 3D Mesh Generator | Create `scripts/build-sports-car.py` for Blender procedural GT/Stock car | Zero (Isolated Asset) |
| **Phase 4** | Drift Scoring Engine | Real-time 60 Hz angle, speed, and clipping point calculation in `DriftScorer.js` | Zero (Isolated File) |
| **Phase 5** | Tire Smoke Shader & Audio | Particle smoke intensity shader in `game3d.js` + muscle engine worklet | Low |

---

*This document serves as the official design blueprint for Formula-D Mode. It guarantees complete independence from F1 Mode so that core game stability is fully preserved.*
