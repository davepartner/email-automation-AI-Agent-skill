# Changelog

## 2026-11-10 — Detect the icon source before adding icons

- `iconography.md`: new **§1a Detect the source before you draw** — read the surface's layout, grep
  the class prefix already in use, confirm the glyph renders, then stay in that one library. Adds a
  Bootstrap Icons ↔ Font Awesome 5 mapping table and the shared-partial rule (admin and public layouts
  often load different sets; a shared partial must use one both load).
- `admin-ui.md`: detection bullet in the Iconography section.
- `admin-design-laws.md`: detection row (Similarity + Jakob's Law) and Trace decision.
- `SKILL.md` / `quickstart.md`: detection is part of the icon rule.


## 2026-11-10 — Iconography: a consistent, accessible icon system

- Added `references/iconography.md`: reuse the app's icon set first (Lucide/Heroicons/Material/Phosphor),
  else **Lucide**; one family/stroke/scale (16/20/24px, `currentColor`); accessibility (decorative icons
  `aria-hidden`, icon-only buttons need `aria-label` + tooltip + **44px** target, never colour/icon-only
  status); layout; a **full icon map** for the page; do/don't; sprite usage.
- Added `examples/icons.svg`: a ready Lucide-style `<symbol>` sprite (37 icons) covering nav, tabs,
  sequence actions, statuses, channels, health banners, Leads/Paid and user-panel actions.
- Added `examples/admin-preview.html`: a self-contained, light/dark rendered preview of the page (tabs,
  KPIs, sequence actions, statuses, the exited-sequence badge, Leads/Paid) with the sprite inlined.
- `references/admin-ui.md`: new **Iconography** section + inline icons on nav, tabs, sequence controls,
  the user caret/badge, the audit log, channels, Leads/Paid and the admin tables.
- `references/admin-design-laws.md`: icon rows in the per-surface law map and table rules, icon decisions
  in the **Trace** block, and a pre-ship checklist item (Similarity/Fitts's/WCAG/Occam's).
- `SKILL.md`: design rule 9 and the Admin UI step now require one icon family; `references/iconography.md`
  added to the references list.
- `README.md`: tasteful icons on the title, feature and sequence tables, and the Channels/email sections,
  plus a short **"Icons make it feel finished"** note and icon keywords.
- Housekeeping: removed the stale "Statistics tab" and "Purchased/Abandoned table" wording left over from
  the merged-statistics change.


## 2026-11-09 — Tab DOM contract

- `admin-ui.md`: panes must be direct siblings inside one `.tab-content`; a pane outside it (or a
  nested second `.tab-content`) leaves the previous tab visible and appends below. Notes the stray-
  `</div>` cause and the flat-pane rule.


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

### Payday re-engagement & Leads→Paid
- **New `payday_reengage` sequence** (kind `nurture`, per product): calendar-anchored steps on the **27th
  → last day → 2nd** for products still pending **≥ 7 days** after the initial cart reminders. Runs
  alongside the promotional sequence; the 1-email/user/day cap prevents clashes.
- **Calendar scheduling**: `examples/schedule.mjs` (`nextOccurrence`, `paydaySteps`) + tests, wired into
  `worker.enroll` via `schedule: { type: 'calendar', day: 27|'last'|2, hour }`.
- **Nurture kind** in the worker: marketing-like consent/cap, but skips promotional precedence; scoped
  per `product_id` (`examples/worker.mjs`).
- **Per-product opt-out**: `email_optouts` + scoped unsubscribe token (`sequence-optout`). Admin caret
  shows **"Manually exited this sequence"**; the user can still receive other sequences.
- **Leads → Paid**: `examples/leads.mjs` (`moveToPaid`, `isPaydayEligible`) + tests; on purchase the lead
  moves to the **Paid** table, its reminders are cancelled, and paid-product sequences enrol.
- Admin product/checkout tables renamed **Leads / Paid** with sequence status
  (active / exited-unsubscribed / exited-purchased).
- Docs updated: `sequences.md` (payday + nurture precedence), `triggers.md` (payday trigger + purchase
  transition), `admin-ui.md` (Leads/Paid + caret badges), `data-model.md` (product_leads, email_optouts,
  product_id, calendar schedule), `compliance.md` (scoped unsubscribe), `reference-implementation.md`,
  `sequence-config.json`.

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
