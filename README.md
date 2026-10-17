# 🧾 SplitTab v2: Zero-Install Collaborative Dining Split

> Fair itemized restaurant bill splits for urban India. Gemini Flash reads the receipt, liquor VAT and food GST are split separately, and each friend pays their exact share with a 1-tap UPI link. No app installs, no logins, ₹0 to run.

## What's new in v2.0

| Area | v1.0 | v2.0 |
|---|---|---|
| Orchestration | Make.com scenario (1,000 credits/month; replied before data was saved) | One Cloudflare Worker (`src/worker.js`) |
| Database | Supabase (pauses after 7 idle days; public key with ALL grants) | Cloudflare D1 (SQLite), reachable only via the Worker |
| Hosting | Vercel + FlutterFlow wrapper | Cloudflare Workers static assets |
| AI | `gemini-1.5-flash` (retired), free-text JSON | Configurable Gemini Flash + fallback, schema-enforced JSON |
| Host flow | Photo → room | Photo → **Review & Edit** → room |
| Maths | Shares could miss the paid amount by round-off | Shares + unclaimed = amount paid, exact to the paisa |

## Architecture

```
Browser (public/index.html) ── same origin ──► Cloudflare Worker (src/worker.js) ──► Gemini Flash
   │  canvas JPEG, split engine, UPI links        │  /api/parse, /api/rooms, claims, status
   ▼                                              ▼
UPI app (GPay / PhonePe / Paytm)            Cloudflare D1 (sessions, participants, line_items, item_claims)
```

## Run locally (no API key needed)

```bash
npm install              # installs wrangler only (no bundler, no build step)
npm run db:local         # create local D1 tables
npm run dev:mock         # http://localhost:8787, Gemini replaced by the Bangalore Bistro fixture
npm test                 # split-engine unit tests
```

To use the real Gemini locally, copy `.dev.vars.example` to `.dev.vars`, add your key, and run `npm run dev`.

## Deploy to Cloudflare (free)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) and get a Gemini key from [aistudio.google.com](https://aistudio.google.com/apikey).
2. `npx wrangler login`
3. `npx wrangler d1 create splittab`, then paste the printed `database_id` into `wrangler.toml`.
4. `npm run db:remote`
5. `npx wrangler secret put GEMINI_API_KEY`
6. `npm run deploy`. Your app is live at `https://splittab.<your-subdomain>.workers.dev`.

If a Gemini model is retired, change `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` in `wrangler.toml` and redeploy.

## Repository

```
public/index.html          entire frontend (HTML + Tailwind CDN + vanilla JS)
src/worker.js              API, static asset routing, daily clean-up cron
migrations/0001_init.sql   D1 schema (money in integer paise)
tests/math.test.mjs        split-engine unit tests (node, zero deps)
tests/e2e.py               Playwright test: host + 3 diners
wrangler.toml              Worker config, D1 binding, vars, cron
docs/                      PRD, TDD, System Architecture (v2.0)
```

## Known limitations (deliberately deferred)

- Anyone with the room link can claim under any name and press Verify (host-only controls are on the roadmap).
- Unclaimed items are shown with their amount but can't be assigned yet.
- Other diners' claims appear on your next tap, on Refresh, or when you return to the page, not instantly.
- On the Gemini free tier, Google may use submitted receipts to improve its products. Use a paid key for a public launch, and add a Cloudflare rate-limiting rule on `/api/parse`.

Specs live in `docs/`: `SplitTab_PRD_v2.0.docx`, `SplitTab_TDD_v2.0.docx` and `SplitTab_System_Architecture_and_Domain_Logic_v2.0.docx`.

## Author

**Nishant**, Senior Product Manager · [GitHub](https://github.com/arkhamknight147)
