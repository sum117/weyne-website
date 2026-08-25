import type { z } from 'zod'
import {
  failure,
  success,
  validationFailure,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'

type ValidationError = Extract<ApplicationError, { category: 'validation' }>

export type KeysetCursorCodec<T> = Readonly<{
  encode: (value: T) => string
  decode: (cursor: string) => Result<T, ValidationError>
}>

export function createKeysetCursorCodec<TSchema extends z.ZodType>(
  schema: TSchema,
): KeysetCursorCodec<z.output<TSchema>> {
  return {
    encode(value) {
      const parsed = schema.parse(value)
      return Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')
    },
    decode(cursor) {
      try {
        const decoded: unknown = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        )
        const parsed = schema.safeParse(decoded)

        if (parsed.success) {
          return success(parsed.data)
        }
      } catch {
        // Deliberately collapse decoding and schema failures into one safe issue.
      }

      return failure(
        validationFailure([
          { path: ['cursor'], message: 'Invalid cursor.' },
        ]),
      )
    },
  }
}
