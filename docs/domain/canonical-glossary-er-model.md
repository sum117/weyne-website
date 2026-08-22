# Modelo ER e schema canônico implementado

Status: referência de implementação — deve concordar com `src/lib/db/schema/canonical.ts` e `drizzle/canonical/`.

Idioma de negócio: pt-BR. Nomes de tabela, coluna, constraint e enum abaixo são os nomes reais do PostgreSQL; o objeto TypeScript equivalente usa propriedades camelCase quando indicado.

## 1. Escopo e fonte de verdade

O schema canônico é o conjunto de quatro migrations:

- `drizzle/canonical/0000_canonical_schema.sql`: enums, 25 tabelas, chaves, FKs, checks e índices;
- `drizzle/canonical/0001_canonical_invariants.sql`: exclusões de vigência, triggers de append-only/arquivo, conjunto permanente de listas e paridade quote/order;
- `drizzle/canonical/0002_document_logo_assets.sql`: a 26ª tabela `document_logo_assets`, com o enum `document_logo_status` e o ciclo staged/active/purged do logotipo dos documentos;
- `drizzle/canonical/0003_millisecond_timestamp_defaults.sql`: trunca todo default `timestamptz` para milissegundos e normaliza os valores já gravados.

A declaração Drizzle correspondente é `src/lib/db/schema/canonical.ts`; `drizzle.config.ts` aponta para ela e para `drizzle/canonical`.

A instalação é **single-organization**. Não existem `organizations`, `tenants` nem colunas `tenant_id`/`organization_id`. Todos os registros deste banco pertencem à única operação Weyne. Uma futura introdução de multi-tenancy exige contrato e migration próprios; não se deve simular isolamento por filtros opcionais.

Esta é a descrição do banco efetivamente implementado, não um modelo lógico anterior. Em particular, não existem `price_history`, `brand`, `invoice`, `tax_engine`, `owner_user_id`, `discount_kind`, `discount_value`, `last_value` ou `technical_sheet_attachment_id` como tabelas/colunas independentes neste schema.

## 2. Diagrama ER

O diagrama usa os nomes SQL em maiúsculas apenas para legibilidade; cada entidade corresponde à tabela minúscula indicada na seção 3.

```mermaid
erDiagram
  users ||--o| representatives : "user_id"
  users ||--o{ sessions : "user_id"
  users ||--o{ accounts : "user_id"
  users ||--o{ representatives : "audit"
  users ||--o{ customers : "audit"
  users ||--o{ industries : "audit"
  users ||--o{ carriers : "audit"
  users ||--o{ products : "audit"
  users ||--o{ product_assets : "created/archived_by"
  users ||--o{ product_prices : "created/ended_by"
  users ||--o{ commission_rules : "created/ended_by"
  users ||--o{ quotes : "workflow/audit"
  users ||--o{ quote_lines : "audit"
  users ||--o{ orders : "workflow/audit"
  users ||--o{ order_lines : "created_by_user_id"
  users ||--o{ quote_events : "actor_user_id"
  users ||--o{ order_events : "actor_user_id"
  users ||--o{ attachments : "uploaded/archived_by"
  users ||--o{ record_assignments : "assignee/created/revoked"
  users ||--o{ idempotency_records : "actor_user_id"
  users ||--o{ settings : "created/updated_by"
  users ||--o{ audit_events : "actor_user_id"
  users ||--o{ document_logo_assets : "created/activated/purged_by"

  representatives o|--o{ customers : "responsible_representative_id"
  representatives ||--o{ quotes : "representative_id"
  representatives ||--o{ orders : "representative_id"

  industries ||--o{ products : "industry_id"
  industries ||--o{ commission_rules : "industry_id"
  product_assets o|--o{ industries : "logo_asset_id"
  products ||--o{ product_assets : "product_id"
  products ||--o{ product_prices : "product_id"
  products ||--o{ commission_rules : "product_id"

  price_lists ||--o{ product_prices : "price_list_id"
  price_lists ||--o{ quotes : "price_list_id"
  price_lists ||--o{ orders : "price_list_id"

  customers ||--o{ quotes : "customer_id"
  customers ||--o{ orders : "customer_id"
  carriers o|--o{ quotes : "carrier_id"
  carriers o|--o{ orders : "carrier_id"

  quotes ||--|{ quote_lines : "quote_id"
  quotes ||--o{ quote_events : "quote_id"
  quotes ||--o| orders : "source_quote_id / converted_order_id"
  quotes o|--o{ quotes : "duplicated_from_quote_id"
  products ||--o{ quote_lines : "product_id"
  product_prices ||--o{ quote_lines : "product_price_id"
  commission_rules o|--o{ quote_lines : "commission_rule_id"
  industries ||--o{ quote_lines : "industry_id_snapshot"
  price_lists ||--o{ quote_lines : "price_list_id_snapshot"

  orders ||--|{ order_lines : "order_id"
  orders ||--o{ order_events : "order_id"
  orders ||--o{ attachments : "order_id"
  products ||--o{ order_lines : "product_id"
  product_prices ||--o{ order_lines : "product_price_id"
  commission_rules o|--o{ order_lines : "commission_rule_id"
  quote_lines ||--o| order_lines : "source_quote_line_id"
  industries ||--o{ order_lines : "industry_id_snapshot"
  price_lists ||--o{ order_lines : "price_list_id_snapshot"

  users ||--o{ record_assignments : "assignee_user_id"
  customers o|--o{ record_assignments : "customer_id"
  quotes o|--o{ record_assignments : "quote_id"
  orders o|--o{ record_assignments : "order_id"
```

