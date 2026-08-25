# Modelo de ameaças da aplicação

Status: baseline de segurança da arquitetura aceita da Fase 2
Última revisão: 2026-08-17
Responsável pela manutenção: engenharia; riscos de base legal e retenção exigem validação do controlador/DPO ou assessoria jurídica
Documento irmão: [`../privacy/lgpd-data-inventory.md`](../privacy/lgpd-data-inventory.md)

Este documento descreve o sistema presente no repositório, separando controle implementado de requisito ainda não implementado. Ele não afirma conformidade jurídica nem transforma decisões pendentes em requisitos de negócio confirmados.

## 1. Método e regra de atualização

Risco inerente usa `probabilidade × impacto`, ambos de 1 a 3: 1 baixo, 2 médio, 3 alto. Pontuação 7–9 é **P0**, 4–6 é **P1**, 1–3 é **P2**. A prioridade considera a aplicação autenticada planejada; a landing page pública isolada tem superfície menor.

Atualize este documento e o inventário LGPD quando uma migration, server function/route, provedor de autenticação, terceiro, campo pessoal, log, export, upload, backup, política de retenção ou caminho administrativo mudar. Todo controle “necessário” deve virar implementação e teste antes de a respectiva superfície entrar em produção.

## 2. Escopo, ativos e atores

### Ativos protegidos

- identidade e sessão de usuários internos (`admin`, `representative`, `read_only`);
- cadastros e dados de contato de clientes, representantes, indústrias e transportadoras;
- preços, descontos, limites de crédito, comissões, orçamentos, pedidos e seus snapshots históricos;
- autoria, motivos e trilhas de auditoria;
- anexos, imagens, fichas, FISPQ, PDFs e planilhas geradas;
- banco PostgreSQL, bucket S3 privado, backups e artefatos temporários;
- segredos de runtime (`DATABASE_URL`, credenciais S3 e token do Cloudflare Tunnel);
- disponibilidade e integridade do fluxo orçamento → aprovação → pedido.

### Atores

| Ator | Confiança e poder |
| --- | --- |
| Visitante público | Não autenticado; acessa `/`, assets e WhatsApp externo. |
| Usuário interno autenticado | Não confiável além do role e escopo conferidos no servidor. |
| `admin` | Privilegiado, mas não ignora tenant, estado, integridade ou auditoria. |
| `representative` | Limitado a registros próprios/atribuídos e projeções permitidas. |
| `read_only` | Somente leitura explicitamente atribuída, sem anexos e campos financeiros por default. |
| Identidade de sistema/job | Somente comando específico; nunca equivale a admin genérico. |
| Operador de infraestrutura | Acessa deploy, banco, storage, logs e backups conforme credenciais concedidas. |
| Cloudflare/GitHub/registry/provedor S3 | Terceiros de infraestrutura; recebem tráfego ou artefatos conforme sua função. |
| Atacante externo ou insider | Tenta comprometer conta, ampliar escopo, exfiltrar ou degradar o serviço. |

A matriz normativa de roles, projeções e estados está em `docs/domain/role-permission-matrix.md`. O serviço deve aplicar autenticação → organização → existência/escopo → role/campos → estado → invariantes → persistência/auditoria, nessa ordem.

## 3. Entradas, fronteiras de confiança e fluxos

```text
Internet
  → Cloudflare TLS/tunnel [terceiro/edge]
  → Caddy :80 [proxy, headers e access log]
  → runtime Node/TanStack Start :3000 [SSR, server functions e arquivos públicos]
      → PostgreSQL [dados estruturados/auditoria]
      → S3 privado [uploads e documentos]
      → PDF/XLSX server-only [artefatos derivados]

Navegador autenticado [não confiável]
  ↔ server functions/routes [validação, autenticação e autorização obrigatórias]
  ↔ URLs assinadas S3 [capability temporária; quem possui a URL pode usá-la]

Operador/CI
  → GHCR + Docker Compose + env de runtime
  → migrations, restore e administração de banco/storage
```

