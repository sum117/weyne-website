# Contrato de workflow de orçamentos e pedidos

Status: contrato autoritativo da Fase 1

Idioma de negócio e UI: pt-BR

Nomes de código, schema, comandos, permissões e enums: inglês

Fonte de requisitos: `docs/domain/project-pdf-requirements-inventory.md`

## 1. Escopo e força normativa

Este documento fixa as decisões necessárias para implementar `Quote`, `QuoteLine`, `Order` e `OrderLine`. Quando a fonte não define uma regra, a escolha abaixo é um default conservador da Fase 1, não uma alegação sobre o PDF original.

Palavras **DEVE**, **NÃO DEVE** e **SOMENTE** são normativas. Todos os comandos que alteram estado DEVEM registrar `actorId`, instante do banco, estado anterior, estado novo e `commandId` no histórico.

Fora de escopo:

- `Order.status = invoiced` é somente um marco operacional informado por usuário autorizado;
- o estado `invoiced` NÃO emite nota fiscal, NÃO prova emissão fiscal, NÃO calcula tributos e NÃO integra ERP/SEFAZ;
- IPI, ICMS, PIS, COFINS, NCM e CEST são snapshots cadastrais/informativos na Fase 1;
- não existe motor tributário, financeiro, cobrança ou pagamento de comissão neste contrato.

## 2. Enums, comandos e convenções

```text
QuoteStatus = draft | sent | approved | rejected | expired | converted | cancelled
OrderStatus = open | confirmed | invoiced | completed | cancelled
ActorRole = admin | representative | read_only | system
```

Convenções:

- “próprio” significa que `ownerUserId` do documento corresponde ao usuário, ou que o documento foi explicitamente atribuído a ele. A matriz de permissões pode restringir ainda mais esse escopo, nunca ampliá-lo implicitamente.
- `admin` atua em qualquer documento quando possuir a permissão indicada.
- `representative` atua somente em documento próprio/atribuído quando possuir a variante `:own` indicada.
- `read_only` não possui nenhuma permissão de comando deste documento.
- `system` só pode executar comandos internos explicitamente indicados; não equivale a `admin`.
- Autenticação, permissão e escopo sobre o documento são verificados antes de reservar `commandId`, ler um resultado idempotente ou revelar qualquer `orderId`; em seguida, as demais preconditions são verificadas novamente dentro da mesma transação da escrita, nunca apenas na UI.
- Falha de precondition ou transição inválida não altera estado, histórico, número ou snapshots.

Permissões que a matriz de autorização DEVE referenciar:

```text
quotes:create
quotes:update:any       quotes:update:own
quotes:send:any         quotes:send:own
quotes:decide:any       quotes:decide:own
quotes:cancel:any       quotes:cancel:own
quotes:convert:any      quotes:convert:own
quotes:duplicate:any    quotes:duplicate:own
quotes:override_price:any
orders:confirm:any      orders:confirm:own
orders:mark_invoiced:any orders:mark_invoiced:own
orders:complete:any     orders:complete:own
orders:cancel:any       orders:cancel:own
system:expire_quotes
```

A variante `:any` não deve ser concedida ao representante por default. `quotes:decide:own` é o default operacional de MVP para aprovação explícita pelo representante responsável; isso não afirma aprovação jurídica ou aprovação pelo cliente.

## 3. Regras de entrada e saída por estado

### 3.1 `QuoteStatus`

| Estado | Entradas permitidas | Regra de entrada | Saídas permitidas | Regra de permanência/saída |
|---|---|---|---|---|
| `draft` | criação; `sent → draft` por `reopenQuote`; novo documento por `duplicateQuote` | recebe número próprio; pode montar e recalcular linhas | `sent`, `cancelled` | é o único estado editável; enviar exige quote completo e válido |
| `sent` | somente `draft → sent` | snapshots e totais são congelados; registra `sentAt` | `draft`, `approved`, `rejected`, `expired`, `cancelled` | não permite edição; decisão exige validade não expirada; correção exige `reopenQuote` |
| `approved` | somente `sent → approved` | registra ator/data da decisão | `converted`, `cancelled` | conteúdo permanece congelado; somente conversão ou cancelamento explícito |
| `rejected` | somente `sent → rejected` | motivo e ator/data obrigatórios | nenhuma | terminal; continuidade comercial exige `duplicateQuote` |
| `expired` | somente `sent → expired` | relógio do banco ultrapassou `validUntil` | nenhuma | terminal; continuidade comercial exige `duplicateQuote` |
| `converted` | somente `approved → converted`, atomicamente com criação de `Order` | deve existir exatamente um `Order.quoteId` ligado | nenhuma | terminal e imutável; o pedido passa a concentrar o fluxo operacional |
| `cancelled` | `draft`, `sent` ou `approved` por `cancelQuote` | motivo e ator/data obrigatórios | nenhuma | terminal; não apaga nem libera número |

