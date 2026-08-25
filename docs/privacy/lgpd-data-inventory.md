# Inventário de dados pessoais e ciclo de vida (LGPD)

Status: inventário técnico da arquitetura aceita da Fase 2
Última revisão: 2026-08-17
Responsáveis: engenharia mantém localizações/fluxos; controlador/DPO ou assessoria jurídica aprova finalidade, base legal, retenção, direitos e terceiros
Documento irmão: [`../security/threat-model.md`](../security/threat-model.md)

Este é um registro técnico para minimização e hardening, não um parecer jurídico nem uma declaração de conformidade. Onde o repositório não confirma uma base legal ou um prazo, a célula diz **“a validar”**; nenhuma implementação pode promover a suposição a fato.

## 1. Convenções

- **Implementado**: há schema, serviço ou deployment executável no repositório.
- **Contratado/planejado**: contrato de domínio aceito, mas o caminho persistente/exposto pode ainda não existir.
- **Cliente** significa browser/bundle; **cliente comercial** significa comprador/destinatário.
- CNPJ e dados de pessoa jurídica podem identificar sócios, empresário individual, contatos ou representantes; trate-os como pessoais quando ligados a pessoa natural.
- “Arquivo lógico/append-only” descreve o software atual, não define prazo legal de retenção.

## 2. Sistemas, processadores e localizações

| Sistema/fronteira | Conteúdo | Status e controles | Terceiro/recipiente |
| --- | --- | --- | --- |
| Browser e SSR | Landing pública; dados da sessão e projeções autorizadas da aplicação; PDFs/downloads solicitados. | `/` é prerenderizado; `/app` usa SSR/Start. Bundle não deve conter segredos nem dados privados pré-embutidos. | Usuário final; Cloudflare no trânsito. |
| Runtime Node/TanStack Start | Validação, autorização, consultas, uploads, PDF/XLSX e erros. | Processo confiável do app; hoje só `getRuntimeStatus` é server function exposta. | Operador de hospedagem. |
| PostgreSQL/Drizzle | Cadastros, snapshots, valores, eventos, autoria, metadados de objetos. | Implementado parcialmente em `src/lib/db/schema/**`; constraints e FKs `restrict`. | Operador de banco/infra. |
| S3 privado | Anexos, imagens, FISPQ/fichas e PDFs gerados. | Adapter e MinIO local implementados; bucket privado e signed URL. Produção/provedor final a confirmar. | Provedor S3/R2/MinIO e operadores autorizados. |
| PDF/XLSX | Cópias derivadas e portáveis de registros autorizados. | Geração server-only aceita; PDF implementado em fundação, XLSX em fundação. | Usuário que solicita e destinatários a quem ele compartilha. |
| Logs/auditoria | Request metadata, erros, IDs, atores, motivos e mudanças. | Caddy/runtime/Docker logs existem; trilha de domínio está em schemas/serviços. Redaction ainda requerida. | Operadores e admin autorizado. |
| Backups | Cópia de PostgreSQL, S3 e eventualmente logs. | Política/provedor de produção **não localizado no repositório**. | Operador/provedor de backup a confirmar. |
| CI/GitHub/GHCR | Código, bundles e imagens; não deve receber dados de produção. | Build/publish existentes. Fixtures e artefatos devem ser exclusivamente sintéticos. | GitHub/GHCR. |
| Cloudflare Tunnel | IP, headers e tráfego em trânsito; token de tunnel. | TLS termina no edge; tunnel privado. | Cloudflare. |
| WhatsApp | Nome/mensagem/telefone que o visitante decide enviar. | Landing monta link e transfere a conversa; não há persistência do lead no app. | Meta/WhatsApp e titular. |

Região, suboperadores, contrato/DPA, transferência internacional, criptografia gerenciada e mecanismo de atendimento a direitos devem ser confirmados para cada provedor antes da produção privada.

## 3. Inventário por categoria

