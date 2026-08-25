export type QuotePdfDate = `${number}-${number}-${number}`
export type QuotePdfCurrencyCode = 'BRL'
export type QuotePdfDecimal = string

export type QuotePdfEmbeddedAsset =
  | Readonly<{ kind: 'local-path'; path: string }>
  | Readonly<{ kind: 'bytes'; data: Uint8Array }>

export interface QuotePdfBrandingSnapshot {
  readonly companyName: string
  readonly companyLogo: QuotePdfEmbeddedAsset | null
  readonly industryLogo: QuotePdfEmbeddedAsset | null
}

export interface QuotePdfDocumentSnapshot {
  readonly quoteId: string
  readonly quoteNumber: string
  readonly revision: number
  readonly statusLabel: string
  readonly issuedOn: QuotePdfDate
  readonly validUntil: QuotePdfDate
  readonly currencyCode: QuotePdfCurrencyCode
}

export interface QuotePdfClientSnapshot {
  readonly legalName: string
  readonly tradeName: string | null
  readonly taxId: string | null
  readonly stateRegistration: string | null
  readonly contactName: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly addressLines: readonly string[]
}

export interface QuotePdfRepresentativeSnapshot {
  readonly name: string
  readonly role: string
  readonly email: string | null
  readonly phone: string | null
}

export interface QuotePdfIndustrySnapshot {
  readonly legalName: string
  readonly tradeName: string | null
  readonly taxId: string | null
}

export interface QuotePdfTermsSnapshot {
  readonly validityLabel: string
  readonly paymentTerms: string
  readonly freightTerms: string
  readonly carrierName: string | null
  readonly deliveryEstimate: string | null
}

export interface QuotePdfTaxLineSnapshot {
  readonly code: string
  readonly label: string
  readonly rate: QuotePdfDecimal
  readonly basisAmount: QuotePdfDecimal
  readonly amount: QuotePdfDecimal
  readonly includedInGrandTotal: boolean
}

export interface QuotePdfItemSnapshot {
  readonly lineId: string
  readonly position: number
  readonly internalCode: string
  readonly manufacturerCode: string | null
  readonly description: string
  readonly brand: string | null
  readonly unit: string
  readonly packaging: string | null
  readonly quantity: QuotePdfDecimal
  readonly unitPriceAmount: QuotePdfDecimal
  readonly grossAmount: QuotePdfDecimal
  readonly lineDiscountRate: QuotePdfDecimal
  readonly lineDiscountAmount: QuotePdfDecimal
  readonly overallDiscountAllocationAmount: QuotePdfDecimal
  readonly netMerchandiseAmount: QuotePdfDecimal
  readonly taxLines: readonly Readonly<QuotePdfTaxLineSnapshot>[]
  readonly lineTotalAmount: QuotePdfDecimal
  readonly image: QuotePdfEmbeddedAsset | null
}

export interface QuotePdfTaxTotalSnapshot {
  readonly code: string
  readonly label: string
  readonly basisAmount: QuotePdfDecimal
  readonly amount: QuotePdfDecimal
  readonly includedInGrandTotal: boolean
}

export interface QuotePdfTotalsSnapshot {
  readonly grossItemsAmount: QuotePdfDecimal
  readonly lineDiscountAmount: QuotePdfDecimal
  readonly netAfterLineDiscountAmount: QuotePdfDecimal
  readonly overallDiscountAmount: QuotePdfDecimal
  readonly netMerchandiseAmount: QuotePdfDecimal
  readonly taxTotals: readonly Readonly<QuotePdfTaxTotalSnapshot>[]
  readonly freightAmount: QuotePdfDecimal
  readonly grandTotalAmount: QuotePdfDecimal
}

export interface QuotePdfSignatureSnapshot {
  readonly label: string
  readonly name: string | null
  readonly role: string | null
}

/**
 * Complete immutable render input. Values are copied from the persisted quote
 * revision; PDF code must display them verbatim and must never reprice or total.
 */
export interface QuotePdfSnapshot {
  readonly document: Readonly<QuotePdfDocumentSnapshot>
  readonly client: Readonly<QuotePdfClientSnapshot>
  readonly representative: Readonly<QuotePdfRepresentativeSnapshot>
  readonly industry: Readonly<QuotePdfIndustrySnapshot> | null
  readonly terms: Readonly<QuotePdfTermsSnapshot>
  readonly items: readonly Readonly<QuotePdfItemSnapshot>[]
  readonly totals: Readonly<QuotePdfTotalsSnapshot>
  readonly notes: string | null
  readonly signatures: readonly Readonly<QuotePdfSignatureSnapshot>[]
  readonly branding: Readonly<QuotePdfBrandingSnapshot>
}
