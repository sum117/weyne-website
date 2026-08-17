# Contrato de cálculo do orçamento

Status: contrato autoritativo da Fase 1 para o motor puro de cálculo

Idioma de negócio e UI: pt-BR

Nomes de código, tipos e campos: inglês

Fontes: `project-pdf-requirements-inventory.md`, `canonical-glossary-er-model.md`, `quote-order-workflow-contract.md`, schema de catálogo em `src/lib/db/schema/catalog.ts`

## 1. Escopo, limites e precedência

Este documento fecha as decisões que a fonte deixou ambíguas para permitir testes tabulares e uma implementação determinística. As fórmulas são defaults técnicos da Fase 1, não regras fiscais atribuídas ao PDF original.

Este documento prevalece sobre fórmulas ou escalas divergentes nos documentos irmãos para o **motor puro de cálculo**. O contrato de workflow continua autoritativo para estados, snapshots, permissões, conversão e imutabilidade.

O motor:

- recebe snapshots completos; não consulta banco, produto, indústria, tabela de preço, configuração, rede ou relógio;
- não possui comportamento diferente para produto, indústria, regra ou tabela arquivados;
- calcula IPI, ICMS, PIS e COFINS como percentuais comerciais transparentes;
- não implementa base legal por UF, CST, crédito, substituição tributária, DIFAL, retenção, composição entre tributos, emissão fiscal ou integração ERP/SEFAZ;
- não declara comissão adquirida, aprovada, devida ou paga; apenas calcula o valor comercial projetado do snapshot recebido.

## 2. Representação Decimal

### 2.1 Transporte e precisão

Todos os Decimals entram e saem como strings canônicas em base 10. `number`, `parseFloat`, `Math.round`, notação exponencial e coerção IEEE-754 são proibidos.

Uma string canônica:

- usa `.` como separador decimal;
- não usa separador de milhar, vírgula, expoente ou sinal `+`;
- usa `-` somente quando o tipo permitir; nenhum input deste contrato permite valor negativo;
- é normalizada na saída (`0.00` para dinheiro, escala fixa da seção 2.2 para demais snapshots quando persistidos).

A biblioteca Decimal DEVE usar precisão de contexto de pelo menos 34 dígitos e `ROUND_HALF_UP`. Operações intermediárias não são arredondadas, salvo nos pontos explicitamente listados.

### 2.2 Escalas e intervalos

| Conceito | Entrada/persistência | Intervalo | Saída publicada |
|---|---:|---:|---:|
| `quantity` | `DECIMAL(18,6)` | `> 0` | snapshot original, até 6 casas |
| `unitPrice` | `DECIMAL(19,6)` | `>= 0` | snapshot original, até 6 casas |
| qualquer taxa | `DECIMAL(9,6)` | `0..100` inclusivo | snapshot original, até 6 casas |
| dinheiro calculado | intermediário Decimal | `>= 0` | `DECIMAL(19,2)` |
| `freightAmount` | Decimal não negativo | `>= 0` | `DECIMAL(19,2)` após arredondamento |

Preço com quatro casas é, portanto, um caso válido do limite de seis casas já adotado pelo schema (`product_prices.amount`). Quantidade fracionária também preserva até seis casas. Excesso de precisão/escala, overflow, `NaN`, infinito, vazio, negativo ou taxa fora do intervalo falha; nunca é truncado silenciosamente.

### 2.3 Pontos fechados de arredondamento

Arredondar para duas casas, com `ROUND_HALF_UP`, somente em:

1. `grossAmount` de cada linha;
2. `lineDiscountAmount` de cada linha;
3. `overallDiscountAmount` do documento;
4. cada cota monetária de desconto geral após a distribuição de centavos;
5. cada `taxAmount` por código e por linha;
6. cada `commissionValue` por linha;
7. `freightAmount` recebido.

