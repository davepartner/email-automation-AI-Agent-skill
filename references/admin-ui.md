# Admin UI — the Email Automation section

A first-class, **calm and uncluttered** admin area that matches the app's existing design. Use its
design tokens (spacing, type, color, radius). If the app has no admin theme, apply the 20-laws rules:
clear hierarchy, ≤4 top-level tabs, 44px targets, 4.5:1 contrast, empty/loading/error states.

**Clarity is the feature.** The admin should never face a wall of controls. Show **one primary action
per view**, tuck secondary/destructive actions into an overflow (`⋯`) menu, and put advanced config
behind a drawer or a collapsible "Advanced" section. If a control doesn't help the current task, hide
it.

**Design with the UI/UX skill.** Build this page under the **`ui-ux-20-laws`** skill (if available):
apply its **Audit → Implement → Trace** protocol and its design tokens. `references/admin-design-laws.md`
maps every decision on this page to a law, with the Trace block and the pre-ship checklist. (If that
skill isn't available, the same rules apply inline there.)

---

## Navigation

Add one top-level menu item: **"Email Automation"** (mail icon), placed near other management items.

Tabs: **Sequences · Users & recipients · Settings**. *(Statistics live at the top of Sequences — not a
separate tab. Channels live inside Settings — not a fourth tab.)*

**Tab DOM contract:** every pane must be a **direct sibling inside the same `.tab-content`** (or use
the framework's router). Never place a pane outside that container, and never wrap sibling panes in a
second `.tab-content`. Bootstrap's tab plugin only hides the direct siblings of the target pane, so an
orphan pane appends below the previous tab instead of replacing it — the exact bug seen when a stray
`</div>` in a partial closed the container early. Keep the panes flat; nest tabs only *inside* one
pane.

---

## Information architecture (keep it uncluttered)

- **Three tabs max:** Sequences · Users & recipients · Settings. Statistics sit inside Sequences, above
  the list. Nothing else in the top-level nav.
- **One primary action per view** (Sequences → "Add step" / "Edit"; Users → search; Settings →
  "Save"). The statistics time range is a filter, not a primary action.
- **Progressive disclosure:** the list stays scannable; details open in a **side drawer**, not a page
  that shows everything at once. Advanced settings collapse under "Advanced".
- **Overflow menu (`⋯`) per row/card** for secondary actions (Start/Pause, Duplicate, Statistics,
  Delete). Never a row of 4+ buttons.
- **Search & filters** live in the list toolbar, collapsed under a "Filter" button when not needed.
- **Health banners only when there's a problem** — hide them when all checks pass so the page stays calm.
- **One visual language:** one button style, one badge style, one drawer pattern throughout.

---

## Health & warnings (shown at the top of every tab)

Surface **prominent banners** when email can't go out. Full detection + fix guidance:
`references/health-checks.md`.

1. **No email transport configured (critical).** No SMTP/API key → "No email sending is configured —
   emails can't be delivered." Explain how to configure it (the app's mail settings) + a **Send test
   email** button.
2. **Scheduler / cron not running (critical).** The scheduler writes `last_cron_run_at` each run; if
   it's older than ~10 minutes, warn: "The email scheduler hasn't run in {duration} — emails are
   queued but not sending." Expand for **why** (cron not installed, queue worker down, wrong clock,
   crash) and **how to fix** (the exact cron/queue command for this stack).
3. **Automation paused (warning).** Master switch is off → "Email Automation is paused — no emails are
   being sent." + [Turn on].

Order: transport → scheduler → paused. Each banner: reason, expandable "how to fix", action buttons.
Re-check on load + every 60s + a manual "Re-check".

---

## Tab 1 — Sequences

### At the top: performance, charts and the sending plan

The Sequences tab opens with the answer to "is this working?" — before the list of sequences.

1. **Headline metrics** (last 30 days, time-range toggle: 7 / 30 / 90 days):
   reminders sent · recipients · **converted** · **conversion rate** · **attributed revenue**.
   Attribute a conversion when the user purchases within the admin-set window (default **7 days**).
   Label it as attribution, not causation, and state the window.
2. **Two charts, one idea each** (stacked, full width, 44px legend targets):
   - **Emails sent per day** — a bar chart from the sent log (`email_sent`), one bar per day, with
     scheduled-but-not-sent shown as a lighter stacked segment. No dual axis.
   - **Sales from email per day** — a line/bar of attributed revenue per day, currency formatted
     (`₦`, `$`, …), same date axis as the sent chart so the reader can compare them vertically.
   Keep one accent colour, accessible labels, a tooltip with the exact number, and a visible empty
   state ("No emails sent in this range yet").
3. **Sending plan / quota** — read from the provider API when available (see
   `references/provider-api.md`): plan name, emails sent in the current period, **remaining credits**,
   and the reset date. Show a progress bar (`sent / allowance`) and a link to the provider's billing
   page. If the API cannot be reached, show the app's own sent count and a "Check provider" link —
   never invent a quota.
