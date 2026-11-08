# Chroma study

How the five colour maps behave at three chroma settings (`PALETTE_CHROMA` 0.60, 0.85 as now, and 1.00), in both themes, measured on calendar cells as they're drawn: the colour, with its dither dots, and for past time the less saturated colour under the page-coloured veil. `PALETTE_CHROMA` is unchanged at 0.85.

The sheets (real cells, steps 0–8 from free to busy, the three chroma settings, and the past-time rows) were rendered with Playwright, before and after the change below. They aren't in the repository; the study script that made them and these tables was kept out of `scripts/`.

## The change: a perceptual ramp that always reads busier (round 3)

Maxence: "we want much more blocks to look like they're near the extremes of the ramp", and the dot-flip reversal measured below had to go. Two changes, in `src/dither.ts` and `src/parula.ts`; what a busy fraction means (`busyStep`) is untouched.

1. **An S-curve instead of a straight line.** Each step's place on the ramp is `stepPosition(step)` = smoothstep(t) = 3t² − 2t³, with t = step / 8. Both the dots and the colour follow it:
   - dither levels go from 0, 2, 3, 5, 6, 8, 9, 11, 12 to **0, 1, 2, 4, 6, 8, 10, 11, 12** (any busy step still has at least one dot);
   - each step's colour is sampled from the toned map at `stepPosition(step)` instead of step / 8.

   Steps 1–2 now read close to free and steps 6–7 close to fully busy; the middle changes fastest.
2. **Each step's lightness is solved for its dots.** A cell's averaged lightness (colour plus dots, blended in linear light) should land at `stepPosition(step)` of the way from the free cell to the fully busy cell. For each step the colour keeps the map's hue and chroma, and its OKLCH lightness is found by bisection so the *averaged* cell hits that target. Both dot tones are tried, and the one with the clearer dots wins. For the fully busy end, the tone that leaves the cell furthest towards busy is used, with the end colour's lightness moved only as far as needed for its dots to show (dots at least 1.4:1 against their colour, as before). In the light theme that means dark dots on the busiest cells instead of light ones, which made the busy end much darker: the light theme now spans 0.90 → 0.32 in averaged lightness, where before it ended back up at 0.70.

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

## Numbers after the change

### Summary: every map, chroma and theme

ΔE is the OKLab distance between neighbouring steps (×100), measured on what a cell looks like from arm's length: its colour with its dots averaged in. Contrast is the WCAG ratio between neighbours, on the same averaged colours. "Wrong way" lists the steps whose averaged lightness doesn't move towards busy (a cell that looks *less* busy than the one before it). Gamut is the lowest share of the requested chroma a step actually got (1.00 = nothing clipped).

