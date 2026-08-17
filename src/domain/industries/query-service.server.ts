import type {
  IndustryDetail,
  IndustryListQuery,
} from '@/domain/industries/contracts'
import {
  requireCatalogActor,
  type CatalogActor,
} from '@/lib/catalog/authorization.server'
import {
  failure,
  notFound,
  success,
  unexpected,
  validationFailure,
  type Result,
} from '@/lib/domain/result'
import { parseRequest } from '@/lib/server/request.schema'
import {
  industryDetailInputSchema,
  industryListInputSchema,
} from './contracts'

export type IndustryPage = Readonly<{
  items: readonly IndustryDetail[]
  nextCursor: string | null
}>

export type IndustryQueryRepository = Readonly<{
  findActiveById: (id: string) => Promise<IndustryDetail | null>
  list: (query: IndustryListQuery) => Promise<IndustryPage>
}>

type IndustryQueryDependencies = Readonly<{
  repository: IndustryQueryRepository
  authenticate: () => Promise<CatalogActor | null>
}>

export function createIndustryQueryService(
  dependencies: IndustryQueryDependencies,
) {
  return Object.freeze({
    async detail(input: unknown): Promise<Result<IndustryDetail>> {
      await requireCatalogActor(dependencies.authenticate, 'industry.read')
      const request = parseRequest(industryDetailInputSchema, input)
      if (!request.ok) return request

      try {
        const industry = await dependencies.repository.findActiveById(request.data.id)
        return industry === null ? failure(notFound()) : success(industry)
      } catch (cause) {
        return failure(unexpected(cause))
      }
    },

    async list(input: unknown): Promise<Result<IndustryPage>> {
      await requireCatalogActor(dependencies.authenticate, 'industry.search')
      const request = parseRequest(industryListInputSchema, input)
      if (!request.ok) return request

      try {
        return success(await dependencies.repository.list(request.data))
      } catch (cause) {
        if (cause instanceof RangeError && request.data.cursor) {
          return failure(
            validationFailure([
              { path: ['cursor'], message: 'Cursor inválido.' },
            ]),
          )
        }
        return failure(unexpected(cause))
      }
    },
  })
}
