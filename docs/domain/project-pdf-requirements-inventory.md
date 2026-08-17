# Inventário de requisitos do domínio — `project.pdf`

Status: extração de requisitos para orientar o contrato de domínio da Fase 1

Fonte primária: `C:/Users/jvcal/Downloads/project.pdf` (5 páginas, 16 seções)

Idioma de negócio: pt-BR; nomes propostos para código/schema: inglês.

## 1. Como ler este documento

Classificação usada:

- **CONFIRMADO NO PDF**: requisito literalmente presente ou relação inevitável descrita pela fonte.
- **DECISÃO HERDADA DO ÉPICO**: decisão já fixada no cartão pai, mas ausente do PDF; não deve ser apresentada ao stakeholder como texto da fonte.
- **SUPOSIÇÃO SEGURA DE MVP**: escolha reversível e conservadora que permite implementar a Fase 1.
- **OPCIONAL NA FASE 1**: pode permanecer nulo/ausente sem impedir o fluxo principal.
- **INPUT DE NEGÓCIO PENDENTE**: requer decisão do stakeholder; impacto e fallback seguro são indicados.

O PDF é sintético. Ele lista capacidades e campos, mas não define cardinalidades completas, estados, permissões detalhadas, fórmulas, precisão numérica, política de arquivamento ou critérios de obrigatoriedade. Essas lacunas estão visíveis abaixo, sem converter inferência em “requisito confirmado”.

## 2. Mapa de rastreabilidade da fonte

| Página | Seções | Conteúdo relevante |
|---|---|---|
| 1 | título; §1–§4 | objetivo, perfis, módulos, fluxo principal |
| 2 | §5–§7 | campos de clientes, indústrias e produtos |
| 3 | §8–§10 | orçamentos, pedidos e dashboard |
| 4 | §11–§13 | relatórios, PDF comercial e design system |
| 5 | §14–§16 | tabelas de banco, funcionalidades futuras e fases |

## 3. Terminologia e conceitos canônicos

| Termo no negócio | Nome proposto em código/schema | Classificação e evidência | Observação |
|---|---|---|---|
| Cliente | `Customer` / `customers` | CONFIRMADO — p.1 §1, p.1 §3–§4, p.2 §5, p.5 §14 | Comprador/destinatário de orçamento e pedido. |
| Indústria | `Industry` / `industries` | CONFIRMADO — p.1 §1/§3, p.2 §6–§7, p.5 §14 | Fabricante/representada associada a produtos e comissão padrão. O PDF também usa “fabricante”; equivalência exata precisa ser confirmada. |
| Produto | `Product` / `products` | CONFIRMADO — p.1 §1/§3, p.2 §7, p.5 §14 | Item comercializável com códigos, dados logísticos, preços e comissão. |
| Transportadora | `Carrier` / `carriers` | CONFIRMADO — p.1 §3, p.3 §8, p.5 §14 | Pode ser selecionada no orçamento; campos cadastrais não foram definidos. |
| Orçamento | `Quote` / `quotes` | CONFIRMADO — p.1 §1/§3–§4, p.3 §8, p.5 §14 | Documento comercial numerado, com validade, frete, pagamento, itens e descontos. |
| Item de orçamento | `QuoteLine` / `quote_lines` | CONFIRMADO — p.3 §8 (“Produtos”, desconto por item), p.5 §14 | Linha associando produto e orçamento; campos de snapshot não aparecem no PDF. |
| Aprovação | `QuoteApproval` ou comando/estado em `Quote` | CONFIRMADO como etapa — p.1 §4 | Ator, canal e critérios da aprovação não são definidos. |
| Pedido | `Order` / `orders` | CONFIRMADO — p.1 §1/§3–§4, p.3 §9, p.5 §14 | Criado por conversão de orçamento, com descontos, IPI, comissão, anexos e histórico. |
| Item de pedido | `OrderLine` / `order_lines` | CONFIRMADO — p.5 §14; relação reforçada por p.3 §9 | Deve preservar os itens convertidos; conteúdo exato não é especificado. |
| Tabela de preço | `PriceList` / `price_lists` | CONFIRMADO — p.2 §7 (“preço 1, 2, 3 e 4”), p.5 §14 | Há quatro preços correntes, mas a semântica/nome de cada tabela e sua seleção não são definidos. |
| Histórico de preços | `PriceHistory` / `price_history` | CONFIRMADO para Fase 2 — p.4 §11, p.5 §16 | Não é entrega obrigatória da Fase 1, embora snapshots de linha sejam necessários para integridade histórica conforme decisão herdada. |
| Comissão | `CommissionRule`/`CommissionSnapshot` | CONFIRMADO — p.1 §1, p.2 §6–§7, p.3 §9, p.4 §11, p.5 §14 | Existem comissão padrão da indústria e comissão no produto. Precedência não está no PDF. |
| Usuário | `User` / `users` | CONFIRMADO — p.1 §2, p.5 §14 | Conta de acesso com um dos perfis listados. |
| Representante Comercial | `Representative` ou `User` com role `representative` | CONFIRMADO — p.1 §2 | O PDF não esclarece se é entidade separada, perfil de usuário, ou ambos. |
| Administrador | role `admin` | CONFIRMADO — p.1 §2 | Capacidades específicas não são definidas. |
| Consulta/Leitura | role `read_only` | CONFIRMADO — p.1 §2 | Interpretação segura: nenhuma mutação. Escopo de leitura e acesso financeiro não definidos. |
| Anexo | `Attachment` / `attachments` | CONFIRMADO — p.3 §9, p.5 §14 | Pedido possui anexos; o PDF não exclui anexos em outras entidades. |
| Arquivamento | `archivedAt`/`archivedBy` | AUSENTE NO PDF | Política deve ser decidida no contrato de domínio. |

