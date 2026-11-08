# Chroma study

How the five colour maps behave at three chroma settings (`PALETTE_CHROMA` 0.60, 0.85 as now, and 1.00), in both themes, measured on calendar cells as they're drawn: the colour, with its dither dots, and for past time the less saturated colour under the page-coloured veil. **Nothing has been changed:** these are findings and recommendations for Maxence.

The sheets (real cells, steps 0–8 from free to busy, the three chroma settings, and the past-time rows) were rendered with Playwright. They aren't in the repository; the study script that made them and these tables was run once and kept out of `scripts/`.

## What was measured

- **Averaged colour.** From arm's length a cell is its colour with its dots blended in: dots cover `level / 16` of the cell at 42% opacity, blended in linear light. Every number below is for that averaged colour, because that's what the eye compares.
- **ΔE**: the OKLab distance between neighbouring steps, ×100. Around 2 is hard to tell apart side by side; 5 or more is clearly different.
- **ΔL**: the change in OKLab lightness, ×100. In the dark theme busy is lighter, so ΔL should be positive at every step; in the light theme busy is darker, so it should be negative.
- **Contrast**: the WCAG ratio between neighbours' averaged colours.
- **C**: the colour's OKLCH chroma before dots, and **gamut**: how much of the requested chroma survived fitting into sRGB.
- **Past ΔE**: the same distance between neighbouring past-time cells (chroma × `PAST_CHROMA`, dots, then a 50% veil of page colour).

## Findings

1. **Chroma isn't the problem.** Going from 0.60 to 1.00 changes neighbour distances by 1–2 ΔE and changes no contrast ratio by more than 0.03. Gamut fitting barely bites: every step keeps at least 95% of its requested chroma (the only bigger cuts are on near-grey steps of cividis, where hue doesn't show). There's no place where clipping makes chroma jump.

2. **The dots, not the colours, cause the sudden switches.** Each step's dots are dark or light, whichever contrasts more with the colour underneath. Where that choice flips, the averaged lightness jumps the wrong way:
   - **Dark theme:** at the flip from light to dark dots (step 2 for parula, 3 for viridis and magma, 4 for cividis and plasma) the cell gets *darker* though it's busier. It's a small step (ΔL −0.8 to −7), but it's there for every map.
   - **Light theme: the busy end flattens out.** Busy colours are dark, so they get light dots, and more dots at higher steps lighten the cell. For viridis, cividis, magma and plasma, steps 6–8 average to almost the same lightness (ΔE 0.8–4.3, contrast 1.00–1.06), and for all five maps the step where the dots flip is *lighter* than the one before it by 0.11–0.20 L (parula the most, at step 7), the biggest lightness change in the whole ramp. In the light theme a fully busy cell can look less busy than a half-busy one. Parula at least keeps its steps 7 and 8 apart (ΔE 5.7).

3. **Step 0 → 1 is always the biggest jump** in the dark theme (ΔE 15–21, contrast 1.8–2.5): free has no dots, and step 1 adds light dots to a dark colour. That's intended: free and "a bit busy" should look different.

4. **Past time is about half as distinct as present time**, as designed, but in the light theme the busiest past steps are indistinguishable (ΔE 0.3–1.0 for viridis, cividis, magma and plasma).

5. **Base colours alone are fine.** Their lightness rises evenly (the existing tests check this for every preset); it's only the averaged cell that goes the wrong way.

## Recommendations (none applied)

- **Keep `PALETTE_CHROMA` at 0.85.** 1.00 adds a little separation (about +1 ΔE per step) and noticeably louder colours; 0.60 loses separation for nothing.
- **Fix the dot flip instead.** Two ways, from least to most change:
  1. In the light theme, always use dark dots on the busy half. Dark dots on the darkest colours show less than light ones, so the dither test (dots at least 1.4:1 against their colour) would need checking for those steps.
  2. Better: set each step's base lightness so the *averaged* cell lightness rises evenly, given that step's dots. The toning pipeline already controls lightness, so this is one extra solve per step; then test the averaged lightness, not just the base colour.
- Per map, at chroma 0.85:
  - **parula:** good in both themes apart from the dot flips (dark step 2, light step 7). Keep.
  - **viridis:** good in dark; in light, steps 6–8 read alike. Needs the dot fix before it's a good light-theme choice.
  - **cividis:** the least distinct overall (max ΔE 11 in light), and its light-theme busy end flattens from step 5. Keep for colour-blind viewers, but it benefits most from the fix.
  - **magma:** good in dark; light steps 6–7 flatten less than viridis. Keep.
  - **plasma:** the most distinct in dark (ΔE 7–16); light flattens from step 5. Keep, with the fix.

## Summary: every map, chroma and theme

