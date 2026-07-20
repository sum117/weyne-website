/**
 * Generate AVIF + WebP derivatives for the hero photography.
 *
 * The PNG source stays in version control as the fallback; the AVIF/WebP files
 * are production derivatives the hero <picture> element prefers. Re-run after
 * replacing a source PNG:  bun run optimize:images
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const IMAGES = resolve(process.cwd(), 'public/images')

// Hero crops only. Logos/monograms keep PNG transparency and are not converted.
const SOURCES = ['carolina-desk', 'carolina-desk-mobile'] as const

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
  console.log('\n✓ hero derivatives generated.')
}

run().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
