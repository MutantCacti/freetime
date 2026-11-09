# Chroma study

How the five colour maps behave at three chroma settings (`PALETTE_CHROMA` 0.60, 0.85 as now, and 1.00), in both themes, measured on calendar cells as they're drawn: the colour, with its dither dots, and for past time the less saturated colour under the page-coloured veil. `PALETTE_CHROMA` is unchanged at 0.85.

The sheets (real cells, steps 0–8 from free to busy, the three chroma settings, and the past-time rows) were rendered with Playwright, before and after the change below. They aren't in the repository; the study script that made them and these tables was kept out of `scripts/`.

## The change: a perceptual ramp that always reads busier (round 3, at 9 steps)

Maxence: "we want much more blocks to look like they're near the extremes of the ramp", and the dot-flip reversal measured below had to go. Two changes, in `src/dither.ts` and `src/parula.ts`; what a busy fraction means (`busyStep`) is untouched.

1. **An S-curve instead of a straight line.** Each step's place on the ramp is `stepPosition(step)` = smoothstep(t) = 3t² − 2t³, with t = step / 8. Both the dots and the colour follow it:
   - dither levels go from 0, 2, 3, 5, 6, 8, 9, 11, 12 to **0, 1, 2, 4, 6, 8, 10, 11, 12** (any busy step still has at least one dot);
   - each step's colour is sampled from the toned map at `stepPosition(step)` instead of step / 8.

   Steps 1–2 now read close to free and steps 6–7 close to fully busy; the middle changes fastest.
2. **Each step's lightness is solved for its dots.** A cell's averaged lightness (colour plus dots, blended in linear light) should land at `stepPosition(step)` of the way from the free cell to the fully busy cell. For each step the colour keeps the map's hue and chroma, and its OKLCH lightness is found by bisection so the *averaged* cell hits that target. Both dot tones are tried, and the one with the clearer dots wins (changed in round 5: the one that moves the colour least). For the fully busy end, the tone that leaves the cell furthest towards busy is used, with the end colour's lightness moved only as far as needed for its dots to show (dots at least 1.4:1 against their colour, as before). In the light theme that means dark dots on the busiest cells instead of light ones, which made the busy end much darker: the light theme now spans 0.90 → 0.32 in averaged lightness, where before it ended back up at 0.70.

**Result:** averaged lightness now moves towards busy at every step, for all five maps, in both themes, for current and past time. A test (`test/colour-rule.test.ts`, "cells read steadily busier") checks this for all 20 combinations. Because the targets are the same for every map, all five maps now share the same lightness curve and differ only in hue, which is what a perceptually uniform map is meant to do. The dither-contrast test (dots at least 1.4:1 at every step, current and past, both themes, every map) still passes.

**Trade-offs**, visible in the tables at the end:
- Neighbouring steps near the ends are now close on purpose: steps 0→1 and 7→8 differ by 2–4 ΔE, against 6–12 in the middle. Step 1 still always has dots, so "a little busy" never looks free.
- Moving a step's lightness can take it out of sRGB for its hue, and then chroma is cut to fit: the lowest share kept is 0.60 (dark blues and purples made darker for the early steps). Hue is kept.
- Steps 1–4 in the dark theme are now darker than the map's own colours there (the light dots lift them back), and the busiest dark-theme cell is a slightly deeper yellow, so its light dots show.

Averaged lightness (OKLab L) at chroma 0.85, before and after. ⚠ marks a step that doesn't move towards busy (in the dark theme busy is lighter; in the light theme, darker).

