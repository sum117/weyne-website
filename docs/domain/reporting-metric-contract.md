# Contrato canônico de métricas de dashboard e relatórios

Status: normativo para a Fase 2.

Este contrato existe para impedir que cards, tabelas e listas derivadas calculem o mesmo conceito de maneiras diferentes. A fronteira proprietária é `buildReportMetrics` em `src/features/app/reports/report-metrics.ts`; consultas PostgreSQL entram por `loadPostgresReportMetrics` e as superfícies consomem projeções do mesmo snapshot.

## Período e tempo

- Datas de filtro são datas civis ISO `YYYY-MM-DD`.
- O fuso de negócio desta fixture é `America/Fortaleza`.
- `from` e `to` são inclusivos para a pessoa usuária. A consulta converte o intervalo para `[meia-noite(from), meia-noite(to + 1 dia))` no fuso de negócio.
- Instantes na fronteira final exclusiva não entram.
- Datas inválidas, intervalo invertido e fuso IANA inválido são erros de validação; não há correção silenciosa na fronteira de métricas.

## Pedidos, status e escopo

- A fonte financeira é o snapshot imutável de `orders` e `order_lines`, nunca o preço ou cadastro corrente.
- Status reportáveis: `open`, `confirmed`, `invoiced` e `completed`.
- `cancelled` é preservado na fonte e pode existir no filtro de URL, mas nunca contribui para quantidade, venda, comissão, produto, indústria nem atividade do cliente.
- Filtro de status vazio significa todos os quatro status reportáveis.
- `admin` vê todos os pedidos e comissões.
- `representative` vê somente pedidos cujo `representativeId` identifica o seu perfil `Representative`, conforme o contrato canônico. Adaptadores de consulta devem resolver esse vínculo explicitamente; `owner_user_id` não é um campo canônico de `Quote` ou `Order`.
- `read_only` vê somente representantes explicitamente atribuídos e recebe `commissionAmount: null` e nenhuma linha de comissão. A restrição é aplicada na consulta e novamente na agregação compartilhada.

## Valores, moedas e arredondamento

- Valores persistidos e agregados são decimais exatos; nenhuma soma passa por `number` binário.
- Cada total agregado permanece com seis casas decimais.
- Moedas nunca são somadas entre si. Cards e grupos produzem um bucket por `currencyCode` ISO de três letras.
- A moeda da linha deve ser igual à moeda do cabeçalho do pedido; divergência é erro de integridade.
- Arredondamento acontece uma única vez, na apresentação monetária: duas casas, `ROUND_HALF_UP`, por `roundMetricMoney`. Exemplo: `600.015000` vira `600.02`.
- Quantidades permanecem com seis casas; não usam arredondamento monetário.

## Agrupamentos

- Clientes: identidade por `clientId`, nome vindo do diretório atual quando disponível; contagem distinta de pedidos e totais por moeda.
- Produtos: identidade e descrição do snapshot da linha; quantidade e total por moeda.
- Indústrias: identidade e nome imutáveis copiados para a linha na conversão do orçamento; total por moeda e contagem distinta de pedidos. Consultar a indústria corrente causaria deriva histórica e é proibido.
- Comissões: agrupamento pelo proprietário do orçamento de origem, com venda e comissão por moeda; invisível para `read_only`.
- Cards: contagem de pedidos, clientes distintos, venda e comissão por moeda. São projeção direta de `snapshot.byCurrency`, não uma segunda consulta.

## Clientes inativos

- O diretório de clientes é obrigatório para incluir clientes que nunca compraram.
- Um cliente está inativo quando não possui pedido não cancelado antes do fim de `asOf`, ou quando sua última atividade é estritamente anterior a `asOf - inactiveDays`.
- A fixture usa `asOf = 2026-08-17` e `inactiveDays = 90`; portanto, a fronteira civil é `2026-05-19` em `America/Fortaleza`.
- Pedidos cancelados não reativam cliente.
- O mesmo escopo de role dos relatórios é aplicado ao diretório e ao histórico consultado.

## Limites e estados

- A fronteira aceita no máximo 50.000 pedidos-fonte por execução; 50.001 gera erro explícito em vez de truncar silenciosamente.
- A consulta PostgreSQL traz pedidos do período e somente a atividade mais recente necessária por cliente para a lista de inativos.
- Ausência de pedidos produz arrays vazios válidos para cards e tabelas.
- Erros de validação, integridade, limite e banco permanecem erros; não são convertidos em um falso estado vazio.
- Paginação, ordenação e visibilidade de colunas continuam limitadas por `report-state.ts`; nenhum parâmetro de URL habilita consulta ilimitada.

## Fixture de reconciliação

Período: `2026-07-01` a `2026-07-31`, inclusivo, `America/Fortaleza`.

Pedidos reportáveis:

| Instante UTC | Cliente | Representante | Status | Total BRL | Comissão BRL |
|---|---|---|---|---:|---:|
| 2026-07-01T03:00:00.000Z | Cliente Alpha | rep-1 | open | 100.005000 | 5.005000 |
| 2026-07-15T15:00:00.000Z | Cliente Alpha | rep-1 | invoiced | 200.005000 | 10.005000 |
| 2026-08-01T02:59:59.999Z | Cliente Beta | rep-2 | completed | 300.005000 | 15.005000 |

Também existem: um pedido anterior de Cliente Dormente em `2026-05-01`; um cancelado de `999.000000` dentro do período; e casos de fronteira fora do período. O cancelado e as fronteiras externas não entram.

Resultados esperados:

- BRL: 3 pedidos, 2 clientes, venda `600.015000`, comissão `30.015000`; apresentação da venda `600.02`.
- Cliente Alpha: 2 pedidos, venda `300.010000`, comissão `15.010000`.
- Cliente Beta: 1 pedido, venda `300.005000`, comissão `15.005000`.
- Indústria A: 2 pedidos, `300.010000`; Indústria B: 1 pedido, `300.005000`.
- Cliente Dormente e Cliente Sem Pedido aparecem como inativos.
- Escopo `representative/rep-1`: 2 pedidos e `300.010000`.
- Escopo `read_only` atribuído a `rep-2`: 1 pedido e `300.005000`, sem comissão.

## Cobertura executável

- `tests/unit/report-metrics.test.ts`: datas, status, moeda, arredondamento, agrupamentos, reconciliação cards/tabelas, roles, inativos, vazio, erro e 10.000/50.001 registros.
- `tests/integration/report-metrics.test.ts`: a fixture acima em PostgreSQL real, da persistência de pedidos à projeção compartilhada.
- `tests/unit/report-state.test.ts`: filtros de URL, paginação, sort e colunas limitados.
- `tests/integration/catalog-schema.test.ts` e `tests/unit/product-pricing.test.tsx`: histórico de preço decimal, append-only, dados exibidos, vazio, erro e variações por role.