### 3.2 `OrderStatus`

| Estado | Entradas permitidas | Regra de entrada | Saídas permitidas | Regra de permanência/saída |
|---|---|---|---|---|
| `open` | somente criação por `convertQuote` | herda snapshots do quote aprovado e recebe número próprio | `confirmed`, `cancelled` | não permite reprecificação; somente metadados operacionais não comerciais podem ser anexados |
| `confirmed` | somente `open → confirmed` | registra confirmação operacional | `invoiced`, `cancelled` | conteúdo comercial continua imutável |
| `invoiced` | somente `confirmed → invoiced` | registra marco operacional e referência livre opcional | `completed`, `cancelled` | não implica documento fiscal nem cálculo tributário |
| `completed` | somente `invoiced → completed` | registra conclusão operacional | nenhuma | terminal |
| `cancelled` | `open`, `confirmed` ou `invoiced` por `cancelOrder` | motivo e ator/data obrigatórios | nenhuma | terminal; não reabre o quote e não apaga snapshots/números |

## 4. Transições de orçamento

“Reversão” significa retornar o mesmo documento a um estado anterior. Duplicar cria outro documento e não é reversão.

| Origem | Destino | Comando | Preconditions | Efeitos atômicos | Permissão | Reversão permitida? |
|---|---|---|---|---|---|---|
| inexistente | `draft` | `createQuote` | cliente ativo; proprietário válido | aloca `quoteNumber`; cria cabeçalho, histórico e `commandId` | `quotes:create` | não; cancelar preserva registro |
| `draft` | `sent` | `sendQuote` | ao menos uma linha; cliente identificável; `validUntil` não anterior à data de negócio; uma das quatro listas ativa; toda linha possui quantidade positiva, preço salvo e snapshots completos; totais válidos | recalcula; congela linhas/totais; incrementa `revision`; define `sentAt`; registra evento | `quotes:send:any` ou `quotes:send:own` | sim, somente `sent → draft` por `reopenQuote` antes de decisão/expiração |
| `sent` | `draft` | `reopenQuote` | ainda não decidido, expirado, cancelado ou convertido; motivo obrigatório | invalida PDFs gerados da revisão anterior sem apagá-los; limpa `sentAt`; mantém trilha da revisão; reabilita edição | `quotes:update:any` ou `quotes:update:own` | sim; novo `sendQuote` cria nova revisão congelada |
| `sent` | `approved` | `approveQuote` | data de negócio do banco `<= validUntil`; snapshots continuam íntegros; motivo/observação opcional | define `approvedAt`, `approvedBy`; registra evento; não cria pedido automaticamente | `quotes:decide:any` ou `quotes:decide:own` | não; cancelar ou converter são as únicas saídas |
| `sent` | `rejected` | `rejectQuote` | motivo obrigatório | define `rejectedAt`, `rejectedBy`, motivo; registra evento | `quotes:decide:any` ou `quotes:decide:own` | não; usar `duplicateQuote` |
| `sent` | `expired` | `expireQuote` | data de negócio do banco `> validUntil`; lock revalida que ainda está `sent` | define `expiredAt`; registra evento de sistema | `system:expire_quotes` | não; usar `duplicateQuote` |
| `draft` | `cancelled` | `cancelQuote` | motivo obrigatório | define `cancelledAt`, `cancelledBy`, motivo; registra evento | `quotes:cancel:any` ou `quotes:cancel:own` | não |
| `sent` | `cancelled` | `cancelQuote` | motivo obrigatório e nenhuma decisão concorrente já confirmada | define cancelamento; preserva revisão congelada; registra evento | `quotes:cancel:any` ou `quotes:cancel:own` | não |
| `approved` | `cancelled` | `cancelQuote` | motivo obrigatório; nenhum pedido existe; lock no quote confirma ausência | define cancelamento; registra evento | `quotes:cancel:any` ou `quotes:cancel:own` | não |
| `approved` | `converted` | `convertQuote` | regras transacionais da seção 7; nenhum pedido prévio, salvo retry que retorna o existente | cria exatamente um pedido e linhas; aloca número do pedido; muda quote; registra ambos os históricos e idempotência | `quotes:convert:any` ou `quotes:convert:own` | não |

