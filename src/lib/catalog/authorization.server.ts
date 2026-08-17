export type CatalogRole = 'admin' | 'representative' | 'read_only'

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
  | 'price.read'
  | 'price.update'
  | 'price.history.read'
  | 'carrier.read'
  | 'carrier.search'
  | 'carrier.create'
  | 'carrier.update'
  | 'carrier.archive'

export type CatalogAuthorizationResult = 'allow' | 'forbidden'

const ADMIN_ONLY_ACTIONS: readonly CatalogAction[] = [
  'industry.create',
  'industry.update',
  'industry.archive',
  'product.create',
  'product.update',
  'product.archive',
  'price.update',
  'carrier.create',
  'carrier.update',
  'carrier.archive',
]

export function authorizeCatalogAction(
  actor: CatalogActor,
  action: CatalogAction,
): CatalogAuthorizationResult {
  if (ADMIN_ONLY_ACTIONS.includes(action)) {
    return actor.role === 'admin' ? 'allow' : 'forbidden'
  }
  if (action === 'price.history.read' && actor.role === 'read_only') return 'forbidden'
  return 'allow'
}

export class CatalogAccessError extends Error {
  readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN'
  readonly status: 401 | 403

  constructor(code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code === 'UNAUTHENTICATED' ? 'Authentication is required.' : 'Operation is not permitted.')
    this.name = 'CatalogAccessError'
    this.code = code
    this.status = code === 'UNAUTHENTICATED' ? 401 : 403
  }
}

export async function requireCatalogActor(
  authenticate: () => Promise<CatalogActor | null>,
  action: CatalogAction,
): Promise<CatalogActor> {
  const actor = await authenticate()
  if (!actor) throw new CatalogAccessError('UNAUTHENTICATED')
  if (authorizeCatalogAction(actor, action) !== 'allow') throw new CatalogAccessError('FORBIDDEN')
  return actor
}
