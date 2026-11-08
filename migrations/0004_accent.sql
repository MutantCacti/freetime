-- Each user's accent colour, picked from their picture (src/accounts/accent.ts):
-- lower-case #rrggbb, or NULL when there's no picture. Pictures stored before
-- this have no accent until they're uploaded again.

ALTER TABLE users ADD COLUMN accent TEXT
  CHECK (accent IS NULL OR (length(accent) = 7 AND accent GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'));
