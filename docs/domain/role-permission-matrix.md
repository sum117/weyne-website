# Matriz de permissões por perfil — contrato de autorização da Fase 1

Status: contrato de autorização para implementação e testes

Fonte primária: `C:/Users/jvcal/Downloads/project.pdf` (p. 1 §2–§4; p. 2 §5–§7; p. 3 §8–§9; p. 5 §14–§16)

Inventário rastreável: `docs/domain/project-pdf-requirements-inventory.md`

Idioma de negócio: pt-BR; nomes de roles, recursos, campos, comandos e estados: inglês.

## 1. Autoridade da fonte e defaults adotados

### 1.1 Confirmado no PDF

O PDF confirma três perfis (`admin`, `representative`, `read_only`), os módulos de clientes, indústrias, produtos, transportadoras, orçamentos, pedidos e configurações, o fluxo Cliente → Orçamento → Aprovação → Pedido e os cadastros de tabelas de preço, comissões, usuários e anexos. Ele não atribui ações específicas a cada perfil.

### 1.2 Input de negócio genuinamente pendente

A fonte não determina:

1. se representantes acessam registros próprios, atribuídos ou globais;
2. quem aprova/rejeita orçamentos;
3. quem pode conceder descontos ou substituir preços;
4. quem vê comissão e limite de crédito;
5. qual é o alcance de consulta do `read_only`;
6. se restauração existe e quem a executa;
7. se um pedido faturado pode ser cancelado;
8. se existe delegação temporária ou hierarquia entre representantes.

Esses pontos precisam de validação do negócio. Até lá, este documento aplica menor privilégio e não concede acesso silenciosamente.

### 1.3 Suposições seguras e vinculantes para o MVP

- **S1 — um role por usuário:** `User.role` contém exatamente um de `admin`, `representative` ou `read_only`.
- **S2 — isolamento:** toda consulta e mutação aplica primeiro o limite organizacional/tenant da instalação; nenhum role atravessa esse limite.
- **S3 — escopo do representante:** `representative` acessa clientes, orçamentos e pedidos somente quando `ownerUserId == actor.id` ou existe atribuição ativa ao ator. Criar um cliente ou orçamento atribui o ator como proprietário. O backend não aceita `ownerUserId` arbitrário do cliente da API.
- **S4 — escopo do consulta/leitura:** `read_only` acessa clientes e documentos comerciais somente por atribuição explícita ativa. A atribuição concede apenas a projeção O/W; não concede anexos nem F1/F2. Sem atribuição, o resultado é `not_found`/lista vazia, não uma enumeração global.
- **S5 — catálogos globais:** indústrias, produtos, transportadoras e listas de preço ativas são catálogos de leitura global dentro da organização, sujeitos à projeção de campos de cada role.
- **S6 — aprovação:** somente `admin` aprova ou rejeita orçamento. É o default de menor privilégio até o negócio indicar aprovação pelo representante ou pelo cliente.
- **S7 — descontos e preço manual:** somente `admin` altera desconto por linha, desconto geral ou preço unitário manual. `representative` escolhe uma das quatro listas ativas e usa o preço armazenado, mas não o sobrescreve.
- **S8 — financeiro restrito:** `representative` vê preços, descontos e totais apenas dos documentos em seu escopo e os preços correntes necessários para cotar; não vê comissão nem limite de crédito. `read_only` recebe projeção sem preços, descontos, totais, comissão e limite de crédito.
- **S9 — comandos de pedido sensíveis:** `representative` pode converter seu orçamento aprovado; somente `admin` confirma, marca como faturado, conclui ou cancela pedido.
- **S10 — arquivamento lógico:** cadastros usam `archivedAt`/`archivedBy`; documentos comerciais não são arquivados/restaurados, e sim preservados por estado terminal. A Fase 1 suporta restauração de cadastro exclusivamente por `admin`. Um cadastro arquivado é imutável até ser restaurado.
- **S11 — estado prevalece sobre role:** permissão do role nunca ignora precondições de estado, escopo, vínculo, versão otimista, integridade referencial ou idempotência.
- **S12 — limite de crédito informativo:** `creditLimit` nunca bloqueia envio, aprovação, conversão, confirmação ou conclusão e não dispara workflow financeiro.

