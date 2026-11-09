# Health Checks & Warnings

The page should answer one question in plain language: **"Is anything stopping my emails, and what
exactly do I do about it?"** — and when nothing is wrong, it should say so and get out of the way.

> **The rule: a checklist, not a wall of red banners.** Check everything you can via the provider API
> first (`references/provider-api.md`). Only raise a warning when a check actually fails. If all checks
> pass, show one calm green line: *"Everything is ready — you don't need to do anything."*

---

## The checklist model

Every health item is a row with four parts:

| Part | Example |
|------|---------|
| **State** | ✓ done · ● waiting · ! needs you · ? unknown (API unreachable) |
| **Plain label** | "Email provider connected" |
| **Human detail** | "Brevo is connected and the sender is verified." |
| **Action** | A link to the provider, a copyable cron line, or nothing |

Show the rows in a collapsed **"Sending readiness"** panel under the page title. When everything is
✓, collapse it to a single green pill; when something needs the admin, open it and show only the
failed rows plus a one-line summary.

Checks, in priority order:

1. **Provider connected** — API key valid (`GET /account` succeeds) or SMTP configured.
2. **Sender verified** — the from-address is a verified sender (provider API) or the sending domain is
   authenticated (SPF/DKIM/DMARC).
3. **Scheduler running** — heartbeat is fresh.
4. **Automation running** — master switch is on.
5. **Each channel configured** — push/SMS/WhatsApp only when a sequence uses it.

Cache the API result for 10–15 minutes and re-check on load and on a manual **Re-check** button.
Never block the page on a slow provider.

---

## Copy that helps, not scares

Write like a helpful colleague. Name the consequence, say who can fix it, and give one action. Keep
environment variable names and stack details inside a **"Technical details"** disclosure — not in the
headline.

| Instead of | Write |
|------------|-------|
| "No email transport configured. Add BREVO_API_KEY and BREVO_FROM_ADDRESS…" | "Email sending isn't connected yet. Add your provider key in **Settings → Email**, then press Re-check. [Open Brevo API settings]" |
| "Scheduler is not running. The heartbeat is stale since…" | "Emails are waiting because the website's scheduler hasn't checked in since **Mon 9 Nov, 8:08am**. This is a one-time server setup — send this line to your host, or paste it into cron. [Copy the line] [Ask your host]" |
| "Sender must be verified in Brevo." | "Brevo hasn't confirmed **support@brand.com** yet. Open Brevo and verify the sender or domain; after that, nothing else is needed. [Open senders]" |
| "A global unsubscribe, bounce or complaint suppresses the address." | "People who unsubscribe or report spam are removed from every sequence automatically. You don't need to manage that." |

**When all is well:**
> ✅ **Everything is ready.** Your sequences send automatically between 08:00 and 19:00. There's
> nothing for you to do.

Do **not** show a warning for a condition the API confirms is fine — for example, a key that exists
and a sender that is already verified. Show those as ✓ rows in the checklist, not as alerts.

---

## 1. Provider connected

**Detect:** call the provider's account endpoint with the configured key (Brevo `GET /v3/account`,
SendGrid `GET /v3/user/account`, Mailgun `GET /v4/domains`, Postmark `GET /server`). A 200 means
connected; a 401/403 means the key is wrong; no key and no SMTP means not configured.

**Pass row:** "Email provider connected — Brevo, plan *{plan}*."
**Fail copy:** "Email sending isn't connected yet. Add your provider key, then press Re-check."
**Action:** a deep link to the provider's API-key page (see the links table), plus the app's own
settings page if it stores mail config.

---

## 2. Sender verified

**Detect:** provider sender/domain endpoints (Brevo `GET /v3/senders`, `GET /v3/senders/domains`;
SendGrid `GET /v3/verified_senders`; Mailgun domain state; Postmark signature). Match the configured
from-address. If the provider exposes no such endpoint, check the app's configured sender and treat
verification as **unknown**, not failed.

