import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

export type SalesRow = {
  id: string
  customer: string
  total: number
}

const features = tableFeatures({})
const columnHelper = createColumnHelper<typeof features, SalesRow>()
const columns = columnHelper.columns([
  columnHelper.accessor('customer', { header: 'Cliente' }),
  columnHelper.accessor('total', { header: 'Total' }),
])
const chartConfig = {
  total: { label: 'Total', color: '#1364A3' },
} satisfies ChartConfig

export function DependencyStackExample({
  loadRows,
}: {
  loadRows: () => Promise<SalesRow[]>
}) {
  const query = useQuery({
    queryKey: ['architecture-spike', 'sales'],
    queryFn: loadRows,
  })
  const table = useTable({
    features,
    columns,
    data: query.data ?? [],
  })

  useEffect(() => {
    document.documentElement.dataset.dependencyStackHydrated = 'true'
  }, [])

  if (query.isPending) return <p role="status">Carregando…</p>
  if (query.isError) return <p role="alert">Falha ao carregar.</p>

  return (
    <section aria-label="Compatibility spike">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ChartContainer
        aria-label="Sales chart"
        className="h-64 w-full"
        config={chartConfig}
      >
        <BarChart accessibilityLayer data={query.data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="customer" />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="total" fill="var(--color-total)" radius={4} />
        </BarChart>
      </ChartContainer>
    </section>
  )
}
