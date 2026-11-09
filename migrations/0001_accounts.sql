-- Accounts, phase 1 (ACCOUNTS-SPEC.md §2): users, sessions, emailed tokens, and attempt counts for the limits.

CREATE TABLE users (
  user_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  bio             TEXT NOT NULL DEFAULT '',
  zone            TEXT NOT NULL,
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT,
  google_sub      TEXT UNIQUE,
  picture_key     TEXT,
  invite_code     TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'change')),
  new_email   TEXT,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX email_tokens_user ON email_tokens (user_id);

CREATE TABLE attempts (
  key  TEXT NOT NULL,
  at   INTEGER NOT NULL
);
CREATE INDEX attempts_key ON attempts (key, at);
