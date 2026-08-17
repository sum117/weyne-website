export type ValidationIssue = Readonly<{
  path: readonly (string | number)[]
  message: string
}>

export type ApplicationError =
  | Readonly<{
      category: 'validation'
      issues: readonly ValidationIssue[]
    }>
  | Readonly<{ category: 'not-found' }>
  | Readonly<{ category: 'conflict' }>
  | Readonly<{
      category: 'unexpected'
      cause: unknown
    }>

export type Result<T, E = ApplicationError> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: E }>

export function success<T>(data: T): Result<T, never> {
  return { ok: true, data }
}

export function failure<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function validationFailure(
  issues: readonly ValidationIssue[],
): Extract<ApplicationError, { category: 'validation' }> {
  return { category: 'validation', issues }
}

export function notFound(): Extract<
  ApplicationError,
  { category: 'not-found' }
> {
  return { category: 'not-found' }
}

export function conflict(): Extract<
  ApplicationError,
  { category: 'conflict' }
> {
  return { category: 'conflict' }
}

export function unexpected(
  cause: unknown,
): Extract<ApplicationError, { category: 'unexpected' }> {
  return { category: 'unexpected', cause }
}