Somas de valores já monetários são exatas em centavos e NÃO são arredondadas novamente. Percentuais e divisões de rateio mantêm precisão completa até o ponto de publicação.

## 3. Contrato de entrada

Forma conceitual; a implementação pode usar tipos nominais equivalentes sem mudar a semântica:

```text
QuoteCalculationInput {
  currencyCode: "BRL"
  overallDiscountRate?: DecimalString       // default "0"
  freightAmount?: DecimalString             // default "0"
  lines: QuoteCalculationLineInput[]
}

QuoteCalculationLineInput {
  lineId: string                            // não vazio, único no documento
  position: positive integer                // único no documento
  quantity: DecimalString
  unitPriceSnapshot: {
    productId: string
    productPriceId: string
    priceListId: string
    currencyCode: "BRL"
    amount: DecimalString
    productArchived?: boolean               // metadado opaco, não muda cálculo
    priceListArchived?: boolean             // metadado opaco, não muda cálculo
  }
  lineDiscountRate?: DecimalString           // default "0"
  taxRates?: {
    ipi?: DecimalString
    icms?: DecimalString
    pis?: DecimalString
    cofins?: DecimalString
  }
  commission: {
    productOverrideRate?: DecimalString | null
    industryDefaultRate?: DecimalString | null
  }
}
```

Regras de borda:

- somente `BRL` é aceito na Fase 1 e toda linha deve ter a mesma moeda do documento;
- `lines: []` é válido para prévia de rascunho; o workflow continua proibindo envio sem linha;
- a ordem do array não possui significado; a ordem canônica é `(position ASC, lineId ASC)`;
- `lineId` e `position` duplicados falham;
- descontos da Fase 1 são somente percentuais; valor fixo exige nova versão do contrato;
- `null` e ausência de taxa tributária significam “não configurada”; taxa `0` é configurada e deve aparecer no resultado;
- estado de arquivo é apenas metadado de snapshot. O motor não valida atividade e não procura preço/produto corrente.

## 4. Contrato de saída auditável

```text
QuoteCalculationResult {
  currencyCode: "BRL"
  lines: QuoteCalculationLineResult[]       // ordem canônica
  grossAmount: Money
  lineDiscountAmount: Money
  netAfterLineDiscountAmount: Money
  overallDiscountAmount: Money
  netMerchandiseAmount: Money
  taxes: TaxTotal[]
  freightAmount: Money
  grandTotalAmount: Money
  commissionBasisAmount: Money
  commissionValueAmount: Money
}

QuoteCalculationLineResult {
  lineId: string
  position: integer
  quantity: DecimalString
  unitPriceSnapshot: same input snapshot
  grossAmount: Money
  lineDiscountRate: Rate
  lineDiscountAmount: Money
  netAfterLineDiscountAmount: Money
  overallDiscountRate: Rate
  overallDiscountAllocationAmount: Money
  netMerchandiseAmount: Money
  taxes: TaxLine[]
  commissionSource: "product_override" | "industry_default" | "none"
  commissionRate: Rate | null
  commissionBasisAmount: Money
  commissionValueAmount: Money | null
}

TaxLine {
  code: "ipi" | "icms" | "pis" | "cofins"
  rate: Rate
  basisAmount: Money
  amount: Money
  includedInGrandTotal: false
}

TaxTotal {
  code: same TaxLine.code
  basisAmount: Money
  amount: Money
  includedInGrandTotal: false
}
```

`Money` sempre possui duas casas. Totais tributários existem somente para códigos configurados em ao menos uma linha, em ordem fixa `ipi`, `icms`, `pis`, `cofins`. Sua base agrega apenas as linhas em que o código foi configurado. Taxa zero configurada produz base e valor `0.00`; taxa ausente não cria entrada.

## 5. Ordem normativa do cálculo

Calcular as linhas em ordem canônica.

### 5.1 Preço e desconto por linha

Para cada linha `i`:

