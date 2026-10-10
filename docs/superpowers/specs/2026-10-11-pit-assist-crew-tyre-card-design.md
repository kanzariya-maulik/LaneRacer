# LanRace Pit Assist, Real Pit Crew & Tyre Card — Design Spec

Date: 2026-10-11
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `2026-10-10-pit-lane-tyre-choice-design.md` (branch `feature/pit-lane-tyre-choice`, which this work starts from), `2026-10-09-tyres-pitstops-design.md`

## Goal

Pit stops that nobody can get wrong and everybody enjoys: the game drives the car from the pit entry into its box and out again, the stop happens with a real-looking 17-person crew, a TV pit camera and a one-button "perfect release" moment, and the tyre choice lives in its own simple card instead of inside the speed display.

## What changes from today

- Today the stop guide starts only if the driver brakes within 12 m of the box and can still stop there; otherwise the box is missed. Players overshoot and have to cross the box. → Replaced by full pit assist from the entry line.
- Today's crew is 7 capsule figures at your own box only; garages are flat painted fronts. → A proper crew at every stopping car's box (max 4 at once), recessed garages, pit-wall stands, wheel T-marks, a concrete working lane.
- Today's tyre picker is a chip row inside the speed/gear cluster that pops out. → A separate tyre card with a wear ring and three big buttons when it matters.

## Decisions

| Topic | Decision |
|---|---|
| Pit control | Full pit assist: from the pit entry the game drives to the box, parks, services, drives out; control returns at the end of the limiter zone (`pit.limEnd`) |
| Drive-through | A race car that has already stopped this lap is driven straight through to `limEnd` |
| Qualifying | Session start and after a stop the car waits on its mark; the first throttle press starts the assisted drive out |
| Release | Lollipop turns green at the end of service; throttle within 0.2 s = "PERFECT RELEASE", otherwise the car leaves by itself 0.5 s after green; throttle pressed during the last 1 s of service = "JUMPED" +0.5 s |
| Stop time | Measured from parked on the mark to leaving the box; shown big on the HUD and posted in chat |
| TV camera | While your car is in service/hold, a side camera at the garage side frames car and crew |
| Crew | 17 low-poly human figures in team overalls and helmets, at any car stopping (crew shown from pit entry to leaving the lane), max 4 crews |
| Garages | Recessed bays (back + side walls + roof), lit team-colour back wall, light floor, tyre stacks |
| Lane | Working lane in lighter concrete over the garage span; boxes keep team colour + code and get 4 white wheel T-marks; team pit-wall stands opposite each garage |
| Tyre UI | Separate card on the left; collapsed: tyre circle + wear ring + "NEXT: X (auto)"; open: three big buttons with one-line hints |

## 1. Pit assist (shared sim + server)

### Stop phases (`Game.updateStop`, server-authoritative; codes in the fast packet)
`p.stop = null | { phase, t, age }` with phases and packet codes:

| phase | code | what drives the car |
|---|---|---|
| `lane` | 4 | `pitAssist` — along the lane at up to the limiter speed, slowing to 15 km/h by 12 m before the box |
| `guide` | 1 | existing `guideToBox` — onto the mark (from the `lane` hand-over only) |
| `service` | 2 | parked; `t` counts down 2.5 + rng × 0.4 s (as today) |
| `hold` | 3 | parked; waits for release (≤ 0.5 s, plus unsafe-release hold as today, plus the jump penalty) |
| `out` | 5 | `pitAssist` — from the box along the lane to `pit.limEnd`, then `stop = null` |

