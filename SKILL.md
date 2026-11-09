---
name: email-automation
description: >-
  Build a non-disruptive automation section inside an app's admin panel: lifecycle reminders (welcome,
  abandoned cart, post-purchase, upsell, win-back) across **email, push notifications, WhatsApp, and
  SMS**, with proven funnel timing, personal copy, a free WYSIWYG editor, conversion stats, and
  admin-only tables. Reuses the app's existing email/notification/SMS/WhatsApp providers, or lets the
  admin add API keys. Ships paused. Use for email automation, drip/lifecycle email, abandoned-cart
  recovery, push/WhatsApp/SMS reminders, or an "Email Automation" admin menu. Triggers: "email
  automation", "drip campaign", "abandoned cart emails", "reminder emails", "lifecycle emails", "welcome
  sequence", "win-back emails", "upsell emails", "push notifications", "whatsapp reminders", "sms
  reminders", "notification automation".
---

# Email Automation — Admin Section Builder

Build a **world-class email automation system inside the user's existing admin panel**. It watches
user behaviour, enrols people in the right lifecycle sequence, and sends **personal, one-at-a-time
reminder emails** through the app's own configured email connection — underpinned by proven funnel
timing, not blasts.

**Goal:** increase user return, purchase, and retention — without spamming anyone and without breaking
anything that already works.

> **Read this first:** this skill is *non-disruptive by design*. It **studies the app before touching
> it**, adds **only new tables/routes** (never rewrites existing flows), **reuses the app's email
> connection**, and ships **paused**. Nothing sends until an admin explicitly turns it on.

---

**Fast path:** `references/quickstart.md` (one page). **Depth:** the references below.

> **Design standard (mandatory):** every admin page, **every table/list**, and **every email** is a
> product surface. Before shipping any of them, load the **`ui-ux-20-laws`** skill (if available) and
> run its **Audit → Implement → Trace** protocol. Use the app's design tokens for style, and these
> references for the surface rules:
> - `references/admin-design-laws.md` — the admin page and its data tables.
> - `references/email-design-laws.md` — the email canvas, hierarchy, CTA, contrast, mobile, dark mode.
>
> If the skill is not available, apply the same laws inline. Never ship a page, table, or email
> without its pre-ship checklist and a short `Trace:` block.

## The workflow

```
0. Discover ─▶ 1. Design ─▶ 2. Build ─▶ 3. Wire events ─▶ 4. Admin UI ─▶ 5. Verify ─▶ 6. Hand off
   study the     data model    new tables/    triggers →       dashboard +     dry-run +     paused +
   app + admin   + sequences   worker/cron    enrolments       tables + stats  preview       "turn on?"
```

### 0. Discover (mandatory, before any code)
Study the app thoroughly and produce a short **integration plan**. See `references/discovery.md`.
- Detect the stack, framework, ORM/DB, auth, sessions, the **admin panel** (or note its absence).
- Find the existing **email connection** (SMTP/provider SDK) — reuse it; never add a second one.
- Map **products**, **cart/checkout**, **orders**, **users**, and the events needed.
- **Understand the platform's purpose and business model** (e-commerce, SaaS, fintech, booking, …), its
  activation event, and its critical account steps — then **propose extra reminder sequences** that fit
  (email verification, profile completion, onboarding, KYC, trial/billing, booking, renewal…).
- If there is **no admin panel**, ask the user whether to create a minimal one.

### 1. Design
- Define the **data model** (`examples/data-model.md`): sequences, steps, enrolments, scheduled
  emails, sent log, settings, suppressions.
- Choose the **sequence set** and timings (`references/sequences.md`).
- **Run the UI/UX audit now**, not after coding: the admin page (`admin-design-laws.md`), every table
  it exposes, and every email template (`email-design-laws.md`). Record the decisions that will become
  the final `Trace:` block.

### 2. Build (additive only)
- Add new tables/collections, a scheduler job, and the send worker. **Do not modify existing tables.**
- Add a **feature flag / master pause switch** (default OFF) and a global kill switch.

