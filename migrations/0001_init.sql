-- ============================================================
-- SplitTab v2 schema — Cloudflare D1 (SQLite)
-- All money is stored as INTEGER paise (₹1 = 100) to avoid float drift.
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT PRIMARY KEY,               -- 8-char room code, e.g. k3f9x2qa
  merchant_name      TEXT,
  host_name          TEXT NOT NULL,
  host_vpa           TEXT NOT NULL,
  subtotal_paise     INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  cgst_paise         INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise         INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  liquor_vat_paise   INTEGER NOT NULL DEFAULT 0 CHECK (liquor_vat_paise >= 0),
  service_charge_paise INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_paise >= 0),
  grand_total_paise  INTEGER NOT NULL DEFAULT 0 CHECK (grand_total_paise >= 0),
  actual_paid_paise  INTEGER CHECK (actual_paid_paise IS NULL OR actual_paid_paise > 0), -- NULL = no platform discount
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

CREATE TABLE IF NOT EXISTS participants (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  is_host        INTEGER NOT NULL DEFAULT 0 CHECK (is_host IN (0, 1)),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID'
                 CHECK (payment_status IN ('UNPAID', 'SELF_PAID', 'HOST_CONFIRMED')),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, name COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);

CREATE TABLE IF NOT EXISTS line_items (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  item_name         TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_price_paise INTEGER NOT NULL CHECK (total_price_paise >= 0),
  is_alcohol        INTEGER NOT NULL DEFAULT 0 CHECK (is_alcohol IN (0, 1)),
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_line_items_session ON line_items(session_id);

-- Junction table. session_id is denormalised so a room's claims are read
-- with one indexed lookup (and can never leak across rooms).
CREATE TABLE IF NOT EXISTS item_claims (
  line_item_id   TEXT NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (line_item_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_item_claims_session ON item_claims(session_id);