```text
gross[i] = round2(quantity[i] * unitPrice[i])
lineDiscount[i] = round2(gross[i] * lineDiscountRate[i] / 100)
afterLineDiscount[i] = gross[i] - lineDiscount[i]
```

Depois:

```text
grossAmount = sum(gross[i])
lineDiscountAmount = sum(lineDiscount[i])
netAfterLineDiscountAmount = sum(afterLineDiscount[i])
```

O desconto de linha nunca excede seu bruto porque a taxa está limitada a 100.

### 5.2 Desconto geral e rateio

```text
overallDiscountAmount = round2(
  netAfterLineDiscountAmount * overallDiscountRate / 100
)
```

O valor é alocado proporcionalmente a `afterLineDiscount[i]` pelo método dos maiores restos:

1. se `netAfterLineDiscountAmount = 0`, toda cota é `0.00`;
2. para cada linha positiva, calcular a cota ideal sem arredondar:
   `ideal[i] = overallDiscountAmount * afterLineDiscount[i] / netAfterLineDiscountAmount`;
3. definir `floor[i]` como `ideal[i]` truncado para baixo a centavos;
4. calcular `remainder[i] = ideal[i] - floor[i]`;
5. calcular os centavos restantes:
   `(overallDiscountAmount - sum(floor[i])) / 0.01`;
6. distribuir um centavo por linha em ordem de `remainder DESC`, depois `position ASC`, depois `lineId ASC`, repetindo a ordem somente se matematicamente necessário;
7. `overallDiscountAllocation[i] = floor[i] + centavos recebidos`.

Como a taxa máxima é 100 e a base é não negativa, nenhuma cota pode ultrapassar `afterLineDiscount[i]`.

```text
netMerchandise[i] = afterLineDiscount[i] - overallDiscountAllocation[i]
netMerchandiseAmount = sum(netMerchandise[i])
```

Invariantes obrigatórias:

```text
sum(overallDiscountAllocation[i]) = overallDiscountAmount
sum(netMerchandise[i]) = netAfterLineDiscountAmount - overallDiscountAmount
```

### 5.3 Tributos comerciais transparentes

Cada taxa configurada é independente e usa a mercadoria líquida após ambos os descontos:

```text
taxBasis[i, code] = netMerchandise[i]
taxAmount[i, code] = round2(taxBasis[i, code] * taxRate[i, code] / 100)
```

Não existe composição, desconto de um tributo na base de outro ou regra por UF/NCM/CEST. Os totais por código somam bases e valores de linha já publicados:

```text
taxTotalBasis[code] = sum(configured taxBasis[i, code])
taxTotalAmount[code] = sum(configured taxAmount[i, code])
```

IPI, ICMS, PIS e COFINS são informativos e **não entram no total geral da Fase 1**. Isso preserva o menor comportamento vigente enquanto torna os valores auditáveis.

### 5.4 Frete e total geral

```text
freightAmount = round2(input freightAmount or 0)
grandTotalAmount = netMerchandiseAmount + freightAmount
```

Frete:

- é aplicado uma vez no cabeçalho;
- não recebe desconto de linha ou geral;
- não é rateado entre linhas;
- não integra base tributária nem base de comissão;
- pode existir numa prévia vazia; nesse caso o total geral é o próprio frete.

### 5.5 Precedência e cálculo da comissão

Resolver por linha, usando somente os dois valores recebidos:

```text
if productOverrideRate is not null/absent:
  source = product_override
  rate = productOverrideRate
else if industryDefaultRate is not null/absent:
  source = industry_default
  rate = industryDefaultRate
else:
  source = none
  rate = null
```

Taxa zero é override/default configurado e nunca equivale a ausência.

```text
commissionBasis[i] = netMerchandise[i]
commissionValue[i] = rate is null
  ? null
  : round2(commissionBasis[i] * rate / 100)

commissionBasisAmount = sum(commissionBasis[i])
commissionValueAmount = sum(commissionValue[i] or 0.00)
```