## 4. Atores e escopo de acesso

### 4.1 Confirmado

O sistema possui três perfis (p.1 §2):

1. **Administrador** (`admin`)
2. **Representante Comercial** (`representative`)
3. **Consulta/Leitura** (`read_only`)

### 4.2 Não definido pela fonte

O PDF não informa:

- se um usuário pode ter mais de um perfil;
- se representantes enxergam todos os registros ou somente registros próprios/atribuídos;
- quem aprova orçamentos;
- quem pode alterar preço, desconto, comissão e limite de crédito;
- se “Consulta/Leitura” pode ver informações financeiras, fiscais cadastrais e comissões;
- se clientes têm login (o “Portal para clientes” é apenas futuro, p.5 §15).

### 4.3 Suposição segura para o MVP

- Um usuário possui um role principal (`User.role`) na Fase 1.
- `read_only` não executa comandos de alteração.
- Aplicar menor privilégio ao representante até decisão explícita: acesso de escrita somente aos próprios/atribuídos registros comerciais; cadastros globais e regras de preço/comissão administrados por `admin`.
- Não criar usuário/role de cliente na Fase 1, pois o portal é futuro.

Essas escolhas são defaults de segurança, não requisitos do PDF.

## 5. Entidades, campos e relações

### 5.1 Cliente (`Customer`)

**Campos confirmados** — p.2 §5:

| Campo pt-BR | Nome proposto | Fase 1 sugerida |
|---|---|---|
| Razão Social | `legalName` | obrigatório para pessoa jurídica; ver ambiguidade de tipo de cliente |
| Nome Fantasia | `tradeName` | opcional |
| CNPJ | `taxId` ou `cnpj` | opcional até confirmar se todo cliente é PJ; único quando preenchido |
| IE | `stateRegistration` | opcional |
| Endereço | `streetAddress`/estrutura `address` | opcional sem regra de decomposição definida |
| CEP | `postalCode` | opcional |
| Cidade | `city` | opcional |
| Estado | `state` | opcional |
| Telefone | `phone` | opcional |
| WhatsApp | `whatsapp` | opcional |
| E-mail | `email` | opcional |
| Contato | `contactName` | opcional |
| Segmento | `segment`/`segmentId` | opcional; catálogo livre versus entidade não definido |
| Limite de crédito | `creditLimit` | opcional e **somente informativo no MVP** |
| Observações | `notes` | opcional |

