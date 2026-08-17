import { createFileRoute } from '@tanstack/react-router'
import { ProductCatalog } from '@/features/app/products/product-catalog'

export const Route = createFileRoute('/app_/produtos')({
  head: () => ({
    meta: [
      { title: 'Produtos | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: ProductsCatalogPage,
})

function ProductsCatalogPage() {
  return (
    <main className="min-h-screen bg-off-white px-4 py-8 md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[96rem]">
        <ProductCatalog products={[]} canManage={false} />
      </div>
    </main>
  )
}
