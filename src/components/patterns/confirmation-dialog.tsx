import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

type ConfirmationTone = 'default' | 'destructive'
type ConfirmationCancelReason = 'cancel' | 'escape'

const confirmToneClasses: Record<ConfirmationTone, string> = {
  default: buttonVariants({ variant: 'primary', size: 'default' }),
  destructive: buttonVariants({ variant: 'destructive', size: 'default' }),
}

type ConfirmationDialogProps = {
  cancelLabel?: string
  confirmDisabled?: boolean
  confirmLabel: string
  defaultOpen?: boolean
  description: React.ReactNode
  error?: React.ReactNode
  onCancel?: (reason: ConfirmationCancelReason) => void
  onConfirm: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
  open?: boolean
  pending?: boolean
  pendingLabel?: string
  retryLabel?: string
  title: React.ReactNode
  tone?: ConfirmationTone
  trigger?: React.ReactElement
}

function ConfirmationDialog({
  cancelLabel = 'Cancelar',
  confirmDisabled = false,
  confirmLabel,
  defaultOpen,
  description,
  error,
  onCancel,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  pendingLabel = 'Processando…',
  retryLabel,
  title,
  tone = 'destructive',
  trigger,
}: ConfirmationDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const inFlightCycleRef = React.useRef<number | null>(null)
  const openCycleRef = React.useRef(0)
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const [pendingCycle, setPendingCycle] = React.useState<number | null>(null)
  const [internalError, setInternalError] = React.useState<{
    content: React.ReactNode
    cycle: number
  } | null>(null)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const previousOpenRef = React.useRef(isOpen)
  const isOpenRef = React.useRef(isOpen)

  if (isOpen !== previousOpenRef.current) {
    if (isOpen) openCycleRef.current += 1
    previousOpenRef.current = isOpen
  }
  isOpenRef.current = isOpen

  const isPending = pending || pendingCycle === openCycleRef.current
  const currentInternalError =
    internalError?.cycle === openCycleRef.current ? internalError.content : null
  const displayedError = error || currentInternalError

  const updateOpen = (nextOpen: boolean, force = false) => {
    if (!force && isPending && !nextOpen) return
    if (!isControlled) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (!nextOpen) setInternalError(null)
  }

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const operationCycle = openCycleRef.current
    if (inFlightCycleRef.current === operationCycle || isPending) return

    inFlightCycleRef.current = operationCycle
    setPendingCycle(operationCycle)
    setInternalError(null)

    try {
      await onConfirm()
      if (
        operationCycle !== openCycleRef.current ||
        !isOpenRef.current
      ) return
      updateOpen(false, true)
    } catch (confirmationError) {
      if (
        operationCycle !== openCycleRef.current ||
        !isOpenRef.current
      ) return
      setInternalError({
        content:
          confirmationError instanceof Error
            ? confirmationError.message
            : 'Não foi possível concluir a ação. Tente novamente.',
        cycle: operationCycle,
      })
    } finally {
      if (inFlightCycleRef.current === operationCycle) {
        inFlightCycleRef.current = null
      }
      setPendingCycle((currentCycle) =>
        currentCycle === operationCycle ? null : currentCycle,
      )
    }
  }

  return (
    <AlertDialog
      onOpenChange={updateOpen}
      open={isOpen}
    >
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent
        aria-busy={isPending}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (isPending) {
            event.preventDefault()
            return
          }
          onCancel?.('escape')
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {displayedError ? (
          <p role="alert" className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-sm text-destructive-surface-foreground">
            {displayedError}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isPending}
            onClick={() => onCancel?.('cancel')}
            ref={cancelRef}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            aria-busy={isPending}
            className={confirmToneClasses[tone]}
            disabled={isPending || confirmDisabled}
            onClick={handleConfirm}
          >
            {isPending
              ? pendingLabel
              : currentInternalError && retryLabel
                ? retryLabel
                : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export {
  ConfirmationDialog,
  confirmToneClasses,
  type ConfirmationCancelReason,
  type ConfirmationDialogProps,
  type ConfirmationTone,
}