| ID | Categoria / titulares | Campos e sensibilidade | Finalidade técnica/negocial | Base legal | Fonte | Processamento e armazenamento | Recipientes | Retenção/deleção observada | Exposição secundária |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D01 | Identidade e conta de usuário interno | nome, email, `authSubject`, role, estado de desativação; IDs | autenticar, autorizar, atribuir ownership e administrar acesso | **A validar**; provável execução da relação profissional e legítimo interesse não devem ser adotados sem validação | admin/IdP/titular | Contratado em `User`; sessão/IdP ainda não implementados | admins, IdP, suporte estritamente necessário | desabilitar, não apagar, para preservar autoria; prazo e anonimização **a validar** | Não no bundle salvo projeção do usuário atual; nunca token/cookie em logs, fixtures, keys ou backup sem proteção. Backups: esperado, política pendente. |
| D02 | Sessão e segurança | cookie/session ID, refresh token, IP, user-agent, timestamps, tentativas, correlation ID | manter sessão, detectar abuso, investigar incidente | **A validar**; segurança/legítimo interesse a confirmar | browser, edge, IdP | Cookie/IdP/runtime/logs; implementação pendente | IdP, Cloudflare, operadores de segurança | expiração/revogação e prazo de eventos **a definir** | Proibido em bundle, fixtures, object keys e logs; backups de sessão devem ser evitados ou ter TTL. |
| D03 | Cliente comercial e contato | razão/nome, CNPJ/CPF se aplicável, IE, endereço, CEP, cidade/UF, email, telefone/WhatsApp, contato, segmento, notas | cadastro, contato, orçamento, pedido e entrega | **A validar por finalidade**; execução contratual/procedimentos preliminares pode variar conforme titular PJ/PF/contato | titular, representante interno ou cadastro da empresa | Contratado em `Customer`; snapshots em quote/order; PostgreSQL | usuários autorizados, cliente via documento, transportadora quando necessário, operadores | cadastro arquivável; documentos/snapshots não são apagados no contrato atual. Prazo, retificação/anonimização e exceção legal **a validar** | Projeção autorizada no browser; PDFs/XLSX contêm cópias; não usar em logs/keys/fixtures reais. Backups: esperado. |
| D04 | Representante/colaborador | nome, email, telefone, código, user/representative IDs, ownership e atribuições | execução comercial, escopo, contato em PDF e auditoria | **A validar** | usuário/admin/empresa | `User`, `Representative`, snapshots de quote/order/PDF, eventos | clientes em documentos, admins, usuários autorizados, operadores | perfil arquivado/conta desabilitada; snapshots/autoria preservados; prazo **a validar** | Pode aparecer no browser/PDF/export conforme autorização; IDs em logs/auditoria; nunca em object key salvo UUID opaco. Backups: esperado. |
| D05 | Contatos de indústria/transportadora | razão/nome, CNPJ, contato, email, telefone, endereço, notas | catálogo, seleção logística/comercial e comunicação | **A validar** | parceiro ou usuário interno | Contratado em domínio/forms; persistência completa varia por schema; snapshots em documentos | usuários internos, cliente no PDF quando pertinente | arquivo lógico e snapshots históricos; prazo **a validar** | Browser/PDF/export por projeção; não em keys; fixtures devem ser sintéticas. Backups: esperado. |
| D06 | Dados comerciais e financeiros vinculados | preços, descontos, frete, total, limite de crédito, comissão, condições de pagamento, validade | cotar, aprovar, converter, acompanhar e reportar operação | **A validar**; execução contratual/legítimo interesse/obrigação legal podem coexistir, sem decisão neste repo | usuários internos, catálogo e cálculo | PostgreSQL em catálogos, quotes/orders/snapshots/history; PDF/XLSX | projeções por role; cliente recebe F1 no orçamento; F2 somente admin por default | preço/evento/documento append-only; sem delete físico; prazo e anonimização **a validar** | Browser/PDF/export conforme role; logs não devem conter valores/payload completo; backups: esperado. |
| D07 | Autoria, workflow e auditoria | actor/user ID ou nome, timestamps, ação, estado, motivo, correlation ID, before/after | integridade, responsabilização, suporte e segurança | **A validar** | aplicação e usuário | Tabelas/event sinks; `src/lib/audit/activity.server.ts`; logs | admin, segurança/operação sob least privilege | append-only por contrato; logs Docker por tamanho (3×10 MB), não por prazo; retenção **a definir** | Não enviar payload bruto ao cliente; export só autorizado; nunca cookie/token. Backups: esperado. |
| D08 | Conteúdo livre | notas, motivos, termos, labels, nomes de arquivo, metadata de evento | contexto operacional e documental | Mesma base da operação, **a validar**; minimizar porque usuários podem inserir dados excessivos | usuário interno | PostgreSQL, PDF/XLSX, metadata de attachment/audit | destinatários do registro/documento | segue registro pai; sem política de scrub; prazo **a validar** | Alto risco de PII inesperada em browser/export/log. Não inserir no object key; fixtures sintéticas. Backups: esperado. |
| D09 | Anexos de pedido | arquivo bruto, label, nome original, MIME, tamanho, checksum, uploader/deleter, order ID | comprovação/documentação operacional do pedido | **A validar por tipo de documento** | usuário interno/parceiro | bytes no S3 privado; metadados no banco; serviço em `src/lib/orders/attachments.server.ts` | admin/representante no escopo; storage/operator; destinatário autorizado | delete remove objeto e preserva metadados/auditoria no serviço; estados failed/deleting exigem cleanup; backup/prazo **a definir** | Browser via download autorizado; não no bundle. Keys `attachments/<UUID>/<UUID>` sem PII. Logs/fixtures não devem carregar arquivo real. |
| D10 | Assets de produto | foto, ficha técnica/FISPQ, filename, label, versão, data, checksums e autoria | catálogo, segurança/descrição do produto e PDF | Em geral dado empresarial; pode conter autor/contato ou metadata pessoal, então **a validar/minimizar** | indústria/admin | S3 + `product_attachments`/variants | usuários autorizados e clientes quando documento exigir | delete lógico em metadata; remoção de objeto/variantes e prazo **a definir** | Browser/PDF permitido conforme produto; keys UUID opacas. Fixtures não reais. Backups: esperado. |
| D11 | Orçamento/PDF/planilha derivados | cópia de D03–D08, IDs, snapshots e checksum | apresentar proposta, compartilhar e reportar registros autorizados | Herda finalidade/base dos dados fonte; **a validar** | geração server-side | memória temporária, S3 privado para PDF, download para dispositivo; XLSX aceito server-only | solicitante e destinatários escolhidos | PDF imutável por snapshot; expiração/deleção do objeto e cópias locais **a definir** | Nunca no bundle. URL assinada e nome do arquivo não devem conter PII. Logs não registram URL/payload. Backups: esperado se persistido. |
| D12 | Contato da landing/WhatsApp | nome digitado, mensagem e número de destino; IP nos access logs | iniciar conversa comercial solicitada pelo visitante | **A validar**; consentimento/ato inequívoco ou procedimentos preliminares dependem do desenho final | visitante; config pública confirmada | browser monta URL; WhatsApp recebe; app não persiste lead. Caddy/Cloudflare veem request metadata da página | Meta/WhatsApp, Cloudflare, operação comercial | app: apenas estado efêmero; WhatsApp e access logs seguem políticas próprias/pendentes | Número e email comerciais do site aparecem no HTML/bundle por design. Testes contêm placeholders; não usar conversa real. |
| D13 | Dados de infraestrutura/operador | usuário técnico, IP, deploy actor, secrets, acessos a DB/S3/backup | operar, auditar e recuperar serviço | **A validar** | operador, CI, provedores | env não commitado, GitHub/registry/VPS/provider logs | equipe autorizada e provedores | secret tem rotação, não retenção histórica; logs/acessos/prazo **a definir** | Secret proibido em bundle/log/fixture/key/backup em claro. Identidade do operador pode estar em audit/backup. |

