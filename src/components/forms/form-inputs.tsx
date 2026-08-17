import * as React from 'react'
import { Input } from '@/components/ui/input'
import {
  formatBrazilianMask,
  formatCurrency,
  formatEditableDecimal,
  formatPercent,
  normalizeBrazilianMask,
  parseBrazilianDecimal,
  type BrazilianMask,
} from './form-values'

type ControlledInputProps<TValue> = Omit<
  React.ComponentProps<typeof Input>,
  'onChange' | 'type' | 'value'
> & {
  value: TValue
  onValueChange: (value: TValue) => void
}

const maskInputModes: Record<
  BrazilianMask,
  React.HTMLAttributes<HTMLInputElement>['inputMode']
> = {
  cep: 'numeric',
  cnpj: 'text',
  cpf: 'numeric',
  cpfOrCnpj: 'text',
  phone: 'tel',
}

export interface BrazilianMaskedInputProps
  extends ControlledInputProps<string> {
  mask: BrazilianMask
}

export const BrazilianMaskedInput = React.forwardRef<
  HTMLInputElement,
  BrazilianMaskedInputProps
>(function BrazilianMaskedInput(
  { mask, value, onValueChange, inputMode, ...props },
  ref,
) {
  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      inputMode={inputMode ?? maskInputModes[mask]}
      autoComplete="off"
      value={formatBrazilianMask(mask, value)}
      onChange={(event) =>
        onValueChange(normalizeBrazilianMask(mask, event.currentTarget.value))
      }
    />
  )
})

interface DecimalInputProps extends ControlledInputProps<number | null> {
  formatDisplay: (value: number | null) => string
}

const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  function DecimalInput(
    { value, onValueChange, formatDisplay, onFocus, onBlur, ...props },
    ref,
  ) {
    const [isEditing, setIsEditing] = React.useState(false)
    const [display, setDisplay] = React.useState(() => formatDisplay(value))

    React.useEffect(() => {
      if (!isEditing) setDisplay(formatDisplay(value))
    }, [formatDisplay, isEditing, value])

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={(event) => {
          setIsEditing(true)
          setDisplay(formatEditableDecimal(value))
          onFocus?.(event)
        }}
        onChange={(event) => {
          const nextDisplay = event.currentTarget.value
          setDisplay(nextDisplay)
          onValueChange(parseBrazilianDecimal(nextDisplay))
        }}
        onBlur={(event) => {
          setIsEditing(false)
          setDisplay(formatDisplay(parseBrazilianDecimal(display)))
          onBlur?.(event)
        }}
      />
    )
  },
)

export type CurrencyInputProps = ControlledInputProps<number | null>

export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  CurrencyInputProps
>(function CurrencyInput(props, ref) {
  return <DecimalInput {...props} ref={ref} formatDisplay={formatCurrency} />
})

export type PercentInputProps = ControlledInputProps<number | null>

export const PercentInput = React.forwardRef<HTMLInputElement, PercentInputProps>(
  function PercentInput(props, ref) {
    return <DecimalInput {...props} ref={ref} formatDisplay={formatPercent} />
  },
)

export type DateInputProps = ControlledInputProps<string>

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput({ value, onValueChange, ...props }, ref) {
    return (
      <Input
        {...props}
        ref={ref}
        type="date"
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
    )
  },
)

export interface ComboboxOption {
  value: string
  label: string
  disabled?: boolean
}

export interface ComboboxInputProps extends ControlledInputProps<string> {
  options: readonly ComboboxOption[]
}

export const ComboboxInput = React.forwardRef<
  HTMLInputElement,
  ComboboxInputProps
>(function ComboboxInput(
  { value, onValueChange, options, onBlur, onKeyDown, ...props },
  ref,
) {
  const listId = React.useId()
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? ''
  const [query, setQuery] = React.useState(selectedLabel)

  React.useEffect(() => setQuery(selectedLabel), [selectedLabel])

  function commitExactOption(candidate: string) {
    const normalizedCandidate = candidate.trim().toLocaleLowerCase('pt-BR')
    const match = options.find(
      (option) =>
        !option.disabled &&
        option.label.toLocaleLowerCase('pt-BR') === normalizedCandidate,
    )
    if (!match) return false
    onValueChange(match.value)
    setQuery(selectedLabel)
    return true
  }

  return (
    <>
      <Input
        {...props}
        ref={ref}
        type="text"
        list={listId}
        value={query}
        onChange={(event) => {
          const nextQuery = event.currentTarget.value
          if (nextQuery) {
            setQuery(nextQuery)
          } else {
            onValueChange('')
            setQuery(selectedLabel)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && commitExactOption(query)) {
            event.preventDefault()
          }
          onKeyDown?.(event)
        }}
        onBlur={(event) => {
          if (!commitExactOption(event.currentTarget.value)) {
            setQuery(selectedLabel)
          }
          onBlur?.(event)
        }}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.label}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </datalist>
    </>
  )
})