Entradas atuais ou aceitas: rotas `/`, `/app`, `/app/produtos`, endpoint interno de server function de `getRuntimeStatus`, corpo/headers/cookies HTTP, parâmetros de grids e cursores, formulários, upload binário e metadados, filtros/ordenação, geração de PDF/XLSX, URLs assinadas e variáveis de ambiente. `scripts/production-server.ts` encaminha todas as rotas não estáticas ao handler Start e atualmente registra o objeto de erro em `console.error`.

Fronteiras críticas:

1. browser → Caddy/Start: nenhum input, ID, role, owner, filtro ou campo oculto é confiável;
2. Start → PostgreSQL: somente queries parametrizadas e identificadores dinâmicos allowlisted;
3. Start → S3: credenciais apenas no servidor; chaves opacas; bucket privado;
4. dados persistidos → PDF/XLSX: conteúdo continua não confiável para interpretadores de documentos;
5. runtime → logs/telemetria: erros e metadados podem conter PII/segredos;
6. produção → backups/restores: cópias preservam dados apagados e ampliam o grupo de acesso;
7. CI/deploy → runtime: imagem, dependências e secrets são uma fronteira de supply chain.

## 4. Operações privilegiadas e caminhos administrativos

- gestão de usuários, role, desativação e atribuições;
- CRUD/arquivo/restauração de cadastros globais;
- preço, comissão, limite de crédito, desconto, override de preço e reatribuição;
- aprovação/rejeição/conversão de orçamento e transições de pedido;
- upload, download e remoção lógica de anexos;
- geração/download de PDF e XLSX, incluindo relatórios financeiros;
- consulta de auditoria;
- migrations, acesso SQL, console/credenciais S3, rotação de secrets, backup e restore;
- deploy/rollback e acesso ao VPS/daemon Docker.

No código atual, várias dessas operações existem como serviços puros/repositórios e contratos, mas não como server functions expostas. `src/features/app/runtime-status.ts` é a única `createServerFn` encontrada e não é privilegiada. **A inexistência de endpoint hoje não satisfaz o controle:** cada futura exposição deve incorporar autenticação, autorização de objeto/ação, schema estrito, origin/CSRF e limites antes do merge.

## 5. Controles existentes verificados no repositório

| Área | Evidência existente | Limite/resíduo |
| --- | --- | --- |
| Deploy | Cloudflare Tunnel sem porta pública; Caddy remove `Server` e adiciona nosniff, referrer, frame, permissions e HSTS (`deploy/Caddyfile`, `deploy/docker-compose.weyne.yml`). | CSP ausente; confiança em forwarded headers não está restringida; imagens upstream usam tags mutáveis em alguns serviços. |
| Segredos | Configs server-only, Zod e erros sem valores (`src/lib/server/config.server.ts`, `src/lib/storage/s3.server.ts`). | Rotação, escopo e scan de bundle/repo ainda precisam de política/testes. |
| Banco | Drizzle/Postgres, constraints, FKs `restrict`, tipos e invariantes (`src/lib/db/schema/**`). | Não substitui tenant/owner predicates; qualquer SQL/dinâmica futura precisa allowlist. |
| Autorização | Matriz normativa e checks de owner/role em serviços de quote/anexo (`docs/domain/role-permission-matrix.md`, `src/lib/quotes/authorization.server.ts`, `src/lib/orders/attachments.server.ts`). | Não há provedor de autenticação/sessão nem middleware deny-by-default integrado às server functions. |
| Upload | Limite, MIME allowlist, assinatura de bytes, tamanho real, SHA-256, idempotência, chave UUID e cleanup (`src/lib/orders/attachments.server.ts`, `src/lib/attachments/policy.server.ts`). | Assinatura é mínima, não antivírus/CDR; fluxo completo S3 e produto/pedido deve reutilizar o mesmo rigor. |
| Storage | Bucket privado, smoke de 401/403, signed URL TTL validado, chave opaca (`docs/storage.md`, `src/lib/storage/s3.server.ts`). | TTL aceita até 7 dias; URL é bearer capability e pode vazar em logs/referrers/histórico. |
| PDF | Execução server-only, snapshots imutáveis, checksum e limites de recursos (`src/lib/quotes/pdf-artifacts.server.ts`, `src/lib/pdf/**`). | Sanitização de links/conteúdo e autorização do download ainda precisam de teste integrado. |
| XLSX | Nome de arquivo/aba sanitizado e biblioteca server-only (`src/lib/reports/workbook.server.ts`). | Não há neutralização implementada de células iniciadas por `=`, `+`, `-`, `@` ou caracteres de controle. |
| Histórico | Snapshots e eventos append-only/restrict; arquivo lógico (`src/lib/db/schema/**`, contratos de domínio). | Retenção/anonimização e atendimento ao titular não estão definidos; “guardar para sempre” é risco. |
| Logs | Rotação Docker 3×10 MB. | Caddy registra requests; runtime registra erro bruto; redaction e exclusão por prazo não estão implementadas. |