### Cardinalidades e relações normativas

- `users` tem zero ou um `representatives`; `representatives.user_id` é `UNIQUE`.
- Um `representative` pode ser responsável por muitos `customers`; `customers.responsible_representative_id` é opcional. Quotes e orders têm exatamente um representante.
- Uma `industry` possui muitos `products` e regras; cada `products.industry_id` é obrigatório.
- Um `product` possui muitos `product_assets`, `product_prices` e regras de comissão.
- Existem exatamente quatro `price_lists`, uma por chave `PRICE_1` a `PRICE_4`. Uma lista tem muitos preços, quotes e orders.
- `customers` podem ter muitos `quotes` e `orders`; `carriers` são opcionais em ambos.
- Um `quote` possui zero ou mais `quote_lines` durante `draft`, mas precisa de pelo menos uma linha para ser enviado. Cada linha tem um `quote_id` obrigatório.
- Um quote gera no máximo um order: `orders.source_quote_id` é `NOT NULL UNIQUE`; o quote convertido também guarda `quotes.converted_order_id`. Triggers deferrable exigem os links recíprocos no commit.
- Cada `order_line` aponta para exatamente uma `quote_line` por `source_quote_line_id UNIQUE`; cada quote line pode ser copiada no máximo uma vez.
- `quote_events`, `order_events`, `attachments` e `record_assignments` pertencem respectivamente a quote/order ou a um alvo exclusivo de assignment.
- `audit_events.entity_type` + `entity_id` é uma referência polimórfica intencional: não há FK porque pode apontar para qualquer entidade auditável.
- `document_sequences` e `settings` são tabelas técnicas/configuracionais sem relações de domínio adicionais.

## 3. Tabelas e colunas implementadas

Tipos `timestamptz` abaixo são `timestamp with time zone`; `numeric(p,s)` é PostgreSQL `numeric` com precisão/escala explícitas. `NOT NULL` e defaults são parte do contrato.

### 3.1 Autenticação e usuários

#### `users` (`users`)

`id uuid PK DEFAULT gen_random_uuid()`, `name text NOT NULL`, `email text NOT NULL`, `email_verified boolean NOT NULL DEFAULT false`, `image text`, `role user_role NOT NULL`, `auth_subject text NOT NULL`, `disabled_at timestamptz`, `disabled_by_user_id uuid`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

`role` é `admin | representative | read_only`. `email` é único por índice case-insensitive `users_email_uidx`; `auth_subject` é único por `users_auth_subject_uq`. `disabled_at` e `disabled_by_user_id` são ambos nulos ou ambos preenchidos.

#### `sessions` (`sessions`)

`id uuid PK DEFAULT gen_random_uuid()`, `token text NOT NULL`, `user_id uuid NOT NULL`, `expires_at timestamptz NOT NULL`, `ip_address text`, `user_agent text`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

`token` é único (`sessions_token_uq`). FK `user_id` usa `ON DELETE CASCADE`, pois a sessão é material de autenticação e não autoria histórica.

#### `accounts` (`accounts`)

`id uuid PK DEFAULT gen_random_uuid()`, `account_id text NOT NULL`, `provider_id text NOT NULL`, `user_id uuid NOT NULL`, `access_token text`, `refresh_token text`, `id_token text`, `access_token_expires_at timestamptz`, `refresh_token_expires_at timestamptz`, `scope text`, `password text`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

`(provider_id, account_id)` é único (`accounts_provider_account_uq`). FK `user_id` usa `ON DELETE CASCADE`.

#### `verifications` (`verifications`)

`id uuid PK DEFAULT gen_random_uuid()`, `identifier text NOT NULL`, `value text NOT NULL`, `expires_at timestamptz NOT NULL`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

Há índice `verifications_identifier_idx`; não há FK para usuário.

### 3.2 Cadastros mestres e arquivos de produto

As tabelas abaixo usam, quando indicado, o conjunto de auditoria: `created_at`, `created_by_user_id`, `updated_at`, `updated_by_user_id`, `archived_at`, `archived_by_user_id`. Todos os FKs de autoria e de referência comercial usam `ON DELETE RESTRICT`.