ΔE is the OKLab distance between neighbouring steps (×100), measured on what a cell looks like from arm's length: its colour with its dots averaged in. Contrast is the WCAG ratio between neighbours, on the same averaged colours. "Wrong way" lists the steps whose averaged lightness doesn't move towards busy (a cell that looks *less* busy than the one before it). Gamut is the lowest share of the requested chroma a step actually got (1.00 = nothing clipped).

| Map | Chroma | Theme | ΔE min–max | Contrast min–max | Wrong way at steps | Gamut | Past ΔE min |
|---|---|---|---|---|---|---|---|
| parula | 0.60 | dark | 3.0–21.0 | 1.01–2.45 | 2 | 0.99 | 0.8 |
| parula | 0.60 | light | 4.3–20.5 | 1.10–2.20 | 7 | 0.99 | 1.4 |
| parula | 0.85 (now) | dark | 4.7–21.4 | 1.00–2.47 | 2 | 0.99 | 1.2 |
| parula | 0.85 (now) | light | 5.7–20.9 | 1.10–2.20 | 7 | 0.99 | 1.6 |
| parula | 1.00 | dark | 5.5–21.4 | 1.01–2.46 | 2 | 0.95 | 1.4 |
| parula | 1.00 | light | 6.4–21.2 | 1.10–2.18 | 7 | 0.95 | 1.7 |
| viridis | 0.60 | dark | 5.2–15.1 | 1.17–1.89 | 3 | 1.00 | 2.3 |
| viridis | 0.60 | light | 1.1–17.4 | 1.00–1.96 | 6, 7, 8 | 1.00 | 0.2 |
| viridis | 0.85 (now) | dark | 6.1–15.6 | 1.16–1.92 | 3 | 0.99 | 2.6 |
| viridis | 0.85 (now) | light | 1.5–17.7 | 1.00–1.95 | 6, 7, 8 | 0.99 | 0.3 |
| viridis | 1.00 | dark | 6.6–15.9 | 1.16–1.93 | 3 | 0.99 | 2.7 |
| viridis | 1.00 | light | 1.9–18.1 | 1.00–1.95 | 6, 7, 8 | 0.99 | 0.4 |
| cividis | 0.60 | dark | 4.3–14.7 | 1.17–1.86 | 4 | 0.99 | 2.2 |
| cividis | 0.60 | light | 0.8–11.1 | 1.00–1.54 | 5, 7, 8 | 0.99 | 0.2 |
| cividis | 0.85 (now) | dark | 4.6–14.8 | 1.17–1.87 | 4 | 0.98 | 2.3 |
| cividis | 0.85 (now) | light | 1.2–11.1 | 1.00–1.54 | 5, 7, 8 | 0.98 | 0.3 |
| cividis | 1.00 | dark | 4.8–14.8 | 1.17–1.86 | 4 | 0.99 | 2.3 |
| cividis | 1.00 | light | 1.5–11.2 | 1.00–1.54 | 5, 7, 8 | 0.99 | 0.3 |
| magma | 0.60 | dark | 5.1–17.2 | 1.15–2.04 | 3 | 0.99 | 2.1 |
| magma | 0.60 | light | 1.9–16.8 | 1.03–1.94 | 6, 7 | 0.99 | 0.6 |
| magma | 0.85 (now) | dark | 6.4–17.6 | 1.15–2.04 | 3 | 0.98 | 2.4 |
| magma | 0.85 (now) | light | 2.6–17.5 | 1.03–1.97 | 6, 7 | 0.98 | 0.7 |
| magma | 1.00 | dark | 7.2–17.7 | 1.15–2.03 | 3 | 0.95 | 2.6 |
| magma | 1.00 | light | 3.0–18.1 | 1.03–1.99 | 6, 7 | 0.95 | 0.8 |
| plasma | 0.60 | dark | 5.9–15.1 | 1.21–1.81 | 4 | 0.99 | 2.6 |
| plasma | 0.60 | light | 1.7–12.9 | 1.01–1.64 | 5, 7, 8 | 0.99 | 0.4 |
| plasma | 0.85 (now) | dark | 7.2–15.9 | 1.21–1.81 | 4 | 1.00 | 2.9 |
| plasma | 0.85 (now) | light | 2.4–13.9 | 1.02–1.65 | 5, 7, 8 | 1.00 | 0.6 |
| plasma | 1.00 | dark | 8.0–16.4 | 1.21–1.81 | 4 | 0.98 | 3.1 |
| plasma | 1.00 | light | 2.8–14.5 | 1.02–1.66 | 5, 7, 8 | 0.98 | 0.7 |

## Step by step at the current chroma (0.85)

Step 0 is free, step 8 fully busy. Dots: k = dark dots, w = light dots (whichever contrasts more with the colour underneath). L is the averaged lightness (OKLab), C the colour's chroma before dots. ΔE, ΔL and contrast are measured from the step before.