| Map | Theme | Kind | Before (steps 0 → 8) | After (steps 0 → 8) |
|---|---|---|---|---|
| parula | dark | current | 0.36 0.57 0.56⚠ 0.61 0.64 0.66 0.69 0.72 0.79 | 0.36 0.38 0.44 0.51 0.60 0.69 0.77 0.82 0.85 |
| parula | dark | past | 0.27 0.39 0.38⚠ 0.41 0.43 0.44 0.45 0.47 0.51 | 0.27 0.29 0.31 0.36 0.41 0.46 0.50 0.53 0.54 |
| parula | light | current | 0.90 0.80 0.73 0.68 0.64 0.60 0.53 0.73⚠ 0.70 | 0.90 0.88 0.81 0.72 0.61 0.50 0.41 0.34 0.32 |
| parula | light | past | 0.95 0.90 0.87 0.84 0.82 0.80 0.77 0.87⚠ 0.85 | 0.95 0.94 0.90 0.86 0.81 0.76 0.72 0.69 0.68 |
| viridis | dark | current | 0.36 0.51 0.58 0.54⚠ 0.59 0.64 0.69 0.74 0.79 | 0.36 0.38 0.44 0.51 0.60 0.69 0.77 0.83 0.85 |
| viridis | dark | past | 0.27 0.35 0.39 0.37⚠ 0.40 0.42 0.45 0.48 0.51 | 0.27 0.29 0.32 0.36 0.41 0.46 0.50 0.53 0.54 |
| viridis | light | current | 0.90 0.81 0.73 0.66 0.59 0.52 0.69⚠ 0.70⚠ 0.70⚠ | 0.90 0.88 0.81 0.71 0.61 0.50 0.41 0.34 0.32 |
| viridis | light | past | 0.95 0.91 0.87 0.83 0.80 0.77 0.85⚠ 0.85⚠ 0.85⚠ | 0.95 0.94 0.90 0.86 0.81 0.76 0.72 0.69 0.68 |
| cividis | dark | current | 0.36 0.51 0.58 0.66 0.59⚠ 0.63 0.69 0.74 0.79 | 0.36 0.38 0.44 0.51 0.60 0.69 0.77 0.83 0.85 |
| cividis | dark | past | 0.27 0.35 0.39 0.44 0.40⚠ 0.42 0.45 0.48 0.51 | 0.27 0.29 0.32 0.36 0.41 0.46 0.50 0.53 0.54 |
| cividis | light | current | 0.90 0.81 0.73 0.65 0.59 0.71⚠ 0.69 0.70⚠ 0.70⚠ | 0.90 0.88 0.81 0.72 0.61 0.50 0.41 0.34 0.32 |
| cividis | light | past | 0.95 0.91 0.87 0.83 0.80 0.86⚠ 0.85 0.85⚠ 0.85⚠ | 0.95 0.94 0.91 0.86 0.81 0.76 0.72 0.69 0.68 |
| magma | dark | current | 0.36 0.53 0.61 0.57⚠ 0.61 0.65 0.70 0.74 0.79 | 0.36 0.38 0.44 0.52 0.61 0.70 0.78 0.83 0.85 |
| magma | dark | past | 0.27 0.37 0.41 0.39⚠ 0.41 0.43 0.46 0.48 0.51 | 0.27 0.29 0.32 0.36 0.41 0.46 0.50 0.53 0.55 |
| magma | light | current | 0.90 0.81 0.74 0.67 0.61 0.55 0.71⚠ 0.71⚠ 0.70 | 0.90 0.87 0.81 0.72 0.61 0.50 0.41 0.34 0.32 |
| magma | light | past | 0.95 0.91 0.87 0.84 0.81 0.78 0.86⚠ 0.86⚠ 0.85⚠ | 0.95 0.94 0.90 0.86 0.81 0.76 0.72 0.69 0.68 |
| plasma | dark | current | 0.36 0.50 0.57 0.65 0.58⚠ 0.62 0.68 0.73 0.79 | 0.36 0.38 0.44 0.51 0.60 0.69 0.77 0.82 0.84 |
| plasma | dark | past | 0.27 0.35 0.39 0.43 0.39⚠ 0.42 0.45 0.48 0.51 | 0.27 0.29 0.31 0.36 0.41 0.45 0.50 0.53 0.54 |
| plasma | light | current | 0.90 0.80 0.72 0.64 0.58 0.70⚠ 0.69 0.70⚠ 0.70⚠ | 0.90 0.88 0.81 0.72 0.61 0.50 0.41 0.34 0.32 |
| plasma | light | past | 0.95 0.90 0.86 0.82 0.79 0.85⚠ 0.85⚠ 0.85⚠ 0.85⚠ | 0.95 0.94 0.91 0.86 0.81 0.76 0.72 0.69 0.68 |


## Round 4: 17 steps, the same easing

Maxence: "The curve could be made gentler by adding more dithering steps and colour nodes, keeping higher resolution over the same easing function." So `LEVELS` went from 9 to **17** (steps 0, 1/16, … 1), with the same smoothstep easing for both the colour nodes and the dots. `busyStep` keeps its meaning: 0 is free, step 16 is fully busy, any busy time is at least step 1, and anything short of full is at most step 15.

- **Dither levels** stay 0–12: 12 of the 4×4 Bayer's 16 cells is the fully busy pattern, and the spec says a busy cell is never solid, so 13–16 aren't used. With 17 steps and 13 levels, some neighbouring steps share a level and differ by colour alone:
  0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 12.
  Any busy step has at least one dot, and only a full slot has all 12.
- **Colour nodes:** 17 colours per theme, sampled from the toned map at smoothstep(step / 16), each with its lightness solved for its dots as in round 3.
- **Neighbours closer together:** steps near the ends now differ by a few thousandths of lightness. That's about the size of one 8-bit rounding of a colour, so after solving, any step that doesn't read busier than the one before has its lightness moved towards busy, 0.001 at a time, until it does (by at least `MIN_LIGHTNESS_STEP`, 0.001).
- **Both rules still hold at 17,** so there was no need for fewer steps:
  - averaged lightness moves towards busy at every step, for every map, theme and current/past (tested);
  - dots are at least 1.4:1 against their colour at every step (tested).

Averaged lightness at chroma 0.85, 17 steps:

| Map | Theme | Kind | Averaged lightness, steps 0 → 16 |
|---|---|---|---|
| parula | dark | current | 0.36 0.37 0.38 0.40 0.44 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.82 0.84 0.85 |
| parula | dark | past | 0.27 0.28 0.29 0.30 0.31 0.34 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.54 |
| parula | light | current | 0.90 0.89 0.88 0.85 0.81 0.76 0.72 0.66 0.61 0.56 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| parula | light | past | 0.95 0.95 0.94 0.92 0.90 0.88 0.86 0.84 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| viridis | dark | current | 0.36 0.36 0.38 0.40 0.44 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.83 0.84 0.85 |
| viridis | dark | past | 0.27 0.28 0.29 0.30 0.32 0.34 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.54 |
| viridis | light | current | 0.90 0.89 0.88 0.84 0.81 0.76 0.71 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| viridis | light | past | 0.95 0.94 0.94 0.92 0.90 0.88 0.86 0.83 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| cividis | dark | current | 0.36 0.36 0.38 0.41 0.44 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.83 0.84 0.85 |
| cividis | dark | past | 0.27 0.28 0.29 0.30 0.32 0.34 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.54 |
| cividis | light | current | 0.90 0.89 0.88 0.85 0.81 0.76 0.72 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| cividis | light | past | 0.95 0.95 0.94 0.92 0.91 0.88 0.86 0.83 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| magma | dark | current | 0.36 0.37 0.38 0.41 0.44 0.47 0.52 0.56 0.61 0.65 0.70 0.74 0.78 0.81 0.83 0.85 0.85 |
| magma | dark | past | 0.27 0.28 0.29 0.30 0.32 0.34 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.55 |
| magma | light | current | 0.90 0.89 0.87 0.85 0.81 0.77 0.72 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| magma | light | past | 0.95 0.95 0.94 0.92 0.90 0.88 0.86 0.83 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| plasma | dark | current | 0.36 0.37 0.38 0.40 0.44 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.82 0.84 0.84 |
| plasma | dark | past | 0.27 0.28 0.29 0.30 0.31 0.34 0.36 0.38 0.41 0.43 0.45 0.48 0.50 0.52 0.53 0.54 0.54 |
| plasma | light | current | 0.90 0.89 0.88 0.85 0.81 0.76 0.72 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| plasma | light | past | 0.95 0.95 0.94 0.92 0.91 0.88 0.86 0.83 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |

## Round 5: six dot layers, still 17 steps

Maxence: "3 or 4 layers is better than 17", then "How about six layers?", approved in the profile sketch. Round 4's 13 dot patterns were too many to tell apart: neighbours one dot apart read as noise, not as a scale.

**Decision: keep 17 colour steps, and give them six dot layers** (`DITHER_LAYERS` in `src/dither.ts`): none, 2, 4, 6, 9 and 12 of the 16 Bayer cells. "None" is one of the six, and only free time has it.

- **Why not fewer steps.** The steps carry the information (how busy a slot is), and the colour does the fine work between them; the gentler curve that 17 steps gave in round 4 is what Maxence asked for. What was hard to read was the dots. With six layers the patterns are few and distinct, and the colour still moves at every step. Going back to six steps would throw away the gentle curve to fix something only the dots had.
- **Which layers.** The gaps are 2, 2, 2, 3, 3: closer together near free, where a couple of dots is the cue that a slot isn't free, and wider towards busy. 12 is still the fully busy pattern, never solid.
- **Which step gets which layer.** The layer nearest the step's place on the smoothstep ramp, with the same rules as before: any busy step has dots (at least 2), and only a full slot gets the full pattern (anything short of full gets at most 9):
  0, 2, 2, 2, 2, 2, 4, 4, 6, 6, 9, 9, 9, 9, 9, 9, 12.
  Every layer is used. Only these levels have tiles: `/img/dither/<level><tone>.svg` is a 404 for any other level.
- **The lightness solve does the rest.** Each step's colour lightness is solved for its own dots (round 3), so where the layer jumps (2 → 4 at step 6, 6 → 9 at step 10) the colour moves the other way, just enough that the averaged cell still lands on its target. The averaged-lightness curve is the same as round 4's to within 0.01 at every step (table below).
- **One new constraint in the solve.** Step 15 now has 9 dots against the end's 12, so to read almost fully busy its colour must go further than the end's. In the light theme that meant dark dots on a colour too dark for them (1.39:1, under the 1.4:1 rule) for parula, viridis and plasma. Two changes: a step's colour only counts if its dots show (at least `MIN_DOT_CONTRAST`), and the fully busy colour moves towards free, 0.001 at a time, until the step before it can reach its target with its dots showing. That lightened those three maps' fully busy light-theme cell by up to 0.006 in averaged lightness; the others are unchanged. Lowest dot contrast now: 1.40:1.
- **Which dot tone.** Round 3 took whichever tone gave the clearer dots. With at least 2 dots from step 1, that put light dots on the early dark-theme steps, and their colours had to go almost black to leave room for the dots (parula's step 2 was a near-black navy, its hue gone). Now, of the tones whose dots show, the one that moves the colour least from the map's own lightness wins, and changing tone from the step before costs as much as a 0.05 move, so no lone cell has the other tone. Result: dark dots on every busy step in both themes, except the fully busy dark-theme cell (light dots on a deeper yellow, as before). Colours keep their hue: the lowest share of chroma kept is now 0.93, against 0.60 in round 4.
- **Both rules still hold** for every map, both themes, current and past (the existing tests): averaged lightness moves towards busy at every step, and dots are at least 1.4:1 against their colour.

Averaged lightness at chroma 0.85, 17 steps, six dot layers:

| Map | Theme | Kind | Averaged lightness, steps 0 → 16 |
|---|---|---|---|
| parula | dark | current | 0.36 0.36 0.38 0.41 0.44 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.83 0.84 0.85 |
| parula | dark | past | 0.27 0.28 0.29 0.30 0.31 0.34 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.54 |
| parula | light | current | 0.90 0.89 0.88 0.85 0.81 0.77 0.72 0.67 0.61 0.56 0.50 0.45 0.41 0.37 0.34 0.33 0.32 |
| parula | light | past | 0.95 0.95 0.94 0.92 0.91 0.88 0.86 0.84 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| viridis | dark | current | 0.36 0.37 0.38 0.41 0.44 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.83 0.84 0.85 |
| viridis | dark | past | 0.27 0.28 0.28 0.30 0.32 0.33 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.54 |
| viridis | light | current | 0.90 0.89 0.87 0.85 0.81 0.77 0.72 0.67 0.61 0.56 0.51 0.46 0.41 0.38 0.35 0.33 0.32 |
| viridis | light | past | 0.95 0.95 0.94 0.92 0.90 0.88 0.86 0.84 0.81 0.79 0.76 0.74 0.72 0.71 0.69 0.69 0.68 |
| cividis | dark | current | 0.36 0.37 0.38 0.40 0.43 0.47 0.52 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.83 0.84 0.85 |
| cividis | dark | past | 0.27 0.28 0.29 0.30 0.31 0.33 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.54 |
| cividis | light | current | 0.90 0.89 0.87 0.85 0.81 0.76 0.72 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| cividis | light | past | 0.95 0.95 0.94 0.92 0.91 0.88 0.86 0.84 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| magma | dark | current | 0.36 0.37 0.38 0.40 0.44 0.47 0.51 0.56 0.61 0.65 0.70 0.74 0.78 0.81 0.83 0.85 0.85 |
| magma | dark | past | 0.27 0.28 0.29 0.30 0.32 0.33 0.36 0.38 0.41 0.43 0.46 0.48 0.50 0.52 0.53 0.54 0.55 |
| magma | light | current | 0.90 0.89 0.87 0.85 0.81 0.77 0.72 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.32 0.32 |
| magma | light | past | 0.95 0.95 0.94 0.92 0.90 0.88 0.86 0.83 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |
| plasma | dark | current | 0.36 0.37 0.38 0.40 0.43 0.47 0.51 0.56 0.60 0.65 0.69 0.73 0.77 0.80 0.82 0.84 0.84 |
| plasma | dark | past | 0.27 0.28 0.29 0.30 0.31 0.33 0.36 0.38 0.41 0.43 0.45 0.48 0.50 0.52 0.53 0.54 0.54 |
| plasma | light | current | 0.90 0.90 0.88 0.85 0.81 0.77 0.72 0.66 0.61 0.55 0.50 0.45 0.41 0.37 0.34 0.33 0.32 |
| plasma | light | past | 0.95 0.95 0.94 0.92 0.91 0.88 0.86 0.83 0.81 0.78 0.76 0.74 0.72 0.70 0.69 0.68 0.68 |

## What was measured

- **Averaged colour.** From arm's length a cell is its colour with its dots blended in: dots cover `level / 16` of the cell at 42% opacity, blended in linear light. Every number below is for that averaged colour, because that's what the eye compares.
- **ΔE**: the OKLab distance between neighbouring steps, ×100. Around 2 is hard to tell apart side by side; 5 or more is clearly different.
- **ΔL**: the change in OKLab lightness, ×100. In the dark theme busy is lighter, so ΔL should be positive at every step; in the light theme busy is darker, so it should be negative.
- **Contrast**: the WCAG ratio between neighbours' averaged colours.
- **C**: the colour's OKLCH chroma before dots, and **gamut**: how much of the requested chroma survived fitting into sRGB.
- **Past ΔE**: the same distance between neighbouring past-time cells (chroma × `PAST_CHROMA`, dots, then a 50% veil of page colour).

## Findings before the change

1. **Chroma isn't the problem.** Going from 0.60 to 1.00 changes neighbour distances by 1–2 ΔE and changes no contrast ratio by more than 0.03. Gamut fitting barely bites: every step keeps at least 95% of its requested chroma (the only bigger cuts are on near-grey steps of cividis, where hue doesn't show). There's no place where clipping makes chroma jump.