### 3. Wire events
- Hook the app's existing events (registration, login, cart add, checkout start, purchase, inactivity)
  into enrolment — **without changing their behaviour** (observe, don't intercept).

### 4. Admin UI
- Build the page under the **`ui-ux-20-laws` skill** (if available): apply its Audit → Implement → Trace
  protocol, design tokens, and the per-surface map in `references/admin-design-laws.md`.
- Design **every table** with the table rules in `admin-design-laws.md`: aligned columns, right-aligned
  numbers, 44px row actions, pagination, responsive column hiding, empty/loading/error states,
  keyboard sort, and status shown with text + colour (never colour alone).
- Add a top-level **"Email Automation"** menu with tabs: **Sequences · Users & recipients · Statistics ·
  Settings**. See `references/admin-ui.md`.
- Design **every email** with `email-design-laws.md`: one idea, one 44px CTA, 600px single column,
  16px body, one accent, ≥4.5:1 contrast, alt text, dark mode, plain-text twin.
- Add **admin-only** purchased/abandoned tables at the bottom of product and checkout pages.

### 5. Verify
- Dry-run mode, a **preview/test-send** tool, idempotency checks, and a stop-condition audit.

### 6. Hand off
- The system ships **paused**. Notify the admin, show a one-click "Turn on" (or let the agent help),
  and document rollback.

---

## The sequence catalog (proven funnel timing)

Full detail, copy intent, and stop conditions: `references/sequences.md`. Summary:

| # | Sequence | Trigger | Timing (default) | Stops when |
|---|----------|---------|------------------|------------|
| 1 | **Welcome / activate** | Registration | 0h welcome → 24h value → 72h social proof | Login / purchase |
| 2 | **Registered, never logged in** | Registered + no login | 1h → 24h → 72h | Login |
| 3 | **Logged in, no purchase/use** | Logged in, inactive | 1h nudge → 24h → 5d | Purchase / activation |
| 4 | **Abandoned cart / checkout / product** | Cart or checkout or product view, no purchase | **1h reminder (no discount) → 24h social proof/objection → 48–72h urgency + discount** | Purchase |
| 5 | **Post-purchase review** | Purchase (product type aware) | Next day "how's it going?" → 2 weeks "experience + upsell" | Review / unsubscribe |
| 6 | **Upsell / cross-sell** | Purchase, other products exist | After value moment (3–7 days) | Purchase of promoted item |
| 7 | **Win-back / re-engagement** | Inactive 30 / 60 / 90 days | Neutral → value → final "we'll stop" | Activity / unsubscribe |
| 8 | **Replenishment** | Consumable product | ~Day 45–60 | Repurchase |

**Discounts:** upsells may carry a discount; abandoned carts carry **urgency + discount**. Default
**0%** — when 0, the email must **not mention a discount at all**. A **min-cart guard** skips the
incentive on very low-value carts. (`references/sequences.md`.)

**Precedence:** a user is in at most one promotional sequence — purchase > cart > browse > welcome >
no-login > inactive > win-back. Extra sequences: browse-abandon, back-in-stock, price-drop, dunning,
referral. See `references/sequences.md`.

**Plus platform-derived sequences** discovered from the app's purpose — e.g. **email verification,
profile completion, onboarding setup, KYC, billing/trial ending, booking reminders, renewals**. Only add
the ones the platform can detect and act on (`references/sequences.md`).

---

## Non-negotiable rules

1. **Study before building.** Never modify existing auth, cart, checkout, order, or user flows. Add
   new tables/routes only.
2. **Reuse the existing email connection.** No second SMTP/provider setup. No mass/bulk sending —
   emails are **per-user and event-driven**.
3. **Ships paused.** Master switch OFF; admin is notified to turn it on (agent can offer to help).
4. **No spam.** Frequency caps (default ≤1 marketing email/user/24h, ≤4/week), quiet hours, and a
   **global suppression list** (unsubscribed, bounced, complained). Respect interest + consent.
5. **Stop conditions always win.** Re-check the goal (purchase/login/activation) **before every send**
   so buyers don't get cart reminders.
6. **Personal, one-to-one copy.** "From" one real person (`Name from Brand`), personally worded,
   references the actual product, one clear CTA, and a **"contact admin" link in every email**.
7. **Deliverability + legal.** SPF/DKIM/DMARC, branded sending domain, HTML + plain-text, unsubscribe
   + physical address, no spam trigger words. See `references/sending-and-compliance.md`.
8. **Everything auditable.** Every send is logged (who, which sequence/step, when, why) and every
   scheduled email is visible in the admin.
9. **Beauty + seamlessness — on every surface.** Build the admin page, its tables, **and the emails**
   under the **`ui-ux-20-laws` skill** (if available): apply its laws, tokens, and Audit → Implement →
   Trace protocol (`references/admin-design-laws.md`, `references/email-design-laws.md`). Match the
   app's design tokens so it looks native; clear hierarchy, 44px targets, accessible contrast, one
   primary action, one CTA per email. The pre-ship checklists and the `Trace:` block are part of the
   deliverable, not optional polish.
10. **Template editor: reuse before adding.** If the app already has a WYSIWYG editor, **reuse it**
    (configured for email). Otherwise add a **free, self-hosted** one (TinyMCE Community / Quill /
    TipTap / Summernote / GrapesJS). Output must be **email-safe** (inline CSS, tables, ~600px, no JS),
    sanitized, with merge tokens, a conditional-discount block, and a plain-text twin. See
    `references/wysiwyg.md`.
11. **Transactional ≠ marketing; one active marketing sequence.** Tag each sequence `kind`
    (`marketing` | `transactional`); marketing respects consent/suppress/holdout, while transactional
    (verification/KYC/billing) bypasses them. Enforce **≤1 active marketing sequence per user**, plus
    consent, holdout, exclusions, quiet hours in the user's timezone, retry caps and max deferrals —
    implemented and tested in `examples/worker.mjs` + `worker.test.mjs`.
12. **Multi-channel with per-channel consent.** Email is the baseline; **push / WhatsApp / SMS require
    explicit opt-in** and per-channel suppression. **Reuse the app's existing providers**; only add
    credentials when none exists (Settings → Channels). Prefer push → email → WhatsApp → SMS with
    fallback, and never send on two channels the same day. See `references/channels.md`.

---

## Non-disruption contract (enforced)

"Non-disruptive" is **verified**, not assumed. Full checklist: `references/non-disruption.md`. Minimum:

- **Back up** the DB before migrating; migrations are **additive + reversible** (no altering existing
  tables).
- **Hooks are observe-only and wrapped in `try/catch`** — a failing observer never breaks
  registration/login/checkout/payment.
- **Ships paused** with a **global kill switch**; reuse the existing mail connection.
- **Smoke test** all five core flows after install; run a **rollback drill** (disable → drop tables →
  confirm untouched).

## Admin surface (what the admin gets)

- **Calm, uncluttered layout** — ≤4 tabs, one primary action per view, details in a drawer, secondary/
  destructive actions in an overflow (`⋯`) menu, advanced settings collapsed, health banners only when
  needed.
- **Health banners** at the top of every tab (only when there's a problem): **no email transport
  configured**, **scheduler/cron not running** (with a detailed why + how-to-fix), and **automation
  paused**. See `references/health-checks.md`.
- **Email Automation** menu (top-level), with tabs:
  - **Sequences** — per-sequence **Start / Pause / Delete** (delete is confirmed + soft-deleted/
    restorable, tucked into `⋯`), delays, discounts, stop conditions, a **WYSIWYG editor (reuse the
    app's existing one if present)**, and **add / reorder / delete steps**.
  - **Users & recipients** — search a user by email; expand their **sequence of emails** with the down
    caret; **cancel a specific email** or **exclude the user completely**; plus the full sent log
    **paginated by 100** with *when* and *why*.
  - **Statistics** — of users who received a reminder, how many converted, revenue, chart by
    **day / week / month**.
  - **Settings** — sender (from-name/from-email/reply-to/physical address), master pause, caps,
    quiet hours, and a **Channels** panel (email · push · WhatsApp · SMS): detect/reuse the app's
    provider or add API keys, test-send, enable/disable.
- **Admin-only tables** at the bottom of **product** and **checkout** pages:
  - Tabs **Purchased** / **Abandoned** — clearly marked *"Admin only"*.
  - Columns: email (→ user panel), registration/login/abandon datetimes, would-have-paid amount,
    phone (→ `tel:` call), and a caret revealing **emails received + scheduled** that links to the user
    panel to cancel/exclude.
  - Disable-able from Email Automation → Settings, with instructions under the table title + link.

Full UI spec: `references/admin-ui.md`.

---

## When NOT to use

- **No lawful consent basis** for marketing email (offer a consent flow first).
- **Very small user bases** where automation noise outweighs value — send manually.
- **Products where email isn't the channel** (SMS/push-first) — adapt the engine, don't force email.
- **Regulated contexts** (health/finance) needing stricter review — get sign-off on copy + data flows.
- **High-assurance transactional needs** — never route receipts/security email through this system.

## Deliverables the agent produces

1. `references/discovery.md` → an **integration plan** for the specific app, including a **proposed
   sequence shortlist** derived from the platform's purpose.
2. New tables/migrations + the scheduler + send worker (additive).
3. The event hooks (observe-only).
4. The admin "Email Automation" page + tabs + statistics chart, including a **free WYSIWYG editor**,
   **add / reorder / delete steps**, a **user search + per-email cancel / exclude**, and **health
   warnings** (paused, cron not running, no mail transport).
5. The admin-only purchased/abandoned tables, designed with the table laws.
6. Email templates that pass `email-design-laws.md` (single column, one CTA, contrast, dark mode,
   plain-text twin).
7. A preview/test-send tool + dry-run + rollback notes.
8. The **UI/UX traces and pre-ship checklists** for the page, its tables, and the email set.
9. A short **hand-off doc**: what was added, how to turn it on, how to pause, how to roll back.

---

## References

- `references/discovery.md` — study the app, find the admin, choose an integration path.
- `references/non-disruption.md` — the enforced non-disruption contract (backup, reversible migrations,
  hook isolation, smoke test, rollback drill).
- `references/triggers.md` — exact detection rules for every trigger (cart-abandon, inactivity, etc.).
- `references/sequences.md` — the full sequence catalog, precedence, timing, copy intent, stop conditions.
- `references/email-copy.md` — personal "from one person" copy standards, subject lines, templates.
- `references/sending-and-compliance.md` — scheduler, idempotency, caps, deliverability pre-flight.
- `references/compliance.md` — consent, signed unsubscribe, preference center, bounce/complaint webhooks.
- `references/admin-ui.md` — the dashboard, users tab (search/cancel/exclude), log (100/page), stats,
  admin-only tables, WYSIWYG, add/edit steps.
- `references/admin-design-laws.md` — the admin page and tables mapped to the 20 UI/UX laws
  (Audit → Trace → checklist).
- `references/email-design-laws.md` — the 20 laws applied to the email canvas, hierarchy, CTA,
  contrast, mobile, dark mode, and in-email tables (Trace → checklist).
- `references/health-checks.md` — pause / cron-not-running / no-transport warnings with fix guidance.
- `references/channels.md` — multi-channel (email · push · WhatsApp · SMS), detection, consent, limits.
- `references/opt-in-prompts.md` — when and how to ask users to enable push/SMS/WhatsApp.
- `references/wysiwyg.md` — reuse an existing editor, else add one; email-safe pipeline.
- `references/quickstart.md` — the one-page path.
- `examples/render.mjs` + `render.test.mjs` — Mustache email renderer + 0%-discount test.
- Run the tests with `npm install && npm test` (worker + renderer).
- `references/reference-implementation.md` — the engine in pseudocode + SQL (locking, reaper, attribution).
- `examples/worker.mjs` + `examples/worker.test.mjs` — executable, tested scheduler/worker core.
- `examples/data-model.md` — DB schema.
- `examples/sequence-config.json` — a concrete, editable sequence config.
- `examples/email-templates.md` — sample rendered emails.
