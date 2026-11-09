# Quickstart (one page)

The minimal path to a working Email Automation section. Read the other references for depth.

## Steps

1. **Discover** (`discovery.md`) — stack, admin panel, existing mail connection, products/cart/orders/
   users, **and the platform's purpose** → a one-screen plan + a **sequence shortlist**.
2. **Add tables** (`examples/data-model.md`) — `email_sequences`, `email_sequence_steps`,
   `email_enrollments`, `email_scheduled`, `email_sent`, `email_settings`, `email_suppressions`,
   `email_consent`, `email_step_exclusions`, `email_unsubscribe_tokens`, `user_events`.
   **Additive only.**
3. **Event capture** (`reference-implementation.md` §1) — observe-only hooks wrapped in `try/catch`
   → `user_events`.
4. **Worker + scheduler** (`reference-implementation.md` §3–4) — claim due rows atomically
   (`FOR UPDATE SKIP LOCKED`), stop-check, frequency cap, quiet hours, send via the app's mail, log.
   Use `examples/worker.mjs` as the tested decision core.
5. **Sequences** (`sequences.md`) — start with the default 8 + platform-derived ones; set `kind`
   (`marketing`/`transactional`), priority, and discounts (0% = hidden).
6. **Admin UI** (`admin-ui.md`) — 4 tabs; health banners; **start / pause / delete** (type `delete`);
   users search / cancel one email / exclude; stats; settings. Run the UI/UX audit on the page **and
   every table** (`admin-design-laws.md`): alignment, 44px actions, responsive columns, empty/loading/
   error states.
7. **Templates** (`wysiwyg.md` + `examples/render.mjs`) — **reuse an existing editor if present**;
   email-safe pipeline; Mustache with the 0%-discount conditional. Run `email-design-laws.md` on the
   set: one CTA, 600px single column, 16px body, contrast, dark mode, plain-text twin.
8. **Compliance** (`compliance.md`) — consent, signed one-click unsubscribe, preference center,
   bounce/complaint webhooks, retention.
9. **Non-disruption** (`non-disruption.md`) — backup, reversible migrations, smoke test, rollback
   drill. Ship **paused**.
10. **Verify** — `npm install && npm test` (worker + renderer tests), then dry-run + test-send, then
    turn on.

## Rules on one screen

- Reuse the app's mail connection; **no second SMTP**.
- Ship **paused**; master switch + global kill switch.
- **Marketing** respects consent/suppression/holdout; **transactional** (verification/KYC/billing)
  bypasses them.
- **≤1 active marketing sequence per user** (precedence).
- Frequency cap + **quiet hours in the user's timezone** + max deferrals.
- **0% discount = no discount text** (tested).
- **Stop-conditions checked at send time** (never email a buyer).
- Templates: reuse the existing editor; sanitize + email-safe transform.
- Additive, reversible, tested; never break existing flows.
