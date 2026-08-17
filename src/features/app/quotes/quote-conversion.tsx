import { ArrowRight, SpinnerGap, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface ConvertedOrderReference {
  readonly id: string
  readonly number: string
}

export type QuoteConversionResult =
  | { readonly kind: 'created'; readonly order: ConvertedOrderReference }
  | { readonly kind: 'existing'; readonly order: ConvertedOrderReference }
  | { readonly kind: 'denied'; readonly message: string }
  | { readonly kind: 'illegal-state'; readonly message: string }
  | { readonly kind: 'retryable'; readonly message: string }

export type QuoteConversionAvailability =
  | { readonly kind: 'available' }
  | { readonly kind: 'existing'; readonly order: ConvertedOrderReference }
  | {
      readonly kind: 'unavailable'
      readonly reason: 'read-only' | 'source-state'
      readonly message?: string
    }

export interface QuoteConversionProps {
  readonly quoteNumber: string
  readonly availability: QuoteConversionAvailability
  readonly onConvert: () => Promise<QuoteConversionResult>
}

type ConversionFeedback = QuoteConversionResult | null

function OrderFeedback({ result }: { result: Extract<QuoteConversionResult, { kind: 'created' | 'existing' }> }) {
  const existing = result.kind === 'existing'
  return (
    <div role="status" className="space-y-3 rounded-xl border border-success/30 bg-success/5 p-4">
      <p className="font-semibold text-foreground">
        {existing
          ? `Este orçamento já foi convertido no pedido ${result.order.number}. Nenhum novo pedido foi criado.`
          : `Pedido ${result.order.number} criado a partir do orçamento.`}
      </p>
      <Button asChild variant="outline">
        <a
          href={`/app/pedidos/${encodeURIComponent(result.order.id)}`}
          aria-label={`Abrir pedido ${result.order.number}`}
        >
          Abrir pedido
          <ArrowRight aria-hidden="true" weight="light" />
        </a>
      </Button>
    </div>
  )
}

function TerminalFeedback({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <WarningCircle aria-hidden="true" weight="light" />
      <AlertTitle>Conversão indisponível</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export function QuoteConversion({ quoteNumber, availability, onConvert }: QuoteConversionProps) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ConversionFeedback>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const pendingRef = useRef(false)

  async function confirmConversion() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setRetryMessage(null)

    try {
      const conversion = await onConvert()
      setConfirming(false)
      if (conversion.kind === 'retryable') {
        setRetryMessage(conversion.message)
      } else {
        setFeedback(conversion)
      }
    } catch {
      setConfirming(false)
      setRetryMessage(
        'Não foi possível confirmar o resultado. Tente novamente: a operação é segura e reutiliza o pedido caso a conversão já tenha ocorrido.',
      )
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  if (availability.kind === 'existing') {
    return <OrderFeedback result={{ kind: 'existing', order: availability.order }} />
  }

  if (feedback?.kind === 'created' || feedback?.kind === 'existing') {
    return <OrderFeedback result={feedback} />
  }

  if (feedback?.kind === 'denied' || feedback?.kind === 'illegal-state') {
    return <TerminalFeedback message={feedback.message} />
  }

  if (availability.kind === 'unavailable') {
    if (availability.reason === 'read-only') return null
    return availability.message ? (
      <p role="status" className="text-sm text-muted-foreground">
        {availability.message}
      </p>
    ) : null
  }

  return (
    <>
      {retryMessage ? (
        <Alert variant="destructive" role="alert" className="mb-3">
          <WarningCircle aria-hidden="true" weight="light" />
          <AlertTitle>Resultado da conversão não confirmado</AlertTitle>
          <AlertDescription>
            <p>{retryMessage}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => {
                setRetryMessage(null)
                setConfirming(true)
              }}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Button type="button" variant="primary" onClick={() => setConfirming(true)}>
          Converter em pedido
        </Button>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!pending) setConfirming(open)
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl text-navy">
              Converter orçamento em pedido?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Confirme para converter o orçamento {quoteNumber}. A operação sempre resulta em no máximo um pedido, inclusive em tentativas repetidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel asChild>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
              >
                Cancelar
              </Button>
            </AlertDialogCancel>
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                autoFocus
                onClick={() => void confirmConversion()}
              >
                {pending ? <SpinnerGap aria-hidden="true" className="animate-spin" /> : null}
                {pending ? 'Convertendo…' : 'Confirmar conversão'}
              </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
