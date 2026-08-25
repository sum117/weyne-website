# Contrato da consulta de atividades de auditoria

A tela `/app/configuracoes/auditoria` consome exclusivamente a consulta criada por `createAuditActivityQuery` em `src/lib/audit/activity.server.ts`. O módulo é server-only. A função `authenticate` é executada dentro da consulta em toda chamada; ausência de sessão retorna `401` e qualquer papel diferente de `admin` retorna `403`, antes de acessar o banco.

## Entrada

```ts
type AuditActivityRequest = {
  cursor?: string
  limit?: number
  filters?: {
    actorId?: string
    action?: 'create' | 'update' | 'transition' | 'duplicate'
    entityType?: 'quote'
    entityId?: string // UUID
    occurredFrom?: string // ISO 8601 com fuso
    occurredTo?: string // ISO 8601 com fuso, inclusivo
    correlationId?: string
  }
}
```

Limites aplicados no servidor:

- página padrão: 25 eventos; mínimo 1; máximo 100;
- cursor: no máximo 512 caracteres e conteúdo validado;
- `actorId` e `correlationId`: 1 a 128 caracteres após `trim`;
- intervalo, quando ambas as datas são informadas: ordem válida e no máximo 90 dias;
- objeto e filtros são estritos: campos não documentados são rejeitados;
- ações e tipos de entidade usam allowlists fechadas.

A paginação é keyset, em ordem fixa `(occurredAt DESC, id DESC)`. O UUID `id` é o desempate explícito. O cliente deve tratar o cursor como opaco e enviar `nextCursor` sem alterá-lo.

## Resposta de sucesso

```ts
type AuditActivityPage = {
  items: Array<{
    id: string
    occurredAt: string
    correlationId: string
    action: 'create' | 'update' | 'transition' | 'duplicate'
    description: string // pt-BR
    actor: { id: string; displayName: string }
    entity:
      | { type: 'quote'; id: string }
      | {
          type: 'quote'
          id: string
          displayName: string
          href: `/app/orcamentos/${string}`
        }
    before: unknown // resumo redigido e limitado
    after: unknown // resumo redigido e limitado
  }>
  nextCursor: string | null
}
```

`displayName` e `href` da entidade só existem se `authorizeEntities` autorizar a entidade para o administrador solicitante. A autorização é feita em lote antes da leitura dos metadados. Atores e entidades também são resolvidos em lotes; o número de consultas não cresce por evento.

## Erros públicos

- `UNAUTHENTICATED` (`401`): sessão ausente;
- `FORBIDDEN` (`403`): usuário autenticado sem papel `admin`;
- `INVALID_FILTER` (`400`): filtro, limite, data ou cursor inválido, com `issues` seguras para a UI.

## Política de resumo e retenção

O endpoint é somente leitura e não oferece update, delete ou qualquer mutation para `quote_audit`. A tabela mantém os bloqueios append-only da migração.

Antes da serialização, `before` e `after` passam por redação recursiva. Senhas, segredos, tokens, credenciais, cookies/sessões, hashes/salts, chaves, campos internos de autenticação/MFA/OTP, e-mail, telefones/WhatsApp, documentos fiscais e pessoais, inscrições, endereços/CEP, contatos, notas, limite de crédito e dados bancários/contas são substituídos por `[REDACTED]`. A política vale em objetos e arrays aninhados.

Para manter o payload dentro da finalidade operacional e dos limites de retenção da consulta, resumos também são limitados a 5 níveis, 50 campos por objeto, 20 itens por array e 256 caracteres por string. Conteúdo excedente é marcado como truncado; valores brutos proibidos nunca são devolvidos. Novas categorias de dados sensíveis devem ser adicionadas à política antes de serem registradas ou exibidas.
