import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const png = await sharp({
  create: {
    width: 8,
    height: 8,
    channels: 4,
    background: { r: 20, g: 80, b: 160, alpha: 1 },
  },
})
  .png()
  .toBuffer()

await writeFile(new URL('./fixture-logo.png', import.meta.url), png)
console.log('fixture-logo.png bytes:', png.length)
