# Cross-Sell Email Templates — sample rendered emails

The 3-email **intelligent cross-sell** sequence. These are deliberately **hand-typed plain-text style**:
no banners, no giant colourful CTA buttons, no multi-column graphics, no marketing footer beyond a simple
unsubscribe link. Subject lines are lowercase / natural sentence-case so they read like a 1-on-1 message
typed in Gmail. Like / Dislike are **inline text links on their own lines**.

**Merge tokens**

| Token | Meaning |
|-------|---------|
| `{{first_name}}` | user's first name |
| `{{sender_name}}` | `Dave from NoteVault` (a real person, not a "team") |
| `{{entity_singular}}` | `settings.platform_product_noun_singular` — `course` / `car` / `destination` / `property` / `product` |
| `{{entity_plural}}` | `settings.platform_product_noun_plural` — `courses` / `cars` / `destinations` / `properties` / `products` |
| `{{previous_product_name}}` | the product they originally checked out (the abandonment source) |
| `{{new_product_name}}` | the matched recommendation |
| `{{new_product_features}}` | bullets from `ProductSimilarityMatcher.extractFeatures(matched)` |
| `{{like_cta_url}}` | `GET /email-automation/feedback/{enrollment}/like` (signed) |
| `{{dislike_cta_url}}` | `GET /email-automation/feedback/{enrollment}/dislike` (signed) |
| `{{unsubscribe_link}}` | standard one-click unsubscribe (from the base system) |

The `{{entity_singular}}` / `{{entity_plural}}` tokens make the copy platform-native: on a course site the
email says *"saw this **course** and thought of you"*, on a car listing site it says *"saw this **car**…"*,
on a travel site *"saw this **destination**…"*.

---

## Email 1 — Day 7 (after the previous sequence ends + cooldown)

**From:** {{sender_name}} · **Reply-To:** support@example.com
**Subject:** `saw this {{entity_singular}} and thought of you`
**Preview:** `since you checked out {{previous_product_name}}...`

```
Hey {{first_name}},

I was going through our {{entity_plural}} earlier and spotted one I think you'll like very much.

{{new_product_name}} fits your taste—I can tell because you checked out {{previous_product_name}} the
other day. Since that one didn't end up working out for you, I figured I'd send this over before you
miss it.

Here's what you get with it:
{{new_product_features}}

Feel free to look it over here if it catches your eye:
{{like_cta_url}}

If it's not really your thing, just let me know here and I'll stop emailing you about it:
{{dislike_cta_url}}

Talk soon,
{{sender_name}}
```

**Plain-text-style HTML note:** render the body as a ~600px single-column, 16px body, one accent only, no
images. Like/Dislike are plain inline links (`<a href="{{like_cta_url}}">look it over here</a>`), each on
its own line. Footer is just the unsubscribe link + physical address. No discount is mentioned (0%).

---

## Email 2 — Day 10 (+3 days, if no Like/Dislike)

**From:** {{sender_name}}
**Subject:** `quick thought on {{new_product_name}}`
**Preview:** `figured i'd follow up on my last note`

```
Hey {{first_name}},

Just bumping this up in case my last email got buried.

A lot of people who look at {{previous_product_name}} actually end up going with {{new_product_name}}
instead once they see what's inside.

Just to recap, here's what stands out about this {{entity_singular}}:
{{new_product_features}}

If you want to check it out or grab it, you can view it directly here:
{{like_cta_url}}

Still not what you're after? Click here to pass and I'll keep an eye out for a different
{{entity_singular}} for you:
{{dislike_cta_url}}

Best,
{{sender_name}}
```

---

## Email 3 — Day 14 (+4 days, if no Like/Dislike)

**From:** {{sender_name}}
**Subject:** `should i take {{new_product_name}} off your list?`
**Preview:** `last note on this {{entity_singular}}`

```
Hey {{first_name}},

I don't want to keep bugging you if {{new_product_name}} isn't what you're looking for right now, so
this will be my last note about this {{entity_singular}}.

Here are the details one last time in case you were still thinking it over:
{{new_product_features}}

If you do like it, here's the link to go straight to the page:
{{like_cta_url}}

Otherwise, click here if you'd rather I look for something else next week:
{{dislike_cta_url}}

Cheers,
{{sender_name}}
```

---

## Scheduling / cadence

| Email | When | Trigger |
|-------|------|---------|
| 1 | Day 7 (cooldown) | initial sequence completed + `cross_sell_cooldown_days` elapsed |
| 2 | Day 10 (+3d) | Email 1 sent, no Like/Dislike |
| 3 | Day 14 (+4d) | Email 2 sent, no Like/Dislike |
| — | +cooldown | Email 3 ignored → sequence `completed`, wait another cycle, evaluate the next eligible product (up to the cap) |

- **Like** at any point → sequence `liked`, remaining emails cancelled, user redirected to the product
  checkout URL with UTM params.
- **Dislike** at any point → sequence `disliked`, product blacklisted for this user, remaining emails
  cancelled, and the **next** eligible product is enrolled (starting 24–48h later).

Rendering: `examples/render.mjs` (Mustache). Feature bullets come from
`examples/cross-sell.mjs` `extractFeatures()`.
