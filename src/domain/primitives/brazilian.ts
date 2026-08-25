import {
  formatToCEP,
  formatToCNPJ,
  formatToPhone,
  isCEP,
  isCNPJ,
  isPhone,
} from 'brazilian-values'
import { z } from 'zod'

const CNPJ_INPUT_PATTERN = /^(?:[A-Z0-9]{12}\d{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2})$/i
const CEP_INPUT_PATTERN = /^(?:\d{8}|\d{5}-\d{3})$/
const PHONE_INPUT_PATTERN = /^(?:\d{10,11}|(?:\+55 )?\(\d{2}\) \d{4,5}-\d{4})$/

function canonicalizeCnpj(value: string): string {
  return value.replace(/[./-]/g, '').toUpperCase()
}

function canonicalizeCep(value: string): string {
  return value.replace('-', '')
}

function canonicalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return value.startsWith('+55 ') ? digits.slice(2) : digits
}

/** Accepts canonical or standard formatted CNPJ and outputs 14 characters. */
export const cnpjSchema = z
  .string()
  .superRefine((value, context) => {
    const normalized = canonicalizeCnpj(value)
    if (!CNPJ_INPUT_PATTERN.test(value) || !isCNPJ(normalized)) {
      context.addIssue({ code: 'custom', message: 'Informe um CNPJ válido' })
    }
  })
  .transform(canonicalizeCnpj)

/** Accepts canonical or standard formatted CEP and outputs eight digits. */
export const cepSchema = z
  .string()
  .superRefine((value, context) => {
    if (!CEP_INPUT_PATTERN.test(value) || !isCEP(value)) {
      context.addIssue({ code: 'custom', message: 'Informe um CEP válido' })
    }
  })
  .transform(canonicalizeCep)

/**
 * Accepts a canonical national number or a standard pt-BR display value and
 * outputs the ten or eleven national digits (DDD + subscriber number).
 */
export const phoneSchema = z
  .string()
  .superRefine((value, context) => {
    if (!PHONE_INPUT_PATTERN.test(value) || !isPhone(value)) {
      context.addIssue({ code: 'custom', message: 'Informe um telefone válido' })
    }
  })
  .transform(canonicalizePhone)

export type Cnpj = z.output<typeof cnpjSchema>
export type Cep = z.output<typeof cepSchema>
export type BrazilianPhone = z.output<typeof phoneSchema>

export function parseCnpj(value: string): Cnpj {
  return cnpjSchema.parse(value)
}

export function parseCep(value: string): Cep {
  return cepSchema.parse(value)
}

export function parsePhone(value: string): BrazilianPhone {
  return phoneSchema.parse(value)
}

export function formatCnpj(value: Cnpj): string {
  return formatToCNPJ(cnpjSchema.parse(value))
}

export function formatCep(value: Cep): string {
  return formatToCEP(cepSchema.parse(value))
}

export function formatPhone(value: BrazilianPhone): string {
  return formatToPhone(phoneSchema.parse(value))
}
