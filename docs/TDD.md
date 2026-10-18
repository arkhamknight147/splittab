# Technical Design Document (TDD)

*System Architecture & Implementation Specification: SplitTab · Version: 2.1 \| Status: Live on Cloudflare (splittab.splittabsubdomain.workers.dev)*

| Field                     | Value                                                                                                         |
|---------------------------|---------------------------------------------------------------------------------------------------------------|
| System Name               | SplitTab (Zero-Install Collaborative Bill Split Engine)                                                       |
| Target Stack              | Single-file Vanilla JS + Tailwind web app • Cloudflare Workers • Cloudflare D1 (SQLite) • Gemini Flash Vision |
| Protocols & Rails         | NPCI UPI Deep Link (intent URI) • same-origin JSON REST over HTTPS                                            |
| Author & Engineering Lead | Senior Technical Product Manager & Platform Architect                                                         |
| Target Deployment         | Cloudflare Workers (static assets + API) + D1, deployed with the wrangler CLI                                 |

## 1. Architecture Overview & High-Level Design

SplitTab is a zero-install web app. One Cloudflare Worker serves the single-file frontend and a small JSON API; Cloudflare D1 stores rooms; Gemini Flash reads receipts. There is no build step: the frontend is plain HTML/JS, and wrangler only uploads files and bundles the Worker. Every component runs on a permanent free tier.

### 1.1 Structural Component Architecture

• **Client Layer (public/index.html + app.css):** Setup, Review & Edit, Claim and Summary views; canvas image compression; the split engine (a pure function); UPI deep links; host / participant tokens kept in localStorage. No API secrets in the page.

• **API Layer (src/worker.js):** seven endpoints with input validation, token checks and a scan rate limit; the only holder of the Gemini key and the D1 binding; a daily cron for room expiry and log clean-up.

• **Vision Extraction Engine:** Gemini Flash at temperature 0 with a response schema, a configurable model and an automatic fallback.

• **State Layer (Cloudflare D1):** four relational tables; money in integer paise; foreign keys with cascade delete.

• **Settlement Bridge:** client-side NPCI UPI intent URIs with iOS app-scheme and clipboard fallbacks.

> **End-to-End Data Pipeline***  
> Host snaps photo → canvas JPEG → POST /api/parse → Gemini Flash (structured JSON) → host Review & Edit → POST /api/rooms (one D1 batch, host token returned) → /r/{code} shared on WhatsApp → diners pick a name (POST /join locks it to the phone) → PUT /claims → browser split engine → UPI intent → PATCH status → host Verify.*

### 1.2 Repository Layout

```text
splittab/
├── .github/workflows/ci.yml       # CI: unit tests, CSS up to date, Worker bundles
├── docs/
│   ├── PRD.md                     # product requirements
│   ├── TDD.md                     # this document
│   ├── ARCHITECTURE.md            # architecture & split maths
│   └── images/                    # screenshots used in the README
├── migrations/
│   ├── 0001_init.sql              # D1 schema (money in paise)
│   └── 0002_host_controls_rate_limit.sql
├── public/                        # static site served by the Worker
│   ├── index.html                 # entire frontend (HTML + vanilla JS)
│   ├── app.css                    # pre-built Tailwind (npm run css)
│   └── og.png, favicon.*          # link preview + icons
├── src/
│   ├── worker.js                  # API, auth, rate limit, cron
│   └── styles/tailwind.css        # Tailwind source for app.css
├── tests/
│   ├── math.test.mjs              # split-engine unit tests (node, no deps)
│   ├── api_test.py                # auth / payment-rule / rate-limit checks
│   └── e2e.py                     # Playwright end-to-end test
├── CHANGELOG.md
├── wrangler.toml                  # Worker, D1 binding (DB), vars, logs, cron
└── package.json                   # wrangler + tailwind CLI scripts (no bundler)
```

## 2. Data Models & Database Schema (Cloudflare D1 / SQLite)

The schema stays normalised (rooms → participants, line items → claims) and adds integrity the v1.0 SQL was missing: CHECK constraints on money and statuses, a case-insensitive unique name per room, and a denormalised session_id on item_claims so a room's claims are read with one indexed lookup and can never leak across rooms (v1.0 fetched every claim in the database).

```sql
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
```

## 3. Vision AI Extraction Schema & Prompt Engineering

POST /api/parse receives the compressed JPEG as a raw base64 text body. The Worker builds the Gemini request by string concatenation, so the large image string is never parsed or re-serialised, which keeps CPU time within the free plan's 10 ms budget. Nothing is written to the database at this step except one parse_log row used for rate limiting (default 6 scans per IP per minute, 300 per day; HTTP 429 beyond that).

