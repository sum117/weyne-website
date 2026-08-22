import { describe, expect, it } from 'vitest'
import { containsPattern, escapeLikePattern } from '@/lib/server/sql-pattern'

describe('LIKE pattern escaping', () => {
  it('escapes every PostgreSQL LIKE metacharacter', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_c')).toBe('a\\_c')
    expect(escapeLikePattern('c:\\path')).toBe('c:\\\\path')
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeLikePattern('Contrato padrao')).toBe('Contrato padrao')
    expect(escapeLikePattern('')).toBe('')
  })

  it('wraps an escaped value in contains wildcards', () => {
    expect(containsPattern('100%')).toBe('%100\\%%')
    expect(containsPattern('abc')).toBe('%abc%')
  })

  it('never lets a caller-supplied value contribute an unescaped wildcard', () => {
    const inner = containsPattern('%%__%%').slice(1, -1)

    expect(inner).toBe('\\%\\%\\_\\_\\%\\%')
    // Removing every escaped pair leaves no bare metacharacter behind.
    expect(inner.replaceAll(/\\./g, '')).toBe('')
  })
})
