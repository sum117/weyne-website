import { z } from 'zod'

const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d+(?:\.\d+)?$/, 'Invalid decimal value')

export type SerializedDecimal = string
export type SerializedDate = string

/**
 * Converts Drizzle/PostgreSQL numeric output into a JSON-safe exact string.
 * Call this from an explicit repository/domain-to-DTO mapper, never by
 * returning the database row itself.
 */
export function serializeDecimal(value: string): SerializedDecimal {
  return decimalStringSchema.parse(value)
}

export function serializeDate(value: Date): SerializedDate {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Invalid date')
  }

  return value.toISOString()
}

export function serializeNullableDate(
  value: Date | null,
): SerializedDate | null {
  return value === null ? null : serializeDate(value)
}
