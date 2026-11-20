# Non-Disruption Contract

"Non-disruptive" is a promise that must be **enforced**, not assumed. Complete every item before you
call the build done.

---

## 1. Back up first

- Snapshot the database (or at least the affected tables) before running any migration.
- Note the pre-change email mailer config so it can be restored.

## 2. Additive, reversible schema only

- **Never alter or drop existing tables/columns.** Add new tables only (`email_*`, `user_events`).
- Every migration must have a working `down()` that drops only what the feature added.
- No data back-fills that touch existing rows.

## 3. Observe-only hooks that never throw

- Wrap **every** event hook in `try/catch`; log and swallow. A failing observer must never break
  registration, login, cart, checkout, or payment.
- No changes to the app's request path, middleware order, or existing email config.

## 4. Ships paused + global kill switch

- `email_settings.master_enabled = false` on install.
- A one-click **global kill switch** stops all sends instantly without unenrolling users.
- Per-sequence toggles default to off.

## 5. Reuse the existing mail connection

- No second SMTP/provider. No changes to existing transactional email.

## 6. Smoke test after install (prove nothing broke)

Run and record: register a test user → log in → add to cart → start checkout → complete a test order.
All existing flows must behave exactly as before. Only the new admin menu/UI is new.

## 7. Verify the automation in dry-run

- Dry-run mode sends to **the admin's own address only** and writes no `email_sent` rows.
- Preview every sequence; stop-conditions must fire in tests (`examples/worker.test.mjs`).

## 8. Rollback drill (documented + tested)

1. Turn the master switch **off** (stops sends immediately).
2. Run the migrations' `down()` to drop the additive tables.
3. Remove the admin routes/menu.
4. Confirm the app's original email config and flows are untouched.

## 9. Access control

- The admin page, admin tables, test-send, and exported data require the app's **admin permission**.
- Audit admin actions (who toggled, who edited a sequence, who test-sent).

## 10. Intelligent cross-sell (non-disruption)

The cross-sell engine is held to the **same** contract — it is additive, gated, and idempotent:

- **Ships active, pauseable.** Cross-sell ships **active** (`cross_sell_automation_enabled = true`); the
  admin pauses it with the Settings toggle. The tested `CrossSellEngine` short-circuits on
  `disabledReason()` (`disabled`) in `maybeEnrollNext`, `processDue`, `enrollForProduct` and the dislike
  re-enrol — so pausing stops every send instantly without unenrolling anyone.
- **Observe-only trigger.** The "initial sequence completed → `maybeEnrollNext`" listener must be wrapped
  in `try/catch` and never break the sequence-completion flow (same rule as every other hook).
- **Idempotent.** Replaying the completed event never double-enrols — `maybeEnrollNext` is keyed on
  `(user, source product)` and returns `duplicate`; `enrollForProduct` is keyed on `(user, product)`.
- **Additive schema.** `email_sequence_enrollments`, `user_product_feedback`, `email_feedback_tokens`,
  and new columns on the skill's own `email_settings` — no existing table is altered or dropped.
- **Rollback.** Dropping those tables and the two feedback routes removes the feature cleanly; the
  base sequences and mail connection are untouched.

## Checklist

- [ ] DB backed up; mailer config noted.
- [ ] Migrations additive + reversible; `down()` tested.
- [ ] Hooks wrapped in try/catch; smoke test passed (all 5 flows).
- [ ] Master switch off on install; kill switch works.
- [ ] Existing mail connection reused; no second SMTP.
- [ ] Dry-run + preview + test-send pass; stop-conditions tested.
- [ ] Rollback drill executed and documented.
- [ ] Admin permission enforced + actions audited.
- [ ] Cross-sell: ships active with an admin pause toggle; observe-only listener; idempotent enrolment (94 tests).
