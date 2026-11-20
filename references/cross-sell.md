# Cross-Sell — Intelligent Multi-Product Recommendations

The upgrade that turns a dead-end ("abandoned Product A, reminders finished, automation stopped") into a
**recurring, intelligent recommendation loop**. After the initial abandonment sequence completes, the
system pauses for a **7-day cooldown**, picks the **next most similar product** in the catalog, extracts
its features, and enrols the user in a **personal, hand-typed 3-email sequence** with explicit
**Like / Dislike** feedback links.

Runnable decision core: `examples/cross-sell.mjs` (tested by `examples/cross-sell.test.mjs`). Templates:
`examples/cross-sell-templates.md`. Schema: `examples/data-model.md`.

---

## 1. Admin configuration & global toggle

Add these columns to `email_settings` (or your settings table):

```
cross_sell_automation_enabled    bool     DEFAULT true     -- master switch for the whole feature
cross_sell_cooldown_days         int      DEFAULT 7        -- pause between the initial seq and cross-sell
cross_sell_reenroll_delay_hours  int      DEFAULT 24       -- dislike → next seq starts 24–48h later
cross_sell_max_per_user          int      DEFAULT 5        -- cap on cross-sell sequences per user
platform_product_noun_singular   varchar  DEFAULT 'product'
platform_product_noun_plural     varchar  DEFAULT 'products'
```

**Auto-detect the noun.** During discovery, set the noun from the app's own vocabulary — the model that
represents what the platform sells:

| Platform | singular | plural |
|----------|----------|--------|
| Courses | `course` | `courses` |
| Automotive listings | `car` | `cars` |
| Real estate | `property` | `properties` |
| Travel | `destination` | `destinations` |
| E-commerce | `product` | `products` |

Keep it **editable in the admin panel** so operators can correct it.

**Guard clause (mandatory).** *Every* scheduled job, event listener, queue worker, and the
`maybeEnrollNext` entrypoint MUST check `cross_sell_automation_enabled === true` before dispatching or
enrolling. The feature **ships active** (`true`); the admin pauses it with the Settings toggle. The
tested `CrossSellEngine.disabledReason()` returns `'disabled'` when paused, and `maybeEnrollNext`,
`processDue`, `enrollForProduct` and the dislike re-enrol all short-circuit on it; the feedback
endpoints still record feedback but never re-enrol while paused.

**Observe-only + idempotent (non-disruption).** The "initial sequence completed → `maybeEnrollNext`"
listener is observe-only (wrapped in `try/catch`, never breaks the completion flow) and idempotent — a
replayed event returns `reason: 'duplicate'` instead of double-enrolling (keyed on `(user, source
product)`). See `references/non-disruption.md` §10.

### Admin UI (Settings tab)

A clean **Cross-sell** panel in `Settings`:

- **Pause switch** — *"Intelligent cross-sell sequences"* **ON / OFF** (ships **ON**; admin can pause).
- **Cooldown** (days, default 7) · **Re-enrol delay** (24–48h) · **Max per user** (default 5).
- **Product noun** (singular + plural) — live-preview the subject line below the input.
- Optional **per-product opt-out** (see the base opt-out) — never recommend a product the admin excluded.

---

## 2. Database schema (migrations + Eloquent)

### `email_sequence_enrollments`

```php
Schema::create('email_sequence_enrollments', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->foreignId('source_product_id')->nullable()->constrained('products')->nullOnDelete();
    $table->foreignId('recommended_product_id')->nullable()->constrained('products')->nullOnDelete();
    $table->string('sequence_type')->default('initial_abandonment'); // initial_abandonment | cross_sell
    $table->unsignedTinyInteger('current_step')->default(1);         // 1 | 2 | 3
    $table->string('status')->default('active'); // active|paused|completed|liked|disliked|cancelled
    $table->timestamp('next_send_at')->nullable();
    $table->timestamps();

    $table->index(['user_id', 'status']);
    $table->index(['recommended_product_id', 'status']);
});
```

### `user_product_feedback`

```php
Schema::create('user_product_feedback', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->foreignId('product_id')->constrained()->cascadeOnDelete();
    $table->string('action');                 // like | dislike
    $table->foreignId('enrollment_id')->nullable()->constrained('email_sequence_enrollments')->nullOnDelete();
    $table->timestamps();

    $table->unique(['user_id', 'product_id', 'action']); // one dislike = permanent blacklist
});
```

### `email_feedback_tokens`