#### `representatives` (`representatives`)

`id uuid PK DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL`, `display_name text NOT NULL`, `internal_code text`, `phone text`, campos de auditoria.

`user_id` é único (`representatives_user_id_uq`). `internal_code` tem índice único parcial `representatives_internal_code_uidx` quando não nulo. Arquivo lógico exige `archived_at` e `archived_by_user_id` em par.

#### `customers` (`customers`)

`id uuid PK DEFAULT gen_random_uuid()`, `legal_name text NOT NULL`, `trade_name text`, `tax_id text`, `state_registration text`, `street_address text`, `postal_code text`, `city text`, `state char(2)`, `phone text`, `whatsapp text`, `email text`, `contact_name text`, `segment text`, `credit_limit numeric(19,2)`, `currency_code char(3)`, `notes text`, `responsible_representative_id uuid`, campos de auditoria.

`tax_id` é único entre registros ativos quando preenchido (`customers_active_tax_id_uidx`). `credit_limit` não pode ser negativo; ele exige `currency_code = 'BRL'` e nunca participa de autorização, workflow ou cálculo.

#### `industries` (`industries`)

`id uuid PK DEFAULT gen_random_uuid()`, `legal_name text NOT NULL`, `trade_name text`, `tax_id text`, `address text`, `notes text`, `brand_name text`, `logo_asset_id uuid`, campos de auditoria.

`tax_id` é único entre ativos quando preenchido (`industries_active_tax_id_uidx`). `logo_asset_id` referencia opcionalmente `product_assets.id` com `RESTRICT`; é um vínculo de asset, não uma tabela `brands`.

#### `carriers` (`carriers`)

`id uuid PK DEFAULT gen_random_uuid()`, `name text NOT NULL`, `notes text`, campos de auditoria.

`name` é único entre carriers ativos pelo índice `carriers_active_name_uidx` sobre `lower(btrim(name))`. Carrier arquivado sai dos seletores, mas o nome de quote/order é preservado no snapshot.

#### `products` (`products`)

`id uuid PK DEFAULT gen_random_uuid()`, `industry_id uuid NOT NULL`, `internal_code text NOT NULL`, `manufacturer_code text`, `description text NOT NULL`, `brand text`, `category text`, `ncm text`, `cest text`, `ean text`, `dun text`, `packaging text`, `unit text NOT NULL`, `net_weight numeric(18,6)`, `gross_weight numeric(18,6)`, `width numeric(18,6)`, `height numeric(18,6)`, `depth numeric(18,6)`, `dimension_unit text`, `ipi_rate numeric(9,6)`, `icms_rate numeric(9,6)`, `pis_rate numeric(9,6)`, `cofins_rate numeric(9,6)`, campos de auditoria.

`internal_code` é globalmente único (`products_internal_code_uq`). Pesos/dimensões são não negativos; `dimension_unit` é obrigatório se alguma dimensão existir; as quatro taxas ficam entre `0` e `100`. Campos fiscais são informativos e não implementam motor fiscal.

#### `product_assets` (`product_assets`)

`id uuid PK DEFAULT gen_random_uuid()`, `product_id uuid NOT NULL`, `kind product_asset_kind NOT NULL`, `original_name text NOT NULL`, `mime_type text NOT NULL`, `size_bytes bigint NOT NULL`, `storage_key text NOT NULL`, `checksum text NOT NULL`, `position integer`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `archived_at timestamptz`, `archived_by_user_id uuid`.

`kind` é `image | technical_sheet | safety_sheet`. `storage_key` é único (`product_assets_storage_key_uq`). Imagens ativas têm `position >= 0` e unicidade `(product_id, position)`; documentos não-imagem têm `position IS NULL` e no máximo um de cada kind por produto. Assets são arquivados, nunca hard-deleted.

### 3.3 Preços e comissão versionados

#### `price_lists` (`price_lists`)

`id uuid PK DEFAULT gen_random_uuid()`, `key price_list_key NOT NULL`, `display_name text NOT NULL`, `position smallint NOT NULL`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

`key` (`price_lists_key_uq`) e `position` (`price_lists_position_uq`) são únicos. O check `price_lists_key_position_ck` limita o par a `PRICE_1/1`, `PRICE_2/2`, `PRICE_3/3`, `PRICE_4/4`. A migration de invariantes protege o conjunto permanente: seed idempotente cria exatamente estas quatro rows com IDs estáveis: `00000000-0000-4000-8000-000000000001` (`PRICE_1`), `00000000-0000-4000-8000-000000000002` (`PRICE_2`), `00000000-0000-4000-8000-000000000003` (`PRICE_3`) e `00000000-0000-4000-8000-000000000004` (`PRICE_4`). Key, ID e posição não mudam e rows não podem ser deletadas/truncadas.

#### `product_prices` (`product_prices`)