## 4. Mapa de entidades e locais concretos

- Contrato completo de campos e snapshots: `docs/domain/canonical-glossary-er-model.md`.
- Roles/projeções: `docs/domain/role-permission-matrix.md`.
- Persistência atual: `src/lib/db/schema/catalog.ts`, `orders.ts`, `quote-pdf.ts`, `reference-record.ts` e migrations em `drizzle/`.
- Uploads e metadados: `src/lib/attachments/policy.server.ts`, `src/lib/orders/attachments.server.ts`, `src/lib/storage/s3.server.ts`.
- PDF/export: `src/lib/pdf/**`, `src/lib/quotes/pdf-artifacts.server.ts`, `src/lib/reports/workbook.server.ts`.
- Tráfego/logs/deploy: `scripts/production-server.ts`, `deploy/Caddyfile`, `deploy/docker-compose.weyne.yml`.
- Landing pública: `src/features/landing/content.ts`, `lead.schema.ts`, `whatsapp.ts`.

## 5. Matriz transversal de superfícies

| Superfície | Regra de dados pessoais | Estado atual / ação obrigatória |
| --- | --- | --- |
| Client bundle/prerender | Somente conteúdo público e código; dados privados apenas em resposta SSR/hidratada autorizada e nunca embutidos em asset cacheável. | Landing contém contato empresarial público por design. Adicionar scan pós-build para secrets e canários de PII privada. |
| Logs | Allowlist de evento técnico; nunca cookie, token, Authorization, body, URL assinada, arquivo, snapshot ou erro bruto com PII. | `console.error(..., error)` e access log exigem redaction/avaliação. Definir prazo além da rotação por tamanho. |
| Auditoria | Guardar ator, ação, entidade, tempo, correlation ID e deltas mínimos; F2/before-after só quando necessário e admin-only. | Contrato permite `before/after: unknown`; substituir por schema/projeção antes de uso real. |
| Fixtures/snapshots/artifacts | Somente dados obviamente sintéticos (`example.invalid`, CNPJ/marcador inválido de teste, UUID aleatório); nenhum dump. | Há fixtures sintéticas e conteúdo público real em testes de landing. Criar scan e revisar `artifacts/` antes de versionar. |
| Object keys | Prefixo técnico + UUID; nunca nome, email, CNPJ, telefone, número do documento ou filename. | Controle implementado para anexos; PDF usa IDs/checksum opacos. Manter constraint/teste. |
| Backups | Criptografados, least privilege, inventariados, com retenção e purge; restore deve reaplicar eliminações posteriores ao snapshot. | Ausente no repo; bloquear alegação de conformidade até runbook/política e evidência de restore. |
| Export/PDF | Mesma autorização/projeção da tela, mais proteção contra fórmula/conteúdo ativo e `no-store`. | PDF foundation existe; XLSX ainda precisa neutralizar fórmulas; ambos precisam testes HTTP de autorização. |