**Relações confirmadas ou inevitáveis:**

- Cliente 1:N Orçamentos (`Customer` → `Quote`) — p.1 §4; p.3 §8.
- Cliente 1:N Pedidos (`Customer` → `Order`) — p.1 §4; p.3 §9.

**Importante:** limite de crédito não bloqueia pedido/orçamento, não dispara aprovação e não representa integração financeira no MVP. Qualquer validação de crédito seria comportamento inventado.

### 5.2 Indústria (`Industry`)

**Campos confirmados** — p.2 §6:

| Campo pt-BR | Nome proposto | Fase 1 sugerida |
|---|---|---|
| Razão Social | `legalName` | obrigatório |
| Nome Fantasia | `tradeName` | opcional |
| CNPJ | `taxId` ou `cnpj` | opcional, único quando preenchido |
| Endereço | `address` | opcional |
| Comissão padrão | `defaultCommissionRate` | opcional até ser configurada |
| Observações | `notes` | opcional |

**Relações:**

- Indústria 1:N Produtos é a leitura mais direta de “fabricante” no cadastro de produto (p.2 §7), mas **a equivalência entre indústria, fabricante e marca deve ser confirmada**.
- Indústria pode fornecer uma comissão padrão (p.2 §6).
- PDF comercial inclui logo da indústria (p.4 §12), mas campo de logo não aparece no cadastro da §6; tratá-lo como opcional (`logoAssetId`).

### 5.3 Produto (`Product`)

**Campos confirmados** — p.2 §7:

| Campo pt-BR | Nome proposto | Fase 1 sugerida |
|---|---|---|
| Código interno | `internalCode` | obrigatório e único |
| Código fabricante | `manufacturerCode` | opcional; unicidade por indústria a confirmar |
| Descrição | `description` | obrigatório |
| Marca | `brand`/`brandId` | opcional; entidade própria não exigida no PDF |
| Fabricante | `industryId`/`manufacturerId` | recomendado obrigatório para comissão e PDF; terminologia pendente |
| Categoria | `category`/`categoryId` | opcional |
| NCM | `ncm` | opcional, dado cadastral |
| CEST | `cest` | opcional, dado cadastral |
| EAN | `ean` | opcional, único quando preenchido se confirmado pelo negócio |
| DUN | `dun` | opcional, único quando preenchido se confirmado pelo negócio |
| Embalagem | `packaging` | opcional |
| Unidade | `unit` | recomendado obrigatório para linhas comerciais |
| Peso líquido | `netWeight` | opcional |
| Peso bruto | `grossWeight` | opcional |
| Dimensões | `dimensions` | opcional; formato não definido |
| IPI | `ipiRate`/`ipiValue` | opcional; significado (alíquota/valor) não definido |
| ICMS | `icmsRate` | opcional cadastral |
| PIS | `pisRate` | opcional cadastral |
| COFINS | `cofinsRate` | opcional cadastral |
| Preço 1–4 | quatro `ProductPrice` ligados a `PriceList` | valores opcionais individualmente até definir política de disponibilidade |
| Comissão | `commissionRateOverride` | opcional; override por produto conforme decisão herdada |
| Fotos | `ProductImage[]` | opcional |
| Ficha técnica | `technicalSheetAttachmentId` | opcional |
| FISPQ | `safetyDataSheetAttachmentId` | opcional |

**Restrição:** a mera presença de IPI, ICMS, PIS, COFINS, NCM e CEST não autoriza implementar motor tributário, emissão fiscal, cálculo por UF, base de cálculo ou obrigações acessórias. O PDF apenas lista dados de produto e “IPI” no pedido (p.3 §9).

