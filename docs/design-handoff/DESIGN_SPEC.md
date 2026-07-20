# Handoff: Weyne Representações — Landing Page

**Date:** 2026-07-11 · **Locale:** pt-BR · **Scope:** one-page marketing site (landing page only)

This bundle contains everything needed to implement the Weyne Representações landing page in production:

| Path | What it is |
|---|---|
| `DESIGN_SPEC.md` | This file — design spec, tokens, per-section anatomy, behaviors |
| `ARCHITECTURE.md` | TanStack Start architecture, folder boundaries, dependency rules, rendering model, and evolution path |
| `IMPLEMENTATION.md` | TanStack-specific build order, integration recipes, content contracts, CVA guidance, motion, form, tests, and QA |
| `design/Weyne Representacoes.dc.html` | **The hi-fi design reference** — open in a browser (desktop + responsive) |
| `design/Mobile Preview.dc.html` | Phone-frame viewer for the same page (360/390/430 widths) |
| `design/support.js`, `design/assets/` | Runtime + images the design file needs (keep folder together) |
| `content/landing-page.md` | Copy source of truth (front matter + all pt-BR copy + production TODOs) |
| `content/represented-brands.pdf` | Brand source PDF (logos were extracted from here) |
| `./screenshots/` | Included desktop + mobile reference screenshots of every section (see its README for capture notes). Supporting only — the design files above are the source of truth. |

## About the design files

The files in `design/` are **design references created in HTML** — a prototype showing intended look and behavior, **not production code to copy directly**. It uses a proprietary DC runtime (`support.js`), inline styles, and hand-rolled JS that must NOT be ported as-is. The task is to **recreate this design** in the stack described in `ARCHITECTURE.md`, using its established libraries (Tailwind, shadcn/Radix, CVA, Motion) instead of the prototype's hand-rolled equivalents. The prototype IS, however, the authoritative source for exact values: when in doubt, open it and inspect the inline styles.

## Fidelity

**High-fidelity.** Colors, typography, spacing, copy, and interactions are final. Recreate pixel-perfectly. The only intentionally-unfinished parts are placeholder contact data (see "Open TODOs" below).

## Product context

Weyne Representações is a commercial representation business (higiene e limpeza profissional) founded by Carolina Weyne, serving PE · AL · PB · RN. The page's single conversion goal is **starting a WhatsApp conversation** ("Fale com um consultor"). Everything else (brands, differentiators, segments) builds credibility toward that CTA. There is no product catalog, no e-commerce, no login.

## Design tokens

### Color (exact hex — also present as CSS vars on `#wy` in the prototype)

| Token | Value | Usage |
|---|---|---|
| `navy` | `#012C4B` | Dark surfaces (hero end, segmentos, footer), headings on light |
| `blue` | `#034F83` | Primary actions, links, icon tint, gradient start |
| `baltic` | `#069CFF` | Hover/focus accent, focus rings |
| `sand` | `#EECAA0` | Warm accent: eyebrow dashes, em-text on dark, form submit, footer headings, selection bg |
| `paper` | `#F6F3EC` | Page background |
| `ink` | `#12314C` | Body text on light |
| `muted` | `#5C7286` | Secondary text on light |
| `line` | `rgba(3,79,131,.13)` | Hairline borders on light surfaces |

Recurring derived values: card gradient `linear-gradient(165deg,#034F83,#012C4B)`; segmentos bg `linear-gradient(155deg,#034F83 0%,#012C4B 100%)`; hero bg `radial-gradient(125% 120% at 82% 4%, #0a5c98 0%, #034F83 40%, #012C4B 100%)`; icon tile bg `rgba(3,79,131,.07)`; on-dark text `rgba(255,255,255,.78–.9)`; on-dark hairline `rgba(255,255,255,.10–.16)`; form submit text `#3a2a12`; founder-card body text `#3a5064`; `::selection` = sand bg / navy text.

### Typography

- **Display serif — Newsreader** (variable: optical size + weight; italics used). Weight 400 for all H1/H2/stat numbers; 500 for the nav wordmark. Italic for the hero `em` and the quote.
- **UI/body sans — Jost.** Weights 400/500/600 (700 loaded, barely used).
- No other fonts. Icons are **Phosphor, "light" weight**.

