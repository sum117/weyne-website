import type { SettingsPublicErrorCode } from './settings.functions'

/**
 * Staged for the upcoming settings UI surface (no importer yet). The
 * `Record<SettingsPublicErrorCode, string>` type keeps this map exhaustive
 * over the server's error-code union at compile time.
 */
export const SETTINGS_ERROR_MESSAGES: Record<SettingsPublicErrorCode, string> = {
  VALIDATION_FAILED: 'Os dados informados são inválidos.',
  UNAUTHENTICATED: 'Autenticação necessária.',
  FORBIDDEN: 'Você não tem permissão para realizar esta operação.',
  NOT_FOUND: 'Configurações ainda não inicializadas.',
  CONFLICT: 'As configurações foram alteradas por outra pessoa. Recarregue e tente novamente.',
  INTERNAL_ERROR: 'Não foi possível concluir a operação.',
}
