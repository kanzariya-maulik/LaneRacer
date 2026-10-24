---
name: LAN Race
description: The lobby as an F1 / Forza game menu, played straight; the real car on a studio turntable is the screen, menus float over it.
colors:
  studio-black: "#06080b"
  team: "#64748b"
  f1-red: "#e10600"
  f1-red-hover: "#f5150e"
  ready-green: "#19c37d"
  host-amber: "#ffb21f"
  text: "#f4f5f7"
  muted: "#a3acb7"
  dim: "#7d8691"
  ink-on-white: "#0a0c10"
  line: "rgba(255, 255, 255, 0.09)"
  line-strong: "rgba(255, 255, 255, 0.18)"
  panel: "rgba(9, 11, 15, 0.74)"
  field: "rgba(255, 255, 255, 0.06)"
  # Exact values the lobby uses beyond the core palette: scrims over the 3D studio, plate fills, white strokes and hovers,
  # glows and one-off states (all from public/css/lobby.css)
  mask-black: "#000"
  brand-cut: "#05070a"
  option-bg: "#14171c"
  chat-text: "#dfe3e8"
  spectating-violet: "#b794f6"
  kick-red: "#ff6b6b"
  kick-red-wash: "rgba(255, 107, 107, 0.12)"
  ready-green-wash: "rgba(25, 195, 125, 0.12)"
  f1-red-glow: "rgba(225, 6, 0, 0.35)"
  f1-red-glow-strong: "rgba(225, 6, 0, 0.5)"
  shadow-soft: "rgba(0, 0, 0, 0.35)"
  shadow-mid: "rgba(0, 0, 0, 0.45)"
  shadow-text: "rgba(0, 0, 0, 0.5)"
  scrim-0: "rgba(3, 4, 6, 0)"
  scrim-55: "rgba(3, 4, 6, 0.55)"
  scrim-60: "rgba(3, 4, 6, 0.6)"
  scrim-70: "rgba(3, 4, 6, 0.7)"
  scrim-72: "rgba(3, 4, 6, 0.72)"
  scrim-85: "rgba(3, 4, 6, 0.85)"
  plate-55: "rgba(9, 11, 15, 0.55)"
  plate-62: "rgba(9, 11, 15, 0.62)"
  plate-70: "rgba(9, 11, 15, 0.7)"
  plate-86: "rgba(9, 11, 15, 0.86)"
  white-08: "rgba(255, 255, 255, 0.08)"
  white-12: "rgba(255, 255, 255, 0.12)"
  white-16: "rgba(255, 255, 255, 0.16)"
  white-32: "rgba(255, 255, 255, 0.32)"
  white-55: "rgba(255, 255, 255, 0.55)"
typography:
  display:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 4.6vw, 4.8rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 3.4rem)"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 112"
  title:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 2.4vw, 2.3rem)"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 110"
  body:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.35
  button:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 110"
  label:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.16em"
  heading-label:
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    letterSpacing: "0.22em"
  display-compact:
    # garage title on screens under 820 px tall
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 4.2vw, 4.2rem)"
    fontWeight: 800
  display-long:
    # garage title for team names over 16 characters
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.4vw, 3.6rem)"
    fontWeight: 800
  brand:
    # LAN RACE wordmark
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 800
  button-xl:
    # Start race / Ready up
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
  input-lg:
    # driver name field
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 600
  button-lg:
    # Join
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 700
  body-control:
    # chat text, host settings controls
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 500
  body-sm:
    # drawer rows, grid driver names
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 600
  body-xs:
    # empty chat note
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 500
  label-md:
    # step pills, team subline, segmented buttons
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
  label-sm:
    # session chips, ping, key hints, small notes
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.74rem"
    fontWeight: 600
  label-xs:
    # settings captions, Full tag
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 600
  caption:
    # grid slot status (HOST / READY / WAITING)
    fontFamily: "Saira, Outfit, system-ui, sans-serif"
    fontSize: "0.64rem"
    fontWeight: 700
rounded:
  tick: "1px"
  chip: "4px"
  control: "6px"
  panel: "10px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 2.2vw, 36px)"
  panel-pad: "18px"
  stack: "22px"
  row: "12px"
  tight: "6px"
components:
  button-primary:
    backgroundColor: "{colors.f1-red}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 26px"
  button-primary-hover:
    backgroundColor: "{colors.f1-red-hover}"
  button-cta:
    backgroundColor: "{colors.f1-red}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "0"
    height: "64px"
  button-default:
    backgroundColor: "rgba(255, 255, 255, 0.1)"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 26px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "12px 26px"
  button-tool:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "18px 18px 16px"
  step-pill-active:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ink-on-white}"
    rounded: "{rounded.pill}"
    padding: "7px 16px 7px 8px"
  segmented-on:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ink-on-white}"
    rounded: "{rounded.chip}"
  session-chip:
    backgroundColor: "rgba(255, 255, 255, 0.04)"
    textColor: "{colors.muted}"
    rounded: "{rounded.chip}"
    padding: "5px 12px"
