-- ============================================================
-- SplitTab v2.1 — host-only controls, per-phone name locks, parse rate limit
-- ============================================================

-- SHA-256 of the secret host token returned once at room creation.
-- NULL = room created before v2.1 (legacy open mode, no auth enforced).
ALTER TABLE sessions ADD COLUMN host_token_hash TEXT;

-- SHA-256 of the token issued to the first phone that picks this name.
-- NULL = nobody has picked this name yet. The host can reset it.
ALTER TABLE participants ADD COLUMN claim_token_hash TEXT;

-- One row per /api/parse call, used to rate-limit Gemini usage.
-- Rows older than a day are deleted by the daily cron.
CREATE TABLE IF NOT EXISTS parse_log (
  ip         TEXT    NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parse_log_ip_time ON parse_log(ip, created_ms);
CREATE INDEX IF NOT EXISTS idx_parse_log_time ON parse_log(created_ms);
