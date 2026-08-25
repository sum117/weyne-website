import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
} from '@react-pdf/renderer'
import {
  ClientDetails,
  PdfSection,
  ProductImage,
  QuoteMetadata,
  QuotePdfFooter,
  QuotePdfHeader,
  SignatureBlock,
  pdfPalette,
  pdfStyles,
} from './components'
import {
  formatPtBrCurrency,
  formatPtBrDate,
  formatPtBrDecimal,
  keepOnOneLine,
} from './format'
import { renderQuotePdfToBuffer } from './render.server'
import type {
  QuotePdfItemSnapshot,
  QuotePdfSnapshot,
  QuotePdfTaxTotalSnapshot,
} from './types'

/**
 * Premium commercial presentation. Like the resumida variant, every rendered
 * value comes verbatim from the immutable snapshot — this template only
 * decides hierarchy, emphasis, and pagination.
 */
const comercialStyles = StyleSheet.create({
  page: {
    ...pdfStyles.page,
    paddingTop: 116,
  },
  // Page-scoped lineHeight corrupts the fixed header/footer subtrees (see the
  // note on pdfStyles.page); the flowing body carries its own rhythm instead.
  bodyRhythm: { ...pdfStyles.bodyRhythm },
  continuationContext: {
    position: 'absolute',
    top: 84,
    left: 38,
    right: 38,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: pdfPalette.muted,
    fontSize: 7.25,
  },
  continuationClient: {
    maxWidth: 330,
    color: pdfPalette.navy,
    fontWeight: 500,
  },
  leadGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  leadClient: {
    flexGrow: 1,
    flexBasis: 0,
  },
  leadMetadata: {
    width: 252,
  },
  representativeStrip: {
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: pdfPalette.white,
    borderWidth: 1,
    borderColor: pdfPalette.sand,
    borderLeftWidth: 3,
    borderRadius: 7,
  },
  representativeName: {
    color: pdfPalette.navy,
    fontFamily: 'Weyne Newsreader',
    fontSize: 11.5,
  },
  representativeRole: {
    marginTop: 1,
    color: pdfPalette.muted,
    fontSize: 7.5,
  },
  representativeValidity: {
    color: pdfPalette.blue,
    fontSize: 8,
    fontWeight: 600,
    textAlign: 'right',
  },
  termsLine: {
    marginTop: 8,
    color: pdfPalette.muted,
    fontSize: 7.75,
    lineHeight: 1.4,
  },
  termsStrong: {
    color: pdfPalette.navy,
    fontWeight: 500,
  },
  itemsCard: {
    ...pdfStyles.card,
    padding: 0,
    overflow: 'hidden',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 26,
    paddingHorizontal: 11,
    backgroundColor: pdfPalette.navy,
    color: pdfPalette.white,
    fontSize: 6.5,
    fontWeight: 600,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 11,
    borderBottomWidth: 1,
    borderBottomColor: pdfPalette.line,
  },
  itemImageColumn: {
    width: 86,
  },
  itemImageFrame: {
    width: 86,
    height: 86,
    backgroundColor: pdfPalette.paper,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemImage: {
    width: 80,
    height: 80,
    objectFit: 'contain',
  },
  itemDescriptionColumn: {
    flexGrow: 1,
    flexBasis: 0,
  },
  itemPosition: {
    color: pdfPalette.blue,
    fontSize: 7,
    fontWeight: 600,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  itemDescription: {
    marginTop: 2,
    color: pdfPalette.navy,
    fontSize: 9.5,
    fontWeight: 600,
    lineHeight: 1.3,
  },
  itemMeta: {
    marginTop: 3,
    color: pdfPalette.muted,
    fontSize: 7,
    lineHeight: 1.35,
  },
  itemValueColumn: {
    width: 168,
    alignItems: 'flex-end',
  },
  itemTotal: {
    color: pdfPalette.blue,
    fontSize: 11.5,
    fontWeight: 600,
  },
  itemValue: {
    marginTop: 2.5,
    color: pdfPalette.muted,
    fontSize: 7,
    lineHeight: 1.35,
    textAlign: 'right',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  notesColumn: {
    flexGrow: 1,
    flexBasis: 0,
  },
  notesCard: {
    ...pdfStyles.card,
    color: pdfPalette.muted,
    fontSize: 8,
  },
  summaryCard: {
    ...pdfStyles.card,
    width: 268,
  },
  summaryOnly: {
    marginLeft: 'auto',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3.5,
  },
  summaryLabel: {
    flexGrow: 1,
    flexBasis: 0,
    color: pdfPalette.muted,
  },
  summaryValue: {
    color: pdfPalette.navy,
    fontWeight: 500,
    textAlign: 'right',
  },
  summaryDetail: {
    marginTop: -1,
    marginBottom: 2,
    color: pdfPalette.muted,
    fontSize: 6.5,
  },
  grandTotal: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: pdfPalette.sand,
  },
  grandTotalLabel: {
    color: pdfPalette.navy,
    fontSize: 10,
    fontWeight: 600,
  },
  grandTotalValue: {
    color: pdfPalette.blue,
    fontSize: 15,
    fontWeight: 600,
  },
  signatures: {
    ...pdfStyles.signatures,
    marginTop: 14,
  },
})

const compactClientName = (snapshot: QuotePdfSnapshot) =>
  snapshot.client.tradeName ?? snapshot.client.legalName

const formatRate = (rate: string) =>
  formatPtBrDecimal(rate, { maximumFractionDigits: 6 })

/** Page context repeated on every continuation page. */
function ContinuationContext({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  return (
    <View fixed style={comercialStyles.continuationContext}>
      <Text style={comercialStyles.continuationClient}>
        Cliente · {compactClientName(snapshot)}
      </Text>
      <Text>{snapshot.terms.validityLabel}</Text>
    </View>
  )
}

/** Carol Weyne branding: the representative is the commercial face of the quote. */
function RepresentativeStrip({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  const contacts = [snapshot.representative.email, snapshot.representative.phone]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={comercialStyles.representativeStrip} wrap={false}>
      <View style={pdfStyles.grow}>
        <Text style={comercialStyles.representativeName}>
          {snapshot.representative.name}
        </Text>
        <Text style={comercialStyles.representativeRole}>
          {[
            snapshot.representative.role,
            // Keep each contact token (email, phone) unbreakable; the '·'
            // separators remain legal wrap points.
            ...contacts.split(' · ').map((part) => keepOnOneLine(part)),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View>
        <Text style={comercialStyles.representativeValidity}>
          {snapshot.terms.validityLabel}
        </Text>
        <Text style={comercialStyles.representativeRole}>
          Válida até {formatPtBrDate(snapshot.document.validUntil)}
        </Text>
      </View>
    </View>
  )
}

function TermsLine({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  const logistics = [
    `Frete: ${snapshot.terms.freightTerms}`,
    snapshot.terms.carrierName ? `Transportadora: ${snapshot.terms.carrierName}` : null,
    snapshot.terms.deliveryEstimate ? `Entrega: ${snapshot.terms.deliveryEstimate}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    // Each term becomes one unbreakable unit: nested runs otherwise wrap
    // mid-word under @react-pdf/renderer (e.g. "co/nfirmação"). Breaks then
    // only happen at the '·' separators between units.
    .map((part) => keepOnOneLine(part))

  return (
    <Text style={comercialStyles.termsLine}>
      Pagamento:{' '}
      <Text style={comercialStyles.termsStrong}>
        {keepOnOneLine(snapshot.terms.paymentTerms)}
      </Text>
      {'  ·  '}
      {logistics.map((part, index) => (
        <Text key={index}>
          {index > 0 ? '  ·  ' : ''}
          {part}
        </Text>
      ))}
    </Text>
  )
}

function ItemTaxDetails({ item }: Readonly<{ item: QuotePdfItemSnapshot }>) {
  if (item.taxLines.length === 0) return null

  return (
    <Text style={comercialStyles.itemValue}>
      {item.taxLines
        .map(
          (tax) =>
            `${tax.label} ${formatRate(tax.rate)}% · ${formatPtBrCurrency(tax.amount)}`,
        )
        .join(' · ')}
    </Text>
  )
}

/** Premium product card: prominent imagery plus the full supplied value chain. */
function PremiumProductRow({ item }: Readonly<{ item: QuotePdfItemSnapshot }>) {
  const codes = [item.internalCode, item.manufacturerCode].filter(Boolean).join(' · ')
  const identity = [item.brand, item.packaging, item.unit].filter(Boolean).join(' · ')

  return (
    <View style={comercialStyles.itemRow} wrap={false} minPresenceAhead={92}>
      <View style={comercialStyles.itemImageColumn}>
        <View style={comercialStyles.itemImageFrame}>
          <ProductImage item={item} />
        </View>
      </View>
      <View style={comercialStyles.itemDescriptionColumn}>
        <Text style={comercialStyles.itemPosition}>Item {item.position}</Text>
        <Text style={comercialStyles.itemDescription}>{item.description}</Text>
        <Text style={comercialStyles.itemMeta}>{codes}</Text>
        {identity ? <Text style={comercialStyles.itemMeta}>{identity}</Text> : null}
      </View>
      <View style={comercialStyles.itemValueColumn}>
        <Text style={comercialStyles.itemTotal}>
          {formatPtBrCurrency(item.lineTotalAmount)}
        </Text>
        <Text style={comercialStyles.itemValue}>
          {formatPtBrDecimal(item.quantity, { maximumFractionDigits: 6 })} {item.unit} ×{' '}
          {formatPtBrCurrency(item.unitPriceAmount)}
        </Text>
        <Text style={comercialStyles.itemValue}>
          {
            // One pre-composed string child: multi-expression JSX children get
            // split into runs, and the line breaker treats run boundaries as
            // break opportunities (orphaning '(' from its amount).
            `Bruto ${formatPtBrCurrency(item.grossAmount)} · desconto do item ${formatRate(
              item.lineDiscountRate,
            )}% (${keepOnOneLine(formatPtBrCurrency(item.lineDiscountAmount))})`
          }
        </Text>
        <Text style={comercialStyles.itemValue}>
          {
            `Rateio desconto geral ${formatPtBrCurrency(item.overallDiscountAllocationAmount)} · ${keepOnOneLine(
              `líquido ${formatPtBrCurrency(item.netMerchandiseAmount)}`,
            )}`
          }
        </Text>
        <ItemTaxDetails item={item} />
      </View>
    </View>
  )
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={comercialStyles.summaryRow}>
      <Text style={comercialStyles.summaryLabel}>{label}</Text>
      <Text style={comercialStyles.summaryValue}>{value}</Text>
    </View>
  )
}

function TaxTotalRow({ tax }: Readonly<{ tax: QuotePdfTaxTotalSnapshot }>) {
  return (
    <View>
      <SummaryRow label={tax.label} value={formatPtBrCurrency(tax.amount)} />
      <Text style={comercialStyles.summaryDetail}>
        Base {formatPtBrCurrency(tax.basisAmount)}
        {tax.includedInGrandTotal ? '' : ' · informativo, não incluído no total'}
      </Text>
    </View>
  )
}

function ComercialFinancialSummary({
  snapshot,
}: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  return (
    <View
      style={[
        comercialStyles.summaryCard,
        snapshot.notes ? {} : comercialStyles.summaryOnly,
      ]}
      wrap={false}
    >
      <SummaryRow
        label="Produtos brutos"
        value={formatPtBrCurrency(snapshot.totals.grossItemsAmount)}
      />
      <SummaryRow
        label="Descontos por item"
        value={`− ${formatPtBrCurrency(snapshot.totals.lineDiscountAmount)}`}
      />
      <SummaryRow
        label="Subtotal após itens"
        value={formatPtBrCurrency(snapshot.totals.netAfterLineDiscountAmount)}
      />
      <SummaryRow
        label="Desconto geral"
        value={`− ${formatPtBrCurrency(snapshot.totals.overallDiscountAmount)}`}
      />
      <SummaryRow
        label="Mercadorias líquidas"
        value={formatPtBrCurrency(snapshot.totals.netMerchandiseAmount)}
      />
      {snapshot.totals.taxTotals.map((tax) => (
        <TaxTotalRow key={tax.code} tax={tax} />
      ))}
      <SummaryRow
        label="Frete"
        value={formatPtBrCurrency(snapshot.totals.freightAmount)}
      />
      <View style={[comercialStyles.summaryRow, comercialStyles.grandTotal]}>
        <Text style={comercialStyles.grandTotalLabel}>Total do orçamento</Text>
        <Text style={comercialStyles.grandTotalValue}>
          {formatPtBrCurrency(snapshot.totals.grandTotalAmount)}
        </Text>
      </View>
    </View>
  )
}

export interface ComercialQuotePdfDocumentProps
  extends Omit<DocumentProps, 'children'> {
  readonly snapshot: QuotePdfSnapshot
}

export function ComercialQuotePdfDocument({
  snapshot,
  ...documentProps
}: ComercialQuotePdfDocumentProps) {
  return (
    <Document
      author={snapshot.branding.companyName}
      title={`${snapshot.document.quoteNumber} · Orçamento comercial`}
      subject={`Orçamento comercial para ${snapshot.client.legalName}`}
      language="pt-BR"
      {...documentProps}
    >
      <Page size="A4" style={comercialStyles.page} wrap>
        <QuotePdfHeader snapshot={snapshot} />
        <ContinuationContext snapshot={snapshot} />
        <QuotePdfFooter snapshot={snapshot} />

        <View style={comercialStyles.bodyRhythm}>
          <PdfSection title="Cliente e proposta" minPresenceAhead={170}>
            <View style={comercialStyles.leadGrid} wrap={false}>
              <View style={comercialStyles.leadClient}>
                <ClientDetails snapshot={snapshot} />
              </View>
              <View style={[pdfStyles.card, comercialStyles.leadMetadata]}>
                <QuoteMetadata snapshot={snapshot} />
              </View>
            </View>
            <RepresentativeStrip snapshot={snapshot} />
            <TermsLine snapshot={snapshot} />
          </PdfSection>

          {/* The section title, column header, and first item row are one
              unbreakable block: a page break can never leave a bare heading
              or an orphaned table header above an empty body. The title stays
              outside the items card so the card's clipping never affects it. */}
          <PdfSection minPresenceAhead={170}>
            <View wrap={false}>
              <Text style={pdfStyles.sectionTitle}>Itens do orçamento</Text>
              <View style={comercialStyles.itemsCard}>
                <View style={comercialStyles.itemHeader}>
                  <Text style={comercialStyles.itemImageColumn}>Imagem</Text>
                  <Text style={comercialStyles.itemDescriptionColumn}>Produto</Text>
                  <Text style={comercialStyles.itemValueColumn}>Valores fornecidos</Text>
                </View>
                {snapshot.items.length > 0 ? (
                  <PremiumProductRow item={snapshot.items[0]!} />
                ) : null}
              </View>
            </View>
            {snapshot.items.slice(1).map((item) => (
              <View key={item.lineId} style={comercialStyles.itemsCard} wrap={false}>
                <PremiumProductRow item={item} />
              </View>
            ))}
          </PdfSection>

          <PdfSection title="Fechamento" minPresenceAhead={210}>
            <View style={comercialStyles.summaryGrid}>
              {snapshot.notes ? (
                <View style={comercialStyles.notesColumn}>
                  <View style={comercialStyles.notesCard}>
                    <Text style={pdfStyles.metadataLabel}>Observações</Text>
                    <Text>{snapshot.notes}</Text>
                  </View>
                </View>
              ) : null}
              <ComercialFinancialSummary snapshot={snapshot} />
            </View>
          </PdfSection>

          {snapshot.signatures.length > 0 ? (
            <PdfSection title="Assinaturas" minPresenceAhead={118}>
              <View style={comercialStyles.signatures} wrap={false}>
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

/** Renders the premium commercial variant entirely on the server from an immutable snapshot. */
export function renderComercialQuotePdf(snapshot: QuotePdfSnapshot): Promise<Buffer> {
  return renderQuotePdfToBuffer(<ComercialQuotePdfDocument snapshot={snapshot} />)
}