## 6. Registro de ameaças priorizado

| ID | Ameaça e cenário credível | L | I | Risco | Controle existente | Controle necessário / risco residual |
| --- | --- | ---: | ---: | ---: | --- | --- |
| T01 | Compromisso/fixação de conta ou sessão permite operar como usuário interno. | 3 | 3 | **9 P0** | Roles e desativação especificados. | Provedor consolidado; cookies `Secure`, `HttpOnly`, `SameSite`; rotação/expiração; revogação ao desativar/alterar role; MFA para admin; rate limit e auditoria. Risco residual: endpoint/IdP comprometido. |
| T02 | IDOR/horizontal ou vertical: alterar ID/owner/role acessa registros, anexos, PDFs ou exports alheios. | 3 | 3 | **9 P0** | Matriz, `not_found` fora de escopo e checks em alguns serviços. | Guard central deny-by-default em **cada** server function/repositório, tenant+owner na query e projeção por role; testes cruzados. Residual: erro em endpoint novo. |
| T03 | CSRF/origin spoofing dispara mutações com cookie válido. | 3 | 3 | **9 P0** | Nenhum controle integrado localizado. | Métodos não-GET; SameSite; verificação estrita `Origin`/`Host` contra origem canônica; token anti-CSRF quando necessário; nunca confiar livremente em `x-forwarded-proto`. |
| T04 | Mass assignment altera owner, role, status, comissão, crédito, snapshots ou campos de auditoria. | 3 | 3 | **9 P0** | Vários schemas Zod `strictObject` e comandos separados. | Schema estrito por ação após autenticação; allowlist de campos mutáveis; rejeitar (não ignorar) campos proibidos; nunca espalhar corpo no modelo. |
| T05 | Query abuse/SQL injection ou filtro caro contorna escopo e causa DoS. | 2 | 3 | **6 P1** | Drizzle, cursores e schemas de lista. | Parametrizar valores; allowlist para sort/coluna/operador; limite de página/complexidade/tempo; predicate de tenant/owner inseparável; testes de strings hostis. |
| T06 | Upload malicioso/disfarçado, zip bomb ou conteúdo ativo compromete consumidor/worker. | 2 | 3 | **6 P1** | Size/signature/checksum/allowlist e cleanup no serviço de anexos. | Não servir inline conteúdo perigoso; `Content-Disposition: attachment`; antivírus/CDR conforme risco; limites de descompressão/pixels; quarentena; testes reais de ponta a ponta. Residual: malware válido não detectado por magic bytes. |
| T07 | URL S3 assinada vaza por log, referrer, histórico ou compartilhamento e concede download. | 2 | 3 | **6 P1** | Bucket privado e TTL configurável (default 900 s). | Autorizar imediatamente antes de assinar; TTL mínimo por operação (recomendação inicial ≤15 min, decisão do owner); chave opaca; não logar URL/query; resposta `no-store`; revogação/rotação para incidente. |
| T08 | Fórmula DDE/WEBSERVICE ou conteúdo ativo em planilha executa ao abrir export. | 3 | 2 | **6 P1** | ExcelJS server-only; nomes sanitizados. | Neutralizar células textuais cujo primeiro caractere significativo seja `= + - @`, tab, CR ou LF; tipos explícitos; testes com fórmulas/Unicode. |
| T09 | HTML/URI/script ou recurso remoto hostil entra em PDF, causa SSRF, link enganoso ou exfiltração. | 2 | 3 | **6 P1** | React-PDF server-only, assets determinísticos e limites. | Não aceitar HTML; allowlist de URI/protocolos e fontes locais; escapar texto; bloquear fetch remoto na renderização; testar links e strings hostis. |
| T10 | Segredo aparece em `VITE_*`, bundle, erro, imagem, fixture, commit ou log. | 2 | 3 | **6 P1** | Separação server-only e documentação S3. | Scan de secrets e bundle no CI; redaction; erros públicos estáveis; least privilege e rotação documentada; nunca imprimir config/headers. |
| T11 | Logs/auditoria guardam cookie, token, PII, snapshots financeiros ou payload completo. | 3 | 2 | **6 P1** | Acesso a auditoria previsto para admin; rotação por tamanho. | Logger estruturado com allowlist/redaction; IDs de correlação; excluir headers/body/URL assinada; prazo e acesso definidos; não persistir `before/after` bruto sem projeção. |
| T12 | Retenção excessiva, arquivo lógico e snapshots/backups impedem minimização/eliminação LGPD. | 3 | 2 | **6 P1** | Integridade histórica e archive/delete states. | Tabela de retenção aprovada; rotina de purge/anonimização; legal hold explícito; propagação a objetos, derivados e backups; evidência de execução. |
| T13 | Backup/restore ou console administrativo amplia acesso, restaura dado apagado ou expõe cópia sem criptografia. | 2 | 3 | **6 P1** | Nenhuma política de backup de produção localizada. | Criptografia suportada pelo provedor; credencial separada e least privilege; MFA; logs de restore; testes periódicos; retenção/purge; runbook de reeliminação pós-restore. |
| T14 | Erro, timing e enumeração revelam existência/estado de registro ou detalhe interno. | 2 | 2 | **4 P1** | `not_found` fora de escopo especificado; mensagens públicas em alguns serviços. | Envelope de erro estável; sem stack/SQL/PII; comportamento uniforme; logs internos redigidos e correlation ID. |
| T15 | Ausência de CSP e headers incompletos amplifica XSS/clickjacking/cache de dado privado. | 2 | 2 | **4 P1** | Headers Caddy e `no-store` default no runtime. | CSP compatível com scripts/estilos atuais, `frame-ancestors`, `object-src 'none'`; headers também em erro/download; teste no runtime construído. |
| T16 | Dependência/imagem comprometida ou vulnerável executa no CI/runtime. | 2 | 3 | **6 P1** | Lockfile e versões críticas pinadas. | Audit/SBOM triado; pin por digest/tag imutável para imagens; atualização com teste; provenance/least privilege no CI. |
| T17 | DoS por PDF, export, upload, grids ou conexões esgota CPU/memória/storage. | 2 | 2 | **4 P1** | Limites PDF/upload, memória Docker e consultas paginadas. | Rate limit por ator/IP; quotas; jobs assíncronos; timeouts/cancelamento; bounded exports e cleanup de falhas. |
| T18 | Dados reais entram em fixtures/snapshots/artefatos e são versionados. | 2 | 3 | **6 P1** | Algumas fixtures usam `.invalid`/marcadores fictícios. | Regra e scan automatizado; factories sintéticas; proibir dumps; revisar `artifacts/`; apagar e rotacionar se incidente. |

