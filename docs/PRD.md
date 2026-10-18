# Product Requirements Document (PRD)

*Project: SplitTab - Collaborative Zero-Install Dining Split Utility · Version 2.1 (Live MVP on a ₹0 Cloudflare + Gemini Stack, hardened)*

| Field                 | Value                                                                                             |
|-----------------------|---------------------------------------------------------------------------------------------------|
| Author / Role         | Product Manager                                                                                   |
| Target Platform       | Mobile Web (single-file web app, zero install) with WhatsApp Link Sharing                         |
| Primary Architecture  | Vanilla JS web app + Cloudflare Workers + Cloudflare D1 + Gemini Flash Vision (all on free tiers) |
| Target Users & Region | Gen Z & Millennial Social Diners, Urban India (Metro Tier-1/2)                                    |

> ***What changed in v2.0:** The problem, personas and solution are unchanged. The v1.0 stack (Make.com + Supabase + FlutterFlow) is replaced by one Cloudflare Worker and a D1 database: no idle pausing, no secrets in the browser, ₹0 to run. A host Review & Edit step now sits between scanning and room creation. Shares plus unclaimed items now always equal the amount the host paid, to the paisa. Features specified in v1.0 but never built are moved to the roadmap (§8). **v2.1 (18 Oct 2026)** adds host-only controls, names locked to one phone each, a scan rate limit, safer Review checks, a better UPI fallback and faster page loads.*

## 1. Problem Definition & Strategic Framing

### 1.1 The Core Problem

In social dining environments across India, dividing restaurant bills among friends involves disproportionate cognitive load, manual mathematical calculations, and social discomfort.

Following a meal, the group faces a friction-heavy bottleneck:

- deciphering thermal paper receipts,
- apportioning individual consumption,
- calculating compounding percentages for GST (CGST/SGST), Alcohol VAT, discretionary service charges, and discounts, and
- tracking multiple individual peer-to-peer (P2P) reimbursements over Unified Payments Interface (UPI).

### 1.2 Proof & Evidence: How We Know It’s a True Problem

- **High Friction Point at Peak Fatigue:** Bill reconciliation occurs at the very end of an outing when cognitive bandwidth is lowest. Diners default to 'rough estimates' or an equal split, penalizing light eaters and non-drinkers.
- **Informal Debt Leakage**: Studies in consumer payment behavior reveal that over 30% of informal P2P micro-debts (\<₹500) are never repaid due to social awkwardness in sending reminders.
- **Abandonment of Native Split Utilities**: Traditional expense managers (e.g., Splitwise) require manual line-item entry and mandate all participants to create accounts. Consequently, groups abandon itemized recording and default to mental arithmetic or fragmented WhatsApp chats.
- **Inadequacy of Existing Payment Rails**: While Google Pay and PhonePe feature bill-splitting, they only support flat equal division across pre-existing groups and cannot parse physical itemized receipts.

### 1.3 Why Solve This Problem Now? (Timing & Market Urgency)

- **Ubiquitous UPI Infrastructure**: India processes over 13+ billion UPI transactions monthly. Instant P2P money movement is deeply ingrained.
- **Multimodal Vision AI Breakthroughs**: Advanced LLM vision models (such as Gemini Flash) can now parse noisy, low-contrast, non-standardized Indian restaurant bills with high extraction accuracy at negligible API costs (~₹0.10–₹0.25 per scan).
- **Shift in Dining Culture:** Dining-out frequency among urban Gen Z and young professionals has surged, accompanied by dining discount platforms (Zomato Gold, Swiggy Dineout, credit card cashbacks) that complicate post-meal reconciliation.

### 1.4 Impact of Not Solving This Problem (Cost of Inaction)

- **The 'Organizer's Tax'**: The primary payer who steps up to settle the bill is saddled with administrative overhead, debt chasing, and financial shortfall.
- **Interpersonal Friction**: Silent resentment develops when non-drinkers or light eaters consistently subsidize shared liquor or expensive appetizers under forced equal splits.
- **Financial Loss:** Accumulation of uncollected small balances leads to noticeable cumulative losses for frequent group organizers.

