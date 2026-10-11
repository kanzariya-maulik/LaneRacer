# LanRace Fair Racing Rules — Design Spec

Date: 2026-10-11
Status: Approved in chat (sections 1–3), pending written-spec review
Builds on: `develop` at 34d6108 (tyres, driver help, pit lane, pit assist)
Part B of the "make it proper F1" request (A: assists and racing line — done; C: teaching — later)

## Goal

Races stay competitive and F1-like, but the start is not a lottery, penalties feel fair and understandable instead of punishing, and nobody quits angry. Coworkers new to F1 currently dive into turn 1 together, collect and hand out penalties, and fear track limits.

## What exists today

- Contact (race, collisions on): `Game.noteContact` blames by each car's speed into the other (striker ≥ 2× the other's, `CONTACT_BLAME`); `judgeIncidents` watches the victim 2 s: +5 s, or +10 s if pushed off / spun; equal blame = "racing incident" (chat only). Host switches: `collisions`, `contactPenalties`.
- Track limits (race): all four wheels past the white line, once per excursion: 2 warnings, then +5 s each (`LIMIT_WARNINGS 2`, `LIMIT_PENALTY_S 5`). Pushed-off victims and the pit lane are exempt. Quali: lap deleted.
- Jump start: +10 s.
- Feedback: `track_limits` socket events → one-line banner (`socket.js`), red SYSTEM chat lines; the timing tower already shows each car's penalty (`tt-tag pen`).
- Ghost: the fast packet has a per-car `ghost` flag (bit 64), today set for all cars in quali or with collisions off; the client already draws ghost cars at 50 % opacity per car.

## Decisions

| Topic | Decision |
|---|---|
| Start | Ghost start: every car is a ghost from lights out until past the sector 1 line on lap 1 (cap 25 s) and not overlapping any car |
| Rest of lap 1 | Lenient: only clear rear-end hits (striker ≥ 3× the other's speed into contact) are penalised |
| Host switch | Lobby setting "Start: ghost first corners", default on |
| Track limits | Inside of a corner (cut) = strike; outside (wide) or on a straight = no strike, lap not counted for fastest lap |
| Strikes | 3 warnings, 4th = black-and-white flag, 5th and later = +5 s each |
| Contact after lap 1 | Unchanged (+5 / +10 / racing incident) |
| Explanation | Steward card on the HUD (own car, 4 s): headline, reason, one tip — for every penalty, warning, incident and hit |

## 1. Ghost start and lenient lap 1 (server)

- `p.ghost` per car (race only, setting `ghostStart !== false`): set `true` for every car at session start.
- Each tick, a ghost car becomes solid when `p.lap ≥ 1`, it has passed the end of sector 1 on lap 1 (the `track.sectorCps[1]` checkpoint) **or** `time ≥ GHOST_MAX_S` (25 s after lights out), **and** `Physics.carOverlap` with every other car is false. A car that is still overlapping stays a ghost until clear.
- Car-car contact (`Game.update` pair loop): skip the pair when either car is a ghost.
- Packet ghost bit: `quali || collisions === false || p.ghost`.
- Lenient window: from lights out until the car completes lap 1 (`p.lap ≥ 1` or finished), `noteContact` uses `CONTACT_BLAME_LAP1 = 3` instead of 2. Victim/off/+10 rules unchanged. `p.lap` counts completed laps, so the first lap is `p.lap === 0`.
- Jump start, DNF and finish rules unchanged. Collisions off: no change (everyone already ghost).

## 2. Track limits: cut vs wide (server)

- When a race car's four wheels go past the line (`checkLimits`, same once-per-excursion rule), classify by the bend direction at that point: signed curvature of the track path over ±25 m around `near.i`. If |curvature| < `STRAIGHT_K` (radius > 400 m) → wide. Else inside = the car is on the side the track bends toward → **cut**; the other side → **wide**.
- Cut: `p.limits++`; 1–3 → warning; 4 → black-and-white flag (warning, no time); ≥ 5 → +5 s each.
- Wide: no strike; race `p.lapValid = false` for this lap (fastest lap / best sectors ignore it, as today's flag does); event `kind: 'wide'`.
- Pushed-off victim, pit lane, rejoining from the pit exit: exempt as today. Quali: unchanged (lap deleted on either side).

## 3. Steward card (client) and events (server)

- `track_limits` events gain kinds and fields: `warning {count, of: 3}`, `flag` (black and white), `penalty {add, penalty}`, `wide`, `collision {add, penalty, victim, off}`, `hit {by, add}`, `incident {with}` (sent to both drivers — today only chat), `jump {penalty}`, `deleted`.
- New `#steward-card` (HUD, top centre under the lights, 4 s, own car only, replaces the one-line banner for these events):

| Event | Headline | Tip |
|---|---|---|
| collision | `+5 s · You hit RAHUL from behind` / `+10 s · You pushed RAHUL off` | "Brake earlier when following — leave a car's length" / "Leave a car's width on corner exits" |
| hit | `Hit by RAHUL · +5 s to RAHUL` | "Not your fault — no penalty for you" |
| incident | `Racing incident · no penalty` | "Contact with RAHUL — both moved" |
| warning | `Corner cut · warning 2/3` | "Keep two wheels inside the white line" |
| flag | `Black & white flag` | "Next corner cut = +5 s" |
| penalty | `+5 s · Corner cut` | "Keep two wheels inside the white line" |
| wide | `Wide · lap time not counted` (grey) | — |
| jump | `Jump start · +10 s` | "Wait for all five lights to go out" |
| deleted (quali) | `Lap deleted · track limits` | "Keep two wheels inside the white line" |

- Ghost tag: a small `GHOST — FIRST CORNERS` chip on your HUD while your car is a ghost (from the packet bit).
- Chat lines stay as the record. Tower penalty tag already exists — unchanged.
- Card text helper is a pure function (`stewardText(event, meName)`) in a client module, node-tested.

## Edge cases

- A ghost car overlapping another at the window end stays ghost; if two cars stay overlapped (side by side for long), they stay ghost until apart — no forced pop.
- Late joiner/spectator: sees ghost cars translucent; no card.
- Ghost start off: lenient lap-1 blame still applies (it's about judging, not physics).
- Collisions off or contact penalties off: no collision/incident cards (as today no penalties); track-limits cards still show.
- Chicanes: each bend is judged on its own curvature, so cutting a chicane is a cut.

## Testing

- Ghost: on a race start, no contact resolves between cars until both are solid; a car turns solid after sector 1 when clear; overlapping cars stay ghost until clear; 25 s cap; setting off = solid from the start; packet ghost bit per car.
- Lap-1 blame: a 2.5× side swipe on lap 1 = racing incident, same on lap 2 = +5 s; a clear rear-end on lap 1 = +5 s.
- Cut vs wide: on every circuit, a car placed past the line on the inside of a tight corner = cut (strike), outside = wide (no strike, lapValid false), on a long straight = wide.
- Strike ladder: warnings 1–3, flag at 4, +5 s at 5 and 6.
- Events: incident sent to both drivers; `stewardText` for every kind.
- Real game in a browser: start with a few cars (ghost through T1, solid after), steward cards readable at desktop and phone width.

## Out of scope

Replays, steward review/appeals, give-the-place-back rule, damage, blue flags, safety car, AI drivers, teaching overlays (Part C).
