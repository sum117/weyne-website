import { createServerFn } from '@tanstack/react-start'

export const getRuntimeStatus = createServerFn({ method: 'GET' }).handler(
  async () => ({
    message: 'Servidor TanStack Start ativo',
    renderedAt: new Date().toISOString(),
  }),
)