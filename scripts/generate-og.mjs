/**
 * Generate the Open Graph card (1200×630) in the Weyne design system by
 * rendering HTML → image, à la masoria-universe's `archive-banner` skill.
 *
 * IMPORTANT: run under Node (Playwright hangs under Bun):
 *   node scripts/generate-og.mjs
 *
 * Writes public/og/weyne-home.html (inspect / re-render) and weyne-home.jpg.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const W = 1200
const H = 630
const OG_DIR = resolve(process.cwd(), 'public/og')
const IMAGES = resolve(process.cwd(), 'public/images')
const img = (name) => pathToFileURL(resolve(IMAGES, name)).href

const HERO_GRADIENT =
  'radial-gradient(125% 120% at 82% 4%, #0a5c98 0%, #034F83 40%, #012C4B 100%)'

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  html,body{background:#012C4B}
  #stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${HERO_GRADIENT};color:#fff;font-family:'Jost',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .curve{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .circle{position:absolute;border:1.5px solid rgba(255,255,255,.06);border-radius:50%}
  .mono{position:absolute;right:-70px;bottom:-96px;width:400px;opacity:.06}
  .wrap{position:absolute;inset:0;padding:70px 84px 74px;display:flex;flex-direction:column}
  .logo{width:262px;height:auto}
  .spacer{flex:1}
  .eyebrow{display:inline-flex;align-items:center;gap:14px}
  .dash{width:34px;height:2px;background:#EECAA0;display:inline-block}
  .eyebrow span{font:600 15px/1 'Jost';letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.82)}
  h1{font-family:'Newsreader',serif;font-weight:400;font-size:52px;line-height:1.08;letter-spacing:-.018em;margin:24px 0 34px;max-width:760px}
  h1 em{font-style:italic;color:#EECAA0}
  .foot{display:flex;align-items:center;gap:18px}
  .atende{font:600 13px/1 'Jost';letter-spacing:.2em;text-transform:uppercase;color:#EECAA0}
  .regions{font:500 20px/1 'Jost';color:rgba(255,255,255,.8);letter-spacing:.01em}
  .fade{position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(180deg,rgba(1,44,75,0),rgba(1,44,75,.28))}
</style></head>
<body>
  <div id="stage">
    <svg class="curve" viewBox="0 0 1200 630" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M-60,430 C240,520 420,300 660,380 S1080,450 1320,350" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="1.3"/>
      <path d="M-60,498 C260,588 460,360 700,440 S1120,500 1360,398" fill="none" stroke="rgba(238,202,160,.14)" stroke-width="1.3"/>
    </svg>
    <div class="circle" style="width:520px;height:520px;right:-150px;top:-190px"></div>
    <img class="mono" src="${img('monogram-white.png')}" alt="">
    <div class="fade"></div>
    <div class="wrap">
      <img class="logo" src="${img('logo-horizontal-white.png')}" alt="Weyne Representações">
      <div class="spacer"></div>
      <div class="eyebrow"><span class="dash"></span><span>Representação comercial · Higiene profissional</span></div>
      <h1>Relacionamento, conhecimento e soluções que <em>geram resultados</em>.</h1>
      <div class="foot">
        <span class="atende">Atende</span>
        <span class="regions">Pernambuco · Alagoas · Paraíba · Rio Grande do Norte</span>
      </div>
    </div>
  </div>
</body></html>`

async function run() {
  await mkdir(OG_DIR, { recursive: true })
  const htmlPath = resolve(OG_DIR, 'weyne-home.html')
  await writeFile(htmlPath, html)

  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2, // retina-crisp OG
  })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([
      document.fonts.load("400 62px Newsreader"),
      document.fonts.load("italic 400 62px Newsreader"),
      document.fonts.load("600 15px Jost"),
    ])
  })
  await page.waitForTimeout(300)
  const stage = await page.$('#stage')
  await stage.screenshot({
    path: resolve(OG_DIR, 'weyne-home.jpg'),
    type: 'jpeg',
    quality: 92,
  })
  await browser.close()
  console.log(`✓ public/og/weyne-home.jpg (${W}x${H})`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