2. **The dots, not the colours, cause the sudden switches.** Each step's dots are dark or light, whichever contrasts more with the colour underneath. Where that choice flips, the averaged lightness jumps the wrong way:
   - **Dark theme:** at the flip from light to dark dots (step 2 for parula, 3 for viridis and magma, 4 for cividis and plasma) the cell gets *darker* though it's busier. It's a small step (ΔL −0.8 to −7), but it's there for every map.
   - **Light theme: the busy end flattens out.** Busy colours are dark, so they get light dots, and more dots at higher steps lighten the cell. For viridis, cividis, magma and plasma, steps 6–8 average to almost the same lightness (ΔE 0.8–4.3, contrast 1.00–1.06), and for all five maps the step where the dots flip is *lighter* than the one before it by 0.11–0.20 L (parula the most, at step 7), the biggest lightness change in the whole ramp. In the light theme a fully busy cell can look less busy than a half-busy one. Parula at least keeps its steps 7 and 8 apart (ΔE 5.7).

3. **Step 0 → 1 is always the biggest jump** in the dark theme (ΔE 15–21, contrast 1.8–2.5): free has no dots, and step 1 adds light dots to a dark colour. That's intended: free and "a bit busy" should look different.

4. **Past time is about half as distinct as present time**, as designed, but in the light theme the busiest past steps are indistinguishable (ΔE 0.3–1.0 for viridis, cividis, magma and plasma).

5. **Base colours alone are fine.** Their lightness rises evenly (the existing tests check this for every preset); it's only the averaged cell that goes the wrong way.

## Recommendations made then

- **Keep `PALETTE_CHROMA` at 0.85.** (Still the recommendation; unchanged.) 1.00 adds a little separation (about +1 ΔE per step) and noticeably louder colours; 0.60 loses separation for nothing.
- **Fix the dot flip instead.** Two ways, from least to most change (the second is what was done; see above):
  1. In the light theme, always use dark dots on the busy half. Dark dots on the darkest colours show less than light ones, so the dither test (dots at least 1.4:1 against their colour) would need checking for those steps.
  2. Better: set each step's base lightness so the *averaged* cell lightness rises evenly, given that step's dots. The toning pipeline already controls lightness, so this is one extra solve per step; then test the averaged lightness, not just the base colour.
- Per map, at chroma 0.85:
  - **parula:** good in both themes apart from the dot flips (dark step 2, light step 7). Keep.
  - **viridis:** good in dark; in light, steps 6–8 read alike. Needs the dot fix before it's a good light-theme choice.
  - **cividis:** the least distinct overall (max ΔE 11 in light), and its light-theme busy end flattens from step 5. Keep for colour-blind viewers, but it benefits most from the fix.
  - **magma:** good in dark; light steps 6–7 flatten less than viridis. Keep.
  - **plasma:** the most distinct in dark (ΔE 7–16); light flattens from step 5. Keep, with the fix.

## Numbers at round 4 (17 steps, 13 dot levels)

