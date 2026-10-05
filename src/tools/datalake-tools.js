import { z } from 'zod';
import { config } from '../config.js';
import { readOnly, assertSchema, wrapUserQuery } from '../datalake.js';
import { wrap, READ_ONLY } from './util.js';

const schemas = config.datalake.schemas;

export function registerDatalakeTools(server) {
  server.registerTool(
    'datalake_list_tables',
    {
      title: 'Data Lake: listar tabelas/views',
      description:
        `Lista tabelas e views do Data Lake Movidesk (Postgres, camadas medalhão) nos schemas permitidos: ${schemas.join(', ')}. ` +
        'Use SEMPRE antes de escrever SQL para descobrir o que existe. Prefira gold (agregado/pronto para análise); ' +
        'silver tem o dado limpo em nível de ticket/ação. O Data Lake é atualizado por ETL (não é tempo real).',
      inputSchema: {
        schema: z.string().optional().describe(`Filtrar por schema (${schemas.join(' | ')})`),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ schema }) => {
      if (schema) assertSchema(schema);
      const list = schema ? [schema] : schemas;
      const r = await readOnly(
        `SELECT c.relnamespace::regnamespace::text AS schema, c.relname AS name,
                CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'p' THEN 'table' END AS kind,
                obj_description(c.oid, 'pg_class') AS description,
                c.reltuples::bigint AS approx_rows
           FROM pg_class c
          WHERE c.relkind IN ('r','v','m','p')
            AND c.relnamespace::regnamespace::text = ANY($1)
            AND has_table_privilege(c.oid, 'SELECT')
          ORDER BY 1, 2`,
        [list],
      );
      return r.rows;
    }),
  );

  server.registerTool(
    'datalake_describe_table',
    {
      title: 'Data Lake: descrever tabela',
      description: 'Mostra colunas (nome, tipo, nulabilidade, comentário) de uma tabela/view do Data Lake e 3 linhas de amostra.',
      inputSchema: {
        schema: z.string().describe(`Schema (${schemas.join(' | ')})`),
        table: z.string().regex(/^[a-z_][a-z0-9_]*$/i).describe('Nome da tabela/view'),
        sample: z.boolean().default(true).describe('Incluir 3 linhas de amostra'),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ schema, table, sample }) => {
      assertSchema(schema);
      const cols = await readOnly(
        `SELECT a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
                NOT a.attnotnull AS nullable, col_description(a.attrelid, a.attnum) AS description
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relnamespace::regnamespace::text = $1 AND c.relname = $2
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [schema, table],
      );
      if (!cols.rows.length) throw new Error(`Tabela ${schema}.${table} não encontrada ou sem permissão.`);
      const out = { table: `${schema}.${table}`, columns: cols.rows };
      if (sample) {
        out.sample = (await readOnly(`SELECT * FROM "${schema}"."${table}" LIMIT 3`)).rows;
      }
      return out;
    }),
  );

  server.registerTool(
    'datalake_query',
    {
      title: 'Data Lake: consulta SQL (somente leitura)',
      description:
        'Executa UMA consulta SELECT/WITH no Data Lake Movidesk (PostgreSQL) em transação somente leitura, ' +
        `com timeout de ${config.datalake.statementTimeoutMs / 1000}s e no máximo ${config.datalake.maxRows} linhas. ` +
        `search_path = ${schemas.join(', ')}. Ideal para análises: volume, SLA, tempo de resolução, ranking por cliente/equipe/serviço, séries temporais. ` +
        'Agregue no SQL (GROUP BY, COUNT, AVG, date_trunc) em vez de trazer linhas brutas. ' +
        'Rode datalake_list_tables / datalake_describe_table antes para conhecer as colunas.',
      inputSchema: {
        sql: z.string().min(1).describe('Consulta SELECT ou WITH (sem ponto e vírgula intermediário)'),
        max_rows: z.number().int().min(1).max(config.datalake.maxRows).default(100),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ sql, max_rows }) => {
      const { sql: wrapped, limit } = wrapUserQuery(sql, max_rows);
      const t0 = Date.now();
      const r = await readOnly(wrapped);
      const truncated = r.rows.length > limit;
      return {
        rowCount: Math.min(r.rows.length, limit),
        truncated,
        elapsedMs: Date.now() - t0,
        columns: r.fields.map((f) => f.name),
        rows: truncated ? r.rows.slice(0, limit) : r.rows,
      };
    }),
  );
}
