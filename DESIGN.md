# eBid Baju: design direction "Monokrom Premium"

Owner's request (2026-11-12): the font and theme should feel like a premium car-maker's site
(reference: a Porsche dealer page). We copy the **discipline**, never the brand: no Porsche
name, logo or proprietary font. Their typeface is proprietary, so we use **Barlow**, an open
grotesk with similar narrow, clean letterforms.

## Look
- **Ground:** pure white. **Ink:** near-black `#010205`. **Tiles:** cool grey `#eeeff2` for grouped content.
- **Type:** Barlow everywhere. Headings use Barlow Semi Condensed at **weight 400** (light, large, calm),
  never heavy bold. Body 16px. Numbers use tabular figures (`font-variant-numeric: tabular-nums`).
  Prices are big and regular weight, like a car's price, not shouted.
- **Photography first:** full-bleed images with the headline overlaid bottom-left in white
  (`.hero-photo` + `.hero-copy`, with a soft dark fade only at the bottom, for legibility).
- **Buttons:** primary = black fill, white text, 8px radius, 48–54px tall, regular weight.
  Secondary = 2px black outline. Text links use `.link-arrow` ("→ Lihat semua").
- **Header:** white, sticky, hairline bottom border, the shop's logo mark + name; nav in ink with an
  underline for the active item. Admin/super headers stay dark (near-black).
- **Brand colour (tenant):** only the logo mark and tiny identity accents. Everything else is monochrome.
- **Cards:** used sparingly. Prefer open layouts on white; use `.tile` (grey, 12px radius) to group;
  `.elevated` (white + soft shadow) only for the one highlighted card in a row.
- **Spacing:** generous. Sections breathe (64–96px on desktop, 40–56px on phones).
- **Motion:** minimal: arrow nudge on hover, price change `.bump`, new bid row `.flash`.

## Still true from before
- Real content only; no fake stats/testimonials; no emoji; no gradients except the photo fade.
- JPJeBid-style menu, statuses as dot + text (`EB.ui.statusBadge`), tables with hairlines.
- Mobile first: 44px+ tap targets, 16px inputs, no sideways scroll at 360px, sticky bid bar on item pages.
- The Bayarcash pages under `pay/` keep Bayarcash's own look (third-party page).

## Classes (assets/app.css)
`.btn .btn-brand/.btn-outline/.btn-ghost/.btn-danger/.btn-sm/.btn-lg`, `.link-arrow`, `.panel`, `.tile`,
`.elevated`, `.hero-photo/.hero-copy`, `.site-header`, `.eyebrow` (now sentence-case muted 14px),
`.lot`, `.lot-title`, `.price`, `.meta`, `.status-*`, `.table`, `.tabs/.tab/.count`, `.input/.label/.field-error/.hint`.
Tailwind tokens: `bg-paper bg-tile text-ink text-muted border-line`, `font-serif` = display (Barlow Semi Condensed).