### 3.1 System Prompt Contract

```text
You are an expert OCR parser for Indian restaurant bills.
Read the receipt image and return JSON that matches the response schema exactly.
Rules:
1. "items" = every ordered food / drink line. Never include tax, service charge, discount, round-off or total lines as items.
2. total_price = the line amount printed on the bill (quantity x unit price). Use rupees as plain numbers (e.g. 380 or 92.5), no currency symbols.
3. is_alcohol = true only for alcoholic drinks (beer, draught, pint, pitcher, wine, whisky, vodka, rum, gin, tequila, cocktail, LIIT, breezer, cider, shots). Mocktails, soft drinks, juices, tea and coffee are false.
4. cgst_amount / sgst_amount = the CGST and SGST amounts. If the bill shows a single "GST" amount, put half in each.
5. liquor_vat_amount = VAT / excise / "VAT on liquor" amount (0 if absent).
6. service_charge = service charge amount in rupees (0 if absent).
7. discount_amount = any discount printed on the bill (positive number, 0 if absent). round_off = the round-off line (can be negative, 0 if absent).
8. grand_total = the final payable amount printed on the bill.
9. If a value is unreadable, use 0. Do not guess items that are not on the bill.
```

### 3.2 Target Response Schema (Gemini structured output)

```js
generationConfig: {
  temperature: 0,
  responseMimeType: "application/json",
  responseSchema: {
    type: OBJECT,
    properties: {
      merchant_name: STRING,
      items: ARRAY of {
        item_name: STRING, quantity: NUMBER, unit_price: NUMBER,
        total_price: NUMBER, is_alcohol: BOOLEAN
      },                       // required: item_name, quantity, total_price, is_alcohol
      subtotal, cgst_amount, sgst_amount, liquor_vat_amount,
      service_charge, discount_amount, round_off, grand_total: NUMBER
    },
    required: [items, cgst_amount, sgst_amount, liquor_vat_amount, service_charge, grand_total]
  }
}
```

### 3.3 Model Selection, Fallback & Normalisation

• **Configurable models:** GEMINI_MODEL (default gemini-3.6-flash) and GEMINI_FALLBACK_MODEL (default gemini-3.1-flash-lite) in wrangler.toml. The fallback is tried on HTTP 404, 429, 500 or 503.

• **Defensive parsing:** markdown fences are stripped if present; numbers are coerced; items with no price are dropped; total_price is derived from quantity × unit_price if missing.

• **Normalisation:** rupees are converted to integer paise; names are trimmed, stripped of control characters and \< \>, and capped at 40–80 characters. discount_paise and round_off_paise are returned for the host's Review check only (the split already scales to the printed or paid total).

• **Zero items:** returns 422 with a message that sends the host to manual entry.

• **Mock mode:** GEMINI_MOCK = "1" returns the Bangalore Bistro bill, so the full flow can be tested without an API key.

## 4. Mathematical Calculation Engine & Business Logic

The allocation engine is a deterministic pure function, computeSplit(session, participants, items, claims), in index.html. It runs in the browser on every render, so a diner's total updates the instant they tap. It replaces the v1.0 Postgres function, which was specified but never deployed. All inputs and outputs are in paise.

### 4.1 Formal Mathematical Formulation

• **Shared dish apportionment:** share(u, i) = P_i / N_i for each of the N_i claimants of item i. Claims by unknown participant ids are ignored.

• **Bucket totals:** B_food = Σ P_i over food items; B_liq = Σ P_j over alcohol items (all items, claimed or not).

• **Service charge split:** SC_food = SC × B_food / B_total; SC_liq = SC × B_liq / B_total.

• **Multipliers:** M_food = 1 + (CGST + SGST + SC_food) / B_food; M_liq = 1 + (VAT + SC_liq) / B_liq. If a bucket is empty, its overhead moves to the other bucket.

• **Scaling:** C = B_food·M_food + B_liq·M_liq; Target = actual_paid, else grand_total, else C; δ = Target / C.

• **Final share:** F(u) = δ × (Food_u·M_food + Liq_u·M_liq). Unclaimed items are computed the same way into U.

• **Rounding:** guests use Math.round to the paisa; U is rounded; the host gets Target − Σ guests − U. Conservation is exact.

### 4.2 Reference Implementation (public/index.html)

