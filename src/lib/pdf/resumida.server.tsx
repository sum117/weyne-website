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
  formatPtBrDecimal,
} from './format'
import { renderQuotePdfToBuffer } from './render.server'
import type {
  QuotePdfItemSnapshot,
  QuotePdfSnapshot,
  QuotePdfTaxTotalSnapshot,
} from './types'

const resumidaStyles = StyleSheet.create({
  page: {
    ...pdfStyles.page,
    paddingTop: 116,
  },
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
    width: 238,
  },
  termsStrip: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: pdfPalette.navy,
    borderRadius: 7,
    color: pdfPalette.white,
  },
  validity: {
    fontSize: 9,
    fontWeight: 600,
  },
  representative: {
    marginTop: 3,
    color: pdfPalette.sand,
    fontSize: 7.5,
  },
  itemsCard: {
    ...pdfStyles.card,
    padding: 0,
    overflow: 'hidden',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
    paddingHorizontal: 9,
    backgroundColor: pdfPalette.navy,
    color: pdfPalette.white,
    fontSize: 6.5,
    fontWeight: 600,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 9,
    borderBottomWidth: 1,
    borderBottomColor: pdfPalette.line,
  },
  itemImageColumn: {
    width: 58,
  },
  itemDescriptionColumn: {
    flexGrow: 1,
    flexBasis: 0,
  },
  itemDescription: {
    color: pdfPalette.navy,
    fontSize: 8.75,
    fontWeight: 600,
    lineHeight: 1.28,
  },
  itemMeta: {
    marginTop: 2,
    color: pdfPalette.muted,
    fontSize: 6.75,
    lineHeight: 1.32,
  },
  itemValueColumn: {
    width: 142,
    alignItems: 'flex-end',
  },
  itemTotal: {
    color: pdfPalette.blue,
    fontSize: 10,
    fontWeight: 600,
  },
  itemValue: {
    marginTop: 2,
    color: pdfPalette.muted,
    fontSize: 6.75,
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
    width: 258,
  },
  summaryOnly: {
    marginLeft: 'auto',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3,
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
    marginTop: 5,
    paddingTop: 7,
    borderTopWidth: 2,
    borderTopColor: pdfPalette.sand,
  },
  grandTotalLabel: {
    color: pdfPalette.navy,
    fontSize: 9.5,
    fontWeight: 600,
  },
  grandTotalValue: {
    color: pdfPalette.blue,
    fontSize: 14,
    fontWeight: 600,
  },
})

const compactClientName = (snapshot: QuotePdfSnapshot) =>
  snapshot.client.tradeName ?? snapshot.client.legalName

function ContinuationContext({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  return (
    <View fixed style={resumidaStyles.continuationContext}>
      <Text style={resumidaStyles.continuationClient}>
        Cliente · {compactClientName(snapshot)}
      </Text>
      <Text>{snapshot.terms.validityLabel}</Text>
    </View>
  )
}

function TermsStrip({ snapshot }: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  const representativeContact = [
    snapshot.representative.name,
    snapshot.representative.role,
    snapshot.representative.email,
    snapshot.representative.phone,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={resumidaStyles.termsStrip} wrap={false}>
      <Text style={resumidaStyles.validity}>{snapshot.terms.validityLabel}</Text>
      <Text style={resumidaStyles.representative}>{representativeContact}</Text>
    </View>
  )
}

function ItemTaxDetails({ item }: Readonly<{ item: QuotePdfItemSnapshot }>) {
  if (item.taxLines.length === 0) return null

  return (
    <Text style={resumidaStyles.itemValue}>
      {item.taxLines
        .map(
          (tax) =>
            `${tax.label} ${formatPtBrDecimal(tax.rate, { maximumFractionDigits: 6 })}% · ${formatPtBrCurrency(tax.amount)}`,
        )
        .join(' · ')}
    </Text>
  )
}

function CompactProductRow({ item }: Readonly<{ item: QuotePdfItemSnapshot }>) {
  const codes = [item.internalCode, item.manufacturerCode].filter(Boolean).join(' · ')
  const identity = [item.brand, item.packaging, item.unit].filter(Boolean).join(' · ')

  return (
    <View style={resumidaStyles.itemRow} wrap={false} minPresenceAhead={78}>
      <View style={resumidaStyles.itemImageColumn}>
        <ProductImage item={item} />
      </View>
      <View style={resumidaStyles.itemDescriptionColumn}>
        <Text style={resumidaStyles.itemDescription}>
          {item.position}. {item.description}
        </Text>
        <Text style={resumidaStyles.itemMeta}>{codes}</Text>
        {identity ? <Text style={resumidaStyles.itemMeta}>{identity}</Text> : null}
      </View>
      <View style={resumidaStyles.itemValueColumn}>
        <Text style={resumidaStyles.itemTotal}>
          {formatPtBrCurrency(item.lineTotalAmount)}
        </Text>
        <Text style={resumidaStyles.itemValue}>
          {formatPtBrDecimal(item.quantity, { maximumFractionDigits: 6 })} {item.unit} ×{' '}
          {formatPtBrCurrency(item.unitPriceAmount)}
        </Text>
        <Text style={resumidaStyles.itemValue}>
          Bruto {formatPtBrCurrency(item.grossAmount)} · desconto do item{' '}
          {formatPtBrDecimal(item.lineDiscountRate, { maximumFractionDigits: 6 })}% (
          {formatPtBrCurrency(item.lineDiscountAmount)})
        </Text>
        <Text style={resumidaStyles.itemValue}>
          Rateio desconto geral {formatPtBrCurrency(item.overallDiscountAllocationAmount)} · líquido{' '}
          {formatPtBrCurrency(item.netMerchandiseAmount)}
        </Text>
        <ItemTaxDetails item={item} />
      </View>
    </View>
  )
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={resumidaStyles.summaryRow}>
      <Text style={resumidaStyles.summaryLabel}>{label}</Text>
      <Text style={resumidaStyles.summaryValue}>{value}</Text>
    </View>
  )
}