`id uuid PK DEFAULT gen_random_uuid()`, `product_id uuid NOT NULL`, `price_list_id uuid NOT NULL`, `amount numeric(19,6) NOT NULL`, `currency_code char(3) NOT NULL DEFAULT 'BRL'`, `valid_from timestamptz NOT NULL`, `valid_to timestamptz`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `ended_by_user_id uuid`, `reason text NOT NULL`.

Existe no máximo uma versão corrente por `(product_id, price_list_id)` (`product_prices_current_uidx`). A exclusão `product_prices_no_overlapping_validity` impede intervalos sobrepostos em `[valid_from, valid_to)`, com `NULL` representando infinito. `valid_to` e `ended_by_user_id` são ambos nulos na versão corrente ou ambos preenchidos na versão encerrada. O histórico é esta tabela; não existe `price_history`.

#### `commission_rules` (`commission_rules`)

`id uuid PK DEFAULT gen_random_uuid()`, `scope commission_scope NOT NULL`, `industry_id uuid`, `product_id uuid`, `rate numeric(9,6) NOT NULL`, `valid_from timestamptz NOT NULL`, `valid_to timestamptz`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `ended_by_user_id uuid`.

`scope` é `industry_default` ou `product_override`. O check `commission_rules_target_ck` exige exatamente o alvo compatível. Índices únicos parciais protegem uma versão corrente por indústria (`commission_rules_current_industry_uidx`) ou produto (`commission_rules_current_product_uidx`); três constraints de exclusão impedem sobreposição por alvo. A precedência no serviço é override de produto, default da indústria, ausência. Encerramento preserva `ended_by_user_id`.

### 3.4 Orçamento, linhas e eventos

#### `quotes` (`quotes`)

Colunas de identidade e estado: `id uuid PK DEFAULT gen_random_uuid()`, `number text NOT NULL`, `status quote_status NOT NULL DEFAULT 'draft'`, `customer_id uuid NOT NULL`, `representative_id uuid NOT NULL`, `price_list_id uuid NOT NULL`, `carrier_id uuid`, `valid_until date NOT NULL`, `currency_code char(3) NOT NULL DEFAULT 'BRL'`.

Snapshots de cabeçalho: `customer_legal_name_snapshot text NOT NULL`, `customer_trade_name_snapshot text`, `customer_tax_id_snapshot text`, `customer_address_snapshot text`, `representative_name_snapshot text NOT NULL`, `price_list_key_snapshot price_list_key NOT NULL`, `price_list_name_snapshot text NOT NULL`, `carrier_name_snapshot text`, `freight_terms text`, `payment_terms text`, `notes text`.

Totais e cálculo: `overall_discount_rate numeric(9,6)`, `gross_amount numeric(19,2) NOT NULL`, `line_discount_amount numeric(19,2) NOT NULL`, `net_after_line_discount_amount numeric(19,2) NOT NULL`, `overall_discount_amount numeric(19,2) NOT NULL`, `net_merchandise_amount numeric(19,2) NOT NULL`, `tax_totals_snapshot jsonb NOT NULL`, `freight_amount numeric(19,2) NOT NULL`, `grand_total_amount numeric(19,2) NOT NULL`, `commission_basis_amount numeric(19,2) NOT NULL`, `commission_value_amount numeric(19,2) NOT NULL`.

Workflow: `sent_at timestamptz`, `sent_by_user_id uuid`, `approved_at timestamptz`, `approved_by_user_id uuid`, `rejected_at timestamptz`, `rejected_by_user_id uuid`, `rejection_reason text`, `cancelled_at timestamptz`, `cancelled_by_user_id uuid`, `cancellation_reason text`, `expired_at timestamptz`, `converted_at timestamptz`, `converted_by_user_id uuid`, `converted_order_id uuid`, `duplicated_from_quote_id uuid`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_by_user_id uuid NOT NULL`.

`number` é único (`quotes_number_uq`) e segue `ORC-YYYY-NNNNNN`. `converted_order_id` é único quando preenchido (`quotes_converted_order_uidx`) e participa do vínculo recíproco com `orders.source_quote_id`. `quote_status` é `draft | sent | approved | rejected | expired | converted | cancelled`; pares de timestamp/ator e motivos de rejeição/cancelamento são protegidos por checks.

#### `quote_lines` (`quote_lines`)

`id uuid PK DEFAULT gen_random_uuid()`, `quote_id uuid NOT NULL`, `position integer NOT NULL`, `product_id uuid NOT NULL`, `product_price_id uuid NOT NULL`, `price_source price_source NOT NULL`, `product_code_snapshot text NOT NULL`, `product_description_snapshot text NOT NULL`, `manufacturer_code_snapshot text`, `brand_snapshot text`, `packaging_snapshot text`, `unit_snapshot text NOT NULL`, `industry_id_snapshot uuid NOT NULL`, `industry_name_snapshot text NOT NULL`, `price_list_id_snapshot uuid NOT NULL`, `price_list_key_snapshot price_list_key NOT NULL`, `price_list_name_snapshot text NOT NULL`, `unit_price_snapshot numeric(19,6) NOT NULL`, `currency_code char(3) NOT NULL DEFAULT 'BRL'`, `quantity numeric(18,6) NOT NULL`, `line_discount_rate numeric(9,6) NOT NULL`, `gross_amount_snapshot numeric(19,2) NOT NULL`, `line_discount_amount_snapshot numeric(19,2) NOT NULL`, `net_after_line_discount_amount_snapshot numeric(19,2) NOT NULL`, `overall_discount_allocation_amount_snapshot numeric(19,2) NOT NULL`, `net_merchandise_amount_snapshot numeric(19,2) NOT NULL`, `taxes_snapshot jsonb NOT NULL`, `ipi_rate_snapshot numeric(9,6)`, `icms_rate_snapshot numeric(9,6)`, `pis_rate_snapshot numeric(9,6)`, `cofins_rate_snapshot numeric(9,6)`, `commission_rule_id uuid`, `commission_source_snapshot commission_source NOT NULL`, `commission_rate_snapshot numeric(9,6)`, `commission_basis_amount_snapshot numeric(19,2) NOT NULL`, `commission_value_amount_snapshot numeric(19,2)`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_by_user_id uuid NOT NULL`.

