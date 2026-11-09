# Provider API — verify setup and read the sending plan

The admin should see **facts, not guesses**. Check the provider server-side, cache the result, and use
it to (a) decide whether to show a warning at all, and (b) fill the plan/quota card at the top of
Sequences.

> Never call the provider from the browser. The API key stays server-side. Time-box the request
> (2–3 s) and cache for 10–15 minutes; a slow provider must not block the page.

---

## What to fetch

| Question | Use | Shown as |
|----------|-----|----------|
| Is the connection valid? | Account / user endpoint | ✓ "Provider connected" |
| Which plan and how many emails left? | Account plan + credits | Plan/quota card |
| Is the from-address verified? | Senders / domains endpoint | ✓ "Sender verified" |
| How many emails did we send on the provider side? | SMTP stats (optional cross-check) | Chart sanity check |
| When does the allowance reset? | Plan billing period | "Resets on {date}" |

If a provider does not expose one of these, show **unknown** — never invent a number.

---

## Brevo (v3)

Base: `https://api.brevo.com/v3` · header `api-key: {BREVO_API_KEY}` · `Accept: application/json`.

| Data | Endpoint | Key fields |
|------|----------|------------|
| Account & plan | `GET /account` | `plan[]` with `type`, `credits`, `creditsType`; `email`, `companyName` |
| Senders | `GET /senders` | `email`, `active`, `id` |
| Domains | `GET /senders/domains` | `domain_name`, `authenticated`, `verified` |
| Email stats | `GET /smtp/statistics/aggregatedReport?startDate=&endDate=` | `requests`, `delivered`, `hardBounces`, `softBounces`, `blocked` |
| Daily report | `GET /smtp/statistics/report?days=30` | per-day rows |

Mapping: plan label from `plan[0].type`; remaining = the `plan` entry where `creditsType` is
`sendLimit` (or the first entry with `credits`); reset from the plan's period if present, otherwise
state "monthly".

Links for the UI: `https://app.brevo.com/settings/keys/api`,
`https://app.brevo.com/settings/senders`, `https://app.brevo.com/account`.

---

## Other providers (equivalent checks)

| Provider | Account / plan | Senders / domains | Stats |
|----------|----------------|-------------------|-------|
| SendGrid | `GET /v3/user/account`, `GET /v3/user/credits` | `GET /v3/verified_senders` | `GET /v3/stats?start_date=` |
| Mailgun | `GET /v4/domains` | domain `state` | `GET /v3/{domain}/stats/total` |
| Postmark | `GET /server` | `GET /message-streams`, signature domains | `GET /stats/outbound` |
| Resend | `GET /domains` | domain `status` | dashboard only |
| SMTP only | no account API | app config | count from the sent log |

The app's own **sent log** is the source of truth for the automation charts (emails/day, revenue/day);
the provider stats are only a cross-check.

---

## Caching & failure behaviour

```
cached = cache.get('email_provider_status')
if cached is fresh (< 15 min): return cached
try:
    status = provider.fetch()       # 2–3s timeout
    cache.put('email_provider_status', status, 15 min)
    return status
except Unauthorized:
    return { connected: false, reason: 'invalid_key' }
except Timeout/Network:
    return { connected: null, reason: 'unreachable' }   # unknown, not failed
```

- `connected: false` with `invalid_key` → show the fail row and the provider key link.
- `connected: null` → show "Couldn't reach the provider right now" as **unknown**, not red; keep the
  last known quota if available.
- All checks pass → collapse the checklist to the green "Everything is ready" line.
- A manual **Re-check** bypasses the cache.

---

## Plan / quota card (top of Sequences)

- Plan name, e.g. "Brevo — Starter".
- `emails sent this period` / `allowance` with a progress bar.
- Remaining credits in the app's currency-neutral form ("12,400 emails left").
- Reset date.
- A quiet link: **"Manage plan in Brevo ↗"**.
- If the API is unavailable: show only the app's sent count and **"Check provider ↗"**; never show a
  fake progress bar.

## Privacy & safety

- Read-only endpoints only; never create keys, change plans, or send test emails from this check.
- Do not log the key or the full response.
- Do not show per-recipient provider data on this page.
