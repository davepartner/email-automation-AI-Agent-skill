# Changelog

## 2026-11-09 — Sequences and Statistics merged; readiness checklist

- Statistics are no longer a tab: the Sequences tab opens with KPIs, an **emails-per-day** chart, a
  **sales-per-day** chart and a **provider plan/quota** card (plan, sent, remaining, reset).
- Admin UI is now three tabs: **Sequences · Users & recipients · Settings**.
- Health checks are a humanized **readiness checklist**: verify provider/sender via API, show ✓ rows,
  and only warn for what actually fails. When clean, show "Everything is ready — nothing for you to
  do." Copy avoids env-var walls and gives one action plus a provider link.
- New `references/provider-api.md` (Brevo/SendGrid/Mailgun/Postmark/Resend): account, sender
  verification, plan/credits, stats, caching and graceful "unknown".
- `admin-ui.md`, `admin-design-laws.md`, `SKILL.md` and `quickstart.md` updated.


## 2026-11-09 — UI/UX standard extended to tables and emails

- Added `references/email-design-laws.md`: the 20 laws applied to the email canvas (600px, 16px body,
  one CTA, one accent, contrast, dark mode, alt text, in-email tables, plain-text twin) with a
  pre-ship checklist and Trace example.
- `references/admin-design-laws.md`: new "Tables & data lists" section covering alignment, number
  formatting, 44px row actions, pagination, responsive column hiding (including overriding blanket
  theme min-widths), empty/loading/error states and accessible sorting.
- `SKILL.md`: a mandatory design standard now covers **every admin page, table and email**, not just
  the page; deliverables include the UI/UX traces and pre-ship checklists.
- Quickstart updated with the design pass for tables and email templates.


## [1.0.0] — 2026-11-09

### Multi-channel (email · push · WhatsApp · SMS)
- **Channels**: detect and reuse the app's existing push/SMS/WhatsApp provider; otherwise the admin adds
  API keys in **Settings → Channels** (test-send, enable/disable). New `references/channels.md`.
- **Per-channel consent + suppression** in the worker (tested): non-email steps require explicit opt-in
  and are blocked by per-channel suppression; channel errors never crash the worker.
- **Opt-in prompts**: `references/opt-in-prompts.md` — prompt at the value moment, verify phone,
  handle push denial, never nag.
- **Channel helpers** (`examples/channels.mjs`, tested): channel fallback resolution, SMS segmentation
  (160/153 GSM-7, 70/67 UCS-2), push payload size, WhatsApp 24h template rule.
- Docs: `discovery.md` (detect providers), `sending-and-compliance.md` (per-channel limits),
  `compliance.md` (TCPA/WhatsApp/push), `admin-ui.md` (Channels panel), `health-checks.md` (channel
  not configured), `data-model.md` (channel tables), `sequence-config.json` (channels), and
  `examples/message-templates.md` (push/SMS/WhatsApp samples).

### Design
- **The admin page is now built with the `ui-ux-20-laws` skill** — added
  `references/admin-design-laws.md` (per-surface law map, Audit → Implement → Trace, pre-ship
  checklist) and wired it into the workflow, admin-ui, and README.

### Hardening (review items 2–10)
- **Worker now enforces** consent, holdout group, sequence precedence (max 1 active marketing), admin
  per-step exclusions, timezone-aware quiet hours, frequency caps, retry caps and max deferrals, and
  **transactional vs marketing** separation. Tests added for each (`worker.test.mjs`, 14 tests).
- **Signed unsubscribe tokens** (HMAC) with verify + tamper tests; **erasure** helper.
- **Discount conditional tested** with a real template engine (Mustache): `examples/render.mjs` +
  `render.test.mjs` assert a 0% discount renders **no** discount text.
- **CI** (`.github/workflows/test.yml`) runs `npm install && npm test` on every push.
- **WYSIWYG**: reuse the app's existing editor if it has one; else a free one. Email-safe pipeline
  (sanitize → transform → base template) documented in `references/wysiwyg.md`.
