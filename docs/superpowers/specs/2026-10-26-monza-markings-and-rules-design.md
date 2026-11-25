# Monza: real 2026 markings and FIA rules

Status: design, approved in chat 2026-10-26 ("yes, go with those defaults").

## Why

The host wants Monza to look and race like the real circuit: the markings drivers see, and the FIA rules that judge them. Track limits were already fixed so they are judged per tyre against the white line, matching the TV verdicts the host saw.

## Already in the game (keep as is)

- White edge lines are the track edge, and a car is off only when all four tyres are past one (Game.checkLimits, per tyre).
- Kerbs: red/white, green/white/red at both chicanes, and the 2026 negative kerbs before T1 (L), T4 (R) and T8 (R).
- Bands: gravel strips behind the chicane kerbs, the Parabolica gravel strip and the tricolour painted run-off band at its exit.
- Corner cuts, meaning off on the inside of a bend: three warnings, then the black-and-white flag, then 5 s penalties.
- Going wide, or off on a straight: the lap is deleted.
- The pit lane is the surveyed OSM lane end to end, with its entry and exit lines (the lane's track-side white edge).

## Goals

Research source: `docs/superpowers/research/2026-10-17-track-surface/circuits-a.md` §1 and the FIA 2019 Race Director's notes.

1. **Pit entry gore:** a blue-painted area between the track edge and the pit entry road, from where the lane's track-side edge leaves the road edge up to the start of the pit wall. A yellow bollard stands at its tip, with SC1 across the entry road at that tip.
2. **SC2:** across the pit exit road where the exit line ends.
3. **T1–T2 escape road:** four rows of white polystyrene blocks, visual only.
4. **T4–T5 (Roggia):** black/yellow bumps before the T5 apex kerb, plus a yellow line and a yellow bollard in the run-off to the right of the T4 gravel.
5. **Rules:**
   - **Parabolica (T11):** off on the outside deletes that lap and the next lap.
   - **Pit entry:** any car whose centre enters the gore gets a 5 s penalty, once per lap.
   - **Pit exit:** a car leaving the pits that crosses the exit line onto the track before the line ends gets a 5 s penalty, once per exit.
   - Each penalty is announced as a SYSTEM chat line and a track_limits-style event, as the existing ones are.

## Non-goals

- Physical collision with blocks or bollards.
- Enforcing the Roggia rejoin route (using the escape road already deletes the lap as "wide").
- Other circuits. The data is per circuit (circuits.json / build hand file), so others can follow.

## Anti-goals

- A penalty for a car that never left the track or the lane.
- Markings that float, z-fight or cover the racing surface.
- Bots collecting the new penalties in normal racing (bot-race: penalties stay rare).

## Calls (mine)

- **Positions:** taken from the research and the built geometry. Gore and SC lines are derived from the pit lane, not hand-placed.
  - Blocks: 940 m R (hand file).
  - Bumps: 2150–2165 m R inside, before the T5 apex at 2171.
  - Roggia yellow line: run-off right of T4, 2110–2190 m, 12 m out.
  - Parabolica zone: 5100–5480 m, outside (L).
- **Gore colour:** blue (2026 FIA photo), not green (2019 notes).
- **Config:** the rules' zones go in circuits.json (`doubleDeleteM`), so other tracks can opt in.
- **Execution:** this doc doubles as the plan (user prefers fewer tokens). TDD per rule, with a visual check in the browser at the end.
