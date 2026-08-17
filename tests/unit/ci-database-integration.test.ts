import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

async function readCiWorkflow(): Promise<string> {
  return readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
}

describe('CI PostgreSQL integration lane', () => {
  it('provisions a version-pinned healthy PostgreSQL service with isolated credentials', async () => {
    const workflow = await readCiWorkflow()

    expect(workflow).toContain('image: postgres:17.6-alpine')
    expect(workflow).toContain('POSTGRES_USER: weyne_ci')
    expect(workflow).toContain('POSTGRES_DB: weyne_ci_test')
    expect(workflow).toContain('pg_isready -U weyne_ci -d weyne_ci_test')
    expect(workflow).toContain('--health-interval 5s')
    expect(workflow).toContain('--health-retries 12')
  })

  it('migrates an empty database and runs the real PostgreSQL smoke test with step-scoped URLs', async () => {
    const workflow = await readCiWorkflow()

    expect(workflow).toMatch(/name: Migrate the empty CI database[\s\S]*?env:\s+DATABASE_URL:/)
    expect(workflow).toMatch(/name: Verify the migrated PostgreSQL smoke schema[\s\S]*?env:\s+TEST_DATABASE_URL:/)
    expect(workflow).toContain('run: bun run db:migrate')
    expect(workflow).toContain(
      'run: bun run test:database tests/integration/database-smoke.test.ts',
    )
    expect(workflow).not.toMatch(/^\s{4}env:\s*\n\s+DATABASE_URL:/m)
  })
})
