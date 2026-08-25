# Contrato canônico de configurações do negócio e documentos

Status: decisão normativa da Fase 1. O schema executável está em
`src/domain/settings/business-settings.ts`.

## Limite do contrato

Este contrato pertence ao aplicativo administrativo. Ele não substitui nem
importa o contrato público da landing page em
`src/features/landing/content.ts`. Mesmo quando os valores humanos coincidem
(nome, telefone ou e-mail), as duas fontes continuam separadas: uma mudança
administrativa não publica conteúdo no site e nenhuma configuração deste
contrato entra em `VITE_*` ou em outro ambiente público.

Não há feature flag aprovada neste contrato. Por isso o schema não possui
`featureFlags` e rejeita qualquer flag desconhecida. Segredos, credenciais,
URLs assinadas e counters mutáveis de documentos também não pertencem ao
payload. Os alocadores transacionais de numeração permanecem server-side e
fora da API de configurações.

## Forma canônica

`business` contém:

- `displayName` e `legalName`, obrigatórios;
- `taxId` (CNPJ), opcional;
- `email` e `phone`, opcionais individualmente, mas ao menos um contato é
  obrigatório;
- `address`, nulo ou objeto completo com `street`, `number`, `complement`,
  `district`, `city`, `state`, `postalCode` e `countryCode = BR`.

`documents` contém:

- `logoAssetId`, UUID de um objeto privado e imutável; nunca URL pública;
- `defaultQuoteValidityDays`, inteiro de 1 a 365, default 15;
- `defaultPaymentTerms` e `defaultFreightTerms`, textos opcionais;
- `numberingDisplay`, política canônica fixa
  `ORC-YYYY-NNNNNN`/`PED-YYYY-NNNNNN`. Ela descreve a exibição, não contém nem
  altera o próximo número;
- `priceListLabels`, tuple de exatamente quatro rótulos únicos que mapeiam,
  por posição, para `PRICE_1` até `PRICE_4`;
- `pdfFooterText` e `pdfSignatureText`, textos opcionais. A assinatura é
  somente visual e não constitui assinatura digital.

Campos opcionais de texto vazios são normalizados para `null`; nomes, rótulos
e textos são aparados; e-mail é minúsculo; UF, CNPJ, CEP, telefone, UUID e
prefixos usam suas formas canônicas. Objetos são estritos e rejeitam chaves
não reconhecidas. Os limites executáveis e mensagens pt-BR vivem no schema
Zod para serem reutilizados pela API e pela UI.

## Defaults e identidade

Os únicos defaults são técnicos e reversíveis: validade de 15 dias, logo e
textos nulos, quatro rótulos neutros (`Preço 1` a `Preço 4`) e o formato de
numeração já decidido pelo contrato de domínio. Nome, razão social e contato
não têm defaults: inventar identidade comercial é proibido.

## Concorrência

A leitura usa `settingsRecordSchema` com `settings`, `version`, `updatedAt` e
`updatedByUserId`. A escrita usa `settingsUpdateInputSchema` com o payload
completo e `expectedVersion`. `version` é inteiro positivo. A persistência
deve executar compare-and-swap atômico, incrementar a versão uma única vez e
responder conflito machine-readable quando `expectedVersion` estiver obsoleto.
Falha de validação, storage ou persistência deve preservar o último registro
válido.

## Snapshot de documentos emitidos

Ao emitir/congelar um documento, persistir os valores validados por
`issuedDocumentSettingsSnapshotSchema`:

- identidade, contatos e endereço de `business`;
- `logoAssetId` do objeto privado imutável;
- termos de pagamento e frete efetivamente aplicados;
- key e label da tabela de preço efetivamente usada;
- texto de rodapé e assinatura visual do PDF.

`defaultQuoteValidityDays` não é copiado como default: ele é materializado em
`validUntil`, que já pertence ao snapshot do quote. A política de numeração
não é copiada como configuração: o número alocado (`quoteNumber` ou
`orderNumber`) é o identificador imutável do documento. Alterar configurações
posteriormente só afeta documentos futuros; documentos emitidos e PDFs
históricos leem snapshots, nunca joins ou settings vivos.
