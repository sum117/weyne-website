/**
 * Deterministic canonical-viewport screenshots for visual QA.
 *
 * IMPORTANT: run under Node, not Bun — Playwright's browser launch hangs under
 * the Bun runtime.
 *
 *   URL=http://localhost:3000/ OUT=./__shots node scripts/screenshots.mjs
 *
 * Animations are frozen (reduced-motion + Playwright animations:'disabled') so
 * captures are stable. Full-page by default; VIEWPORT_ONLY=1 for folds only.
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const URL = process.env.URL ?? 'http://localhost:3000/'
const OUT = resolve(process.cwd(), process.env.OUT ?? '__shots')
const FULL = process.env.VIEWPORT_ONLY !== '1'

const VIEWPORTS = [
  [1440, 1000],
  [1024, 900],
  [768, 1024],
  [430, 932],
  [390, 844],
  [360, 800],
]

async function run() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const [width, height] of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      })
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {})
      await page.waitForTimeout(500)
      const file = resolve(OUT, `shot-${width}x${height}.png`)
      await page.screenshot({ path: file, fullPage: FULL, animations: 'disabled' })
      console.log(`captured ${width}x${height} -> ${file}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log('\n✓ screenshots done.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