`(quote_id, position)` é único (`quote_lines_quote_position_uq`). `price_source` é `price_list | manual_override`; `commission_source_snapshot` é `product_override | industry_default | none`. Quantidade é positiva, rates ficam entre `0` e `100`, `taxes_snapshot` é array JSON e os campos de comissão são coerentes com a origem. Todos os campos `*_snapshot` são capturados no momento da linha e não são atualizados por mudanças no cadastro.

#### `quote_events` (`quote_events`)

`id uuid PK DEFAULT gen_random_uuid()`, `quote_id uuid NOT NULL`, `event_type text NOT NULL`, `from_status quote_status`, `to_status quote_status`, `occurred_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `actor_user_id uuid`, `actor_role actor_role NOT NULL`, `command_id uuid NOT NULL`, `reason text`, `metadata jsonb NOT NULL`.

`metadata` é objeto com `version` inteiro positivo; actor `system` não tem `actor_user_id`, enquanto os demais roles têm. A tabela é append-only por trigger e possui índices de histórico e command.

### 3.5 Pedido, linhas, anexos e eventos

#### `orders` (`orders`)

`id uuid PK DEFAULT gen_random_uuid()`, `source_quote_id uuid NOT NULL`, `number text NOT NULL`, `status order_status NOT NULL DEFAULT 'open'`, `customer_id uuid NOT NULL`, `representative_id uuid NOT NULL`, `price_list_id uuid NOT NULL`, `carrier_id uuid`, `customer_legal_name_snapshot text NOT NULL`, `customer_trade_name_snapshot text`, `customer_tax_id_snapshot text`, `customer_address_snapshot text`, `representative_name_snapshot text NOT NULL`, `price_list_key_snapshot price_list_key NOT NULL`, `price_list_name_snapshot text NOT NULL`, `carrier_name_snapshot text`, `valid_until_snapshot date NOT NULL`, `currency_code char(3) NOT NULL DEFAULT 'BRL'`, `freight_terms text`, `payment_terms text`, `notes text`, `overall_discount_rate numeric(9,6)`, `gross_amount numeric(19,2) NOT NULL`, `line_discount_amount numeric(19,2) NOT NULL`, `net_after_line_discount_amount numeric(19,2) NOT NULL`, `overall_discount_amount numeric(19,2) NOT NULL`, `net_merchandise_amount numeric(19,2) NOT NULL`, `tax_totals_snapshot jsonb NOT NULL`, `freight_amount numeric(19,2) NOT NULL`, `grand_total_amount numeric(19,2) NOT NULL`, `commission_basis_amount numeric(19,2) NOT NULL`, `commission_value_amount numeric(19,2) NOT NULL`, `confirmed_at timestamptz`, `confirmed_by_user_id uuid`, `invoiced_at timestamptz`, `invoiced_by_user_id uuid`, `invoice_reference text`, `completed_at timestamptz`, `completed_by_user_id uuid`, `cancelled_at timestamptz`, `cancelled_by_user_id uuid`, `cancellation_reason text`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

`source_quote_id` é único (`orders_source_quote_uq`), garantindo um pedido por quote; `number` é único (`orders_number_uq`) e segue `PED-YYYY-NNNNNN`. `order_status` é `open | confirmed | invoiced | completed | cancelled`. O conteúdo comercial e as linhas são cópias imutáveis do quote; os campos de workflow e `notes` podem evoluir conforme o serviço. `invoiced` é apenas marco operacional, não emissão fiscal.

#### `order_lines` (`order_lines`)

`id uuid PK DEFAULT gen_random_uuid()`, `order_id uuid NOT NULL`, `source_quote_line_id uuid NOT NULL`, `quote_line_position_snapshot integer NOT NULL`, seguido dos mesmos campos de snapshot de `quote_lines`: `position`, `product_id`, `product_price_id`, `price_source`, `product_code_snapshot`, `product_description_snapshot`, `manufacturer_code_snapshot`, `brand_snapshot`, `packaging_snapshot`, `unit_snapshot`, `industry_id_snapshot`, `industry_name_snapshot`, `price_list_id_snapshot`, `price_list_key_snapshot`, `price_list_name_snapshot`, `unit_price_snapshot`, `currency_code`, `quantity`, `line_discount_rate`, `gross_amount_snapshot`, `line_discount_amount_snapshot`, `net_after_line_discount_amount_snapshot`, `overall_discount_allocation_amount_snapshot`, `net_merchandise_amount_snapshot`, `taxes_snapshot`, `ipi_rate_snapshot`, `icms_rate_snapshot`, `pis_rate_snapshot`, `cofins_rate_snapshot`, `commission_rule_id`, `commission_source_snapshot`, `commission_rate_snapshot`, `commission_basis_amount_snapshot`, `commission_value_amount_snapshot`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`.

