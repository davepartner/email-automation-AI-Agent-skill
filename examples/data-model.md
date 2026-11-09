# Data Model (additive)

All tables are **new** — no existing table is altered. Names are illustrative; adapt to the stack.

```
email_sequences
  id, key, name, enabled(bool), description,
  kind(varchar, default 'marketing'),           -- marketing | transactional | nurture
  default_discount_pct(int, default 0),
  priority(int), holdout_pct(int, default 0),   -- lower priority = higher precedence
  created_at, updated_at

email_sequence_steps
  id, sequence_id FK, position(int),
  delay_minutes(int),                 -- due_at = enrol time + delay (unless `schedule` is set)
  schedule(jsonb, nullable),          -- {type:'calendar', day:27|'last'|2, hour} overrides delay
  subject, body_html, body_text,
  discount_pct(int, nullable),        -- null → sequence default; 0 → no discount text
  stop_condition(varchar),            -- purchased | logged_in | activated | reviewed
  min_cart_total(decimal, nullable),  -- skip incentive below this cart value
  ab_variant(varchar, nullable),      -- 'A' | 'B' for subject testing
  created_at, updated_at

email_enrollments
  id, user_id FK, sequence_id FK,
  reason(varchar),                    -- why enrolled (trigger)
  trigger_ref(varchar),               -- idempotency: cart id / session / date / product id
  product_id(varchar, nullable),      -- scope for product-specific sequences (payday)
  group(varchar, default 'treatment'),-- 'treatment' | 'holdout'
  status(active | completed | cancelled | suppressed),
  enrolled_at, completed_at, cancelled_at,
  UNIQUE(user_id, sequence_id, trigger_ref)

email_scheduled
  id, enrollment_id FK, step_id FK, user_id FK,
  due_at(timestamp),
  status(scheduled | sending | sent | cancelled | failed),
  locked_at, attempts(int), deferrals(int, default 0), error(text),
  kind(varchar), priority(int), group(treatment | holdout),
  channel(varchar, default 'email'),           -- email | push | whatsapp | sms
  product_id(varchar, nullable),               -- copied from the enrollment for scoped opt-outs
  UNIQUE(enrollment_id, step_id)      -- idempotency: never double-schedule

email_sent                                   -- immutable audit log
  id, user_id FK, enrollment_id FK, step_id FK,
  sequence_key, step_position,
  sent_at, channel(varchar, default 'email'), provider_message_id(varchar, nullable),
  to_email, from_email, subject, ab_variant,
  status(delivered | bounced | complained),
  trigger_reason(varchar),            -- "what & why" for the admin log
  converted_at(nullable),             -- attribution
  revenue_attributed(decimal, nullable)

email_settings
  id, singleton,
  master_enabled(bool, DEFAULT false),        -- ships PAUSED
  from_name, from_email, reply_to, physical_address,
  max_per_day(int, default 1), max_per_week(int, default 4),
  send_window_start, send_window_end,          -- passed to isWithinAllowedSendWindow
  fallback_timezone(varchar, default 'UTC'),   -- when a user has no timezone
  attribution_window_days(int, default 7),
  show_admin_tables(bool, default true),
  last_cron_run_at(timestamp, nullable)        -- heartbeat for the cron health check

email_suppressions
  id, email (unique), reason(unsubscribed | hard_bounce | complaint | admin),
  sequence_key(varchar, nullable),    -- null = all sequences
  created_at

email_optouts                                -- scoped opt-out: one sequence for one product
  id, user_id FK, sequence_key(varchar), product_id(varchar, nullable),
  reason(unsubscribed | admin), created_at,
  UNIQUE(user_id, sequence_key, product_id)  -- product_id null = all products of that sequence

product_leads                                -- per-product lead / paid state
  id, user_id FK, product_id(varchar),
  stage(lead | paid), status(active | purchased | unsubscribed | expired),
  amount(decimal, nullable), abandoned_at, last_activity_at, purchased_at,
  created_at, updated_at,
  UNIQUE(user_id, product_id)

channel_settings                              -- provider + credentials per channel
  id, channel(email | push | whatsapp | sms), provider(varchar),
  credentials_encrypted(jsonb),               -- API key/secret/sender — encrypt at rest
  sender(varchar, nullable),                  -- from-number / sender ID
  enabled(bool, default false), created_at, updated_at

channel_consent                               -- explicit opt-in per user per channel
  id, user_id FK, channel, consent(bool), verified_at(nullable), source(varchar), updated_at,
  UNIQUE(user_id, channel)

channel_suppressions                          -- per-channel suppression
  id, user_id FK, channel, reason(invalid_token | hard_bounce | opt_out | complaint),
  created_at, UNIQUE(user_id, channel)

email_step_exclusions                       -- admin excluded a user from ONE specific email
  id, user_id FK, step_id FK, reason(varchar), created_at,
  UNIQUE(user_id, step_id)

email_consent
  id, user_id FK, marketing bool, consent_at, consent_ip, source, updated_at

email_unsubscribe_tokens
  id, user_id FK, token_hash, expires_at, used_at

user_events (optional, if the app has no hooks)
  id, user_id FK, type(registration | login | cart_add | checkout_start | product_view |
                      activation | purchase | review | inactivity),
  payload(jsonb), created_at

admin_audit
  id, admin_user_id, action, target, meta(jsonb), created_at
```

## Notes

- **`users.timezone`** is required for quiet-hours correctness (add it if missing). Falls back to
  `email_settings.fallback_timezone`.
- **`group = holdout`** users receive no marketing emails; they are the control for honest lift.
- **`trigger_ref`** (e.g. cart id, date bucket) makes enrolment idempotent across polling runs.
- **`ab_variant`** on steps enables subject/body A/B; `email_sent.ab_variant` records which was sent.

## Conventions

- **`delay_minutes` is measured from ENROLMENT**, not from the previous step:
  `due_at = enrolled_at + step.delay_minutes` (step 3 at 3600 = 60h after enrolment).
- **`kind`** — `marketing` | `transactional` | `nurture`. `nurture` (payday) is marketing-like for consent
  and frequency caps but is **per-product** and skips promotional precedence; `transactional` bypasses
  marketing unsubscribe.
- **`priority`** — lower number = higher precedence (purchase 1 … payday 6 … win-back 8); max 1 active
  promotional sequence. Nurture sequences run alongside it.
- **`schedule`** — calendar-anchored steps (27th, last day, 2nd) compute `due_at` via
  `examples/schedule.mjs`; otherwise `due_at = enrolled_at + delay_minutes`.
- **`product_id`** — scopes the enrollment/row to one product; used by the per-product payday sequence
  and the scoped opt-out.
- **`group`** — `treatment` | `holdout` (holdout receives no marketing email).
- **`copy` keys** in `sequence-config.json` map to `templates` (subject/body) defined in the DB or
  `examples/email-templates.md`.
- **`channel`** — `email | push | whatsapp | sms`; non-email channels require `channel_consent` and are
  blocked by `channel_suppressions`. `users` should hold a **verified phone** and **push tokens**.

## Retention & privacy

- `email_sent` holds emails + subjects → restrict to admins; retention e.g. 24 months.
- Deleting a user anonymises/removes their rows per the app's privacy policy.
- Suppressions persist until re-consent.

## Indexes

- `email_scheduled(status, due_at)` — the worker's hot path (`FOR UPDATE SKIP LOCKED`).
- `email_sent(user_id, sent_at)` and `email_sent(converted_at)` — attribution.
- `email_enrollments(user_id, status)` — precedence + duplicate checks.