Scale (desktop → use `clamp()` exactly as noted):

| Role | Spec |
|---|---|
| H1 (hero) | Newsreader 400, `clamp(38px,5.6vw,72px)`, line-height 1.02, letter-spacing −.018em, max-width 15ch |
| H2 (sections) | Newsreader 400, `clamp(30px,~4vw,50–52px)`, lh 1.05–1.08, ls −.015em |
| Stat number | Newsreader 400, `clamp(44px,4.6vw,60px)`, blue |
| Eyebrow/kicker | Jost 600, 12.5px, uppercase, ls .2em (.24em in hero), blue on light / white 82% on dark, preceded by a 26–30px × 2px accent dash |
| Body lead | 16–19px, lh 1.72–1.78 |
| Card title (H3) | Jost 600 20px |
| Card body | 15px, lh 1.66 |
| Micro-labels | Jost 600 11–11.5px, uppercase, ls .12–.16em |
| Nav links | Jost 500 15px |
| Buttons | Jost 600 14–15.5px |

### Layout

- Container: **1320px** max (nav + hero), **1200px** max (all other sections). Horizontal padding `clamp(18px,5vw,48px)`.
- Section vertical padding: `clamp(84px,11vw,140–150px)`.
- Radii: cards 20–26px · buttons/pills 999px · inputs & form submit 12px · icon tiles 12–16px · segment tiles 18px · mobile menu 20px.
- Key shadows: stats card `0 40px 80px -46px rgba(3,79,131,.4)`; founder card `0 46px 90px -50px rgba(3,79,131,.42)`; form card `0 50px 100px -50px rgba(1,44,75,.9)`; card hover `0 44–48px 74–84px -38/-40px rgba(3,79,131,.45/.5)`; primary pill `0 12px 26px -14px rgba(3,79,131,.75)`.
- Breakpoints (from prototype JS): **< 900px** nav collapses to burger + sheet; **< 640px** phone adjustments (hero image swap, stats stack, badge reposition). `scroll-padding-top: 96px` for anchor offset.

### Motion

- Scroll reveals: fade + rise (`translateY(24–28px) → 0`), 0.7–1s, easing `cubic-bezier(.16,.8,.24,1)`, staggered ~40–160ms within a group, once only, trigger margin `0px 0px -7% 0px`.
- Stat count-up: 0 → target, 1400ms, cubic ease-out, triggered at ~40% visibility, once. Markup must contain the real number (SEO/no-JS) — animation only overrides at runtime.
- Hero badge float: ±9px vertical, 7.5s ease-in-out infinite.
- FAB pulse ring: scale 1→1.85 fade-out, 2.6s infinite.
- Hero mouse parallax (desktop only, nice-to-have): watermark ±24px, glow ±10px, lerp-damped (~0.06).
- All hover transitions 0.25–0.5s. **`prefers-reduced-motion: reduce` disables all of the above** (content simply visible).

## Page anatomy (top → bottom)

All sections live on one route. Anchor ids: `#topo` `#sobre` `#diferenciais` `#marcas` `#segmentos` `#contato`.

### 1. Fixed header (`data-screen-label` in prototype: "Landing — Weyne Representações")

- Fixed, full-width, z-60. **Two visual states** (see Behaviors): transparent-on-hero vs. solid after 24px scroll.
- Left: monogram (40×40) + stacked wordmark — "weyne" Newsreader 500 31px + "REPRESENTAÇÕES" Jost 600 8.5px ls .34em. Monogram cross-fades white↔blue between states.
- Right (≥900px): links Sobre / Diferenciais / Marcas / Segmentos + pill CTA "Fale com um consultor" (blue bg, WhatsApp icon, hover → baltic + lift 1px).
- < 900px: 46×46 burger button (rounded 13px, frosted). Opens a light panel/sheet: white, radius 20, nav items 16px + full-width CTA.

### 2. Hero (`#topo`)

