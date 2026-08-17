import { createHash } from 'node:crypto'
import type { industries, products } from '@/lib/db/schema'

type SyntheticIndustry = typeof industries.$inferInsert & Readonly<{ id: string }>
type SyntheticProduct = typeof products.$inferInsert & Readonly<{ id: string }>

export type SyntheticBusiness = Readonly<{
  legalName: string
  taxIdentifier: string
  email: string
  phone: string
  address: Readonly<{
    street: string
    number: string
    district: string
    city: string
    state: string
    postalCode: string
  }>
}>

export type SyntheticCatalogFactory = Readonly<{
  business: () => SyntheticBusiness
  industry: () => SyntheticIndustry
  product: (industryId: string) => SyntheticProduct
}>

export function createSyntheticCatalogFactory(
  seed = 'default',
): SyntheticCatalogFactory {
  let sequence = 0
  const next = () => {
    sequence += 1
    return sequence
  }

  return Object.freeze({
    business: () => {
      const index = next()
      return Object.freeze({
        legalName: `EMPRESA FICTÍCIA TESTE ${seed.toUpperCase()} ${index}`,
        taxIdentifier: `TEST-CNPJ-${seed.toUpperCase()}-${index}`,
        email: `nao-responder+${seed}-${index}@example.invalid`,
        phone: `+55 00 00000-${String(index).padStart(4, '0')}`,
        address: Object.freeze({
          street: 'Rua Inteiramente Fictícia para Testes',
          number: `${1000 + index}`,
          district: 'Bairro Sintético',
          city: 'Cidade de Teste',
          state: 'ZZ',
          postalCode: '00000-000',
        }),
      })
    },
    industry: () => {
      const index = next()
      return {
        id: syntheticUuid(seed, 'industry', index),
        legalName: `INDÚSTRIA FICTÍCIA TESTE ${seed.toUpperCase()} ${index}`,
      }
    },
    product: (industryId) => {
      const index = next()
      return {
        id: syntheticUuid(seed, 'product', index),
        industryId,
        internalCode: `TEST-${seed.toUpperCase()}-${String(index).padStart(4, '0')}`,
        manufacturerCode: `FABRICANTE-FICTICIO-${index}`,
        description: `Produto inteiramente sintético para teste ${seed} ${index}`,
        brand: 'MARCA FICTÍCIA DE TESTE',
        category: 'CATEGORIA SINTÉTICA',
        unit: 'UN',
        createdBy: 'integration-test-factory',
        updatedBy: 'integration-test-factory',
      }
    },
  })
}

function syntheticUuid(seed: string, kind: string, index: number): string {
  const hex = createHash('sha256')
    .update(`weyne-synthetic-test:${seed}:${kind}:${index}`)
    .digest('hex')
    .slice(0, 32)

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}
