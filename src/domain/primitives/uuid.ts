import { z } from 'zod'

/** Canonical UUID used by persisted domain identifiers. */
export const uuidSchema = z
  .string()
  .uuid('Informe um UUID válido')
  .transform((value) => value.toLowerCase())

export type Uuid = z.infer<typeof uuidSchema>