```php
Schema::create('email_feedback_tokens', function (Blueprint $table) {
    $table->id();
    $table->foreignId('enrollment_id')->constrained('email_sequence_enrollments')->cascadeOnDelete();
    $table->string('jti')->unique();           // single-use id embedded in the signed token
    $table->string('action');                  // like | dislike
    $table->timestamp('expires_at');
    $table->timestamp('used_at')->nullable();
    $table->timestamps();
});
```

### Eloquent relationships

```php
class EmailSequenceEnrollment extends Model
{
    protected $casts = ['current_step' => 'int', 'next_send_at' => 'datetime'];

    public function user() { return $this->belongsTo(User::class); }
    public function sourceProduct() { return $this->belongsTo(Product::class, 'source_product_id'); }
    public function recommendedProduct() { return $this->belongsTo(Product::class, 'recommended_product_id'); }
    public function feedback() { return $this->hasMany(UserProductFeedback::class, 'enrollment_id'); }
}

class UserProductFeedback extends Model
{
    protected $casts = ['action' => 'string'];
    public function user() { return $this->belongsTo(User::class); }
    public function product() { return $this->belongsTo(Product::class); }
    public function enrollment() { return $this->belongsTo(EmailSequenceEnrollment::class, 'enrollment_id'); }
}
```

---

## 3. ProductSimilarityMatcher — mapping any host's Product model

`examples/cross-sell.mjs` implements the matcher; here is how to feed it from **any** host's Product
model (Eloquent, Django, ActiveRecord…). Map the host columns into a plain object:

```php
$product = [
  'id'             => $model->id,
  'title'          => $model->title,
  'description'    => $model->description,
  'category_id'    => $model->category_id,
  'tags'           => $model->tags->pluck('name')->all(),
  'price'          => $model->price,
  'price_tier'     => $model->price_tier,              // optional; else ±30% of price
  'attributes'     => [ 'make' => $model->make, 'body_type' => $model->body_type ],
  'features'       => $model->features,                // array
  'bullet_points'  => $model->bullet_points,           // array
  'specifications' => $model->specifications,          // array or assoc
];
```

The matcher applies **multi-tier fallback**:

1. **Tier 1 — metadata & taxonomy:** shared `category_id`, overlapping `tags`, `price_tier` (or ±30% of
   `price`), and matching `attributes` (vehicle make/body type, course topic).
2. **Tier 2 — semantic / keyword overlap:** Jaccard token overlap of `title` + `description` +
   `features` (`keywordOverlap`). Swap in cosine/TF-IDF over embeddings when the app has them; the
   interface stays `score(source, candidate) -> number`.
3. **Tier 3 — collaborative filtering:** most popular active product bought by other users who also
   bought/viewed the source (`buildCoBuyMatrix(purchases)`). Used when metadata is thin.

**Exclusions** (never recommend): purchased, already-completed-sequence, explicitly **disliked**, and
anything currently in an active enrollment for that user (`exclusionsFor`).

**Feature extraction** (`extractFeatures`): prefer explicit `features`/`bullet_points`/`specifications`;
else derive crisp bullets from the description; else synthesize from title + attributes — so the email's
"here's what you get" block is never empty.

---

## 4. Signed Like / Dislike endpoints

Two **single-click, signed** routes. No login required — the signature is the auth.

```php
// routes/web.php
Route::get('/email-automation/feedback/{enrollment}/like', [CrossSellFeedbackController::class, 'like'])
     ->middleware('signed');     // or verify the HMAC token manually (below)
Route::get('/email-automation/feedback/{enrollment}/dislike', [CrossSellFeedbackController::class, 'dislike']);
```

The CTA URL is `/email-automation/feedback/{enrollment}/like?t=<signed-token>`, where the token is
`signFeedbackToken({ userId, enrollmentId, action }, secret)` (`examples/cross-sell.mjs`). The controller
verifies it with `verifyFeedbackToken`, checks `jti` is unused, and marks it used.

