# Screenshots — Weyne Representações Landing Page

Companion to this handoff bundle (`README.md`, `DESIGN_SPEC.md`, `ARCHITECTURE.md`, and `IMPLEMENTATION.md` live at the bundle root). These are **reference images only** — the interactive source of truth is `design/Weyne Representacoes.dc.html`, which is authoritative for exact values and for anything a static image can't show (hovers, reveals, count-ups, parallax).

## Capture notes (read before pixel-measuring)

- **Desktop shots** were captured at a ~909px-wide viewport — the design's *narrow-desktop* rendering (desktop nav appears ≥900px). At full 1440px, `clamp()`-based type and spacing scale up and the containers (1200/1320px) center with more whitespace. Open the design file full-screen for true 1440 values.
- **Mobile shots** are true 390px-wide phone renderings (viewport-emulated, full sections stitched from scroll slices; ~2.3 device px per CSS px). The fixed header appears at the top of each shot; on a real device it stays pinned while content scrolls, and the WhatsApp FAB + back-to-top button (hidden during capture) float bottom-right.
- Scroll-reveal animations were allowed to finish before capture — positions/opacities shown are the settled state.

## Files

Desktop (909px wide):
- `desktop-01-hero.png` — hero top: transparent nav, headline, badge
- `desktop-02-hero-stats.png` — hero CTAs + overlapping stats band (final count-up values)
- `desktop-03-sobre.png` — Sobre: headline/quote + founder card
- `desktop-04-diferenciais.png` — 6 differentiator cards (rest state)
- `desktop-05-marcas.png` — 8 brand logo cards (muted grayscale rest state)
- `desktop-06-marcas-hover.png` — first brand card with hover overlay open (gradient + description)
- `desktop-07-segmentos.png` — dark band, wave dividers, 7 segment tiles
- `desktop-08-contato.png` — contact rows + WhatsApp form card
- `desktop-09-footer.png` — footer columns + bottom bar

Mobile (390px logical width):
- `mobile-01-hero.png` — nav (burger) + full hero text block + CTAs
- `mobile-01b-hero-figura-stats.png` — mobile hero photo crop + badge + stacked stats (horizontal dividers)
- `mobile-02-marcas.png` — section header + brand cards single-column
- `mobile-03-contato.png` — contact rows + form card top
- `mobile-04-menu-aberto.png` — burger menu open (white panel + CTA)