4. **Per-sequence breakdown table** (sent, converted, rate, revenue) with the table laws from
   `admin-design-laws.md`.

This replaces a separate Statistics tab: the admin sees performance and the sequence list in one
place, with one scroll and no tab switch.

A calm, scannable list of sequences (the default 8 + any platform-derived ones). Each is a **card**
showing: name, **status badge** (Running / Paused / Off), and counts (enrolled · sent · converted).
Clicking the card opens the **edit drawer** — it does **not** expand everything inline.

### Per-sequence controls (Start · Pause · Delete)

- **Start / Pause** — one clear toggle on the card. Starting a paused sequence schedules only *future*
  steps (never back-fills past ones).
- **Overflow `⋯` menu** for secondary actions: Edit · Duplicate · View statistics · **Delete**. Never a
  row of 4+ buttons.
- **Delete** is destructive and gated by a **confirmation modal**. It explains *"This cancels all
  scheduled emails for this sequence and removes it. Users already emailed are unaffected; the sent log
  is kept. This can't be undone."* The admin must **type the word `delete`** (case-insensitive) to
  enable the final **Delete** button — the button stays disabled until the input matches, and the field
  is not pre-filled. Deleting cancels the `email_scheduled` rows and **soft-deletes** the sequence
  (keeps `email_sent`); offer **restore** for 30 days.
- **Bulk** (optional): select several → Start / Pause / Delete, behind a "Bulk" menu.

### Edit drawer

A slide-over drawer (not a cluttered new page) with the step list (delay, discount %, subject, body via
the free WYSIWYG, stop condition), **Add step** (see below), preview + test-send, and a collapsible
**Advanced** section (precedence, holdout %, A/B). The list page stays clean because details live here.

### Add / edit steps (admin can extend a sequence)

- **"Add step"** appends a new step: delay, subject, body (WYSIWYG), discount % (0 = no mention),
  stop condition, on/off.
- Adding a step to a **live** sequence also schedules it for active enrolments
  (`due_at = enrolled_at + delay`; idempotent on `(enrollment_id, step_id)`).
- **Reorder** keeps delays monotonic (validate); **delete a step** cancels its scheduled emails
  (confirm first).
- A new step does **not** re-email users who already passed that point unless the admin explicitly
  opts in.

### Email body editor (WYSIWYG — reuse what exists first)