### Summary: every map, chroma and theme

ΔE is the OKLab distance between neighbouring steps (×100), measured on what a cell looks like from arm's length: its colour with its dots averaged in. Contrast is the WCAG ratio between neighbours, on the same averaged colours. "Wrong way" lists the steps whose averaged lightness doesn't move towards busy (a cell that looks *less* busy than the one before it). Gamut is the lowest share of the requested chroma a step actually got (1.00 = nothing clipped).

| Map | Chroma | Theme | ΔE min–max | Contrast min–max | Wrong way at steps | Gamut | Past ΔE min |
|---|---|---|---|---|---|---|---|
| parula | 0.60 | dark | 1.8–6.1 | 1.01–1.22 | none | 0.86 | 0.7 |
| parula | 0.60 | light | 0.9–7.0 | 1.02–1.26 | none | 0.98 | 0.2 |
| parula | 0.85 (now) | dark | 2.4–8.2 | 1.01–1.22 | none | 0.60 | 0.9 |
| parula | 0.85 (now) | light | 1.2–8.7 | 1.02–1.29 | none | 0.80 | 0.3 |
| parula | 1.00 | dark | 2.1–9.9 | 1.01–1.23 | none | 0.52 | 0.9 |
| parula | 1.00 | light | 1.1–10.1 | 1.02–1.28 | none | 0.69 | 0.3 |
| viridis | 0.60 | dark | 1.6–6.3 | 1.01–1.22 | none | 0.98 | 0.8 |
| viridis | 0.60 | light | 0.6–7.3 | 1.02–1.28 | none | 0.99 | 0.2 |
| viridis | 0.85 (now) | dark | 1.9–8.3 | 1.01–1.24 | none | 0.88 | 0.8 |
| viridis | 0.85 (now) | light | 0.8–8.7 | 1.02–1.28 | none | 0.91 | 0.3 |
| viridis | 1.00 | dark | 1.9–9.6 | 1.01–1.25 | none | 0.75 | 0.8 |
| viridis | 1.00 | light | 0.8–10.2 | 1.02–1.30 | none | 0.78 | 0.2 |
| cividis | 0.60 | dark | 1.5–5.3 | 1.02–1.21 | none | 0.97 | 0.5 |
| cividis | 0.60 | light | 0.6–5.8 | 1.02–1.25 | none | 0.98 | 0.2 |
| cividis | 0.85 (now) | dark | 1.9–5.7 | 1.02–1.21 | none | 0.82 | 0.8 |
| cividis | 0.85 (now) | light | 0.6–6.0 | 1.02–1.26 | 16 | 0.96 | 0.2 |
| cividis | 1.00 | dark | 2.1–6.4 | 1.02–1.21 | 1 | 0.70 | 0.8 |
| cividis | 1.00 | light | 0.9–6.2 | 1.02–1.25 | none | 0.97 | 0.3 |
| magma | 0.60 | dark | 1.1–6.8 | 1.02–1.21 | none | 0.97 | 0.4 |
| magma | 0.60 | light | 0.9–8.1 | 1.02–1.28 | none | 0.92 | 0.3 |
| magma | 0.85 (now) | dark | 1.6–9.5 | 1.02–1.21 | none | 0.93 | 0.5 |
| magma | 0.85 (now) | light | 0.9–10.2 | 1.02–1.29 | none | 0.95 | 0.3 |
| magma | 1.00 | dark | 1.9–11.1 | 1.02–1.21 | none | 0.79 | 0.6 |
| magma | 1.00 | light | 1.1–11.4 | 1.02–1.30 | none | 0.89 | 0.4 |
| plasma | 0.60 | dark | 1.8–6.5 | 1.01–1.21 | 1 | 0.99 | 0.9 |
| plasma | 0.60 | light | 0.9–8.8 | 1.02–1.30 | none | 0.98 | 0.3 |
| plasma | 0.85 (now) | dark | 1.9–8.0 | 1.02–1.21 | none | 0.82 | 0.9 |
| plasma | 0.85 (now) | light | 1.2–11.0 | 1.02–1.31 | none | 0.99 | 0.3 |
| plasma | 1.00 | dark | 2.0–9.8 | 1.01–1.21 | 16 | 0.70 | 1.0 |
| plasma | 1.00 | light | 1.3–12.5 | 1.01–1.33 | none | 0.98 | 0.4 |

### Step by step at the current chroma (0.85)

Step 0 is free, the last step fully busy. Dots: k = dark dots, w = light dots (whichever contrasts more with the colour underneath). L is the averaged lightness (OKLab), C the colour's chroma before dots. ΔE, ΔL and contrast are measured from the step before.