Comandos sem transição do original:

- `updateQuote`: somente em `draft`, com `quotes:update:any|own`; qualquer mudança comercial recalcula snapshots e totais.
- `duplicateQuote`: permitido a partir de qualquer estado visível com `quotes:duplicate:any|own`. Cria novo `draft`, novo `quoteNumber`, sem copiar histórico, decisão, validade ou vínculo com pedido. Mantém cliente e lista se ainda ativos, mas busca preços correntes e recria snapshots; preço indisponível deixa a nova linha pendente e bloqueia envio.
- `generateQuotePdf`: operação de leitura/renderização, não muda estado. PDFs de `sent` ou posteriores usam apenas a revisão congelada persistida.

## 5. Transições de pedido

| Origem | Destino | Comando | Preconditions | Efeitos atômicos | Permissão | Reversão permitida? |
|---|---|---|---|---|---|---|
| inexistente | `open` | `convertQuote` | quote `approved`; seção 7 satisfeita | cria cabeçalho/linhas/histórico e número `PED`; liga `quoteId` único | permissão de conversão do quote | não; cancelar preserva registro |
| `open` | `confirmed` | `confirmOrder` | ao menos uma linha; snapshots e totais íntegros | define `confirmedAt`, `confirmedBy`; registra evento | `orders:confirm:any` ou `orders:confirm:own` | não |
| `confirmed` | `invoiced` | `markOrderInvoiced` | confirmação existente; referência operacional opcional deve ser texto, não objeto fiscal | define `invoicedAt`, `invoicedBy`, `invoiceReference?`; registra evento | `orders:mark_invoiced:any` ou `orders:mark_invoiced:own` | não |
| `invoiced` | `completed` | `completeOrder` | marco `invoiced` existente | define `completedAt`, `completedBy`; registra evento | `orders:complete:any` ou `orders:complete:own` | não |
| `open` | `cancelled` | `cancelOrder` | motivo obrigatório | define cancelamento; registra evento | `orders:cancel:any` ou `orders:cancel:own` | não |
| `confirmed` | `cancelled` | `cancelOrder` | motivo obrigatório | define cancelamento; registra evento | `orders:cancel:any` ou `orders:cancel:own` | não |
| `invoiced` | `cancelled` | `cancelOrder` | motivo obrigatório; autorização não presume cancelamento fiscal externo | define cancelamento operacional; registra evento | `orders:cancel:any` ou `orders:cancel:own` | não |

Anexar/remover `Attachment` permitido pela futura matriz não altera `Order.status`. Remoção lógica de anexo preserva metadados de auditoria.

## 6. Transições inválidas

A lista de adjacência abaixo é fechada: toda combinação não listada nas seções 4 e 5 é inválida.

```text
Quote:
draft     -> sent | cancelled
sent      -> draft | approved | rejected | expired | cancelled
approved  -> converted | cancelled
rejected  -> (nenhuma)
expired   -> (nenhuma)
converted -> (nenhuma)
cancelled -> (nenhuma)

Order:
open      -> confirmed | cancelled
confirmed -> invoiced | cancelled
invoiced  -> completed | cancelled
completed -> (nenhuma)
cancelled -> (nenhuma)
```

Casos que DEVEM retornar erro de domínio `INVALID_STATE_TRANSITION` sem efeitos:

- aprovar, rejeitar ou expirar um quote em `draft`;
- converter quote em qualquer estado diferente de `approved`;
- editar linhas/preço/desconto de quote fora de `draft`;
- reabrir quote aprovado, rejeitado, expirado, convertido ou cancelado;
- enviar quote já `sent` (retry do mesmo `commandId` apenas retorna o resultado anterior);
- confirmar order fora de `open`;
- marcar `invoiced` sem passar por `confirmed`;
- concluir order fora de `invoiced`;
- reabrir order cancelado ou concluído;
- cancelar quote convertido ou order concluído;
- usar qualquer comando de mutação com role `read_only`.

