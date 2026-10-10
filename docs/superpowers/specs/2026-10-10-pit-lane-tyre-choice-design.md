# LanRace Tyre Choice & Real Pit Lane — Design Spec

Date: 2026-10-10
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `2026-10-09-tyres-pitstops-design.md`, `2026-10-09-driver-help-design.md` (branch `feature/driver-help`, which this work starts from)

## Goal

Players pick their tyres easily — in qualifying before each run, on the grid before the start, and before every pit stop — and the pit lane on all 14 maps looks like a real F1 pit lane, with an unmistakable "stop here" at their own box: a painted team box, a glowing outline, a distance countdown and a pit crew with a lollipop board.

## What exists today (and why it isn't enough)

- Start tyre: lobby "Start tyre" select. Next set: keys 1 / 2 / 3 any time in a session; the next stop fits it, otherwise the next harder compound. The only on-screen hint is a small "NEXT —" under the tyre chip, so players don't know the feature exists.
- Pit boxes: 6 × 2.6 m planes in team colour at 45 % opacity, two per garage, all alike; garages are plain dark blocks with a team sign; no marker for the player's own box and no distance cue. The stop guide starts when the driver brakes within 12 m before their box and can still stop on it.
- Every car's tyre band is the medium's yellow (fixed vertex colour in `carModel.js`).

## Decisions

| Topic | Decision |
|---|---|
| Tyre picker | Always-on S/M/H chip row in the HUD, popping out larger near the pit entry, parked in the garage in qualifying, and on the grid before the lights |
| Picking | Keys 1 / 2 / 3, or click / tap a chip |
| Immediate fit | On the grid before lights out (race) and parked in your box in qualifying: the pick fits a fresh set at once. Otherwise it sets the next stop's set |
| Pit lane look | Fast lane / working lane line, solid painted team boxes with car outline and team code, open-fronted garages with lit team-colour interiors, a canopy over the garage row, yellow garage-row edge line; all 14 maps, generated from pit data |
| Your box | Pulsing outline, tall "BOX" sign with your name, HUD countdown "YOUR BOX 120 m" → "BRAKE" → "MISSED — GO AROUND" |
| Pit crew | Only at your own box while you are in the pit lane: 4 wheel men, front and rear jack men, a lollipop man (red "BRAKE" board on arrival, lowered during service, green "GO" at release) |
| Tyre colours | Every car's tyre band shows its compound (S red, M yellow, H white) |

## 1. Tyre choice

### HUD
- The cluster's single tyre chip becomes a row of three chips `S M H`, each with its key number. The fitted compound has a ring and its wear bar under it (red past 80 %, as today); the chosen next set is filled. No choice yet: none filled.
- **Expanded state** — the same row, larger, near the screen centre-right with the line "BOX — CHOOSE TYRES · 1 / 2 / 3":
  - race: from 500 m before the pit entry (`pit.entryS`, along the track) until the car is serviced or leaves the pit lane;
  - qualifying: while the car is parked in its box (session start and after each stop) and not yet moving;
  - race grid: from `game_init` until lights out.
  It collapses back to the cluster row when none of those hold. Spectators see no picker.
- Click / tap on a chip = the same as its key. Keys 1 / 2 / 3 keep working everywhere in a session (as today).