### 5.4 Transportadora (`Carrier`)

**Confirmado:** módulo/cadastro, tabela de banco e seleção no orçamento (p.1 §3, p.3 §8, p.5 §14).

**Campos não fornecidos:** nenhum. Suposição mínima reversível: `id`, `name`, `notes?`, timestamps e arquivo lógico. Não inventar CNPJ, endereço ou contatos como obrigatórios.

**Relação:** uma transportadora pode ser selecionada por muitos orçamentos; um orçamento possui zero ou uma transportadora até que o frete seja definido.

### 5.5 Orçamento (`Quote`) e Item de orçamento (`QuoteLine`)

**Campos/capacidades confirmados** — p.3 §8:

- numeração automática;
- validade (`validUntil`);
- frete (`freight` — tipo/valor/responsável não definido);
- forma de pagamento (`paymentTerms`/`paymentMethod` — catálogo não definido);
- transportadora (`carrierId`, opcional até seleção);
- produtos (`QuoteLine[]`);
- desconto por item (`lineDiscount`);
- desconto geral (`overallDiscount`);
- geração de PDF;
- conversão para pedido;
- duplicação.

**Fluxo confirmado:** Cliente → Orçamento → Aprovação → Pedido → PDF → Relatórios (p.1 §4).

**Ambiguidades:**

- “Aprovação” pode ser interna ou do cliente; canal e prova não definidos.
- O PDF não define estados nem transições.
- O PDF não define fórmula/ordem de aplicação dos descontos, frete, IPI e arredondamento.
- “PDF” aparece após Pedido no fluxo, mas §8 também exige PDF de orçamento; logo, ao menos orçamento gera PDF, e talvez pedido também.
- Numeração é automática, porém formato, escopo anual e comportamento concorrente não constam no PDF.

**Decisões herdadas do épico, não da fonte:** estados `draft`, `sent`, `approved`, `rejected`, `expired`, `converted`, `cancelled`; número `ORC-YYYY-NNNNNN` transacional; snapshots imutáveis de linha; cálculo Decimal.

### 5.6 Pedido (`Order`) e Item de pedido (`OrderLine`)

**Campos/capacidades confirmados** — p.3 §9:

- conversão automática de orçamento;
- controle de descontos;
- IPI;
- comissão;
- anexos;
- histórico.

**Relações confirmadas/fortemente implicadas:**

- Orçamento origina Pedido (p.1 §4, p.3 §8–§9).
- Pedido possui itens (p.5 §14).
- Pedido possui anexos (p.3 §9, p.5 §14).

**Ambiguidades:**

- “conversão automática” pode significar cópia automática dos dados após comando/aprovação, não criação sem ação humana;
- um orçamento pode gerar um ou vários pedidos — não informado;
- não há estados de pedido no PDF;
- “histórico” não especifica eventos, autor, timestamps ou retenção;
- “IPI” não especifica se é snapshot, alíquota, valor calculado ou apenas informação;
- não há comportamento fiscal/nota fiscal.

**Decisões herdadas do épico, não da fonte:** estados `open`, `confirmed`, `invoiced`, `completed`, `cancelled`; no máximo um pedido por orçamento; número `PED-YYYY-NNNNNN`; `invoiced` é somente marco operacional, sem emissão fiscal; snapshots imutáveis de linha.

### 5.7 Tabela de preço e histórico (`PriceList`, `ProductPrice`, `PriceHistory`)

**Confirmado:** produto possui preço 1, 2, 3 e 4 (p.2 §7); banco prevê “Tabelas de Preço” (p.5 §14); histórico de preços e relatório correspondente pertencem à Fase 2 (p.4 §11, p.5 §16).

**Leitura segura do contrato:** quatro listas correntes (`PriceList`) associam um preço a cada produto (`ProductPrice`). Não representar preços com quatro colunas opacas se o contrato precisa manter histórico e snapshots.

