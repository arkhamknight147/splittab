# SplitTab: System Architecture, Technology Stack & Domain Logic Specification

*Technical Architecture Document & Mathematical Formulation • v2.1 • October 2026*

| Field                  | Value                                                 |
|------------------------|-------------------------------------------------------|
| Product Name           | SplitTab (Zero-Install Dining Split)                  |
| Author / Architect     | Nishant (Senior Product Manager)                      |
| Target Market          | Urban India (CBD / Tech hubs / Dine-in F&B)           |
| Core Architecture      | Multimodal Vision + Edge Serverless API + SQLite (D1) |
| Deployment Rails       | Cloudflare Workers (static assets + API)              |
| Payment Infrastructure | NPCI Unified Payments Interface (UPI Intent)          |

## 1. Executive Summary & Product Intent

### 1.1 Problem Definition: Friction in Indian Group Dining Settlement

Dining out with colleagues, friends, or family across urban India represents a vibrant cultural norm, yet post-meal financial settlement is consistently plagued by high friction, awkward social tension, and informal financial leakage. Modern consumers encounter four severe impediments during group dining splits:

- **App-Install Fatigue & Onboarding Drop-off:** Existing solutions (e.g., Splitwise, dedicated fintech apps) mandate that every group participant download an application, register an account, verify their phone number, and log in before settling. At a bustling restaurant table, this high interaction cost causes diners to abandon digital tools and rely on cumbersome manual mental math.
- **Iniquitous Equal-Split Dilemma:** A standard group bill rarely represents an equal split. Non-drinkers are routinely forced to subsidize expensive alcoholic beverages, vegetarians subsidize premium meat platters, and diners who only shared a starter are forced into an arbitrary N-way division. Manual line-item recalculation with a calculator is time-consuming and socially uncomfortable.
- **Cascading GST, State VAT & Service Charge Complexity:** Indian dining bills do not have a uniform tax structure. Food and non-alcoholic beverages are assessed under Central and State GST (CGST 2.5% + SGST 2.5% = 5%), whereas alcoholic beverages are explicitly excluded from GST and taxed under State Excise Duty and Liquor VAT (typically 10% to 25% depending on jurisdiction). Additionally, restaurants apply discretionary Service Charges (5%–10%) and hosts frequently apply platform discounts (e.g., Zomato Gold, Swiggy Dineout, bank credit cards). Manually bifurcating these cascading taxes proportionally across individual consumption lines is mathematically prohibitive for everyday diners.
- **Informal Debt Leakage & Follow-up Friction:** When the designated host pays the restaurant upfront with their credit card to capture dining discounts, they bear the burden of chasing friends via WhatsApp over subsequent days. Due to social hesitation and payment friction, the host frequently suffers 15%–25% informal debt leakage.

### 1.2 Product Vision: Zero-Install Progressive Collaborative Utility

SplitTab was engineered as a zero-install, collaborative Progressive Web Utility designed to compress the entire bill-splitting and settlement lifecycle from 15 minutes of manual back-and-forth into an under-60-second automated interaction. SplitTab eliminates friction through three guiding principles:

