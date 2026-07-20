import { cn } from '@/lib/cn'

/** Exact organic wave paths from the prototype (viewBox 0 0 1440 110). */
const WAVE_PATHS = {
  segTop: 'M0,0 H1440 V44 C1180,104 900,8 720,46 C540,84 260,102 0,54 Z',
  segBottom: 'M0,110 H1440 V66 C1180,6 900,102 720,64 C540,26 260,8 0,56 Z',
  footerTop: 'M0,0 H1440 V48 C1180,104 900,10 720,48 C540,86 260,100 0,52 Z',
} as const

export type WaveDividerProps = {
  variant: keyof typeof WAVE_PATHS
  edge: 'top' | 'bottom'
  /** Height utility, e.g. `h-[clamp(46px,6vw,92px)]`. */
  className?: string
  /** Fill color; defaults to paper. */
  fill?: string
}

export function WaveDivider({
  variant,
  edge,
  className,
  fill = '#F6F3EC',
}: WaveDividerProps) {
  return (
    <svg
      viewBox="0 0 1440 110"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute left-0 z-1 block w-full',
        edge === 'top' ? '-top-px' : '-bottom-px',
        className,
      )}
    >
      <path d={WAVE_PATHS[variant]} fill={fill} />
    </svg>
  )
}