```js
function computeSplit(session, participants, items, claims) {
  const claimMap = {};
  for (const c of claims) (claimMap[c.line_item_id] = claimMap[c.line_item_id] || []).push(c.participant_id);

  let bFood = 0, bLiq = 0;
  for (const i of items) { if (i.is_alcohol) bLiq += i.total_price_paise; else bFood += i.total_price_paise; }
  const bTotal = bFood + bLiq;

  const sc = session.service_charge_paise || 0;
  const gst = (session.cgst_paise || 0) + (session.sgst_paise || 0);
  const vat = session.liquor_vat_paise || 0;
  const scFood = bTotal > 0 ? sc * bFood / bTotal : 0;
  const scLiq = bTotal > 0 ? sc * bLiq / bTotal : 0;

  // Overheads stay in their own bucket. If a bucket has no items (e.g. VAT printed
  // but no item flagged as alcohol) its overhead moves to the other bucket so no rupee is lost.
  let overFood = gst + scFood, overLiq = vat + scLiq;
  if (bFood === 0) { overLiq += overFood; overFood = 0; }
  if (bLiq === 0) { overFood += overLiq; overLiq = 0; }
  const mFood = bFood > 0 ? 1 + overFood / bFood : 1;
  const mLiq = bLiq > 0 ? 1 + overLiq / bLiq : 1;

  // Computed bill = items + taxes + service charge. Scale it to what the host actually paid
  // (or the printed total), which also absorbs round-off and printed discounts.
  const computedTotal = bFood * mFood + bLiq * mLiq;
  const printedTotal = session.grand_total_paise || 0;
  const targetTotal = session.actual_paid_paise > 0 ? session.actual_paid_paise
    : printedTotal > 0 ? printedTotal : Math.round(computedTotal);
  const delta = computedTotal > 0 ? targetTotal / computedTotal : 1;

  const people = {};
  for (const p of participants) people[p.id] = { baseFood: 0, baseLiq: 0 };
  const unclaimed = { items: [], base: 0, raw: 0 };

  for (const i of items) {
    const who = (claimMap[i.id] || []).filter((pid) => people[pid]);
    const m = i.is_alcohol ? mLiq : mFood;
    if (who.length === 0) {
      unclaimed.items.push(i);
      unclaimed.base += i.total_price_paise;
      unclaimed.raw += i.total_price_paise * m;
      continue;
    }
    const share = i.total_price_paise / who.length;
    for (const pid of who) { if (i.is_alcohol) people[pid].baseLiq += share; else people[pid].baseFood += share; }
  }

  // Round to whole paise. Every non-host is rounded normally; the host absorbs the
  // ±1–2 paise residual so shares + unclaimed always equal targetTotal exactly.
  const host = participants.find((p) => p.is_host) || participants[0];
  let assigned = 0;
  for (const p of participants) {
    const r = people[p.id];
    r.base = r.baseFood + r.baseLiq;
    r.raw = r.baseFood * mFood + r.baseLiq * mLiq;
    r.exact = r.raw * delta;
    r.overhead = r.raw - r.base;
    r.adjustment = r.exact - r.raw;
    if (!host || p.id !== host.id) { r.paise = Math.round(r.exact); assigned += r.paise; }
  }
  unclaimed.exact = unclaimed.raw * delta;
  unclaimed.paise = Math.round(unclaimed.exact);
  if (host) people[host.id].paise = targetTotal - assigned - unclaimed.paise;

  return { claimMap, people, unclaimed, mFood, mLiq, delta, bFood, bLiq, computedTotal, printedTotal, targetTotal };
}
```

### 4.3 Verification

| Test                      | Scenario                                                                                                                        | Expected Result                                                        |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| Case study                | Bangalore Bistro, host paid ₹1,100 of ₹1,331                                                                                    | Rohan ₹480.95, Priya ₹203.27, Amit ₹415.78; sum ₹1,100.00              |
| No discount               | Same claims, no amount paid entered                                                                                             | Shares sum to ₹1,331.00                                                |
| Equity guarantee          | Add ₹64 liquor VAT                                                                                                              | Priya (non-drinker) unchanged; Rohan absorbs the VAT; sum = new total  |
| Unclaimed items           | Nobody claims the biryani                                                                                                       | Biryani listed as unclaimed; shares + unclaimed = ₹1,100.00            |
| Round-off                 | Printed total ₹1,330 vs computed ₹1,331                                                                                         | Shares sum to ₹1,330.00                                                |
| Empty bucket              | VAT printed but no item marked alcohol                                                                                          | VAT moves to food bucket; nothing lost                                 |
| Awkward splits            | ₹100 split 3 ways                                                                                                               | Guests rounded; host residual ≤ 2 paise; exact sum                     |
| API (tests/api_test.py)   | 22 checks: host token, name locks, claim/verify permissions, unlock, \> 2x paid rejected, rate limit                            | All pass against wrangler dev (mock Gemini)                            |
| End-to-end (tests/e2e.py) | Playwright: host + 3 diners + an intruder phone + host link on a 2nd device; fast taps; paid-amount and discount checks; assets | 23 checks pass; same amounts in UI and upi:// links; no console errors |
| Legacy rooms              | Room created before v2.1 (no host token)                                                                                        | Open mode: claims and verify still work                                |

