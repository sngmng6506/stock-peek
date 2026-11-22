-- Operator-only P4 rate limiting. No user identifiers, holdings, or generated reports stored.
CREATE TABLE IF NOT EXISTS analysis_daily_usage (
  day TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, token_hash)
);
