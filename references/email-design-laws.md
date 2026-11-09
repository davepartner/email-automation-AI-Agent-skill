# Email Design — the 20 UI/UX Laws applied to the inbox

An email is a **one-screen UI with no navigation**. The reader decides in about three seconds, often
on a phone, often with images blocked. Apply the same laws you use for the admin page — the medium is
just more constrained.

> Load this with `references/email-copy.md` (voice, structure, compliance). Copy decides *what* the
> email says; this file decides *how it reads*.

---

## The email canvas

| Rule | Value | Why |
|------|-------|-----|
| Width | **600px max**, single column, fluid below | The inbox standard; two columns break on mobile |
| Body type | **16px**, line-height 1.5–1.65 | Readable without zoom; 14px is the floor |
| Section spacing | 24–32px between blocks, 8px label→value | **Proximity**: groups must read as groups |
| CTA | One primary button, **≥44px tall** (12–16px vertical padding) | **Fitts's Law**: a big, predictable target |
| Accent | **One** accent colour for the CTA only | **Von Restorff**: if everything stands out, nothing does |
| Contrast | ≥4.5:1 for body, ≥3:1 for large text | WCAG AA; emails are read in bright light |
| Images | Compressed, `alt` text, ≤100KB each | **Doherty**: slow images lose the reader |
| Motion | No animated GIFs for essential content | **Reduced motion** and image-blocking |
| Dark mode | Transparent PNGs, no white-on-white, test both | Half the inbox is dark |
| Plain text | Required twin, mirrors the message | Deliverability + accessibility |

## Layout laws

- **One idea per email, one CTA.** If you need two CTAs, you need two emails. (Hick's Law.)
- **Above the fold** = subject + preheader + first two lines. Put the specific hook there; no logos
  taller than ~80px above it. (Serial Position: the first and last lines are remembered.)
- **Proximity**: headline → supporting line → CTA, tight; larger gap before the next section.
- **Common Region**: wrap a related block (course card, offer) in one subtle bordered/tinted panel.
- **Similarity**: every button in the sequence looks identical; links are not styled like buttons.
- **Occam**: no decorative dividers, stock icons, or multiple coloured panels. The product and the
  CTA are the design.
- **Peak-End**: close with a human sign-off and a clear next step, not a wall of legal text. The
  footer is small but the last impression.
- **Goal-Gradient**: in a sequence, name the progress in plain words ("one quick note", "last one")
  rather than a fake progress bar.

## The first screen checklist

1. **Subject**: 2–6 words, sentence case, specific. No ALL CAPS, `!!!`, "free", "act now".
2. **Preheader**: 40–100 characters that add information, never repeat the subject.
3. **Greeting**: `Hi {{first_name}},` with a safe fallback.
4. **Hook**: the exact product/action, in the first sentence.
5. **Body**: one idea, short paragraphs (1–2 sentences), scannable.
6. **CTA**: one button, verb-first ("Finish enrollment", "See the course"), 44px tall.
7. **Proof / objection**: at most one short line (price, guarantee, WhatsApp help).
8. **Sign-off**: one real person, brand.
9. **Footer**: physical address, unsubscribe, preference link, contact.

## Tables inside an email

Only when comparing a small set of values (a plan comparison, an order summary):

- Use a real `<table role="presentation">` for layout, inline CSS only.
- **Two columns maximum** on mobile; stack rows below 480px if needed.
- Numbers **right-aligned**, text left, tabular numerals.
- 3–4 rows maximum; anything larger belongs on a page behind the CTA.
- No background images behind text; no fixed widths in `px` beyond 600px total.

## What not to do

- Two competing buttons ("Buy now" and "Learn more") in the same block.
- A full-width hero image with the actual message inside the image.
- Fake urgency ("expires in 24 hours") or fake scarcity.
- A discount sentence when the configured discount is 0%.
- A wall of centred text; centre only the hero and the CTA.
- Tiny grey 10px legal text used to hide the unsubscribe.

## Trace (deliver with the email set)

```
Trace:
- Decision: single 600px column, 16px body, one accent CTA
  → Law: Hick's Law (one choice) + Fitts's Law (large target) + Occam's Razor (no decoration)
- Decision: subject + preheader + two-line hook above the fold
  → Law: Serial Position (first lines are remembered) + Proximity (message grouped)
- Decision: one button, repeated across every step
  → Law: Similarity (same role, same look) + Von Restorff (the only accent)
- Decision: plain-text twin and alt text on every image
  → Law: Accessibility standard + Doherty Threshold (fast, robust rendering)
```

## Pre-ship email checklist

- [ ] One idea, one CTA; the CTA is ≥44px and verb-first.
- [ ] Subject ≤6 words; preheader 40–100 chars; no spam trigger words.
- [ ] Body 16px, line-height ≥1.5, 600px max, single column.
- [ ] Contrast ≥4.5:1; one accent colour; no colour-only meaning.
- [ ] Images compressed, with alt text; critical content is text.
- [ ] Discount text only when discount > 0; no fake urgency.
- [ ] Human sign-off + contact link.
- [ ] Physical address, unsubscribe, preference link in the footer.
- [ ] Plain-text twin with 500+ characters.
- [ ] Tested at 320px, 375px, 600px and in dark mode.
