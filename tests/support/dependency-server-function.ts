import { createServerFn } from '@tanstack/react-start'
import type { SalesRow } from './dependency-stack-example'

export const loadSalesRows = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SalesRow[]> => [
    { id: 'sale-1', customer: 'Mercado Sol', total: 1250 },
    { id: 'sale-2', customer: 'Hotel Mar', total: 980 },
  ],
)

const _queryFunctionContract: () => Promise<SalesRow[]> = loadSalesRows
void _queryFunctionContract