### parula

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.126 | 0.360 | | | | |
| 1 | w | 0.175 | 0.568 | 21.4 | +20.8 | 2.47 | 11.3 |
| 2 | k | 0.128 | 0.560 | 4.7 | -0.7 ⚠ | 1.00 | 1.2 |
| 3 | k | 0.102 | 0.614 | 8.2 | +5.4 | 1.28 | 3.4 |
| 4 | k | 0.099 | 0.638 | 7.2 | +2.4 | 1.12 | 2.3 |
| 5 | k | 0.098 | 0.658 | 6.2 | +1.9 | 1.06 | 2.1 |
| 6 | k | 0.103 | 0.688 | 7.3 | +3.0 | 1.09 | 2.5 |
| 7 | k | 0.138 | 0.725 | 5.1 | +3.7 | 1.14 | 2.3 |
| 8 | k | 0.177 | 0.794 | 9.5 | +6.9 | 1.31 | 4.3 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.177 | 0.901 | | | | |
| 1 | k | 0.138 | 0.797 | 12.8 | -10.3 | 1.44 | 5.4 |
| 2 | k | 0.103 | 0.732 | 7.7 | -6.5 | 1.25 | 3.3 |
| 3 | k | 0.098 | 0.679 | 8.8 | -5.3 | 1.18 | 3.0 |
| 4 | k | 0.099 | 0.638 | 7.2 | -4.0 | 1.16 | 2.6 |
| 5 | k | 0.102 | 0.595 | 7.9 | -4.3 | 1.21 | 2.5 |
| 6 | k | 0.128 | 0.526 | 9.0 | -6.9 | 1.37 | 3.4 |
| 7 | w | 0.175 | 0.729 | 20.9 | +20.2 ⚠ | 2.20 | 9.7 |
| 8 | w | 0.126 | 0.703 | 5.7 | -2.6 | 1.10 | 1.6 |

### viridis

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.117 | 0.360 | | | | |
| 1 | w | 0.107 | 0.507 | 15.6 | +14.8 | 1.92 | 8.1 |
| 2 | w | 0.083 | 0.579 | 8.2 | +7.2 | 1.38 | 4.1 |
| 3 | k | 0.069 | 0.538 | 6.1 | -4.1 ⚠ | 1.16 | 2.6 |
| 4 | k | 0.082 | 0.592 | 7.1 | +5.4 | 1.27 | 3.1 |
| 5 | k | 0.110 | 0.635 | 6.3 | +4.3 | 1.20 | 2.8 |
| 6 | k | 0.147 | 0.688 | 7.4 | +5.3 | 1.23 | 3.3 |
| 7 | k | 0.165 | 0.737 | 7.0 | +4.9 | 1.18 | 3.0 |
| 8 | k | 0.158 | 0.793 | 8.1 | +5.6 | 1.19 | 3.5 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.158 | 0.899 | | | | |
| 1 | k | 0.165 | 0.811 | 11.0 | -8.8 | 1.30 | 4.6 |
| 2 | k | 0.147 | 0.733 | 9.7 | -7.8 | 1.30 | 4.1 |
| 3 | k | 0.110 | 0.656 | 9.6 | -7.7 | 1.34 | 3.9 |
| 4 | k | 0.082 | 0.592 | 8.0 | -6.4 | 1.31 | 3.2 |
| 5 | k | 0.069 | 0.521 | 8.4 | -7.1 | 1.37 | 3.3 |
| 6 | w | 0.083 | 0.692 | 17.7 | +17.1 ⚠ | 1.95 | 8.1 |
| 7 | w | 0.107 | 0.703 | 1.9 | +1.0 ⚠ | 1.03 | 0.6 |
| 8 | w | 0.117 | 0.703 | 1.5 | -0.0 ⚠ | 1.00 | 0.3 |

### cividis

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.078 | 0.359 | | | | |
| 1 | w | 0.088 | 0.507 | 14.8 | +14.7 | 1.87 | 7.9 |
| 2 | w | 0.042 | 0.579 | 8.1 | +7.3 | 1.36 | 4.1 |
| 3 | w | 0.014 | 0.659 | 8.2 | +8.0 | 1.38 | 4.5 |
| 4 | k | 0.006 | 0.595 | 6.6 | -6.4 ⚠ | 1.29 | 3.6 |
| 5 | k | 0.033 | 0.633 | 4.6 | +3.8 | 1.17 | 2.3 |
| 6 | k | 0.072 | 0.689 | 6.6 | +5.6 | 1.24 | 3.2 |
| 7 | k | 0.114 | 0.736 | 6.0 | +4.7 | 1.19 | 2.8 |
| 8 | k | 0.153 | 0.793 | 6.6 | +5.7 | 1.23 | 3.3 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.153 | 0.900 | | | | |
| 1 | k | 0.114 | 0.810 | 9.9 | -9.0 | 1.34 | 4.5 |
| 2 | k | 0.072 | 0.733 | 8.8 | -7.7 | 1.31 | 3.8 |
| 3 | k | 0.033 | 0.654 | 8.8 | -8.0 | 1.35 | 3.9 |
| 4 | k | 0.006 | 0.595 | 6.4 | -5.9 | 1.27 | 2.8 |
| 5 | w | 0.014 | 0.705 | 11.1 | +11.1 ⚠ | 1.54 | 5.2 |
| 6 | w | 0.042 | 0.693 | 1.7 | -1.3 | 1.05 | 0.7 |
| 7 | w | 0.088 | 0.703 | 1.5 | +1.0 ⚠ | 1.04 | 0.5 |
| 8 | w | 0.078 | 0.703 | 1.2 | -0.0 ⚠ | 1.00 | 0.3 |