## 6. Retenção e deleção — baseline e decisões requeridas

| Classe | Comportamento observado | Decisão/controle requerido antes da produção privada |
| --- | --- | --- |
| Sessões/rate limit | Não implementado. | TTL curto, revogação, purge automático e registro mínimo de segurança. |
| Cadastros | Arquivo lógico; referências históricas preservadas. | Prazo por finalidade; retificação; anonimização quando possível; legal hold documentado. |
| Quotes/orders/lines/snapshots | Nunca delete/append-only conforme contrato. | Justificativa e prazo formal; separar obrigação de integridade de retenção infinita; anonimizar campos quando permitido. |
| Auditoria/history | Append-only. | Prazo por classe, acesso admin/segurança, redução de payload e purge/anonimização. |
| Anexos/objetos | Delete do serviço remove bytes e preserva metadata; produto tem delete lógico. | SLA de cleanup, deleção de derivados/variants, orphan scan, tratamento de falha e propagação a backup. |
| PDF/XLSX | PDF pode ser persistido imutável; XLSX pode ser download efêmero. | TTL/storage policy, expiração, purge e orientação sobre cópia local/compartilhada. |
| Logs | Docker limita volume (3×10 MB), não idade. | Prazo temporal, redaction e acesso; confirmar logs Cloudflare/provedor. |
| Backups | Indefinido. | Frequência, criptografia, acesso, região, prazo, destruição, restore auditado e registro de tombstones/redeleção. |
| Fixtures/CI | Devem ser sintéticas; CI não é data store de produção. | Scan preventivo e resposta a incidente se dado real for versionado. |