| Map | Chroma | Theme | ΔE min–max | Contrast min–max | Wrong way at steps | Gamut | Past ΔE min |
|---|---|---|---|---|---|---|---|
| parula | 0.60 | dark | 2.2–10.6 | 1.07–1.47 | none | 0.86 | 1.1 |
| parula | 0.60 | light | 3.0–12.5 | 1.09–1.56 | none | 0.99 | 1.1 |
| parula | 0.85 (now) | dark | 2.3–12.0 | 1.07–1.46 | none | 0.60 | 1.2 |
| parula | 0.85 (now) | light | 3.7–14.0 | 1.09–1.56 | none | 0.80 | 1.1 |
| parula | 1.00 | dark | 2.2–12.7 | 1.07–1.47 | none | 0.52 | 1.2 |
| parula | 1.00 | light | 3.9–14.4 | 1.09–1.55 | none | 0.69 | 1.2 |
| viridis | 0.60 | dark | 3.4–11.1 | 1.06–1.47 | none | 0.99 | 1.3 |
| viridis | 0.60 | light | 2.6–12.9 | 1.07–1.56 | none | 0.99 | 1.0 |
| viridis | 0.85 (now) | dark | 4.3–13.1 | 1.05–1.47 | none | 0.88 | 1.6 |
| viridis | 0.85 (now) | light | 2.8–14.6 | 1.07–1.57 | none | 0.91 | 1.1 |
| viridis | 1.00 | dark | 4.7–14.7 | 1.05–1.48 | none | 0.75 | 1.7 |
| viridis | 1.00 | light | 3.0–16.5 | 1.07–1.60 | none | 0.78 | 1.0 |
| cividis | 0.60 | dark | 2.4–9.7 | 1.06–1.46 | none | 0.97 | 1.2 |
| cividis | 0.60 | light | 2.6–11.3 | 1.08–1.57 | none | 0.99 | 1.0 |
| cividis | 0.85 (now) | dark | 2.5–9.9 | 1.07–1.45 | none | 0.97 | 1.2 |
| cividis | 0.85 (now) | light | 2.7–11.6 | 1.08–1.57 | none | 0.96 | 1.0 |
| cividis | 1.00 | dark | 2.7–10.6 | 1.07–1.46 | none | 0.88 | 1.2 |
| cividis | 1.00 | light | 2.8–12.0 | 1.08–1.57 | none | 0.97 | 1.0 |
| magma | 0.60 | dark | 2.2–11.1 | 1.08–1.45 | none | 0.97 | 1.2 |
| magma | 0.60 | light | 2.6–12.5 | 1.09–1.60 | none | 0.92 | 1.1 |
| magma | 0.85 (now) | dark | 2.3–12.6 | 1.07–1.45 | none | 0.95 | 1.2 |
| magma | 0.85 (now) | light | 2.9–14.5 | 1.09–1.61 | none | 0.98 | 1.1 |
| magma | 1.00 | dark | 2.3–12.3 | 1.08–1.45 | none | 0.82 | 1.2 |
| magma | 1.00 | light | 3.0–14.9 | 1.09–1.63 | none | 0.89 | 1.1 |
| plasma | 0.60 | dark | 4.0–10.6 | 1.07–1.46 | none | 1.00 | 1.5 |
| plasma | 0.60 | light | 3.1–13.9 | 1.08–1.63 | none | 0.99 | 1.1 |
| plasma | 0.85 (now) | dark | 5.2–12.0 | 1.07–1.45 | none | 0.82 | 1.8 |
| plasma | 0.85 (now) | light | 3.8–16.4 | 1.08–1.65 | none | 0.99 | 1.3 |
| plasma | 1.00 | dark | 6.1–13.2 | 1.07–1.44 | none | 0.70 | 2.1 |
| plasma | 1.00 | light | 4.1–18.3 | 1.08–1.68 | none | 0.98 | 1.4 |

### Step by step at the current chroma (0.85)

Step 0 is free, step 8 fully busy. Dots: k = dark dots, w = light dots (whichever contrasts more with the colour underneath). L is the averaged lightness (OKLab), C the colour's chroma before dots. ΔE, ΔL and contrast are measured from the step before.

#### parula

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.126 | 0.360 | | | | |
| 1 | w | 0.149 | 0.381 | 2.3 | +2.1 | 1.10 | 1.2 |
| 2 | w | 0.112 | 0.435 | 7.6 | +5.5 | 1.30 | 3.3 |
| 3 | w | 0.068 | 0.514 | 9.1 | +7.9 | 1.42 | 4.4 |
| 4 | w | 0.077 | 0.602 | 9.3 | +8.8 | 1.46 | 4.9 |
| 5 | k | 0.097 | 0.692 | 12.0 | +9.0 | 1.43 | 5.4 |
| 6 | k | 0.131 | 0.770 | 10.5 | +7.8 | 1.29 | 4.8 |
| 7 | k | 0.157 | 0.824 | 7.7 | +5.4 | 1.23 | 3.4 |
| 8 | w | 0.164 | 0.846 | 7.0 | +2.2 | 1.07 | 2.1 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.177 | 0.901 | | | | |
| 1 | k | 0.158 | 0.875 | 3.8 | -2.6 | 1.09 | 1.4 |
| 2 | k | 0.131 | 0.808 | 9.4 | -6.7 | 1.28 | 3.7 |
| 3 | k | 0.097 | 0.715 | 12.2 | -9.3 | 1.34 | 4.8 |
| 4 | w | 0.080 | 0.608 | 13.4 | -10.7 | 1.52 | 5.4 |
| 5 | k | 0.112 | 0.502 | 14.0 | -10.7 | 1.55 | 5.5 |
| 6 | k | 0.161 | 0.407 | 11.5 | -9.4 | 1.56 | 4.5 |
| 7 | k | 0.148 | 0.341 | 7.8 | -6.6 | 1.34 | 2.9 |
| 8 | k | 0.126 | 0.317 | 3.7 | -2.4 | 1.09 | 1.1 |

