/**
 * Content / launch-config validation gate.
 *
 * Two milestones, one script:
 *   - default (design-complete preview): structural integrity + asset checks
 *     are hard errors; production-readiness issues are WARNINGS so the pipeline
 *     stays green while contact data is still a placeholder.
 *   - release mode (WEYNE_RELEASE=1): production-readiness issues become hard
 *     errors, so a launch build cannot ship invented contact data.
 *
 * Run:
 *   bun run check:content                 # preview (green with placeholders)
 *   WEYNE_RELEASE=1 bun run check:content # release (fails until data supplied)
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { siteConfig } from '../src/features/landing/content'
import {
  validateContentIntegrity,
  validateProductionReadiness,
  type Issue,
} from '../src/features/landing/content.schema'

const RELEASE = process.env.WEYNE_RELEASE === '1'
const PUBLIC_DIR = resolve(process.cwd(), 'public')

function assetIssues(): Issue[] {
  const issues: Issue[] = []
  const seen = new Set<string>()

  for (const brand of siteConfig.brands.items) {
    if (!brand.logo.startsWith('/images/brands/'))
      issues.push({ level: 'error', message: `Brand "${brand.key}" logo path must live under /images/brands (got "${brand.logo}").` })
    if (seen.has(brand.logo))
      issues.push({ level: 'error', message: `Duplicate brand logo path "${brand.logo}".` })
    seen.add(brand.logo)

    const abs = resolve(PUBLIC_DIR, brand.logo.replace(/^\//, ''))
    if (!existsSync(abs))
      issues.push({ level: 'error', message: `Brand asset missing on disk: public${brand.logo}` })
  }

  return issues
}

function main(): void {
  const integrity = validateContentIntegrity(siteConfig)
  const assets = assetIssues()

  // Production-readiness issues are downgraded to warnings outside release mode.
  const readiness = validateProductionReadiness(siteConfig).map((issue) =>
    RELEASE ? issue : { ...issue, level: 'warn' as const },
  )

  const all = [...integrity, ...assets, ...readiness]
  const errors = all.filter((i) => i.level === 'error')
  const warnings = all.filter((i) => i.level === 'warn')

  const mode = RELEASE ? 'RELEASE' : 'preview'
  console.log(`\ncheck:content — mode: ${mode}\n`)

  for (const w of warnings) console.log(`  ⚠  ${w.message}`)
  for (const e of errors) console.error(`  ✖  ${e.message}`)

  if (errors.length === 0) {
    console.log(
      `\n✓ content OK (${warnings.length} warning${warnings.length === 1 ? '' : 's'}).\n`,
    )
    if (!RELEASE && warnings.length > 0)
      console.log('  Note: warnings above become errors under WEYNE_RELEASE=1.\n')
    process.exit(0)
  }

  console.error(
    `\n✖ content check failed: ${errors.length} error${errors.length === 1 ? '' : 's'}.\n`,
  )
  process.exit(1)
}

main()