## 2. Vocabulário executável

### 2.1 Resultado de autorização

Cada célula usa um destes resultados:

- **A — `allow`**: permitido após validar precondições de domínio.
- **D — `deny`**: proibido para o role, independentemente do estado.
- **A/R — `allow_redacted`**: leitura permitida somente com a projeção indicada na seção 4.
- **N/S — `not_supported`**: comando não existe na Fase 1; deve falhar de forma explícita, não ser improvisado.

A negação recomendada é `403 forbidden` quando o registro já está legitimamente no escopo do ator. Para evitar enumeração, acesso fora do escopo retorna `404 not_found`. `409 conflict` é reservado a estado, versão, unicidade ou idempotência inválidos após autorização.

### 2.2 Escopos

- **ALL:** qualquer registro da organização, ativo ou arquivado quando o comando o exigir.
- **OWN_ASSIGNED:** `ownerUserId == actor.id` ou atribuição ativa ao ator.
- **EXPLICIT_ASSIGNED:** atribuição ativa ao ator; não presume propriedade pelo role.
- **ACTIVE_CATALOG:** somente cadastros ativos no catálogo global.
- **HISTORICAL_REFERENCE:** projeção mínima embutida em documento acessível; não autoriza `view` direto do cadastro arquivado nem o inclui em lista/selector.
- **NONE:** nenhum registro.

### 2.3 Regra de avaliação

O serviço deve avaliar, nesta ordem:

1. autenticação e organização;
2. existência sem revelar registros de outro escopo;
3. role e escopo da matriz;
4. projeção de campos e campos mutáveis;
5. estado atual e transição solicitada;
6. invariantes de domínio, concorrência e idempotência;
7. persistência e evento de auditoria.

A UI pode esconder ações, mas não substitui essas verificações no backend.

## 3. Matriz-resumo de escopo de leitura

| Recurso | `admin` | `representative` | `read_only` |
|---|---|---|---|
| `Customer` | A — ALL | A/R — OWN_ASSIGNED ativo; histórico somente embutido | A/R — EXPLICIT_ASSIGNED ativo; histórico somente embutido |
| `Industry` | A — ALL | A/R — ACTIVE_CATALOG; histórico somente embutido | A/R — ACTIVE_CATALOG; histórico somente embutido |
| `Product` | A — ALL | A/R — ACTIVE_CATALOG; histórico somente embutido | A/R — ACTIVE_CATALOG; histórico somente embutido |
| `Carrier` | A — ALL | A/R — ACTIVE_CATALOG; histórico somente embutido | A/R — ACTIVE_CATALOG; histórico somente embutido |
| `PriceList` / `ProductPrice` | A — ALL | A/R — ACTIVE_CATALOG; valores correntes visíveis | A/R — ACTIVE_CATALOG; valores ocultos |
| `CommissionRule` | A — ALL | D — NONE | D — NONE |
| `Quote` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED |
| `Order` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED |
| `Attachment` de pedido | A — ALL | A — se o `Order` pai estiver em OWN_ASSIGNED | D — conteúdo e metadados ocultos por default |

## 4. Projeções e mutabilidade de informações sensíveis

### 4.1 Classes de campos

- **O — operacional/cadastral:** identificadores, razão/nome, contatos, endereço, códigos, descrição, unidade, logística, datas e observações não financeiras. Estado e transições pertencem exclusivamente a W.
- **F1 — comercial:** preço corrente, lista escolhida, preço de snapshot, descontos, frete monetário, IPI informativo monetário/alíquota quando exibido no documento e totais.
- **F2 — financeiro restrito:** `creditLimit`, `defaultCommissionRate`, `commissionRateOverride`, comissão aplicada/snapshot, base ou valor de comissão.
- **W — workflow/auditoria:** proprietário/atribuições, aprovação, rejeição, cancelamento, ator/data de transição, histórico e marcadores `invoiced`/`completed`.

### 4.2 Leitura por role

