# 🧾 SplitTab: Zero-Install Collaborative Dining Split Utility

> **A zero-friction, itemized group dining settlement utility for urban India. Extracts complex restaurant bills using Multimodal Vision AI, bifurcates GST vs. Liquor VAT, and settles instantly via 1-tap UPI deep-links.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel%20App-0284c7?style=for-the-badge&logo=vercel)](https://splittab-eight.vercel.app/)
[![FlutterFlow Demo](https://img.shields.io/badge/Mobile%20Container-FlutterFlow-6366f1?style=for-the-badge&logo=flutter)](https://splittabdemo.flutterflow.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=for-the-badge)](LICENSE)

---

## 📌 The Problem: Friction in Indian Group Dining

Settling post-dining checks across urban India is plagued by social friction, calculation errors, and informal debt loss:
* **App-Install Fatigue:** Traditional split apps (Splitwise, etc.) force every diner at the table to download an app, create an account, and log in before settling.
* **Iniquitous Equal Splits:** Non-drinkers are routinely forced to subsidize expensive alcoholic beverages, while those sharing light appetisers pay an arbitrary flat fraction.
* **Cascading Tax Complexity:** Indian dining receipts combine **5% Food GST (CGST 2.5% + SGST 2.5%)** with **State Excise/Liquor VAT (10%–25%)**, plus discretionary **Service Charges (5%–10%)** and host-level platform discounts (Zomato Gold, Swiggy Dineout, credit card offers). Manually bifurcating these is practically impossible at the table.
* **Informal Debt Leakage:** Organizers paying upfront face awkward WhatsApp reminders and lose 15%–25% in unreconciled shares.

---

## ⚡ The Solution: SplitTab Architecture

SplitTab eliminates all diner-side friction through a **zero-install progressive web utility**:
1. **The Host** snaps a single photo of the physical receipt and inputs attendee first names.
2. **Multimodal Vision (Gemini 1.5/3.1 Flash)** extracts dishes, itemizes quantities/prices, tags alcohol lines, and isolates taxes into structured JSON.
3. **Diners** join via a zero-auth WhatsApp link, select their name, and tap the items they ate or shared.
4. **Deterministic Math Engine** computes exact fractional shares, ensures non-drinkers pay 0% alcohol tax, and scales host discounts across all items.
5. **1-Tap Settlement** invokes native UPI payment rails (`upi://pay`) directly launching Google Pay, PhonePe, or Paytm with the exact penny-matched share pre-filled.

```
                                  SPLITTAB SYSTEM ARCHITECTURE
                                  
  [Client Webview] ──(Base64)──► [Make.com Webhook] ──(Payload)──► [Gemini 1.5/3.1 Flash]
  (Vercel / Canvas)              (Gateway Bus)                      (Multimodal OCR)
         ▲                              │                                    │
         │                              ▼                                    ▼
  (State / Claims)               [Supabase BaaS] ◄──────────────(Strict JSON Schema)
         │                       (PostgreSQL DB)
         ▼
  [Diner Settlement] ──(UPI Intent)──► [NPCI Banking Rail] (GPay / PhonePe / Paytm)
```

---

## 🛠️ Tech Stack & Technical Justifications

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Vision OCR Engine** | **Google AI Studio (Gemini 1.5/3.1 Flash)** | Traditional OCR (Tesseract/Textract) fails on crumpled thermal receipts. Gemini performs OCR, dish semantic classification (`is_alcohol`), and structured JSON schema enforcement in a single sub-2s inference call. |
| **Orchestration** | **Make.com** | Visual integration bus that validates incoming payloads, runs Gemini vision parsing, iterates item/attendee arrays, and writes records to Supabase without requiring custom microservice infrastructure. |
| **Persistence & State** | **Supabase (PostgreSQL BaaS)** | Provides relational integrity across nested dining dependencies (`sessions` $\rightarrow$ `participants` $\rightarrow$ `line_items` $\rightarrow$ `item_claims`) with auto-generated REST APIs. |
| **Client Interface** | **HTML5 + Tailwind CSS + Vanilla JS** | Lightweight single-file PWA architecture ensures sub-second load inside WhatsApp's in-app webview. Includes client-side Canvas downsampling to compress 10MB mobile captures to <400KB before transmission. |
| **Hosting & Container** | **Vercel Edge + FlutterFlow** | Vercel provides instant global CDN deployment with open iframe policies, while FlutterFlow serves as a multi-platform web wrapper for cross-platform app readiness. |

---

## 📐 Mathematical Formulation (Bifurcated Tax Model)

SplitTab enforces strict segregation between Food GST and Liquor VAT to guarantee equity:

### 1. Fractional Ownership
For item $i$ claimed by a subset of diners:
$$s_{i,p} = \frac{c_{i,p}}{\sum_{k \in P} c_{i,k}}$$

### 2. Discretionary Service Charge Allocation
Service charge ($SC$) is apportioned proportionally across food and alcohol partitions:
$$SC_{\text{food}} = SC \cdot \left(\frac{B_{\text{total}}^{\text{food}}}{B_{\text{total}}}\right), \quad SC_{\text{liq}} = SC \cdot \left(\frac{B_{\text{total}}^{\text{liq}}}{B_{\text{total}}}\right)$$

### 3. Effective Composite Tax Multipliers
$$M_{\text{food}} = 1 + \frac{\text{CGST} + \text{SGST} + SC_{\text{food}}}{B_{\text{total}}^{\text{food}}}$$
$$M_{\text{liq}} = 1 + \frac{\text{VAT}_{\text{liq}} + SC_{\text{liq}}}{B_{\text{total}}^{\text{liq}}}$$

> Non-drinkers carry $B_p^{\text{liq}} = 0$, mathematically guaranteeing they pay zero alcohol tax.

### 4. Platform Discount Scaling & Conservation of Capital
For host payment $A_{\text{paid}}$ against receipt total $G_{\text{bill}}$:
$$\delta = \frac{A_{\text{paid}}}{G_{\text{bill}}}, \quad F_p = \delta \cdot \left[ B_p^{\text{food}} \cdot M_{\text{food}} + B_p^{\text{liq}} \cdot M_{\text{liq}} \right]$$
$$\sum_{p \in P} F_p \equiv A_{\text{paid}} \quad (\text{exact penny reconciliation})$$

---

## 📁 Repository Directory Structure

```text
splittab/
├── README.md                           # Product & technical architecture specification
├── LICENSE                             # MIT License
├── .gitignore                          # Standard gitignore for secrets & OS artifacts
├── assets/
│   └── test_receipt_bangalore_bistro.png # Top-down receipt image for live verification
├── database/
│   └── schema.sql                      # Supabase DDL schema, foreign keys, & RLS permissions
├── workflows/
│   └── make_receipt_processor.json     # Make.com orchestration blueprint
└── web/
    └── index.html                      # Standalone zero-install frontend web utility
```

---

## 🚀 Quickstart & Setup Guide

### 1. Database Setup (Supabase)
1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and execute the entire [`database/schema.sql`](database/schema.sql) script.
3. Note your **Project URL** and **Public `anon` Key** under **Project Settings $\rightarrow$ API**.

### 2. Workflow Orchestration (Make.com)
1. Create a new scenario in [Make.com](https://make.com).
2. Click the three dots `...` at the bottom and select **Import Blueprint**.
3. Upload [`workflows/make_receipt_processor.json`](workflows/make_receipt_processor.json).
4. Connect your Supabase credentials and Gemini API Key in the respective modules.
5. Turn the scenario **ON**.

### 3. Frontend Deployment (Vercel)
1. Open [`web/index.html`](web/index.html) and update lines 193–198 with your live Make.com webhook URL and Supabase credentials.
2. Drag and drop the `web` folder into [Vercel](https://vercel.com) to deploy instantly.
3. Test using [`assets/test_receipt_bangalore_bistro.png`](assets/test_receipt_bangalore_bistro.png).

---

## 👨‍💻 Author

**Nishant**  
*Senior Product Manager — AI Platforms & Consumer Products*  
* [GitHub Profile](https://github.com/arkhamknight147)