Concorrência entre duas transições do mesmo estado é resolvida por lock/controle otimista: a primeira transação confirmada vence; a segunda revalida o novo estado e falha com `INVALID_STATE_TRANSITION`, exceto retry idempotente descrito neste contrato.

Exceção fechada à regra de conversão acima: uma chamada autorizada de `convertQuote` contra quote já `converted`, com seu único order íntegro, é uma consulta idempotente do resultado e retorna esse order conforme a seção 7; não executa nova transição. Qualquer outro estado diferente de `approved` continua inválido.

## 7. Conversão única, transação e idempotência

### 7.1 Restrições de banco

`orders.quote_id` é obrigatório e possui unicidade global:

```sql
ALTER TABLE orders
  ADD CONSTRAINT orders_quote_id_unique UNIQUE (quote_id);
```

Também devem existir `orders.order_number UNIQUE NOT NULL` e `quotes.quote_number UNIQUE NOT NULL`. Não é suficiente checar existência em código.

Invariante bidirecional:

- quote `converted` DEVE ter exatamente um order com `orders.quote_id = quotes.id`;
- order DEVE apontar para um quote `converted` ao fim da mesma transação;
- nenhum order pode nascer sem `convertQuote` na Fase 1.

### 7.2 Algoritmo normativo de `convertQuote`

Uma única transação de banco DEVE:

1. autenticar o ator e verificar `quotes:convert:any|own` sobre o quote sem produzir escrita ou revelar resultado em caso de negação;
2. registrar/reservar `commandId` em tabela de idempotência com chave única `(commandType, commandId)` e hash do payload normalizado;
3. bloquear a linha do quote (`SELECT ... FOR UPDATE`) ou executar update condicional equivalente e revalidar permissão/escopo sob o lock;
4. se já existir resultado concluído para o mesmo `commandId` e mesmo hash, retornar o mesmo `orderId` e número sem nova escrita de histórico;
5. se o mesmo `commandId` vier com hash diferente, falhar com `IDEMPOTENCY_KEY_REUSED`;
6. se o quote já estiver `converted` e existir seu único order, persistir para o novo `commandId` o mesmo resultado (sem novo evento de transição) e retornar esse order;
7. revalidar `status = approved` e integridade dos snapshots;
8. alocar `orderNumber` pela seção 8;
9. inserir order `open` e copiar linhas/snapshots/totais sem reprecificar;
10. atualizar quote para `converted` com `convertedAt`, `convertedBy` e `convertedOrderId`;
11. gravar históricos e resultado da idempotência;
12. confirmar tudo em um único commit.

Se qualquer etapa falhar, tudo sofre rollback: quote permanece `approved`, order/linhas/históricos não existem e a alocação numérica não é consumida. Uma falha de resposta após commit é resolvida pelo retry, que retorna o mesmo order.

### 7.3 Requisições concorrentes

Duas conversões concorrentes do mesmo quote têm resultado determinístico:

- uma transação obtém o lock e cria o order;
- a outra espera ou colide com `orders_quote_id_unique`;
- depois de observar o commit vencedor, retorna o mesmo order, nunca cria outro;
- se a vencedora sofrer rollback, a próxima pode executar a conversão e receber a alocação válida.

A violação de unicidade é tratada como sinal para reler o order existente, não para gerar um segundo número ou repetir inserts cegamente.

### 7.4 Idempotência da criação numerada

`createQuote` também exige `commandId`. Autenticação/permissão ocorre antes da reserva; a chave única e o hash do payload seguem as mesmas regras de 7.2. Um retry com a mesma chave/payload retorna o mesmo `quoteId` e `quoteNumber`; uma chave reaproveitada com payload diferente falha. Duas requisições com chaves diferentes são duas criações intencionais e recebem números distintos. Assim, timeout de rede não cria quote duplicado nem consome outro número.

### 7.5 Regressão PostgreSQL da conversão

O cenário focado usa PostgreSQL real em contêiner efêmero e deve ser executado com:

