# movidesk-mcp

Servidor MCP **somente leitura** para o Movidesk, via HTTP (Streamable HTTP, stateless).
Duas fontes:

| Fonte | Tools | Quando usar |
|---|---|---|
| API pública Movidesk (tempo real) | `movidesk_get_ticket`, `movidesk_search_tickets`, `movidesk_get_person`, `movidesk_search_persons`, `movidesk_list_services` | Estado atual de um ticket/pessoa, listas pequenas |
| Data Lake Postgres (`movidesk_painel`, via PgBouncer) | `datalake_list_tables`, `datalake_describe_table`, `datalake_query` | Análises, contagens, SLA, históricos |

## Segurança
- Auth: `Authorization: Bearer <MCP_AUTH_TOKEN>` **ou** URL `/mcp/<MCP_AUTH_TOKEN>` (para o conector do claude.ai, que não envia header customizado).
- Data Lake: transação `READ ONLY` + `statement_timeout` + só `SELECT/WITH`, 1 instrução, `LIMIT` forçado.
  **A barreira real é o role `mcp_ro`** (`sql/001_role_mcp_ro.sql`): só gold + silver, sem bronze/meta.
  Revogue as tabelas silver com PII (campos `sensivel = true`) ou exponha views mascaradas — o MCP não aplica o mascaramento `pii:read` da apidatalake.
- Movidesk: o token define o que é visível. Rate limit local configurável (`MOVIDESK_RPM`) + retry em 429/5xx.

## Deploy (automacao-movidesk)
```bash
# 1) Banco
psql -h 10.251.6.238 -U postgres -d movidesk_painel -f sql/001_role_mcp_ro.sql   # trocar a senha antes
#    + adicionar "mcp_ro" ao ~/pgbouncer/userlist.txt e (se preciso) ao pgbouncer.ini; reiniciar o pgbouncer

# 2) App
cp .env.example .env && vim .env          # MCP_AUTH_TOKEN=$(openssl rand -hex 32)
docker compose up -d --build
curl -s localhost:3333/health             # {"ok":true,"datalake":true}

# 3) Caddy: colar deploy/Caddyfile.snippet e recarregar
```

## Conectar
- **claude.ai / Cowork**: Configurações → Conectores → Adicionar conector personalizado →
  URL `https://mcp-movidesk.viasoftcloud.com.br/mcp/<MCP_AUTH_TOKEN>`
- **Claude Code**:
  `claude mcp add --transport http movidesk https://mcp-movidesk.viasoftcloud.com.br/mcp --header "Authorization: Bearer <MCP_AUTH_TOKEN>"`
- **Teste manual**: `npx @modelcontextprotocol/inspector` → Streamable HTTP → URL acima.

## Dev local
```bash
npm install
cp .env.example .env
npm run dev
```

## Próximos passos (v2)
- Tools de escrita (criar ticket, ação, atualizar customFieldValues — lembrando de reenviar **todos** os campos existentes no PATCH).
- OAuth no lugar do segredo na URL (permite identificar o usuário e auditar por pessoa).
- Tools prontas sobre as views gold mais usadas (evita SQL livre para perguntas comuns).
