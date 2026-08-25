import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8')
const declarations = new Map(
  [...css.matchAll(/(--[\w-]+):\s*([^;{}]+);/g)].map((match) => [
    match[1] ?? '',
    match[2]?.trim() ?? '',
  ]),
)

function resolveToken(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular CSS token reference: ${name}`)
  seen.add(name)

  const value = declarations.get(name)
  if (!value) throw new Error(`Missing CSS token: ${name}`)

  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  return reference ? resolveToken(reference, seen) : value
}

function rgb(hex: string): [number, number, number] {
  const normalized = hex === '#fff' ? '#ffffff' : hex
  if (!/^#[\da-f]{6}$/i.test(normalized)) {
    throw new Error(`Expected an opaque hex color, received ${hex}`)
  }
  return [1, 3, 5].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  ) as [number, number, number]
}

function luminance(hex: string): number {
  const linearize = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  }
  const [red, green, blue] = rgb(hex)
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const normalTextPairs = [
  ['--color-ink', '--color-paper'],
  ['--color-ink', '--card'],
  ['--color-muted', '--color-paper'],
  ['--color-muted', '--card'],
  ['--primary-foreground', '--primary'],
  ['--secondary-foreground', '--secondary'],
  ['--accent-foreground', '--accent'],
  ['--sidebar-accent-foreground', '--sidebar-accent'],
  ['--sidebar-foreground', '--sidebar'],
  ['--sidebar-muted-foreground', '--sidebar'],
  ['--status-neutral-foreground', '--status-neutral'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],
  ['--destructive-surface-foreground', '--destructive-surface'],
  ['--status-info-foreground', '--status-info'],
  ['--color-ink', '--table-row-hover'],
  ['--table-row-selected-foreground', '--table-row-selected'],
  ['--destructive-foreground', '--destructive'],
  ['--chart-axis', '--card'],
  ['--chart-tooltip-foreground', '--chart-tooltip'],
] as const

describe('app semantic color tokens', () => {
  it.each([
    'focus-ring',
    'focus-halo',
    'sidebar',
    'sidebar-foreground',
    'sidebar-muted-foreground',
    'sidebar-accent',
    'sidebar-accent-foreground',
    'sidebar-border',
    'sidebar-ring',
    'table-header',
    'table-row-hover',
    'table-row-selected',
    'table-row-selected-foreground',
    'table-divider',
    'status-neutral',
    'status-neutral-foreground',
    'status-neutral-border',
    'status-info',
    'status-info-foreground',
    'status-info-border',
    'success',
    'success-foreground',
    'success-border',
    'warning',
    'warning-foreground',
    'warning-border',
    'destructive-foreground',
    'destructive-surface',
    'destructive-surface-foreground',
    'destructive-border',
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
    'chart-6',
    'chart-grid',
    'chart-axis',
    'chart-tooltip',
    'chart-tooltip-foreground',
  ])('maps %s through the Tailwind color namespace', (name) => {
    expect(declarations.get(`--color-${name}`)).toBe(`var(--${name})`)
  })

  it.each(normalTextPairs)(
    '%s on %s meets WCAG 2.2 AA for normal text',
    (foreground, background) => {
      const ratio = contrast(resolveToken(foreground), resolveToken(background))
      expect(ratio, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'])(
    '%s has a 3:1 non-text edge against the chart surface',
    (mark) => {
      const ratio = contrast(resolveToken(mark), resolveToken('--card'))
      expect(ratio, `${mark} on --card: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    },
  )

  it('uses the darker focus ring for thin indicators', () => {
    expect(contrast(resolveToken('--focus-ring'), resolveToken('--card'))).toBeGreaterThanOrEqual(3)
    expect(contrast(resolveToken('--focus-ring'), resolveToken('--color-paper'))).toBeGreaterThanOrEqual(3)
    expect(contrast(resolveToken('--color-baltic'), resolveToken('--card'))).toBeLessThan(3)
  })

  it('keeps white-on-hover surfaces at AA contrast', () => {
    expect(contrast('#ffffff', resolveToken('--color-navy'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ffffff', resolveToken('--color-baltic'))).toBeLessThan(4.5)
  })

  it('leaves no hover:bg-baltic hover state anywhere in src/', () => {
    const offenders: string[] = []
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name)
        if (entry.isDirectory()) {
          visit(path)
        } else if (/\.(tsx?|css)$/.test(entry.name) && readFileSync(path, 'utf8').includes('hover:bg-baltic')) {
          offenders.push(relative(process.cwd(), path))
        }
      }
    }
    visit(resolve(process.cwd(), 'src'))

    expect(offenders, `hover:bg-baltic fails AA for white text (3.34:1); found in: ${offenders.join(', ')}`).toEqual([])
  })
})