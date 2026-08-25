import { z } from 'zod'

export const DEFAULT_COLLECTION_LIMIT = 25
export const MAX_COLLECTION_LIMIT = 100

export const COLLECTION_FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'in',
  'gte',
  'lte',
  'isNull',
] as const

export const sortDirectionSchema = z.enum(['asc', 'desc'], {
  error: 'Informe uma direção de ordenação válida',
})

export type SortDirection = z.output<typeof sortDirectionSchema>
export type CollectionFilterOperator = (typeof COLLECTION_FILTER_OPERATORS)[number]

const filterTextSchema = z
  .string({ error: 'Informe um valor de filtro válido' })
  .trim()
  .min(1, 'O valor do filtro não pode ficar vazio')

const collectionLimitSchema = z.coerce
  .number({ error: 'Informe um limite de resultados válido' })
  .int('O limite de resultados deve ser um número inteiro')
  .min(1, 'O limite de resultados deve ser no mínimo 1')
  .max(
    MAX_COLLECTION_LIMIT,
    `O limite de resultados deve ser no máximo ${MAX_COLLECTION_LIMIT}`,
  )
  .default(DEFAULT_COLLECTION_LIMIT)

const collectionCursorSchema = z
  .string({ error: 'Informe um cursor válido' })
  .trim()
  .min(1, 'O cursor não pode ficar vazio')
  .max(512, 'O cursor deve ter no máximo 512 caracteres')

export type CollectionSchemaOptions<
  TFilterFields extends readonly [string, ...string[]],
  TSortFields extends readonly [string, ...string[]],
> = Readonly<{
  filterFields: TFilterFields
  sortFields: TSortFields
  defaultSortField: TSortFields[number]
  defaultSortDirection?: SortDirection
}>

function uniqueInFirstSeenOrder<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values))
}

function uniqueFiltersInFirstSeenOrder<T>(filters: readonly T[]): T[] {
  const seen = new Set<string>()
  return filters.filter((filter) => {
    const key = JSON.stringify(filter)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Builds a transport-only collection contract. Authorization and projection
 * remain mandatory service concerns and must be applied before querying data.
 */
export function createCollectionInputSchema<
  const TFilterFields extends readonly [string, ...string[]],
  const TSortFields extends readonly [string, ...string[]],
>(options: CollectionSchemaOptions<TFilterFields, TSortFields>) {
  const filterFieldSchema = z.enum(options.filterFields, {
    error: 'Informe um campo de filtro permitido',
  })
  const sortFieldSchema = z.enum(options.sortFields, {
    error: 'Informe um campo de ordenação permitido',
  })

  const scalarFilter = (operator: 'eq' | 'neq' | 'contains' | 'gte' | 'lte') =>
    z.strictObject(
      {
        field: filterFieldSchema,
        operator: z.literal(operator),
        value: filterTextSchema,
      },
      { error: 'O filtro contém campos não permitidos' },
    )

  const filterSchema = z.discriminatedUnion(
    'operator',
    [
      scalarFilter('eq'),
      scalarFilter('neq'),
      scalarFilter('contains'),
      z.strictObject(
        {
          field: filterFieldSchema,
          operator: z.literal('in'),
          value: z
            .array(filterTextSchema, {
              error: 'Informe uma lista de valores de filtro válida',
            })
            .min(1, 'Informe ao menos um valor para o filtro')
            .transform(uniqueInFirstSeenOrder),
        },
        { error: 'O filtro contém campos não permitidos' },
      ),
      scalarFilter('gte'),
      scalarFilter('lte'),
      z.strictObject(
        {
          field: filterFieldSchema,
          operator: z.literal('isNull'),
          value: z.boolean({ error: 'Informe verdadeiro ou falso para o filtro' }),
        },
        { error: 'O filtro contém campos não permitidos' },
      ),
    ],
    { error: 'Informe um operador de filtro válido' },
  )

  const sortSchema = z.strictObject(
    {
      field: sortFieldSchema,
      direction: sortDirectionSchema,
    },
    { error: 'Informe uma ordenação válida e sem campos adicionais' },
  )

  return z.strictObject(
    {
      cursor: collectionCursorSchema.optional(),
      limit: collectionLimitSchema,
      filters: z
        .array(filterSchema, { error: 'Informe filtros válidos' })
        .default([])
        .transform(uniqueFiltersInFirstSeenOrder),
      sort: sortSchema.optional().transform(
        (sort) =>
          sort ?? {
            field: options.defaultSortField,
            direction: options.defaultSortDirection ?? 'asc',
          },
      ),
    },
    { error: 'A consulta contém campos não permitidos' },
  )
}

export type CollectionInput<TSchema extends z.ZodType> = z.input<TSchema>
export type CollectionQuery<TSchema extends z.ZodType> = z.output<TSchema>
