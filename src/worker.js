/**
 * SplitTab v2 — Cloudflare Worker
 * --------------------------------------------------------------
 * One Worker serves the static single-file frontend (public/index.html)
 * and a small JSON API backed by Cloudflare D1 (SQLite).
 *
 *   POST  /api/parse                              receipt image (base64 text body) -> structured bill (no DB write)
 *   POST  /api/rooms                              host-reviewed bill + roster -> room id (atomic batch insert)
 *   GET   /api/rooms/:roomId                      full room state (session, participants, items, claims)
 *   PUT   /api/rooms/:roomId/claims               toggle one claim -> fresh claims for the room
 *   PATCH /api/rooms/:roomId/participants/:pid    set payment_status -> fresh participants for the room
 *   POST  /api/rooms/:roomId/participants/:pid/join   lock a name to this phone -> participant token
 *   POST  /api/rooms/:roomId/participants/:pid/reset  (host) unlock a name so another phone can use it
 *
 * Auth (v2.1): room creation returns a secret host token (sent back as X-Host-Token).
 * The first phone to pick a name gets a participant token (X-Participant-Token).
 * Only SHA-256 hashes of tokens are stored. Rooms created before v2.1 have no
 * host_token_hash and stay in open mode.
 *
 * Money crosses the API as integer paise. The split maths runs in the browser
 * (see computeSplit in public/index.html) so the diner sees totals instantly.
 */

const MAX_IMAGE_B64_CHARS = 6_000_000; // ~4.5 MB JPEG; client sends ~0.3–0.8 MB
const MAX_PARTICIPANTS = 20;
const MAX_ITEMS = 80;
const PAYMENT_STATUSES = ['UNPAID', 'SELF_PAID', 'HOST_CONFIRMED'];
const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/;
const ROOM_ID_RE = /^[a-z0-9]{8}$/;
const PARTICIPANT_COLS = 'id, name, is_host, payment_status, (claim_token_hash IS NOT NULL) AS taken';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('Unhandled error', err && err.stack || err);
      return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  },

  // Daily cron: delete rooms older than ROOM_TTL_DAYS (children cascade).
  async scheduled(_event, env) {
    const days = Math.max(1, parseInt(env.ROOM_TTL_DAYS || '30', 10));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE created_at < datetime('now', ?)").bind(`-${days} days`),
      env.DB.prepare('DELETE FROM parse_log WHERE created_ms < ?').bind(Date.now() - 86_400_000),
    ]);
  },
};

async function route(request, env, url) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', ...]
  const method = request.method;

  if (parts[1] === 'parse' && parts.length === 2 && method === 'POST') return parseReceipt(request, env);
  if (parts[1] === 'rooms' && parts.length === 2 && method === 'POST') return createRoom(request, env);

  if (parts[1] === 'rooms' && parts.length >= 3) {
    const roomId = parts[2];
    if (!ROOM_ID_RE.test(roomId)) throw new HttpError(404, 'Room not found.');
    if (parts.length === 3 && method === 'GET') return json(await getRoom(request, env, roomId));
    if (parts.length === 4 && parts[3] === 'claims' && method === 'PUT') return setClaim(request, env, roomId);
    if (parts.length === 5 && parts[3] === 'participants' && method === 'PATCH') {
      return setPaymentStatus(request, env, roomId, parts[4]);
    }
    if (parts.length === 6 && parts[3] === 'participants' && parts[5] === 'join' && method === 'POST') {
      return joinAsParticipant(request, env, roomId, parts[4]);
    }
    if (parts.length === 6 && parts[3] === 'participants' && parts[5] === 'reset' && method === 'POST') {
      return resetParticipant(request, env, roomId, parts[4]);
    }
  }
  throw new HttpError(404, 'Not found.');
}

/* ------------------------------------------------------------------ */
/* POST /api/parse                                                     */
/* ------------------------------------------------------------------ */

