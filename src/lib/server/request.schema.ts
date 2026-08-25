import { z } from 'zod'
import {
  failure,
  success,
  validationFailure,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export const entityIdSchema = z.uuid()
export const entityIdRequestSchema = z.strictObject({ id: entityIdSchema })
export const cursorSchema = z.string().trim().min(1).max(512)
export const sortDirectionSchema = z.enum(['asc', 'desc'])

export const cursorPaginationSchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
})

export type CursorPaginationInput = z.input<typeof cursorPaginationSchema>
export type CursorPagination = z.output<typeof cursorPaginationSchema>
export type SortDirection = z.output<typeof sortDirectionSchema>
export type AllowlistedField<TFields extends readonly string[]> = TFields[number]

type ListSchemaOptions<
  TFilters extends z.ZodRawShape,
  TSortFields extends readonly [string, ...string[]],
> = Readonly<{
  filters: TFilters
  sortFields: TSortFields
  defaultSort: TSortFields[number]
  defaultDirection?: SortDirection
}>

export function createListRequestSchema<
  const TFilters extends z.ZodRawShape,
  const TSortFields extends readonly [string, ...string[]],
>(options: ListSchemaOptions<TFilters, TSortFields>) {
  return z.strictObject({
    cursor: cursorSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    filters: z
      .strictObject(options.filters)
      .partial()
      .optional()
      .transform((filters) => filters ?? {}),
    sortBy: z.enum(options.sortFields).default(options.defaultSort),
    sortDirection: sortDirectionSchema.default(
      options.defaultDirection ?? 'asc',
    ),
  })
}

type ValidationError = Extract<ApplicationError, { category: 'validation' }>

export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): Result<z.output<TSchema>, ValidationError> {
  const parsed = schema.safeParse(input)

  if (parsed.success) {
    return success(parsed.data)
  }

  return failure(
    validationFailure(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) =>
          typeof segment === 'symbol'
            ? (segment.description ?? 'symbol')
            : segment,
        ),
        message: issue.message,
      })),
    ),
  )
}
