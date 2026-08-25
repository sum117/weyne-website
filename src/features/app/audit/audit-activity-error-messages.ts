import type { AuditActivityError } from '@/lib/audit/activity.server'

export const AUDIT_ACTIVITY_ERROR_MESSAGES: Readonly<Record<AuditActivityError['code'], string>> = {
  UNAUTHENTICATED: 'Autenticação necessária.',
  FORBIDDEN: 'Apenas administradores podem consultar a auditoria.',
  INVALID_FILTER: 'Os filtros de auditoria são inválidos.',
}
