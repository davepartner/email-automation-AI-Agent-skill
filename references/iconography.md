# Iconography — consistent, beautiful, accessible

Icons make the admin page faster to scan and more polished. But inconsistent or overloaded icons make it
*worse*. These rules keep it beautiful.

## 1. Reuse the app's icon set first

### 1a. Detect the source before you draw

**Never add an icon until you know which library the surface actually loads.** A class name in a code
snippet is not proof that its font is present — copying `bi bi-search` into an admin page that only
loads Font Awesome renders an empty box.

1. **Read the layout/head for the exact surface** — the admin layout for admin pages, the site layout
   for customer pages — and list the icon stylesheets/fonts actually linked: Bootstrap Icons
   (`bootstrap-icons.css`), Font Awesome (`fontawesome` / `all.min.css`), Ionicons, Material Icons,
   Lucide/Heroicons/Tabler/Feather, or a Flaticon project font.
2. **Grep the views on that surface** for the prefix already in use: `bi bi-*`, `fa fa-*` / `fas fa-*`,
   `ion-*`, `material-icons`, `ti ti-*`. The prefix that already exists is the one to match.
3. **Confirm the glyph renders** on the page. An empty square means the stylesheet or class is wrong —
   fix the source, don't add another library.

> Admin and public layouts often load **different** sets. A partial shared by both (a timeline caret, a
> table badge) must use a library that **both** load, or take its icon from the calling view. Example:
> an admin layout may load Font Awesome while the site loads Font Awesome + Bootstrap Icons — the
> shared caret must be Font Awesome.

**Bootstrap Icons ↔ Font Awesome 5 mapping (common dashboard elements):**

| Element | Bootstrap Icons | Font Awesome 5 |
|---------|-----------------|----------------|
| Send / sequences | `bi-send` | `fa-paper-plane` |
| Users | `bi-people` | `fa-users` |
| Settings | `bi-gear` | `fa-cog` |
| Search | `bi-search` | `fa-search` |
| Pause / resume | `bi-pause-circle` / `bi-play-circle` | `fa-pause-circle` / `fa-play-circle` |
| Stop / cancel | `bi-stop-circle` / `bi-x-circle` | `fa-stop-circle` / `fa-times-circle` |
| Exclude | `bi-slash-circle` | `fa-ban` |
| Email / external link | `bi-envelope` / `bi-box-arrow-up-right` | `fa-envelope` / `fa-external-link-alt` |
| Phone | `bi-telephone` | `fa-phone` |
| Check / warning / unknown | `bi-check-circle` / `bi-exclamation-circle` / `bi-question-circle` | `fa-check-circle` / `fa-exclamation-circle` / `fa-question-circle` |
| Expand caret | `bi-chevron-down` | `fa-chevron-down` |

Then apply the family, size and accessibility rules below.

- If the app already has an icon library (Lucide, Heroicons, Material Symbols, Phosphor, Font Awesome,
  Bootstrap Icons, the admin theme's icons), **use it**. Don't add a second family.
- If it has none, use **Lucide** (MIT, 24×24, 2px stroke) or **Heroicons** (MIT). A ready sprite is in
  `examples/icons.svg`.

## 2. One style, one scale

- **One family**, one stroke/fill style, one corner treatment. Never mix filled and outline icons.
- **Sizes:** 16px (inline meta), 20px (buttons, inputs, menu items), 24px (tabs, nav, cards).
- **Stroke:** 1.5–2px at 24px; scale the stroke with the size, not the path.
- **Colour:** `currentColor` so icons inherit text colour. Use the **accent** colour only on the primary
  action and the focus ring; use semantic colours (success/warning/danger) only for status.

## 3. Accessibility (non-negotiable)

- **Decorative** icons (next to a text label): `aria-hidden="true"` and `focusable="false"`.
- **Icon-only** buttons: an accessible name (`aria-label`) **and** a tooltip, and a **44×44px** hit area
  even if the glyph is 20px.
- **Never rely on colour/icon alone** for status — pair it with a text label ("Running", "Failed").
- Icons don't replace labels for primary/destructive actions; they *reinforce* them.
- No animated icons except a loading spinner, and respect `prefers-reduced-motion`.

## 4. Layout

- Icon **before** the label, with an 8px gap; vertically centred with the text.
- Align icon columns; keep the same icon for the same meaning everywhere.
- In tables, icon actions get 44px targets and a text tooltip.

## 5. Icon map (the "Email Automation" page)

| Element | Icon (Lucide name) | Where |
|---------|--------------------|-------|
| Email Automation nav | `mail` | top-level menu |
| Sequences tab | `list` | tab |
| Users & recipients tab | `users` | tab |
| Settings tab | `settings` | tab |
| Statistics (top of Sequences) | `bar-chart` / `trending-up` | KPI + charts |
| Start | `play` | sequence card |
| Pause | `pause` | sequence card |
| Off / disabled | `power` | status |
| Edit | `pencil` | `⋯` menu / drawer |
| Duplicate | `copy` | `⋯` menu |
| View statistics | `bar-chart` | `⋯` menu |
| Delete | `trash` | `⋯` menu (gated) |
| Add step | `plus` | Sequences |
| Preview / test-send | `send` | drawer |
| Search | `search` | Users toolbar |
| Expand sequence | `chevron-down` / `chevron-right` | caret |
| Cancel one email | `x` | scheduled row |
| Exclude user | `ban` | user panel |
| Re-include | `rotate-ccw` | user panel |
| Status: sent | `check` | log |
| Status: scheduled | `clock` | log |
| Status: cancelled / exited | `log-out` | log / caret badge |
| Status: failed | `alert-triangle` | log |
| Channel: email | `mail` | channels |
| Channel: push | `bell` | channels |
| Channel: WhatsApp | `message-circle` | channels |
| Channel: SMS | `smartphone` | channels |
| Health: transport | `server` | banner |
| Health: scheduler | `clock` | banner |
| Health: paused | `pause` | banner |
| Leads tab | `inbox` | admin product table |
| Paid tab | `shopping-bag` | admin product table |
| Phone | `smartphone` | table |
| External link | `external-link` | setup docs |
| Info | `info` | hints |
| Filter | `filter` | toolbars |
| Re-check / refresh | `refresh` | health banners |
| Plan / quota | `gauge` | top of Sequences |

## 6. Do / don't

- **Do** use icons to speed up scanning of tabs, actions, statuses, and channels.
- **Do** keep a text label next to destructive and primary actions.
- **Do** use one status icon per state, consistently.
- **Don't** decorate every heading with an icon (Occam's Razor).
- **Don't** mix icon families or stroke weights.
- **Don't** use emoji as UI icons inside the admin (they render inconsistently across OSes); emoji are
  fine in docs.
- **Don't** ship an icon-only destructive button without a confirm.

## 7. The sprite

`examples/icons.svg` is a Lucide-style `<symbol>` sprite (`viewBox="0 0 24 24"`, `currentColor`):

```html
<svg width="20" height="20" aria-hidden="true" focusable="false"><use href="#play"/></svg>
```

Inline the sprite (or copy the `<symbol>` you need). For icon-only buttons:

```html
<button aria-label="Pause sequence" title="Pause sequence" class="icon-btn">
  <svg width="20" height="20" aria-hidden="true"><use href="#pause"/></svg>
</button>
```

**See it rendered:** open `examples/admin-preview.html` — a self-contained, light/dark preview of the
Email Automation page showing tabs, KPI cards, sequence actions, statuses, the user caret with the
"Manually exited this sequence" badge, and the Leads/Paid tabs. It inlines the sprite, so it works
offline with no build step.