---

# Design System: LAN Race

Scope: the lobby (`#lobby-screen`, `public/css/lobby.css`, and the 3D showroom behind it in `public/js/game3d.js`). The in-race HUD in `public/css/style.css` is an older surface with its own look (Outfit, broadcast-style glass). It is out of scope here, and none of its values belong to this system.

## Overview

**Creative North Star: "The Team Garage at Night"**

The lobby plays the F1 / Forza game menu straight. The selected team's real car stands on a slowly turning studio turntable in a near-black room. Menus float over it as translucent dark plates, and the type is a wide, heavy Saira, set uppercase in the voice of a broadcast graphic. The screen has two steps on one surface. The garage is for picking a team and a name, and the race lobby is for the grid, the session and chat. Moving between the steps is one authored move: the plates cross-fade with a 4% horizontal slide while the 3D camera reframes the car.

Colour is disciplined. The room and the type are achromatic. The selected team's colour is the only decorative accent, and it appears everywhere the team appears: the turntable edge band, the rim lights, the livery slashes, the selected team row, and the focus border. F1 red marks the one thing to press. Green, amber and the ping levels mean something, so they are never used for decoration.

The world must hold up on the weakest laptop in the room. On Low graphics the showroom drops to a still frame with no bloom and no post-processing, and the only backdrop blur in the lobby is the settings drawer.

**Key Characteristics:**
- A live 3D car is the hero; the UI frames it and never covers its centre.
- Panels are translucent near-black plates with hairline white borders, not frosted glass.
- Saira variable, used across its width axis: expanded (110–120%) for display and buttons, regular for body text, condensed (85%) for grid numerals.
- Labels are uppercase with wide tracking (0.12–0.22em) in muted grey; values are white.
- Slanted geometry borrowed from F1 graphics: skewed livery slashes, a parallelogram CTA, and a slanted brand mark.

## Colors

The lobby is an achromatic studio with one changing accent (the team), one action colour (F1 red), and a small set of semantic signals.