// The body is the raw base64 JPEG as text/plain. Avoiding JSON.parse on a
// ~500 KB payload keeps us well inside the free plan's 10 ms CPU budget.
async function parseReceipt(request, env) {
  const b64 = (await request.text()).trim();
  if (!b64) throw new HttpError(400, 'No image received.');
  if (b64.length > MAX_IMAGE_B64_CHARS) throw new HttpError(413, 'Image too large. Please retake the photo.');
  const mime = (request.headers.get('x-image-mime') || 'image/jpeg').toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new HttpError(415, 'Unsupported image type.');
  await enforceParseLimit(request, env);

  if (env.GEMINI_MOCK === '1') return json({ bill: normaliseBill(MOCK_BILL), model: 'mock' });
  if (!env.GEMINI_API_KEY) throw new HttpError(500, 'Server is missing GEMINI_API_KEY.');

  const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean);
  let lastError = 'No model configured.';
  for (const model of models) {
    const res = await callGemini(env.GEMINI_API_KEY, model, mime, b64);
    if (res.ok) {
      const bill = normaliseBill(res.data);
      if (bill.items.length === 0) {
        throw new HttpError(422, "Couldn't find any items on that photo. Retake it, or enter the bill manually.");
      }
      return json({ bill, model });
    }
    lastError = res.error;
    // Only fall through to the next model for "model gone / busy / quota" errors.
    if (![404, 429, 500, 503].includes(res.status)) break;
  }
  console.error('Gemini failed:', lastError);
  throw new HttpError(502, "Couldn't read the bill right now. Retake the photo or enter the bill manually.");
}

