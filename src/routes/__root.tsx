/// <reference types="vite/client" />
import {
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import appCss from '@/styles/app.css?url'
import jostLatinFont from '@fontsource-variable/jost/files/jost-latin-wght-normal.woff2?url'
import newsreaderItalicLatinFont from '@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2?url'
import newsreaderLatinFont from '@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#012C4B' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'preload',
        href: jostLatinFont,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: newsreaderLatinFont,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: newsreaderItalicLatinFont,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
})

// Blocking, runs before first paint: marks JS present (so scroll-reveal CSS may
// hide elements without ever flashing them), plus a 3s safety fallback that
// reveals everything if the reveal JS never runs.
const REVEAL_BOOT =
  "document.documentElement.setAttribute('data-js','');setTimeout(function(){document.documentElement.setAttribute('data-reveal-fallback','')},3000);"

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
        <link
          rel="preload"
          as="image"
          type="image/avif"
          href="/images/carolina-desk-mobile.avif"
          media="(max-width: 639px)"
          fetchPriority="high"
        />
        <link
          rel="preload"
          as="image"
          type="image/avif"
          href="/images/carolina-desk.avif"
          media="(min-width: 640px)"
          fetchPriority="high"
        />
        <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT }} />
      </head>
      <body>
        {children}
        <Toaster position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}
