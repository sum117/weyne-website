import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { CustomerFormExample } from '@/components/forms/examples/customer-form-example'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { ClientDetail, type ClientDetailRecord } from '@/features/app/clients/client-detail'
import { ProductCatalog, type ProductCatalogItem } from '@/features/app/products/product-catalog'
import { QuoteDetailView, type QuoteDetail } from '@/features/app/quotes/quote-detail'
import { SiteHeader } from '@/components/site/site-header'
import '@/styles/app.css'

const prices = (base: number): ProductCatalogItem['prices'] => [
  { key: 'PRICE_1', label: 'Preço 1', amount: `${base}.00` },
  { key: 'PRICE_2', label: 'Preço 2', amount: `${base + 4}.50` },
  { key: 'PRICE_3', label: 'Preço 3', amount: `${base + 8}.00` },
  { key: 'PRICE_4', label: 'Preço 4', amount: `${base + 12}.75` },
]

const products: ProductCatalogItem[] = [
  { id: 'p-1', internalCode: 'TC-001', manufacturerCode: 'FAB-1042', name: 'Detergente concentrado profissional 5 L', industry: 'Total Clean', category: 'Saneantes', brand: 'Total Clean', archived: false, prices: prices(42) },
  { id: 'p-2', internalCode: 'LP-204', manufacturerCode: 'PAP-0204', name: 'Papel toalha interfolhado premium', industry: 'Century', category: 'Papéis', brand: 'Century Paper', archived: false, prices: prices(68) },
  { id: 'p-3', internalCode: 'BB-018', manufacturerCode: null, name: 'Álcool antisséptico 70%', industry: 'Bello Bella', category: 'Antissépticos', brand: 'Bello Bella', archived: true, prices: prices(24) },
]

const client: ClientDetailRecord = {
  id: 'client-1', legalName: 'Hotel Horizonte do Recife Ltda.', tradeName: 'Hotel Horizonte', cnpj: '05095383000142', stateRegistration: '0321418-80', status: 'active', segment: 'Hotelaria', contactName: 'Marina Alves', phone: '8133334444', whatsapp: '81999998888', email: 'compras@hotelhorizonte.example', representativeName: 'Carolina Weyne', creditLimit: '25000', notes: 'Cliente com entregas programadas às terças-feiras.',
  address: { street: 'Avenida Boa Viagem', number: '1200', district: 'Boa Viagem', city: 'Recife', state: 'PE', postalCode: '51011000' },
}

const quote: QuoteDetail = {
  id: 'quote-1', number: 'ORC-2026-0042', status: { code: 'sent', label: 'Enviado' }, issuedOn: '2026-08-12', validUntil: '2026-08-27', customer: { name: 'Hotel Horizonte', document: '05.095.383/0001-42' }, industry: { name: 'Total Clean' }, representative: { name: 'Carolina Weyne' }, paymentTerms: '28 dias', freight: { terms: 'CIF', amount: '120.00' }, transporter: { name: 'Nordeste Cargas' }, capabilities: { canEdit: true }, partialDataWarnings: ['A transportadora ainda não confirmou a janela de entrega.'],
  lines: [
    { id: 'line-1', productCode: 'TC-001', description: 'Detergente concentrado profissional 5 L', quantity: '12', unit: 'un.', unitPrice: '42.00', total: '504.00' },
    { id: 'line-2', productCode: 'LP-204', description: 'Papel toalha interfolhado premium', quantity: '20', unit: 'cx.', unitPrice: '68.00', total: '1360.00' },
  ],
  totals: { grossItems: '1864.00', itemDiscounts: '64.00', generalDiscount: '100.00', freight: '120.00', total: '1820.00' },
}

function Frame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8"><div className="mx-auto max-w-[96rem]"><header className="mb-6"><p className="text-xs font-semibold tracking-[0.16em] text-blue uppercase">Ambiente autenticado</p><h1 className="mt-1 font-display text-4xl text-navy">{title}</h1><p className="mt-2 max-w-3xl text-sm text-muted">{description}</p></header>{children}</div></main>
}

function CatalogFixture() {
  return <Frame title="Catálogo de produtos" description="Tabela responsiva, filtros, preços, estados e ações com dados determinísticos."><ProductCatalog products={products} canManage onArchiveStateChange={() => undefined} /></Frame>
}

