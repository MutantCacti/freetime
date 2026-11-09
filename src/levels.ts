// The busy fraction is shown in LEVELS steps: free, then five busy steps.
// Each step has one colour and one dot layer (DITHER_LAYERS in dither.ts);
// labels still give the real percentage.

export const LEVELS = 6;

/**
 * The step (0 … LEVELS − 1) for a busy fraction. Rounds to the nearest step,
 * except that any busy time is at least step 1 and anything short of fully
 * busy is at most step LEVELS − 2, so busy time never looks free and a gap
 * never looks fully busy. With 6 steps: 0 → 0; under 0.3 → 1; 0.3 to under
 * 0.5 → 2; 0.5 to under 0.7 → 3; 0.7 to under 1 → 4; 1 → 5.
 */
export function busyStep(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (f === 0) return 0;
  if (f === 1) return LEVELS - 1;
  return Math.min(LEVELS - 2, Math.max(1, Math.round(f * (LEVELS - 1))));
}
