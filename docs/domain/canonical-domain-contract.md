# Contrato canônico do domínio comercial — Fase 1

Status: contrato de comportamento e workflow. O contrato físico de tabelas, colunas, tipos, constraints e índices está em [`canonical-glossary-er-model.md`](canonical-glossary-er-model.md), que deve prevalecer para qualquer questão de schema.

Idioma de negócio e UI: pt-BR. Nomes de código, schema, entidades, campos, roles, comandos e enums: inglês.

## 1. Escopo e autoridade

A implementação é single-organization: uma instalação atende somente à Weyne. Não existem `Organization`, `Tenant`, `tenant_id` ou `organization_id` no banco. `ALL` significa todos os registros desta instalação; multi-tenancy exige contrato e migration futuros.

A fonte física é `src/lib/db/schema/canonical.ts` com as migrations `drizzle/canonical/0000_canonical_schema.sql` e `drizzle/canonical/0001_canonical_invariants.sql`. O ER implementado lista as 25 tabelas e todas as colunas reais. Este documento fixa comportamento de domínio e não cria aliases de schema.

Fora da Fase 1: emissão de nota fiscal, motor tributário, contas a receber, cobrança, pagamento de comissão, ERP, assinatura digital, portal do cliente e criação direta de pedido. `orders.status = invoiced` é apenas marco operacional informado por usuário autorizado.

## 2. Entidades implementadas

O vocabulário é:

| Termo | Tabela real | Papel |
|---|---|---|
| Usuário | `users` | Conta autenticada e autoria. |
| Sessão/conta/verificação | `sessions`, `accounts`, `verifications` | Adapter de autenticação. |
| Representante | `representatives` | Perfil comercial 1:1 de `users`. |
| Cliente | `customers` | Comprador/destinatário; não possui login. |
| Indústria | `industries` | Origem do produto e do default de comissão. |
| Transportadora | `carriers` | Cadastro opcional em quote/order. |
| Produto/asset | `products`, `product_assets` | Catálogo e metadados de arquivos. |
| Lista/preço | `price_lists`, `product_prices` | Quatro listas permanentes e seu histórico versionado. |
| Comissão | `commission_rules` | Default por indústria ou override por produto. |
| Orçamento/linha/evento | `quotes`, `quote_lines`, `quote_events` | Documento comercial e histórico append-only. |
| Pedido/linha/evento | `orders`, `order_lines`, `order_events` | Cópia imutável do quote convertido e histórico. |
| Anexo | `attachments` | Arquivo armazenado pertencente a `orders`. |
| Atribuição | `record_assignments` | Grant revogável a um alvo exclusivo. |
| Idempotência | `idempotency_records` | Deduplicação de comandos. |
| Numeração/configuração/auditoria | `document_sequences`, `settings`, `audit_events` | Suporte técnico e trilha de auditoria. |

Para campos e cardinalidades, consultar exclusivamente o ER implementado; não usar os nomes de drafts anteriores como `price_history`, `owner_user_id`, `last_value`, `discount_kind` ou `discount_value`.

## 3. Regras transversais

- Todas as PKs `id` são UUID com `DEFAULT gen_random_uuid()`, exceto a PK composta `(document_type, year)` de `document_sequences`.
- Instantes são `timestamp with time zone`; datas de validade são `date`.
- FKs históricas e de autoria usam `ON DELETE RESTRICT`. Somente `sessions.user_id` e `accounts.user_id` usam `ON DELETE CASCADE`.
- Cadastros com arquivo lógico mantêm `archived_at` e `archived_by_user_id` em par. Arquivar remove o registro de seletores, não apaga nem reescreve referências históricas.
- UUID, timestamp, nomes SQL e demais identificadores seguem exatamente o documento ER. Propriedades camelCase de Drizzle são apenas a representação TypeScript das colunas snake_case.
- Valores de preço, dinheiro, quantidade, peso, dimensão e taxa usam Decimal; não há coerção para `number`, `parseFloat` ou arredondamento IEEE-754.

Escalas persistidas:

| Conceito | Tipo PostgreSQL |
|---|---|
| dinheiro totalizado | `numeric(19,2)` |
| preço unitário | `numeric(19,6)` |
| quantidade/peso/dimensão | `numeric(18,6)` |
| taxa/percentual | `numeric(9,6)` |

A moeda implementada é somente `BRL`, por `char(3)` e checks nos documentos/linhas. Os campos `ipi_rate`, `icms_rate`, `pis_rate`, `cofins_rate`, `ncm` e `cest` são informativos/snapshot; não constituem motor fiscal.

## 4. Arquivo e preservação

`representatives`, `customers`, `industries`, `carriers`, `products`, `product_assets` e `attachments` têm trigger de prevenção de hard-delete e devem ser arquivados. `users` são desabilitados por `disabled_at`/`disabled_by_user_id`, nunca apagados como autoria.

`price_lists` são as quatro rows permanentes `PRICE_1`, `PRICE_2`, `PRICE_3`, `PRICE_4`; somente `display_name` pode mudar. `product_prices` e `commission_rules` são histórico append-only: uma alteração encerra a versão com `valid_to` + `ended_by_user_id` e cria outra. Exclusões PostgreSQL impedem intervalos de vigência sobrepostos.

`quotes` e `orders` não têm arquivo lógico. Um quote congelado é corrigido por duplicação para um novo quote; um order é cancelado por estado. `quote_events`, `order_lines`, `order_events` e `audit_events` são append-only.

## 5. Preço e comissão

