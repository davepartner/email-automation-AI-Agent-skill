# Admin Design — applying the 20 UI/UX Laws

The "Email Automation" page is a product surface like any other. **If the `ui-ux-20-laws` skill is
available, load it first** and apply its **Audit → Implement → Trace** protocol to this page. If it
isn't available, follow the same rules inline below.

Load from that skill:
- `SKILL.md` — the 20 laws and the protocol.
- `references/design-tokens.md` — spacing, type, color, radius, motion.
- `references/law-trace-examples.md` — worked "Trace" examples.

> **Rules vs style:** the UI/UX skill supplies the *rules*; the app supplies the *style*. Use the
> app's own design tokens where they exist, and fall back to the skill's tokens only if the app has no
> system.

---

## Per-surface law map (every decision traces to a law)

| Surface / decision | Law(s) | What it means |
|--------------------|--------|----------------|
| Four tabs: Sequences · Users & recipients · Statistics · Settings | **Miller's** + **Hick's** | ≤4 top-level choices, grouped by job |
| One primary action per view | **Hick's** + **Occam's** | fewer decisions on each screen |
| Start/Pause as the card's one toggle | **Von Restorff** + **Similarity** | a single, consistent primary control |
| Delete behind `⋯` + type-"delete" modal | **Fitts's** (gated destructive) + **Postel's** (confirm) | destructive actions are distant and confirmed |
| Details in a slide-over drawer | **Hick's** + progressive disclosure | don't dump every field on the list |
| Health banners only when there's a problem | **Von Restorff** + **Occam's** | signal only what matters; no clutter |
| Skeleton loaders for tables/charts | **Doherty** + **Closure** | feedback <400ms; signal loading |
| Stats chart (day/week/month) | **Goal-Gradient** + **Continuity** | show trend; align axes |
| Users table search + pagination (100) | **Hick's** + **Miller's** | bounded choices; chunked data |
| Caret expands a user's emails | **Closure** + **Common Region** | revealed content, visually grouped |
| Email editor preview / test-send | **Peak-End** + **Aesthetic-Usability** | a polished, satisfying final step |
| Empty states with a next action | **Peak-End** + **Goal-Gradient** | never a dead end |
| 44px targets, focus rings | **Fitts's** + WCAG | hit size + keyboard access |
| Consistent badges/buttons/drawers | **Similarity** | same look for same role |
| Cancel is the safe default | **Fitts's** + **Postel's** | safe default; destructive is explicit |

---

## Tables & data lists (every table, including the admin-only ones)

A table is a UI, not a data dump. These rules apply to the sequences list, the users/recipients
table, the sent log, the statistics breakdown, and the purchased/abandoned tables.

| Decision | Law(s) | Rule |
|----------|--------|------|
| Column alignment | Continuity | Text left, numbers right, dates consistent; one column order everywhere |
| Number formatting | Aesthetic-Usability | Tabular numerals, currency symbol, thousands separators; never `45000` |
| Row height | Fitts's | ≥44px when the row or its actions are clickable |
| Row actions | Fitts's + Occam's | 1–2 visible actions; the rest in a `⋯` menu with 44px targets |
| Status | Similarity + accessibility | Text + colour badge ("Running", "Paused"); never colour alone |
| Pagination | Miller's | 25 / 50 / 100 per page, show the total, preserve filters and sort |
| Filters | Hick's + Miller's | ≤5 filters, chunked; advanced filters collapsed |
| Long tables | Continuity | Sticky header; keep the sort indicator visible |
| Responsive | Occam's | **Hide optional columns before allowing horizontal scroll.** Override a theme's
  blanket `table { min-width: 800px }` when the remaining columns fit (e.g. `.table-responsive table`
  scoped override). Never make the page itself scroll sideways. |
| Empty state | Peak-End | Explain what will appear here and the next action — not "No data" |
| Loading state | Doherty + Closure | Skeleton rows, not a frozen table |
| Error state | Postel's | Human message + retry; keep filters and scroll position |
| Accessibility | WCAG | `<caption>` or `aria-label`, `scope="col"`, `aria-sort`, keyboard-sortable headers,
  focus-visible row actions |
| Density | Occam's | Subtle hover or zebra — not both heavy; 8–12px cell padding |
| Truncation | Postel's | Truncate long text with a `title`/expand affordance, never mid-word silently |

**Table checklist before shipping:** alignment and number formatting correct; 44px actions; status is
text + colour; pagination total shown; filters preserved; optional columns hidden on mobile with no
page-level horizontal scroll; empty/loading/error states present; headers and sort are accessible;
currency formatted with the app's symbol.

---

## Audit (before coding)

- **Hick's:** is every screen's primary-action count ≤5? Are tabs ≤4?
- **Fitts's:** are all interactive targets ≥44px? Is the primary CTA in a predictable zone?
- **Cognitive load:** is content chunked (3–5)? Is any raw complexity leaking (Tesler's)?
- **Progressive disclosure:** are details in a drawer, advanced config collapsed?
- **Miller's:** are tables/lists chunked and paginated?

## Implement

- Semantic HTML + `aria-*`; visible `:focus-visible`; responsive at sm/md/lg.
- All states: hover, focus, active, disabled, **loading, error, empty**.
- Use design tokens for spacing/type/color/radius/motion.
- **No raw/unstyled native controls.**

## Trace (deliver with the page)

```
Trace:
- Decision: 4 tabs (Sequences · Users & recipients · Statistics · Settings)
  → Law: Miller's Law (≤4 chunks) + Hick's Law (fewer top-level choices)
- Decision: Delete only via ⋯ menu + type-"delete" confirmation modal
  → Law: Fitts's Law (destructive gated) + Postel's Law (explicit confirm)
- Decision: step/user details open in a slide-over drawer; Advanced collapsed
  → Law: progressive disclosure (Hick's + Occam's — don't dump everything)
- Decision: health banners render only when a check fails
  → Law: Von Restorff (signal only what matters) + Occam's Razor (no clutter)
- Decision: skeleton loaders for tables + chart
  → Law: Doherty Threshold (<400ms feedback) + Law of Closure (signals loading)
- Decision: 44px targets, one accent on the primary control
  → Law: Fitts's Law + Von Restorff
```

## Pre-ship design checklist

- [ ] ≤4 tabs; one primary action per view.
- [ ] Start/Pause is the single primary control on a sequence card.
- [ ] Delete is in `⋯`, behind a type-"delete" modal; destructive actions are separated.
- [ ] Details are in a drawer; advanced config collapses.
- [ ] Health banners hidden when everything is OK.
- [ ] Empty / loading / error states on every table and chart.
- [ ] 44px targets, visible focus rings, keyboard-navigable tabs + drawer.
- [ ] Contrast ≥4.5:1; dark-mode tokens.
- [ ] Trace block attached.