- **Zero-Install Footprint:** Only the table host interacts with bill ingestion. Diners join via a zero-auth WhatsApp room link with zero downloads required.
- **Computer Vision Financial OCR:** A single photo of the thermal receipt is analyzed by a Multimodal Large Language Model (Gemini Flash) that extracts food items, alcohol lines, taxes, and service charges into structured JSON within seconds.
- **Native 1-Tap UPI Settlement Rails:** Tapping 'Pay via UPI' generates an RFC-compliant Unified Payments Interface deep-link (upi://pay) that launches Google Pay, PhonePe, or Paytm with the exact penny-matched share and host VPA pre-filled.

> **PRODUCT PHILOSOPHY:** SplitTab converts an unstructured paper receipt into a real-time collaborative state room where each diner taps only what they consumed. Taxes, liquor excise VAT, service charges, and discounts are mathematically distributed with zero manual computation.

### 1.3 Target Personas & User Journeys

The system explicitly bifurcates user interactions between two distinct roles to minimize cognitive load:

- **The Host (Payer & Reconciler):** Pays the entire dining bill upfront to the restaurant merchant using their personal card or UPI. The host inputs their name, their UPI Virtual Payment Address (VPA), the actual amount paid (capturing any platform discount), enters attendee first names, snaps a photo of the receipt, and taps 'Scan Bill', reviews and corrects the parsed bill, then taps 'Create Room & Share'. The host monitors real-time reimbursement statuses in the Room Summary tab.
- **The Diner (Participant & Payer):** Receives a session link via WhatsApp, clicks it to open SplitTab directly in their mobile browser, selects their name from the pre-populated attendee dropdown, and taps the dishes they ate or shared. The screen computes their exact bill portion in real time. Tapping 'Pay via UPI' transfers funds directly to the host's bank account with zero app install.

## 2. End-to-End System Architecture & Workflow Pipeline

### 2.1 High-Level Data Flow Pipeline

SplitTab v2.1 runs as one Cloudflare Worker that serves the single-file web app and a seven-endpoint JSON API, backed by a Cloudflare D1 (SQLite) database. The Worker is the only component that talks to Gemini and to the database. The end-to-end lifecycle has six phases:

| Phase                           | Layer / Service               | Core Operation                                                                                                                                                                        | Payload / State                                                   |
|---------------------------------|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Phase 1: Client Ingestion       | Browser (Vanilla JS / Canvas) | Host enters roster, UPI ID and optional amount paid, then snaps the receipt. Canvas resizes to ≤ 1200 × 2400 px JPEG.                                                                 | Base64 text body → POST /api/parse                                |
| Phase 2: Multimodal Vision OCR  | Worker → Gemini Flash         | Image sent with prompt + response schema at temperature 0. Falls back to a second model on 404 / 429 / 5xx.                                                                           | Structured JSON bill (paise). Nothing stored.                     |
| Phase 3: Host Review            | Browser                       | Host corrects items, prices, alcohol flags and taxes against a live printed-total check.                                                                                              | Edited bill held in browser memory                                |
| Phase 4: Relational Persistence | Worker → D1                   | POST /api/rooms validates input and inserts session, participants and line items in one all-or-nothing batch. Returns a secret host token once (only its hash is stored).             | 8-character room code → /r/{code}; host token on the host's phone |
| Phase 5: Collaborative Claiming | Browser ↔ Worker ↔ D1         | Diner picks a name, which locks it to that phone (participant token), then taps items. PUT /claims writes one row and returns the room's full claim set; browser recalculates shares. | item_claims rows (line_item_id, participant_id)                   |
| Phase 6: Payment Settlement     | NPCI UPI Rail (OS intent)     | upi://pay link with the exact amount; diner and host update status via PATCH.                                                                                                         | UNPAID → SELF_PAID → HOST_CONFIRMED                               |

### 2.2 State Lifecycle & Room Synchronization

A SplitTab room moves through these stages. Room-level status is derived from participant statuses rather than stored (v1.0 stored a status column that nothing ever updated):

- **REVIEW (browser only):** the parsed bill exists only on the host's phone until confirmed, so abandoned scans leave no data behind.
- **ACTIVE_CLAIMING:** created atomically: the session, every participant (payment_status = UNPAID) and every line item are written together or not at all.
- **IDENTITY (v2.1):** picking a name issues a participant token to that phone; other phones cannot use the name until the host unlocks it. The host token lets the host act for anyone.
- **FRACTIONAL RECONCILIATION:** each tap inserts or deletes one item_claims row. The (line_item_id, participant_id) primary key makes duplicate claims impossible; shared items split automatically.
- **SELF_PAID ATTESTATION:** after paying in their UPI app the diner taps "I have paid the host" (and can undo it until the host confirms).
- **HOST_CONFIRMED FINALITY:** the host checks the bank SMS or UPI notification and taps Verify in Room Summary. Only a request carrying the host token can set or undo this state.
- **EXPIRY:** a daily scheduled job deletes rooms older than 30 days; child rows are removed by ON DELETE CASCADE.

## 3. Technology Stack & Strategic Justifications

Every layer was chosen against four criteria: speed to build, zero user friction, ₹0 running cost on permanent free tiers, and robust handling of messy real-world receipts.

### Gemini Multimodal Vision (Google AI Studio / Gemini API) 

Legacy OCR solutions (such as Tesseract, AWS Textract, or Google Cloud Vision OCR) merely extract unstructured bounding boxes of text. They fail catastrophically on wrinkled, low-contrast, thermal restaurant receipts where items and prices are not neatly aligned in rigid tabular formats. Furthermore, legacy OCR cannot understand domain semantics (e.g., discerning that 'Kingfisher Draught' is an alcoholic beverage requiring State Liquor VAT, while 'Paneer Butter Masala' is food subject to 5% GST).

Gemini Flash is called at temperature 0 with a response schema (structured output), so the reply is always JSON in the expected shape, with no markdown fences to strip. The model name is configuration with an automatic fallback, because v1.0 stopped working when Google retired gemini-1.5-flash.

### Cloudflare Workers (replaces Make.com)

About 300 lines of Worker code replace the Make.com scenario. Owning the code fixes the order of operations (v1.0's webhook replied before participants and items were saved, so rooms often loaded empty), keeps the Gemini key server-side, and serves the HTML from the same origin, so there is no CORS. Free plan: 100,000 requests per day, unlimited static file requests and 10 ms of CPU per request, which is why the photo is sent as a raw base64 text body instead of being wrapped in JSON.

### Cloudflare D1 (replaces Supabase)

Bill splitting is inherently relational: a room owns participants and line items, and items are claimed many-to-many through item_claims. D1 is SQLite with foreign keys, ON DELETE CASCADE, CHECK constraints and a case-insensitive unique name per room. Unlike a Supabase free project it does not pause after 7 days of inactivity. The browser never touches the database directly, so there is no public key with write access to every table (v1.0 disabled row-level security and granted ALL to the anon role). Free: 5 GB storage, 5 million row reads and 100,000 row writes per day. D1 also holds a small parse_log table that rate-limits receipt scans (v2.1), so no paid rate-limiting product is needed.

### Lightweight Web Client (HTML5 / Tailwind CSS / Vanilla JS)

The central product thesis of SplitTab is zero app installs. Native iOS or Android mobile apps present an insurmountable barrier for casual group dining. A lightweight, dependency-free single-page web architecture ensures instant load times inside WhatsApp's in-app webview.

The client layer keeps in-browser HTML5 Canvas compression, now sized for receipts: width ≤ 1200 px and height ≤ 2400 px (v1.0 capped the longest side at 1024 px, which made small print on long bills unreadable), JPEG quality 0.8, typically 150–600 KB. All text from the receipt or from users is HTML-escaped before it is displayed. Styling is a pre-built 16 KB Tailwind stylesheet (app.css) instead of the ~400 KB Tailwind CDN script, which matters inside WhatsApp's in-app browser on 4G.

### Hosting: Cloudflare (replaces Vercel + FlutterFlow)

Worker static assets provide HTTPS, a global CDN and a single-page-app fallback, so /r/{code} links open the app directly. The FlutterFlow wrapper is dropped: it embedded the same page and added a dependency without adding a capability.

## 4. Mathematical Domain Model & Tax Splitting Logic

A primary defect of naive bill-splitting applications is the assumption of uniform tax distribution. In India, dining bills present complex bifurcated taxation rules where food is taxed under GST while alcohol is taxed under State Excise/VAT. SplitTab employs a deterministic financial mathematical engine that ensures penny-exact reconciliation across all diners.

### 4.1 Mathematical Formulation & Definitions 

Let the dining session be defined by the following formal sets and scalars:

- **Participants:** Set of participants: P = {p_1, p_2, ..., p_n}
- **Items:** Set of parsed receipt items: I = {i_1, i_2, ..., i_m}
- **Category Partitions:** Bifurcated item partitions: I = I\_{food} ∪ I\_{liq}, where I\_{food} ∩ I\_{liq} = ∅
- **Line Item Total:** Total line price of item i: T_i = q_i · u_i, where q_i is quantity and u_i is unit price
- **Claim Matrix:** Binary claim indicator: c\_{i,p} ∈ {0, 1}, indicating whether participant p claimed item i

### 4.2 Fractional Item Claiming Logic

When an item is shared among multiple diners (e.g., a shared basket of Garlic Naan or a pitcher of Draught Beer), the cost is partitioned equally among all claimants of that specific dish:

$$s_{i,p} = \frac{c_{i,p}}{\sum_{k \in P} c_{i,k}}$$

*(Fractional ownership share of item i by participant p)*

The individual base consumption totals for food and liquor for participant p are calculated as:

$$B_p^{\text{food}} = \sum_{i \in I_{\text{food}}} s_{i,p} \cdot T_i, \quad B_p^{\text{liq}} = \sum_{i \in I_{\text{liq}}} s_{i,p} \cdot T_i$$

*(Individual base food and liquor subtotal consumption)*

The overall aggregate food and liquor base amounts across the entire receipt are given by:

$$B_{\text{total}}^{\text{food}} = \sum_{i \in I_{\text{food}}} T_i, \quad B_{\text{total}}^{\text{liq}} = \sum_{i \in I_{\text{liq}}} T_i, \quad B_{\text{total}} = B_{\text{total}}^{\text{food}} + B_{\text{total}}^{\text{liq}}$$

*(Aggregate bill subtotals)*

### 4.3 Discretionary Service Charge Allocation

Discretionary restaurant service charges (SC, typically 5% to 10% of subtotal) are assessed across the entire bill prior to tax calculation. To ensure that tax multipliers remain strictly segregated between food GST and liquor VAT, the service charge is distributed proportionally across the food and liquor partitions:

$$SC_{\text{food}} = SC \cdot \left(\frac{B_{\text{total}}^{\text{food}}}{B_{\text{total}}}\right), \quad SC_{\text{liq}} = SC \cdot \left(\frac{B_{\text{total}}^{\text{liq}}}{B_{\text{total}}}\right)$$

*(Proportional service charge decomposition)*

### 4.4 Bifurcated Tax Multipliers

Indian dining tax law mandates that Food GST (comprising Central GST and State GST) is levied strictly on food and non-alcoholic items plus their apportioned service charge, whereas State Liquor VAT is levied strictly on alcoholic beverages plus their apportioned service charge. To eliminate complex multi-variable algebra in client code, SplitTab computes two effective composite overhead multipliers:

$$M_{\text{food}} = \frac{B_{\text{total}}^{\text{food}} + \text{CGST} + \text{SGST} + SC_{\text{food}}}{B_{\text{total}}^{\text{food}}} = 1 + \frac{\text{CGST} + \text{SGST} + SC_{\text{food}}}{B_{\text{total}}^{\text{food}}}$$

*(Effective Food Composite Multiplier)*

$$M_{\text{liq}} = \frac{B_{\text{total}}^{\text{liq}} + \text{VAT}_{\text{liq}} + SC_{\text{liq}}}{B_{\text{total}}^{\text{liq}}} = 1 + \frac{\text{VAT}_{\text{liq}} + SC_{\text{liq}}}{B_{\text{total}}^{\text{liq}}}$$

*(Effective Liquor Composite Multiplier)*

**Empty-bucket rule (new in v2.0):** if a bill has no food items, the food overhead moves to the liquor bucket, and vice versa. This keeps every printed rupee allocated even when the host forgets to mark drinks as alcohol (the Review screen also warns about this).

> **EQUITY GUARANTEE:** By multiplying an individual diner's food base by M_food and their liquor base by M_liq, a non-drinker is guaranteed to pay 0.00% of alcohol VAT, and drinkers absorb their fair share of state alcohol taxation without subsidization.

### 4.5 Platform Discount Scaling & Final Share Calculation

v2.0 first computes what the bill should total from its parts, then scales every share to what the host actually paid (or, with no discount, to the printed total). One factor therefore absorbs the platform discount, printed discounts and round-off:

$$C = B_{\text{total}}^{\text{food}} \cdot M_{\text{food}} + B_{\text{total}}^{\text{liq}} \cdot M_{\text{liq}}, \qquad \text{Target} = \begin{cases} A_{\text{paid}}, & \text{if } A_{\text{paid}} > 0 \\ G_{\text{bill}}, & \text{otherwise} \end{cases}, \qquad \delta = \frac{\text{Target}}{C}$$

v1.0 used δ = A_paid / G_bill. That only balances when C = G_bill exactly; any round-off line or charge the parser missed left the host short. The definitive share for participant p is unchanged in form:

$$F_p = \delta \cdot \left[ B_p^{\text{food}} \cdot M_{\text{food}} + B_p^{\text{liq}} \cdot M_{\text{liq}} \right]$$

*(Definitive Individual Payable Formulation)*

**Rounding rule:** each guest's share is rounded to the nearest paisa; unclaimed items (U) are rounded the same way; the host is assigned the remainder. This makes conservation exact in integer paise, not approximate:

$$\sum_{p \in \text{guests}} F_p + F_{\text{host}} + U = \text{Target} \quad (\text{exact, in paise})$$

### 4.6 Worked Numerical Verification (The Bangalore Bistro Case Study)

Consider the test restaurant receipt parsed by our system from 'The Bangalore Bistro':

| **Item Name**           | **Classification**                                                        | **Price (₹)**    | **Diner Claimants**                                 |
|-------------------------|---------------------------------------------------------------------------|------------------|-----------------------------------------------------|
| Paneer Butter Masala    | Food (I_food)                                                             | 380.00           | Claimed by Rohan & Priya (Split 50/50)              |
| Garlic Naan (x2)        | Food (I_food)                                                             | 90.00            | Claimed by Rohan, Priya & Amit (Split 1/3)          |
| Chicken Biryani         | Food (I_food)                                                             | 420.00           | Claimed exclusively by Amit                         |
| Kingfisher Draught Beer | Liquor (I_liq)                                                            | 320.00           | Claimed exclusively by Rohan (Non-drinkers exempt!) |
| Taxes & Charges         | CGST: ₹30.25 \| SGST: ₹30.25 \| SC (5%): ₹60.50 \| Grand Total: ₹1,331.00 | 1210.00 Subtotal | Apportioned mathematically across diners            |
| Host Discount Override  | Host paid ₹1,100 via Zomato Gold offer (Printed total: ₹1,331.00)         | A_paid = ₹1,100  | Markdown factor delta = 1100 / 1331 = 0.826446      |

Step-by-step arithmetic verification:

- Base Aggregates: B_food = 380 + 90 + 420 = ₹890.00; B_liq = ₹320.00; Total Base B_total = ₹1,210.00.
- Service Charge Allocation: SC_food = 60.50 · (890 / 1210) = ₹44.50; SC_liq = 60.50 · (320 / 1210) = ₹16.00.
- Multipliers: M_food = (890 + 30.25 + 30.25 + 44.50) / 890 = 995.00 / 890 ≈ 1.117978.  
  M_liq = (320 + 0 + 16.00) / 320 = 336.00 / 320 = 1.050000.
- Individual Share Computation:  
  • Rohan: Food base = (380/2) + (90/3) = 190 + 30 = ₹220.00. Liquor base = ₹320.00. Raw share = (220 · 1.117978) + (320 · 1.05) = 245.955 + 336.00 = ₹581.96. Discounted share F_Rohan = 581.96 · 0.826446 = ₹480.95.  
  • Priya: Food base = (380/2) + (90/3) = 190 + 30 = ₹220.00. Liquor base = ₹0.00. Raw share = 220 · 1.117978 = ₹245.96. Discounted share F_Priya = 245.96 · 0.826446 = ₹203.27.  
  • Amit: Food base = (90/3) + 420 = 30 + 420 = ₹450.00. Liquor base = ₹0.00. Raw share = 450 · 1.117978 = ₹503.09. Discounted share F_Amit = 503.09 · 0.826446 = ₹415.78.
- Capital Conservation Verification: F_Rohan (₹480.95) + F_Priya (₹203.27) + F_Amit (₹415.78) = ₹1,100.00 (Exact penny match to host payment).

> **VERIFIED IN CODE:** tests/math.test.mjs reproduces ₹480.95 / ₹203.27 / ₹415.78 = ₹1,100.00 exactly, and an end-to-end browser test produces the same UPI amounts. **Domain caveat:** in this sample the ₹60.50 GST is 5% of the full ₹1,210 subtotal, beer included. Because the model assigns all printed GST to the food bucket, the non-drinkers absorb the GST printed on the beer. Bars usually issue liquor on a separate VAT bill, where this does not arise, but the host can correct the taxes on the Review screen if it does.

## 5. Architectural Trade-offs & Production Roadmap

### 5.1 Architectural Trade-offs Evaluated

- **Code vs. No-Code Orchestration:** ~300 lines of Worker code replaced Make.com. Trade-off: a change needs a one-command deploy instead of a visual edit. Gain: guaranteed ordering, input validation and no 1,000-credit monthly cap.
- **Client-Side Maths vs. Database Function:** the split engine is a pure function in the browser (instant feedback, unit-testable) rather than the v1.0 Postgres function that was never deployed. Every client reads the same rows, so every client computes the same answer.
- **Client-Side Compression vs. Server-Side Pipeline:** retained from v1.0; it also keeps the Worker within its 10 ms CPU budget.
- **Tokens vs. Accounts (v2.1):** joining still needs no login. Possession of the room link lets you view; a host token (issued at creation) and per-phone participant tokens decide who can verify, unlock and claim. Trade-off: a lost host phone without the saved host link loses host control for that room.
- **Pre-built CSS vs. CDN Script (v2.1):** app.css is generated once with the Tailwind CLI and committed; deployment still has no build step. Trade-off: after changing classes in index.html, run npm run css.
- **Pull-Based Sync vs. WebSockets:** claims refresh on each tap, on Refresh and when the page regains focus. No persistent connections to host or pay for.

### 5.2 Engineering Roadmap for Production Scale

- **Host Recovery:** optional phone/OTP-less recovery of host control when the host changes device without the private host link.
- **Unclaimed Leftover Re-allocation:** let the host split unclaimed dishes equally or assign them to specific diners.
- **Live Sync:** Cloudflare Durable Objects WebSockets for instant "split N ways" updates across phones.
- **Automated Payment Reconciliation Webhooks:** Integrate Setu, Decentro, or RBI Account Aggregator (AA) webhooks to automatically reconcile bank UPI credits directly against participant rows, removing the need for manual host verification.
- **Pan-India State Tax Regulatory Rules:** Extend the Gemini prompt schema to support regional liquor excise policies across various Indian states (e.g., Karnataka Excise vs. Maharashtra VAT vs. Delhi Duty).