function ClientFixture() {
  return <Frame title="Detalhe de cliente" description="Resumo cadastral e ação destrutiva com confirmação explícita."><ClientDetail state={{ status: 'ready', client }} actions={{ canEdit: true, canArchive: true }} /></Frame>
}

function QuoteFixture() {
  return <QuoteDetailView state={{ kind: 'ready', quote }} />
}

const chartData = [
  { month: 'Mar', amount: 48 }, { month: 'Abr', amount: 62 }, { month: 'Mai', amount: 55 }, { month: 'Jun', amount: 78 }, { month: 'Jul', amount: 84 }, { month: 'Ago', amount: 72 },
]

function ControlsFixture() {
  return <Frame title="Formulário, arquivos e relatório" description="Controles nativos e compostos mantêm os tokens Weyne e uma hierarquia estável."><div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Cadastro de cliente</CardTitle><CardDescription>Campos formatados com validação acessível.</CardDescription></CardHeader><CardContent><CustomerFormExample onSubmit={() => undefined} /></CardContent></Card><div className="grid content-start gap-6"><Card><CardHeader><CardTitle>Vendas por mês</CardTitle><CardDescription>Valores em milhares de reais.</CardDescription></CardHeader><CardContent><ChartContainer config={{ amount: { label: 'Vendas', color: 'var(--chart-1)' } }} className="min-h-64 w-full"><BarChart data={chartData} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="amount" fill="var(--color-amount)" radius={[6, 6, 0, 0]} /></BarChart></ChartContainer></CardContent></Card><Card><CardHeader><CardTitle>Anexos comerciais</CardTitle><CardDescription>PDF ou imagem, até 10 MB por arquivo.</CardDescription></CardHeader><CardContent className="space-y-4"><label className="grid min-h-32 cursor-pointer place-items-center rounded-xl border border-dashed border-blue/35 bg-paper p-5 text-center focus-within:ring-2 focus-within:ring-blue"><span><strong className="block text-navy">Selecione arquivos</strong><span className="mt-1 block text-sm text-muted">ou arraste para esta área</span></span><input className="sr-only" type="file" multiple aria-label="Selecionar anexos" /></label><div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-white p-3 text-sm"><span className="truncate text-ink">proposta-comercial.pdf</span><span className="whitespace-nowrap text-muted">1,2 MB</span></div></CardContent></Card></div></div></Frame>
}

function StatesFixture() {
  return <Frame title="Estados de carregamento e recuperação" description="Vazio, carregando e erro permanecem distintos, estáveis e acionáveis."><div className="grid gap-5 lg:grid-cols-3"><section><h2 className="mb-3 font-display text-2xl text-navy">Carregando</h2><ProductCatalog products={[]} canManage={false} loading /></section><section><h2 className="mb-3 font-display text-2xl text-navy">Vazio</h2><ProductCatalog products={[]} canManage={false} /></section><section><h2 className="mb-3 font-display text-2xl text-navy">Erro</h2><ProductCatalog products={[]} canManage={false} error="Não foi possível carregar os produtos." onRetry={() => undefined} /></section></div><Alert variant="warning" className="mt-6"><AlertTitle>Diferença intencional</AlertTitle><AlertDescription>As telas autenticadas seguem os tokens Weyne e o benchmark de UX; não existe protótipo visual aprovado equivalente para comparação pixel a pixel.</AlertDescription></Alert></Frame>
}

function MobileMenuFixture() {
  return <div className="min-h-screen bg-hero-radial"><SiteHeader /><main className="px-5 pt-36 text-white"><p className="text-xs font-semibold tracking-[0.2em] uppercase">Representação comercial</p><h1 className="mt-4 max-w-sm font-display text-5xl leading-[1.02]">Relacionamento e soluções que geram resultados.</h1></main></div>
}

const surface = new URLSearchParams(window.location.search).get('surface') ?? 'catalog'
const fixtures: Record<string, React.ReactNode> = { catalog: <CatalogFixture />, client: <ClientFixture />, quote: <QuoteFixture />, controls: <ControlsFixture />, states: <StatesFixture />, menu: <MobileMenuFixture /> }

createRoot(document.getElementById('root')!).render(<StrictMode>{fixtures[surface] ?? fixtures.catalog}</StrictMode>)