#### viridis

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.117 | 0.360 | | | | |
| 1 | w | 0.115 | 0.380 | 4.3 | +2.1 | 1.11 | 1.6 |
| 2 | w | 0.102 | 0.436 | 6.3 | +5.6 | 1.29 | 3.1 |
| 3 | w | 0.073 | 0.514 | 8.9 | +7.8 | 1.43 | 4.4 |
| 4 | w | 0.072 | 0.603 | 9.4 | +8.9 | 1.47 | 5.0 |
| 5 | k | 0.128 | 0.691 | 13.1 | +8.8 | 1.46 | 5.6 |
| 6 | k | 0.163 | 0.771 | 10.2 | +8.0 | 1.32 | 4.8 |
| 7 | k | 0.163 | 0.828 | 7.4 | +5.6 | 1.19 | 3.4 |
| 8 | w | 0.157 | 0.847 | 8.0 | +1.9 | 1.05 | 2.3 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.158 | 0.899 | | | | |
| 1 | k | 0.163 | 0.875 | 3.6 | -2.4 | 1.07 | 1.3 |
| 2 | k | 0.164 | 0.809 | 8.6 | -6.7 | 1.22 | 3.6 |
| 3 | k | 0.129 | 0.715 | 11.7 | -9.4 | 1.38 | 4.8 |
| 4 | w | 0.075 | 0.609 | 14.6 | -10.6 | 1.56 | 5.5 |
| 5 | k | 0.074 | 0.502 | 12.0 | -10.6 | 1.57 | 5.1 |
| 6 | k | 0.101 | 0.408 | 11.2 | -9.4 | 1.55 | 4.4 |
| 7 | k | 0.116 | 0.341 | 7.7 | -6.7 | 1.34 | 3.0 |
| 8 | k | 0.117 | 0.317 | 2.8 | -2.4 | 1.10 | 1.1 |

#### cividis

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.078 | 0.359 | | | | |
| 1 | w | 0.090 | 0.380 | 2.5 | +2.1 | 1.09 | 1.2 |
| 2 | w | 0.073 | 0.436 | 6.1 | +5.6 | 1.27 | 3.0 |
| 3 | w | 0.026 | 0.514 | 8.4 | +7.8 | 1.40 | 4.3 |
| 4 | w | 0.007 | 0.604 | 9.0 | +9.0 | 1.45 | 4.9 |
| 5 | k | 0.052 | 0.692 | 9.9 | +8.9 | 1.42 | 5.1 |
| 6 | k | 0.102 | 0.771 | 9.0 | +7.9 | 1.33 | 4.5 |
| 7 | k | 0.139 | 0.826 | 6.4 | +5.5 | 1.21 | 3.2 |
| 8 | w | 0.152 | 0.847 | 5.9 | +2.1 | 1.07 | 1.8 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.153 | 0.900 | | | | |
| 1 | k | 0.139 | 0.875 | 3.0 | -2.5 | 1.08 | 1.2 |
| 2 | k | 0.103 | 0.809 | 7.6 | -6.7 | 1.25 | 3.4 |
| 3 | k | 0.052 | 0.715 | 10.6 | -9.3 | 1.39 | 4.6 |
| 4 | w | 0.006 | 0.609 | 11.6 | -10.6 | 1.51 | 5.1 |
| 5 | k | 0.026 | 0.501 | 11.1 | -10.8 | 1.57 | 5.0 |
| 6 | k | 0.072 | 0.407 | 10.3 | -9.4 | 1.50 | 4.2 |
| 7 | k | 0.090 | 0.341 | 6.8 | -6.6 | 1.31 | 2.9 |
| 8 | k | 0.078 | 0.317 | 2.7 | -2.5 | 1.10 | 1.0 |

