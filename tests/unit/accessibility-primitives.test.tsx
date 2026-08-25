/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ErrorSummary } from '@/components/forms/form-field'
import { ChartContainer } from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody } from '@/components/ui/table'

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    disconnect() {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: {
              width: 320,
              height: 200,
              top: 0,
              right: 320,
              bottom: 200,
              left: 0,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
          } as ResizeObserverEntry,
        ],
        this,
      )
    }
    unobserve() {}
  }
  globalThis.ResizeObserver = TestResizeObserver
})

afterEach(cleanup)

describe('shared accessibility primitives', () => {
  it('uses the high-contrast semantic token for the global focus indicator', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8')
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--focus-ring\)/)
  })

  it('provides minimum targets for compact binary controls', () => {
    render(<><Checkbox aria-label="Selecionar registro" /><Switch aria-label="Ativar registro" /></>)
    expect(screen.getByRole('checkbox')).toHaveClass('size-6')
    expect(screen.getByRole('switch')).toHaveClass('h-6', 'w-11')
  })

  it('gives the sheet close action a named 44px target', () => {
    render(<Sheet defaultOpen><SheetContent><SheetTitle>Filtros</SheetTitle><SheetDescription>Refine os resultados.</SheetDescription></SheetContent></Sheet>)
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveClass('size-11')
  })

  it('makes overflowing tables keyboard-scrollable without losing the table name', () => {
    render(<Table aria-label="Pessoas"><TableBody /></Table>)
    expect(screen.getByRole('region', { name: 'Área rolável: Pessoas' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table', { name: 'Pessoas' })).toBeInTheDocument()
  })

  it('exposes chart title and summary independently from visual marks', () => {
    render(<ChartContainer config={{ revenue: { label: 'Receita' } }} accessibilityLabel="Receita mensal" accessibilityDescription="A receita cresceu 12% no período."><div /></ChartContainer>)
    expect(screen.getByRole('figure', { name: 'Receita mensal' })).toHaveAccessibleDescription('A receita cresceu 12% no período.')
  })

  it('keeps error summaries hook-safe and avoids smooth scrolling for reduced motion', () => {
    const scrollIntoView = HTMLElement.prototype.scrollIntoView
    const matchMedia = window.matchMedia
    const scrollCalls: ScrollIntoViewOptions[] = []
    HTMLElement.prototype.scrollIntoView = (options) => {
      scrollCalls.push(options as ScrollIntoViewOptions)
    }
    window.matchMedia = () => ({ matches: true }) as MediaQueryList

    const { rerender } = render(
      <>
        <input id="legalName" />
        <ErrorSummary errors={[]} />
      </>,
    )
    rerender(
      <>
        <input id="legalName" />
        <ErrorSummary
          errors={[
            {
              fieldId: 'legalName',
              label: 'Razão social',
              message: 'Campo obrigatório',
            },
          ]}
        />
      </>,
    )
    screen.getByRole('link', { name: /Razão social/ }).click()

    expect(scrollCalls).toEqual([{ block: 'center', behavior: 'auto' }])
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    window.matchMedia = matchMedia
  })
})
