# Race at the limit: bots that fight like F1 legends

Status: design, for review.

## Why

The host races Pro bots and wins from the front: P1 from lap 1, fastest in every sector, lapping some bots. P2, P3 and P4 never challenge. Bots don't overtake each other, don't fight back after being passed, and "just complete the lap". The user wants racing that feels like F1: bots that are as fast as the car allows, attack into braking zones, re-pass, defend, and race each other, so that winning against Pro is the hardest thing in the game.

## What was measured (2026-10-24)

A lone Pro bot already laps at the racing line's reference time (Monza 80.1 s vs lapS 80.2, Silverstone 89.3 vs 89.8). The line, not the bot, is the ceiling:

- A bot aiming at the line's speeds × k stays clean (no "wide", no time off track) up to about k = 1.08–1.10, and gains per lap: Monza 1.8 s, Silverstone 2.9 s, Monaco 2.1 s.
- The limit is per corner: Suzuka already runs wide at 1.10; Silverstone stays clean to 1.16. A flat multiplier can't be used.
- Bots lose 1.1–1.6 s a lap in braking zones (they brake early and in proportion to the speed error, not at the limit).
- Soft tyres have 6 % more grip (tyres.js), but bots only use tyre grip on straights; corners are capped at the line's speed.
- The racecraft only tries a move when clearly faster and close, abandons it if not alongside by the braking point, and rarely attacks back after being passed.

## Goals

1. **True corner limits.** Each track's racing-line speeds are the car's real limit, corner by corner, found by the game itself (a calibration pass that drives the line faster until the car runs wide, then backs off a safety margin).
2. **One set of speeds for everyone** (user's call). The bots, the racing line drawn on track (its colours and brake chevrons) and the braking help all use the calibrated limits, so the player's "brake here" marks move later along with the bots. "This is what makes F1 THE F1."
3. **Brake like a racing driver.** Full braking at the last moment that still makes the corner, trailing off into it, instead of early proportional braking.
4. **Use the grip that's there.** Bots corner faster on fresher and softer tyres and slower on worn ones, in corners, not only on straights.
5. **Real racecraft, at every level above Easy, strongest on Pro:**
   - Attack: a late dive into a braking zone when within reach, not only when clearly faster on the straight.
   - Switchback: when passed, line up the better exit and try to re-pass at the next corner or straight.
   - Defend: cover the inside before a braking zone once per straight (the existing one-move rule).
   - Bots race each other exactly as they race humans.
6. **Pro is the hardest thing in the game:** Pro bots drive at the calibrated limit (pace ≈ 1.0 of the new lapS) with near-zero mistakes. Hard, Medium and Easy keep their current spacing below Pro, relative to the new limit.

## Non-goals

- No new difficulty level; the four levels stay.
- No change to car physics, grip, tyres, or penalties.
- No change to how humans drive the car; only what the line and braking help show changes.
- Not a full minimum-time line optimiser: the line's shape stays; its speeds are what's calibrated.

## Anti-goals (a failure even if it technically works)

- Bots that crash into players or each other more: hard but fair. Leave a car's width when alongside, no moves into a car that's already committed to the apex, no punting from behind. Collision counts in the bot race simulations must not rise.
- Bots that win by cheating: no extra grip, power or downforce the player doesn't get. Same car, better driving.
- A drawn line or braking help that tells the player to brake where the car can't make the corner.
- Races that jam or never end (stuck bots, pile-ups): every bot race simulation must still finish with every car classified.
- A slow server: calibration must not run at game start or at track load during a session.

## Constraints

- The sim is shared: `public/js/sim/*` runs on the server and in the client predictor; the racing line and `lineLimit` are computed in `src/game/RacingLine.js` / `Track.js` and sent with the track.
- The existing bot test suites (botDriver, botStrategy, botSession, fairRacing), the pit tests and the golden drive trace must stay green (re-record the golden trace only if the line's speeds are part of it, and say so).
- Server tick budget: 22 bots under 4 ms a tick (botSession test).

## My calls (flag if wrong)

- **Calibration is offline.** A script (e.g. `scripts/calibrate-lines.mjs`) simulates each track and writes per-corner limits into the track data; tracks load them like any other data. Re-run it whenever a track's shape changes. A test checks every track has limits and that they're sane (above the old line speeds' floor, below the physics cap).
- **Safety margin:** the calibrated limit is the fastest clean speed minus a small margin (about 1–2 %), so a perfect bot on fresh tyres is right on it and a slightly worn tyre still makes the corner.
- **Calibrated on medium tyres, new.** Softs and wear scale the limit at run time by the tyre's grip (√grip on speed), for bots and the braking help alike.
- **Level spacing:** the current gaps are kept, measured from the new limit: Pro 1.0, Hard 1.005, Medium 1.035, Easy 1.085 of the new lapS. Aggression and mistakes as today, with Pro's racecraft at its most aggressive.
- **Pace spread:** Pro bots are spread only on the slow side (0 to +1 %), so the fastest Pro is exactly at the limit; other levels keep today's ±1.5 %.
- **Steering help:** bots always drive with full steering help, and steering lock fades with speed. Calibration runs twice, at full help and at none. The bots and the drawn line use the full-help limits. The braking help uses the limits for the player's own steering-help level, so "brake here" is never too late for their car. If the two calibrations differ by under 1 %, one set is kept.
- **Tyres on the drawn line:** the drawn line shows the limit on new mediums. The braking help scales the limit by the player's own tyre grip (√grip on speed), computed in the client.
- **Measure of success:** in a 22-car Pro race, bots' best laps within ~0.5 % of the new lapS, more overtakes between bots than today (counted in the sim), and collision and DNF counts no worse than today on Monza, Spa, Silverstone, Suzuka, Monaco and Interlagos, judged on the mean over 3 seeded races per track with 10 % tolerance. The host's own lap times weren't available: the final check is the host racing Pro bots and comparing sector times on the timing screen.

## Left to the builder

- The calibration method's details (how corners are segmented, step size, what counts as "ran wide").
- The braking model (how late, how much trail braking), as long as it's measured against the calibrated limits.
- The racecraft's mechanics and tuning, within the hard-but-fair rule.
- How overtakes are counted in the simulation harness.