**Não definido:** nomes/significados das listas, moeda, vigência, quem escolhe a lista, se lista é por cliente/segmento/representante/indústria, se todos os quatro preços são obrigatórios e como preço ausente se comporta.

### 5.8 Comissão (`CommissionRule`, snapshot em linha/pedido)

**Confirmado:** comissão padrão na indústria (p.2 §6), comissão no produto (p.2 §7), comissão no pedido (p.3 §9), módulo/tabela de comissões (p.5 §14) e relatório de comissões na Fase 2 (p.4 §11, p.5 §16).

**Decisão herdada do épico:** precedência `product override → industry default`; persistir a taxa aplicada no snapshot da linha/pedido.

**Não definido:** base de cálculo, momento de aquisição, responsável/beneficiário, parcelamento, arredondamento, estorno em cancelamento/devolução, aprovação e pagamento. Não inferir que comissão é “devida” apenas porque um pedido foi criado.

### 5.9 Usuário, representante e anexos

- `User`: tabela confirmada em p.5 §14 e roles em p.1 §2.
- `Representative`: ator confirmado, mas tabela separada não listada. Suposição segura: perfil de `User` com eventual `representativeProfile` somente se dados adicionais surgirem.
- `Attachment`: tabela e anexos de pedidos confirmados (p.3 §9, p.5 §14). Metadados mínimos seguros: `id`, nome original, MIME type, tamanho, storage key, autor e timestamps. Limites de formato/tamanho/retenção são inputs pendentes.

## 6. Regras de negócio e cálculos

### 6.1 Confirmadas no PDF

1. Orçamentos têm numeração automática (p.3 §8).
2. Orçamentos aceitam desconto por item e desconto geral (p.3 §8).
3. Orçamentos podem ser duplicados e convertidos em pedidos (p.3 §8).
4. Pedidos resultam da conversão de orçamento e controlam descontos, IPI e comissão (p.3 §9).
5. Indústria possui comissão padrão; produto possui comissão própria (p.2 §6–§7).
6. Produto possui quatro preços (p.2 §7).
7. PDF comercial contém marcas, imagens e dados financeiros (p.4 §12).

### 6.2 Decisões técnicas/contratuais herdadas do épico

Estas decisões devem ser obedecidas pelos trabalhos seguintes, mas não citadas como originárias do PDF:

- dinheiro e percentuais usam Decimal; nunca `number`/floating point de JavaScript em cálculos de negócio;
- quatro listas de preços correntes e histórico;
- snapshot imutável de descrição, preço, descontos, impostos informativos e comissão em itens de orçamento/pedido;
- comissão usa override do produto antes do default da indústria;
- um único pedido por orçamento, com idempotência e unicidade no banco;
- numeração transacional anual `ORC-YYYY-NNNNNN` e `PED-YYYY-NNNNNN`;
- limite de crédito é informativo;
- nenhum motor fiscal ou emissão de nota fiscal.

### 6.3 Fórmulas ainda não determinadas

Não há base documental para decidir:

- se desconto por item é percentual ou valor fixo, ou ambos;
- ordem entre desconto por item, desconto geral, IPI e frete;
- rateio do desconto geral entre linhas;
- se IPI integra total, comissão ou somente exibição;
- precisão, escala e regra de arredondamento;
- base da comissão (bruto, líquido de descontos, sem/com IPI, sem/com frete);
- moeda (presumivelmente BRL, mas não declarada).

Até decisão, a especificação de workflow deve rotular qualquer fórmula como default de MVP, não requisito da fonte.

## 7. PDFs comerciais

### 7.1 Confirmado — p.4 §12

O “PDF Comercial Premium” deve oferecer:

- layout inspirado no mockup aprovado;
- logo da Carol Weyne;
- logo da indústria;
- fotos dos produtos;
- dados do cliente;
- resumo financeiro;
- assinaturas;
- versão resumida e versão comercial.

### 7.2 Inputs ausentes