### Primary
- **Team Colour** (`--team`, default slate #64748b when no team is chosen): set per selected team from `teams.json` `chatColor` by app.js. It drives the turntable edge band and rim lights in the 3D scene, the skewed livery chip on every team row and grid slot, the slash before the team sub-line, the selected team row's gradient wash and border (`color-mix` 42% and 55%), and the input focus border (`color-mix` 70% with white).

### Secondary
- **F1 Red** (#e10600, hover #f5150e): the primary action only: Join, Ready up, Start race. It also colours the brand mark, the word RACE in the wordmark, and the range-slider accent. It is never used for borders, panels or headings.

### Tertiary (semantic only)
- **Ready Green** (#19c37d): the "ready" status in the grid and the success button outline.
- **Host Amber** (#ffb21f): the "host" status in the grid.

### Neutral
- **Studio Black** (#06080b): the 3D scene background and fog. The CSS layer adds vignettes of rgba(3, 4, 6, 0.55–0.85) over it so the plates stay readable at the edges.
- **Plate** (rgba(9, 11, 15, 0.74)): panel fill. Team rows use 0.62 and the drawer uses 0.86.
- **Field** (rgba(255, 255, 255, 0.06)): input and segmented-control wells.
- **Hairline** (rgba(255, 255, 255, 0.09)) / **Hairline Strong** (rgba(255, 255, 255, 0.18)): borders at rest and on hover or emphasis.
- **Text** (#f4f5f7): values, names, headlines. It also fills active pills and segments, with Ink (#0a0c10) as the text on top.
- **Muted** (#a3acb7): section labels and sub-lines.
- **Dim** (#7d8691): placeholders, key hints, field captions, open grid slots.

### Named Rules
**The One Accent Rule.** Team colour is the only decorative hue. Any new element that needs colour for identity gets `--team`, never a new hue.

**The Red Means Go Rule.** F1 red is the fill of the single primary action on screen, plus the brand mark. If two red buttons are visible at the same time, one of them is wrong. The garage's Join and the race lobby's Start race / Ready up are never on screen together.

**The Signal Rule.** Green, amber and the ping colours are status, not decoration. Never use them for an accent, a border or a background wash.

## Typography

**Display Font:** Saira variable (self-hosted `public/fonts/Saira.woff`, wght 100–900, wdth 50–125), with Outfit and system-ui as fallbacks
**Body Font:** Saira (same file)

**Character:** One family carries the whole lobby by changing width and weight. Expanded heavy caps work as the broadcast caption; normal-width semibold works for reading. Numerals use tabular figures wherever they count something (ping, driver count, ready note, grid numbers).

### Hierarchy
- **Display** (800, wdth 112%, clamp(2.4rem, 4.6vw, 4.8rem), line-height 0.92, uppercase): the selected team name in the garage, bottom-left over the car, with a soft text-shadow (0 6px 30px rgba(0,0,0,0.5)). A long-name variant steps down to clamp(2rem, 3.4vw, 3.6rem). It rises 10px on change.
- **Headline** (800, wdth 112%, clamp(2rem, 3.6vw, 3.4rem), uppercase): the driver's own name in the race lobby, centred under the car.
- **Title** (800, wdth 110%, clamp(1.7rem, 2.4vw, 2.3rem), uppercase): the track name heading the race settings plate.
- **Body** (500–600, 0.86–0.95rem, line-height 1.15–1.35): team names, input values, settings values, chat.
- **Button** (700, wdth 110%, 1rem, 0.12em, uppercase): all `.btn`. The CTA grows to 1.25rem at 0.16em.
- **Heading label** (700, 0.8rem, 0.22em, uppercase, muted): panel and section headings ("Choose your team", "Starting grid", "Chat").
- **Label** (600, 0.64–0.82rem, 0.12–0.18em, uppercase, dim or muted): field captions, car codes, statuses, chips, key hints, step tabs.

### Named Rules
**The Caps Are Captions Rule.** Uppercase with wide tracking is for short labels and broadcast captions. Free text (chat, input values, select options in the host grid) stays in sentence case with no tracking.

**The Width Axis Rule.** Emphasis comes from Saira's width and weight, not from a second family. Use wdth 110–120% for display and actions, and 85% for compact numerals.

## Layout

The lobby is a full-viewport grid: a top bar (`auto`) over a stage row (`minmax(0, 1fr)`), drawn above the fixed 3D canvas. The side gutter is `clamp(16px, 2.2vw, 36px)` throughout. Both steps occupy the same grid cell, and only one is visible at a time.

- **Garage:** two columns, `minmax(280px, 340px)` for the team list and `1fr` for the hero, with a column gap of `clamp(24px, 4vw, 72px)`. The team list runs the full height on the left. The hero plate (team name, sub-line, name field and Join) sits bottom-left of the right column, at most 760px wide. Keyboard hints sit bottom-right. The 3D camera offsets the car right and up (`x 0.15, y 0.1`) to clear the list.
- **Race lobby:** three columns, `minmax(330px, 390px) | 1fr | minmax(320px, 400px)`: the grid panel on the left, the car with the driver's name plate and the CTA in the centre, and race settings above chat on the right. The camera centres the car and pulls back.
- **Spacing rhythm:** 4px inside lists, 6–12px between fields, 14–18px inside panels, 22px between hero groups.
- **Short screens** (`max-height: 820px`, 1366×768 laptops): rows, panel padding, CTA height (56px) and the host grid gaps tighten, so nothing needs to scroll at 768px.
- **Narrow** (`max-width: 1280px`): the session summary chips hide and the side columns narrow to 340px. (`max-width: 1060px`): the race lobby becomes two columns with the centre plate as a full-width row, and tool labels collapse to icons.

## Elevation & Depth

Depth comes mostly from the 3D scene itself: the lit car, a fogged studio floor, and a turntable whose edge band glows in the team colour, with bloom and a vignette on High. The CSS layer adds vignettes and soft, ambient shadows. Panels are translucent and unblurred so the GPU does not pay for blur on weak laptops. Only the settings drawer blurs (24px, saturate 1.2), because it sits over everything and is open only briefly.

### Shadow Vocabulary
- **Plate lift** (`box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35)`): every panel.
- **Red action glow** (`box-shadow: 0 10px 28px rgba(225, 6, 0, 0.35)`; hover `0 12px 34px rgba(225, 6, 0, 0.5)`): primary buttons only.
- **Drawer cast** (`box-shadow: -24px 0 60px rgba(0, 0, 0, 0.45)`): the settings drawer.
- **Caption shadow** (`text-shadow: 0 6px 30px rgba(0, 0, 0, 0.5)`): display and headline names over the car.

### Named Rules
**The No-Blur Plates Rule.** Panels get their legibility from opacity (0.62–0.86) and the vignette, not from `backdrop-filter`. Blur is allowed only on a transient overlay.

**The Still Frame Rule.** Every live 3D effect needs a Low path. On Low graphics the showroom renders one still frame with no post-processing and redraws only when the team, step or size changes.

## Shapes

The lobby has two shape families. Containers and controls are softly rounded rectangles: 10px for panels, 6px for buttons, inputs, team rows and tools, 4px for chips, keycaps and segments, and full pills for the step switcher. F1 broadcast geometry is the second family, and it is always slanted: livery chips skewed −14° to −16°, team slashes of 26–34×4px skewed −20°, the primary CTA clipped to a parallelogram (14px inset each side, square corners), and the brand mark, a slanted parallelogram with a cut-out. Grid slots are drawn like the painted boxes on the asphalt: a 2px white bar across the front with legs that fade out through a mask, with even slots staggered half a row down.

## Components

### Buttons
Weighty and wide, in broadcast caps.
- **Shape:** gently rounded (6px). The race lobby CTA uses square corners and a parallelogram clip, 64px tall.
- **Primary:** F1 red fill, white text, red glow; 12px 26px padding; 54px tall next to the name field.
- **Default / small:** white at 10% (18% on hover), white text.
- **Ghost:** transparent with a 1px Hairline Strong inset ring; white at 8% on hover.
- **Success:** transparent with a 2px Ready Green inset ring and green text.
- **Press:** `translateY(1px) scale(0.99)`. **Focus:** 2px white outline, 2px offset.

### Chips
- **Session summary:** 4px corners, hairline border, white at 4%, muted 0.74rem caps. The first chip (the track) is emphasized in white with the strong hairline. Hidden in the race lobby, where the settings plate shows the same data.
- **Keycaps:** 22px tall, strong hairline with a 2px bottom edge, 4px corners.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Plate (0.74), hairline border, padding 18px 18px 16px (14px on short screens).
- **Shadow Strategy:** plate lift (see Elevation).
- Headed by a heading label, with an optional white tabular meta value pushed to the right.

### Inputs / Fields
- **Style:** Field fill, hairline border, 6px corners, 0.95rem/500, padding 10px 12px. Selects use a muted chevron. The hero name field is 54px tall at 1.15rem/600 on a darker plate fill.
- **Hover:** strong hairline. **Focus:** the border shifts to team colour mixed 70% with white, and the fill lifts to white at 10%; no outline ring.
- **Disabled:** 55% opacity. Captions sit above the field as dim uppercase labels.

### Navigation
- **Step switcher:** a pill track (white at 5%, hairline) holding numbered tabs. The active tab inverts to a white fill with ink text, and its number circle inverts too. The race lobby tab stays disabled (45% opacity) until the player has joined.
- **Tool button:** 6px, strong hairline, white at 5%, icon and caps label. It inverts to white when its drawer is open.

### Team Row (signature)
A 46px row: a skewed team-colour chip, the team name (0.95rem/600) over the car code (dim caps), and two seat dots on the right. Hover nudges the row 3px to the right. When selected, the row fills with a team-colour gradient that fades into the plate, gains a team-colour border, and its chip scales up 1.5×. A full team drops to 40% opacity and shows "Full".

### Starting Grid (signature)
Two staggered columns of painted grid boxes with tabular numbers, a skewed livery tick, the driver name in caps, and the status in semantic colour beneath it. The player's own slot has a solid white box and a faint white wash. Open slots are dim with no tick. The host's kick control appears on hover or focus.

### Settings Drawer
Slides in from the right (min(420px, 100vw)) over either step. It is the one blurred surface. Sections are separated by hairlines under tracked legends, and options use a segmented control whose selected segment inverts to white.

### Showroom (3D)
A Studio Black room with fog from 12 to 30 units, a matte floor, a dark turntable whose edge band is lit in the team colour (flashing brighter on a team change), two team-colour rim spots from behind, three overhead light strips caught in the paint, and a white key spot. The car turns at 0.16 rad/s. Per-step framing eases between the garage pose (right of centre, close) and the race lobby pose (centred, pulled back).

## Do's and Don'ts

### Do:
- **Do** route every identity colour through `--team`; it already updates the 3D rim lights and turntable band along with the CSS.
- **Do** keep F1 red (#e10600) for the one primary action on screen.
- **Do** set labels in uppercase Saira at 0.12–0.22em in muted or dim grey, with values in white beneath or beside them.
- **Do** use tabular numerals for anything that counts or updates.
- **Do** keep plates translucent near-black (0.62–0.86) with hairline borders, and leave the car's centre clear.
- **Do** give every 3D or motion effect a Low or reduced-motion path; transitions collapse under `prefers-reduced-motion`.
- **Do** use the shared ease `cubic-bezier(0.16, 1, 0.3, 1)` for state changes (0.2–0.3s for controls, 0.45–0.6s for step and drawer moves).

### Don't:
- **Don't** add `backdrop-filter` to panels; the drawer is the only blurred surface.
- **Don't** introduce a second accent hue, or use green, amber or ping colours as decoration.
- **Don't** fall back to the web-form lobby of three equal dark cards; the car is the screen.
- **Don't** bring HUD values (Outfit, the HUD's glass treatment, `style.css` colours) into lobby surfaces.
- **Don't** put red on borders, headings or panel chrome.
