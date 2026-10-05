import pg from 'pg';
import { config } from './config.js';

const dl = config.datalake;

// bigint (int8) e numeric → Number quando seguro; senão mantém string
pg.types.setTypeParser(20, (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v));
pg.types.setTypeParser(1700, (v) => (Math.abs(Number(v)) < Number.MAX_SAFE_INTEGER ? Number(v) : v));

let pool = null;
export function datalakeEnabled() {
  return Boolean(dl.connectionString);
}
function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: dl.connectionString,
      max: dl.poolMax,
      idleTimeoutMillis: 30000,
      application_name: 'movidesk-mcp',
    });
  }
  return pool;
}

const ident = /^[a-z_][a-z0-9_]*$/i;
export function assertSchema(schema) {
  if (!ident.test(schema) || !dl.schemas.includes(schema)) {
    throw new Error(`Schema não permitido: ${schema}. Permitidos: ${dl.schemas.join(', ')}`);
  }
}

/**
 * Executa SQL em transação READ ONLY com statement_timeout.
 * Compatível com PgBouncer em modo transaction (só usa SET LOCAL).
 */
export async function readOnly(sql, params = []) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(dl.statementTimeoutMs)}`);
    await client.query(`SET LOCAL search_path = ${dl.schemas.map((s) => `"${s}"`).join(', ')}`);
    const r = await client.query(sql, params);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|refresh|lock|listen|notify|set|reset|pg_sleep|pg_read_file|pg_ls_dir|lo_import|dblink)\b/i;

/** Valida e envolve uma consulta do usuário com LIMIT. */
export function wrapUserQuery(sql, maxRows) {
  let q = sql.trim().replace(/;\s*$/, '');
  if (q.includes(';')) throw new Error('Apenas uma instrução por vez.');
  if (!/^(select|with)\b/i.test(q)) throw new Error('Somente SELECT/WITH é permitido.');
  // remove literais e comentários antes de checar palavras proibidas
  const stripped = q
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  const m = stripped.match(FORBIDDEN);
  if (m) throw new Error(`Palavra-chave não permitida: ${m[0]}`);
  const limit = Math.min(Math.max(1, maxRows), dl.maxRows);
  return { sql: `SELECT * FROM (\n${q}\n) AS _q LIMIT ${limit + 1}`, limit };
}