## 5. Payment Rails & UPI Deep-Link Integration

SplitTab never touches money. It builds an NPCI UPI intent URI with the exact amount and hands it to the phone's UPI app.

### 5.1 URI Specification & Field Encoding

upi://pay?pa={VPA}&pn={NAME}&am={AMOUNT}&cu=INR&tn={NOTE}

• **pa (Payee Address):** host VPA, validated on the server against name@handle. The "@" is left literal because some UPI apps reject %40.

• **pn (Payee Name):** URL-encoded host name.

• **am (Amount):** guest share in paise ÷ 100, always 2 decimals (e.g. 480.95). The button is disabled at ₹0.

• **cu (Currency):** INR. **tn (Note):** "SplitTab-{room_code}" (no spaces), so the host can match credits in their bank app.

• **tr omitted:** a transaction reference is meant for merchant collection flows; for person-to-person payments some apps reject it.

### 5.2 Cross-Platform Matrix & iOS Sandbox Fallbacks

| Client Platform / Browser                  | Primary Intent Mechanism                                                      | Fallback Strategy                                                                      |
|--------------------------------------------|-------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| Android (Chrome / WhatsApp in-app browser) | Same-tab navigation to upi://pay (no target=\_blank, which webviews block)    | OS app chooser: GPay, PhonePe, Paytm, BHIM, CRED                                       |
| iOS Safari / WhatsApp webview              | App buttons: gpay://upi/pay, phonepe://pay, paytmmp://pay (shown only on iOS) | Copy UPI ID (VPA only, pasteable into "Pay to UPI ID") with the amount shown on screen |
| Any app that blocks link payments          | Intent opens but the app declines                                             | Same Copy UPI ID path, explained under the Pay button                                  |
| Desktop browsers                           | Link has no handler                                                           | Copy UPI ID                                                                            |

## 6. Implementation Specification (Cloudflare Free-Tier Stack)

Replaces the v1.0 low-code stack (FlutterFlow/Bubble + Make.com + Supabase).

| Platform Module      | Technology / Service                                                  | Configuration & Integration Details                                                                                     |
|----------------------|-----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| Frontend Client      | public/index.html (Vanilla JS) + app.css (Tailwind 3.4.17, pre-built) | Served by Worker static assets; SPA fallback makes /r/{code} resolve to index.html; og.png / favicon for link previews. |
| API                  | Cloudflare Worker (src/worker.js)                                     | run_worker_first for /api/\*; JSON errors with user-readable messages; cache-control: no-store.                         |
| Database & Sync      | Cloudflare D1 (binding DB)                                            | Migrations via wrangler; batched writes (atomic); pull-based sync (claims returned on every write).                     |
| Multimodal AI Vision | Gemini API (key stored as Worker secret)                              | x-goog-api-key header; temperature 0; responseSchema; model fallback.                                                   |
| Housekeeping         | Worker Cron Trigger (0 3 \* \* \*)                                    | Deletes rooms older than ROOM_TTL_DAYS (30) with cascade, and parse_log rows older than a day.                          |
| Observability        | \[observability\] enabled = true                                      | Worker logs kept in the dashboard (Workers & Pages → splittab → Logs).                                                  |

### 6.1 API Contract

