# List-level email campaigns (on demand)

A reusable **“Email these users”** button above **any admin user-list table**:
payments/orders, abandoned carts, leads, buyers, subscribers, course students.
It opens a small composer with two intents:

1. **Update / new content reminder** — one email to the selected list.
2. **Recommend product(s)** — a short sequence promoting one or more products.

This sits **beside** the automated sequence engine, not on top of it. It reuses
the same suppression list, provider connection, click tracking and templates.
Do not build a second drip engine.

## Placement

- Top-right of the table header, not inside a row menu.
- Visible only to admins; render a visible **“Admin only”** badge next to it.
- Narrow the recipients with the table’s **current filters** (status, product,
  date range, search). The modal shows “X recipients” before sending.
- On a product/course page, put it above the content list, not only on the
  payment list.

## Composer

```
[ Email these users ]  (Admin only)

Modal
  ( ) New content / update reminder
  ( ) Recommend product(s)

  Products: [search by id or title] [chips … unlimited]
  Price format: [formatted] [none] [unformatted] [no symbol] [short] (all)
  Exchange rate: [$1 = 1400]
  [ Start sending ]
```

The product search is a server-side search over id/title and returns published
products only. Admins can add as many products as they need.

### Price formats

| Key | Example |
|---|---|
| `formatted` | `₦14,000 (~$10)` |
| `none` | no price line |
| `unformatted` | `₦14000` |
| `no_symbol` | `14000` |
| `short` | `14k` |

The formatted variant uses the admin’s naira-per-dollar rate. A sequence rotates
formats across steps so the admin can compare performance.

## Upsell sequence

- Five emails: **day 0, 3, 6, 9, 12**, then stop.
- Different subject, opening, benefits and price format each step.
- Personal from a named person: “Since you took {source product}, I figured this
  is the next best product for you…”
- Itemised benefits with a consistent colourful icon set, extracted from the
  product description/learning outcomes.
- State the product duration (“about 2 hr 15 min” or “12 lessons”).
- One short FOMO line per email; no fake scarcity, no fake deadlines.
- One primary CTA per product, ≥44px, verb-first.
- Plain-text twin with the same URLs.

The first product receives the main CTA. Additional products become separate
cards. For a new-content reminder, a single email is enough.

## Tracking and auto-login

Do not link directly to the product. Use a signed tracking URL:

```
/campaign/email/click/{recipient}/{step}/{product}
```

On click:

1. verify the signature;
2. record `clicked_at` and `clicked_product_id` on the send row;
3. redirect to the platform’s signed auto-login URL for that user/product.

The recipient lands on the product **signed in**. The same route is used by the
new-content reminder.

Opt-out route:

```
/campaign/email/optout/{recipient}
```

Signed, no login required. It stops only this sequence; account and purchase
mail remain.

## Recipients

For a list table, derive recipients from the current filtered query, not the
whole table:

- distinct user/email;
- exclude admins and the product owner;
- exclude suppressed/unsubscribed addresses;
- exclude users who already own every promoted product;
- exclude users already in an active marketing sequence (or defer them);
- cap at one marketing email per user per day.

For “new content”, include past buyers of the product. For “upsell”, include
past buyers of the source product.

## Data model (additive)

```text
product_email_campaigns
  id, content_id, type:new_content|upsell, status:running|paused|completed,
  upsell_course_ids json, formats json, exchange_rate decimal,
  created_by, started_at, completed_at, timestamps

product_email_recipients
  id, campaign_id, user_id, email, status:pending|completed|stopped|opted_out,
  current_step, next_send_at, last_sent_at, clicked_at, opted_out_at,
  stop_reason, timestamps
  unique(campaign_id,user_id)

product_email_sends
  id, campaign_id, recipient_id, step, format, subject,
  sent_at, clicked_at, clicked_course_id, timestamps
  unique(recipient_id,step)
```

## Sending

- A scheduler command every minute sends **2–5 emails per run** (random),
  across all running list campaigns.
- Only inside the platform’s send window (default 08:00–19:00, no Sunday).
- Pause the campaign automatically when provider credits are low; never mark
  recipients failed just because the account is out of credits.
- On a provider failure, retry after ~10 minutes instead of burning the row.
- Stop a recipient immediately when they buy any promoted product.
- Stop on opt-out.
- Respect “one active marketing sequence per user”.

## Admin reporting

On the list/course page:

- sent, clicks, click rate;
- a clean sent-vs-clicks bar chart;
- a per-format table: sent, clicks, CTR;
- Pause/Resume — **only one of the two is visible**, based on status:
  running → Pause, paused → Resume, completed → neither;
- auto-refresh every 15 seconds.

## Access control

- Button visible only to admins (mark it **“Admin only”**).
- Server action re-checks admin/owner, not just the UI.
- Recipient data and stats are admin-only.
- Signed click/opt-out routes carry no login session.

## Integration checklist

- [ ] Reuse the existing provider, suppression list and send window.
- [ ] No second sequence engine; list campaigns are manual, bounded sends.
- [ ] Button above every admin list table, not only one page.
- [ ] Current table filters define the recipient set.
- [ ] “Admin only” badge on the button/section.
- [ ] Price formats and exchange rate saved per campaign.
- [ ] Sequence cadence 0/3/6/9/12, then stop.
- [ ] Tracked click route records clicks and auto-logs in.
- [ ] Opt-out and purchase stop are enforced.
- [ ] 2–5/min, credit guard, pause switch.
- [ ] Format performance table and chart.
- [ ] One visible action (Pause **or** Resume) per campaign.
