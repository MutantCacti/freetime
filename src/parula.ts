// MATLAB's parula colormap as a fixed 64-entry lookup table, low to high.
// This file and public/css/tokens.css are the only places hex colours may
// appear (test/colour-rule.test.ts enforces it).

export const PARULA: readonly string[] = [
  "#352a87", "#363093", "#3637a0", "#353dad", "#3243ba", "#2c4ac7", "#2053d4", "#0f5cdd",
  "#0363e1", "#0268e1", "#046de0", "#0871de", "#0d75dc", "#1079da", "#127dd8", "#1481d6",
  "#1485d4", "#1389d3", "#108ed2", "#0c93d2", "#0998d1", "#079ccf", "#06a0cd", "#06a4ca",
  "#06a7c6", "#07a9c2", "#0aacbe", "#0faeb9", "#15b1b4", "#1db3af", "#25b5a9", "#2eb7a4",
  "#38b99e", "#42bb98", "#4dbc92", "#59bd8c", "#65be86", "#71bf80", "#7cbf7b", "#87bf77",
  "#92bf73", "#9cbf6f", "#a5be6b", "#aebe67", "#b7bd64", "#c0bc60", "#c8bc5d", "#d1bb59",
  "#d9ba56", "#e1b952", "#e9b94e", "#f1b94a", "#f8bb44", "#fdbe3d", "#ffc337", "#fec832",
  "#fcce2e", "#fad32a", "#f7d826", "#f5de21", "#f5e41d", "#f5eb18", "#f6f313", "#f9fb0e",
];

/** Index into PARULA for a busy fraction in [0, 1]. */
export function parulaIndex(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.round(f * (PARULA.length - 1));
}

export function parulaColour(fraction: number): string {
  return PARULA[parulaIndex(fraction)]!;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * Whether dither dots on this entry are dark ("k") or light ("w"): whichever
 * contrasts more with the colour underneath. Same in both themes.
 */
export function dotTone(index: number): "k" | "w" {
  const l = luminance(PARULA[index]!);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "k" : "w";
}