| Endpoint                                     | Request                                                                                      | Response / Errors                                                                                      |
|----------------------------------------------|----------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| POST /api/parse                              | Body: base64 JPEG (text/plain). Header x-image-mime (jpeg \| png \| webp).                   | 200 {bill, model} in paise • 413 too large • 422 no items • 429 rate limit • 502 model failure         |
| POST /api/rooms                              | {host_name, host_vpa, participants\[\], actual_paid (₹ or null), bill{items\[\], \*\_paise}} | 201 {room_id, host_token} • 400 validation (VPA, ≥1 friend, ≤20 people, ≤80 items, paid ≤ 2x total)    |
| GET /api/rooms/:code                         | Optional X-Host-Token / X-Participant-Token                                                  | 200 {session, viewer{is_host, participant_id, open_mode}, participants\[+taken\], items, claims} • 404 |
| PUT /api/rooms/:code/claims                  | {item_id, participant_id, claimed} + host or that participant's token                        | 200 {claims} (whole room) • 403 not you • 404 not in this room                                         |
| PATCH /api/rooms/:code/participants/:id      | {payment_status} + token. HOST_CONFIRMED (to or from) needs the host token                   | 200 {participants} • 400 invalid status • 403 • 404                                                    |
| POST /api/rooms/:code/participants/:id/join  | No body. Locks the name to this phone                                                        | 200 {token} \| {ok} \| {host} \| {open_mode} • 409 name in use / host's name                           |
| POST /api/rooms/:code/participants/:id/reset | X-Host-Token                                                                                 | 200 {participants} • 403 not host                                                                      |

### 6.2 Configuration

| Variable                | Purpose                                  | Default                                      |
|-------------------------|------------------------------------------|----------------------------------------------|
| GEMINI_API_KEY (secret) | Google AI Studio key                     | set with: wrangler secret put GEMINI_API_KEY |
| GEMINI_MODEL            | Primary vision model                     | gemini-3.6-flash                             |
| GEMINI_FALLBACK_MODEL   | Used on 404 / 429 / 5xx                  | gemini-3.1-flash-lite                        |
| ROOM_TTL_DAYS           | Room retention                           | 30                                           |
| GEMINI_MOCK             | "1" returns the Bangalore Bistro fixture | 0                                            |
| PARSE_LIMIT_PER_MINUTE  | Max scans per IP per minute              | 6                                            |
| PARSE_LIMIT_PER_DAY     | Max scans per day, whole app             | 300                                          |

### 6.3 Free-Tier Capacity Budget

| Resource         | Free Limit                                 | Approx. Use per Bill (4 people, 6 items)                                    | Bills per Day                                     |
|------------------|--------------------------------------------|-----------------------------------------------------------------------------|---------------------------------------------------|
| Worker requests  | 100,000 / day                              | ~25 (parse, create, room loads, claims, statuses)                           | ~4,000                                            |
| D1 row writes    | 100,000 / day                              | ~35 (scan log 1, room creation ~11, name locks ~3, claims ~12, statuses ~4) | ~2,800                                            |
| D1 row reads     | 5,000,000 / day                            | ~500–1,000                                                                  | ~5,000                                            |
| Gemini free tier | Per-project quota shown in AI Studio (low) | 1 call (+1 if the fallback runs)                                            | Binding constraint; capped by PARSE_LIMIT_PER_DAY |

## 7. Security, Privacy & Performance Resilience

• **No secrets in the browser:** the Gemini key is a Worker secret; D1 is reachable only through the Worker binding. (v1.0 shipped a Supabase key with ALL grants and row-level security disabled.)

• **Room codes:** 8 characters from a 32-symbol alphabet (2^40 combinations), unguessable. The link grants viewing only.

• **Host & participant tokens (v2.1):** 24 random bytes (base64url), sent as X-Host-Token / X-Participant-Token; only SHA-256 hashes are stored. The host link (#host=…) is stripped from the address bar after use. Rooms created before v2.1 have no host hash and stay in open mode.

• **Permissions:** HOST_CONFIRMED (set or undo), unlocking names and acting for others need the host token; claims and "I have paid" need the host token or that person's own token.

• **Server-side validation:** VPA format; sanitised names; ≤ 20 people and ≤ 80 items; non-negative integer paise; CHECK constraints repeat these rules in the database.

• **Cross-room protection:** every claim and status write checks that the item and participant belong to the room in the URL.

• **Output escaping:** all OCR and user text is HTML-escaped and event handlers use data attributes (v1.0 used raw innerHTML and inline onclick with ids).

• **PII minimisation & retention:** only first names and the host VPA are stored; receipt images are never stored; rooms are deleted after 30 days.

• **Gemini free tier:** Google may use free-tier prompts to improve its products and reviewers may read them. Use a paid key before any public launch.

• **Abuse:** /api/parse is rate-limited per IP (cf-connecting-ip, set by Cloudflare) and per day, stored in D1. Implemented in v2.1.

• **Performance:** the photo is not JSON-parsed on the Worker (10 ms CPU budget); one D1 batch per write; refresh on page focus instead of polling.