Um pedido de eliminação não pode ser marcado concluído enquanto cópias ativas, objetos derivados e tombstones de backup não forem tratados ou uma exceção documentada não for comunicada pelo responsável legal. Restore de backup deve reaplicar a lista de eliminações ocorridas após a data do snapshot.

## 7. Minimização e direitos do titular

Requisitos downstream:

1. coletar apenas campos necessários por comando; opcionais permanecem `null`, não texto vazio;
2. separar busca/seleção de projeções financeiras e anexos;
3. não aceitar PII em campos técnicos, keys, correlation IDs ou nomes de arquivo gerados;
4. criar busca administrativa auditada por titular/categoria para acesso, correção, portabilidade e eliminação/anonimização;
5. preservar integridade documental sem afirmar que todo campo pessoal precisa ser eterno;
6. registrar origem, decisão, executor e resultado de cada solicitação, sem copiar o conjunto inteiro no log;
7. documentar exceções por obrigação legal/legal hold com owner e data de revisão;
8. assegurar que export de titular seja autorizado, íntegro e protegido contra formula injection.

## 8. Terceiros e transferência

Antes de produção, manter um registro aprovado para Cloudflare, GitHub/GHCR, hospedagem/VPS, PostgreSQL, S3/R2/MinIO, IdP e Meta/WhatsApp contendo: papel (controlador/operador), finalidade, categorias, região, suboperadores, transferência internacional, retenção, criptografia, canal de incidente, exclusão e contrato/DPA. O repositório confirma integração técnica, não esses termos jurídicos.

## 9. Pendências bloqueadoras e residuais

- **P0:** definir IdP, sessão e tenant; sem isso não há fonte confiável de ator/organização.
- **P0:** validar finalidade/base legal, aviso de privacidade, canal de direitos e contatos do controlador.
- **P1:** aprovar tabela de retenção e implementar purge/anonimização para DB, S3, logs, derivados e backups.
- **P1:** inventariar provedores/regiões/DPAs e política de backup/restore.
- **P1:** redaction/scan para bundle, logs, fixtures, artifacts e secrets.
- **P1:** neutralização XLSX e autorização/projeção integrada de PDF/export/download.
- Risco residual inevitável: documentos legitimamente exportados podem ser compartilhados fora do sistema; reduzir com autorização, minimização, marcação e orientação, não com promessa de controle absoluto.

## 10. Checklist de revisão de mudança

- [ ] Novo campo foi classificado, minimizado e adicionado ao inventário?
- [ ] Finalidade/base legal foram aprovadas ou continuam explicitamente pendentes?
- [ ] Todas as localizações, terceiros, exports, logs, keys e backups foram mapeados?
- [ ] Role, tenant, objeto, projeção e estado são impostos no servidor?
- [ ] Retenção, arquivo, purge, derivados e restore foram definidos/testados?
- [ ] Bundle/fixture/log/object-key scans permanecem verdes?
- [ ] O modelo de ameaças e sua matriz de testes foram atualizados?
