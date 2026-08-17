export {
  ClientDetails,
  FinancialSummary,
  HardPageBreak,
  KeepTogether,
  OrphanGuard,
  PdfSection,
  ProductImage,
  ProductItem,
  QuoteMetadata,
  QuotePdfFooter,
  QuotePdfFoundationDocument,
  QuotePdfHeader,
  SignatureBlock,
  pdfPalette,
  pdfStyles,
  type PdfSectionProps,
  type QuotePdfFoundationDocumentProps,
} from './components'
export {
  formatPtBrCurrency,
  formatPtBrDate,
  formatPtBrDecimal,
  type PtBrDecimalFormatOptions,
} from './format'
export {
  getBundledPdfAssets,
  registerBundledPdfFonts,
  resolvePdfImageSource,
} from './assets.server'
export { renderQuotePdfToBuffer } from './render.server'
export {
  ResumidaQuotePdfDocument,
  renderResumidaQuotePdf,
  type ResumidaQuotePdfDocumentProps,
} from './resumida.server'
export type {
  QuotePdfBrandingSnapshot,
  QuotePdfClientSnapshot,
  QuotePdfCurrencyCode,
  QuotePdfDate,
  QuotePdfDecimal,
  QuotePdfDocumentSnapshot,
  QuotePdfEmbeddedAsset,
  QuotePdfIndustrySnapshot,
  QuotePdfItemSnapshot,
  QuotePdfRepresentativeSnapshot,
  QuotePdfSignatureSnapshot,
  QuotePdfSnapshot,
  QuotePdfTaxLineSnapshot,
  QuotePdfTaxTotalSnapshot,
  QuotePdfTermsSnapshot,
  QuotePdfTotalsSnapshot,
} from './types'
