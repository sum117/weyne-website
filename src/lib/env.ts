/**
 * Public environment parsing. Framework-independent — no React/UI imports.
 *
 * Only PUBLIC values belong here. The WhatsApp number is client-visible by
 * design (it ends up in a wa.me URL); future CRM/email secrets must live only
 * in server code, never in a `VITE_` variable.
 *
 * Values are optional overrides: when unset, the typed content config in
 * `features/landing/content.ts` supplies the (placeholder) default.
 *
 * Access must be STATIC per-key (`import.meta.env.VITE_X`) so Vite replaces it
 * at transform time — this holds in dev SSR, the client build, and Vitest.
 * Under plain Node/Bun (the tsx content-check script) `import.meta.env` is
 * undefined, so the read throws and we fall back to undefined.
 */

type PublicEnv = {
  /** Digits-only or formatted international WhatsApp number, e.g. "5581999999999". */
  whatsappNumber?: string
  /** Production origin without trailing slash, e.g. "https://weynerepresentacoes.com.br". */
  siteOrigin?: string
}

function safeRead(read: () => string | undefined): string | undefined {
  try {
    const value = read()?.trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}

export const publicEnv: PublicEnv = {
  whatsappNumber: safeRead(() => import.meta.env.VITE_WHATSAPP_NUMBER),
  siteOrigin: safeRead(() => import.meta.env.VITE_SITE_ORIGIN),
}