### 1.5 Value Creation & Return on Investment (ROI)

**Value generated for Users (Host & Diners):**

- **Reduction**: Slices bill settlement duration from 8–10 minutes of manual arithmetic to under 60 seconds.
- **Mathematical Fairness**: Diners pay precisely for what they consumed plus their exact share of tax, service charges, and discounts.
- **Social Comfort**: Removes the emotional friction of manual debt follow-ups through transparent, auditable breakdown screens.

### 1.6 User Personas

| **Persona**                                      | **Profile**                                                                                                                                      | **Core Need**                                                                                                                   |
|--------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| **Persona A: 'The Payer' (Host / Card Owner)**   | Tech-savvy professional, uses premium credit cards or dining apps to earn rewards, willing to settle the physical bill upfront.                  | Rapid reconciliation, zero manual math, and assurance that friends clear their dues promptly.                                   |
| **Persona B: 'The Diner' (Guest / Participant)** | Gen Z college student or young professional, values fair pricing (e.g., did not order drinks), reluctant to install single-purpose utility apps. | Zero app installation, transparent line-item selection, and instant 1-tap settlement via their existing UPI app (GPay/PhonePe). |

## 2. Product Solution & Strategic Value

### 2.1 Solution Overview

SplitTab is a zero-install, collaborative mobile-web micro-tool.

The host photographs a physical restaurant receipt and inputs attendees' names. A multimodal vision AI extracts line items, taxes, service charges, and discounts in seconds, generating a dynamic session web link.

Before the link is created, the host sees the parsed bill and can fix any misread item, price or alcohol flag, so friends only ever see numbers the host has checked.

Friends open the link in any mobile browser, pick their name from a pre-populated dropdown, tap the items they consumed (which automatically splits shared items equally among claimants), and tap a single native UPI button to launch GPay, PhonePe, or Paytm with the exact amount pre-filled.

### 2.2 Core Value Proposition

> *Fair itemized splits in under 60 seconds. Zero app downloads, zero account logins, and 1-tap UPI settlement.*

### 2.3 Key Features & Benefit Mapping