### Server rule (`Game.setNextCompound`)
- If the session is a race and still frozen (lights on), or a qualifying car is parked in its box (no stop in progress and speed below 0.5 m/s): fit the set now — `compound = c`, `wear = 0`, `tyreGrip` recomputed, `compoundsUsed = { c }` (race grid) or `compoundsUsed.add(c)` (qualifying), `nextCompound = null`.
- Otherwise (driving): `nextCompound = c` (as today).
- Input is sanitised as today (`S | M | H` only). Meta diff carries `compound`, `nextCompound`, `compoundsUsed` already.
- The one-compound penalty counts compounds actually raced (grid changes replace the start set, they don't add to it).

## 2. Pit lane drawing (`game3d.js buildPit`, all 14 maps)

All geometry comes from `track.pit` (path, widthAt, garages, boxes, garageSpan, limiter). No per-map data. The layout (where every line, box, code, garage shell, canopy run and crew spot goes) is computed by a new pure module `public/js/pitLayout.js` (no three.js, no DOM), so it is unit-tested in node; `game3d.js buildPit` only turns that layout into meshes.

- **Lane split:** a solid white line (0.3 m) along the lane centre over the garage span (`garageSpan` ± one box), separating the fast lane (track side) from the working lane (garage side). Boxes already sit at the working-lane centre.
- **Garage-row edge:** a yellow line (0.3 m) along the garage-side lane edge over the garage span.
- **Team boxes:** each box a solid rectangle 7 × 3.4 m in the team colour (opaque, slightly darkened), a white car outline inside (thin quads), and the team's three-letter code painted in the 2 m gap just ahead of the box (atlas text, as the existing signs). Replaces the 45 % see-through planes.
- **Garages:** each garage's block keeps its footprint and placement (and is still skipped where it would stand on the track's run-off), but its lane-facing side gets a dark doorway and a back wall lit in the team colour (emissive, no real light). Team name board stays above the door. A white canopy (1.5 m deep, 0.2 m thick) runs along each garage front at door-top height, reaching from the garage front line toward the lane but never over the boxes (its lane-side edge stays at least 1 m farther from the lane centre than the boxes' garage-side edge).
- **Draw cost:** one instanced/merged mesh per kind (garage shells, interiors, canopy, box paint, outlines, codes); about +6 draw calls per track over today (split line, edge line, box paint, outlines, codes, doorways, lit interiors, canopy; the old see-through marks go). `pitLayout` returns at most a fixed number of kinds, each drawn as one mesh.

## 3. Your box, the countdown and the crew (client only)

The client knows its own box (`predictor.box`, from `game_init`) and its pit position (`p.pitS` from the predicted car).

- **Highlight:** while in the pit lane (and from 500 m before the entry in a race), a pulsing white outline around your box and a tall sign above it: "BOX" over your name, facing the arriving car.
- **Countdown (HUD):** "YOUR BOX 120 m" = distance along the pit path from the car to the box mark (`box.s − pitS`), updated each frame while in the lane and before your box.
  - Turns amber "BRAKE" when `Drive.canStopOnMark` (shared sim) says a stop is still possible and the distance is within the car's stopping distance + 3 m.
  - "MISSED — GO AROUND" (2 s) when the car passes its box at speed without a guide starting.
  - Hidden during a stop (the existing "BOX — 2.4 s" / "GO" takes over) and after leaving the lane.
- **Crew:** low-poly figures (capsule body, sphere head, team-colour overalls; about 60 triangles each), built once per session, shown only while you are in the pit lane:
  - 4 wheel men at the box corners with a wheel gun and a tyre, front and rear jack men, a lollipop man on the box's front edge with a round board on a pole.
  - Lollipop: red face "BRAKE" toward the arriving car; lowered while `stop.phase` is `guide`/`service`; raised green "GO" at release (`hold` → none), for 1 s.
  - During service the wheel men lean in; at release everyone steps back 0.5 m.
  - Hidden as soon as you leave the pit lane.
- **Tyre swap:** your car's tyre bands change to the new compound's colour when service ends (from the meta `compound`).

## 4. Tyre band colours (all cars)

The tyre geometry's band vertex colour becomes white and the batched wheel mesh (game3d.js wheel instancing) gets a per-instance colour from each car's `compound` (S `#e10600`, M `#ffd12e`, H `#f2f2f2`); the tread stays near-black because its vertex colour is near zero. Cars without a compound show M.

## Edge cases

- Reconnect mid-race: the picker state follows the meta (`compound`, `nextCompound`).
- Qualifying with `tyreWear` off: picking still changes compound (grip differs per compound, as today).
- A car disconnected mid-stop: no crew (crew is only for your own car).
- Pit lanes where garages were skipped (run-off): boxes, lines and the crew still draw; only that garage's shell is absent.
- Spectators: no picker, no countdown, no crew; painted boxes visible.

## Testing

- `Game.setNextCompound`: frozen race grid fits immediately and resets `compoundsUsed`; qualifying parked in box fits immediately; moving car sets `nextCompound` only; a stop in progress doesn't change the fitted set; invalid input ignored. Penalty still applies to a one-compound finisher who changed sets on the grid.
- `pitLayout` (node test, every circuit): lane line and edge line cover the garage span; one painted box and one code per box; boxes on the working-lane side and inside the lane edges; canopy pieces never over the boxes (lane-side edge ≥ boxes' garage-side edge + 1 m); crew spots around the player's box inside the lane; skipped garages (run-off) still get boxes.
- Countdown helper (pure function, client test): distance, "BRAKE" threshold and "MISSED" state from (pitS, box.s, speed, canStopOnMark).
- Real game in a browser (visible tab): Monza and Monaco — picker pops out near pit entry and in the quali garage; click a chip; drive in: countdown, BRAKE, crew and lollipop, stop, GO, tyre band colour changes; frame rate within 10 % of before.

## Out of scope

Crews at other teams' boxes, pit-crew animation beyond lean/step, unsafe-release visuals, pit radio audio, team strategy calls, changing how the stop guide drives.