| Classe | `admin` | `representative` | `read_only` |
|---|---|---|---|
| O | A — ALL | A — no escopo; catálogos ativos | A — no escopo; catálogos ativos |
| F1 em catálogo | A | A — somente preço corrente necessário à cotação | D |
| F1 em `Quote`/`Order` | A | A — somente OWN_ASSIGNED | D |
| F2 | A | D | D |
| W | A | A — eventos não confidenciais em OWN_ASSIGNED | A/R — status e datas; ocultar notas internas/ator sensível quando aplicável |

Respostas, exports, PDFs, logs e mensagens de erro obedecem à mesma projeção. Proibir no endpoint e depois vazar em CSV/PDF não conta como autorização.

### 4.3 Alteração por role

| Campo/comando sensível | `admin` | `representative` | `read_only` |
|---|---|---|---|
| Alterar `creditLimit` | A | D | D |
| Alterar preço de catálogo | A | D | D |
| Selecionar lista ativa no próprio orçamento `draft` | A | A — OWN_ASSIGNED | D |
| Sobrescrever preço unitário | A — somente `draft` | D | D |
| Alterar desconto por linha/geral | A — somente `draft` | D | D |
| Alterar regra/taxa de comissão | A | D | D |
| Alterar snapshot financeiro após envio/conversão | D | D | D |
| Reatribuir proprietário | A | D | D |
| Executar transição de workflow | conforme seções 9–10 | conforme seções 9–10 | D |

## 5. Clientes — `Customer`

| Comando | `admin` | `representative` | `read_only` | Precondições e efeito |
|---|---|---|---|---|
| `customer.create` | A — ALL | A — novo registro vira OWN_ASSIGNED | D | `creditLimit` enviado por representante é rejeitado, não ignorado. |
| `customer.view` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED | Aplicar projeções O/F2. Arquivado só por referência histórica para não-admin. |
| `customer.list` | A — ALL | A/R — OWN_ASSIGNED ativos | A/R — EXPLICIT_ASSIGNED ativos | Arquivados ficam fora por default; admin usa filtro explícito. |
| `customer.updateOperational` | A — ativo | A — OWN_ASSIGNED ativo | D | Representante altera O, nunca F2, owner ou arquivo. |
| `customer.updateCreditLimit` | A — ativo | D | D | Informativo; auditar valor anterior/novo. |
| `customer.assign` | A — ALL | D | D | Atribuição ativa define escopo sem transferir owner automaticamente. |
| `customer.unassign` | A — ALL | D | D | Não apaga documentos; acesso derivado é recalculado. |
| `customer.archive` | A — ALL | D | D | Não permite seleção em novos orçamentos; referências históricas permanecem. |
| `customer.restore` | A — ALL | D | D | Suportado apenas para admin. |
| `customer.delete` | N/S | N/S | N/S | Sem exclusão física na Fase 1. |

Um cliente arquivado não pode receber novo orçamento. Orçamentos/pedidos existentes continuam legíveis no escopo e exibem snapshot/nome histórico.

## 6. Indústrias e transportadoras — `Industry`, `Carrier`

| Comando | `admin` | `representative` | `read_only` | Precondições e efeito |
|---|---|---|---|---|
| `industry.create` | A | D | D | Catálogo global. |
| `industry.view` | A — ALL | A/R — ACTIVE_CATALOG | A/R — ACTIVE_CATALOG | Comissão padrão é F2 e só aparece ao admin; arquivo histórico aparece apenas embutido no documento. |
| `industry.list` | A — ALL | A/R — ACTIVE_CATALOG | A/R — ACTIVE_CATALOG | Não-admin não lista arquivados. |
| `industry.updateOperational` | A — ativo | D | D | Campos O e ativos de logo. |
| `industry.updateDefaultCommission` | A — ativo | D | D | Alias interno de `commissionRule.create|update` com `scopeType=industry`; não expor dois endpoints concorrentes. |
| `industry.archive` | A | D | D | Produtos existentes não são apagados; bloquear uso em novo documento conforme contrato de integridade. |
| `industry.restore` | A | D | D | Exclusivo admin. |
| `carrier.create` | A | D | D | Catálogo global. |
| `carrier.view` | A — ALL | A/R — ACTIVE_CATALOG | A/R — ACTIVE_CATALOG | Projeção O; arquivo histórico aparece apenas embutido no documento. |
| `carrier.list` | A — ALL | A/R — ACTIVE_CATALOG | A/R — ACTIVE_CATALOG | Não-admin não lista arquivados. |
| `carrier.update` | A | D | D | Somente cadastro ativo. |
| `carrier.archive` | A | D | D | Não selecionável em novos orçamentos. |
| `carrier.restore` | A | D | D | Exclusivo admin. |
| `industry.delete` / `carrier.delete` | N/S | N/S | N/S | Sem exclusão física na Fase 1. |