Há quatro listas e cada quote escolhe uma por `price_list_id`; cada linha guarda também `price_list_id_snapshot`, `price_list_key_snapshot`, `price_list_name_snapshot`, `product_price_id` e `unit_price_snapshot`. Não há fallback automático entre listas.

Para um par `(product_id, price_list_id)`, `product_prices.valid_from` é inclusivo e `valid_to` exclusivo; no máximo uma versão é corrente e nenhuma vigência pode sobrepor outra. Preço ausente impede o uso da linha.

`commission_rules.scope` é `industry_default` ou `product_override`. A seleção é, nesta ordem:

1. regra corrente `product_override` por `product_id`;
2. regra corrente `industry_default` por `industry_id`;
3. ausência, representada por `commission_source_snapshot = 'none'`.

A linha preserva `commission_rule_id`, `commission_source_snapshot`, `commission_rate_snapshot`, `commission_basis_amount_snapshot` e `commission_value_amount_snapshot`. Taxa zero é diferente de ausência; nenhum campo declara comissão devida ou paga.

## 6. Quote e snapshots

`quote_status` é `draft | sent | approved | rejected | expired | converted | cancelled`. Somente `draft` é comercialmente editável. Para envio, o quote precisa de cliente/representante/lista/validade válidos e ao menos uma `quote_line` com snapshots e totais coerentes.

A linha preserva, entre outros, `product_code_snapshot`, `product_description_snapshot`, `unit_snapshot`, `industry_id_snapshot`, `industry_name_snapshot`, `price_list_id_snapshot`, `price_list_key_snapshot`, `price_list_name_snapshot`, `unit_price_snapshot`, `quantity`, `line_discount_rate`, valores monetários `*_snapshot`, `taxes_snapshot` e a projeção de comissão. Mudança posterior de produto, preço, lista, indústria, transportadora ou comissão nunca altera uma linha já persistida.

Transições fechadas:

```text
draft     -> sent | cancelled
sent      -> approved | rejected | expired | cancelled
approved  -> converted | cancelled
rejected  -> nenhuma
expired   -> nenhuma
converted -> nenhuma
cancelled -> nenhuma
```

Pares de timestamp/ator (`sent_at`/`sent_by_user_id`, `approved_at`/`approved_by_user_id`, `rejected_at`/`rejected_by_user_id`, `cancelled_at`/`cancelled_by_user_id`, `converted_at`/`converted_by_user_id`) são protegidos por checks. Rejeição e cancelamento exigem motivo.

## 7. Conversão quote → order

`orders.source_quote_id` é `NOT NULL UNIQUE`; `quotes.converted_order_id` é único quando preenchido. Os triggers deferrable `quotes_conversion_pair_trg` e `orders_conversion_pair_trg` exigem que o vínculo seja recíproco e que o quote esteja `converted` no commit.

`convertQuote` deve:

1. autorizar o ator e reservar/reler `idempotency_records`;
2. travar o quote e revalidar estado e autorização;
3. retornar o order existente se o quote já estiver convertido;
4. alocar o número `PED-YYYY-NNNNNN` em `document_sequences` na mesma transação;
5. inserir `orders` e uma `order_lines` por `quote_lines`, copiando os snapshots sem lookup/reprecificação;
6. marcar o quote `converted`, gravar `quote_events`/`order_events` e concluir a idempotência;
7. fazer commit único ou rollback completo.

`order_status` é `open | confirmed | invoiced | completed | cancelled` e as transições são:

```text
open      -> confirmed | cancelled
confirmed -> invoiced | cancelled
invoiced  -> completed
completed -> nenhuma
cancelled -> nenhuma
```

`order_lines.source_quote_line_id` é `NOT NULL UNIQUE`, portanto cada linha convertida corresponde a exatamente uma linha do quote. Não existe `order.createDirect`.

## 8. Numeração e idempotência

`document_sequences` tem PK `(document_type, year)`, `document_type = quote | order`, `next_value >= 1` e ano entre `2000` e `9999`. Quote usa `ORC-YYYY-NNNNNN`; order usa `PED-YYYY-NNNNNN`. O incremento é protegido por lock e ocorre na transação da criação. `quotes.number` e `orders.number` são defesas únicas globais.

`idempotency_records` usa unique `(command_type, command_id)` e guarda `payload_hash`. Uma mesma chave com payload diferente falha; uma repetição com o mesmo payload retorna o resultado concluído. A autorização deve ocorrer antes de revelar o resultado.

## 9. Permissões e limites

Os serviços devem aplicar autenticação, role, escopo, estado, invariantes e persistência/auditoria no backend; a UI não é uma barreira de autorização.

- `admin` possui escopo global e governa cadastros, listas, preços, comissão e decisões.
- `representative` opera seu `representatives.id` em quote/order e grants ativos de `record_assignments` conforme a policy.
- `read_only` somente lê os alvos explicitamente atribuídos e recebe projeção redacted.
- `record_assignments` contém exatamente um alvo entre `customer_id`, `quote_id`, `order_id`; não transfere `representative_id`.
- `customers.credit_limit` é informativo e não bloqueia criação, envio, aprovação, conversão ou qualquer transição.
- Arquivado não pode receber novo vínculo; histórico é lido por snapshot e evento.

## 10. Fora do contrato

Não adicionar tabelas/colunas para `Invoice`, emissão fiscal, recebíveis, pagamento de comissão, organização/tenant, histórico redundante de preço ou usuário cliente sem uma nova decisão de domínio e migration. Qualquer alteração física deve atualizar `canonical-glossary-er-model.md`, `src/lib/db/schema/canonical.ts`, a cadeia `drizzle/canonical` e o teste PostgreSQL `tests/integration/canonical-schema-contract.test.ts` em conjunto.
