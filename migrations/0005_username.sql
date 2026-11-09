-- Usernames (the profile address /@<username>): 3 to 20 of a–z, 0–9 and _, stored
-- lower-case and unique ignoring case. NULL until chosen: accounts made before this
-- keep /u/<public_id> until they pick one. The rules, reserved words included, are
-- in src/accounts/username.ts; the database only refuses the shape.

ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE
  CHECK (username IS NULL OR (length(username) BETWEEN 3 AND 20 AND username NOT GLOB '*[^a-z0-9_]*'));

CREATE UNIQUE INDEX users_username ON users (username);
