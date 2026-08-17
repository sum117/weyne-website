import { describe, expect, it, vi } from 'vitest'
import {
  createIndustryMutationOperations,
  type IndustryMutationServiceContract,
} from '@/features/app/industries/industry.functions'
import { failure, unexpected } from '@/lib/domain/result'

const industryId = '11111111-1111-4111-8111-111111111111'

function serviceWith(
  result: Awaited<ReturnType<IndustryMutationServiceContract['create']>>,
): IndustryMutationServiceContract {
  return {
    create: vi.fn(async () => result),
    update: vi.fn(async () => result),
    archive: vi.fn(async () => result),
  }
}

describe('industry mutation server operations', () => {
  it('maps authorization and validation failures to clear pt-BR public errors', async () => {
    const forbidden = createIndustryMutationOperations({
      getService: async () =>
        serviceWith(failure({ category: 'forbidden' as const })),
      logUnexpectedError: vi.fn(),
    })

    await expect(forbidden.create({ unsupported: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Você não tem permissão para realizar esta operação.',
      },
    })

    const validation = createIndustryMutationOperations({
      getService: async () =>
        serviceWith(
          failure({
            category: 'validation' as const,
            issues: [
              {
                path: ['defaultCommissionPercentage'],
                message: 'Informe uma porcentagem entre 0 e 100 com até 6 casas decimais',
              },
            ],
          }),
        ),
      logUnexpectedError: vi.fn(),
    })
    await expect(validation.update({ id: industryId })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Os dados informados são inválidos.',
      },
    })
  })

  it('sanitizes unexpected persistence details and logs them only on the server', async () => {
    const cause = new Error('SQLSTATE 42P01 private schema')
    const logUnexpectedError = vi.fn()
    const operations = createIndustryMutationOperations({
      getService: async () => serviceWith(failure(unexpected(cause))),
      logUnexpectedError,
    })

    const result = await operations.archive({ id: industryId })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Não foi possível concluir a operação.',
      },
    })
    expect(JSON.stringify(result)).not.toContain('SQLSTATE')
    expect(logUnexpectedError).toHaveBeenCalledWith(cause)
  })
})
