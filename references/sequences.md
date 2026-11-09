# Sequences — the funnel catalog

The heart of the system. Each sequence is a short, **bounded** series of personal emails triggered by
behaviour, with explicit timing, copy intent, discounts, and **stop conditions**.

Timing is grounded in funnel research (Klaviyo/Shopify/Mailchimp abandoned-cart guidance, lifecycle
playbooks): the first touch should land within ~1 hour for intent-based flows, later touches space out,
and every sequence is capped and respects frequency limits.

> **Golden rules for every sequence**
> - **Stop condition always wins.** Re-check the goal (login / purchase / activation / unsubscribe)
>   **before** each send. A buyer must never receive an abandoned-cart email.
> - **One email at a time.** Never send a user two sequences on the same day.
> - **Discount default = 0%.** When the configured discount is 0, the email must **not mention a
>   discount at all**.
> - **First email = no discount** (discounting early trains users to wait).
> - **Bounded and suppressed.** Respect unsubscribe, hard bounce, spam complaint, and frequency caps.
> - **Scoped unsubscribe.** A user can opt out of **one sequence for one product** without leaving all
>   email. Respect it at send time (`sequence-optout`).
> - **Channel-aware.** A step may target email, push, WhatsApp, or SMS. Prefer push → email → WhatsApp →
>   SMS with fallback. Non-email channels require **explicit opt-in** and per-channel suppression
>   (`references/channels.md`).

---

## 1. Welcome / activate (registration)

| Step | Delay | Intent | Discount |
|------|-------|--------|----------|
| 1 | immediate (~0h) | Warm welcome; confirm the account; the single next step to take | 0% |
| 2 | +24h | Show the core value / best-sellers / how to get started | 0% |
| 3 | +72h | Social proof + a gentle nudge to act | 0% (optional welcome offer if configured) |

**Stop:** first login, first purchase, unsubscribe.
**Why:** welcome emails are the highest-engagement email in the lifecycle.

---

## 2. Registered, never logged in

| Step | Delay | Intent |
|------|-------|--------|
| 1 | +1h | "You're in — here's the one thing to do first." |
| 2 | +24h | Address a likely friction (forgot password? unclear value?) |
| 3 | +72h | Final gentle nudge; offer help / contact admin |

**Stop:** first login, unsubscribe. **Never** send this if they *have* logged in.

---

## 3. Logged in, but no purchase / no use

| Step | Delay | Intent |
|------|-------|--------|
| 1 | +1h after inactivity signal | Re-engage with the specific thing they viewed |
| 2 | +24h | Show value / a relevant product or feature |
| 3 | +5d | Last check-in; offer to help |

**Stop:** purchase, activation event, unsubscribe. Configurable "inactivity" window.

---

## 4. Abandoned cart / checkout / product (highest value)

| Step | Delay | Intent | Discount |
|------|-------|--------|----------|
| 1 | **+1h** | Friendly reminder: show the exact item(s), one clear link back | **0%** |
| 2 | **+24h** | Social proof / reviews / answer a common objection | 0% (or small) |
| 3 | **+48–72h** | Urgency + **incentive** (this is where the discount lives) | configurable |

**Stop:** purchase (check before every send), unsubscribe. Trim to 2 emails for low-value carts.
**Why:** recovery rates fall steeply after 24h; 3 touches within ~72h is the benchmark. Don't discount
step 1.

---

## 5. Post-purchase review / experience

| Step | Delay | Intent | Discount |
|------|-------|--------|----------|
| 1 | next day (or after delivery + usage time) | "How's it going?" — offer help / a tip | 0% |
| 2 | +2 weeks | Ask about their experience + introduce a relevant next product | optional upsell |

**Stop:** review left, unsubscribe. Adjust delay by **product type** (consumables/electronics wait
longer before asking for a review). Never ask for a review before the product has been used.

---

## 6. Upsell / cross-sell (post-purchase)

| Step | Delay | Intent | Discount |
|------|-------|--------|----------|
| 1 | after value moment (3–7d) | "Because you bought X, you may also like Y" | configurable |

**Stop:** purchase of the promoted item, unsubscribe. Only run if **other products/services exist**.
Frame as a helpful suggestion, not a hard sell. Segment by what they bought.