## 7. Produtos — `Product`

| Comando | `admin` | `representative` | `read_only` | Precondições e efeito |
|---|---|---|---|---|
| `product.create` | A | D | D | Exige código/descrição/unidade e indústria ativa conforme contrato ER. |
| `product.view` | A — ALL | A/R — ACTIVE_CATALOG | A/R — ACTIVE_CATALOG | Rep vê O e preço corrente; consulta vê somente O. Arquivo histórico só aparece embutido. Ambos não veem comissão. |
| `product.list` | A — ALL | A/R — ACTIVE_CATALOG | A/R — ACTIVE_CATALOG | Mesma projeção de `view`. |
| `product.updateOperational` | A — ativo | D | D | Não altera preço nem comissão. |
| `product.updateTaxCatalogData` | A — ativo | D | D | NCM/CEST/IPI/ICMS/PIS/COFINS são cadastrais; não executa cálculo fiscal. |
| `product.setCommissionOverride` | A — ativo | D | D | Alias interno de `commissionRule.create|update|archive` com `scopeType=product`; `null` remove o override. Não expor dois endpoints concorrentes. |
| `product.addImage` / `product.removeImage` | A — ativo | D | D | Preservar referências de snapshots/PDF já gerados. |
| `product.attachTechnicalSheet` / `product.attachSafetySheet` | A — ativo | D | D | Metadados e storage conforme política técnica. |
| `product.viewImage` | A — ALL | A — ACTIVE_CATALOG | A — ACTIVE_CATALOG | Conteúdo e metadados seguem o escopo direto do produto; arquivo histórico só aparece embutido em documento acessível. |
| `product.viewTechnicalSheet` / `product.viewSafetySheet` | A — ALL | A — ACTIVE_CATALOG | A — ACTIVE_CATALOG | Download exige produto ativo diretamente acessível; referência histórica não concede download. |
| `product.archive` | A | D | D | Sai de seletores; documentos existentes usam snapshot. |
| `product.restore` | A | D | D | Exclusivo admin. |
| `product.delete` | N/S | N/S | N/S | Sem exclusão física na Fase 1. |

## 8. Preços e comissões — `PriceList`, `ProductPrice`, `CommissionRule`

| Comando | `admin` | `representative` | `read_only` | Precondições e efeito |
|---|---|---|---|---|
| `priceList.create` | A | D | D | Permitido somente se, após a transação, houver no máximo quatro listas correntes; a configuração inicial deve chegar a quatro. |
| `priceList.view` / `priceList.list` | A — ALL | A/R — ACTIVE_CATALOG com valores | A/R — ACTIVE_CATALOG sem valores | Nomes/semântica seguem pendentes; não inferir atribuição automática. |
| `priceList.updateMetadata` | A — ativo | D | D | Não reescreve snapshots existentes. |
| `priceList.setProductPrice` | A — lista e produto ativos | D | D | Decimal; cria nova versão/histórico conforme contrato, nunca sobrescreve história. |
| `priceList.activate` | A | D | D | Somente lista válida; ação auditada. |
| `priceList.archive` | A | D | D | Não selecionável em novas linhas; snapshots preservados. |
| `priceList.restore` | A | D | D | Exclusivo admin, se ainda compatível com limite de quatro correntes. |
| `priceHistory.view` | N/S | N/S | N/S | Histórico de preços é Fase 2; auditoria técnica da Fase 1 permanece em `audit.view`. |
| `commissionRule.create` | A | D | D | Cria uma regra tipada para `industry` ou `product`; unicidade por `(scopeType, scopeId)`. Não implica comissão devida/paga. |
| `commissionRule.view` / `commissionRule.list` | A — ALL | D | D | Recurso canônico que representa default de indústria e override de produto. |
| `commissionRule.update` | A — regra e cadastro-alvo ativos | D | D | Só afeta documentos futuros; snapshots existentes são imutáveis. |
| `commissionRule.archive` | A — regra ativa | D | D | Desativa a regra; produto passa ao default da indústria, e indústria fica sem taxa configurada. Não altera snapshots. |
| `commissionRule.restore` | A | D | D | Reativa a mesma regra se o cadastro-alvo estiver ativo e não houver regra concorrente. |
| `commissionSnapshot.view` | A | D | D | Até decisão de exposição; default de menor privilégio. |
| qualquer `*.delete` físico | N/S | N/S | N/S | Preservar integridade histórica. |