- mockup aprovado não está embutido no PDF analisado;
- diferença exata entre versão resumida e comercial;
- quais dados do cliente e campos financeiros aparecem;
- assinaturas: nomes/cargos, imagem ou apenas campos, e em qual documento;
- inclusão/exclusão de tributos, comissão, preços alternativos e observações;
- política de versão/imutabilidade do PDF gerado.

Assinatura digital é futura (p.5 §15); portanto, “assinaturas” na Fase 1 não implica assinatura digital verificável.

## 8. Histórico, exclusão e arquivamento

### 8.1 Confirmado

- Pedido possui “Histórico” (p.3 §9).
- Histórico de preços está previsto em relatórios/Fase 2 (p.4 §11, p.5 §16).

### 8.2 Ausente

O PDF não define exclusão, restauração, retenção, auditoria, versionamento, LGPD ou arquivamento de clientes, indústrias, produtos, transportadoras, usuários, orçamentos e pedidos.

### 8.3 Suposição segura de MVP

- Cadastros referenciados por documentos comerciais não devem ser apagados fisicamente; usar arquivamento lógico (`archivedAt`, `archivedBy`).
- Arquivados não aparecem em seletores de novos documentos, mas permanecem visíveis nos históricos existentes.
- Orçamentos/pedidos não são apagados; estados terminais preservam rastreabilidade.
- Linhas guardam snapshots para que alterações ou arquivamento de produto, preço, indústria e comissão não reescrevam documentos anteriores.
- Restauração deve ser restrita ao administrador se for implementada.

Essa política é uma suposição de integridade e precisa ser formalizada pelo cartão do modelo ER.

## 9. Módulos, fases e limites de escopo

### 9.1 Objetivo e módulos confirmados

Objetivo: centralizar clientes, produtos, indústrias, pedidos, orçamentos, comissões e relatórios em uma plataforma responsiva (p.1 §1).

Módulos listados (p.1 §3): Dashboard, Clientes, Indústrias, Produtos, Transportadoras, Orçamentos, Pedidos, Relatórios e Configurações.

### 9.2 Prioridade confirmada — p.5 §16

- **Fase 1:** Cadastros + Orçamentos + Pedidos + PDF.
- **Fase 2:** Dashboard + Relatórios + Histórico de preços.
- **Fase 3:** Financeiro + Integrações.

### 9.3 Funcionalidades futuras — p.5 §15

Fora da Fase 1: integração WhatsApp, assinatura digital, integração ERP, integração financeira, aplicativo Android/iOS e portal para clientes.

Não antecipar contratos de ERP/financeiro, conta de cliente, assinatura digital ou automação por WhatsApp no modelo obrigatório da Fase 1.

## 10. Campos que podem permanecer opcionais sem bloquear a Fase 1

A lista abaixo é uma recomendação de MVP; o PDF não marca obrigatoriedade.

- Cliente: `tradeName`, `taxId/cnpj`, `stateRegistration`, endereço, CEP, cidade, estado, telefone, WhatsApp, e-mail, contato, segmento, `creditLimit` informativo e observações.
- Indústria: nome fantasia, CNPJ, endereço, comissão padrão, observações e logo.
- Produto: código fabricante, marca, categoria, NCM, CEST, EAN, DUN, embalagem, pesos, dimensões, todos os campos tributários, comissão override, fotos, ficha técnica e FISPQ.
- Transportadora: todos os atributos além de um identificador e nome mínimo.
- Orçamento: transportadora quando não aplicável, frete, forma de pagamento até seleção, observações e anexos se futuramente permitidos.
- Pedido: anexos e observações.
- PDF: logo da indústria/fotos quando os ativos ainda não estiverem cadastrados; assinatura como campo visual sem assinatura digital.

Para concluir o fluxo mínimo, permanecem necessários ao menos: cliente identificável, produto com código/descrição/unidade, preço selecionável, quantidade, orçamento numerado com itens e pedido convertido com snapshots.

## 11. Contradições e ambiguidades visíveis

