import type { SettingsPublicErrorCode } from './settings.functions'

export const SETTINGS_ERROR_MESSAGES: Readonly<Record<SettingsPublicErrorCode, string>> = {
  VALIDATION_FAILED: 'Os dados informados são inválidos.',
  UNAUTHENTICATED: 'Autenticação necessária.',
  FORBIDDEN: 'Você não tem permissão para realizar esta operação.',
  NOT_FOUND: 'Configurações ainda não inicializadas.',
  CONFLICT: 'As configurações foram alteradas por outra pessoa. Recarregue e tente novamente.',
  INTERNAL_ERROR: 'Não foi possível concluir a operação.',
}
