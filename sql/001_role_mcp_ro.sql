-- Role somente leitura para o movidesk-mcp no banco movidesk_painel.
-- Rodar como superusuário/owner do banco. Trocar a senha antes.
-- A segurança real do MCP está AQUI: o que este role não enxerga, o MCP não expõe.

CREATE ROLE mcp_ro LOGIN PASSWORD 'TROCAR_SENHA_FORTE'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

ALTER ROLE mcp_ro SET default_transaction_read_only = on;
ALTER ROLE mcp_ro SET statement_timeout = '20s';
ALTER ROLE mcp_ro CONNECTION LIMIT 5;

GRANT CONNECT ON DATABASE movidesk_painel TO mcp_ro;

-- GOLD: leitura total
GRANT USAGE ON SCHEMA gold TO mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA gold TO mcp_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA gold GRANT SELECT ON TABLES TO mcp_ro;

-- SILVER: leitura, EXCETO o que tiver PII.
GRANT USAGE ON SCHEMA silver TO mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA silver TO mcp_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA silver GRANT SELECT ON TABLES TO mcp_ro;

-- Revogue aqui as tabelas silver com dados sensíveis (valores de campos marcados
-- sensivel = true em silver.dim_campo_customizado, contatos, e-mails, CPF/CNPJ...).
-- Ajuste os nomes à sua base:
-- REVOKE SELECT ON silver.fato_campo_customizado_valor FROM mcp_ro;
-- REVOKE SELECT ON silver.dim_pessoa FROM mcp_ro;

-- Alternativa mais fina: revogar a tabela e expor uma view mascarada em gold, ex.:
-- CREATE VIEW gold.vw_mcp_campos_ticket AS
--   SELECT v.ticket_id, d.nome AS campo,
--          CASE WHEN d.sensivel THEN '***' ELSE v.valor END AS valor
--     FROM silver.fato_campo_customizado_valor v
--     JOIN silver.dim_campo_customizado d ON d.id = v.campo_id;
-- GRANT SELECT ON gold.vw_mcp_campos_ticket TO mcp_ro;

-- bronze e meta NÃO são concedidos.

-- PgBouncer (transaction mode): adicionar ao userlist.txt
--   "mcp_ro" "SCRAM-SHA-256$..."   (copiar de: SELECT rolpassword FROM pg_authid WHERE rolname='mcp_ro';)
