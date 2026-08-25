# Evidência de reconciliação de métricas — t_2813a277

Data da execução: 2026-08-17.

## Fixture e resultado

A fixture canônica cobre `2026-07-01` a `2026-07-31`, inclusivo, em `America/Fortaleza`. Definições e valores completos estão em `docs/domain/reporting-metric-contract.md`.

Resultado reconciliado da moeda BRL: 3 pedidos, 2 clientes, venda exata `600.015000`, comissão exata `30.015000`; apresentação monetária da venda `600.02`. Cards usam `snapshot.byCurrency`; tabelas de clientes, produtos, indústrias e comissões são projeções do mesmo snapshot.

## Defeitos corrigidos na fronteira proprietária

1. Não existia uma definição compartilhada entre cards e agrupamentos. `buildReportMetrics` agora é a única agregação e as superfícies recebem projeções.
2. Datas civis não tinham fronteira normativa. O intervalo agora é inclusivo na URL e semiaberto em instantes PostgreSQL no fuso `America/Fortaleza`.
3. Pedidos cancelados podiam contaminar totais ou atividade. Agora são excluídos de todas as métricas e de reativação de cliente.
4. Valores de moedas diferentes podiam ser somados sem proteção. Agora existem buckets por moeda e divergência linha/cabeçalho falha explicitamente.
5. Indústria histórica dependeria do cadastro corrente. `order_lines` agora persiste `product_industry_id` e `product_industry_name` imutáveis na conversão.
6. Comissão de `read_only` podia vazar por projeção genérica. Agora é `null`, a aba de comissão fica vazia e o escopo é aplicado tanto no SQL quanto no agregador.
7. Clientes sem pedidos não podiam aparecer como inativos. A fronteira exige o diretório de clientes e combina-o com a última atividade não cancelada.
8. Consultas grandes não tinham limite explícito. A fronteira falha acima de 50.000 pedidos; a fixture de 10.000 comprova o caminho grande permitido.
9. A migration de anexos de pedido era ordenada antes da migration de pedidos. Foi renomeada de `0004_order_attachments.sql` para `0005_order_attachments.sql`.

## Comandos executados

- `bun run test tests/unit/report-metrics.test.ts` — PASS, 5/5.
- `bun run test tests/unit/report-metrics.test.ts tests/unit/report-state.test.ts tests/unit/product-pricing.test.tsx` — PASS, 18/18.
- `bun run test` — PASS, 62 arquivos e 497 testes.
- `bun run test:database -- tests/integration/report-metrics.test.ts` — PASS em execução isolada, 1/1, PostgreSQL 17 real.
- `bun run test:database` — o teste de reconciliação passou dentro da suíte integrada; a execução global terminou com falhas concorrentes fora desta tarefa em conversão de orçamento, RBAC, rehearsal de migrations e nome antigo de migration de anexos de produto.
- `bunx eslint src/features/app/reports/report-metrics.ts src/features/app/reports/report-metrics.server.ts tests/unit/report-metrics.test.ts tests/integration/report-metrics.test.ts` — PASS.
- `bun run typecheck` — os arquivos desta tarefa ficaram sem diagnósticos; o gate global permaneceu bloqueado por erros concorrentes em settings, quote conversion/lifecycle e teste de PDF.
- `bun run lint` — bloqueado porque `artifacts/` e `spikes/**/dist/` gerados por tarefas concorrentes entraram no escopo do ESLint; o lint focado desta tarefa passou.

## Histórico de preços e estados de UI validados

- `tests/integration/catalog-schema.test.ts` passou na suíte PostgreSQL: valores `numeric` preservam seis casas, histórico exige ator/motivo e é append-only.
- `tests/unit/product-pricing.test.tsx` passou: admin vê histórico imutável, estados vazio/erro são explícitos e `representative`/`read_only` recebem apresentação sem edição.
- `tests/unit/report-state.test.ts` passou: filtros de URL, intervalo, status, representante, página, page size, sort e colunas são normalizados e limitados.
- `tests/unit/report-metrics.test.ts` cobre vazio, validação/erro, roles, status, inativos, fronteiras, 10.000 registros permitidos e 50.001 rejeitados.

## Risco residual encaminhado

A rota `/app/relatorios` ainda é um shell com `renderReport` injetável e estado vazio padrão; autenticação, diretório de clientes e carregamento de rota pertencem à integração final da Fase 2. A fronteira canônica e sua consulta real estão prontas para esse encaixe sem duplicar cálculo na UI.