- Radial navy/blue gradient bg (see tokens); decorative: two thin flowing SVG curves (white 9%, sand 14%), two huge hairline circles bleeding off-canvas, 110px bottom fade into `paper`.
- Two flex columns (wrap): text `flex:1 1 400px`, figure `flex:1 1 350px`. Top padding `clamp(122px,14vw,180px)`.
- Text column: eyebrow "Representação comercial · Higiene profissional" → H1 "Relacionamento, conhecimento e soluções que *geram resultados*." (em italic sand) → lead paragraph (white 80%, max 52ch) → CTA row: **white pill** "Fale com um consultor" (WhatsApp icon, 17×28px padding, navy text, hover → sand bg + lift 2px) + text link "Conheça as marcas →" (gap widens 11→16px on hover, turns sand).
- Figure column (min-height `clamp(500px,80vh,780px)`): layered — ① brand outline watermark (`outline-white.png`, 134% width, 8% opacity, parallax layer 24) ② soft radial white glow (parallax 10) ③ photo `carolina-desk.png` bottom-anchored, centered, `width:min(112%,660px)` ④ floating badge card (white 97%, radius 17, monogram 28px + "ATENDE / PE · AL · PB · RN"), left −2% / bottom 34%, float animation.
- **< 640px:** photo swaps to `carolina-desk-mobile.png` (1200×1280 crop) and the column's min-height fits the image width × 1280/1200 (no dead space); badge moves to left 10px / bottom 30%.

### 3. Stats band

- White card overlapping the hero: `margin-top:-72px` (−44px on phones), max-width 1200, radius 24, hairline border, big soft shadow. Grid `repeat(auto-fit,minmax(190px,1fr))`, cells center-aligned, `padding:34px clamp(20px,3vw,40px)`, 1px `line` dividers — **right-side dividers on desktop, bottom dividers when stacked** (last cell none).
- Cells: **28** anos de experiência na área comercial · **+17** anos em higiene e limpeza profissional · **4** estados atendidos no Nordeste · **8** marcas industriais representadas. Number = count-up target; "+" is a static prefix glyph at the same size.

### 4. Sobre (`#sobre`)

- 2-col grid `minmax(330px,1fr)`, gap `clamp(40px,6vw,88px)`, items centered.
- Left: eyebrow "Sobre a Weyne" → H2 "Nascemos para conectar empresas às melhores soluções em higiene profissional." → paragraph → **quote block**: 3px sand left border, Newsreader italic `clamp(19px,1.7vw,24px)` navy.
- Right: **founder card** — white, radius 26, padding `clamp(30px,3.6vw,50px)`, `monogram-sand.png` watermark (180px, top −30 / right −30, 50% opacity), label "PALAVRA DE QUEM REPRESENTA", 3 paragraphs (15–16.5px / 1.75, color `#3a5064`, key figures bolded navy), divider, byline row: 50px circle (paper bg, monogram 26px) + "Carolina Weyne" (Newsreader 21px) + "Fundadora · Weyne Representações" (12.5px muted).

### 5. Diferenciais (`#diferenciais`)

- White band with top/bottom hairline borders. Header block (max 760px): eyebrow "Diferenciais", H2 "Por que escolher a Weyne Representações?", lead.
- Grid `minmax(290px,1fr)`, gap ~20px — 6 cards. Card: white, radius 22, hairline border, padding `clamp(28px,2.6vw,36px)`; ghost number "01"–"06" top-right (Newsreader 34px, `rgba(3,79,131,.18)`); 60×60 icon tile (radius 16, `rgba(3,79,131,.07)` bg, blue Phosphor-light icon 31px); H3 20px; body 15px muted.
- Content/icons: Atendimento consultivo `chats-circle` · Relacionamento próximo `handshake` · Conhecimento técnico `graduation-cap` · Marcas reconhecidas `seal-check` · Agilidade no atendimento `lightning` · Compromisso com resultados `chart-line-up` (copy in `content/landing-page.md`).
- Hover: card lifts −8px, border → transparent, big shadow; icon tile inverts (blue bg / white icon); ghost number → sand.

### 6. Marcas representadas (`#marcas`)