## 9. Orçamentos — `Quote`

### 9.1 Operações de registro e conteúdo

| Comando | `admin` | `representative` | `read_only` | Precondições e efeito |
|---|---|---|---|---|
| `quote.create` | A — ALL | A — OWN_ASSIGNED | D | Cliente ativo e acessível; estado inicial `draft`; número transacional. |
| `quote.view` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED | Aplicar projeções; consulta não recebe F1/F2. |
| `quote.list` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED | Filtros nunca ampliam escopo. |
| `quote.updateOperational` | A — ALL | A — OWN_ASSIGNED | D | Somente `draft`; limita-se a `validUntil` e `notes`. Frete/pagamento/transportadora têm comandos próprios; nunca inclui owner, linhas, preço, desconto ou estado. |
| `quote.addLine` / `quote.updateQuantity` / `quote.removeLine` | A — ALL | A — OWN_ASSIGNED | D | Somente `draft`; produto e lista ativos; preço vem da lista. |
| `quote.selectPriceList` | A — ALL | A — OWN_ASSIGNED | D | Somente `draft`; seleção explícita entre listas ativas. |
| `quote.overrideUnitPrice` | A — ALL | D | D | Somente `draft`; motivo e auditoria obrigatórios. |
| `quote.setLineDiscount` / `quote.setOverallDiscount` | A — ALL | D | D | Somente `draft`; regra de cálculo é input pendente. |
| `quote.setFreight` / `quote.setPaymentTerms` / `quote.setCarrier` | A — ALL | A — OWN_ASSIGNED | D | Somente `draft`; transportadora ativa quando informada. |
| `quote.reassign` | A — ALL | D | D | Não muda autor/histórico. |
| `quote.duplicate` | A — ALL | A — se a origem está em OWN_ASSIGNED | D | Cria novo `draft`, novo número, owner=ator; revalida cliente/produtos/lista e usa preços correntes, sem copiar aprovação. |
| `quote.generatePdf` | A — ALL | A — OWN_ASSIGNED | D | Permitido em qualquer estado acessível; usa valores atuais no `draft` e snapshot bloqueado nos demais estados. Contém F1, nunca comissão/limite. PDF não concede acesso futuro. |
| `quote.archive` / `quote.restore` | N/S | N/S | N/S | Documentos usam estados e histórico, não arquivo lógico. |
| `quote.delete` | N/S | N/S | N/S | Sem exclusão física. |

### 9.2 Comandos de workflow

| Comando | Transição | `admin` | `representative` | `read_only` | Regras adicionais |
|---|---|---|---|---|---|
| `quote.send` | `draft → sent` | A — ALL | A — OWN_ASSIGNED | D | Exige validade futura, itens válidos, snapshot e total determinístico. Bloqueia edição. |
| `quote.approve` | `sent → approved` | A — ALL | D | D | Registrar ator/data; não declarar aprovação do cliente sem evidência. |
| `quote.reject` | `sent → rejected` | A — ALL | D | D | Motivo obrigatório; `rejected` é terminal. |
| `quote.expire` | `sent → expired` | A — ALL e job do sistema | D | D | Job idempotente quando `now > validUntil`; `expired` é terminal. |
| `quote.cancel` | `draft|sent|approved → cancelled` | A — ALL | A — OWN_ASSIGNED apenas em `draft|sent` | D | Motivo obrigatório. Representante não cancela aprovado. |
| `quote.convert` | `approved → converted` + cria `Order(open)` | A — ALL | A — OWN_ASSIGNED | D | Um pedido por orçamento; transação, unicidade e idempotência obrigatórias. |

