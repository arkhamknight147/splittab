# Changelog

All notable changes to SplitTab are documented here. Dates are in IST.

## [2.1.1] - 2026-10-18

### Fixed
- CI and `.nvmrc` now use Node 22: wrangler 4 refuses to run on Node 20, which failed every CI run.

### Security
- Security headers on every page via `public/_headers`: Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
- Room creation rate-limited per IP (5/min) and per day (500) to protect the D1 write quota.
- Per-IP flood guard (120 writes/min, in memory) on every API write.
- API responses send `nosniff` and `no-referrer`.
- Added `SECURITY.md`.

## [2.1.0] - 2026-10-18

### Added
- Host-only controls: room creation returns a secret host token. Only the host can verify payments, undo a verification, unlock a name or act for an absent friend. A private host link opens host mode on another device.
- Name locks: the first phone to pick a name owns it; other phones see it as "on another phone".
- Scan rate limit: 6 scans per minute per IP and 300 per day, stored in D1 (`migrations/0002_host_controls_rate_limit.sql`).
- Review screen: "Discount on bill" and "Round-off (±)" fields included in the totals check.
- Warning (plus a second tap) when the amount paid is above the printed total or below half of it; the server rejects anything over double.
- WhatsApp / social link preview (`og.png`), favicons, persistent Worker logs (`[observability]`).
- `tests/api_test.py` (22 API checks) and an expanded `tests/e2e.py` (23 browser checks).
- GitHub Actions CI: unit tests, stale-CSS check, Worker dry-run build.

### Changed
- "Copy UPI ID" now copies only the VPA (pasteable into any UPI app) and shows the amount to enter.
- UPI note is `SplitTab-<room>` (no spaces).
- Tailwind is pre-built into `public/app.css` (16 KB) instead of the ~400 KB CDN script. Run `npm run css` after changing classes.
- Claim taps are saved one at a time, in order, so fast tapping never flickers or loses a claim.
- Docs moved from Word to Markdown (`docs/PRD.md`, `docs/TDD.md`, `docs/ARCHITECTURE.md`).

## [2.0.0] - 2026-10-17

### Changed
- Rebuilt on Cloudflare Workers + D1 + Gemini Flash, replacing Make.com, Supabase, Vercel and FlutterFlow.
- Host reviews and edits the parsed bill before the room is created.
- Shares + unclaimed items always equal the amount paid, to the paisa.

## [1.0.0] - 2026-10-04

- First prototype: single-file web app, Make.com webhook, Supabase, Gemini 1.5 Flash.