| Key Feature                                     | Functional Capability                                                                                                                                                                            | Direct User / Business Benefit                                                                       |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Multimodal Receipt Ingestion                    | Host photographs the receipt; Gemini Flash extracts items, quantities, CGST/SGST, liquor VAT, service charge and printed total as schema-enforced JSON.                                          | Eliminates manual typing; handles crumpled thermal paper and non-standard layouts.                   |
| Host Review & Edit (new in v2.0)                | Parsed bill shown as editable rows (name, price, 🍺 alcohol toggle). Live check that items + taxes match the printed total. Manual entry if there is no photo.                                   | OCR mistakes are fixed before friends see them, so diners trust the numbers.                         |
| Host-Driven Participant Roster                  | Host enters friends' first names during setup; diners pick their name from a dropdown.                                                                                                           | No duplicate names, no identity collisions, zero login friction.                                     |
| Distributed Claiming                            | Diners tap what they ate; shared dishes split equally. Every tap returns the room's latest claims; Refresh button and auto-refresh when the diner returns to the page.                           | Tagging effort is spread across the table instead of falling on the host.                            |
| Dynamic Multi-Tier Tax Engine                   | Liquor VAT applied only to alcohol; GST and service charge shared proportionally; discount and round-off scaled so shares + unclaimed = amount paid, exactly.                                    | Non-drinkers never pay alcohol tax; the host is never short by a paisa.                              |
| Native UPI Intent Settlement & Payment Tracking | 1-tap upi:// link (GPay / PhonePe / Paytm buttons on iOS) plus a "Copy UPI ID" fallback that copies just the VPA. Status: Unpaid → Says Paid → Confirmed.                                        | No QR scanning; the host can see who has actually paid.                                              |
| Host-Only Controls & Name Locks (new in v2.1)   | A secret host token (kept on the host's phone, with a private host link for other devices) gates Verify, Unlock and acting for absent friends. Each name locks to the first phone that picks it. | Nobody can confirm their own payment or claim as someone else; the settlement status can be trusted. |

## 3. Goals, Non-Goals & Success Metrics

### 3.1 Product Goals

1\. Reduce total end-to-end bill split and settlement turnaround to under 90 seconds.  
2. Achieve \>95% automated extraction accuracy on standard Indian dining receipts.  
3. Maintain 100% zero-friction participation (0 app installs, 0 mandatory sign-ups for diners).

### 3.2 Explicit Non-Goals

• No In-App Wallet or Escrow: SplitTab will not hold funds or act as a licensed payment aggregator.  
• No Native iOS/Android App Store Build: The MVP will exist strictly as a responsive mobile-web application.  
• No Direct Banking SMS/Account Scraping: Host confirmation relies on visual dual-state reconciliation rather than scraping personal bank SMS feeds.

### 3.3 Success Metrics & Performance KPIs

| **Metric Category**          | **Metric Name & Definition**                                                                                       | **Target Benchmark (MVP)**     |
|------------------------------|--------------------------------------------------------------------------------------------------------------------|--------------------------------|
| **North Star Metric**        | Time-to-Zero-Debt (TTZD): Elapsed time from bill photo upload to final diner settlement marking.                   | \< 2 minutes per session       |
| **Core Operational Metric**  | OCR Extraction Accuracy: Percentage of line items and taxes correctly identified without host manual edits.        | \> 92% across thermal receipts |
| **Product Usability Metric** | Self-Claiming Rate: Percentage of bill line items claimed directly by diners without host intervention.            | \> 85% of total bill value     |
| **Viral Growth Metric**      | Participant Conversion K-Factor: Ratio of diners in a session who create their own session as Host within 30 days. | K \> 1.15 (Organic Virality)   |

## 4. User Journeys & End-to-End System Flows

### 4.1 The Host User Journey

| Step \# | Title               | Description                                                                                                                                                                                                 |
|---------|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Step 1  | Session Initiation  | Host opens SplitTab on mobile web. Name and UPI ID are remembered from the last session.                                                                                                                    |
| Step 2  | Participant Setup   | Host enters friends' names (e.g. 'Rohan, Priya, Amit'). The host is added automatically.                                                                                                                    |
| Step 3  | Discount Adjustment | Host optionally enters the amount actually paid if a platform discount (e.g. Zomato Gold) was applied.                                                                                                      |
| Step 4  | Bill Ingestion      | Host snaps the receipt and taps 'Scan Bill' (or 'Enter the bill manually').                                                                                                                                 |
| Step 5  | Review & Edit       | Host checks parsed items and taxes, fixes misreads, marks drinks as alcohol, and sees whether items + taxes match the printed total.                                                                        |
| Step 6  | Create & Share      | 'Create Room & Share' generates a short link (e.g. \<domain\>/r/k3f9x2qa); host shares it on WhatsApp.                                                                                                      |
| Step 7  | Reconciliation      | Room Summary shows each friend's amount and status. Only the host sees 'Verify' (tap after seeing the UPI credit) and 'Unlock' (if a friend switches phones). Unclaimed items are listed with their amount. |

### 4.2 The Diner User Journey

| **Step \#** | **Title**          | **Description**                                                                                            |
|-------------|--------------------|------------------------------------------------------------------------------------------------------------|
| **Step 1**  | Access Room        | Diner taps the link in WhatsApp; page opens instantly in the browser.                                      |
| **Step 2**  | Identity Selection | Diner selects their name from the pre-populated dropdown list provided by the host.                        |
| **Step 3**  | Item Claiming      | Diner taps the items they ordered. For shared dishes, tapping adds their name to the item's split pool.    |
| **Step 4**  | Real-Time Total    | The screen displays their individual subtotal, exact proportional tax/charges, and final payable amount.   |
| **Step 5**  | One-Tap Settlement | Diner taps 'Pay ₹XXX via UPI'. The OS prompts launch into GPay, PhonePe, or Paytm with pre-filled details. |
| **Step 6**  | Completion         | After authorizing payment with their UPI PIN, the diner returns to the web browser and taps 'I Have Paid'. |

### 4.3 System State Lifecycle Diagram

``` text
[SETUP] Host enters name, UPI ID, friends, optional amount paid.
│
▼
[PARSING] Gemini reads the photo. Nothing is saved yet.
│
▼
[REVIEW] Host fixes items / taxes in the browser. Abandoned scans leave no data.
│
▼
[ACTIVE_CLAIMING] Room, roster and items saved in one all-or-nothing write; link shared.
│
▼
[SETTLING] Diners pay via UPI and tap "I have paid" (UNPAID → SELF_PAID).
│
▼
[RECONCILED] Host verifies each credit (SELF_PAID → HOST_CONFIRMED). Room auto-deleted after 30 days.
```

## 5. Functional Requirements & Core System Logic

### 5.1 Vision OCR Parsing Engine

- **Input:** Any photo the phone browser can open, compressed in the browser to JPEG (width ≤ 1200 px, height ≤ 2400 px, roughly 150–600 KB).
- **Model:** Gemini Flash at temperature 0 with a response JSON schema (structured output), so the reply is always valid JSON. Model names are configuration: primary gemini-3.6-flash, automatic fallback gemini-3.1-flash-lite.
- **Output fields:** merchant_name, items\[{item_name, quantity, unit_price, total_price, is_alcohol}\], subtotal, cgst_amount, sgst_amount, liquor_vat_amount, service_charge, discount_amount, round_off, grand_total.
- **No database write on parse:** the parsed bill goes to the host's Review screen; the room is created only after the host confirms.
- **Failure handling:** no items found, model error or quota exhausted → a plain-language message plus the "Enter the bill manually" path.
- **Rate limit (v2.1):** at most 6 scans per minute per IP and 300 per day across the app, so one user or script cannot exhaust the Gemini quota.

### 5.2 Host Review & Edit (new in v2.0)

- **Editable rows:** item name, line total and a 🍺 alcohol toggle; delete or add items.
- **Editable charges:** CGST, SGST, liquor VAT, service charge, discount printed on the bill, round-off (±), printed grand total and amount actually paid.
- **Printed-total check:** green when items + taxes − discount ± round-off is within max(₹2, 1%) of the printed total; amber warning otherwise.
- **Amount-paid check (v2.1):** warns when the amount paid is above the printed total or below half of it, and needs a second tap to continue. The server rejects anything over double the printed total.
- **VAT check:** warns when liquor VAT is entered but no item is marked as alcohol.
- **Guardrail:** a room cannot be created without at least one item that has both a name and a price.

### 5.3 Mathematical Formulation & Financial Logic Engine

**Shared Dish Equal Division:** when item i is claimed by N_i diners, each diner's share is Share(u, i) = Price_i / N_i.

- **Food multiplier:** M_food = 1 + (CGST + SGST + SC × B_food / B_total) / B_food
- **Liquor multiplier:** M_liq = 1 + (VAT + SC × B_liq / B_total) / B_liq
- **Empty-bucket rule:** if a bill has no food items (or no alcohol items), that bucket's taxes move to the other bucket so no rupee is lost.
- **Scaling factor (changed in v2.0):** δ = Target / Computed, where Computed = B_food × M_food + B_liq × M_liq and Target = amount the host paid, otherwise the printed grand total. v1.0 used Paid / Printed total, which leaves the host short whenever the printed total includes a round-off or a charge the parser missed.
- **Final share:** Total_u = δ × (Food_u × M_food + Liquor_u × M_liq), rounded to the paisa.
- **Penny reconciliation:** each guest's share is rounded normally; the host absorbs the ±1–2 paise residual, so the sum of shares + unclaimed equals Target exactly.

### 5.4 UPI Payment Rail & Deep Linking Schema

**Standard NPCI URI:** upi://pay?pa={host_vpa}&pn={host_name}&am={amount_2dp}&cu=INR&tn=SplitTab {room_code}. The "@" in pa is left unencoded because several UPI apps reject an encoded VPA.

- **Android (Chrome, WhatsApp in-app browser):** the standard URI opens the OS app chooser (GPay, PhonePe, Paytm, BHIM, CRED).
- **iOS Safari:** dedicated GPay (gpay://upi/pay), PhonePe (phonepe://pay) and Paytm (paytmmp://pay) buttons.
- **Universal fallback:** "Copy UPI ID" copies only the VPA (pasteable into any UPI app's "Pay to UPI ID" field) and shows the exact amount to enter. Shown on screen because some UPI apps restrict payments started from links.
- **Host view:** no pay button. The host is the payee and sees their own share for reference only.

### 5.5 Reconciliation & Payment Status

- **Dual-state verification:** Unpaid (grey) → Says Paid (amber) → Confirmed (green). A diner can undo "I have paid" until the host confirms.
- **Host controls (host-only from v2.1):** Verify / Undo and Unlock per person in Room Summary, enforced by the server with the host token. The host can also act for any friend (e.g. claim for someone who left).
- **Name locks (v2.1):** the first phone to pick a name owns it; other phones see it as "on another phone". The host's name is never selectable by diners.
- **Unclaimed basket:** items nobody has claimed are listed with their amount including taxes, marked "host is carrying this" until someone claims them.
- **Reconciliation line:** "Shares + unclaimed = amount host paid · n/m confirmed", so the host can see the books balance.

## 6. Edge Cases, Risks & Mitigations

| Risk / Edge Case Category      | Specific Failure Scenario                                                                       | Engineering & Product Mitigation                                                                                                                  |
|--------------------------------|-------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| OCR Vision Failure             | Torn or low-light receipt; misread price; missed item.                                          | Host Review & Edit with printed-total check; manual entry path; schema-enforced JSON.                                                             |
| Model Retirement / Quota       | Google retires a model or the free quota runs out (v1.0 broke on the retired gemini-1.5-flash). | Model name is configuration; automatic fallback model; "enter manually" path always available.                                                    |
| Payment Spoofing               | Diner cancels inside GPay and taps "I have paid", or tries to mark themselves confirmed.        | "Says Paid" is shown separately from "Confirmed"; only the host token can set Confirmed.                                                          |
| iOS Safari Protocol Blocking   | Safari ignores the generic upi:// link.                                                         | App-specific buttons for GPay / PhonePe / Paytm plus a copy-to-clipboard fallback.                                                                |
| Ghost Diners / Unclaimed Items | Diners leave without claiming their dishes.                                                     | Unclaimed basket shows each item and amount; host follows up. Host assignment of leftovers is on the roadmap.                                     |
| Stale Split Counts             | Two diners tap at once, or one diner taps fast, and sees an old "split N ways".                 | Taps are saved one at a time in order; every save returns the full claim set; Refresh button; auto-refresh on focus. Live push is on the roadmap. |
| Rounding Discrepancies         | Fractional division leaves 1–2 paise unaccounted.                                               | Host absorbs the residual; shares + unclaimed = amount paid exactly.                                                                              |
| Impersonation in a Room        | Someone with the link claims under another name or presses Verify.                              | Fixed in v2.1: names lock to one phone; Verify / Unlock need the host token. Rooms created before v2.1 stay in open mode.                         |
| Gemini Quota Abuse             | A script calls the scan endpoint repeatedly and exhausts the free daily quota.                  | Per-IP and per-day scan limits stored in D1 (v2.1).                                                                                               |
| Wrong Amount Paid              | Host types ₹11,000 instead of ₹1,100; every share is 10x.                                       | Review warning + second tap; server rejects \> 2x the printed total (v2.1).                                                                       |

## 7. Technical Architecture (₹0 Free-Tier Stack)

Every layer runs on a permanent free tier, so the product costs nothing to keep online between demos.

| Layer / Function           | Platform / Tool Selected                                                      | Implementation Details                                                                               |
|----------------------------|-------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Frontend (Host & Diner UI) | Single-file index.html (Vanilla JS) + pre-built Tailwind CSS (app.css, 16 KB) | Setup, Review & Edit, Claim and Summary views; canvas compression; split engine runs in the browser. |
| API & Hosting              | Cloudflare Workers (free: 100,000 requests/day; static files unlimited)       | Seven JSON endpoints and the HTML from one domain. Holds the Gemini key as a secret.                  |
| Database                   | Cloudflare D1 / SQLite (free: 5 GB, 5M row reads and 100k row writes per day) | sessions, participants, line_items, item_claims. Money stored in paise. No idle pausing.             |
| AI Receipt Vision Engine   | Google Gemini API, Flash tier (free tier via AI Studio)                       | Structured JSON output with a fallback model.                                                        |
| Payments                   | NPCI UPI intent links                                                         | No payment aggregator; SplitTab never holds money.                                                   |

**Removed from v1.0:** Make.com (1,000 credits/month; its webhook replied before participants and items were saved, so rooms loaded empty), Supabase (free projects pause after 7 days without activity) and the FlutterFlow wrapper (it embedded the same page and added no capability).

### 7.2 Relational Database Schema Design

**1. Table \`sessions\`:** id (8-character room code), merchant_name, host_name, host_vpa, subtotal / cgst / sgst / liquor_vat / service_charge / grand_total (all in paise), actual_paid_paise (NULL = no discount), host_token_hash (v2.1), created_at.

**2. Table \`participants\`:** id, session_id → sessions, name (unique per room, case-insensitive), is_host, payment_status (UNPAID \| SELF_PAID \| HOST_CONFIRMED), claim_token_hash (v2.1: which phone holds this name), sort_order.

**3. Table \`line_items\`:** id, session_id → sessions, item_name, quantity, total_price_paise, is_alcohol, sort_order.

**4. Table \`item_claims\`:** (line_item_id, participant_id) primary key, session_id, created_at. A diner can claim an item only once; deleting a room deletes everything under it.

**5. Table \`parse_log\` (v2.1):** ip, created_ms. One row per scan, used for rate limiting; rows older than a day are deleted daily.

## 8. Release Phasing & MVP Validation Milestones

| Milestone                                  | Scope                                                                                                            | Exit Criteria                                                                                                             |
|--------------------------------------------|------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| Milestone 1: v2.0 / v2.1 MVP (LIVE)        | Scan → Review & Edit → Claim → UPI → Verify on the Cloudflare free tier, with host-only controls and name locks. | Live at splittab.splittabsubdomain.workers.dev. Bangalore Bistro case reproduces ₹480.95 / ₹203.27 / ₹415.78 = ₹1,100.00. |
| Milestone 2: Field Testing & OCR Benchmark | Test 30 live receipts from Bangalore/Mumbai restaurants (dhabas, cafes, breweries).                              | Extraction accuracy, host edits per bill, parse time, mobile browser compatibility.                                       |
| Milestone 3: Deferred MVP Scope            | Host assigns leftovers to people; live updates across phones.                                                    | Self-claiming ≥ 85% of bill value; unclaimed value \< 5% at settlement.                                                   |
| Milestone 4: WhatsApp Dispatch Hook        | Hosts forward a receipt photo to a WhatsApp number to generate a room link.                                      | Room created from WhatsApp in under 30 seconds.                                                                           |

### 8.1 Known Limitations of v2.0

- **Host recovery:** if the host loses their phone without copying the private host link, host controls for that room are lost.
- **Unclaimed items:** shown with their amount; the host can claim them on someone's behalf, but there is no one-tap "split leftovers".
- **UPI links:** some UPI apps restrict payments started from upi:// links; the "Copy UPI ID" path always works.
- **Sync:** other diners' claims appear on the next tap, Refresh or page re-focus, not instantly.
- **Gemini free tier:** Google may use submitted receipts to improve its products, and the daily request quota is low. Use a paid key for any public launch.
- **Styling:** Tailwind classes are pre-compiled into app.css; after changing classes in index.html, run npm run css before deploying.
