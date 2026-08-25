import * as React from 'react'
import { Badge, type BadgeProps } from '@/components/ui/badge'

type StatusBadgeStatus =
  | 'neutral'
  | 'info'
  | 'warning'
  | 'success'
  | 'destructive'

const statusBadgeVariantMap: Record<
  StatusBadgeStatus,
  NonNullable<BadgeProps['variant']>
> = {
  neutral: 'neutral',
  info: 'info',
  warning: 'warning',
  success: 'success',
  destructive: 'destructive',
}

type StatusBadgeProps = Omit<BadgeProps, 'asChild' | 'variant'> & {
  icon?: React.ReactElement<{ 'aria-hidden'?: boolean }>
  status: StatusBadgeStatus
}

function StatusBadge({
  children,
  icon,
  status,
  ...props
}: StatusBadgeProps) {
  return (
    <Badge data-status={status} variant={statusBadgeVariantMap[status]} {...props}>
      {icon ? React.cloneElement(icon, { 'aria-hidden': true }) : null}
      {children}
    </Badge>
  )
}

export {
  StatusBadge,
  statusBadgeVariantMap,
  type StatusBadgeProps,
  type StatusBadgeStatus,
}
