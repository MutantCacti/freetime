-- Accounts, phase 2 (ACCOUNTS-SPEC.md §2, §7): calendars, joined to their owner as in graph.

CREATE TABLE calendars (
  calendar_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('ical', 'google')),
  label        TEXT NOT NULL,
  secret       BLOB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'disconnected')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE user_calendars (
  user_id      INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  calendar_id  INTEGER NOT NULL REFERENCES calendars ON DELETE CASCADE,
  PRIMARY KEY (user_id, calendar_id)
);
CREATE INDEX user_calendars_calendar ON user_calendars (calendar_id);
