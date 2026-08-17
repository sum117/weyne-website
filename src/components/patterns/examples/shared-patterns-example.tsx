import { useState } from 'react'
import {
  ServerDataTableExample,
  type ServerDataTableExampleState,
} from '@/components/data-table/examples/server-data-table-example'
import type { DataTableUrlNavigate } from '@/components/data-table/data-table-url-state'
import {
  CustomerFormExample,
  type CustomerFormExampleValues,
} from '@/components/forms/examples/customer-form-example'
import { PageHeader } from '@/components/patterns/page-header'
import { PresentationPatternsExample } from '@/components/patterns/examples/presentation-patterns-example'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AppQueryProvider } from '@/lib/query/app-query-provider'

export type SharedPatternsExampleProps = {
  search: Record<string, unknown>
  navigate: DataTableUrlNavigate
  onSubmit: (values: CustomerFormExampleValues) => void | Promise<void>
}

const tableStates: Array<{
  state: ServerDataTableExampleState
  label: string
}> = [
  { state: 'ready', label: 'Mostrar dados' },
  { state: 'loading', label: 'Mostrar carregamento' },
  { state: 'empty', label: 'Mostrar vazio' },
  { state: 'error', label: 'Mostrar erro' },
]

/**
 * Discoverable, feature-free catalogue of the shared authenticated-app patterns.
 * AppQueryProvider intentionally lives here so the copyable boundary is visible.
 */
export function SharedPatternsExample({
  search,
  navigate,
  onSubmit,
}: SharedPatternsExampleProps) {
  const [tableState, setTableState] =
    useState<ServerDataTableExampleState>('ready')

  return (
    <AppQueryProvider>
      <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-[96rem] gap-8">
          <PageHeader
            breadcrumbs={[
              { label: 'Área de gestão', href: '/app' },
              { label: 'Padrões compartilhados' },
            ]}
            eyebrow="Catálogo para implementação"
            title="Padrões compartilhados do app"
            description="Exemplos independentes de módulos de negócio, prontos para copiar e adaptar."
          />

          <section aria-labelledby="table-pattern-title" className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h2 id="table-pattern-title" className="text-lg font-semibold">
                  Tabela orientada pelo servidor
                </h2>
                <p className="text-sm text-muted-foreground">
                  Paginação, ordenação e facetas atualizam a URL; os controles
                  abaixo expõem todos os estados de requisição.
                </p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Estados da tabela">
                {tableStates.map(({ state, label }) => (
                  <Button
                    key={state}
                    type="button"
                    size="sm"
                    variant={tableState === state ? 'primary' : 'outline'}
                    aria-pressed={tableState === state}
                    onClick={() => setTableState(state)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <ServerDataTableExample
              search={search}
              navigate={navigate}
              state={tableState}
            />
          </section>

          <section aria-labelledby="form-pattern-title" className="grid gap-4">
            <div className="space-y-1">
              <h2 id="form-pattern-title" className="text-lg font-semibold">
                Formulário validado
              </h2>
              <p className="text-sm text-muted-foreground">
                TanStack Form e Zod com resumo navegável, combobox nativo e
                entradas brasileiras com valor de domínio separado.
              </p>
            </div>
            <Card className="max-w-[60rem]">
              <CardHeader>
                <CardTitle>Cadastro de cliente</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomerFormExample onSubmit={onSubmit} />
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="presentation-pattern-title" className="grid gap-4">
            <div className="space-y-1">
              <h2
                id="presentation-pattern-title"
                className="text-lg font-semibold"
              >
                Confirmação, status e skeletons
              </h2>
              <p className="text-sm text-muted-foreground">
                Feedback semântico, foco seguro e carregamento com geometria
                representativa.
              </p>
            </div>
            <PresentationPatternsExample />
          </section>
        </div>
      </main>
    </AppQueryProvider>
  )
}
