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

export const AUTHENTICATED_SHELL_PORT = 3192
export const AUTHENTICATED_SHELL_BASE_URL = `http://127.0.0.1:${AUTHENTICATED_SHELL_PORT}`
