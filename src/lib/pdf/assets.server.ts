import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Font } from '@react-pdf/renderer'
import type { QuotePdfEmbeddedAsset } from './types'

const bundledAssets = Object.freeze({
  companyLogo: fileURLToPath(new URL('./assets/weyne-logo-blue.png', import.meta.url)),
  fonts: Object.freeze({
    jostRegular: fileURLToPath(new URL('./assets/Jost-Variable.ttf', import.meta.url)),
    newsreaderRegular: fileURLToPath(
      new URL('./assets/Newsreader-Variable.ttf', import.meta.url),
    ),
  }),
})

let fontsRegistered = false

const fontDataUrl = (path: string) =>
  `data:font/ttf;base64,${readFileSync(path).toString('base64')}`

export function getBundledPdfAssets() {
  return bundledAssets
}

export function registerBundledPdfFonts(): void {
  if (fontsRegistered) return

  Font.register({
    family: 'Weyne Jost',
    fonts: [
      { src: fontDataUrl(bundledAssets.fonts.jostRegular), fontWeight: 400 },
      { src: fontDataUrl(bundledAssets.fonts.jostRegular), fontWeight: 500 },
      { src: fontDataUrl(bundledAssets.fonts.jostRegular), fontWeight: 600 },
    ],
  })
  Font.register({
    family: 'Weyne Newsreader',
    src: fontDataUrl(bundledAssets.fonts.newsreaderRegular),
    fontWeight: 400,
  })
  Font.registerHyphenationCallback((word) => [word])
  fontsRegistered = true
}

export function resolvePdfImageSource(
  asset: QuotePdfEmbeddedAsset | null,
): string | Buffer | null {
  if (!asset) return null
  if (asset.kind === 'bytes') return Buffer.from(asset.data)

  if (/^(?:https?:|data:|blob:)/i.test(asset.path)) return null
  return existsSync(asset.path) ? readFileSync(asset.path) : null
}