---

## 7. Win-back / re-engagement

| Step | Delay | Intent | Discount |
|------|-------|--------|----------|
| 1 | inactive 30d | Neutral check-in: "Anything we could do better?" | 0% |
| 2 | inactive 60d | Show what's new / a relevant reason to return | 0% |
| 3 | inactive 90d | Final offer (optional) + "we'll stop here" | optional |

**Stop:** any activity, unsubscribe. After the final email, **suppress** from re-engagement. This
protects sender reputation (don't keep emailing the unresponsive).

---

## 8. Replenishment (consumables only)

| Step | Delay | Intent | Discount |
|------|-------|--------|----------|
| 1 | ~day 45–60 (by product) | "Running low? Reorder in one click." | configurable |

**Stop:** repurchase, unsubscribe. Only for products with a known usage cycle.

---

## 9. Payday re-engagement (pending product purchase)

A **separate** follow-up for products the user tried to buy but didn't — timed to the **payday cycle**
(most people are paid 25th–30th). It is **not** the 1h/24h/72h cart sequence: it starts only **after**
that initial sequence has finished (~7 days after abandonment) and the product is still pending.

| Step | When (calendar) | Intent | Discount |
|------|-----------------|--------|----------|
| 1 | **27th** | "You looked at {product} — payday's here if you still want it." | 0% |
| 2 | **last day of the month** | Last nudge before the new month | optional |
| 3 | **2nd** | "Happy new month, {name} — gift yourself the {product} you tried to buy." | optional |

- **Trigger:** a `product_lead` still `lead`/`active`, abandoned **≥ 7 days ago** (so it doesn't clash
  with the cart sequence), and no paid order for that product.
- **Calendar scheduling:** steps use `schedule: { type: 'calendar', day: 27 | 'last' | 2, hour }` instead
  of `delay_minutes` (`examples/schedule.mjs`).
- **Stop:** purchase (→ moves to **Paid**, enters the paid-product sequences), **per-product
  unsubscribe** (`sequence-optout`), global unsubscribe.
- **Per-product:** each enrollment is scoped to `product_id`; the email references that product.
- **No clash:** payday is a **nurture** sequence — it doesn't cancel or get cancelled by the promotional
  sequence, and the **cross-sequence frequency cap (1 marketing email/user/day)** means it never doubles
  up. If a send day collides, it defers.

---

## Discount & urgency rules

- **Default discount per sequence = 0%.** 0% ⇒ **omit any discount text entirely** (no "0% off", no
  teaser). This is a hard rule.
- **Abandoned cart** step 3 and **upsell** may carry a discount; the value is admin-configurable.
- Discounts should be **time-boxed** ("valid for 48 hours") to create honest urgency — never fake
  countdowns.
- Generate a **unique, expiring code** per user when possible; log redemption.
- Never stack multiple discounts in one send.

## Sequence precedence (who wins)

A user can qualify for several sequences at once. Resolve with a **priority matrix** — a user is in at
most one promotional sequence, highest priority wins (lower number = higher priority):

| Priority | Sequence | Wins over |
|----------|----------|-----------|
| 1 | Post-purchase review / upsell | everything (purchase path) |
| 2 | Abandoned cart / checkout | browse, welcome, win-back |
| 3 | Browse-abandon | welcome, win-back |
| 4 | Welcome / activate | no-login, inactive |
| 5 | No-login | inactive |
| 6 | **Payday re-engage (nurture)** | runs *alongside* the promotional sequence |
| 7 | Inactive / re-engage | win-back |
| 8 | Win-back | — |

When higher priority enrols, cancel conflicting lower-priority scheduled rows. Never run two
promotional sequences the same day (also enforced by frequency caps). **Enforce at most 1 active
marketing sequence per user** — implemented and tested in `examples/worker.mjs`.

**Nurture sequences (payday)** are scoped per product and **do not participate in precedence** — they
won't cancel or be cancelled by the promotional sequence. The **cross-sequence frequency cap** (1
marketing email/user/day) guarantees they never double up on the same day.

**Kind:** tag every sequence `marketing` or `transactional`. Transactional/account reminders
(verification, KYC, billing, 2FA, policy) **bypass marketing unsubscribe** but still avoid
hard-bounced addresses (see `sending-and-compliance.md`).

