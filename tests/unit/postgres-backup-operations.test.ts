import { existsSync, mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const repositoryRoot = process.cwd()
const pruneScript = 'deploy/postgres/prune-backups.sh'

function toShellPath(value: string): string {
  return value.replaceAll('\\', '/')
}

function createBundle(root: string, identity: string, ageInDays: number): string {
  const bundle = resolve(root, `${identity}.backup`)
  mkdirSync(bundle)
  const createdAtEpoch = Math.floor(Date.now() / 1000) - ageInDays * 24 * 60 * 60
  writeFileSync(
    resolve(bundle, 'manifest.env'),
    `BACKUP_ID=${identity}\nCREATED_AT_EPOCH=${createdAtEpoch}\nSTATUS=complete\n`,
  )
  const timestamp = new Date(Date.now() - ageInDays * 24 * 60 * 60 * 1000)
  utimesSync(bundle, timestamp, timestamp)
  return bundle
}

describe('PostgreSQL backup operations', () => {
  it('dry-runs deterministic count and age pruning without deleting bundles', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'weyne-backup-retention-'))
    const newest = createBundle(root, 'weyne-20260817T120000Z-a', 0)
    const second = createBundle(root, 'weyne-20260816T120000Z-b', 1)
    const overCount = createBundle(root, 'weyne-20260815T120000Z-c', 2)
    const expired = createBundle(root, 'weyne-20260701T120000Z-d', 47)

    const result = spawnSync('bash', [pruneScript, '--dry-run', toShellPath(root), '2', '30'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, NOW_EPOCH: String(Math.floor(Date.now() / 1000)) },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`prune=${toShellPath(overCount)}`)
    expect(result.stdout).toContain(`prune=${toShellPath(expired)}`)
    expect(result.stdout).not.toContain(`prune=${toShellPath(newest)}`)
    expect(result.stdout).not.toContain(`prune=${toShellPath(second)}`)
    expect(existsSync(overCount)).toBe(true)
    expect(existsSync(expired)).toBe(true)
  }, 15_000)

  it('refuses invalid retention values and never touches unrelated paths', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'weyne-backup-retention-'))
    const unrelated = resolve(root, 'operator-notes')
    mkdirSync(unrelated)

    const result = spawnSync('bash', [pruneScript, toShellPath(root), '0', '30'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('RETAIN_COUNT must be a positive integer')
    expect(existsSync(unrelated)).toBe(true)
  })

  it('rejects a corrupt dump before connecting to the restore target', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'weyne-backup-corrupt-'))
    const identity = 'weyne-20260817T120000Z-corrupt'
    const bundle = resolve(root, `${identity}.backup`)
    const passwordFile = resolve(root, 'postgres-password')
    mkdirSync(bundle)
    writeFileSync(resolve(bundle, 'database.dump'), 'corrupt dump payload')
    writeFileSync(
      resolve(bundle, 'manifest.env'),
      `BACKUP_ID=${identity}\nCREATED_AT_EPOCH=1786968000\nCREATED_AT_UTC=2026-08-17T12:00:00Z\nSOURCE_DATABASE=weyne\nSTATUS=complete\n`,
    )
    writeFileSync(resolve(bundle, 'counts.tsv'), 'public.reference_records\t3\n')
    const invalidHash = '0'.repeat(64)
    writeFileSync(
      resolve(bundle, 'SHA256SUMS'),
      `${invalidHash}  database.dump\n${invalidHash}  counts.tsv\n${invalidHash}  manifest.env\n`,
    )
    writeFileSync(passwordFile, 'not-a-real-secret')

    const result = spawnSync('bash', ['deploy/postgres/restore-drill.sh', toShellPath(bundle)], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PGHOST: 'must-not-connect.invalid',
        PGUSER: 'restore_operator',
        PGDATABASE: 'weyne',
        RESTORE_DATABASE: 'weyne_restore_corrupt_test',
        PGPASS_SOURCE_FILE: toShellPath(passwordFile),
      },
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      `backup_id=${identity} verification=failed reason=checksum_mismatch`,
    )
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('not-a-real-secret')
  }, 15_000)
})
