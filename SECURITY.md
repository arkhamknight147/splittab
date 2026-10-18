# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Report them privately through GitHub: **Security → Report a vulnerability** on this repository.
You can expect an acknowledgement within 7 days.

## Scope

- The live app: `https://splittab.splittabsubdomain.workers.dev`
- The code in this repository (`src/worker.js`, `public/index.html`, `migrations/`)

Out of scope: denial of service through sheer traffic volume, and findings that need a victim's own unlocked phone.

## How SplitTab handles data and secrets

- The Gemini API key is a Cloudflare Worker secret. It is never in this repository or in the browser.
- The database (Cloudflare D1) is reachable only through the Worker; there is no public database key.
- Host and participant tokens are random 24-byte values; only their SHA-256 hashes are stored.
- Stored data: first names, the host's UPI ID, bill items and payment status. Receipt photos are not stored. Rooms are deleted after 30 days.
- Local secrets live in `.dev.vars`, which is git-ignored. Never commit it.
