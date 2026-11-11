# Triggers — exact detection rules

The trigger is the product. Vague triggers double-send, miss users, and email buyers. Define each
one **concretely** and implement it either from an event hook or a polling query.

---

## Event-driven (preferred)

If the app fires events, capture them (observe-only) into `user_events`:

| Trigger | Event | Fires when |
|---------|-------|------------|
| `registration` | user created | account created |
| `login` | login succeeded | first/any successful login |
| `cart_add` | item added to cart | cart mutation |
| `checkout_start` | checkout page opened | checkout entered |
| `product_view` | product detail viewed | view logged |
| `purchase` | order paid | payment succeeded |
| `activation` | first meaningful action | app-defined (see below) |

## What counts as "activation / use"

Define **per app** and record it as an event. Examples: created the first project, sent the first
message, imported data, completed onboarding, used a core feature. **Write the definition down**; if
you can't, treat "logged in" as the signal and say so.

---

## Abandoned cart / checkout — the exact rule

A cart is **abandoned** when **all** hold:

1. `cart.items_count > 0`
2. `cart.updated_at <= now() - interval '60 minutes'` (the dwell threshold — configurable)
3. no `order` exists for this cart since `cart.updated_at`
4. user is not currently in an active checkout session (if trackable)

```sql
SELECT c.id, c.user_id, c.updated_at, c.total
FROM carts c
WHERE c.items_count > 0
  AND c.updated_at <= now() - interval '60 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.cart_id = c.id AND o.created_at >= c.updated_at
  );
```

- Run this every ~10 minutes; **enrol once** (idempotent on `cart_id`) and record `trigger_reason`.
- "Product page abandonment" without a cart = a **browse-abandon** trigger: `product_view` logged,
  no `cart_add` and no `purchase` within 60 min.

## Registered, never logged in

```sql
SELECT u.id FROM users u
WHERE u.created_at <= now() - interval '60 minutes'
  AND u.last_login_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM email_enrollments e
                  WHERE e.user_id = u.id AND e.sequence_key = 'no_login');
```

Stop the sequence when `last_login_at` becomes non-null.

## Logged in, no purchase / no use

Enrol when `login` fires and the user hasn't `activation`/`purchase` within the window. Stop on either.

## Inactivity (win-back)

```sql
SELECT u.id FROM users u
WHERE COALESCE(u.last_active_at, u.last_login_at, u.created_at) <= now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM email_enrollments e
                  WHERE e.user_id = u.id AND e.sequence_key = 'win_back' AND e.status = 'active');
```

## Post-purchase

On `purchase`, enrol in review/upsell, **delay by product type**:
- digital/service → next day;
- physical → after delivery + usage window (use `delivered_at` if available).

## Payday re-engagement (pending product)

A product lead is eligible when **all** hold:

1. `product_leads.stage = 'lead'` and `status = 'active'`
2. `abandoned_at <= now() - interval '7 days'` (the 1h/24h/72h cart sequence is done)
3. no paid order for that product by the user

```sql
SELECT pl.user_id, pl.product_id
FROM product_leads pl
WHERE pl.stage = 'lead' AND pl.status = 'active'
  AND pl.abandoned_at <= now() - interval '7 days'
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.user_id = pl.user_id AND o.product_id = pl.product_id AND o.paid_at IS NOT NULL
  );
```

Enrol **once per (user, product)** (`trigger_ref = 'payday:' || product_id`). Steps are calendar-anchored
and **sequential** (27th → last day → 2nd; each resolves after the previous one), in the user's **local**
hour — see `examples/schedule.mjs`.

**On purchase:** call `worker.handlePurchase({ userId, productId, purchasedAt, paidSequences })`
(`examples/worker.mjs`). It marks the lead `paid`, cancels that product's `scheduled` cart/payday rows,
and enrols the **paid-product** sequences (review/upsell, scoped to the product). It is idempotent, so a
replayed webhook is safe. Buying product A never touches product B.

If a calendar email can't go out on its date (cap reached, window closed), it is marked **`missed`** —
not sent a day late and not silently cancelled.

## Replenishment (consumables)

On purchase of a consumable, enrol with `due_at = purchased_at + product.usage_days` (default ~45–60).

---

## Idempotency of triggers

- Every enrolment must be **unique per (user, sequence, trigger instance)** — e.g. a unique key on
  `(user_id, sequence_key, trigger_ref)` so a re-run doesn't double-enrol.
- Polling jobs must be safe to run repeatedly (the enrolment uniqueness above is the guard).

## Stop-condition predicates (checked at send time)

| Stop key | Predicate |
|----------|-----------|
| `purchased` | a paid order exists since enrolment |
| `logged_in` | `last_login_at` after enrolment |
| `activated` | activation event after enrolment |
| `reviewed` | a review exists since purchase |
| `unsubscribed` | email in `email_suppressions` |
| `sequence_optout` | user opted out of this sequence for this product (`email_optouts`) |

Re-evaluate these **at send time**, not just at enrolment.
