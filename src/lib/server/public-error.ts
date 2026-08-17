import { type ApplicationError, type Result } from '@/lib/domain/result'

export type PublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      message: 'Request validation failed.'
      issues: readonly Readonly<{
        path: readonly (string | number)[]
        message: string
      }>[]
    }>
  | Readonly<{
      code: 'NOT_FOUND'
      status: 404
      message: 'Resource not found.'
    }>
  | Readonly<{
      code: 'CONFLICT'
      status: 409
      message: 'Request conflicts with the current resource state.'
    }>
  | Readonly<{
      code: 'INTERNAL_ERROR'
      status: 500
      message: 'An unexpected server error occurred.'
    }>

export type PublicResult<T> = Result<T, PublicError>

export function toPublicResult<T>(
  result: Result<T, ApplicationError>,
): PublicResult<T> {
  if (result.ok) {
    return result
  }

  return { ok: false, error: toPublicError(result.error) }
}

export function toPublicError(error: ApplicationError): PublicError {
  switch (error.category) {
    case 'validation':
      return {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Request validation failed.',
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      }
    case 'not-found':
      return {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Resource not found.',
      }
    case 'conflict':
      return {
        code: 'CONFLICT',
        status: 409,
        message: 'Request conflicts with the current resource state.',
      }
    case 'unexpected':
      return {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'An unexpected server error occurred.',
      }
  }
}
