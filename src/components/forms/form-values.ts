import {
  formatToCEP,
  formatToCNPJ,
  formatToCPF,
  formatToCPFOrCNPJ,
  formatToPhone,
} from 'brazilian-values'

export type BrazilianMask = 'cep' | 'cnpj' | 'cpf' | 'cpfOrCnpj' | 'phone'

const maximumDigits: Record<BrazilianMask, number> = {
  cep: 8,
  cnpj: 14,
  cpf: 11,
  cpfOrCnpj: 14,
  phone: 11,
}

const maskFormatters: Record<BrazilianMask, (value: string) => string> = {
  cep: formatToCEP,
  cnpj: formatToCNPJ,
  cpf: formatToCPF,
  cpfOrCnpj: formatToCPFOrCNPJ,
  phone: formatToPhone,
}

export function normalizeBrazilianMask(mask: BrazilianMask, value: string) {
  if (mask === 'cnpj' || mask === 'cpfOrCnpj') {
    const document = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return document.slice(0, maximumDigits[mask])
  }

  let digits = value.replace(/\D/g, '')
  if (mask === 'phone' && digits.length > 11 && digits.startsWith('55')) {
    digits = digits.slice(2)
  }
  return digits.slice(0, maximumDigits[mask])
}

export function formatBrazilianMask(mask: BrazilianMask, rawValue: string) {
  const normalized = normalizeBrazilianMask(mask, rawValue)
  return normalized ? maskFormatters[mask](normalized) : ''
}

export function parseBrazilianDecimal(displayValue: string) {
  const localized = displayValue.trim().replace(/[^\d,.-]/g, '')
  const normalized = localized.includes(',')
    ? localized.replace(/\./g, '').replace(',', '.')
    : localized.replace(/\./g, '')

  if (!normalized || !/[0-9]/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
})

export function formatCurrency(value: number | null) {
  return value === null ? '' : currencyFormatter.format(value)
}

export function formatPercent(value: number | null) {
  return value === null ? '' : percentFormatter.format(value / 100)
}

export function formatEditableDecimal(value: number | null) {
  return value === null ? '' : String(value).replace('.', ',')
}

export function formatBrazilianDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}