```php
final class CrossSellFeedbackController
{
    public function like(Request $request, EmailSequenceEnrollment $enrollment)
    {
        abort_unless(
            verifyFeedbackToken($request->query('t'), config('mail.feedback_secret'),
                ['isUsed' => fn ($jti) => EmailFeedbackToken::where('jti', $jti)->whereNotNull('used_at')->exists()]),
            401, 'invalid token',
        );

        $enrollment->update(['status' => 'liked']);
        UserProductFeedback::updateOrCreate(
            ['user_id' => $enrollment->user_id, 'product_id' => $enrollment->recommended_product_id, 'action' => 'like'],
            ['enrollment_id' => $enrollment->id],
        );
        EmailScheduled::where('enrollment_id', $enrollment->id)->where('status', 'scheduled')
            ->update(['status' => 'cancelled', 'reason' => 'liked']);

        return redirect($enrollment->recommendedProduct->checkoutUrl([
            'utm_source' => 'email', 'utm_medium' => 'cross-sell', 'utm_campaign' => 'cross-sell-like',
        ]));
    }

    public function dislike(Request $request, EmailSequenceEnrollment $enrollment)
    {
        // ...same token verification...
        $enrollment->update(['status' => 'disliked']);
        UserProductFeedback::updateOrCreate(
            ['user_id' => $enrollment->user_id, 'product_id' => $enrollment->recommended_product_id, 'action' => 'dislike'],
            ['enrollment_id' => $enrollment->id],
        );
        EmailScheduled::where('enrollment_id', $enrollment->id)->where('status', 'scheduled')
            ->update(['status' => 'cancelled', 'reason' => 'disliked']);

        // Find the next eligible product and schedule a fresh sequence 24–48h out.
        app(CrossSellDispatcher::class)->enrollNext($enrollment->user, $enrollment->source_product_id, [
            'anchorAt' => now()->addHours(config('email.cross_sell_reenroll_delay_hours', 24)),
        ]);

        return view('email-automation.feedback.disliked', ['product' => $enrollment->recommendedProduct]);
    }
}
```

**Dislike confirmation view** (lightweight, friendly):

> *"Got it! We won't send you more emails about **{{product.name}}**. We'll keep an eye out for something
> better suited to your taste."*

---

## 5. State machine

```
initial_abandonment sequence finishes
        │
        ▼
   [ cooldown: cross_sell_cooldown_days (7) ] ── toggle OFF? stop
        │
        ▼
   ProductSimilarityMatcher.findNextBest(source, exclude)
        │  no eligible → stop (try again next cycle, up to cap)
        ▼
   enroll cross_sell: status=active, current_step=1, next_send_at = completed + cooldown
        │
        ├─ Email 1 (day 7)  ── no click ──▶ Email 2 (day 10) ──▶ Email 3 (day 14)
        │        │  │                          │                        │
        │        │  └─ Like  ─▶ status=liked  ─▶ stop + redirect        └─ ignored ─▶ status=completed
        │        └─ Dislike ─▶ status=disliked ─▶ blacklist ─▶ enroll next (24–48h)
        ▼
   completed → wait another cooldown cycle → evaluate next eligible (up to cross_sell_max_per_user)
```

- **Like** → `status = 'liked'`, record positive intent, cancel remaining emails, `302` to checkout with
  UTM.
- **Dislike** → `status = 'disliked'`, permanently blacklist `recommended_product_id` for that user, halt
  the current 3-email sequence, and enrol the **next** eligible product (starting 24–48h later).
- **Ignored after Email 3** → `status = 'completed'`; wait another cooldown, then evaluate the next
  eligible product, up to `cross_sell_max_per_user`.

All transitions are implemented and tested in `examples/cross-sell.mjs`.

---

## 6. Hand-typed aesthetic & scheduling rules

- **Plain-text-style HTML:** ~600px single column, 16px body, one accent, no banners/images/columns; the
  only footer is a simple unsubscribe link + physical address.
- **Natural subject lines:** lowercase / sentence-case ("saw this course and thought of you"), so they
  read like a 1-on-1 Gmail message.
- **Like/Dislike as inline text links**, each on its own line.
- **Noun injection:** `{{entity_singular}}` / `{{entity_plural}}` from settings.
- **"Why this product"** line references the user's past activity, e.g. *"This 2015 Honda Accord fits
  your taste in cars—I can tell because you checked out the 2016 Toyota Corolla yesterday."*
- **Cadence:** Email 1 day 7 → Email 2 day 10 (+3) → Email 3 day 14 (+4); ignored → `completed` → next
  cooldown cycle.

Exact copy: `examples/cross-sell-templates.md`.

---

## 7. Tests

`npm test` runs `examples/cross-sell.test.mjs` (22 tests) alongside the worker/render suites. Coverage:
admin toggle OFF, cooldown + cadence (7/10/14), exclusions (purchased/completed/disliked), Tier 1/2/3
matching, feature extraction, Like (stop + redirect), Dislike (blacklist + re-enroll), cap, no-eligible,
and signed-token verify/tamper/expiry/replay.