- **Provider rate limits, multi-tenancy, i18n** guidance + **max active sequences** guard.
- **Quickstart** (`references/quickstart.md`) + fixed ambiguities (delay = from enrolment; `kind`;
  config `templates` map; transactional vs marketing).

## [Unreleased]

### Platform scouting & derived sequences
- **Scout the platform's purpose** during discovery and derive the sequences that fit — added a
  **platform-derived sequence library** (email verification, profile completion, onboarding, KYC,
  billing/trial, trial ending, feature adoption, 2FA, policy re-consent, booking, renewal, first→second
  purchase, birthday) in `references/sequences.md` and `references/discovery.md` §4b.

### Admin controls & health
- **Sequence controls** — **Start / Pause / Delete** per sequence (delete requires typing **`delete`** in
  a confirmation modal, then soft-deletes + is restorable); bulk start/pause/delete.
- **Calmer admin UI** — ≤4 tabs, one primary action per view, details in a slide-over drawer, secondary/
  destructive actions in an overflow (`⋯`) menu, advanced settings collapsed, health banners only when
  there's a problem.
- **Add / reorder / delete sequence steps** from the admin (new steps also schedule for active enrolments).
- **Users tab** — search a user by email, expand their sequence with the down caret, **cancel a
  specific email**, or **exclude the user** from all automation (with audit + re-include).
- **Health banners** — warn when **automation is paused**, the **cron/scheduler isn't running** (with a
  detailed why + stack-specific fix commands + "Test now"), or there's **no SMTP/API key** (with setup
  steps + "Send test email"). Added `references/health-checks.md`.
- Data model: `email_step_exclusions`, `email_settings.last_cron_run_at`.


### Hardening (from the review)
- **Executable, tested engine** — `examples/worker.mjs` + `worker.test.mjs` (idempotency,
  stop-conditions, frequency caps, crash-recovery reaper) and `references/reference-implementation.md`
  (SQL with `FOR UPDATE SKIP LOCKED`, reaper, attribution).
- **Enforced non-disruption contract** (`references/non-disruption.md`) — backup, reversible
  migrations, `try/catch` hook isolation, smoke test, rollback drill.
- **Exact trigger rules** (`references/triggers.md`) — cart-abandon, inactivity, activation, etc.
- **Operationalized compliance** (`references/compliance.md`) — consent, signed one-click unsubscribe,
  preference center, bounce/complaint webhooks, retention.
- **Sending hardening** — locking, reaper, batching, user timezone, deliverability pre-flight.
- **Attribution** — last-touch model + holdout group.
- **Sequence precedence matrix**, min-cart discount guard, A/B subjects, and extra sequences
  (browse-abandon, back-in-stock, price-drop, dunning, referral).
- **Data model** — timezone, consent, unsubscribe tokens, holdout, admin audit.
- **Admin UI** — cache/paginate admin tables, permission + audit, rate-limit test-send.
- Trimmed the description; added a "when NOT to use" section.

- Initial release: non-disruptive email automation admin-section builder.
  - 8 research-backed lifecycle sequences (welcome, no-login, inactive, abandoned cart,
    post-purchase review, upsell, win-back, replenishment).
  - Personal one-to-one copy standards, discount rules (0% = hidden), contact-admin link in every email.
  - Cron-based sending engine with idempotency, stop conditions, frequency caps, quiet hours.
  - Admin dashboard: sequences, recipients log (100/page), conversion + revenue statistics, settings.
  - Admin-only purchased/abandoned tables on product & checkout pages.
  - **Free, self-hosted WYSIWYG editor** (TinyMCE Community; Quill/TipTap/Summernote/GrapesJS) for
    editing email bodies — email-safe HTML, merge tokens, conditional-discount block, plain-text twin,
    preview + test-send.
  - Deliverability + compliance (SPF/DKIM/DMARC, CAN-SPAM, GDPR, unsubscribe, physical address).
  - Ships paused by default; additive schema; reuses the app's email connection.