## Discount guardrails

- **Min-cart guard:** if `cart.total < min_cart_total` (e.g. < $20), **omit the discount** — a 10% off
  a $15 cart costs more margin than it recovers.
- **First touch = no discount**; incentives live in later steps only.
- Time-box every discount and **log redemption**; never stack.

## A/B subject testing

- Each step may carry `ab_variant` A/B; split eligible users 50/50 (deterministic by user id hash).
- Track open/convert per variant; promote the winner after significance. Never A/B a transactional
  message.

## More world-standard sequences (config-gated)

| Sequence | Trigger | Timing | Notes |
|----------|---------|--------|-------|
| **Browse-abandon** | Product viewed, no cart/purchase | 1h → 24h | Show the viewed product; no discount on step 1 |
| **Back-in-stock** | Product back in stock + user viewed/notified | immediate | Only to users who opted in / viewed |
| **Price-drop** | Price drops on a viewed item | immediate | Honest, real price change only |
| **Dunning / failed payment** | Subscription renewal failed | day 0 → 3 → 7 | *Transactional-leaning*: recover the payment; include a clear fix link |
| **Referral ask** | Positive review / high NPS | ~3 days after review | One ask, then stop |
| **Replenishment** | Consumable purchase | ~day 45–60 | Reorder link |

## Platform-derived sequences (add the ones that fit)

These are the sequences you **decide to add after scouting the platform** (`discovery.md` §4b). Add only
the ones the product can actually detect and act on — never a sequence whose trigger doesn't exist.

| Sequence | Add when | Trigger | Timing | Stop when |
|----------|----------|---------|--------|-----------|
| **Email verification** | platform requires/benefits from a verified email | registration, `email_verified = false` | 1h → 24h → 72h | verified |
| **Profile completion** | profile gates value (marketplace/social/pro) | profile incomplete after registration/login | 1h → 24h → 5d | profile complete |
| **Onboarding / setup** | app needs setup to deliver value (SaaS) | onboarding incomplete | 1h → 24h → 72h | onboarding complete |
| **KYC / identity** | fintech/regulated | KYC pending | 1h → 24h → 72h | KYC approved |
| **Billing / payment method** | SaaS paid or trial | no payment method, or trial ending | 3d before trial end → end → 3d after | subscribed |
| **Trial ending** | SaaS trial | trial ends within N days | 3d → 1d → expired | upgrade |
| **Feature adoption** | app with a key feature | user hasn't used feature X | 1d → 5d | feature used |
| **Security / 2FA setup** | security-sensitive | no 2FA after N days | 7d → 30d | 2FA enabled |
| **Policy change / re-consent** | legal | policy updated | 0d → 7d → 30d | accepted |
| **Booking / appointment** | booking platforms | appointment scheduled | 24h before → 2h before | attended/cancelled |
| **Renewal / expiry** | subscriptions, domains, certificates | renewal/expiry approaching | 30d → 7d → 1d before | renewed |
| **First → second purchase** | e-commerce | first purchase, no second | 14d → 30d | second purchase |
| **Birthday / anniversary** | consumer apps | the date | day-of | — |

**Rules:** same stop-conditions, precedence, and frequency caps as every other sequence. Prefer 2 touches
over 4. Document in the integration plan why each was chosen (which platform step it unblocks).

## Implementation reference

The scheduling/worker logic (idempotency, stop-conditions, frequency caps, reaper) is implemented and
tested in `examples/worker.mjs` (+ `worker.test.mjs`). Precedence is enforced by cancelling
lower-priority scheduled rows when a higher-priority sequence enrols.

## World-standard additions included

- **Welcome series** (registration) — highest-ROI lifecycle email.
- **Win-back** with a final "we'll stop" email (protects deliverability).
- **Replenishment** for consumables.
- **Referral ask** after a positive review (optional, config-gated).
- **Frequency caps + quiet hours** (see `sending-and-compliance.md`).
- **Orchestration priority** — a user is in at most one promotional sequence at a time; purchase flows
  outrank cart flows.

## Copy intent → templates

Every step has a copy brief here; the actual wording rules and templates live in
`references/email-copy.md`. All emails are personal, one-to-one, and carry a **contact-admin link**.
