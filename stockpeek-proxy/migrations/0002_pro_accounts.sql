-- P6 Pro accounts, immutable credit ledger, idempotent report jobs and payment orders.
-- Apply after 0001. Holds e-mail addresses and purchase records; no holdings or theses
-- except inside short-lived report results (purged after 7 days, see pro/reports.js).

-- email is NULL for device-only accounts until the user links one (optional, for recovery).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  customer_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- One pending sign-in code per e-mail. Only a peppered hash is stored.
CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Fixed-window counters for abuse limits (bucket = hashed e-mail / IP / user).
CREATE TABLE IF NOT EXISTS rate_counters (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Append-only. Balance = SUM(amount). (kind, ref) is unique so a webhook/redirect,
-- settlement or release can never be applied twice.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'purchase', 'reserve', 'use', 'release', 'refund', 'adjust')),
  amount INTEGER NOT NULL,
  ref TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (kind, ref)
);
CREATE INDEX IF NOT EXISTS credit_ledger_user ON credit_ledger(user_id);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  error TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('toss')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL CHECK (status IN ('created', 'confirming', 'paid', 'failed')),
  checkout_token_hash TEXT NOT NULL UNIQUE,
  checkout_expires_at TEXT NOT NULL,
  payment_key TEXT,
  approved_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
