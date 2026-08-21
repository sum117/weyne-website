import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
} from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import { getBundledPdfAssets, resolvePdfImageSource } from './assets.server'
import {
  formatPtBrCurrency,
  formatPtBrDate,
  formatPtBrDecimal,
} from './format'
import type {
  QuotePdfEmbeddedAsset,
  QuotePdfItemSnapshot,
  QuotePdfSignatureSnapshot,
  QuotePdfSnapshot,
} from './types'

export const pdfPalette = Object.freeze({
  navy: '#012C4B',
  blue: '#034F83',
  baltic: '#069CFF',
  sand: '#EECAA0',
  paper: '#F6F3EC',
  ink: '#12314C',
  muted: '#5C7286',
  line: '#DCE5EB',
  white: '#FFFFFF',
})

export const pdfStyles = StyleSheet.create({
  page: {
    backgroundColor: pdfPalette.paper,
    color: pdfPalette.ink,
    fontFamily: 'Weyne Jost',
    fontSize: 9,
    // NOTE: no `lineHeight` here. A page-scoped line height corrupts the layout
    // of the absolutely-positioned `fixed` header/footer subtrees under
    // @react-pdf/renderer 4.6.1 and silently drops both from every page. Body
    // text inherits its rhythm from the `bodyRhythm` wrapper below instead.
    paddingTop: 104,
    paddingRight: 38,
    paddingBottom: 52,
    paddingLeft: 38,
  },
  bodyRhythm: { lineHeight: 1.42 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 84,
    paddingHorizontal: 38,
    backgroundColor: pdfPalette.white,
    borderBottomWidth: 1,
    borderBottomColor: pdfPalette.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  companyLogo: { width: 128, height: 42, objectFit: 'contain' },
  companyFallback: {
    color: pdfPalette.navy,
    fontFamily: 'Weyne Newsreader',
    fontSize: 18,
  },
  industryLogo: { width: 76, height: 38, objectFit: 'contain' },
  quoteIdentity: { alignItems: 'flex-end' },
  quoteNumber: { color: pdfPalette.navy, fontSize: 12, fontWeight: 600 },
  micro: {
    color: pdfPalette.muted,
    fontSize: 7.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  section: { marginBottom: 18 },
  sectionTitle: {
    marginBottom: 8,
    color: pdfPalette.blue,
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 1.15,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: pdfPalette.white,
    borderWidth: 1,
    borderColor: pdfPalette.line,
    borderRadius: 8,
    padding: 12,
  },
  twoColumns: { flexDirection: 'row', gap: 12 },
  grow: { flexGrow: 1, flexBasis: 0 },
  name: {
    color: pdfPalette.navy,
    fontFamily: 'Weyne Newsreader',
    fontSize: 15,
    marginBottom: 4,
  },
  muted: { color: pdfPalette.muted },
  metadataGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metadataCell: { width: '31%', minHeight: 34 },
  metadataLabel: {
    color: pdfPalette.muted,
    fontSize: 7,
    letterSpacing: 0.6,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  metadataValue: { color: pdfPalette.navy, fontSize: 9.25, fontWeight: 500 },
  item: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: pdfPalette.line,
  },
  itemImageFrame: {
    width: 58,
    minWidth: 58,
    height: 58,
    backgroundColor: pdfPalette.paper,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemImage: { width: 54, height: 54, objectFit: 'contain' },
  imagePlaceholder: {
    paddingHorizontal: 5,
    color: pdfPalette.muted,
    fontSize: 6.5,
    textAlign: 'center',
  },
  itemBody: { flexGrow: 1, flexBasis: 0 },
  itemDescription: { color: pdfPalette.navy, fontSize: 9.5, fontWeight: 600 },
  itemCode: { color: pdfPalette.muted, fontSize: 7.5, marginTop: 2 },
  itemNumbers: { width: 156, alignItems: 'flex-end' },
  itemTotal: { color: pdfPalette.blue, fontSize: 10.5, fontWeight: 600 },
  itemDetail: { color: pdfPalette.muted, fontSize: 7.5, marginTop: 2 },
  totals: { marginLeft: 'auto', width: 255 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  totalLabel: { color: pdfPalette.muted },
  totalValue: { color: pdfPalette.navy, fontWeight: 500 },
  grandTotal: {
    marginTop: 5,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: pdfPalette.sand,
  },
  grandTotalLabel: { color: pdfPalette.navy, fontSize: 10, fontWeight: 600 },
  grandTotalValue: { color: pdfPalette.blue, fontSize: 15, fontWeight: 600 },
  taxNote: { color: pdfPalette.muted, fontSize: 7, marginTop: 3 },
  signatures: { flexDirection: 'row', gap: 18, marginTop: 20 },
  signature: { flexGrow: 1, flexBasis: 0, paddingTop: 26 },
  signatureLine: { borderTopWidth: 1, borderTopColor: pdfPalette.navy, paddingTop: 5 },
  signatureName: { color: pdfPalette.navy, textAlign: 'center', fontWeight: 500 },
  signatureRole: { color: pdfPalette.muted, textAlign: 'center', fontSize: 7.5 },
  footer: {
    position: 'absolute',
    left: 38,
    right: 38,
    bottom: 22,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: pdfPalette.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: pdfPalette.muted,
    fontSize: 7,
  },
  hardPageBreak: { height: 0 },
})

export interface PdfSectionProps {
  readonly title?: string
  readonly children: ReactNode
  readonly minPresenceAhead?: number
}

export function PdfSection({
  title,
  children,
  minPresenceAhead = 48,
}: PdfSectionProps) {
  return (
    <View style={pdfStyles.section} minPresenceAhead={minPresenceAhead}>
      {title ? <Text style={pdfStyles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  )
}

export function KeepTogether({ children }: Readonly<{ children: ReactNode }>) {
  return <View wrap={false}>{children}</View>
}

export function HardPageBreak() {
  return <View break style={pdfStyles.hardPageBreak} />
}

export function OrphanGuard({
  children,
  minPresenceAhead = 72,
}: Readonly<{ children: ReactNode; minPresenceAhead?: number }>) {
  return <View minPresenceAhead={minPresenceAhead}>{children}</View>
}

function OptionalImage({
  asset,
  style,
}: Readonly<{
  asset: QuotePdfEmbeddedAsset | null
  style: typeof pdfStyles.companyLogo
}>) {
  const source = resolvePdfImageSource(asset)
  return source ? <Image source={source} style={style} /> : null
}

export function QuotePdfHeader({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  const bundledLogo = getBundledPdfAssets().companyLogo
  const companyLogo = snapshot.branding.companyLogo ?? {
    kind: 'local-path' as const,
    path: bundledLogo,
  }
  const hasCompanyLogo = resolvePdfImageSource(companyLogo) !== null

  return (
    <View fixed style={pdfStyles.header}>
      <View style={pdfStyles.headerIdentity}>
        {hasCompanyLogo ? (
          <OptionalImage asset={companyLogo} style={pdfStyles.companyLogo} />
        ) : (
          <Text style={pdfStyles.companyFallback}>{snapshot.branding.companyName}</Text>
        )}
        <OptionalImage asset={snapshot.branding.industryLogo} style={pdfStyles.industryLogo} />
      </View>
      <View style={pdfStyles.quoteIdentity}>
        <Text style={pdfStyles.micro}>Orçamento comercial</Text>
        <Text style={pdfStyles.quoteNumber}>{snapshot.document.quoteNumber}</Text>
        <Text style={pdfStyles.muted}>Revisão {snapshot.document.revision}</Text>
      </View>
    </View>
  )
}

export function QuotePdfFooter({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  return (
    <View fixed style={pdfStyles.footer}>
      <Text>{snapshot.branding.companyName}</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `${snapshot.document.quoteNumber} · Página ${pageNumber} de ${totalPages}`
        }
      />
    </View>
  )
}

const MetadataCell = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <View style={pdfStyles.metadataCell}>
    <Text style={pdfStyles.metadataLabel}>{label}</Text>
    <Text style={pdfStyles.metadataValue}>{value}</Text>
  </View>
)

export function QuoteMetadata({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  const industryName = snapshot.industry?.tradeName ?? snapshot.industry?.legalName
  const optionalCells = [
    industryName ? <MetadataCell key="industry" label="Indústria" value={industryName} /> : null,
    snapshot.terms.carrierName ? (
      <MetadataCell key="carrier" label="Transportadora" value={snapshot.terms.carrierName} />
    ) : null,
    snapshot.terms.deliveryEstimate ? (
      <MetadataCell
        key="delivery"
        label="Previsão de entrega"
        value={snapshot.terms.deliveryEstimate}
      />
    ) : null,
  ]

  return (
    <View style={pdfStyles.metadataGrid}>
      <MetadataCell label="Emissão" value={formatPtBrDate(snapshot.document.issuedOn)} />
      <MetadataCell label="Validade" value={formatPtBrDate(snapshot.document.validUntil)} />
      <MetadataCell label="Situação" value={snapshot.document.statusLabel} />
      <MetadataCell label="Pagamento" value={snapshot.terms.paymentTerms} />
      <MetadataCell label="Frete" value={snapshot.terms.freightTerms} />
      {optionalCells}
    </View>
  )
}

export function ClientDetails({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  const identity = [snapshot.client.taxId, snapshot.client.stateRegistration]
    .filter(Boolean)
    .join(' · ')
  const contacts = [snapshot.client.contactName, snapshot.client.email, snapshot.client.phone]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={pdfStyles.card}>
      <Text style={pdfStyles.name}>
        {snapshot.client.tradeName ?? snapshot.client.legalName}
      </Text>
      {snapshot.client.tradeName ? <Text>{snapshot.client.legalName}</Text> : null}
      {identity ? <Text style={pdfStyles.muted}>{identity}</Text> : null}
      {snapshot.client.addressLines.map((line) => (
        <Text key={line} style={pdfStyles.muted}>
          {line}
        </Text>
      ))}
      {contacts ? <Text style={pdfStyles.muted}>{contacts}</Text> : null}
    </View>
  )
}

export function ProductImage({ item }: Readonly<{ item: QuotePdfItemSnapshot }>) {
  const source = resolvePdfImageSource(item.image)
  return (
    <View style={pdfStyles.itemImageFrame}>
      {source ? (
        <Image source={source} style={pdfStyles.itemImage} />
      ) : (
        <Text style={pdfStyles.imagePlaceholder}>Imagem indisponível</Text>
      )}
    </View>
  )
}

export function ProductItem({ item }: Readonly<{ item: QuotePdfItemSnapshot }>) {
  const codes = [item.internalCode, item.manufacturerCode].filter(Boolean).join(' · ')
  const details = [item.brand, item.packaging, item.unit].filter(Boolean).join(' · ')

  return (
    <View style={pdfStyles.item} minPresenceAhead={78}>
      <ProductImage item={item} />
      <View style={pdfStyles.itemBody}>
        <Text style={pdfStyles.itemDescription}>{item.description}</Text>
        <Text style={pdfStyles.itemCode}>{codes}</Text>
        {details ? <Text style={pdfStyles.itemCode}>{details}</Text> : null}
      </View>
      <View style={pdfStyles.itemNumbers}>
        <Text style={pdfStyles.itemTotal}>{formatPtBrCurrency(item.lineTotalAmount)}</Text>
        <Text style={pdfStyles.itemDetail}>
          {formatPtBrDecimal(item.quantity, { maximumFractionDigits: 6 })} {item.unit} ×{' '}
          {formatPtBrCurrency(item.unitPriceAmount)}
        </Text>
        <Text style={pdfStyles.itemDetail}>
          Desconto da linha: {formatPtBrCurrency(item.lineDiscountAmount)}
        </Text>
      </View>
    </View>
  )
}

const TotalRow = ({
  label,
  value,
}: Readonly<{ label: string; value: string }>) => (
  <View style={pdfStyles.totalRow}>
    <Text style={pdfStyles.totalLabel}>{label}</Text>
    <Text style={pdfStyles.totalValue}>{value}</Text>
  </View>
)

export function FinancialSummary({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  return (
    <View style={[pdfStyles.card, pdfStyles.totals]} wrap={false}>
      <TotalRow label="Produtos" value={formatPtBrCurrency(snapshot.totals.grossItemsAmount)} />
      <TotalRow
        label="Descontos por item"
        value={`− ${formatPtBrCurrency(snapshot.totals.lineDiscountAmount)}`}
      />
      <TotalRow
        label="Desconto geral"
        value={`− ${formatPtBrCurrency(snapshot.totals.overallDiscountAmount)}`}
      />
      <TotalRow
        label="Mercadorias líquidas"
        value={formatPtBrCurrency(snapshot.totals.netMerchandiseAmount)}
      />
      {snapshot.totals.taxTotals.map((tax) => (
        <View key={tax.code}>
          <TotalRow label={tax.label} value={formatPtBrCurrency(tax.amount)} />
          {!tax.includedInGrandTotal ? (
            <Text style={pdfStyles.taxNote}>Valor informativo, não incluído no total.</Text>
          ) : null}
        </View>
      ))}
      <TotalRow label="Frete" value={formatPtBrCurrency(snapshot.totals.freightAmount)} />
      <View style={[pdfStyles.totalRow, pdfStyles.grandTotal]}>
        <Text style={pdfStyles.grandTotalLabel}>Total do orçamento</Text>
        <Text style={pdfStyles.grandTotalValue}>
          {formatPtBrCurrency(snapshot.totals.grandTotalAmount)}
        </Text>
      </View>
    </View>
  )
}

export function SignatureBlock({
  signature,
}: Readonly<{ signature: QuotePdfSignatureSnapshot }>) {
  return (
    <View style={pdfStyles.signature} wrap={false}>
      <View style={pdfStyles.signatureLine}>
        <Text style={pdfStyles.signatureName}>{signature.name ?? signature.label}</Text>
        {signature.role ? <Text style={pdfStyles.signatureRole}>{signature.role}</Text> : null}
        {signature.name ? <Text style={pdfStyles.signatureRole}>{signature.label}</Text> : null}
      </View>
    </View>
  )
}

export interface QuotePdfFoundationDocumentProps
  extends Omit<DocumentProps, 'children'> {
  readonly snapshot: QuotePdfSnapshot
}

/** A complete shared baseline and a server-rendering smoke document for both variants. */
export function QuotePdfFoundationDocument({
  snapshot,
  ...documentProps
}: QuotePdfFoundationDocumentProps) {
  return (
    <Document
      author={snapshot.branding.companyName}
      title={`${snapshot.document.quoteNumber} · Orçamento comercial`}
      subject={`Orçamento para ${snapshot.client.legalName}`}
      language="pt-BR"
      {...documentProps}
    >
      <Page size="A4" style={pdfStyles.page} wrap>
        <QuotePdfHeader snapshot={snapshot} />
        <QuotePdfFooter snapshot={snapshot} />

        <View style={pdfStyles.bodyRhythm}>
          <PdfSection title="Cliente e proposta">
            <View style={pdfStyles.twoColumns}>
              <View style={pdfStyles.grow}>
                <ClientDetails snapshot={snapshot} />
              </View>
              <View style={[pdfStyles.card, pdfStyles.grow]}>
                <QuoteMetadata snapshot={snapshot} />
              </View>
            </View>
          </PdfSection>

          <PdfSection title="Itens do orçamento" minPresenceAhead={100}>
            <View style={pdfStyles.card}>
              {snapshot.items.map((item) => (
                <ProductItem key={item.lineId} item={item} />
              ))}
            </View>
          </PdfSection>

          <PdfSection title="Resumo financeiro" minPresenceAhead={170}>
            <FinancialSummary snapshot={snapshot} />
          </PdfSection>

          {snapshot.notes ? (
            <PdfSection title="Observações">
              <View style={pdfStyles.card}>
                <Text>{snapshot.notes}</Text>
              </View>
            </PdfSection>
          ) : null}

          {snapshot.signatures.length > 0 ? (
            <PdfSection title="Assinaturas" minPresenceAhead={110}>
              <View style={pdfStyles.signatures}>
                {snapshot.signatures.map((signature) => (
                  <SignatureBlock key={signature.label} signature={signature} />
                ))}
              </View>
            </PdfSection>
          ) : null}
        </View>
      </Page>
    </Document>
  )
}