`(order_id, position)` e `source_quote_line_id` são únicos. A tabela é append-only por trigger; não possui `updated_at`. A conversão copia por valor os snapshots congelados de `quote_lines` sem reler produto, preço ou comissão vivos.

#### `order_events` (`order_events`)

Tem a mesma forma de `quote_events`, substituindo `quote_id` por `order_id` e usando `from_status order_status`/`to_status order_status`: `id`, `order_id`, `event_type`, `from_status`, `to_status`, `occurred_at`, `actor_user_id`, `actor_role`, `command_id`, `reason`, `metadata`. É append-only, com índice de histórico e de command.

#### `attachments` (`attachments`)

`id uuid PK DEFAULT gen_random_uuid()`, `order_id uuid NOT NULL`, `original_name text NOT NULL`, `mime_type text NOT NULL`, `size_bytes bigint NOT NULL`, `storage_key text NOT NULL`, `checksum text NOT NULL`, `uploaded_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `uploaded_by_user_id uuid NOT NULL`, `archived_at timestamptz`, `archived_by_user_id uuid`.

Attachment é propriedade de `orders`, não de quote nem de product. `storage_key` é único (`attachments_storage_key_uq`); arquivo lógico preserva metadados e autoria. `size_bytes > 0` e par de archive actor são checks.

### 3.6 Acesso, idempotência, configuração e auditoria

#### `record_assignments` (`record_assignments`)

`id uuid PK DEFAULT gen_random_uuid()`, `assignee_user_id uuid NOT NULL`, `customer_id uuid`, `quote_id uuid`, `order_id uuid`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `revoked_at timestamptz`, `revoked_by_user_id uuid`.

`record_assignments_target_ck` exige exatamente um entre `customer_id`, `quote_id` e `order_id`. Há uma unique index parcial ativa por alvo (`record_assignments_active_customer_uidx`, `...quote_uidx`, `...order_uidx`) e `record_assignments_assignee_idx`. Revogação é feita por `revoked_at`/`revoked_by_user_id`; assignment não troca owner de quote/order.

#### `idempotency_records` (`idempotency_records`)

`id uuid PK DEFAULT gen_random_uuid()`, `command_type text NOT NULL`, `command_id uuid NOT NULL`, `actor_user_id uuid NOT NULL`, `payload_hash text NOT NULL`, `status idempotency_status NOT NULL`, `result_entity_type text`, `result_entity_id uuid`, `response_snapshot jsonb`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `completed_at timestamptz`.

`(command_type, command_id)` é único (`idempotency_records_command_uq`). `status` é `in_progress | completed`; checks exigem que resultado/response/completed_at estejam todos ausentes durante processamento ou todos presentes ao concluir.

#### `document_sequences` (`document_sequences`)

Não possui coluna `id`. Campos: `document_type document_type NOT NULL`, `year integer NOT NULL`, `next_value integer NOT NULL DEFAULT 1`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`.

A PK composta é `(document_type, year)` (`document_sequences_pk`). `document_type` é `quote | order`; `year` fica entre `2000` e `9999`; `next_value >= 1`. A alocação deve fazer upsert/lock e incrementar `next_value` na mesma transação de criação do documento; quote e order têm sequências independentes.

#### `settings` (`settings`)

`id uuid PK DEFAULT gen_random_uuid()`, `key text NOT NULL`, `value jsonb NOT NULL`, `version integer NOT NULL DEFAULT 1`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `updated_by_user_id uuid NOT NULL`.

`key` é único (`settings_key_uq`) e o check restringe a única chave implementada, `business`. `value` deve ser JSON object e `version > 0`.