### 9.3 Estados terminais e bloqueios

- `rejected`, `expired`, `converted` e `cancelled` são terminais.
- Após `sent`, nenhuma edição de cliente, linhas, quantidade, preço, desconto, frete, pagamento, transportadora ou snapshots é permitida.
- Após qualquer estado terminal, são proibidos update, send, approve, reject, expire, cancel e convert.
- `duplicate` é uma nova criação e pode partir de um orçamento acessível em qualquer estado; nunca altera nem “reabre” a origem.
- Não existe `restore`, `reopen` ou transição reversa na Fase 1.

## 10. Pedidos — `Order`

### 10.1 Operações de registro e conteúdo

| Comando | `admin` | `representative` | `read_only` | Precondições e efeito |
|---|---|---|---|---|
| `order.createDirect` | N/S | N/S | N/S | Pedido nasce somente de `quote.convert`. |
| `order.view` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED | Consulta não recebe F1/F2; representante não recebe comissão. |
| `order.list` | A — ALL | A/R — OWN_ASSIGNED | A/R — EXPLICIT_ASSIGNED | Filtros nunca ampliam escopo. |
| `order.updateOperational` | A — ALL | A — OWN_ASSIGNED | D | Somente `open` e somente `notes`; nunca owner, estado, origem, linhas ou snapshots financeiros. |
| `order.updateLine` / `order.updatePrice` / `order.updateDiscount` / `order.updateCommission` | D | D | D | Snapshots convertidos são imutáveis; correção exige política futura, não edição silenciosa. |
| `order.reassign` | A — ALL | D | D | Não muda autor/orçamento de origem. |
| `order.addAttachment` | A — ALL | A — OWN_ASSIGNED em `open|confirmed` | D | Não disponível após `invoiced`, `completed` ou `cancelled`. |
| `order.removeAttachment` | A — ALL em `open|confirmed` | A — OWN_ASSIGNED em `open` e somente anexo próprio não referenciado | D | Remoção lógica; histórico preservado. |
| `order.viewAttachment` | A — ALL | A — OWN_ASSIGNED | D | Segue escopo do pedido; `read_only` não recebe conteúdo nem metadados no default MVP. |
| `order.generatePdf` | N/S | N/S | N/S | PDF de pedido não é inequivocamente exigido na §9; não inventar até decisão. |
| `order.archive` / `order.restore` | N/S | N/S | N/S | Documentos usam estados e histórico. |
| `order.delete` | N/S | N/S | N/S | Sem exclusão física. |

### 10.2 Comandos de workflow

| Comando | Transição | `admin` | `representative` | `read_only` | Regras adicionais |
|---|---|---|---|---|---|
| `order.confirm` | `open → confirmed` | A — ALL | D | D | Valida snapshots/origem; não consulta limite de crédito como bloqueio. |
| `order.markInvoiced` | `confirmed → invoiced` | A — ALL | D | D | Marco operacional; não emite NF, não calcula tributo e não integra ERP. |
| `order.complete` | `invoiced → completed` | A — ALL | D | D | `completed` é terminal. |
| `order.cancel` | `open|confirmed → cancelled` | A — ALL | D | D | Motivo obrigatório. Cancelamento após `invoiced` é D para todos até input do negócio. |

### 10.3 Estados terminais e bloqueios

- `completed` e `cancelled` são terminais.
- `invoiced` não é terminal, mas fica bloqueado para qualquer alteração, anexo ou cancelamento; só permite `complete` ao admin.
- Após `confirmed`, não se alteram conteúdo, linhas ou snapshots; somente anexos permitidos pela tabela e transições.
- Após estado terminal, nenhum update, confirm, markInvoiced, complete, cancel, archive, restore ou delete é permitido.
- Não existem transições reversas (`confirmed → open`, `invoiced → confirmed`, `completed → invoiced`) na Fase 1.

## 11. Usuários, atribuições, exports e auditoria