#### magma

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.028 | 0.360 | | | | |
| 1 | w | 0.039 | 0.381 | 2.3 | +2.1 | 1.09 | 1.2 |
| 2 | w | 0.102 | 0.437 | 6.7 | +5.6 | 1.25 | 3.2 |
| 3 | w | 0.142 | 0.516 | 8.3 | +7.9 | 1.39 | 4.3 |
| 4 | w | 0.150 | 0.607 | 10.1 | +9.1 | 1.45 | 5.1 |
| 5 | k | 0.148 | 0.697 | 12.6 | +9.0 | 1.38 | 5.5 |
| 6 | k | 0.092 | 0.776 | 11.1 | +7.9 | 1.39 | 4.9 |
| 7 | k | 0.070 | 0.833 | 7.3 | +5.7 | 1.24 | 3.5 |
| 8 | w | 0.066 | 0.853 | 3.7 | +2.0 | 1.07 | 1.4 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.067 | 0.899 | | | | |
| 1 | k | 0.070 | 0.875 | 3.3 | -2.5 | 1.09 | 1.3 |
| 2 | k | 0.097 | 0.807 | 8.6 | -6.7 | 1.28 | 3.5 |
| 3 | k | 0.150 | 0.716 | 12.0 | -9.1 | 1.44 | 5.0 |
| 4 | w | 0.149 | 0.608 | 14.5 | -10.8 | 1.48 | 5.4 |
| 5 | k | 0.142 | 0.502 | 13.8 | -10.6 | 1.61 | 5.4 |
| 6 | k | 0.102 | 0.408 | 11.3 | -9.3 | 1.44 | 4.3 |
| 7 | k | 0.041 | 0.342 | 8.7 | -6.6 | 1.28 | 3.1 |
| 8 | k | 0.028 | 0.317 | 2.9 | -2.5 | 1.09 | 1.1 |

#### plasma

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.160 | 0.360 | | | | |
| 1 | w | 0.165 | 0.381 | 5.2 | +2.1 | 1.09 | 1.8 |
| 2 | w | 0.171 | 0.435 | 6.7 | +5.5 | 1.26 | 3.1 |
| 3 | w | 0.150 | 0.513 | 9.8 | +7.7 | 1.42 | 4.4 |
| 4 | w | 0.144 | 0.602 | 9.9 | +8.9 | 1.45 | 5.0 |
| 5 | k | 0.128 | 0.690 | 12.0 | +8.8 | 1.40 | 5.4 |
| 6 | k | 0.137 | 0.769 | 10.8 | +7.9 | 1.37 | 4.8 |
| 7 | k | 0.157 | 0.824 | 8.2 | +5.5 | 1.24 | 3.6 |
| 8 | w | 0.165 | 0.843 | 7.0 | +1.9 | 1.07 | 2.0 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.173 | 0.900 | | | | |
| 1 | k | 0.158 | 0.876 | 3.9 | -2.4 | 1.09 | 1.4 |
| 2 | k | 0.137 | 0.811 | 9.4 | -6.6 | 1.27 | 3.7 |
| 3 | k | 0.128 | 0.716 | 12.4 | -9.4 | 1.44 | 5.0 |
| 4 | w | 0.143 | 0.608 | 13.7 | -10.8 | 1.50 | 5.4 |
| 5 | k | 0.183 | 0.503 | 16.4 | -10.5 | 1.65 | 5.7 |
| 6 | k | 0.180 | 0.409 | 12.2 | -9.4 | 1.48 | 4.4 |
| 7 | k | 0.166 | 0.343 | 8.6 | -6.6 | 1.28 | 3.0 |
| 8 | k | 0.160 | 0.317 | 3.8 | -2.5 | 1.08 | 1.3 |

