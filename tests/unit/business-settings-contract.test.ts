import { describe, expect, it } from 'vitest'
import {
  businessSettingsSchema,
  issuedDocumentSettingsSnapshotSchema,
  settingsRecordSchema,
  settingsUpdateInputSchema,
} from '@/domain/settings/business-settings'

const validSettings = {
  business: {
    displayName: '  Weyne Representações  ',
    legalName: '  Weyne Representações Ltda.  ',
    taxId: '41.142.260/0001-89',
    email: '  CONTATO@WEYNE.COM.BR  ',
    phone: '+55 (11) 98273-1182',
    address: {
      street: '  Rua das Flores  ',
      number: '  120  ',
      complement: '  Sala 4  ',
      district: '  Centro  ',
      city: '  Recife  ',
      state: 'pe',
      postalCode: '02998-050',
      countryCode: 'br',
    },
  },
  documents: {
    logoAssetId: 'ec0767ea-a5fe-4f6d-a4fe-8d2972c7d913',
    defaultQuoteValidityDays: 15,
    defaultPaymentTerms: '  30 dias  ',
    defaultFreightTerms: '  CIF  ',
    numberingDisplay: {
      quotePrefix: 'orc',
      orderPrefix: 'ped',
      separator: '-',
      yearDigits: 4,
      sequenceDigits: 6,
    },
    priceListLabels: ['  Varejo  ', 'Atacado', 'Especial', 'Promocional'],
    pdfFooterText: '  Obrigado pela preferência.  ',
    pdfSignatureText: '  Weyne Representações  ',
  },
}

