const req = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 3333),
  authToken: req('MCP_AUTH_TOKEN'),

  movidesk: {
    baseUrl: process.env.MOVIDESK_BASE_URL || 'https://api.movidesk.com/public/v1',
    token: req('MOVIDESK_TOKEN'),
    // Limite de requisições por minuto ao Movidesk (o MCP enfileira localmente)
    rpm: Number(process.env.MOVIDESK_RPM || 10),
    timeoutMs: Number(process.env.MOVIDESK_TIMEOUT_MS || 30000),
  },

  datalake: {
    connectionString: process.env.DATALAKE_URL, // ex: postgres://mcp_ro:***@10.251.6.238:6432/movidesk_painel
    schemas: (process.env.DATALAKE_SCHEMAS || 'gold,silver').split(',').map((s) => s.trim()).filter(Boolean),
    statementTimeoutMs: Number(process.env.DATALAKE_STATEMENT_TIMEOUT_MS || 15000),
    maxRows: Number(process.env.DATALAKE_MAX_ROWS || 500),
    poolMax: Number(process.env.DATALAKE_POOL_MAX || 5),
  },

  // Corta respostas muito grandes para não estourar o contexto do modelo
  maxResponseChars: Number(process.env.MAX_RESPONSE_CHARS || 80000),
};