```bash
bun run test:database -- tests/integration/quote-to-order-conversion.test.ts
```

Ele cobre conversão bem-sucedida, retries idempotentes, duas conexões concorrentes,
rollback após a criação do pedido, estados inválidos, autorização, snapshots e
históricos atômicos.

## 8. Numeração anual transacional

### 8.1 Formato e escopo

```text
Quote: ORC-YYYY-NNNNNN
Order: PED-YYYY-NNNNNN
```

- `YYYY` é o ano civil no fuso de negócio `America/Fortaleza`, calculado pelo relógio do banco no início da transação de criação/conversão; data/hora do cliente não participa.
- `NNNNNN` começa em `000001` para cada combinação de `documentType` (`quote` ou `order`) e ano.
- Quote e order possuem sequências independentes.
- A virada do ano cria/usa novo escopo; a sequência do ano anterior nunca é reiniciada ou reutilizada.
- O ano e o valor alocados na transação permanecem no número mesmo que o commit ocorra após meia-noite.

Tabela conceitual:

```text
DocumentSequence(documentType, year, nextValue)
UNIQUE(documentType, year)
```

`nextValue` é o próximo número disponível. O alocador deve fazer upsert e incremento atômicos com lock da linha ou `UPDATE ... RETURNING`, dentro da mesma transação que insere o documento.

### 8.2 Concorrência, rollback e lacunas

- Transações concorrentes para o mesmo tipo/ano serializam a atualização e recebem valores distintos e crescentes.
- Tipos ou anos diferentes podem alocar em paralelo.
- Se a transação sofrer rollback, o incremento também sofre rollback e o valor pode ser entregue pela próxima transação.
- Depois de commit, o número nunca é reciclado, mesmo que o documento seja cancelado. Exclusão física de quote/order é proibida.
- Lacunas são permitidas quando uma transação já confirmada precisar de correção operacional; não existe renumeração.
- `MAX(number)`, `COUNT(*)`, contagem de linhas ou “último registro + 1” são proibidos: cancelamento, concorrência e importação tornariam esses métodos incorretos.
- `quoteNumber`/`orderNumber` são identificadores de exibição imutáveis; IDs técnicos continuam separados.

`validUntil` é um `DATE` de negócio no mesmo fuso `America/Fortaleza`: o quote permanece válido durante toda a data indicada e expira quando a data local do banco passa a ser maior. Isso evita depender de horário implícito do navegador.

## 9. Decimal, totais e arredondamento

O contrato autoritativo do motor puro é
[`quote-calculation-contract.md`](quote-calculation-contract.md). Ele fixa os
tipos de entrada/saída, contexto Decimal, escalas, pontos de arredondamento,
rateio por maiores restos, tributos comerciais transparentes, frete e cálculo
projetado de comissão.

Este workflow conserva as seguintes invariantes:

- todo cálculo usa Decimal por string; `number`/IEEE-754 é proibido;
- moeda única `BRL`; quantidade e preço aceitam até seis casas para coincidir
  com o schema de catálogo; taxas aceitam até seis casas em `0..100`;
- dinheiro publicado usa duas casas e `ROUND_HALF_UP` apenas nos pontos
  enumerados no contrato de cálculo;
- descontos de linha e geral são percentuais na Fase 1;
- o desconto geral é rateado entre linhas de modo que as cotas somem exatamente
  ao total, com desempate determinístico;
- IPI/ICMS/PIS/COFINS são calculados e exibidos como valores comerciais
  transparentes, mas não integram o total geral;
- frete entra uma vez no total geral, sem desconto e fora das bases tributária e
  de comissão;
- comissão projetada usa a mercadoria líquida após descontos, excluindo frete e
  tributos; isso não declara aquisição, aprovação, dívida ou pagamento;
- `creditLimit` nunca bloqueia, altera ou aprova totais;
- snapshots persistidos devem satisfazer todas as fórmulas e invariantes sem
  consulta a cadastro corrente.

## 10. Quatro listas de preço e histórico

### 10.1 Seleção

Existem exatamente quatro slots de lista na Fase 1, com códigos estáveis em inglês:

```text
price_1 | price_2 | price_3 | price_4
```