#### parula

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.126 | 0.360 | | | | |
| 1 | w | 0.133 | 0.365 | 2.7 | +0.6 | 1.04 | 0.9 |
| 2 | w | 0.149 | 0.381 | 2.5 | +1.5 | 1.06 | 1.0 |
| 3 | w | 0.175 | 0.404 | 4.0 | +2.3 | 1.10 | 1.5 |
| 4 | w | 0.112 | 0.435 | 8.2 | +3.2 | 1.18 | 2.7 |
| 5 | w | 0.085 | 0.473 | 4.8 | +3.7 | 1.18 | 2.2 |
| 6 | w | 0.068 | 0.514 | 4.4 | +4.1 | 1.20 | 2.3 |
| 7 | w | 0.062 | 0.556 | 4.4 | +4.2 | 1.20 | 2.3 |
| 8 | w | 0.077 | 0.602 | 4.9 | +4.5 | 1.21 | 2.6 |
| 9 | k | 0.100 | 0.646 | 8.2 | +4.4 | 1.22 | 3.1 |
| 10 | k | 0.097 | 0.692 | 6.7 | +4.6 | 1.17 | 2.8 |
| 11 | k | 0.106 | 0.734 | 6.0 | +4.2 | 1.15 | 2.6 |
| 12 | k | 0.131 | 0.770 | 4.6 | +3.5 | 1.12 | 2.2 |
| 13 | k | 0.146 | 0.802 | 4.6 | +3.2 | 1.13 | 2.0 |
| 14 | k | 0.157 | 0.824 | 3.2 | +2.2 | 1.09 | 1.4 |
| 15 | k | 0.170 | 0.840 | 2.4 | +1.6 | 1.06 | 1.0 |
| 16 | w | 0.164 | 0.846 | 7.8 | +0.6 | 1.01 | 2.1 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.177 | 0.901 | | | | |
| 1 | k | 0.171 | 0.894 | 1.2 | -0.7 | 1.02 | 0.4 |
| 2 | k | 0.158 | 0.875 | 2.6 | -1.9 | 1.07 | 1.0 |
| 3 | k | 0.146 | 0.849 | 3.8 | -2.7 | 1.10 | 1.5 |
| 4 | k | 0.131 | 0.808 | 5.6 | -4.1 | 1.16 | 2.2 |
| 5 | k | 0.106 | 0.765 | 5.5 | -4.3 | 1.15 | 2.2 |
| 6 | k | 0.097 | 0.715 | 6.7 | -4.9 | 1.17 | 2.6 |
| 7 | k | 0.100 | 0.662 | 7.3 | -5.3 | 1.20 | 2.8 |
| 8 | w | 0.080 | 0.608 | 8.7 | -5.4 | 1.27 | 3.0 |
| 9 | k | 0.099 | 0.557 | 8.4 | -5.1 | 1.21 | 3.0 |
| 10 | k | 0.112 | 0.502 | 7.2 | -5.5 | 1.29 | 2.8 |
| 11 | k | 0.135 | 0.452 | 6.2 | -5.0 | 1.27 | 2.3 |
| 12 | k | 0.161 | 0.407 | 5.3 | -4.5 | 1.23 | 2.2 |
| 13 | k | 0.176 | 0.370 | 4.3 | -3.7 | 1.19 | 1.6 |
| 14 | k | 0.148 | 0.341 | 4.4 | -2.9 | 1.12 | 1.4 |
| 15 | k | 0.133 | 0.324 | 2.5 | -1.7 | 1.06 | 0.7 |
| 16 | k | 0.126 | 0.317 | 1.2 | -0.7 | 1.03 | 0.3 |

#### viridis

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.117 | 0.360 | | | | |
| 1 | w | 0.116 | 0.365 | 4.0 | +0.5 | 1.04 | 1.2 |
| 2 | w | 0.115 | 0.380 | 1.9 | +1.6 | 1.07 | 0.9 |
| 3 | w | 0.112 | 0.405 | 2.7 | +2.4 | 1.11 | 1.3 |
| 4 | w | 0.102 | 0.436 | 4.2 | +3.1 | 1.16 | 1.9 |
| 5 | w | 0.087 | 0.473 | 4.3 | +3.7 | 1.18 | 2.1 |
| 6 | w | 0.073 | 0.514 | 4.6 | +4.2 | 1.21 | 2.3 |
| 7 | w | 0.065 | 0.557 | 4.6 | +4.3 | 1.21 | 2.4 |
| 8 | w | 0.072 | 0.603 | 4.8 | +4.6 | 1.22 | 2.6 |
| 9 | k | 0.101 | 0.649 | 8.3 | +4.5 | 1.24 | 3.1 |
| 10 | k | 0.128 | 0.691 | 5.8 | +4.2 | 1.18 | 2.7 |
| 11 | k | 0.149 | 0.735 | 5.5 | +4.4 | 1.17 | 2.6 |
| 12 | k | 0.163 | 0.771 | 4.8 | +3.6 | 1.13 | 2.2 |
| 13 | k | 0.164 | 0.803 | 4.2 | +3.1 | 1.10 | 1.9 |
| 14 | k | 0.163 | 0.828 | 3.2 | +2.5 | 1.08 | 1.5 |
| 15 | k | 0.159 | 0.840 | 2.1 | +1.3 | 1.03 | 0.8 |
| 16 | w | 0.157 | 0.847 | 7.2 | +0.7 | 1.01 | 1.9 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.158 | 0.899 | | | | |
| 1 | k | 0.159 | 0.891 | 1.1 | -0.8 | 1.02 | 0.5 |
| 2 | k | 0.163 | 0.875 | 2.4 | -1.6 | 1.04 | 0.9 |
| 3 | k | 0.163 | 0.844 | 3.9 | -3.1 | 1.09 | 1.6 |
| 4 | k | 0.164 | 0.809 | 4.7 | -3.6 | 1.11 | 2.0 |
| 5 | k | 0.149 | 0.765 | 5.6 | -4.4 | 1.16 | 2.3 |
| 6 | k | 0.129 | 0.715 | 6.2 | -5.0 | 1.20 | 2.6 |
| 7 | k | 0.101 | 0.662 | 6.7 | -5.2 | 1.23 | 2.7 |
| 8 | w | 0.075 | 0.609 | 8.7 | -5.4 | 1.28 | 2.9 |
| 9 | k | 0.070 | 0.553 | 6.9 | -5.6 | 1.25 | 2.8 |
| 10 | k | 0.074 | 0.502 | 6.0 | -5.0 | 1.26 | 2.4 |
| 11 | k | 0.086 | 0.452 | 5.9 | -5.0 | 1.26 | 2.3 |
| 12 | k | 0.101 | 0.408 | 5.4 | -4.4 | 1.23 | 2.1 |
| 13 | k | 0.110 | 0.372 | 4.3 | -3.6 | 1.18 | 1.6 |
| 14 | k | 0.116 | 0.341 | 3.5 | -3.1 | 1.14 | 1.4 |
| 15 | k | 0.116 | 0.325 | 2.0 | -1.7 | 1.07 | 0.8 |
| 16 | k | 0.117 | 0.317 | 0.8 | -0.8 | 1.03 | 0.3 |

