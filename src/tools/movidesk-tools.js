import { z } from 'zod';
import { movideskGet } from '../movidesk.js';
import { wrap, READ_ONLY } from './util.js';

const TICKET_SELECT =
  'id,protocol,type,subject,category,urgency,status,baseStatus,justification,origin,createdDate,' +
  'lastUpdate,lastActionDate,resolvedIn,closedIn,serviceFirstLevelId,serviceFirstLevel,serviceSecondLevel,' +
  'serviceThirdLevel,ownerTeam,tags,slaSolutionDate,slaResponseDate';

const TICKET_EXPAND_BASE =
  'owner($select=id,businessName,email),' +
  'createdBy($select=id,businessName),' +
  'clients($select=id,businessName,email;$expand=organization($select=id,businessName)),' +
  'customFieldValues($expand=items)';

const ACTIONS_EXPAND =
  'actions($select=id,type,origin,description,status,justification,createdDate,isDeleted;' +
  '$expand=createdBy($select=id,businessName))';

/** Busca ticket na base recente (/tickets) e, se não achar e permitido, na histórica (/tickets/past). */
async function getTicket(id, { includeActions, includePast }) {
  const params = {
    id,
    $select: TICKET_SELECT,
    $expand: includeActions ? `${TICKET_EXPAND_BASE},${ACTIONS_EXPAND}` : TICKET_EXPAND_BASE,
  };
  let t = await movideskGet('/tickets', params);
  if (!t && includePast) t = await movideskGet('/tickets/past', params);
  return t;
}

export function registerMovideskTools(server) {
  server.registerTool(
    'movidesk_get_ticket',
    {
      title: 'Movidesk: obter ticket',
      description:
        'Busca um ticket do Movidesk em TEMPO REAL pela API pública (id = número do ticket). ' +
        'Retorna dados principais, responsável, clientes, campos customizados (customFieldValues) e, opcionalmente, ações. ' +
        'Use para o estado atual de um ticket específico. Para análises/volume, prefira as ferramentas datalake_*.',
      inputSchema: {
        id: z.number().int().positive().describe('Número do ticket'),
        include_actions: z.boolean().default(true).describe('Incluir histórico de ações (descrições podem ser longas)'),
        include_past: z
          .boolean()
          .default(true)
          .describe('Se não encontrar na base recente (~90 dias), procurar também em /tickets/past'),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ id, include_actions, include_past }) => {
      const t = await getTicket(id, { includeActions: include_actions, includePast: include_past });
      if (!t) throw new Error(`Ticket ${id} não encontrado.`);
      return t;
    }),
  );

  server.registerTool(
    'movidesk_search_tickets',
    {
      title: 'Movidesk: pesquisar tickets (OData)',
      description:
        'Pesquisa tickets em TEMPO REAL via OData na API do Movidesk. Use para listas pequenas/operacionais ' +
        '(ex.: "tickets abertos do cliente X hoje"). Limite de 50 por chamada; a API tem rate limit baixo. ' +
        'Exemplos de $filter: "baseStatus eq \'New\' or baseStatus eq \'InAttendance\'", ' +
        '"ownerTeam eq \'Sistemas Internos\'", "createdDate ge 2026-10-01T00:00:00Z", ' +
        '"clients/any(c: c/organization/businessName eq \'ACME\')", "tags/any(t: t eq \'urgente\')". ' +
        'baseStatus: New, InAttendance, Stopped, Canceled, Resolved, Closed. ' +
        'A base padrão (/tickets) cobre tickets atualizados nos últimos ~90 dias; use past=true para os mais antigos.',
      inputSchema: {
        filter: z.string().min(1).describe('Expressão OData $filter'),
        select: z.string().optional().describe(`Campos ($select). Padrão: ${TICKET_SELECT}`),
        expand: z.string().optional().describe('$expand opcional, ex: "owner($select=businessName)"'),
        orderby: z.string().default('lastUpdate desc').describe('$orderby'),
        top: z.number().int().min(1).max(50).default(20),
        skip: z.number().int().min(0).default(0),
        past: z.boolean().default(false).describe('Pesquisar em /tickets/past (base histórica)'),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ filter, select, expand, orderby, top, skip, past }) => {
      const rows = await movideskGet(past ? '/tickets/past' : '/tickets', {
        $filter: filter,
        $select: select || TICKET_SELECT,
        $expand: expand,
        $orderby: orderby,
        $top: top,
        $skip: skip,
      });
      const list = rows || [];
      return { count: list.length, skip, hasMore: list.length === top, data: list };
    }),
  );

  server.registerTool(
    'movidesk_get_person',
    {
      title: 'Movidesk: obter pessoa/empresa',
      description:
        'Busca uma pessoa, empresa ou departamento do Movidesk pelo id (tempo real). ' +
        'Inclui contatos, relacionamentos e campos customizados.',
      inputSchema: { id: z.string().min(1).describe('Id da pessoa no Movidesk') },
      annotations: READ_ONLY,
    },
    wrap(async ({ id }) => {
      const p = await movideskGet('/persons', { id, $expand: 'emails,contacts,relationships,customFieldValues($expand=items)' });
      if (!p) throw new Error(`Pessoa ${id} não encontrada.`);
      return p;
    }),
  );

  server.registerTool(
    'movidesk_search_persons',
    {
      title: 'Movidesk: pesquisar pessoas/empresas (OData)',
      description:
        'Pesquisa pessoas/empresas no Movidesk via OData. personType: 1=Pessoa, 2=Empresa, 4=Departamento. ' +
        'profileType: 1=Agente, 2=Cliente, 3=Agente e Cliente. ' +
        'Exemplos: "businessName eq \'ACME LTDA\'", "personType eq 2 and isActive eq true", ' +
        '"emails/any(e: e/email eq \'fulano@empresa.com.br\')", "cpfCnpj eq \'12345678000199\'".',
      inputSchema: {
        filter: z.string().min(1).describe('Expressão OData $filter'),
        select: z
          .string()
          .default('id,businessName,corporateName,cpfCnpj,personType,profileType,isActive,role,createdDate')
          .describe('$select'),
        top: z.number().int().min(1).max(50).default(20),
        skip: z.number().int().min(0).default(0),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ filter, select, top, skip }) => {
      const rows = (await movideskGet('/persons', { $filter: filter, $select: select, $top: top, $skip: skip })) || [];
      return { count: rows.length, skip, hasMore: rows.length === top, data: rows };
    }),
  );

  server.registerTool(
    'movidesk_list_services',
    {
      title: 'Movidesk: listar serviços (catálogo)',
      description:
        'Lista o catálogo de serviços do Movidesk (níveis 1/2/3). Útil para descobrir nomes/ids de serviço ' +
        'antes de filtrar tickets. Filtro opcional, ex: "isVisible eq 1" ou "name eq \'Suporte\'".',
      inputSchema: {
        filter: z.string().optional(),
        top: z.number().int().min(1).max(500).default(200),
        skip: z.number().int().min(0).default(0),
      },
      annotations: READ_ONLY,
    },
    wrap(async ({ filter, top, skip }) => {
      const rows =
        (await movideskGet('/services', {
          $filter: filter,
          $select: 'id,name,description,parentServiceId,serviceForTicketType,isVisible',
          $top: top,
          $skip: skip,
        })) || [];
      return { count: rows.length, data: rows };
    }),
  );
}
