// Busy fractions: how much of a slot is covered by busy intervals.

import type { Interval } from "./ical";

/** Sort and merge overlapping intervals, so overlaps never count twice. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** Fraction of [start, end) that is busy, 0–1. `merged` must be merged and sorted. */
export function busyFraction(merged: Interval[], start: number, end: number): number {
  if (end <= start) return 0;
  let covered = 0;
  for (const iv of merged) {
    if (iv.end <= start) continue;
    if (iv.start >= end) break;
    covered += Math.min(end, iv.end) - Math.max(start, iv.start);
  }
  return Math.min(1, covered / (end - start));
}

/** Clip merged intervals to [from, to). */
export function clipIntervals(merged: Interval[], from: number, to: number): Interval[] {
  return merged
    .filter((iv) => iv.end > from && iv.start < to)
    .map((iv) => ({ start: Math.max(from, iv.start), end: Math.min(to, iv.end) }));
}
