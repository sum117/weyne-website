import { z } from 'zod'

/**
 * Single validation contract for the contact form.
 *
 * Used today for client-side validation before composing a WhatsApp message.
 * A future TanStack Start server function can reuse this exact schema before
 * persisting or forwarding a lead — no second source of truth.
 */
export const leadSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'Informe seu nome')
    .max(80, 'Use até 80 caracteres'),
  // Optional in the UX sense (blank allowed) but always a string so the schema
  // input type matches the form's controlled string values.
  empresa: z.string().trim().max(120, 'Use até 120 caracteres'),
  mensagem: z.string().trim().max(600, 'Use até 600 caracteres'),
})

/** Shape accepted before validation (what the form binds to). */
export type LeadInput = z.input<typeof leadSchema>

/** Shape produced after successful validation (trimmed). */
export type Lead = z.output<typeof leadSchema>
