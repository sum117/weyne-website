'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { SidebarSimple } from '@phosphor-icons/react/dist/ssr'
import { cva, type VariantProps } from 'class-variance-authority'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const SIDEBAR_COOKIE_NAME = 'sidebar_state'
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'
const SIDEBAR_WIDTH_ICON = '3.5rem'

type SidebarContextValue = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (value: boolean | ((current: boolean) => boolean)) => void
  openMobile: boolean
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within SidebarProvider.')
  return context
}

function SidebarProvider({ defaultOpen = true, open: openProp, onOpenChange, className, style, children, ...props }: React.ComponentProps<'div'> & { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const isMobile = useIsMobile()
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [openMobile, setOpenMobile] = React.useState(false)
  const open = openProp ?? internalOpen

  const setOpen = React.useCallback((value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
  }, [onOpenChange, open])

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile((current) => !current)
    else setOpen((current) => !current)
  }, [isMobile, setOpen])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

  const state: SidebarContextValue['state'] = open ? 'expanded' : 'collapsed'
  const value = React.useMemo(() => ({ state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }), [state, open, setOpen, openMobile, isMobile, toggleSidebar])

  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={{ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_WIDTH_ICON, ...style } as React.CSSProperties}
          className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

type SidebarProps = React.ComponentProps<'div'> & {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
}

function Sidebar({ side = 'left', variant = 'sidebar', collapsible = 'offcanvas', className, children, ...props }: SidebarProps) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === 'none') {
    return <div data-slot="sidebar" data-testid="sidebar-root" data-state="expanded" className={cn('flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground', className)} {...props}>{children}</div>
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side={side} showClose={false} data-slot="sidebar" data-testid="sidebar-root" data-state={openMobile ? 'expanded' : 'collapsed'} className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground" style={{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE } as React.CSSProperties} {...props}>
          <SheetHeader className="sr-only"><SheetTitle>Navegação</SheetTitle><SheetDescription>Menu principal do aplicativo.</SheetDescription></SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div data-slot="sidebar" data-testid="sidebar-root" data-state={state} data-collapsible={state === 'collapsed' ? collapsible : ''} data-variant={variant} data-side={side} className={cn('group peer hidden text-sidebar-foreground md:block', className)} {...props}>
      <div aria-hidden="true" className={cn('relative w-(--sidebar-width) transition-[width] duration-300 ease-house', 'group-data-[collapsible=offcanvas]:w-0 group-data-[collapsible=icon]:w-(--sidebar-width-icon)')} />
      <div className={cn('fixed inset-y-0 z-header hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-300 ease-house md:flex', side === 'left' ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]' : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]', 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)', variant !== 'sidebar' && 'p-2')}>
        <div data-slot="sidebar-inner" className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-xl group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm">{children}</div>
      </div>
    </div>
  )
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()
  return (
    <Button variant="ghost" size="icon" aria-label="Alternar barra lateral" className={cn('size-11', className)} onClick={(event) => { onClick?.(event); toggleSidebar() }} {...props}>
      <SidebarSimple size={20} weight="light" aria-hidden="true" />
    </Button>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return <main data-slot="sidebar-inset" className={cn('relative flex min-w-0 w-full flex-1 flex-col bg-background', className)} {...props} />
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input data-slot="sidebar-input" className={cn('h-9 w-full bg-background shadow-none', className)} {...props} />
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('mt-auto flex flex-col gap-2 p-2', className)} {...props} />
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden', className)} {...props} />
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="sidebar-separator" className={cn('mx-2 w-auto bg-sidebar-border', className)} {...props} />
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />
}

function SidebarGroupLabel({ className, asChild = false, ...props }: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div'
  return <Comp data-slot="sidebar-group-label" className={cn('flex h-8 items-center rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground outline-hidden transition-[margin,opacity] ease-house focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0', className)} {...props} />
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" className={cn('w-full text-sm', className)} {...props} />
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative', className)} {...props} />
}

const sidebarMenuButtonVariants = cva('flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm outline-hidden transition-colors ease-house hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 [&>span:last-child]:truncate [&>svg]:size-5 [&>svg]:shrink-0', {
  variants: { variant: { default: '', outline: 'border border-sidebar-border' }, size: { default: 'text-sm', sm: 'min-h-9 text-xs', lg: 'min-h-12 text-sm' } },
  defaultVariants: { variant: 'default', size: 'default' },
})

type SidebarMenuButtonProps = React.ComponentProps<'button'> & VariantProps<typeof sidebarMenuButtonVariants> & { asChild?: boolean; isActive?: boolean; tooltip?: string }

function SidebarMenuButton({ asChild = false, isActive = false, tooltip, variant, size, className, ...props }: SidebarMenuButtonProps) {
  const Comp = asChild ? Slot : 'button'
  const { state, isMobile } = useSidebar()
  const button = <Comp data-slot="sidebar-menu-button" data-active={isActive} aria-current={isActive ? 'page' : undefined} className={cn(sidebarMenuButtonVariants({ variant, size }), className)} {...props} />
  if (!tooltip) return button
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right" hidden={state !== 'collapsed' || isMobile}>{tooltip}</TooltipContent></Tooltip>
}

function SidebarMenuSkeleton({ className, showIcon = false, ...props }: React.ComponentProps<'div'> & { showIcon?: boolean }) {
  return <div data-slot="sidebar-menu-skeleton" aria-hidden="true" className={cn('flex h-11 items-center gap-2 rounded-md px-2', className)} {...props}>{showIcon && <Skeleton className="size-5 rounded-md" />}<Skeleton className="h-4 w-3/5 flex-1" /></div>
}

export {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  SidebarInput,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  sidebarMenuButtonVariants,
  useSidebar,
}