**Pass row:** "Sender verified — support@brand.com."
**Fail copy:** "The provider hasn't confirmed **{sender}** yet. Some emails may be rejected until it
is verified. Open the provider, confirm the sender or domain, then press Re-check. Nothing else is
needed. [Open senders]"

---

## 3. Scheduler running

**Detect (heartbeat):** the scheduler writes `email_settings.last_cron_run_at = now()` on every run.
Missing or `now - last_cron_run_at > 10 minutes` (configurable) means it is not running.

**Fail copy:**
> **Emails are waiting.** The website's scheduler hasn't checked in since **{human time}**. It's the
> small server job that releases queued emails. Send the line below to your host, or paste it into
> cron — then the queue starts moving on its own. [Copy the line] [Test now]

Put the command in a copyable block behind **Technical details**:

| Stack | Command |
|-------|---------|
| Laravel | `* * * * * cd /path && php artisan schedule:run >> /dev/null 2>&1` |
| Symfony | `* * * * * php /path/bin/console app:email-tick` |
| Node/Express | `* * * * * cd /app && node scripts/email-worker.js` |
| Rails | `* * * * * cd /app && bin/rails runner "EmailTicker.tick"` |
| Django | `* * * * * python manage.py email_tick` |
| Platform (Render/Fly/Vercel) | use the platform's **Cron Jobs** feature with the tick command |

Also offer **Test now** (runs the tick once and updates the heartbeat) and, if the app uses a queue,
show the queue depth.

Common causes to mention only inside "Why?": no cron entry, worker stopped after a deploy/OOM, wrong
server clock, permissions, queue backlog.

---

## 4. Automation paused

**Detect:** `email_settings.master_enabled = false`.

**Copy:** "Email automation is paused. Nothing sends until you turn it on. [Turn on]"
Show it as a **warning**, not an error — shipping paused is intentional. Never combine it with a red
transport warning when the transport is fine.

---

## 5. A channel isn't configured

If a sequence uses push / SMS / WhatsApp and no provider exists:
*"Push reminders are paused — no provider configured. [Open Settings → Channels]"*
Show the per-channel status as **Configured / Not configured / Off**, and reuse an existing provider
automatically instead of asking for a second one.

---

## Provider links (open in a new tab)

| Provider | API keys | Senders / domains | Billing / plan |
|----------|----------|-------------------|----------------|
| Brevo | `https://app.brevo.com/settings/keys/api` | `https://app.brevo.com/settings/senders` | `https://app.brevo.com/account` |
| SendGrid | `https://app.sendgrid.com/settings/api_keys` | `https://app.sendgrid.com/settings/sender_auth` | `https://app.sendgrid.com/settings/billing` |
| Mailgun | `https://app.mailgun.com/settings/api_security` | `https://app.mailgun.com/sending/domains` | `https://app.mailgun.com/settings/billing` |
| Postmark | `https://account.postmarkapp.com/servers` | `https://account.postmarkapp.com/signature_domains` | `https://account.postmarkapp.com/billing` |
| Resend | `https://resend.com/api-keys` | `https://resend.com/domains` | `https://resend.com/settings/billing` |

Only show the row for the provider actually in use.

---

## Banner component (consistent)

- **State icon + short title + one-line, human reason.**
- **One primary action** (Open provider / Copy the line / Turn on). A secondary **Re-check**.
- **No env-var lists in the visible copy.** Technical details go in a disclosure.
- `role="alert"` for a hard stop (cannot send), `role="status"` for warnings; keyboard reachable;
  44px buttons.
- Re-check every 60s and on demand; when the issue clears, replace the banner with the green
  "Everything is ready" line.

## Hand-off

When the admin fixes an issue, the checklist updates on the next re-check — no page reload needed if
the app polls. The **Send test email** and **Test now** buttons double as verification. Document where
the cron and provider settings live, and tell the admin explicitly: **if all rows are green, there is
nothing left to do.**