1. **Indústria × fabricante × marca:** o PDF cadastra “Indústrias”, mas produto tem “marca” e “fabricante” (p.2 §6–§7). Não afirma se fabricante é a indústria representada nem se marca é entidade.
2. **Preços 1–4 × Tabelas de Preço:** produto lista quatro campos de preço, enquanto o banco lista tabela própria (p.2 §7, p.5 §14). Modelo normalizado é seguro, mas a regra comercial das quatro listas está ausente.
3. **Conversão automática:** §8 fala “conversão para pedido”; §9 fala “conversão automática de orçamento” (p.3). Pode significar automação da cópia, não gatilho automático.
4. **PDF no fluxo:** o fluxo posiciona PDF após Pedido (p.1 §4), mas Orçamentos explicitamente geram PDF (p.3 §8). O pedido gerar PDF é plausível, porém não explicitamente listado em §9.
5. **Histórico:** pedido exige histórico na Fase 1 (p.3 §9), mas “Histórico de preços” é Fase 2 (p.5 §16). São conceitos distintos e não devem ser confundidos.
6. **IPI/tributos:** produto contém IPI, ICMS, PIS e COFINS; pedido cita IPI (p.2 §7, p.3 §9). Não há fórmula ou motor tributário, e Fase 3 contém integrações/financeiro.
7. **Assinaturas × assinatura digital:** PDF comercial tem assinaturas na Fase 1 (p.4 §12), enquanto assinatura digital é futura (p.5 §15). Portanto assinatura visual não pode ser tratada como assinatura digital.
8. **Representante:** aparece como role, mas “Representantes” não aparece na lista de tabelas (p.1 §2, p.5 §14). Modelar inicialmente como role de usuário é a opção de menor complexidade.
9. **Arquivamento:** nenhuma expectativa é declarada, apesar de histórico, relatórios e documentos exigirem preservação referencial.

## 12. Inputs de negócio genuinamente pendentes, priorizados

### P0 — alto impacto no contrato e nas regras de autorização/cálculo

| Decisão necessária | Por que importa | Default seguro se decisão não chegar antes do primeiro incremento |
|---|---|---|
| Escopo do representante: próprios, atribuídos ou todos os registros? | Segurança, consultas e autorização de cada comando | próprios/atribuídos; global somente admin |
| Quem aprova orçamento e como a aprovação é registrada? | Estados, auditoria e conversão | comando explícito de admin/representante autorizado; registrar ator e data; não presumir aprovação do cliente |
| Semântica das quatro tabelas de preço e regra de seleção | Determina preço inicial e validações | quatro listas nomeadas genericamente; seleção explícita por orçamento, sem atribuição automática por cliente |
| Fórmula/ordem de descontos, frete e IPI; arredondamento | Totais e snapshots precisam ser determinísticos | impedir regras implícitas; especificação do workflow deve declarar um default Decimal testável e rotulá-lo como suposição |
| Base, beneficiário e momento da comissão | Evita relatório/pagamento incorreto | snapshot da taxa, sem declarar comissão “devida/paga” na Fase 1 |
| Indústria é o mesmo que fabricante? Como marca se relaciona? | Cardinalidade de produto, logo e comissão padrão | `Product.industryId`; marca como texto opcional |
| Acesso de `read_only` a preços, descontos, comissão e limite de crédito | Exposição de informação comercial sensível | negar comissão e limite; permitir somente documentos explicitamente autorizados |

### P1 — afeta UX/validação, mas não bloqueia o núcleo com campos opcionais

