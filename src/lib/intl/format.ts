export const APP_LOCALE = 'pt-BR' as const

export function formatCurrency(
  value: number,
  currency = 'BRL',
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency,
    ...options,
  }).format(value)
}

export function formatPercent(
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    ...options,
  }).format(value / 100)
}

export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(APP_LOCALE, options).format(value)
}