#### `audit_events` (`audit_events`)

`id uuid PK DEFAULT gen_random_uuid()`, `actor_user_id uuid`, `actor_role actor_role NOT NULL`, `action text NOT NULL`, `entity_type text NOT NULL`, `entity_id uuid NOT NULL`, `occurred_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `correlation_id uuid NOT NULL`, `before jsonb`, `after jsonb`, `metadata jsonb NOT NULL`.

`actor_role` é `admin | representative | read_only | system`; a combinação system/actor é validada como nos eventos de domínio. `metadata` é objeto JSON. `entity_type`/`entity_id` formam referência polimórfica sem FK; índices existem para occurred, actor, entity e correlation. `audit_events` é append-only por trigger.

#### `document_logo_assets` (`document_logo_assets`)

`id uuid PK DEFAULT gen_random_uuid()`, `status document_logo_status NOT NULL DEFAULT 'staged'`, `object_key text NOT NULL`, `original_filename text NOT NULL`, `mime_type text NOT NULL`, `size_bytes bigint NOT NULL`, `checksum_sha256 char(64) NOT NULL`, `width integer`, `height integer`, `created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())`, `created_by_user_id uuid NOT NULL`, `activated_at timestamptz`, `activated_by_user_id uuid`, `purged_at timestamptz`, `purged_by_user_id uuid`.

`status` é `staged | active | purged` e `document_logo_assets_lifecycle_ck` exige o par ator/timestamp coerente com cada estado. `object_key` é único (`document_logo_assets_object_key_uidx`) e o check restringe o formato a `document-logos/<uuid>`, sem nome de arquivo nem dado de cliente na chave. Outros checks limitam o MIME a `image/png | image/jpeg | image/webp`, o tamanho a 2 MiB, o checksum a SHA-256 hexadecimal e as dimensões a pares positivos.

### 3.7 Precisão de timestamp

Todo default `timestamptz` deste schema é `date_trunc('milliseconds', now())`, não `now()`.

O PostgreSQL resolve `now()` em microssegundos, mas todo timestamp que sai deste sistema passa por um `Date` do JavaScript, que só carrega milissegundos. A paginação keyset serializa esse `Date` truncado no cursor, então um valor gravado em microssegundos comparava como estritamente maior que o cursor derivado dele e a linha de fronteira repetia na página seguinte. Truncar na origem iguala a precisão gravada à precisão representável e restaura o invariante `(coluna de ordenação, id)` como fronteira única de página.

## 4. Arquivo e preservação histórica

- `representatives`, `customers`, `industries`, `carriers`, `products`, `product_assets` e `attachments` não podem ser hard-deleted: triggers `*_prevent_hard_delete_trg` exigem arquivo lógico.
- Cadastros arquivados ficam fora dos novos seletores/vínculos, mas FKs históricas usam `RESTRICT` e documentos continuam legíveis.
- `price_lists` são permanentes; `product_prices` e `commission_rules` fecham vigência e preservam o ator em `ended_by_user_id`.
- `quotes` e `orders` não são arquivados nem apagados; terminam por status e eventos.
- `quote_events`, `order_lines`, `order_events` e `audit_events` são append-only por trigger. Uma linha de pedido é um snapshot do momento de conversão, não um join vivo com catálogo.
- Alterar nome, preço, taxa, produto, indústria, transportadora ou display name de lista não reescreve `*_snapshot`.

## 5. Fluxo quote → order

1. Criar `quotes` em `draft`, inserir `quote_lines` e capturar todos os snapshots.
2. Ao enviar, validar a linha, preço corrente/lista selecionada e estado; marcar `sent` e registrar `quote_events`.
3. Um quote enviado pode ser `approved`, `rejected`, `expired` ou `cancelled`; apenas quote aprovado pode converter.
4. `convertQuote` usa `idempotency_records`, trava/revalida o quote, aloca `PED-YYYY-NNNNNN` em `document_sequences`, insere `orders` e uma `order_line` por `quote_line`, marca o quote como `converted` e registra eventos na mesma transação.
5. A constraint `orders_source_quote_uq`, o índice `quotes_converted_order_uidx` e os triggers deferrable `quotes_conversion_pair_trg`/`orders_conversion_pair_trg` garantem um par recíproco e no máximo um pedido.

Não existe criação direta de `orders`, revisão de quote ou tabela de histórico de preço separada.

## 6. Migrations, seed e testes PostgreSQL real

### Pré-requisitos

- Bun 1.3+ (CI usa 1.3.14);
- Node disponível no `PATH` para o build/prerender, quando o gate completo for executado;
- PostgreSQL 17.6 acessível, ou Docker Desktop/Docker Engine com Compose v2 para o fluxo local;
- dependências instaladas com `bun install`;
- para migração, `DATABASE_URL` server-only apontando para um banco vazio e usuário com `CONNECT` e `USAGE,CREATE` em `public`;
- para o teste, `TEST_DATABASE_URL` apontando para um banco de teste que o harness possa usar para criar/remover um banco isolado.

Nunca publique `DATABASE_URL` em `VITE_` nem reutilize credenciais locais em produção.

### Banco vazio e migração segura

A migration de produção é a cadeia canonical, não os SQLs históricos no diretório raiz `drizzle/`:

```sh
# DATABASE_URL deve ser definido no ambiente, fora do shell history quando possível.
bun run db:migrate
```

`bun run db:migrate` executa `scripts/migrate-database.ts`, que chama `migrateDatabase()` com `drizzle/canonical`. O runner valida cabeçalho/ordem/checksum, identidade e privilégios do banco, adquire advisory lock, aplica as quatro migrations canonical em transações separadas e registra `public.weyne_schema_migrations`. Reexecutar com o mesmo plano deixa `pending=0`; não edite migration já aplicada.

Para inspeção/generation Drizzle:

```sh
bun run db:generate
```

`drizzle-kit` usa `src/lib/db/schema/canonical.ts` e `drizzle/canonical`. A migration de invariantes contém SQL PostgreSQL necessário que não é expresso apenas pelos builders Drizzle (`btree_gist`, exclusion constraints, triggers e constraint triggers).

### Seed seguro e repetível

O seed de aplicação é deliberadamente mínimo: `scripts/seed-database.ts` chama `seedDatabase()`, insere somente os quatro `price_lists` canônicos com IDs estáveis e valida que a tabela resultante é exatamente `PRICE_1` a `PRICE_4`.

```sh
# Requer o mesmo DATABASE_URL do banco recém-migrado.
bun scripts/seed-database.ts
```

O processo usa `onConflictDoNothing`, pode ser repetido e falha se os IDs/keys/positions existentes divergirem. Não cria clientes, usuários, produtos, preços de produto, quotes, orders ou dados comerciais fictícios.

Para o banco local Compose, que constrói sua própria URL de desenvolvimento:

```sh
bun run db:setup          # up, wait, migration canonical, seed seguro
bun run db:seed           # somente seed após o banco estar pronto
bun run db:reset          # destrutivo: recria volume, migra do zero e seed
```

### Integração contra PostgreSQL real

O teste canônico provisiona um banco isolado, recria `public`, aplica a cadeia canonical completa e inspeciona metadata, tipos, defaults, PKs, FKs, constraints, índices, triggers, seed, numeração, histórico, arquivamento e snapshots.

Com um PostgreSQL de teste já disponível:

```sh
TEST_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/test_admin' \
  bun run test:database tests/integration/canonical-schema-contract.test.ts
