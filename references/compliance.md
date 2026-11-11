# Compliance — operationalized

The legal mechanics, as concrete components (not just prose). Ship these with the automation.

---

## 1. Consent capture

- At signup, show an **unchecked** marketing-consent checkbox (or a clear opt-in clause) linked to the
  privacy policy. Record `consent_marketing = true/false`, `consent_at`, `consent_ip`, `consent_source`.
- Only email users whose `consent_marketing` is true (or where a lawful basis exists).
- **Double opt-in** (recommended): send a confirmation email; only activate marketing after the click.

## Per-channel consent (push, SMS, WhatsApp)

- **Push:** opt-in + permission granted + a valid device token; remove tokens the provider reports invalid.
- **SMS:** explicit opt-in (**TCPA** in the US); verified number; honor `STOP`/opt-out keywords
  immediately; include opt-out instructions in the message.
- **WhatsApp:** explicit opt-in (Meta requires it); **approved templates** for the first message; honor
  opt-out.
- Store consent **per channel** with timestamp + source. Unsubscribing from one channel must not silently
  enrol the user in another.

## 2. Unsubscribe endpoint (signed + one-click)

```
GET  /unsubscribe?token=<signed>   → preference page
POST /unsubscribe                  → one-click (List-Unsubscribe-Post)
```

- The token is **signed** (HMAC or JWT) and encodes the user/email — not a guessable numeric id.
- `POST` honours `List-Unsubscribe=One-Click`; it must work **without login**.
- On unsubscribe: insert into `email_suppressions` (reason `unsubscribed`), cancel future scheduled
  emails for that user, and show a confirmation page (no login required).
- Support **unsubscribe from all** and from a specific sequence.

```
List-Unsubscribe: <https://app.com/unsubscribe?token=...>, <mailto:unsubscribe@brand.com>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

## Scoped unsubscribe (per product / sequence)

A product reminder's unsubscribe link should opt the user out of **that sequence for that product**,
not all marketing. Encode the scope in the signed token and **never infer it from a missing field**:

```json
{ "userId": "u_1", "scope": "product",
  "sequenceKey": "payday_reengage", "productId": "A",
  "iat": 1767225600, "exp": 1769817600, "jti": "3f0c…" }
```

- **`scope`** is required: `all` (global marketing), `sequence` (this sequence, all products — needs
  `sequenceKey`), or `product` (one sequence for one product — needs `sequenceKey` + `productId`).
  A token without a known scope is **rejected**, so an old `{userId,email}` token can never silently
  become a global opt-out.
- **`exp`** — expire links (e.g. 30 days) and reject expired tokens. **`jti`** — record it when used and
  reject replays (one-click links get prefetched and re-clicked).
- **`iat`** — reject tokens issued in the future (clock skew > 5 min), which usually means tampering.
- **Verify first, then apply:** `verifyUnsubscribeToken(token, secret, { isUsed })` →
  `applyUnsubscribe(store, payload)`. The server records `email_optouts` and the worker cancels that
  scope with reason `sequence-optout`. The admin caret then shows **"Manually exited this sequence"**.
  A global unsubscribe still exists via `email_suppressions`.
- Rotate the signing secret without breaking old links: verification may try the current and previous
  secrets; never accept an unsigned token.

## 3. Preference center

- One page to choose which sequences/categories they receive, frequency, and to unsubscribe-all.
- Accessible via a signed link in every email footer; no login required.

## 4. Bounce & complaint ingestion (provider webhooks)

```
POST /webhooks/email   ← provider (SendGrid/Mailgun/Postmark/SES)
  events: bounced (hard) → suppress (reason hard_bounce)
          complained      → suppress (reason complaint) + alert admin
          unsubscribed    → suppress (reason unsubscribed)
```

- Verify the webhook signature.
- Hard bounce / spam complaint → **permanent suppression** across all sequences.
- Alert the admin when the complaint rate exceeds a threshold (pause the system if it spikes).

## 5. Reply handling

- Replies go to a **monitored** inbox. A human processes them.
- A reply containing "stop", "unsubscribe", "remove me" → honour it (add to suppressions) — CAN-SPAM
  requires honouring opt-outs however they arrive.
- Route replies to the admin/support queue; don't ignore them — the "from a person" promise depends
  on it.

## 6. Retention & data rights

- `email_sent` (PII) — set a retention window (e.g. 24 months) and a scheduled purge.
- Honour **erasure**: deleting a user anonymises/removes their `email_sent`/`email_scheduled` rows.
- Provide **data export** of the user's automation history on request.

## 7. Physical address & sender identity

- Every marketing email footer: brand name, **physical postal address**, unsubscribe + preferences.
- Truthful from-name/subject (no deceptive "Re:").

## 8. Transactional vs marketing

- Order receipts, password resets, and security notices are **transactional** — they don't need
  marketing consent and must not be routed through this system's marketing suppressions.
- Everything here (reminders, upsells, win-back) is **marketing** → consent + unsubscribe required.

## 9. Regional notes

- **CAN-SPAM (US):** honour opt-outs promptly (≤10 days; do it instantly), physical address, truthful
  headers.
- **GDPR/ePrivacy (EU/UK):** consent-based marketing, easy withdrawal, data-subject rights, DPA with
  processors.
- **CASL (CA) / Spam Act (AU):** consent + identification + working unsubscribe within the local window.

## Checklist

- [ ] Consent captured + recorded (checkbox unchecked by default).
- [ ] Signed unsubscribe endpoint (GET + one-click POST), works without login.
- [ ] Preference center reachable via signed link.
- [ ] Bounce/complaint webhooks ingest into suppressions; admin alerted on complaints.
- [ ] Replies monitored; "unsubscribe" replies honoured.
- [ ] Retention job + erasure + export implemented.
- [ ] Physical address in every footer.
- [ ] Transactional email excluded from marketing suppressions.