Seus rótulos pt-BR são configuráveis e a semântica comercial permanece input pendente. Não criar quinta lista sem mudança de contrato.

- `Quote.priceListId` é seleção explícita obrigatória antes da primeira precificação/envio.
- A mesma lista é usada por todas as linhas do quote; fallback silencioso para outra lista é proibido.
- Não há escolha automática por cliente, segmento, indústria ou representante na Fase 1.
- Cada produto precisa ter preço corrente nessa lista para a linha ser enviável.
- Override manual de `unitPrice` exige `quotes:override_price:any`, motivo e evento de auditoria; representante não recebe essa permissão por default.

### 10.2 Histórico

Alterar preço nunca atualiza a versão anterior in-place. Na mesma transação:

1. obtém um lock serializável para `(productId, priceListId)` e um único timestamp do banco;
2. encerra a versão corrente com `validTo = timestamp` exclusivo;
3. insere nova versão com `validFrom = timestamp`, valor Decimal, ator e motivo;
4. mantém unicidade de uma versão corrente por `(productId, priceListId)` e restrição contra intervalos sobrepostos.

Duas alterações concorrentes da mesma combinação serializam pelo lock. A primeira confirmada cria a versão corrente; a segunda relê essa versão como sua antecessora e cria a próxima, sem lacuna ou sobreposição. Retry do mesmo `commandId` retorna a versão já criada; rollback restaura a versão anterior como corrente. Combinações diferentes podem avançar em paralelo.

A fase de relatórios de histórico pode ser posterior, mas o dado versionado necessário à rastreabilidade deve existir desde a primeira alteração. Backdating e intervalos retroativos não são suportados na Fase 1.

A linha registra `priceListId`, `productPriceVersionId`, `unitPrice` e fonte `price_list|manual_override`. Mudanças futuras de preço/lista não alteram documentos existentes.

## 11. Snapshots de linha e comissão

### 11.1 Momento do snapshot

Ao criar ou editar uma `QuoteLine` em `draft`, o sistema copia dos cadastros correntes:

- `productId`, `internalCode`, `description`, `unit`;
- `industryId` e nome exibível;
- `priceListId`, `productPriceVersionId`, `unitPrice` e fonte;
- quantidade e desconto da linha;
- campos tributários meramente informativos necessários ao documento;
- `commissionRate` e `commissionSource`;
- valores calculados `lineGross`, `lineDiscount`, `lineNet`.

Enquanto `draft`, uma edição explícita da linha ou troca da lista recria os snapshots e totais. Não existe atualização automática silenciosa quando um cadastro muda. `sendQuote` faz a validação/recalculo final e congela a revisão. De `sent` em diante, cabeçalho comercial, linhas, snapshots e totais são imutáveis.

`convertQuote` copia os snapshots congelados para `OrderLine` byte por byte no mesmo commit; não consulta preço, descrição, tributo ou comissão corrente. Arquivamento ou alteração posterior de cliente, produto, indústria, lista ou comissão não reescreve quote/order.

### 11.2 Precedência da comissão

Para cada linha no momento de criação/recriação do snapshot:

```text
if Product.commissionRateOverride is not null:
    commissionRate   = Product.commissionRateOverride
    commissionSource = product_override
else if Industry.defaultCommissionRate is not null:
    commissionRate   = Industry.defaultCommissionRate
    commissionSource = industry_default
else:
    commissionRate   = null
    commissionSource = none
```

Zero é um override válido e não equivale a `null`. A ausência de taxa não bloqueia quote/pedido na Fase 1, mas fica explícita no snapshot. O motor calcula uma projeção sobre a mercadoria líquida após descontos, sem frete ou tributos, conforme o contrato de cálculo. Essa projeção não declara comissão adquirida, aprovada, devida ou paga; beneficiário e momento de aquisição continuam inputs de negócio.

## 12. Resultados de erro e histórico mínimo

Erros de domínio esperados:

```text
INVALID_STATE_TRANSITION
PRECONDITION_FAILED
FORBIDDEN
QUOTE_EXPIRED
MISSING_CURRENT_PRICE
INVALID_DECIMAL
IDEMPOTENCY_KEY_REUSED
SNAPSHOT_INTEGRITY_ERROR
```

