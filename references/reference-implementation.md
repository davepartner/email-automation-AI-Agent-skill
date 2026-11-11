# Reference Implementation — the engine (pseudocode + SQL)

A stack-agnostic blueprint of the whole pipeline. The runnable decision core is `examples/worker.mjs`
(tested by `examples/worker.test.mjs`); this file shows the SQL around it.

---

## 1. Event capture (observe-only, never throws)

Hook the app's events and **write to a new `user_events` table**. Wrap every hook so a failure can
never break the request:

```php
// e.g. Laravel observer — wrap in try/catch, log, never re-throw
public function created(Order $order): void {
    try {
        UserEvent::create(['user_id' => $order->user_id, 'type' => 'purchase', 'payload' => [...]]);
    } catch (\Throwable $e) {
        report($e); // REQUEST MUST STILL SUCCEED
    }
}
```

Events: `registration`, `login`, `cart_add`, `checkout_start`, `product_view`, `activation`,
`purchase`, `review`, `inactivity`.

## 2. Enrolment

On a trigger, create an `email_enrollment` and **materialise** the sequence steps:

```sql
INSERT INTO email_scheduled (enrollment_id, step_id, user_id, due_at, status)
SELECT $enrollment, s.id, $user, $triggerAt + (s.delay_minutes * interval '1 minute'), 'scheduled'
FROM email_sequence_steps s WHERE s.sequence_id = $seq;
```

- **One active promotional sequence per user** (precedence in `sequences.md`).
- A new relevant event cancels conflicting future rows:

```sql
UPDATE email_scheduled SET status = 'cancelled'
WHERE user_id = $user AND status = 'scheduled' AND sequence_key IN ('abandoned_cart','no_login');
```

## 3. Scheduler / worker (safe under concurrency)

Run every minute (cron / scheduler). Claim a batch atomically so multiple workers never double-send:

```sql
-- Postgres: claim up to N due rows, skip rows another worker holds
UPDATE email_scheduled
SET status = 'sending', locked_at = now()
WHERE id IN (
  SELECT id FROM email_scheduled
  WHERE status = 'scheduled' AND due_at <= now()
  ORDER BY due_at
  FOR UPDATE SKIP LOCKED
  LIMIT $batch
)
RETURNING id, user_id, step_id;
```

Then, per row, in the worker (see `worker.mjs`):

1. **Stop-check** — recompute eligibility (purchase / login / activation / unsubscribe / suppression).
   If not eligible → `status='cancelled'`.
2. **Frequency cap** — if `sent_today >= max_per_day` or outside the allowed send window in the
   **user's timezone** → reschedule (e.g. next hour / next window).
3. **Send** through the app's existing mail transport.
4. **Mark sent** + insert the immutable `email_sent` audit row (with `trigger_reason`).

Also: write `email_settings.last_cron_run_at = now()` at the start of every run (this powers the
**cron-health banner**), and skip any row whose `(user_id, step_id)` is in `email_step_exclusions`
(the admin's per-email exclusion).

## 4. Crash recovery (reaper)

```sql
UPDATE email_scheduled
SET status = 'scheduled', locked_at = NULL, attempts = attempts + 1
WHERE status = 'sending' AND locked_at < now() - interval '10 minutes';
```

Run it every few minutes. Cap `attempts` and mark `failed` after N retries.

## 5. Attribution (last-touch + holdout)

- **Holdout:** deterministically assign ~5–10% of eligible users to a `holdout` group who receive **no**
  marketing emails. Compare conversion between groups to estimate **true lift** (not just correlation).
- **Last-touch:** for each send, if the user purchases within `attribution_window_days`, attribute the
  purchase to the **most recent** reminder before it:

```sql
UPDATE email_sent es
SET converted_at = o.paid_at, revenue_attributed = o.total
FROM orders o
WHERE es.user_id = o.user_id
  AND o.paid_at > es.sent_at
  AND o.paid_at <= es.sent_at + ($window || ' days')::interval
  AND es.converted_at IS NULL;
```

Report conversions **and** the holdout baseline — the delta is the honest number.

## 6. Retention

```sql
DELETE FROM email_sent WHERE sent_at < now() - interval '24 months';
DELETE FROM email_scheduled WHERE status IN ('sent','cancelled','failed') AND due_at < now() - interval '90 days';
```

---

## Payday (calendar) scheduling & the Leads→Paid move

- **Calendar steps:** compute `due_at` with `nextOccurrence(cursor, day, { hour, utcOffsetMinutes })`
  (27th, `'last'`, `2nd`) instead of `at + delay`, and advance `cursor` to each step's `due_at` so the
  steps are strictly sequential. Pass the user's UTC offset so the send hour is local. See
  `examples/schedule.mjs`.
- **Per-product scope:** set `email_enrollments.product_id` and copy it to
  `email_scheduled.product_id`.
- **On purchase:** call `worker.handlePurchase({ userId, productId, purchasedAt, paidSequences })`
  (`examples/worker.mjs`). It is idempotent: it marks the lead `paid`, cancels the product's pending
  `scheduled` rows (reason `purchased`), and enrols the paid-product sequences — keyed on
  `(enrollment_id, step_id)` so a webhook replay never double-schedules. Buying product A never touches
  product B.
- **Scoped opt-out:** record `email_optouts(user_id, sequence_key, product_id)`; the worker checks it
  before sending and cancels with reason `sequence-optout`. Apply it from a **verified** token:
  `verifyUnsubscribeToken` → `applyUnsubscribe`.
- **Date-anchored failures:** a calendar email blocked by the cap or the send window is marked
  **`missed`**, not cancelled and not sent late; surface `missed` in the admin log.
- **Ordering:** `dueScheduled` sorts by `priority` then `due_at`, so the daily cap always defers the
  least important email.

## Batching & scale

- Process in **batches** (e.g. 100–500/s) so a big backlog doesn't time out.
- Prefer a **queue** (SQS/Redis) over a single cron loop for high volume; the cron enqueues, workers
  consume. Keep the same claim/idempotency semantics.
- Index `email_scheduled(status, due_at)` and `email_sent(user_id, sent_at)`.

## Timezones

Store `users.timezone`. Compute the **user-local hour** before sending and skip/defer outside the
allowed window. Unknown timezone → use the admin's configured fallback (and never claim quiet hours
were honoured).