| Comando | `admin` | `representative` | `read_only` | Regra |
|---|---|---|---|---|
| `user.create` / `user.updateRole` / `user.disable` | A | D | D | Mudança de role não transfere owner; invalida sessão conforme política técnica. |
| `assignment.create` / `assignment.revoke` | A | D | D | Escopo explícito e auditável; revogação não altera registros. |
| `audit.view` | A | D | D | Logs podem conter F2 e justificativas internas. |
| `export.customers` | N/S | N/S | N/S | Exportações são Fase 2; não existe endpoint de Fase 1. |
| `export.quotes` / `export.orders` | N/S | N/S | N/S | Exportações são Fase 2; não existe endpoint de Fase 1. |
| `report.commissions` | N/S | N/S | N/S | Recurso de Fase 2; não antecipar relatório, aquisição ou pagamento de comissão. |

Jobs internos não possuem role humano, usam uma identidade de sistema dedicada e só podem executar o comando específico configurado (por exemplo, `quote.expire`). “Sistema” não equivale a `admin` e não recebe acesso genérico.

## 12. Regras de arquivo, restauração e referência histórica

1. `Customer`, `Industry`, `Product`, `Carrier`, `PriceList` e regras configuráveis são arquivados logicamente por `admin`.
2. Somente `admin` lista arquivados por filtro explícito, restaura e vê o cadastro completo arquivado.
3. Cadastro arquivado é imutável: qualquer update, troca de arquivo, anexo ou configuração falha com `409 conflict` até `restore` por admin.
4. Representante/consulta podem receber a projeção histórica mínima de um cadastro arquivado apenas dentro de um `Quote`/`Order` já acessível; endpoint direto/lista/selector continua negado.
5. Cadastro arquivado não pode ser associado a novo orçamento, nova linha, nova lista ou nova regra.
6. Arquivamento não altera snapshot, total, comissão aplicada ou PDF previamente gerado.
7. Se integridade exigir que uma indústria permaneça ativa enquanto um produto está ativo, o comando falha com `409 conflict`; autorização admin não remove a invariante.
8. Orçamentos e pedidos nunca são arquivados/restaurados/excluídos na Fase 1.

## 13. Casos de teste normativos

Os exemplos abaixo são requisitos mínimos de autorização. Cada serviço deve também testar a tabela completa, estados e invariantes.

### 13.1 Escopo do representante

- **Dado** representante A, cliente de A e cliente de B, **quando** A lista clientes, **então** recebe somente o próprio/atribuído e sem `creditLimit`.
- **Dado** representante A e ID de orçamento de B, **quando** A consulta ou converte esse ID, **então** recebe `404 not_found`, sem revelar existência ou estado.
- **Dado** representante A criando cliente com `ownerUserId=B` ou `creditLimit`, **quando** envia o comando, **então** recebe `403 forbidden`/erro de campo proibido e nada é persistido.

### 13.2 Consulta/leitura

- **Dado** `read_only` sem atribuição, **quando** lista clientes/orçamentos/pedidos, **então** recebe lista vazia.
- **Dado** `read_only` atribuído a um pedido, **quando** consulta o pedido, **então** vê O/W permitido, mas a resposta não contém preços, descontos, totais, comissão nem limite de crédito.
- **Dado** qualquer registro acessível, **quando** `read_only` tenta comando de mutação suportado (create/update/send/approve/reject/expire/cancel/convert/confirm/markInvoiced/complete ou archive/restore de cadastro), **então** recebe `403 forbidden` e não há evento de domínio; **quando** chama comando inexistente, como archive/restore de documento, **então** recebe `not_supported` para todos os roles.

### 13.3 Preços, descontos, comissões e crédito

- **Dado** representante em orçamento próprio `draft`, **quando** seleciona lista ativa, **então** o preço salvo é aplicado; **quando** envia preço manual ou desconto, **então** recebe `403 forbidden`.
- **Dado** representante ou consulta, **quando** acessa `CommissionRule`, **então** recebe `403` no escopo legítimo ou `404` fora dele; comissão não aparece em endpoints relacionados.
- **Dado** `admin`, **quando** atualiza `creditLimit`, **então** a alteração é auditada; **quando** um pedido excede o limite, **então** nenhum workflow é bloqueado por esse fato.

### 13.4 Workflow e estados terminais