Transitions:
- Entering the lane (`inPit` false → true, not finished): `lane` if a service is due (race: `servicedLap !== lap`; quali: `servicedVisit !== pitVisits`), else `out` (drive-through).
- `lane` → `guide` when the distance along the lane to the box ≤ 12 m (the guide already parks robustly from walking pace).
- `guide` → `service` when parked (as today). Guide timeout (6 s) → `out` without service (safety net; never strands the car).
- `service` → `hold` at `t ≤ 0`; tyres serviced (as today).
- `hold` → `out` (race) when released: throttle ≥ 0.5 pressed after green, or 0.5 s after green, plus unsafe-release hold and the jump penalty. Quali: `hold` → parked (`stop = null`, car on the mark) and the first throttle press starts `out`.
- `out` → `null` when `pitS ≥ pit.limEnd`; the driver has control.
- Driver inputs are ignored in every phase (the assist owns throttle, brake and steering).
- A quali car on its mark with `stop = null` and throttle ≥ 0.5 → `out`.

### `pitAssist(p, t)` (public/js/sim/drive.js, stateless, deterministic)
- Steering: pure pursuit to the lane centre line (`pit.path`) a speed-scaled distance ahead of `p.pitS` (at least 8 m), clamped to the car's lock; leaving the box it pursues the lane line, which pulls the car out of the box.
- Speed: target = limiter speed (`pit.limitKmh` or `PIT_LIMIT_KMH`); in `lane`, also the speed from which the car can slow to 15 km/h at 12 m before the box (`canStopOnMark`-style braking), and before `limStart` the speed from which it reaches the limiter at `limStart`. Throttle/brake proportional to the error.
- Only uses car state + track (`pit.path`, `pit.cum`, `limStart`, `limEnd`, box), so the client predictor reproduces it from the packet.

### Release & stop time (server)
- `hold` starts at the end of service: `p.stop.greenAt = time`. First throttle ≥ 0.5 after green → leave now; reaction ≤ 0.2 s → `release: 'perfect'`. No press → leave at 0.5 s (`release: 'auto'`). Throttle ≥ 0.5 during the last 1 s of service → `release: 'jumped'`, +0.5 s added to the hold.
- Stop time = time leaving `hold` − time entering `service`. Stored as `p.lastStop = { s, release }` (meta field) and posted in chat: `PIT: <name> 2.41 s (perfect release)`.

### Packet & predictor
- Stop codes extend to 4 (`lane`) and 5 (`out`); `predict.js` decodes `['', 'guide', 'service', 'hold', 'lane', 'out']`.
- `lastStop` joins `META_FIELDS`.

## 2. Pit lane, garages and crew (client)