#### cividis

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.078 | 0.359 | | | | |
| 1 | w | 0.080 | 0.364 | 2.6 | +0.5 | 1.02 | 0.8 |
| 2 | w | 0.090 | 0.380 | 1.9 | +1.5 | 1.06 | 0.9 |
| 3 | w | 0.100 | 0.405 | 2.8 | +2.5 | 1.11 | 1.4 |
| 4 | w | 0.073 | 0.436 | 4.7 | +3.1 | 1.14 | 1.9 |
| 5 | w | 0.048 | 0.473 | 4.2 | +3.6 | 1.17 | 2.1 |
| 6 | w | 0.026 | 0.514 | 4.3 | +4.1 | 1.20 | 2.2 |
| 7 | w | 0.009 | 0.558 | 4.4 | +4.4 | 1.20 | 2.4 |
| 8 | w | 0.007 | 0.604 | 4.6 | +4.6 | 1.21 | 2.5 |
| 9 | w | 0.026 | 0.649 | 4.6 | +4.5 | 1.20 | 2.5 |
| 10 | k | 0.052 | 0.692 | 5.7 | +4.3 | 1.18 | 2.6 |
| 11 | k | 0.076 | 0.734 | 4.7 | +4.2 | 1.17 | 2.4 |
| 12 | k | 0.102 | 0.771 | 4.3 | +3.7 | 1.14 | 2.2 |
| 13 | k | 0.123 | 0.802 | 3.6 | +3.1 | 1.11 | 1.8 |
| 14 | k | 0.139 | 0.826 | 2.8 | +2.4 | 1.08 | 1.4 |
| 15 | k | 0.123 | 0.841 | 2.0 | +1.5 | 1.05 | 0.9 |
| 16 | w | 0.152 | 0.847 | 4.1 | +0.7 | 1.02 | 1.0 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.153 | 0.900 | | | | |
| 1 | k | 0.150 | 0.892 | 1.0 | -0.8 | 1.03 | 0.4 |
| 2 | k | 0.139 | 0.875 | 2.0 | -1.6 | 1.05 | 0.9 |
| 3 | k | 0.123 | 0.846 | 3.4 | -3.0 | 1.10 | 1.5 |
| 4 | k | 0.103 | 0.809 | 4.3 | -3.7 | 1.13 | 1.9 |
| 5 | k | 0.078 | 0.765 | 5.1 | -4.4 | 1.16 | 2.2 |
| 6 | k | 0.052 | 0.715 | 5.6 | -4.9 | 1.20 | 2.4 |
| 7 | k | 0.025 | 0.661 | 6.0 | -5.4 | 1.23 | 2.7 |
| 8 | w | 0.006 | 0.609 | 5.6 | -5.2 | 1.23 | 2.5 |
| 9 | k | 0.008 | 0.553 | 5.7 | -5.6 | 1.26 | 2.6 |
| 10 | k | 0.026 | 0.501 | 5.5 | -5.2 | 1.25 | 2.4 |
| 11 | k | 0.048 | 0.454 | 5.2 | -4.8 | 1.23 | 2.2 |
| 12 | k | 0.072 | 0.407 | 5.1 | -4.6 | 1.22 | 2.1 |
| 13 | k | 0.100 | 0.370 | 4.4 | -3.7 | 1.17 | 1.8 |
| 14 | k | 0.090 | 0.341 | 3.0 | -2.9 | 1.12 | 1.2 |
| 15 | k | 0.081 | 0.321 | 2.1 | -2.0 | 1.08 | 0.8 |
| 16 | k | 0.078 | 0.317 | 0.6 | -0.5 ⚠ | 1.02 | 0.2 |