### magma

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.028 | 0.360 | | | | |
| 1 | w | 0.080 | 0.531 | 17.6 | +17.1 | 2.04 | 9.3 |
| 2 | w | 0.138 | 0.606 | 9.1 | +7.5 | 1.33 | 4.4 |
| 3 | k | 0.141 | 0.566 | 6.7 | -3.9 ⚠ | 1.21 | 2.8 |
| 4 | k | 0.149 | 0.614 | 7.7 | +4.8 | 1.21 | 3.1 |
| 5 | k | 0.157 | 0.649 | 6.4 | +3.4 | 1.15 | 2.4 |
| 6 | k | 0.130 | 0.697 | 7.4 | +4.8 | 1.23 | 3.1 |
| 7 | k | 0.086 | 0.740 | 7.5 | +4.3 | 1.21 | 3.0 |
| 8 | k | 0.067 | 0.793 | 7.5 | +5.3 | 1.23 | 3.3 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.067 | 0.899 | | | | |
| 1 | k | 0.086 | 0.814 | 10.3 | -8.6 | 1.35 | 4.4 |
| 2 | k | 0.130 | 0.742 | 9.7 | -7.2 | 1.33 | 3.9 |
| 3 | k | 0.157 | 0.670 | 9.2 | -7.2 | 1.34 | 3.8 |
| 4 | k | 0.149 | 0.614 | 7.9 | -5.5 | 1.25 | 2.9 |
| 5 | k | 0.141 | 0.549 | 8.9 | -6.6 | 1.30 | 3.2 |
| 6 | w | 0.138 | 0.708 | 17.5 | +15.9 ⚠ | 1.97 | 7.8 |
| 7 | w | 0.080 | 0.713 | 4.3 | +0.4 ⚠ | 1.03 | 1.0 |
| 8 | w | 0.028 | 0.703 | 2.6 | -1.0 | 1.03 | 0.7 |

### plasma

**dark theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | w | 0.160 | 0.360 | | | | |
| 1 | w | 0.175 | 0.502 | 15.9 | +14.2 | 1.81 | 8.0 |
| 2 | w | 0.188 | 0.573 | 8.4 | +7.0 | 1.33 | 4.1 |
| 3 | w | 0.173 | 0.651 | 9.7 | +7.8 | 1.39 | 4.5 |
| 4 | k | 0.144 | 0.579 | 9.5 | -7.2 ⚠ | 1.36 | 4.4 |
| 5 | k | 0.133 | 0.622 | 7.2 | +4.3 | 1.21 | 2.9 |
| 6 | k | 0.129 | 0.679 | 8.3 | +5.7 | 1.28 | 3.6 |
| 7 | k | 0.140 | 0.731 | 8.0 | +5.2 | 1.24 | 3.3 |
| 8 | k | 0.173 | 0.794 | 9.4 | +6.3 | 1.29 | 4.1 |

**light theme**

| Step | Dots | C | L | ΔE | ΔL | Contrast | Past ΔE |
|---|---|---|---|---|---|---|---|
| 0 | k | 0.173 | 0.900 | | | | |
| 1 | k | 0.140 | 0.804 | 12.6 | -9.6 | 1.41 | 5.2 |
| 2 | k | 0.129 | 0.723 | 10.5 | -8.1 | 1.37 | 4.3 |
| 3 | k | 0.133 | 0.642 | 10.2 | -8.1 | 1.39 | 4.2 |
| 4 | k | 0.144 | 0.579 | 8.5 | -6.3 | 1.31 | 3.3 |
| 5 | w | 0.173 | 0.699 | 13.9 | +12.0 ⚠ | 1.65 | 6.0 |
| 6 | w | 0.188 | 0.689 | 3.7 | -1.0 | 1.03 | 0.9 |
| 7 | w | 0.175 | 0.701 | 3.3 | +1.2 ⚠ | 1.06 | 1.0 |
| 8 | w | 0.160 | 0.703 | 2.4 | +0.2 ⚠ | 1.02 | 0.6 |

