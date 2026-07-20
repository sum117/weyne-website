/**
 * Generate favicons + touch/manifest icons from the brand monogram.
 *
 * A navy rounded square with the white monogram: high contrast on light and
 * dark browser chrome, on-brand, transparency-safe for iOS/manifest.
 * Re-run after replacing the monogram:  bun run generate:icons
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const IMAGES = resolve(process.cwd(), 'public/images')
const PUBLIC = resolve(process.cwd(), 'public')
const NAVY = { r: 1, g: 44, b: 75, alpha: 1 }

async function icon(size: number, glyphRatio = 0.62): Promise<Buffer> {
  const glyph = Math.round(size * glyphRatio)
  const radius = Math.round(size * 0.22)
  const mark = await sharp(await readFile(resolve(IMAGES, 'monogram-white.png')))
    .resize(glyph, glyph, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`,
  )
  return sharp({
    create: { width: size, height: size, channels: 4, background: NAVY },
  })
    .composite([
      { input: mark, gravity: 'center' },
      { input: mask, blend: 'dest-in' },
    ])
    .png()
    .toBuffer()
}

async function run(): Promise<void> {
  const targets: Array<[string, number]> = [
    ['favicon-16.png', 16],
    ['favicon-32.png', 32],
    ['favicon-48.png', 48],
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ]
  for (const [name, size] of targets) {
    await writeFile(resolve(PUBLIC, name), await icon(size))
    console.log(`icon ${name} (${size}px)`)
  }

  // favicon.ico: multi-size PNG-in-ICO (16/32/48).
  const ico = await buildIco([16, 32, 48])
  await writeFile(resolve(PUBLIC, 'favicon.ico'), ico)
  console.log('icon favicon.ico (16/32/48)')

  console.log('\n✓ icons generated.')
}

/** Assemble a minimal ICO container from PNG frames. */
async function buildIco(sizes: number[]): Promise<Buffer> {
  const pngs = await Promise.all(
    sizes.map(async (s) => ({ size: s, data: await icon(s) })),
  )
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)

  const entries: Buffer[] = []
  let offset = 6 + pngs.length * 16
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

run().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