```

Sem `TEST_DATABASE_URL`, `scripts/run-database-tests.ts` tenta iniciar automaticamente um container `postgres:17.6-alpine` via Docker. O teste focado acima é o contrato de schema; `bun run test:database` sem filtro também executa a suíte de integração PostgreSQL configurada no repositório.

Gate relacionado:

```sh
bun run check
```

O gate completo executa conteúdo, typecheck, lint, testes, auditoria de dependências, build e headers. Para validar especificamente a implementação persistida, execute também `bun run db:migrate`, `bun scripts/seed-database.ts` e o teste canônico acima em um banco vazio.

## 7. Constraints e índices de referência

As constraints e os índices nomeados abaixo são parte do contrato e devem permanecer alinhados com a migration:

- identidade: `users_email_uidx`, `users_auth_subject_uq`, `representatives_user_id_uq`, `products_internal_code_uq`, `price_lists_key_uq`, `price_lists_position_uq`, `settings_key_uq`;
- documento: `quotes_number_uq`, `quotes_converted_order_uidx`, `orders_source_quote_uq`, `orders_number_uq`;
- linhas: `quote_lines_quote_position_uq`, `order_lines_order_position_uq`, `order_lines_source_quote_line_uq`;
- preços/comissão: `product_prices_current_uidx`, `product_prices_no_overlapping_validity`, `commission_rules_current_industry_uidx`, `commission_rules_current_product_uidx` e as três exclusões de validade;
- assets/anexos: `product_assets_storage_key_uq`, `product_assets_active_image_position_uidx`, `product_assets_active_document_kind_uidx`, `attachments_storage_key_uq`;
- assignments/idempotência: três unique indexes ativos de `record_assignments` e `idempotency_records_command_uq`;
- invariantes de banco: triggers de proteção das quatro listas, triggers append-only, triggers de versão, triggers de hard-delete e `quotes_conversion_pair_trg`/`orders_conversion_pair_trg`.

FKs de lookup e autoria possuem índices correspondentes onde a implementação declara consultas recorrentes; a suíte `tests/integration/canonical-schema-contract.test.ts` compara a metadata implantada com a declaração Drizzle.
