import { createFileRoute } from '@tanstack/react-router'
import { ProductCatalog } from '@/features/app/products/product-catalog'
import { requireCapableRoute } from '@/features/app/auth/route-guard'
import { hasCapability } from '@/lib/auth/capabilities'

/**
 * Product catalog (`/app/produtos`).
 *
 * The route guard resolves the session and the catalog derives its
 * management flag from the centralized matrix (`product.update_operational`)
 * instead of a raw role comparison (card `t_d3e33344`). It is presentation
 * only: the catalog's server functions re-check every mutation through
 * `requireCapability`.
 */
export const Route = createFileRoute('/app/produtos')({
  beforeLoad: ({ location }) => requireCapableRoute(location, 'product.view'),
  head: () => ({
    meta: [
      { title: 'Produtos | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: ProductsCatalogPage,
})

function ProductsCatalogPage() {
  const { session } = Route.useRouteContext()
  return (
    <div className="min-h-0 min-w-0 flex-1 bg-background px-4 py-8 md:px-6 nav:px-8">
      <div className="mx-auto w-full max-w-[96rem]">
        <ProductCatalog
          products={[]}
          canManage={hasCapability(
            session.user.role,
            'product.update_operational',
          )}
        />
      </div>
    </div>
  )
}