**Before adding an editor, check whether the app already has one** (TinyMCE/CKEditor/Quill/Summernote/
TipTap, or the framework's admin editor). **If it does, reuse it** — configure it for email-safe
output. Only if none exists, add a **free, self-hosted** editor (TinyMCE Community, Quill, TipTap,
Summernote, or GrapesJS + MJML). Never a paid cloud-only editor.

Whatever the editor, run its output through an **email-safe pipeline**: sanitize (allowlist) → transform
to email-safe HTML (tables, inline CSS, ~600px, no JS) → wrap in a base template → store HTML +
plain-text. Merge tokens + a conditional `{{#discount_active}}` block. **Full detail:**
`references/wysiwyg.md`.

## Tab 2 — Users & recipients

Two jobs: **find a user and control what they receive**, and **audit the log**.

### Find a user & control their emails

- **Search box:** "Find a user by email" → results → open the **user panel**.
- **User panel:** email (→ profile), phone, registration/login dates, consent, holdout flag.
- **Their emails, grouped by sequence** — each step with status (`sent` · `scheduled` · `cancelled` ·
  `failed`) and its date. A **down caret** on each sequence expands the full ordered list of emails
  going out. **If the user opted out, a badge beside the caret reads "Manually exited this sequence"**,
  and the expanded view shows *"Exited — unsubscribed"* (or *"Exited — purchased"* if they bought).
- **Cancel one email:** a "Cancel" action on any **scheduled** step → `email_scheduled.status =
  'cancelled'` (confirm). Also record a per-step exclusion (`email_step_exclusions`) so it isn't
  re-scheduled.
- **Exclude the user completely:** a prominent "Exclude from all automation" action → adds to
  `email_suppressions` (reason `admin`) and cancels all their scheduled rows. Offer **Re-include**
  (re-consent if they unsubscribed themselves).
- **Per-product unsubscribe.** The unsubscribe link in a product reminder opts the user out of **that
  sequence for that product** (`email_optouts`), not all marketing. The caret shows it as "Manually
  exited this sequence"; the user can still receive other sequences.
- Every change is written to `admin_audit`.

### The audit log

The full sent log, **paginated by 100**:

| Column | Notes |
|--------|-------|
| User | email — **clickable → user profile / user panel** |
| Sequence / step | e.g. "Abandoned cart · Step 2" |
| Status | sent · scheduled · cancelled · failed |
| When | sent_at or scheduled due_at (user-local time) |
| Why | the triggering event + stop/cancel reason |

- Filters: sequence, status, date range, email search.
- A cancelled row shows *why* (stop condition, admin cancel, exclusion).
- Empty state: "No emails yet — turn on a sequence to start."
- The **caret in the product/checkout admin tables** links here to manage the same user.

## Tab 3 — Settings

- **Master switch** (big, obvious): *Email Automation is PAUSED / ON*. Ships **PAUSED**.
- **Sender:** from-name, from-email (branded domain), reply-to, physical mailing address.
- **Limits:** max emails/user/24h, max/week, quiet-hours window.
- **Attribution window** (default 7 days).
- **Admin tables toggle** (see below) + instructions.
- Test-send button.

### Channels (email · push · WhatsApp · SMS)

A per-channel panel inside Settings. For each channel show a status badge (**Configured / Not
configured / Off**) and:

- **Detected provider** — if the app already has one (FCM/APNs/OneSignal, Twilio/Vonage, WhatsApp Cloud
  API), show it and reuse it. **Don't add a second provider for the same channel.**
- **Credentials** (only when none exists): API key / secret / sender ID / number — stored **encrypted**,
  never logged.
- **Send test** and an **enable/disable** toggle per channel.
- A link to the provider's setup docs.

If a channel has no provider/credentials, any sequence using it is blocked and a health warning is shown
(`references/health-checks.md`). Full channel rules: `references/channels.md`.

---

## Admin-only tables on product & checkout pages

At the **bottom** of each **product detail** and **checkout** page, show a table **only to admins** —
clearly marked **"Admin only"** (a badge + a one-line note, e.g. *"This data is visible to admins
only."*).

Two tabs:

- **Leads** — users who reached this cart/checkout but haven't purchased (the `lead` stage).
- **Paid** — users who bought this product.

When a lead purchases, they **move from Leads to Paid**, that lead's scheduled reminders are cancelled,
and they're enrolled in the **paid-product** sequences (review/upsell). The row's caret reflects the new
state.

Columns:

| Column | Behaviour |
|--------|-----------|
| Email | **clickable → user profile** |
| Registered | datetime |
| Logged in | datetime |
| Abandoned at | datetime (Leads tab) |
| Purchased at | datetime (Paid tab) |
| Would have paid | amount + currency |
| Phone | **clickable → `tel:` call** (if present) |
| Emails ▾ | caret expands the sequence (**active** / **exited-unsubscribed** / **exited-purchased**) and links to the user panel to cancel one or exclude the user |

- The caret opens a small timeline: sent (with date) and scheduled (with due date).
- Respect privacy: only aggregate the data the admin already has access to.
- **Performance:** these tables can be expensive to compute per page view — paginate, cache (short
  TTL), and precompute aggregates. Never run an unbounded `purchased/abandoned` query on every product
  page hit.
- **Access control:** require the app's **admin permission** (not just "logged in"), and **audit** who
  viewed. This is PII (email + phone) on a normal page.
- **Rate-limit the test-send** and permission-gate it (abuse vector).

### Disabling these tables

The admin can **hide these tables** from **Email Automation → Settings** with a single toggle. Put the
instructions **right under the table title** for discoverability:

> **Admin only · [Leads | Paid]**
> *To hide this table, go to Email Automation → Settings → "Show Leads/Paid tables".*
> (link)

When disabled, the table disappears from product/checkout pages but the automation keeps working.

---

## Design & states

- **Empty states** with a next action.
- **Loading** skeletons for tables/charts; **errors** inline and actionable.
- **Destructive** actions (delete a sequence, delete a step, exclude a user) confirmed with consequences.
  Deleting a **sequence** requires typing the word **`delete`** in a confirmation modal before the
  Delete button enables.
- **Responsive**: tables scroll or collapse to cards on mobile; charts resize.
- **Accessible**: labelled inputs, focus rings, keyboard-navigable tabs, chart data mirrored as a table
  for screen readers.
- **Seamless**: reuse the app's admin layout, sidebar, buttons, and colors — it should look native.

### Keep it uncluttered (do / don't)

- **Do** show one primary action per view; put the rest in `⋯`.
- **Do** use a drawer for details so the list stays scannable.
- **Do** collapse "Advanced" settings by default.
- **Do** hide health banners when everything is fine.
- **Don't** stack every setting on one screen.
- **Don't** use more than ~3 accent colors or more than 4 tabs.
- **Don't** put destructive actions next to primary ones without a separator + confirmation.
- **Don't** auto-expand every sequence/step — let the admin open what they need.

## Turning it on (hand-off)

The section ships **paused**. On first open, show a banner:

> "Email Automation is installed and **paused**. Preview a sequence, then switch it on when you're
> ready." → **[Turn on]** **[Preview]**

The admin can also ask the agent to turn it on after a successful preview/test-send.
