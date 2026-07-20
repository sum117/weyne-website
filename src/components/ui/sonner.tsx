import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Non-blocking toast host. Light theme only (the site has no dark mode), so
 * we skip next-themes entirely and tint via CSS variables mapped to tokens.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          '--normal-bg': '#ffffff',
          '--normal-text': 'var(--color-ink)',
          '--normal-border': 'var(--color-line)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
