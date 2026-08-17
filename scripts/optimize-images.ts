/**
 * Generate responsive derivatives for hero photography and transparent brand
 * artwork. The original PNGs remain the fallback/source of truth.
 *
 * The PNG source stays in version control as the fallback; the AVIF/WebP files
 * are production derivatives the hero <picture> element prefers. Re-run after
 * replacing a source PNG:  bun run optimize:images
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const IMAGES = resolve(process.cwd(), 'public/images')

const SOURCES = ['carolina-desk', 'carolina-desk-mobile'] as const

const BRAND_SOURCES = [
  { name: 'outline-white', width: 1200 },
  { name: 'monogram-blue', width: 640 },
  { name: 'monogram-sand', width: 640 },
  { name: 'monogram-white', width: 640 },
  { name: 'logo-horizontal-white', width: 384 },
] as const

async function run(): Promise<void> {
  for (const name of SOURCES) {
    const png = resolve(IMAGES, `${name}.png`)
    const input = await readFile(png)

    const avif = await sharp(input).avif({ quality: 62, effort: 6 }).toBuffer()
    await writeFile(resolve(IMAGES, `${name}.avif`), avif)

    const webp = await sharp(input).webp({ quality: 78, effort: 6 }).toBuffer()
    await writeFile(resolve(IMAGES, `${name}.webp`), webp)

    const pngKb = (input.length / 1024) | 0
    const avifKb = (avif.length / 1024) | 0
    const webpKb = (webp.length / 1024) | 0
    console.log(`${name}: png ${pngKb}KB → avif ${avifKb}KB · webp ${webpKb}KB`)
  }

  for (const { name, width } of BRAND_SOURCES) {
    const png = resolve(IMAGES, `${name}.png`)
    const input = await readFile(png)
    const webp = await sharp(input)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 100, effort: 6 })
      .toBuffer()
    await writeFile(resolve(IMAGES, `${name}.webp`), webp)

    const pngKb = (input.length / 1024) | 0
    const webpKb = (webp.length / 1024) | 0
    console.log(`${name}: png ${pngKb}KB → webp ${webpKb}KB @ ${width}px`)
  }
  console.log('\n✓ hero derivatives generated.')
}

run().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
