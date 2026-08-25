import { describe, expect, it } from 'vitest'
import {
  REDACTED,
  describeCause,
  isSensitiveKey,
  logStructuredEvent,
  logUnexpectedError,
  redactSensitiveText,
  redactValue,
} from '@/lib/server/log-redaction'

describe('redactSensitiveText', () => {
  it('redacts database URLs with credentials but keeps placeholder passwords', () => {
    expect(
      redactSensitiveText(
        'connect ECONNREFUSED postgresql://weyne_app:S3cret!Pass@10.0.0.8:5432/weyne',
      ),
    ).toBe(`connect ECONNREFUSED postgresql://[REDACTED_USER]${REDACTED}@`)

    const placeholder = redactSensitiveText(
      'postgresql://header-check:***@127.0.0.1:1/header_check',
    )
    expect(placeholder).toBe('postgresql://header-check:***@127.0.0.1:1/header_check')
  })

  it('redacts bearer tokens, JWTs, headers, and signed-URL query secrets', () => {
    const text = redactSensitiveText(
      [
        'GET /x Authorization: Bearer abc.def.ghi failed',
        'X-Amz-Signature=9f2c1a & ok',
        '?token=abcdef123456 rest',
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4 payload',
      ].join('\n'),
      4096,
    )
    expect(text).toContain(`Authorization: ${REDACTED}`)
    expect(text).toContain(`X-Amz-Signature=${REDACTED}`)
    expect(text).toContain(`?token=${REDACTED}`)
    expect(text).toContain(`jwt ${REDACTED} payload`)
    expect(text).not.toContain('SflKxwRJSMeKKF2QT4')
    expect(text.toLowerCase()).not.toContain('abc.def.ghi')
  })

  it('truncates long text with an ellipsis marker', () => {
    const long = 'a'.repeat(2000)
    const result = redactSensitiveText(long, 256)
    expect(result.startsWith('a'.repeat(256))).toBe(true)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(257)
  })
})

describe('redactValue', () => {
  it('drops values under sensitive keys and scrubs strings recursively', () => {
    const input = {
      orderId: 'ord_123',
      customerEmail: 'real.person@example.com',
      nested: { authorization: 'Bearer secret-token', status: 'ok' },
      freeText: 'see postgres://svc:RealPass@db:5432/weyne for details',
    }
    const output = redactValue(input) as Record<string, unknown>
    expect(output.orderId).toBe('ord_123')
    expect(output.customerEmail).toBe(REDACTED)
    const nested = output.nested as Record<string, unknown>
    expect(nested.authorization).toBe(REDACTED)
    expect(nested.status).toBe('ok')
    expect(output.freeText).not.toContain('RealPass')
  })
})

describe('isSensitiveKey', () => {
  it('matches credential and personal-data keys without matching safe ones', () => {
    expect(isSensitiveKey('sessionCookie')).toBe(true)
    expect(isSensitiveKey('CNPJ')).toBe(true)
    expect(isSensitiveKey('creditLimitCents')).toBe(true)
    expect(isSensitiveKey('orderId')).toBe(false)
    expect(isSensitiveKey('occurredAt')).toBe(false)
  })
})

describe('describeCause', () => {
  it('summarizes errors with a redacted message', () => {
    const summary = describeCause(
      new Error('failed for postgres://app:hunter2@db:5432/weyne'),
    ) as { name: string; message: string }
    expect(summary.name).toBe('Error')
    expect(summary.message).not.toContain('hunter2')
    expect(summary.message).toContain('[REDACTED_USER]')
  })

  it('passes through non-error scalars via bounded redaction', () => {
    expect(describeCause(42)).toBe(42)
    expect(describeCause(null)).toBe(null)
  })
})

describe('structured logging emitters', () => {
  it('emits one JSON line per error with scope and redacted context', () => {
    const lines: string[] = []
    const original = console.error
    console.error = (line: unknown) => {
      lines.push(String(line))
    }
    try {
      logUnexpectedError('quote.pdf', new Error('boom'), { quoteId: 'q_1' })
    } finally {
      console.error = original
    }
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBeDefined()
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed.kind).toBe('error')
    expect(parsed.scope).toBe('quote.pdf')
    expect(parsed.quoteId).toBe('q_1')
    expect(parsed.timestamp).toEqual(expect.any(String))
  })

  it('emits single-line info events', () => {
    const lines: string[] = []
    const original = console.info
    console.info = (line: unknown) => {
      lines.push(String(line))
    }
    try {
      logStructuredEvent({ kind: 'audit', action: 'export', actorId: 'u1' })
    } finally {
      console.info = original
    }
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBeDefined()
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed.action).toBe('export')
    expect(parsed.actorId).toBe('u1')
  })
})
