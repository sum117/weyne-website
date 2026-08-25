export const AUTHENTICATED_SHELL_USERS = {
  admin: {
    email: 'shell-admin@example.test',
    name: 'Ana Administradora',
    password: 'senha-de-teste-shell-admin',
    role: 'admin',
  },
  readOnly: {
    email: 'shell-consulta@example.test',
    name: 'Rui Consulta',
    password: 'senha-de-teste-shell-consulta',
    role: 'read_only',
  },
} as const

export const AUTHENTICATED_SHELL_PORT = 3193
export const AUTHENTICATED_SHELL_BASE_URL = `http://127.0.0.1:${AUTHENTICATED_SHELL_PORT}`

/** Dedicated read-model schema and deterministic event for audit viewer E2E. */
export const AUDIT_E2E_SCHEMA = 'audit_e2e'
export const AUDIT_E2E_EVENT = {
  id: '40000000-0000-4000-8000-000000000901',
  quoteId: '30000000-0000-4000-8000-000000000901',
  quoteNumber: 'ORC-2026-000901',
  correlationId: 'audit-e2e-command-901',
  occurredAt: '2026-08-21T12:00:00.000Z',
  before: { status: 'draft', password: 'senha-audit-e2e' },
  after: { status: 'sent', token: 'token-audit-e2e' },
} as const