- **Dado** representante e orçamento próprio `sent`, **quando** tenta aprovar/rejeitar, **então** recebe `403`; **quando** admin aprova, **então** muda para `approved` com ator/data.
- **Dado** orçamento `approved` próprio, **quando** representante converte, **então** cria um único `Order(open)` e muda a origem para `converted` atomicamente.
- **Dado** orçamento `rejected|expired|converted|cancelled`, **quando** qualquer role tenta mutá-lo ou transicionar, **então** falha; `admin` não ignora terminalidade.
- **Dado** pedido `open` próprio, **quando** representante tenta confirmar, **então** recebe `403`; somente admin executa `open → confirmed`.
- **Dado** pedido `invoiced`, **quando** qualquer role tenta cancelar ou anexar, **então** falha; somente admin pode concluir.
- **Dado** pedido `completed|cancelled`, **quando** qualquer role tenta qualquer mutação, **então** falha sem alteração.

### 13.5 Arquivamento e restauração

- **Dado** produto arquivado, **quando** representante lista/seleciona produtos, **então** ele não aparece; **quando** abre pedido histórico acessível, **então** vê o snapshot sem acesso direto ao cadastro arquivado.
- **Dado** cadastro arquivado, **quando** representante ou consulta tenta restaurar, **então** recebe `403`; admin pode restaurar se as invariantes permitirem.
- **Dado** orçamento ou pedido, **quando** qualquer role chama archive/restore/delete, **então** recebe `not_supported` e o documento permanece intacto.

## 14. Esqueleto para testes parametrizados de backend

Cada linha das matrizes deve gerar casos com a forma:

```text
authorize({
  actor: { role, organizationId, userId },
  command,
  resource: { organizationId, ownerUserId, assignments, archivedAt, state },
  requestedFields
}) -> allow | allow_redacted(projection) | forbidden | not_found | not_supported | conflict
```

Conjunto mínimo de dimensões:

1. os três roles;
2. registro dentro e fora da organização;
3. próprio, atribuído, não atribuído e global;
4. ativo e arquivado;
5. todos os estados de `Quote` e `Order`;
6. campos O, F1, F2 e W isolados e combinados;
7. endpoint de leitura, lista, export e PDF;
8. tentativa repetida e concorrente para conversão/transição;
9. vínculo ativo e atribuição revogada;
10. comando suportado, proibido e inexistente.

A regra esperada deve ser derivada da combinação exata `role + command + scope + fieldClass + state`; nenhum teste deve usar “admin sempre pode” como atalho.

## 15. Decisões que exigem confirmação antes de ampliar acesso

| Input pendente | Default atual | Mudança possível após decisão |
|---|---|---|
| Escopo de representante | OWN_ASSIGNED | Todos, equipe, território ou carteira, com regra explícita. |
| Escopo do `read_only` | EXPLICIT_ASSIGNED e projeção sem F1/F2 | Alcance global/parcial e classes financeiras específicas. |
| Aprovação/rejeição | somente admin | Grant/role específico ou aprovação externa auditável. |
| Limite de desconto por representante | nenhum desconto permitido | Política Decimal por role/linha/documento. |
| Preço manual por representante | proibido | Grant e faixa auditável. |
| Visibilidade de comissão/limite | somente admin | Projeção específica, nunca exposição implícita. |
| Cancelamento após faturamento | proibido para todos | Fluxo compensatório explícito; nunca reversão silenciosa. |
| PDF de pedido | não suportado | Comando/template específico após confirmação do negócio. |
| Restauração | suportada somente para admin | Política futura de retenção/LGPD pode restringir ou remover a ação. |

Até essas respostas existirem, o backend deve manter os defaults desta matriz. O PDF não autoriza ampliar nenhum deles.

## 16. Limites explícitos

- `order.markInvoiced` registra somente um marco operacional. Não emite nota fiscal.
- Campos IPI, ICMS, PIS, COFINS, NCM e CEST não constituem motor tributário nem autorizam cálculo fiscal.
- Nenhum role executa integração ERP, financeira, WhatsApp, assinatura digital ou portal de cliente na Fase 1.
- Comissão registrada/snapshot não significa comissão devida, aprovada, paga ou estornada.
- Limite de crédito não é saldo, cobrança, trava nem aprovação financeira.
