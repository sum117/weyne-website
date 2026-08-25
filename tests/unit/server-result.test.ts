import { describe, expect, it } from 'vitest'
import {
  conflict,
  failure,
  notFound,
  success,
  unexpected,
  validationFailure,
} from '@/lib/domain/result'
import { toPublicResult } from '@/lib/server/public-error'

describe('typed result and public error mapping', () => {
  it('preserves successful values in the public result model', () => {
    expect(toPublicResult(success({ id: 'entity-1' }))).toEqual({
      ok: true,
      data: { id: 'entity-1' },
    })
  })

  it.each([
    [validationFailure([{ path: ['name'], message: 'Name is required' }]), 400, 'VALIDATION_FAILED'],
    [notFound(), 404, 'NOT_FOUND'],
    [conflict(), 409, 'CONFLICT'],
  ] as const)('maps %s to a stable public error', (error, status, code) => {
    const result = toPublicResult(failure(error))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(status)
      expect(result.error.code).toBe(code)
    }
  })

  it('retains only safe validation issue fields', () => {
    expect(
      toPublicResult(
        failure(
          validationFailure([
            { path: ['items', 0, 'name'], message: 'Name is required' },
          ]),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Request validation failed.',
        issues: [
          { path: ['items', 0, 'name'], message: 'Name is required' },
        ],
      },
    })
  })

  it('sanitizes unexpected failures without exposing internal details', () => {
    const internal = new Error(
      'SQLSTATE 42P01: relation t_c81a3b6b.documents does not exist',
    )
    internal.stack = 'Error: secret\n at src/lib/db/schema.server.ts:42:7'

    const publicResult = toPublicResult(failure(unexpected(internal)))
    const serialized = JSON.stringify(publicResult)

    expect(publicResult).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'An unexpected server error occurred.',
      },
    })
    expect(serialized).not.toContain('SQLSTATE')
    expect(serialized).not.toContain('t_c81a3b6b')
    expect(serialized).not.toContain('schema.server.ts')
    expect(serialized).not.toContain('secret')
  })
})