- Header: 2-col (title block + right-aligned lead ending with hint "Passe o cursor para conhecer cada uma." — **hidden on touch/phone**).
- Grid `minmax(232px,1fr)`, gap ~16–20px — **8 logo cards**, min-height 210px, white, radius 20. Layout: centered logo area + bottom-left category micro-label. Logos render **grayscale, 50% opacity** at rest (a `logoTreatment` design option also allows full color — default is muted).
- Category labels (+ Century cards carry a small "marca Plestin" chip — 10px blue on `rgba(3,79,131,.08)`, radius 6): Total Clean → Saneantes · Life Clean → Descartáveis · British → Abrasivos · Plestin → Dispensadores · Century Pro → Equipamentos · Century Paper → Papéis · Kelldrin → Controle de pragas · Bello Bella → Antissépticos.
- Per-logo max-heights (they're visually balanced by hand): total-clean 70 · life-clean 84 · british 52 · plestin 60 · century-pro 56 · century-paper 72 · kelldrin 58 · bello-bella 62 (px).
- **Hover/tap overlay**: full-card gradient (165deg blue→navy) slides up (opacity 0 + translateY 14px → visible), containing brand name (sand, 11px caps) + 1–2 line description (14px, white 90%). On hover the card also lifts −8px. **On touch devices tap toggles the overlay** (no hover). Descriptions in `content/landing-page.md`.

### 7. Segmentos (`#segmentos`) — dark band

- Gradient navy bg with **organic wave dividers top and bottom** (SVG, fill = paper, height `clamp(46px,6vw,92px)`; exact paths in IMPLEMENTATION.md) + two decorative flowing hairline curves + giant monogram watermark bottom-right (`min(46vw,520px)`, 5% opacity).
- Header (max 720px): sand eyebrow dash, white H2 "Atuação por meio de distribuidores parceiros", lead white 78%.
- Sub-label "AS SOLUÇÕES REPRESENTADAS ESTÃO PRESENTES EM" (sand, 12px caps).
- Tile row: grid `minmax(150px,1fr)`, gap 14 — 7 tiles: Hospitais `first-aid-kit` · Hotéis `bed` · Indústrias `factory` · Lavanderias `washing-machine` · Supermercados `shopping-cart` · Food service `fork-knife` · Empresas e instituições `buildings`. Tile: centered column, padding 30/16, bg white 5%, border white 10%, radius 18, icon 34px sand, label 14.5px. Hover: bg white 10%, lift −4px.

### 8. Contato (`#contato`)

- 2-col grid `minmax(320px,1fr)`. Left: eyebrow "Contato", H2 "Pronto para encontrar as melhores soluções?", lead, then 3 rows (white, radius 16, padding 18/22, 46px icon tile): **WhatsApp** `(00) 0 0000-0000` [placeholder] · **E-mail** `contato@weynerepresentacoes.com.br` [unconfirmed — uses `overflow-wrap:anywhere` + font-size clamp so it never overflows] · **Regiões atendidas** `Pernambuco · Alagoas · Paraíba · Rio Grande do Norte`. First two are links; hover: border → baltic, slide right 4px.
- Right: **form card** — gradient blue→navy, radius 26, padding `clamp(30px,3.6vw,46px)`, monogram watermark 8%. Title "Solicite um contato" (Newsreader ~27px) + helper line. Fields: Nome, Empresa, Mensagem (textarea rows=3) — labels 11px caps white 66%; inputs white 6% bg, white 16% border, radius 12, padding 15/16; focus = baltic border + 4px `rgba(6,156,255,.12)` ring. Submit: **sand** button (radius 12, text `#3a2a12`, WhatsApp icon) — "Enviar pelo WhatsApp"; hover → white bg + lift. **Submit composes a wa.me message from the fields and opens WhatsApp — there is no server** (see IMPLEMENTATION.md).

### 9. Footer

- Navy, wave divider on top (fill paper). 4-col grid `minmax(200px,1fr)`: ① horizontal white logo (168px) + one-liner (white 66%) ② Navegação links ③ Regiões list ④ Contato links + 3 social squares (42px, radius 11, white 16% border, hover: sand bg + navy icon) — WhatsApp / Instagram / LinkedIn (targets TBD).
- Bottom bar: hairline top border, 13px white 50%: "© 2026 Weyne Representações. Todos os direitos reservados." + "CNPJ 00.000.000/0001-00" [placeholder].

### 10. Floating actions (fixed, bottom-right, z-70, safe-area aware)

- **Back-to-top**: 46px white circle, appears (fade + rise) after 520px scroll, scrolls to top.
- **WhatsApp FAB**: 58px blue circle, pulse ring, hover → baltic + lift. **Hides while `#contato` is in view** (≥18% visible) to avoid duplicating the form CTA.

## Behaviors summary

| Behavior | Spec |
|---|---|
| Nav solidify | At `scrollY > 24`: bg `rgba(255,255,255,.92)` + `blur(16px) saturate(150%)`, hairline bottom border, subtle shadow; links white → `#274a66`; wordmark → `#0A2740`; monogram white → blue (cross-fade .4s) |
| Anchor scrolling | Smooth, with 74–96px header offset — pure CSS (`scroll-behavior:smooth` + `scroll-padding-top`) |
| Mobile menu | Burger toggles sheet; icon list↔x; closes on link click / ≥900px resize |
| Scroll reveal / count-up / parallax / float / pulse | See Motion tokens |
| Brand overlays | Hover on pointer devices; tap-toggle on touch |
| Form submit | Build message from fields → `window.open('https://wa.me/<number>?text=…')`; button shows "Abrindo o WhatsApp…" for ~2.6s |
| FAB / to-top visibility | See §10 |
| Reduced motion | All animation off; reveals visible; counts show final values |

## Assets (in `design/assets/`)

Photography (pre-cut, transparent bg): `carolina-desk.png` (hero desktop), `carolina-desk-mobile.png` (hero < 640px), `carolina.png` + `carolina-fullbody.png` (alternates, unused). Brand marks: `monogram-{blue,white,sand}.png`, `logo-horizontal-{blue,white}.png`, `outline-{blue,white}.png` (line-art watermark). Represented-brand logos in `assets/brands/*.png` (8 files — extracted from `content/represented-brands.pdf`; re-extract from the PDF if higher resolution is needed). Icons are NOT assets — use `@phosphor-icons/react`, weight "light".

Recommendation: convert photos to WebP/AVIF at build or by hand; keep PNGs for logos/watermarks (transparency).

## SEO / meta (from `content/landing-page.md` front matter)

- `<html lang="pt-BR">`; title "Weyne Representações — Relacionamento, conhecimento e soluções que geram resultados."
- Meta description: "Representação comercial em higiene e limpeza profissional em PE, AL, PB e RN. Atendimento consultivo, marcas reconhecidas e soluções que geram resultados."
- OG image: suggest a composed card with `brand/banner`-style navy + logo (not in this bundle — ask client or compose).
- Optional: JSON-LD `LocalBusiness`/`ProfessionalService` once real contact data exists.

## Accessibility notes (already reflected in the prototype — keep)

- Decorative images/SVGs: `aria-hidden` + empty alt; meaningful alt on photo & logos.
- Buttons/links have `aria-label`s where icon-only (burger, FAB, socials, to-top).
- Focus states: baltic ring on inputs; ensure `:focus-visible` on all interactive elements (prototype relies on hover — add focus-visible equivalents).
- Contrast: body-on-paper and white-on-navy pass AA; `muted` on white ≈ 4.6:1 — keep ≥ 15px. Sand text only for decorative/large text on navy.
- Full `prefers-reduced-motion` support.

## Open TODOs before launch (all flagged `[PREENCHER]` in `content/landing-page.md`)

1. **WhatsApp number** — drives the FAB, nav CTA, hero CTA, contact row, and form (`https://wa.me/55XXXXXXXXXXX`). Prototype uses `5500000000000`.
2. Phone display string `(00) 0 0000-0000`.
3. E-mail — `contato@weynerepresentacoes.com.br` is a plausible placeholder, **confirm before launch**.
4. CNPJ in footer.
5. Social URLs (Instagram/LinkedIn) — or remove those icons.
6. Confirm founder signature "Carolina Weyne" and the OG image.