describe('business settings contract', () => {
  it('normalizes canonical business and document settings', () => {
    expect(businessSettingsSchema.parse(validSettings)).toEqual({
      business: {
        displayName: 'Weyne Representações',
        legalName: 'Weyne Representações Ltda.',
        taxId: '41142260000189',
        email: 'contato@weyne.com.br',
        phone: '11982731182',
        address: {
          street: 'Rua das Flores',
          number: '120',
          complement: 'Sala 4',
          district: 'Centro',
          city: 'Recife',
          state: 'PE',
          postalCode: '02998050',
          countryCode: 'BR',
        },
      },
      documents: {
        logoAssetId: 'ec0767ea-a5fe-4f6d-a4fe-8d2972c7d913',
        defaultQuoteValidityDays: 15,
        defaultPaymentTerms: '30 dias',
        defaultFreightTerms: 'CIF',
        numberingDisplay: {
          quotePrefix: 'ORC',
          orderPrefix: 'PED',
          separator: '-',
          yearDigits: 4,
          sequenceDigits: 6,
        },
        priceListLabels: ['Varejo', 'Atacado', 'Especial', 'Promocional'],
        pdfFooterText: 'Obrigado pela preferência.',
        pdfSignatureText: 'Weyne Representações',
      },
    })
  })

  it('applies safe document defaults without inventing business identity', () => {
    expect(
      businessSettingsSchema.parse({
        business: {
          displayName: 'Weyne Representações',
          legalName: 'Weyne Representações Ltda.',
          taxId: null,
          email: 'contato@weyne.com.br',
          phone: null,
          address: null,
        },
        documents: {},
      }),
    ).toEqual({
      business: {
        displayName: 'Weyne Representações',
        legalName: 'Weyne Representações Ltda.',
        taxId: null,
        email: 'contato@weyne.com.br',
        phone: null,
        address: null,
      },
      documents: {
        logoAssetId: null,
        defaultQuoteValidityDays: 15,
        defaultPaymentTerms: null,
        defaultFreightTerms: null,
        numberingDisplay: {
          quotePrefix: 'ORC',
          orderPrefix: 'PED',
          separator: '-',
          yearDigits: 4,
          sequenceDigits: 6,
        },
        priceListLabels: ['Preço 1', 'Preço 2', 'Preço 3', 'Preço 4'],
        pdfFooterText: null,
        pdfSignatureText: null,
      },
    })
  })

  it('normalizes empty optional business values to null', () => {
    expect(
      businessSettingsSchema.parse({
        business: {
          displayName: 'Weyne Representações',
          legalName: 'Weyne Representações Ltda.',
          taxId: '  ',
          email: ' contato@weyne.com.br ',
          phone: '',
          address: null,
        },
        documents: {},
      }).business,
    ).toMatchObject({ taxId: null, phone: null })
  })

  it('requires at least one business contact and unique price-list labels', () => {
    const result = businessSettingsSchema.safeParse({
      business: {
        displayName: 'Weyne Representações',
        legalName: 'Weyne Representações Ltda.',
        taxId: null,
        email: null,
        phone: null,
        address: null,
      },
      documents: {
        priceListLabels: ['Varejo', 'Atacado', ' varejo ', 'Especial'],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        'Informe ao menos um e-mail ou telefone',
        'Os quatro rótulos de tabela de preço devem ser únicos',
      ])
    }
  })

  it('rejects unknown fields, feature flags, secrets, and mutable counters', () => {
    for (const unknownDocumentsField of [
      { featureFlags: { digitalSignature: true } },
      { nextQuoteNumber: 42 },
      { smtpPassword: 'secret' },
    ]) {
      expect(
        businessSettingsSchema.safeParse({
          ...validSettings,
          documents: {
            ...validSettings.documents,
            ...unknownDocumentsField,
          },
        }).success,
      ).toBe(false)
    }

    expect(
      businessSettingsSchema.safeParse({
        ...validSettings,
        publicLandingContent: { headline: 'Não pertence a este contrato' },
      }).success,
    ).toBe(false)
  })

  it('enforces field limits and the fixed canonical numbering display', () => {
    expect(
      businessSettingsSchema.safeParse({
        ...validSettings,
        business: { ...validSettings.business, displayName: 'x'.repeat(121) },
      }).success,
    ).toBe(false)
    expect(
      businessSettingsSchema.safeParse({
        ...validSettings,
        documents: {
          ...validSettings.documents,
          defaultQuoteValidityDays: 366,
        },
      }).success,
    ).toBe(false)
    expect(
      businessSettingsSchema.safeParse({
        ...validSettings,
        documents: {
          ...validSettings.documents,
          numberingDisplay: {
            ...validSettings.documents.numberingDisplay,
            quotePrefix: 'CUSTOM',
          },
        },
      }).success,
    ).toBe(false)
  })

  it('defines optimistic-concurrency metadata for API consumers', () => {
    const record = {
      settings: validSettings,
      version: 3,
      updatedAt: '2026-08-17T12:00:00.000Z',
      updatedByUserId: '14ea395b-48e6-4567-b851-7cfa6f7375a4',
    }

    expect(settingsRecordSchema.parse(record)).toMatchObject({ version: 3 })
    expect(
      settingsUpdateInputSchema.parse({
        expectedVersion: 3,
        settings: validSettings,
      }),
    ).toMatchObject({ expectedVersion: 3 })
    expect(
      settingsUpdateInputSchema.safeParse({
        expectedVersion: 0,
        settings: validSettings,
      }).success,
    ).toBe(false)
  })

  it('validates the values snapshotted onto an issued document', () => {
    expect(
      issuedDocumentSettingsSnapshotSchema.parse({
        business: businessSettingsSchema.parse(validSettings).business,
        logoAssetId: validSettings.documents.logoAssetId,
        paymentTerms: '30 dias',
        freightTerms: 'CIF',
        priceList: { key: 'PRICE_2', label: 'Atacado' },
        pdfFooterText: 'Obrigado pela preferência.',
        pdfSignatureText: 'Weyne Representações',
      }),
    ).toMatchObject({
      priceList: { key: 'PRICE_2', label: 'Atacado' },
    })
  })
})