Conflito concorrente não deve vazar erro bruto de unicidade ao cliente. O serviço traduz a condição para retorno idempotente existente ou erro de domínio apropriado.

Cada evento de histórico contém no mínimo:

```text
entityType, entityId, eventType, fromStatus?, toStatus?,
actorId?, actorRole, commandId, occurredAt, reason?, metadata
```

`metadata` não substitui colunas/invariantes estruturais e não deve armazenar segredos.

## 13. Exemplos de aceitação determinísticos

### 13.1 Transições

- **Dado** quote `draft` completo, **quando** ator com `quotes:send:own` envia, **então** vira `sent`, congela revisão e registra evento.
- **Dado** quote `sent` ainda válido, **quando** ator autorizado aprova, **então** vira `approved` sem criar order.
- **Dado** quote `sent` com `validUntil` anterior ao relógio do banco, **quando** tentam aprovar, **então** a aprovação falha; `expireQuote` pode levá-lo a `expired`.
- **Dado** quote `rejected`, **quando** tentam reabrir ou converter, **então** ocorre `INVALID_STATE_TRANSITION`; duplicar cria outro `draft` numerado.
- **Dado** order `confirmed`, **quando** tentam concluir diretamente, **então** falha; precisa passar pelo marco operacional `invoiced`.
- **Dado** order `invoiced`, **quando** é cancelado, **então** o cancelamento é apenas operacional e não afirma cancelamento fiscal externo.

### 13.2 Concorrência e numeração

- **Dado** quote aprovado, **quando** duas requisições concorrentes convertem, **então** ambas observam ao final o mesmo `orderId`; existe uma linha em `orders` para o quote e um único número consumido.
- **Dado** retry após timeout de resposta com mesmo `commandId` e payload, **quando** o primeiro commit já ocorreu, **então** retorna o order original.
- **Dado** mesmo `commandId` com payload diferente, **então** falha com `IDEMPOTENCY_KEY_REUSED`.
- **Dadas** 20 criações concorrentes de quote no mesmo ano, **então** recebem 20 sufixos únicos; a ordem de aquisição do lock define a sequência, não a ordem de chegada HTTP.
- **Dada** falha antes do commit após reservar `000123`, **então** o rollback também desfaz a reserva e a próxima transação pode receber `000123`.
- **Dada** criação iniciada em `2026-12-31 23:59:59` no fuso de negócio e commit após meia-noite, **então** usa `2026`; nova transação iniciada em 2027 começa `000001` no novo escopo.

### 13.3 Decimal, preço e snapshot

- **Dado** quantidade `3.000`, preço `10.0050` e desconto de linha `0`, **então** `lineGross = 30.02` por `ROUND_HALF_UP`.
- **Dado** subtotal `100.00`, desconto geral `10%` e frete `12.34`, **então** total `102.34`; IPI informativo não altera esse valor.
- **Dado** quote na `price_2` e produto sem preço corrente nessa lista, **então** envio falha sem fallback para `price_1`.
- **Dado** quote enviado com preço `50.0000`, **quando** o preço corrente muda para `55.0000`, **então** quote e order convertido preservam `50.0000` e a versão original.
- **Dado** override de comissão do produto `0`, default da indústria `5`, **então** snapshot usa `0` com fonte `product_override`.
- **Dado** override `null` e default da indústria `5`, **então** snapshot usa `5` com fonte `industry_default`.

## 14. Inputs pendentes sem ambiguidade operacional na Fase 1

Estas decisões podem alterar uma versão futura, mas os defaults acima permitem implementação e testes agora:

- significado e rótulos comerciais de `price_1..price_4`;
- moeda diferente de BRL, escalas diferentes ou regra de arredondamento diferente;
- suporte a desconto em valor fixo ou outro método de rateio do desconto geral;
- inclusão futura de IPI ou frete na base projetada de comissão (descontos já
  reduzem a base na Fase 1);
- beneficiário, aquisição, aprovação, pagamento e estorno de comissão;
- prova/canal de aprovação pelo cliente;
- efeitos externos/fiscais associados ao marco operacional `invoiced`;
- eventual política para correção de order após confirmação (na Fase 1, não há reversão).

Qualquer mudança nessas decisões exige versionar o contrato, migrar dados quando necessário e nunca recalcular silenciosamente documentos históricos.
