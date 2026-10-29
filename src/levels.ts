// The busy fraction is shown in LEVELS steps (0, 1/8, …, 1). Colour and
// dither both use the same step; labels still give the real percentage.

export const LEVELS = 9;

/**
 * The step (0 … LEVELS − 1) for a busy fraction. Rounds to the nearest step,
 * except that any busy time is at least step 1 and anything short of fully
 * busy is at most step LEVELS − 2, so busy time never looks free and a gap
 * never looks fully busy.
 */
export function busyStep(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (f === 0) return 0;
  if (f === 1) return LEVELS - 1;
  return Math.min(LEVELS - 2, Math.max(1, Math.round(f * (LEVELS - 1))));
}