function TaxTotal({ tax }: Readonly<{ tax: QuotePdfTaxTotalSnapshot }>) {
  return (
    <View>
      <SummaryRow label={tax.label} value={formatPtBrCurrency(tax.amount)} />
      <Text style={resumidaStyles.summaryDetail}>
        Base {formatPtBrCurrency(tax.basisAmount)}
        {tax.includedInGrandTotal ? '' : ' · informativo, não incluído no total'}
      </Text>
    </View>
  )
}

function ResumidaFinancialSummary({
  snapshot,
}: Readonly<{ snapshot: QuotePdfSnapshot }>) {
  return (
    <View
      style={[
        resumidaStyles.summaryCard,
        snapshot.notes ? {} : resumidaStyles.summaryOnly,
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
        <TaxTotal key={tax.code} tax={tax} />
      ))}
      <SummaryRow
        label="Frete"
        value={formatPtBrCurrency(snapshot.totals.freightAmount)}
      />
      <View style={[resumidaStyles.summaryRow, resumidaStyles.grandTotal]}>
        <Text style={resumidaStyles.grandTotalLabel}>Total do orçamento</Text>
        <Text style={resumidaStyles.grandTotalValue}>
          {formatPtBrCurrency(snapshot.totals.grandTotalAmount)}
        </Text>
      </View>
    </View>
  )
}

export interface ResumidaQuotePdfDocumentProps
  extends Omit<DocumentProps, 'children'> {
  readonly snapshot: QuotePdfSnapshot
}

export function ResumidaQuotePdfDocument({
  snapshot,
  ...documentProps
}: ResumidaQuotePdfDocumentProps) {
  return (
    <Document
      author={snapshot.branding.companyName}
      title={`${snapshot.document.quoteNumber} · Orçamento resumido`}
      subject={`Orçamento resumido para ${snapshot.client.legalName}`}
      language="pt-BR"
      {...documentProps}
    >
      <Page size="A4" style={resumidaStyles.page} wrap>
        <QuotePdfHeader snapshot={snapshot} />
        <ContinuationContext snapshot={snapshot} />
        <QuotePdfFooter snapshot={snapshot} />

        <PdfSection title="Cliente e condições" minPresenceAhead={150}>
          <View style={resumidaStyles.leadGrid} wrap={false}>
            <View style={resumidaStyles.leadClient}>
              <ClientDetails snapshot={snapshot} />
            </View>
            <View style={[pdfStyles.card, resumidaStyles.leadMetadata]}>
              <QuoteMetadata snapshot={snapshot} />
            </View>
          </View>
          <TermsStrip snapshot={snapshot} />
        </PdfSection>

        <PdfSection title="Itens do orçamento" minPresenceAhead={118}>
          <View style={resumidaStyles.itemsCard}>
            <View style={resumidaStyles.itemHeader} wrap={false}>
              <Text style={resumidaStyles.itemImageColumn}>Imagem</Text>
              <Text style={resumidaStyles.itemDescriptionColumn}>Produto</Text>
              <Text style={resumidaStyles.itemValueColumn}>Valores fornecidos</Text>
            </View>
            {snapshot.items.map((item) => (
              <CompactProductRow key={item.lineId} item={item} />
            ))}
          </View>
        </PdfSection>

        <PdfSection title="Fechamento" minPresenceAhead={190}>
          <View style={resumidaStyles.summaryGrid}>
            {snapshot.notes ? (
              <View style={resumidaStyles.notesColumn}>
                <View style={resumidaStyles.notesCard}>
                  <Text style={pdfStyles.metadataLabel}>Observações</Text>
                  <Text>{snapshot.notes}</Text>
                </View>
              </View>
            ) : null}
            <ResumidaFinancialSummary snapshot={snapshot} />
          </View>
        </PdfSection>

        {snapshot.signatures.length > 0 ? (
          <PdfSection title="Assinaturas" minPresenceAhead={112}>
            <View style={pdfStyles.signatures} wrap={false}>
              {snapshot.signatures.map((signature) => (
                <SignatureBlock key={signature.label} signature={signature} />
              ))}
            </View>
          </PdfSection>
        ) : null}
      </Page>
    </Document>
  )
}

/** Renders the concise variant entirely on the server from an immutable snapshot. */
export function renderResumidaQuotePdf(snapshot: QuotePdfSnapshot): Promise<Buffer> {
  return renderQuotePdfToBuffer(<ResumidaQuotePdfDocument snapshot={snapshot} />)
}
