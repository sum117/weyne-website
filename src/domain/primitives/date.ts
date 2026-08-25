import { z } from 'zod'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false

  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  )
}

/** Calendar date without a time zone, persisted as YYYY-MM-DD. */
export const dateSchema = z
  .string()
  .refine(isRealIsoDate, 'Informe uma data válida no formato AAAA-MM-DD')

export type DateString = z.infer<typeof dateSchema>

/** Parses the exact pt-BR display format DD/MM/YYYY into a canonical date. */
export function parseDatePtBr(value: string): DateString {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    throw new Error('Informe uma data válida no formato DD/MM/AAAA')
  }

  const canonical = `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}`
  const result = dateSchema.safeParse(canonical)

  if (!result.success) {
    throw new Error('Informe uma data válida no formato DD/MM/AAAA')
  }

  return result.data
}

/** Formats a canonical domain date for pt-BR display. */
export function formatDatePtBr(value: DateString): string {
  const canonical = dateSchema.parse(value)
  return `${canonical.slice(8, 10)}/${canonical.slice(5, 7)}/${canonical.slice(0, 4)}`
}
