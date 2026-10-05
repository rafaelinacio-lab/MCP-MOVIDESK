import crypto from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { datalakeEnabled } from './datalake.js';
import { registerMovideskTools } from './tools/movidesk-tools.js';
import { registerDatalakeTools } from './tools/datalake-tools.js';

function buildServer() {
  const server = new McpServer(
    { name: 'movidesk-mcp', version: '1.0.0' },
    {
      instructions:
        'MCP somente leitura do Movidesk (Viasoft). Duas fontes: ' +
        '(1) movidesk_* = API pública em tempo real, para um ticket/pessoa específico ou listas pequenas (rate limit baixo); ' +
        '(2) datalake_* = Data Lake Postgres (bronze/silver/gold, atualizado por ETL), para análises, contagens e históricos. ' +
        'Para perguntas analíticas, comece por datalake_list_tables → datalake_describe_table → datalake_query. ' +
        'Para o estado atual de um ticket, use movidesk_get_ticket.',
    },
  );
  registerMovideskTools(server);
  if (datalakeEnabled()) registerDatalakeTools(server);
  return server;
}

// ---- Auth: Bearer no header OU segredo no path (/mcp/<token>) para conectores sem header ----
const expected = Buffer.from(config.authToken);
const safeEq = (v) => {
  const b = Buffer.from(String(v || ''));
  return b.length === expected.length && crypto.timingSafeEqual(b, expected);
};
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (safeEq(bearer) || safeEq(req.params.secret)) return next();
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, datalake: datalakeEnabled() }));

// Modo stateless: um servidor + transporte por requisição
async function handle(req, res) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    const tool = req.body?.method === 'tools/call' ? req.body.params?.name : null;
    if (tool) console.log(JSON.stringify({ ts: new Date().toISOString(), tool, ip: req.ip }));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
}
const notAllowed = (_req, res) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });

for (const path of ['/mcp', '/mcp/:secret']) {
  app.post(path, auth, handle);
  app.get(path, auth, notAllowed);
  app.delete(path, auth, notAllowed);
}

app.listen(config.port, () => {
  console.log(`movidesk-mcp ouvindo em :${config.port} (datalake: ${datalakeEnabled() ? 'on' : 'off'})`);
});
