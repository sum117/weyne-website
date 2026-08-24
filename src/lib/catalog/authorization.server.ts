import { hasCapability, type Capability, type Role } from '@/lib/auth/capabilities'

export type CatalogRole = Role

export type CatalogActor = Readonly<{
  id: string
  role: CatalogRole
}>

export type CatalogAction =
  | 'industry.read'
  | 'industry.search'
  | 'industry.create'
  | 'industry.update'
  | 'industry.archive'
  | 'product.read'
  | 'product.search'
  | 'product.create'
  | 'product.update'
  | 'product.archive'
  | 'product.files.read'
  | 'product.files.manage'
  | 'price.read'
  | 'price.update'
  | 'price.history.read'
  | 'carrier.read'
  | 'carrier.search'
  | 'carrier.create'
  | 'carrier.update'
  | 'carrier.archive'

export type CatalogAuthorizationResult = 'allow' | 'forbidden' | 'not_supported'

/** Maps legacy catalog actions to the canonical capability vocabulary. */
const CATALOG_ACTION_CAPABILITIES: Readonly<Record<CatalogAction, Capability | null>> = {
  'industry.read': 'industry.view',
  'industry.search': 'industry.view',
  'industry.create': 'industry.create',
  'industry.update': 'industry.update_operational',
  'industry.archive': 'industry.archive',
  'product.read': 'product.view',
  'product.search': 'product.view',
  'product.create': 'product.create',
  'product.update': 'product.update_operational',
  'product.archive': 'product.archive',
  'product.files.read': 'product.view_files',
  'product.files.manage': 'product.manage_files',
  'price.read': 'price_list.view',
  'price.update': 'price_list.manage',
  'price.history.read': null,
  'carrier.read': 'carrier.view',
  'carrier.search': 'carrier.view',
  'carrier.create': 'carrier.create',
  'carrier.update': 'carrier.update_operational',
  'carrier.archive': 'carrier.archive',
}

export function authorizeCatalogAction(
  actor: CatalogActor,
  action: CatalogAction,
): CatalogAuthorizationResult {
  const capability = CATALOG_ACTION_CAPABILITIES[action]
  if (capability === null) return 'not_supported'
  return hasCapability(actor.role, capability) ? 'allow' : 'forbidden'
}

export class CatalogAccessError extends Error {
  readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_SUPPORTED'
  readonly status: 401 | 403 | 404

  constructor(code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_SUPPORTED') {
    super(
      code === 'UNAUTHENTICATED'
        ? 'Autenticação necessária.'
        : code === 'FORBIDDEN'
          ? 'Você não tem permissão para executar esta operação.'
          : 'Esta operação não está disponível.',
    )
    this.name = 'CatalogAccessError'
    this.code = code
    this.status = code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 404
  }
}

export async function requireCatalogActor(
  authenticate: () => Promise<CatalogActor | null>,
  action: CatalogAction,
): Promise<CatalogActor> {
  const actor = await authenticate()
  if (!actor) throw new CatalogAccessError('UNAUTHENTICATED')
  const result = authorizeCatalogAction(actor, action)
  if (result === 'not_supported') throw new CatalogAccessError('NOT_SUPPORTED')
  if (result !== 'allow') throw new CatalogAccessError('FORBIDDEN')
  return actor
}