## 7. Matriz acionável de controles e testes

| Prioridade | Dono downstream | Controle a entregar | Teste/gate de aceitação | Ameaças |
| --- | --- | --- | --- | --- |
| P0 | auth/autorização | Sessão segura, revogação, origin/CSRF, rate limit e guard tenant/objeto/ação deny-by-default em toda server function. | Não autenticado; sessão expirada/inválida; alteração de role; cross-origin; horizontal/vertical IDOR; chamada direta; resposta sem enumeração. | T01–T04, T14 |
| P0 | auth/autorização | Inputs `strict` e field allowlist por comando; owner/role/auditoria vêm do contexto servidor. | Campos extras e proibidos rejeitados sem persistência/evento; fuzz de IDs/estado/owner. | T02, T04 |
| P1 | query/storage/export | Queries parametrizadas, sort/filter/operator allowlists e bounds. | Payloads de SQL/query manipulation, cursor inválido, page size/complexidade máxima e escopo que filtros não ampliam. | T02, T05, T17 |
| P1 | uploads/storage | Sniffing/limite/checksum/quarentena/cleanup e object keys UUID; autorização antes de assinar URL curta. | MIME disfarçado, oversized, assinatura truncada, checksum, filename hostil, limite de arquivos, cleanup, URL expirada/tampered/fora de escopo. | T06, T07, T17 |
| P1 | exports/PDF | Neutralização de fórmula; texto/URI/asset seguro; recursos limitados e server-only. | Prefixos `= + - @`, tab/CR/LF; hyperlinks/protocolos; HTML/script; imagem remota; bundle sem ExcelJS/React-PDF/segredos. | T08, T09, T10, T17 |
| P1 | privacidade/ops | Logger allowlist/redaction, scan de secrets/PII, retenção e deleção para DB/S3/log/backups. | Tokens/cookies/headers/URL/PII não aparecem; fixture/bundle/repo scan; purge idempotente; restore não perde pedido de eliminação. | T10–T13, T18 |
| P1 | plataforma | CSP/headers/cache em sucesso, erro e download; dependency/image triage. | Inspecionar headers do runtime construído; CSP sem regressão; audit com cada achado aceito/corrigido e prazo. | T15, T16 |

