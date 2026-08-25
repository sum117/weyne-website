// @vitest-environment jsdom

import * as React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge, badgeVariants } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'

const h = React.createElement

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  }
  globalThis.ResizeObserver = TestResizeObserver
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(cleanup)

describe('authenticated app primitive contracts', () => {
  it('extends Button without removing the landing variants', () => {
    for (const variant of [
      'primary',
      'inverse',
      'sand',
      'secondary',
      'outline',
      'ghost',
      'destructive',
    ] as const) {
      expect(buttonVariants({ variant })).toContain('focus-visible:')
    }

    for (const size of [
      'pill',
      'pillLg',
      'submit',
      'sm',
      'default',
      'lg',
      'icon',
    ] as const) {
      expect(buttonVariants({ size })).toBeTruthy()
    }

    render(
      h(
        Button,
        { disabled: true, 'aria-busy': true },
        'Salvando',
      ),
    )
    expect(screen.getByRole('button', { name: 'Salvando' })).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('exposes every fixed semantic badge state', () => {
    for (const [variant, token] of [
      ['neutral', 'status-neutral'],
      ['info', 'status-info'],
      ['warning', 'bg-warning'],
      ['success', 'bg-success'],
      ['destructive', 'destructive-surface'],
    ] as const) {
      expect(badgeVariants({ variant })).toContain(token)
    }

    render(h(Badge, { variant: 'warning' }, 'Atenção'))
    expect(screen.getByText('Atenção')).toHaveAttribute('data-slot', 'badge')
  })

  it('renders persistent feedback with an announced status', () => {
    render(
      h(
        Alert,
        { variant: 'success' },
        h(AlertTitle, null, 'Concluído'),
        h(AlertDescription, null, 'Registro salvo.'),
      ),
    )

    expect(screen.getByRole('status')).toHaveAttribute(
      'data-variant',
      'success',
    )
    expect(screen.getByText('Registro salvo.')).toBeVisible()
  })

  it('preserves selected and disabled Radix state semantics', () => {
    render(
      h(
        Tabs,
        { defaultValue: 'all' },
        h(
          TabsList,
          null,
          h(TabsTrigger, { value: 'all' }, 'Todos'),
          h(TabsTrigger, { value: 'blocked', disabled: true }, 'Bloqueados'),
        ),
      ),
    )

    expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Bloqueados' })).toBeDisabled()
  })

  it('preserves checked and disabled Radix control semantics', () => {
    render(
      h(
        React.Fragment,
        null,
        h(Checkbox, { 'aria-label': 'Selecionar', checked: true }),
        h(Switch, { 'aria-label': 'Ativar', disabled: true }),
      ),
    )

    expect(screen.getByRole('checkbox', { name: 'Selecionar' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Ativar' })).toBeDisabled()
  })

  it('provides stable loading and complete card anatomy', () => {
    render(
      h(
        Card,
        { 'aria-busy': true },
        h(
          CardHeader,
          null,
          h(CardTitle, null, 'Pedidos'),
          h(CardDescription, null, 'Resumo do período'),
          h(CardAction, null, h(Button, { size: 'icon', 'aria-label': 'Abrir' })),
        ),
        h(CardContent, null, h(Skeleton, { 'aria-label': 'Carregando' })),
        h(CardFooter, null, 'Atualizando'),
      ),
    )

    expect(screen.getByText('Pedidos').closest('[data-slot="card"]')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByLabelText('Carregando')).toHaveAttribute(
      'data-slot',
      'skeleton',
    )
  })

  it('keeps destructive confirmation errors inside the trapped dialog', () => {
    render(
      h(
        AlertDialog,
        { defaultOpen: true },
        h(
          AlertDialogContent,
          null,
          h(
            AlertDialogHeader,
            null,
            h(AlertDialogTitle, null, 'Excluir cliente?'),
            h(AlertDialogDescription, null, 'Esta ação não pode ser desfeita.'),
          ),
          h('p', { role: 'alert' }, 'Não foi possível excluir.'),
          h(
            AlertDialogFooter,
            null,
            h(AlertDialogCancel, null, 'Cancelar'),
            h(AlertDialogAction, { disabled: true }, 'Excluindo'),
          ),
        ),
      ),
    )

    expect(screen.getByRole('alertdialog')).toHaveClass('z-overlay')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Excluindo' })).toBeDisabled()
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('represents command empty, selected, disabled, and loading content', () => {
    render(
      h(
        Command,
        { 'aria-busy': true },
        h(CommandInput, { 'aria-label': 'Buscar cliente' }),
        h(
          CommandList,
          null,
          h(CommandEmpty, null, 'Nenhum cliente encontrado.'),
          h(CommandItem, { value: 'acme' }, 'Acme'),
          h(CommandItem, { value: 'blocked', disabled: true }, 'Bloqueado'),
        ),
      ),
    )

    expect(screen.getByLabelText('Buscar cliente')).toBeEnabled()
    expect(screen.getByText('Bloqueado')).toHaveAttribute('data-disabled', 'true')
    expect(screen.getByText('Acme')).toHaveAttribute('data-selected')
  })

  it('exposes collapsed, active, disabled, and keyboard-toggle sidebar states', () => {
    render(
      h(
        SidebarProvider,
        { defaultOpen: false },
        h(SidebarTrigger, null),
        h(
          Sidebar,
          { collapsible: 'icon' },
          h(
            SidebarContent,
            null,
            h(
              SidebarMenu,
              null,
              h(
                SidebarMenuItem,
                null,
                h(SidebarMenuButton, { isActive: true }, 'Dashboard'),
              ),
              h(
                SidebarMenuItem,
                null,
                h(SidebarMenuButton, { disabled: true }, 'Restrito'),
              ),
            ),
          ),
        ),
      ),
    )

    expect(screen.getByText('Dashboard')).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Restrito' })).toBeDisabled()
    expect(screen.getByTestId('sidebar-root')).toHaveAttribute(
      'data-state',
      'collapsed',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Alternar barra lateral' }))
    expect(screen.getByTestId('sidebar-root')).toHaveAttribute(
      'data-state',
      'expanded',
    )
  })
})
