// Privacy-safe logging primitives (threat model T10/T11, LGPD D02/D07/D08).
//
// Every server-side log line must flow through this module: single-line JSON,
// an explicit field allowlist at each call site, and pattern/key based
// redaction as the second line of defense. Raw errors, headers, cookies,
// tokens, signed URLs, and free-form payloads never reach the console.

export const REDACTED = '[REDACTED]'

// Ambient correlation scope; see log-context.server.ts. This module is
// server-only by convention, so a direct import is safe here.
import { currentRequestId } from './log-context.server'

const MAX_TEXT_LENGTH = 1024
const MAX_VALUE_DEPTH = 6
const MAX_OBJECT_FIELDS = 50
const MAX_ARRAY_ITEMS = 20

/**
 * Keys whose values must never appear in logs, exports, or audit summaries.
 * Shared with the audit projection in `activity.server.ts`.
 */
export const SENSITIVE_KEY_PATTERN =
  /(?:password|passcode|secret|token|credential|authorization|cookie|session|hash|salt|private.?key|api.?key|auth.?subject|mfa|otp|email|phone|whatsapp|tax.?id|cnpj|cpf|state.?registration|address|postal.?code|cep|contact.?name|notes?|credit.?limit|bank|account|document)/i

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

type ReplacementRule = Readonly<{
  id: string
  pattern: RegExp
}>

// Order matters: structural blocks first, then credential-bearing URLs, then
// header/query-value scrubs. Each rule replaces only the secret-bearing span.
const TEXT_REDACTION_RULES: readonly ReplacementRule[] = [
  {
    id: 'private_key',
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
  },
  {
    id: 'credential_url',
    // Connection URLs carrying a userinfo password. Placeholder passwords
    // used by local tooling (see .env.example) survive untouched.
    pattern:
      /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s/:@'"`]+:[^\s@/'"`]+@[^\s'"`]+/gi,
  },
  {
    id: 'aws_sigv4',
    pattern:
      /((?:X-Amz-(?:Signature|Credential|Security-Token))=)[^&\s'"]+/gi,
  },
  {
    id: 'query_secret',
    pattern:
      /([?&](?:token|access_token|refresh_token|id_token|sig|signature|api_?key|key)=)[^&\s'"]+/gi,
  },
  {
    id: 'header',
    pattern:
      /(\b(?:authorization|cookie|set-cookie|x-api-key|proxy-authorization)\s*:\s*)[^\r\n;"']+/gi,
  },
  {
    id: 'bearer_basic',
    pattern: /\b(bearer|basic)\s+[\w.!~*'()/+=-]{6,}/gi,
  },
]

function isPlaceholderPassword(password: string): boolean {
  return /^(?:\*+|x+|changeme|change-me|placeholder|redacted|example|dummy|fake|sample|test|secret)$/i.test(
    password,
  )
}

/** Scrubs known secret-bearing spans from arbitrary text. */
export function redactSensitiveText(
  input: string,
  maxLength: number = MAX_TEXT_LENGTH,
): string {
  let output = input.replace(
    TEXT_REDACTION_RULES[2]!.pattern,
    (matched) => {
      const userinfoMatch = /^([^:/]+):\/\/([^:/@]+):([^/@]+)@/.exec(matched)
      if (!userinfoMatch?.[3] || isPlaceholderPassword(userinfoMatch[3])) {
        return matched
      }
      return `${userinfoMatch[1]}://[REDACTED_USER]${REDACTED}@`
    },
  )
  for (const rule of [...TEXT_REDACTION_RULES.slice(0, 2), ...TEXT_REDACTION_RULES.slice(3)]) {
    output = output.replace(rule.pattern, (_matched, ...groups) => {
      // Preserve label/prefix capture groups (e.g. "Authorization:"), drop values.
      const prefix = typeof groups[0] === 'string' ? groups[0] : ''
      if (!prefix) return REDACTED
      return `${prefix}${REDACTED}`
    })
  }
  if (output.length <= maxLength) return output
  return `${output.slice(0, maxLength)}…`
}

/** Depth/breadth-bounded redaction for structured values. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value)
  }
  if (depth >= MAX_VALUE_DEPTH) return '[TRUNCATED]'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push('[TRUNCATED]')
    return items
  }
  if (typeof value !== 'object') return '[OMITTED]'

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_FIELDS)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1)
  }
  if (Object.keys(value).length > MAX_OBJECT_FIELDS) output._truncated = true
  return output
}

export type CauseSummary = Readonly<{
  name: string
  message: string
  code?: string
}>

/** Redacted, bounded description of an unexpected failure for logs. */
export function describeCause(cause: unknown): CauseSummary | unknown {
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code
    return {
      name: cause.name,
      message: redactSensitiveText(cause.message),
      ...(typeof code === 'string' ? { code } : {}),
    }
  }
  if (typeof cause === 'string') {
    return redactSensitiveText(cause, 512)
  }
  return redactValue(cause)
}

function emit(level: 'error' | 'info', payload: Record<string, unknown>): void {
  // Correlation ID from the ambient request/background scope, when present.
  const requestId = currentRequestId()
  const line = JSON.stringify(requestId ? { ...payload, requestId } : payload)
  if (level === 'error') {
    console.error(line)
  } else {
    console.info(line)
  }
}

/** Single-line structured event (audit sinks, operational notices). */
export function logStructuredEvent(fields: Record<string, unknown>): void {
  emit('info', { kind: 'event', timestamp: new Date().toISOString(), ...fields })
}

/**
 * Single-line error record. `scope` identifies the failing boundary;
 * `context` carries only fixed, low-sensitivity fields (IDs, outcome codes).
 */
export function logUnexpectedError(
  scope: string,
  cause: unknown,
  context: Record<string, unknown> = {},
): void {
  emit('error', {
    kind: 'error',
    scope,
    timestamp: new Date().toISOString(),
    ...Object.fromEntries(
      Object.entries(context).map(([key, value]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redactValue(value),
      ]),
    ),
    error: describeCause(cause),
  })
}