O gate final desta fase é `bun run check`, mais integração/E2E específica de segurança. Testes unitários de funções puras não substituem a chamada HTTP real com cookies, proxy headers, banco e storage.

## 8. Riscos residuais e decisões abertas

1. Autenticação, sessão, cookies, CSRF/origin e tenant enforcement ainda não estão implementados de ponta a ponta; superfícies privadas não devem ser publicadas como produção antes do P0.
2. A matriz assume uma organização/tenant e menor privilégio; o identificador e a forma de isolamento persistente precisam ser definidos na implementação.
3. Magic bytes e checksum não provam ausência de malware. Antivírus/CDR e política de download devem seguir a avaliação operacional dos formatos aceitos.
4. URL assinada não é revogável individualmente em todos os provedores; TTL curto e rotação de credencial são contenções, não eliminação do risco.
5. Retenção, base legal, atendimento a direitos, legal hold e prazo de backups dependem de decisão formal do controlador.
6. Cloudflare, provedor S3, hospedagem, registry e GitHub precisam de contratos/configuração e região avaliados fora deste código.
7. A landing pública publica dados comerciais confirmados no bundle/HTML por design; isso não autoriza publicar dados internos.

## 9. Fora de escopo assumido

- emissão fiscal, ERP, contas a receber, pagamento de comissão, assinatura digital e portal do cliente;
- segurança interna do IdP, Cloudflare, GitHub, registry, VPS, PostgreSQL gerenciado ou provedor S3 além da configuração/contrato sob controle do projeto;
- segurança física e endpoint dos operadores;
- parecer jurídico ou definição unilateral de base legal/prazo;
- prevenção absoluta de comprometimento por `admin`; o objetivo é least privilege, MFA, auditoria e resposta.

Qualquer mudança que introduza essas superfícies exige nova análise, não apenas reutilização automática deste baseline.