| Decisão necessária | Default seguro |
|---|---|
| Cliente pode ser pessoa física? CNPJ e Razão Social são sempre obrigatórios? | admitir cadastro com nome legal; CNPJ opcional até resposta |
| Catálogos de segmento, categoria, marca, unidade e forma de pagamento | texto controlado/configuração simples; não criar entidades obrigatórias sem necessidade |
| Campos e validações de transportadora | `name` obrigatório, demais opcionais |
| Desconto em percentual, valor fixo ou ambos; limites por role | suportar somente formato definido no contrato de workflow; admin altera regras sensíveis |
| Preço ausente em uma lista e permissão de preço manual | bloquear linha sem preço salvo; override manual somente admin por default |
| Formato de dimensões/pesos/unidades | campos opcionais sem cálculo logístico |
| Unicidade de código fabricante, EAN e DUN | únicos quando preenchidos somente após confirmar escopo comercial |
| Regras de anexos (formatos, tamanho, retenção) | allowlist conservadora e limites técnicos documentados na implementação |
| Conteúdo das duas versões de PDF e do mockup aprovado | gerar somente template mínimo aprovado antes de produção |
| Evento mínimo do histórico de pedido | registrar criação, transições e ator/data |

### P2 — pode aguardar Fase 2/3

- definição dos indicadores do dashboard e períodos de “mês”/“em aberto” (p.3 §10);
- critérios de “cliente ativo” e “cliente sem compra” (p.3 §10, p.4 §11);
- ranking e desempate de top clientes/produtos/indústrias;
- formato/colunas/filtros das exportações Excel;
- política completa de histórico de preço e vigência retroativa;
- integrações WhatsApp, ERP, financeira, aplicativo e portal;
- assinatura digital e efeitos jurídicos;
- comportamento financeiro, cobrança e pagamento de comissões.

## 13. Checklist de cobertura por seção do PDF

- [x] §1 Objetivo — centralização e responsividade.
- [x] §2 Perfis — admin, representante e leitura.
- [x] §3 Módulos — todos listados e faseados.
- [x] §4 Fluxo — cliente, orçamento, aprovação, pedido, PDF, relatórios.
- [x] §5 Clientes — todos os campos mapeados.
- [x] §6 Indústrias — todos os campos mapeados.
- [x] §7 Produtos — todos os campos e documentos mapeados.
- [x] §8 Orçamentos — numeração, validade, frete, pagamento, transportadora, itens, descontos, PDF, conversão e duplicação.
- [x] §9 Pedidos — conversão, descontos, IPI, comissão, anexos e histórico.
- [x] §10 Dashboard — escopo registrado como Fase 2.
- [x] §11 Relatórios — tipos e Excel registrados como Fase 2.
- [x] §12 PDF Premium — ativos, conteúdo, assinaturas e versões.
- [x] §13 Design System — diretrizes visuais registradas abaixo.
- [x] §14 Banco — entidades/tabelas listadas e relacionadas.
- [x] §15 Futuro — funcionalidades mantidas fora da Fase 1.
- [x] §16 Prioridade — fases preservadas.

## 14. Diretrizes visuais confirmadas (fora do núcleo do domínio)

A fonte também fixa (p.4 §13): cor principal `#034F83`, secundária `#069CFF`, destaque `#EECAA0`, fundo branco, Arpona Sans Semibold, Rossanova Regular, menu lateral e layout moderno. Esses itens pertencem ao design/UI, não às regras de domínio, mas foram registrados para cobertura integral.

## 15. Handoff para especificações downstream

Os próximos contratos podem avançar sem reler o PDF se preservarem estas fronteiras:

1. Não apresentar decisões do épico (estados, formatos numéricos, snapshots, Decimal e precedência de comissão) como texto explícito do PDF.
2. Tornar explícitos required/optional e arquivamento, pois a fonte não os define.
3. Não transformar campos tributários em motor fiscal nem `invoiced` em emissão de nota fiscal.
4. Manter `creditLimit` informativo e sem bloqueio no MVP.
5. Isolar dúvidas de alto impacto: autorização, aprovação, listas de preço, fórmula de total e comissão.
6. Permitir valores cadastrais não essenciais nulos na Fase 1 em vez de bloquear o fluxo.
7. Preservar rastreabilidade por snapshots e histórico mesmo quando cadastros forem alterados ou arquivados.
