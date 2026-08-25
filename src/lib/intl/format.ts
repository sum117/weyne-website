export const APP_LOCALE = 'pt-BR' as const

/**
 * Memoized Intl formatter factory. Constructing Intl.NumberFormat /
 * DateTimeFormat is the expensive part of locale formatting; caching per
 * options-key keeps hot table renders from paying that cost per cell.
 */
type IntlFormatter = Intl.NumberFormat | Intl.DateTimeFormat
const formatterCache = new Map<string, IntlFormatter>()

function memoizedNumberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `number:${stableKey(options)}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(APP_LOCALE, options)
    formatterCache.set(key, formatter)
  }
  return formatter as Intl.NumberFormat
}

function memoizedDateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `date:${stableKey(options)}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(APP_LOCALE, options)
    formatterCache.set(key, formatter)
  }
  return formatter as Intl.DateTimeFormat
}

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value)
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}=${stableKey(v)}`)
    .sort()
    .join('&')
}

export function formatCurrency(
  value: number,
  currency = 'BRL',
  options: Intl.NumberFormatOptions = {},
): string {
  return memoizedNumberFormatter({
    style: 'currency',
    currency,
    ...options,
  }).format(value)
}

/**
 * Formats a whole-number percentage (e.g. `12.5` → `12,5%`). The input is
 * divided by 100 because Intl percent style expects a fraction — pass a
 * fraction directly via options override if your source is already one.
 */
export function formatPercentFromWhole(
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return memoizedNumberFormatter({
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    ...options,
  }).format(value / 100)
}

/** Back-compat alias; prefer the explicit name. */
export const formatPercent = formatPercentFromWhole

export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return memoizedDateFormatter(options).format(value)
}
