import { Check, Trash } from '@phosphor-icons/react/dist/ssr'
import { ConfirmationDialog } from '@/components/patterns/confirmation-dialog'
import { DataTableSkeleton } from '@/components/patterns/loading-skeletons'
import { StatusBadge } from '@/components/patterns/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Feature-free examples for feedback, status, and loading compositions. */
export function PresentationPatternsExample() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Estados semânticos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <StatusBadge status="neutral">Rascunho</StatusBadge>
          <StatusBadge status="info">Em andamento</StatusBadge>
          <StatusBadge status="warning">Atenção</StatusBadge>
          <StatusBadge status="success" icon={<Check weight="light" />}>
            Ativo
          </StatusBadge>
          <StatusBadge status="destructive">Falhou</StatusBadge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Confirmação segura</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfirmationDialog
            trigger={
              <Button size="default" variant="destructive">
                <Trash aria-hidden="true" weight="light" />
                Excluir exemplo
              </Button>
            }
            title="Excluir exemplo?"
            description="Este registro de demonstração será removido."
            confirmLabel="Excluir exemplo"
            pendingLabel="Excluindo…"
            onConfirm={() => Promise.resolve()}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Carregamento estrutural</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTableSkeleton
            label="Carregando tabela de exemplo"
            rowCount={3}
          />
        </CardContent>
      </Card>
    </div>
  )
}