All placement comes from `public/js/pitLayout.js` (pure, node-tested), extended with:
- `tMarks(box, scale)` → 4 wheel marks (±1.8 m along, ±0.8 m across the box centre);
- `crew17(box, scale, trackSide)` → 17 spots with roles (`gunFL…`, `offFL…`, `onFL…` ×4 wheels, `jackF`, `jackR`, `stabL`, `stabR`, `lollipop`), all outside a 2.2 m car corridor except the wheel men at the wheels, all inside the lane;
- `wallStands(t)` → one stand per garage on the pit wall opposite it (`pit.wall` polyline, nearest point to the garage's lane position), lane side of the wall;
- garage bay pieces (back wall, two side walls, roof, floor) per non-skipped garage, keeping today's footprint and skip rule.

Drawing (`game3d.js`):
- **Crew:** a low-poly human (legs, torso, arms, helmet; ≤ 200 triangles) merged into one geometry; one `InstancedMesh` per crew (team colour), max 4 crews; animated each frame from the car's stop phase: idle around the box during `lane`/`guide`; during `service` jacks lift the car body 0.08 m, off-men pull the old tyre 1 m out, on-men bring the new tyre (band in the new compound colour) in, gun men crouch; at `hold` jacks drop; at release crew steps back to the garage side. Crew of a car is shown from its pit entry until it leaves the lane.
- **Lollipop:** as today (red BRAKE face toward the arriving car, lowered in service, green GO at release) — now part of every crew.
- **Garages:** recessed bays (instanced pieces), lit team-colour back wall (unlit material), floor, 6 tyre stacks per garage (instanced short cylinders). Replaces the flat doorway/lit planes.
- **Lane:** working lane strip in light concrete (`#8a8f96`) over the garage span on the garage-side half; T-marks (one instanced mesh); pit-wall stands (instanced box + roof + screen strip).
- **TV pit camera:** while your car is in `service` or `hold`, the camera sits 9 m to the garage side of the box, 2 m up, looking at the car; it eases back to the chase camera during `out`.
- **HUD:** "PIT ASSIST" banner on entry; "PIT STOP 2.41 s" big readout at release with "PERFECT RELEASE −0.3 s" / "JUMPED +0.5 s"; "YOUR CAR" banner when control returns. The countdown (`YOUR BOX … m / BRAKE / MISSED`) is removed — the assist makes it unnecessary. The pulsing outline and BOX sign stay.
- Draw cost: crews only while cars stop; garages, marks and stands in ≤ 6 instanced meshes; frame rate within 10 % of today (browser check).

## 3. Tyre card (client)

- The S/M/H chips leave the speed/gear cluster and `#tyre-picker-big` is removed.
- New `#tyre-card` on the left edge (below the timing tower area, above the minimap if present; 16 px gutter):
  - **Collapsed:** a 44 px circle in the compound colour with its letter, a ring showing wear left (`72 %`, red below 20 %), and one line "NEXT: H" or "NEXT: H (auto)" (auto = no pick; the next harder compound).
  - **Open** (same `pickerOpen` rule as today: race grid, quali parked on the mark, race 500 m before the pit entry and in the lane until serviced): three full-width buttons, each ≥ 44 px tall: `1 SOFT — fastest · wears quickly`, `2 MEDIUM — balanced`, `3 HARD — slowest · lasts longest`. The chosen one lights in its colour; a line confirms "✓ MEDIUM ON NEXT STOP" or "✓ MEDIUM FITTED" (grid / quali garage).
  - Keys 1 / 2 / 3, click or tap; buttons don't keep focus; spectators see no card.
- Server rules unchanged (`setNextCompound`: fitted at once on the grid / parked in the quali box, else the next stop).

## Edge cases

- Car finished: no assist starts; a finished car mid-lane keeps its current phase until `out` ends.
- Disconnected car mid-stop: stays parked (as today).
- Unsafe release: as today, a moving car within 10 m behind the box holds `hold` (≤ 0.5 s).
- Two cars arriving at neighbouring boxes: collisions as today; the assist doesn't avoid other cars (pit lane speed is low).
- Track without pit data: no assist (as today, no pit).
- Penalties: the pit lane is exempt from track-limits checks as today.

## Testing

- Server/sim, every circuit: a car entering the pit lane at racing speed is driven, without any driver input, onto its mark (within the 0.6 m mark tolerance), serviced (2.5–2.95 s stationary), and handed back at `limEnd` on the lane, moving; total pit-lane time per circuit within ±0.5 s across repeated runs; drive-through on an already-serviced lap gets no service; quali start: throttle press drives out, no press stays parked; guide timeout falls back to `out`.
- Release: perfect (press 0.1 s after green → leaves then, `release: 'perfect'`), auto (no press → 0.5 s), jumped (press during service → +0.5 s); stop time recorded and posted.
- Predictor parity: `pitAssist` gives identical inputs on server and client copies (JSON round-trip test, as for the guide).
- `pitLayout` (node, every circuit): T-marks inside each box; crew17 spots inside the lane, outside the corridor except wheel men; one wall stand per non-skipped garage on the lane side of the wall; bay pieces off the boxes.
- Tyre card: `pickerOpen` unchanged tests; a small pure helper for the card text (`NEXT: H (auto)`, `✓ MEDIUM FITTED`) with a node test.
- Real game in a browser (visible tab): entry → assist → crew stop with TV camera → perfect release → control back; drive-through; quali garage; tyre card collapsed/open; frame rate.

## Out of scope

AI pit strategy, pit radio audio, unsafe-release penalties, damaged parts, refuelling, crew mistakes.