A base exclui descontos já aplicados, tributos informativos e frete. O total de base permanece a mercadoria líquida mesmo quando alguma linha não possui taxa; a ausência fica explícita em `commissionValue = null`, enquanto o total monetário soma apenas valores calculados.

## 6. Tabela de decisões e erros

| Caso | Regra determinística |
|---|---|
| quote vazio | resultado válido; somas `0.00`; sem linhas/taxes; frete ainda é aplicado |
| preço/taxa/quantidade com escala excessiva | erro `INVALID_DECIMAL`; não truncar |
| taxa fora de `0..100` | erro `INVALID_DECIMAL` |
| desconto de linha `100` | linha líquida `0.00`; impostos e comissão calculável resultam `0.00` |
| desconto geral `100` | todo líquido pós-linha é alocado; mercadoria líquida `0.00` |
| moeda divergente ou não BRL | erro `CURRENCY_MISMATCH` |
| `lineId`/`position` duplicado | erro `DUPLICATE_LINE_KEY` |
| snapshot arquivado | calcular normalmente, sem lookup vivo |
| taxa tributária ausente | não emitir entrada daquele código para a linha |
| comissão override `0`, default positivo | usar `0`, fonte `product_override` |
| comissão override ausente | usar default; se também ausente, `null`/`none` |
| overflow em resultado monetário | erro `INVALID_DECIMAL` |
| total ou cota negativa por violação interna | erro `CALCULATION_INVARIANT` |

Erros não retornam resultado parcial.

## 7. Vetores mínimos para testes tabulares

Todos os valores abaixo usam BRL e taxas omitidas equivalem a zero/ausência conforme o campo.

| Caso | Entrada essencial | Resultado obrigatório |
|---|---|---|
| meia unidade, preço de 4 casas | `qty=0.500000`, `unit=10.0050` | `gross=5.00` (`5.0025` → half-up) |
| arredondamento half-up | `qty=3`, `unit=10.0050` | `gross=30.02` |
| desconto máximo | bruto `30.02`, linha `100%` | desconto `30.02`, líquido `0.00` |
| resto empatado | três linhas líquidas `0.01`, geral `33.333333%` | total `0.01`; posição menor recebe `0.01` |
| resto não empatado | linhas líquidas `0.01` e `0.02`, geral `50%` | total `0.02`; cotas `0.01` e `0.01` pelo maior resto |
| taxa comercial | líquido pós-descontos `100.00`, IPI `5.125%` | base `100.00`, IPI `5.13`, `includedInGrandTotal=false` |
| frete | mercadoria líquida `90.00`, frete `12.345` | frete `12.35`, total geral `102.35` |
| override zero | base `100.00`, override `0`, default `5` | fonte override, valor `0.00` |
| default | base `100.00`, override ausente, default `5` | fonte default, valor `5.00` |
| sem comissão | base `100.00`, ambas ausentes | fonte none, valor de linha `null`, total `0.00` |
| snapshot arquivado | flags de arquivo verdadeiros com preço `50.0000` | mesmo resultado do snapshot ativo; nenhum lookup |

Cada teste DEVE comparar strings Decimal exatas, nunca tolerância aproximada.

## 8. Checklist de integridade do resultado

Uma validação de snapshot/replay deve verificar, sem consultar catálogo:

1. linhas na ordem canônica e chaves únicas;
2. fórmulas de bruto, descontos e líquido em cada linha;
3. soma exata do rateio do desconto geral;
4. base e valor de cada taxa configurada;
5. precedência, base e valor de comissão;
6. somas de cabeçalho iguais às linhas publicadas;
7. `grandTotalAmount = netMerchandiseAmount + freightAmount`;
8. todos os valores monetários com duas casas e dentro de `DECIMAL(19,2)`;
9. cópia integral dos snapshots de entrada no resultado, sem substituição por dados correntes.