// Every scan spends Gemini quota, so cap scans per IP per minute and across the whole app per day.
// Stored in D1 so it works on the Workers Free plan without extra products.
async function enforceParseLimit(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const now = Date.now();
  const perMinute = positiveInt(env.PARSE_LIMIT_PER_MINUTE, 6);
  const perDay = positiveInt(env.PARSE_LIMIT_PER_DAY, 300);
  const row = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM parse_log WHERE ip = ?1 AND created_ms > ?2) AS ip_minute,
      (SELECT COUNT(*) FROM parse_log WHERE created_ms > ?3) AS all_day`)
    .bind(ip, now - 60_000, now - 86_400_000).first();
  if (row.ip_minute >= perMinute) throw new HttpError(429, 'Too many scans from this phone. Wait a minute and try again.');
  if (row.all_day >= perDay) {
    throw new HttpError(429, "SplitTab has reached today's scan limit. Enter the bill manually, or try again tomorrow.");
  }
  await env.DB.prepare('INSERT INTO parse_log (ip, created_ms) VALUES (?, ?)').bind(ip, now).run();
}

const GEMINI_PROMPT = `You are an expert OCR parser for Indian restaurant bills.
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
9. If a value is unreadable, use 0. Do not guess items that are not on the bill.`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant_name: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item_name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit_price: { type: 'NUMBER' },
          total_price: { type: 'NUMBER' },
          is_alcohol: { type: 'BOOLEAN' },
        },
        required: ['item_name', 'quantity', 'total_price', 'is_alcohol'],
      },
    },
    subtotal: { type: 'NUMBER' },
    cgst_amount: { type: 'NUMBER' },
    sgst_amount: { type: 'NUMBER' },
    liquor_vat_amount: { type: 'NUMBER' },
    service_charge: { type: 'NUMBER' },
    discount_amount: { type: 'NUMBER' },
    round_off: { type: 'NUMBER' },
    grand_total: { type: 'NUMBER' },
  },
  required: ['items', 'cgst_amount', 'sgst_amount', 'liquor_vat_amount', 'service_charge', 'grand_total'],
};

async function callGemini(apiKey, model, mime, b64) {
  const config = JSON.stringify({ temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA });
  // Build the request body by concatenation so the large base64 string is never re-serialised.
  const body = '{"contents":[{"role":"user","parts":[{"text":' + JSON.stringify(GEMINI_PROMPT) +
    '},{"inline_data":{"mime_type":"' + mime + '","data":"' + b64.replace(/[^A-Za-z0-9+/=]/g, '') + '"}}]}],' +
    '"generationConfig":' + config + '}';

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    });
  } catch (e) {
    return { ok: false, status: 503, error: `network: ${e}` };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: `${model} ${res.status}: ${text.slice(0, 300)}` };
  try {
    const envelope = JSON.parse(text);
    const out = (envelope.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const cleaned = out.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    return { ok: true, data: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, status: 422, error: `${model} returned non-JSON: ${text.slice(0, 300)}` };
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/rooms                                                     */
/* ------------------------------------------------------------------ */

async function createRoom(request, env) {
  const body = await readJson(request);

  const hostName = cleanName(body.host_name);
  if (!hostName) throw new HttpError(400, 'Please enter your name.');
  const hostVpa = String(body.host_vpa || '').trim();
  if (!VPA_RE.test(hostVpa)) throw new HttpError(400, 'That UPI ID looks wrong. It should look like name@bank.');

  // Roster: host first, de-duplicated case-insensitively.
  const seen = new Set();
  const roster = [];
  for (const raw of [hostName, ...(Array.isArray(body.participants) ? body.participants : [])]) {
    const n = cleanName(raw);
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); roster.push(n); }
  }
  if (roster.length < 2) throw new HttpError(400, 'Add at least one friend.');
  if (roster.length > MAX_PARTICIPANTS) throw new HttpError(400, `Max ${MAX_PARTICIPANTS} people per room.`);

  const bill = normaliseBill(body.bill || {});
  if (bill.items.length === 0) throw new HttpError(400, 'The bill has no items.');
  if (bill.items.length > MAX_ITEMS) throw new HttpError(400, `Max ${MAX_ITEMS} items per bill.`);

  let actualPaid = null;
  if (body.actual_paid !== null && body.actual_paid !== undefined && body.actual_paid !== '') {
    actualPaid = toPaise(body.actual_paid);
    if (actualPaid <= 0) actualPaid = null;
  }
  // Safety net behind the client-side warning: a typo like 11000 for 1100 would bill everyone 10x.
  if (actualPaid && bill.grand_total_paise > 0 && actualPaid > bill.grand_total_paise * 2) {
    throw new HttpError(400, 'The amount you paid is more than double the bill total. Please check it.');
  }

  const hostToken = newToken();
  const hostTokenHash = await sha256(hostToken);

  const roomId = newRoomId();
  const stmts = [
    env.DB.prepare(`INSERT INTO sessions (id, merchant_name, host_name, host_vpa, subtotal_paise, cgst_paise, sgst_paise,
        liquor_vat_paise, service_charge_paise, grand_total_paise, actual_paid_paise, host_token_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(roomId, bill.merchant_name, hostName, hostVpa, bill.subtotal_paise, bill.cgst_paise, bill.sgst_paise,
        bill.liquor_vat_paise, bill.service_charge_paise, bill.grand_total_paise, actualPaid, hostTokenHash),
  ];
  roster.forEach((name, i) => {
    stmts.push(env.DB.prepare('INSERT INTO participants (id, session_id, name, is_host, sort_order) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), roomId, name, i === 0 ? 1 : 0, i));
  });
  bill.items.forEach((it, i) => {
    stmts.push(env.DB.prepare(`INSERT INTO line_items (id, session_id, item_name, quantity, total_price_paise, is_alcohol, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), roomId, it.item_name, it.quantity, it.total_price_paise, it.is_alcohol ? 1 : 0, i));
  });
  // D1 batch = one implicit transaction: the room is created completely or not at all.
  await env.DB.batch(stmts);
  // The host token is returned exactly once; only its hash is stored.
  return json({ room_id: roomId, host_token: hostToken }, 201);
}

/* ------------------------------------------------------------------ */
/* GET /api/rooms/:id                                                  */
/* ------------------------------------------------------------------ */

async function getRoom(request, env, roomId) {
  const [s, p, li, c] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(roomId),
    env.DB.prepare(`SELECT ${PARTICIPANT_COLS}, claim_token_hash FROM participants WHERE session_id = ? ORDER BY sort_order`).bind(roomId),
    env.DB.prepare('SELECT id, item_name, quantity, total_price_paise, is_alcohol FROM line_items WHERE session_id = ? ORDER BY sort_order').bind(roomId),
    env.DB.prepare('SELECT line_item_id, participant_id FROM item_claims WHERE session_id = ?').bind(roomId),
  ]);
  const session = s.results[0];
  if (!session) throw new HttpError(404, 'Room not found. It may have expired.');
  const hostHash = session.host_token_hash;
  delete session.host_token_hash; // never sent to the browser

  // Tell this browser who it is: host (valid host token) and/or which name it holds.
  const viewer = { is_host: false, participant_id: null, open_mode: !hostHash };
  if (hostHash) {
    viewer.is_host = await tokenMatches(request.headers.get('x-host-token'), hostHash);
    const pTokHash = await hashHeader(request.headers.get('x-participant-token'));
    const mine = pTokHash && p.results.find((r) => r.claim_token_hash === pTokHash);
    if (mine) viewer.participant_id = mine.id;
  }
  return {
    session,
    viewer,
    participants: p.results.map(({ claim_token_hash, ...r }) => cleanParticipant(r)),
    items: li.results.map((r) => ({ ...r, is_alcohol: !!r.is_alcohol })),
    claims: c.results,
  };
}

/* ------------------------------------------------------------------ */
/* PUT /api/rooms/:id/claims   { item_id, participant_id, claimed }    */
/* ------------------------------------------------------------------ */

async function setClaim(request, env, roomId) {
  const body = await readJson(request);
  const itemId = String(body.item_id || '');
  const pid = String(body.participant_id || '');
  const claimed = body.claimed === true;

  // Both ids must belong to this room (prevents cross-room writes).
  const row = await env.DB.prepare(`SELECT s.host_token_hash, p.claim_token_hash, p.payment_status,
      (SELECT COUNT(*) FROM line_items WHERE id = ?1 AND session_id = ?3) AS item_ok
      FROM participants p JOIN sessions s ON s.id = p.session_id
      WHERE p.id = ?2 AND p.session_id = ?3`)
    .bind(itemId, pid, roomId).first();
  if (!row || !row.item_ok) throw new HttpError(404, 'Item or person not found in this room.');
  const who = await authorise(request, row);
  if (!who.host && !who.self) throw new HttpError(403, 'Pick your name on this phone first.');

  const write = claimed
    ? env.DB.prepare('INSERT OR IGNORE INTO item_claims (line_item_id, participant_id, session_id) VALUES (?, ?, ?)').bind(itemId, pid, roomId)
    : env.DB.prepare('DELETE FROM item_claims WHERE line_item_id = ? AND participant_id = ?').bind(itemId, pid);
  const [, claims] = await env.DB.batch([
    write,
    env.DB.prepare('SELECT line_item_id, participant_id FROM item_claims WHERE session_id = ?').bind(roomId),
  ]);
  // Returning the whole room's claims means every tap also pulls in other diners' taps.
  return json({ claims: claims.results });
}

/* ------------------------------------------------------------------ */
/* PATCH /api/rooms/:id/participants/:pid   { payment_status }         */
/* ------------------------------------------------------------------ */

async function setPaymentStatus(request, env, roomId, pid) {
  const body = await readJson(request);
  const status = String(body.payment_status || '');
  if (!PAYMENT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid payment status.');
  const row = await participantRow(env, roomId, pid);
  const who = await authorise(request, row);
  // Confirming (or un-confirming) a payment is the host's call; "I have paid" / undo is the diner's.
  const hostOnly = status === 'HOST_CONFIRMED' || row.payment_status === 'HOST_CONFIRMED';
  if (hostOnly && !who.host) throw new HttpError(403, 'Only the host can verify payments.');
  if (!hostOnly && !who.host && !who.self) throw new HttpError(403, 'Pick your name on this phone first.');
  const [, rows] = await env.DB.batch([
    env.DB.prepare('UPDATE participants SET payment_status = ? WHERE id = ? AND session_id = ?').bind(status, pid, roomId),
    participantsQuery(env, roomId),
  ]);
  return json({ participants: rows.results.map(cleanParticipant) });
}

/* ------------------------------------------------------------------ */
/* POST /api/rooms/:id/participants/:pid/join                          */
/* ------------------------------------------------------------------ */

// Locks a name to the first phone that picks it, so nobody can claim or pay "as" someone else.
async function joinAsParticipant(request, env, roomId, pid) {
  const row = await participantRow(env, roomId, pid);
  const who = await authorise(request, row);
  if (!row.host_token_hash) return json({ open_mode: true });   // legacy room
  if (who.host) return json({ host: true });                     // host acts for anyone with the host token
  if (who.self) return json({ ok: true });                       // this phone already holds the name
  if (row.is_host) throw new HttpError(409, "That's the host's name. Pick your own name.");
  if (row.claim_token_hash) {
    throw new HttpError(409, `${row.name} is already in use on another phone. If that's you, ask the host to unlock it.`);
  }
  const token = newToken();
  const upd = await env.DB.prepare('UPDATE participants SET claim_token_hash = ? WHERE id = ? AND session_id = ? AND claim_token_hash IS NULL')
    .bind(await sha256(token), pid, roomId).run();
  if (!upd.meta || upd.meta.changes === 0) throw new HttpError(409, `${row.name} was just picked on another phone.`);
  return json({ token });
}

/* ------------------------------------------------------------------ */
/* POST /api/rooms/:id/participants/:pid/reset   (host only)           */
/* ------------------------------------------------------------------ */

async function resetParticipant(request, env, roomId, pid) {
  const row = await participantRow(env, roomId, pid);
  const who = await authorise(request, row);
  if (!who.host) throw new HttpError(403, 'Only the host can unlock a name.');
  const [, rows] = await env.DB.batch([
    env.DB.prepare('UPDATE participants SET claim_token_hash = NULL WHERE id = ? AND session_id = ?').bind(pid, roomId),
    participantsQuery(env, roomId),
  ]);
  return json({ participants: rows.results.map(cleanParticipant) });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function participantsQuery(env, roomId) {
  return env.DB.prepare(`SELECT ${PARTICIPANT_COLS} FROM participants WHERE session_id = ? ORDER BY sort_order`).bind(roomId);
}

function cleanParticipant(r) {
  return { ...r, is_host: !!r.is_host, taken: !!r.taken };
}

async function participantRow(env, roomId, pid) {
  const row = await env.DB.prepare(`SELECT p.name, p.is_host, p.payment_status, p.claim_token_hash, s.host_token_hash
      FROM participants p JOIN sessions s ON s.id = p.session_id WHERE p.id = ? AND p.session_id = ?`)
    .bind(pid, roomId).first();
  if (!row) throw new HttpError(404, 'Person not found in this room.');
  return row;
}

// Works out what this request may do. Legacy rooms (no host token) allow everything.
async function authorise(request, row) {
  if (!row.host_token_hash) return { host: true, self: true };
  const host = await tokenMatches(request.headers.get('x-host-token'), row.host_token_hash);
  const self = !!row.claim_token_hash && await tokenMatches(request.headers.get('x-participant-token'), row.claim_token_hash);
  return { host, self };
}

async function hashHeader(value) {
  const v = String(value || '').trim();
  return v && v.length <= 100 ? sha256(v) : null;
}

async function tokenMatches(value, expectedHash) {
  const h = await hashHeader(value);
  return !!h && !!expectedHash && h === expectedHash;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// 24 random bytes, base64url (32 chars).
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function positiveInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}

function cleanName(v) {
  return String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toPaise(v) { return Math.round(num(v) * 100); }

/**
 * Accepts either Gemini's rupee-based output or the client's reviewed bill
 * (which may already carry *_paise fields) and returns a clean paise-based bill.
 */
function normaliseBill(raw) {
  const pick = (paiseKey, rupeeKey) =>
    Math.max(0, raw[paiseKey] !== undefined ? Math.round(num(raw[paiseKey])) : toPaise(raw[rupeeKey]));

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((it) => {
      const quantity = Math.max(0.01, num(it.quantity) || 1);
      let total = it.total_price_paise !== undefined ? Math.round(num(it.total_price_paise)) : toPaise(it.total_price);
      if (!total && it.unit_price) total = toPaise(num(it.unit_price) * quantity);
      return {
        item_name: cleanName(it.item_name).slice(0, 80) || 'Item',
        quantity: Math.round(quantity * 100) / 100,
        total_price_paise: Math.max(0, total),
        is_alcohol: it.is_alcohol === true || it.is_alcohol === 1 || it.is_alcohol === 'true',
      };
    })
    .filter((it) => it.total_price_paise > 0);

  const itemsSum = items.reduce((a, it) => a + it.total_price_paise, 0);
  return {
    merchant_name: cleanName(raw.merchant_name).slice(0, 80) || null,
    items,
    subtotal_paise: pick('subtotal_paise', 'subtotal') || itemsSum,
    cgst_paise: pick('cgst_paise', 'cgst_amount'),
    sgst_paise: pick('sgst_paise', 'sgst_amount'),
    liquor_vat_paise: pick('liquor_vat_paise', 'liquor_vat_amount'),
    service_charge_paise: pick('service_charge_paise', 'service_charge'),
    grand_total_paise: pick('grand_total_paise', 'grand_total'),
    // Used only by the host's Review check (the split scales to the printed/paid total anyway).
    discount_paise: pick('discount_paise', 'discount_amount'),
    round_off_paise: raw.round_off_paise !== undefined ? Math.round(num(raw.round_off_paise)) : toPaise(raw.round_off),
  };
}

// 8 chars from a 32-char alphabet (no 0/1/l/o lookalikes) = 2^40 combinations.
function newRoomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b & 31]).join('');
}

// Fixture used when GEMINI_MOCK = "1": the Bangalore Bistro case study.
const MOCK_BILL = {
  merchant_name: 'The Bangalore Bistro',
  items: [
    { item_name: 'Paneer Butter Masala', quantity: 1, unit_price: 380, total_price: 380, is_alcohol: false },
    { item_name: 'Garlic Naan', quantity: 2, unit_price: 45, total_price: 90, is_alcohol: false },
    { item_name: 'Chicken Biryani', quantity: 1, unit_price: 420, total_price: 420, is_alcohol: false },
    { item_name: 'Kingfisher Draught Beer', quantity: 1, unit_price: 320, total_price: 320, is_alcohol: true },
  ],
  subtotal: 1210,
  cgst_amount: 30.25,
  sgst_amount: 30.25,
  liquor_vat_amount: 0,
  service_charge: 60.5,
  grand_total: 1331,
};
