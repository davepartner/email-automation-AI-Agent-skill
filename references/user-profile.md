# User Profile — Email Sequences surface

A per-user view of everything the automation is doing to (and has done with) a single user, with
one-click admin controls and a **user self-service opt-out**.

Decision logic + controls are implemented and tested in `examples/cross-sell.mjs`
(`listSequences`, `stopSequence`, `stopAllSequences`, `enrollForProduct`, `stopPromotionalEmail`,
`searchProduct`). This file is the UI + route spec.

---

## Where it lives

- If the app has a **profile menu**, add an **"Email sequences"** item. If not, attach the sequence
  block **directly at the bottom of the user profile** — no menu, no navigation change, just a clearly
  titled section.
- **Admin sees the full block.** A normal user sees **only** their own "Stop promotional emails" button
  (never other users' data, never the admin controls).

## Access control (admin-only list)

The sequence list and every control (**stop one**, **add to sequence**, **stop all**) require the app's
**admin permission** — checked at the route, in the page, and in each server action (rule 14). A normal
user and an anonymous visitor get **404**. The user's own "Stop promotional emails" button is a separate,
authenticated, self-service action on their *own* profile only.

---

## The three groupings

| Group | What it shows |
|-------|---------------|
| **Active** | sequences currently in flight (`active` / `paused`) — product, sequence type, current step, next send |
| **Pending** | still-scheduled future emails (what's queued next) — product, step, due date |
| **Previous** | finished sequences (`completed` / `liked` / `disliked` / `cancelled`) — product, outcome, reason |

**Columns** (per row): **Product** (title + id) · **Sequence** (`cross_sell`, `initial_abandonment`, …) ·
**Status** (text + colour, never colour alone) · **Step** (1/2/3) · **Next send** · **Actions**.

**Row actions (admin):**
- **Stop sequence** — one button per active sequence → `stopSequence(enrollmentId)` → cancels the
  remaining scheduled emails and marks the sequence `cancelled`.
- **Add to sequence** — a button that opens a small **product search** (by **id** or **title**); pick a
  product and enrol the user into a fresh cross-sell sequence for it (`enrollForProduct`).
- **Stop all** — one button at the top → `stopAllSequences(userId, { actor: 'admin' })`.

**Empty/loading/error states** per the table laws (`references/admin-design-laws.md`): "No sequences for
this user yet", a loading skeleton, and an inline error with retry.

## User self-service opt-out

A normal user sees a single, prominent control at the bottom of their own profile:

> **"Stop promotional emails"** — stops all marketing sequences for this account.

It maps to `stopPromotionalEmail(userId)`:

1. Set the user's marketing consent off (`email_consent.marketing = false`) — so **no future** sequence
   re-enrols.
2. Cancel every still-scheduled promotional email.
3. Mark every `active`/`paused` sequence `cancelled` (reason `user`).

It does **not** stop transactional email (verification, KYC, billing) — those bypass marketing consent by
design. The engine mirrors this: `processDue` and `maybeEnrollNext` both check the opt-out and refuse to
enrol or dispatch.

---

## Routes + controller (Laravel)

```php
// Admin-only
Route::middleware(['auth', 'can:admin'])->prefix('admin')->group(function () {
    Route::get('users/{user}/sequences', [UserEmailSequencesController::class, 'index']);
    Route::post('sequences/{enrollment}/stop', [UserEmailSequencesController::class, 'stop']);       // stop one
    Route::post('users/{user}/sequences/stop-all', [UserEmailSequencesController::class, 'stopAll']); // stop all
    Route::post('users/{user}/sequences/enroll', [UserEmailSequencesController::class, 'enroll']);    // add to sequence
    Route::get('users/{user}/products/search', [UserEmailSequencesController::class, 'searchProducts']); // ?q=id|title
});

// User self-service (own profile only)
Route::post('profile/stop-promotional-email', [UserEmailSequencesController::class, 'stopPromotional'])
     ->middleware('auth');
```

```php
final class UserEmailSequencesController
{
    public function index(User $user)
    {
        return view('admin.users.sequences', app(CrossSellEngine::class)->listSequences($user->id));
    }

    public function stop(EmailSequenceEnrollment $enrollment)
    {
        app(CrossSellEngine::class)->stopSequence($enrollment->id, ['actor' => 'admin']);
        return back()->with('status', 'Sequence stopped.');
    }

    public function stopAll(User $user)
    {
        app(CrossSellEngine::class)->stopAllSequences($user->id, ['actor' => 'admin']);
        return back()->with('status', 'All sequences stopped.');
    }

    public function enroll(User $user, Request $request)
    {
        $result = app(CrossSellEngine::class)->enrollForProduct([
            'userId' => $user->id,
            'productId' => $request->input('product_id'),
        ]);
        return back()->with($result['enrolled'] ? 'status' : 'error', $result['reason']);
    }

    public function stopPromotional(Request $request)
    {
        app(CrossSellEngine::class)->stopPromotionalEmail($request->user()->id);
        return back()->with('status', "You won't receive promotional emails from us anymore.");
    }
}
```

## Data flow

`listSequences` / `stopSequence` / `stopAllSequences` / `enrollForProduct` / `stopPromotionalEmail` /
`searchProduct` are all pure, tested methods on `CrossSellEngine` (`examples/cross-sell.mjs`). The store
holds `enrollments`, `scheduled rows`, `feedback`, `purchased`, `completed`, and a `promotionalOptOut`
set (the in-memory analog of `email_consent.marketing = false`).

- **Stop one** cancels only that enrollment's rows (`reason: stopped:admin`).
- **Stop all (admin)** cancels all active/paused sequences but does **not** flip consent.
- **Stop promotional (user)** flips the opt-out *and* cancels everything, so nothing re-enrols later.
- **Add to sequence** respects the global toggle, the user's opt-out, the per-user cap, and the
  dislike/purchase blacklist (`purchased` / `disliked` / `not-found` / `cap` / `opted-out` / `disabled`).
