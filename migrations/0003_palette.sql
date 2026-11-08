-- Each user's colour map for their profile (ACCOUNTS-SPEC.md §3, §8).
-- The allowed names are PALETTE_NAMES in src/parula.ts; keep the two in step.

ALTER TABLE users ADD COLUMN palette TEXT NOT NULL DEFAULT 'parula'
  CHECK (palette IN ('parula', 'viridis', 'cividis', 'magma', 'plasma'));