#### magma

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.028 | 0.360 | | | | |
| 1 | w | 0.027 | 0.366 | 1.6 | +0.6 | 1.02 | 0.5 |
| 2 | w | 0.039 | 0.381 | 1.9 | +1.5 | 1.06 | 0.8 |
| 3 | w | 0.062 | 0.406 | 3.3 | +2.5 | 1.10 | 1.5 |
| 4 | w | 0.102 | 0.437 | 3.5 | +3.1 | 1.13 | 1.7 |
| 5 | w | 0.136 | 0.474 | 3.9 | +3.7 | 1.16 | 2.0 |
| 6 | w | 0.142 | 0.516 | 4.5 | +4.2 | 1.20 | 2.3 |
| 7 | w | 0.143 | 0.561 | 4.9 | +4.5 | 1.20 | 2.5 |
| 8 | w | 0.150 | 0.607 | 5.2 | +4.6 | 1.21 | 2.6 |
| 9 | k | 0.157 | 0.652 | 9.5 | +4.5 | 1.15 | 3.4 |
| 10 | k | 0.148 | 0.697 | 6.3 | +4.5 | 1.20 | 2.8 |
| 11 | k | 0.114 | 0.738 | 6.0 | +4.2 | 1.19 | 2.6 |
| 12 | k | 0.092 | 0.776 | 5.1 | +3.8 | 1.16 | 2.3 |
| 13 | k | 0.079 | 0.808 | 4.2 | +3.2 | 1.13 | 2.0 |
| 14 | k | 0.070 | 0.833 | 3.2 | +2.5 | 1.10 | 1.5 |
| 15 | k | 0.067 | 0.847 | 1.9 | +1.5 | 1.05 | 0.9 |
| 16 | w | 0.066 | 0.853 | 2.7 | +0.5 | 1.02 | 0.8 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.067 | 0.899 | | | | |
| 1 | k | 0.068 | 0.893 | 0.9 | -0.6 | 1.02 | 0.3 |
| 2 | k | 0.070 | 0.875 | 2.4 | -1.8 | 1.07 | 1.0 |
| 3 | k | 0.078 | 0.845 | 3.6 | -2.9 | 1.11 | 1.5 |
| 4 | k | 0.097 | 0.807 | 5.0 | -3.8 | 1.15 | 2.0 |
| 5 | k | 0.123 | 0.766 | 5.6 | -4.2 | 1.18 | 2.3 |
| 6 | k | 0.150 | 0.716 | 6.4 | -5.0 | 1.22 | 2.6 |
| 7 | k | 0.156 | 0.662 | 7.1 | -5.4 | 1.24 | 2.9 |
| 8 | w | 0.149 | 0.608 | 10.2 | -5.4 | 1.19 | 3.1 |
| 9 | k | 0.141 | 0.555 | 9.0 | -5.3 | 1.29 | 3.1 |
| 10 | k | 0.142 | 0.502 | 6.7 | -5.3 | 1.25 | 2.6 |
| 11 | k | 0.138 | 0.453 | 5.8 | -4.9 | 1.22 | 2.2 |
| 12 | k | 0.102 | 0.408 | 6.1 | -4.5 | 1.18 | 2.1 |
| 13 | k | 0.063 | 0.371 | 5.2 | -3.7 | 1.15 | 1.7 |
| 14 | k | 0.041 | 0.342 | 3.5 | -2.9 | 1.11 | 1.3 |
| 15 | k | 0.026 | 0.324 | 2.3 | -1.8 | 1.07 | 0.8 |
| 16 | k | 0.028 | 0.317 | 1.2 | -0.7 | 1.02 | 0.4 |

#### plasma

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.160 | 0.360 | | | | |
| 1 | w | 0.162 | 0.366 | 4.5 | +0.6 | 1.03 | 1.4 |
| 2 | w | 0.165 | 0.381 | 1.9 | +1.5 | 1.06 | 0.9 |
| 3 | w | 0.170 | 0.404 | 2.9 | +2.4 | 1.09 | 1.4 |
| 4 | w | 0.171 | 0.435 | 4.8 | +3.1 | 1.15 | 1.9 |
| 5 | w | 0.154 | 0.472 | 5.4 | +3.7 | 1.19 | 2.3 |
| 6 | w | 0.150 | 0.513 | 4.5 | +4.0 | 1.19 | 2.2 |
| 7 | w | 0.154 | 0.556 | 4.8 | +4.3 | 1.20 | 2.5 |
| 8 | w | 0.144 | 0.602 | 5.0 | +4.6 | 1.21 | 2.6 |
| 9 | w | 0.133 | 0.647 | 4.8 | +4.5 | 1.20 | 2.5 |
| 10 | k | 0.128 | 0.690 | 8.0 | +4.3 | 1.16 | 3.0 |
| 11 | k | 0.131 | 0.732 | 5.7 | +4.2 | 1.19 | 2.6 |
| 12 | k | 0.137 | 0.769 | 5.2 | +3.6 | 1.16 | 2.3 |
| 13 | k | 0.146 | 0.799 | 4.4 | +3.0 | 1.13 | 2.0 |
| 14 | k | 0.157 | 0.824 | 3.8 | +2.5 | 1.10 | 1.6 |
| 15 | k | 0.166 | 0.836 | 2.1 | +1.2 | 1.05 | 0.9 |
| 16 | w | 0.165 | 0.843 | 7.4 | +0.7 | 1.02 | 2.0 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.173 | 0.900 | | | | |
| 1 | k | 0.166 | 0.893 | 1.4 | -0.8 | 1.03 | 0.5 |
| 2 | k | 0.158 | 0.876 | 2.5 | -1.7 | 1.06 | 1.0 |
| 3 | k | 0.146 | 0.845 | 4.5 | -3.1 | 1.12 | 1.7 |
| 4 | k | 0.137 | 0.811 | 4.9 | -3.5 | 1.14 | 1.9 |
| 5 | k | 0.130 | 0.763 | 6.2 | -4.7 | 1.20 | 2.5 |
| 6 | k | 0.128 | 0.716 | 6.2 | -4.7 | 1.20 | 2.5 |
| 7 | k | 0.134 | 0.663 | 7.1 | -5.3 | 1.24 | 2.8 |
| 8 | w | 0.143 | 0.608 | 8.9 | -5.5 | 1.21 | 2.9 |
| 9 | k | 0.164 | 0.554 | 11.0 | -5.4 | 1.31 | 3.5 |
| 10 | k | 0.183 | 0.503 | 7.3 | -5.1 | 1.25 | 2.5 |
| 11 | k | 0.186 | 0.452 | 6.5 | -5.1 | 1.24 | 2.4 |
| 12 | k | 0.180 | 0.409 | 5.8 | -4.3 | 1.19 | 2.1 |
| 13 | k | 0.172 | 0.371 | 4.9 | -3.8 | 1.15 | 1.7 |
| 14 | k | 0.166 | 0.343 | 3.6 | -2.8 | 1.11 | 1.3 |
| 15 | k | 0.162 | 0.324 | 2.7 | -1.9 | 1.06 | 1.0 |
| 16 | k | 0.160 | 0.317 | 1.2 | -0.6 | 1.02 | 0.3 |

