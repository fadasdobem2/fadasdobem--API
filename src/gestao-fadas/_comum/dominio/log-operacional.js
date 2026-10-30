'use strict';

/**
 * Trilha operacional (Logs de Configurações) no servidor (Maturacao/43). Porte da FORMA do código do front `admin/operation-audit-model.ts`
 * (`validOperationalAudit`, `operationalAuditCategories`): o navegador deriva os eventos (agenda, cliente, consulta, mais tempo, pagamento, profissional)
 * da diferença entre dois estados e o servidor só os GUARDA, sem refazê-los (o que mudou é o antes/depois que o navegador viu). O servidor confere
 * a forma, limita o tamanho e carimba quem entregou e quando. Sem relógio nem banco. Ouro: `scripts/gerar-ouro-gf-estado-financeiro.js`.
 */

class LogInvalidoError extends Error {
  constructor(mensagem) { super(mensagem); this.name = 'LogInvalidoError'; this.tipo = 'forma'; }
}

const CATEGORIAS = ['agenda', 'cliente', 'consulta', 'mais-tempo', 'pagamento', 'profissional'];
const ORIGENS = ['captured', 'existing'];
const MAX_EVENTOS = 200;
const MAX_TEXTO = 20000;
const conhecido = (at) => typeof at === 'string' && Number.isFinite(Date.parse(at));
const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Um evento no formato `OperationalAuditEvent`. */
function eventoValido(row) {
  return Boolean(row) && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 200 && CATEGORIAS.includes(row.category) && typeof row.action === 'string' && typeof row.recordId === 'string'
    && typeof row.detail === 'string' && ORIGENS.includes(row.origin) && (row.at === undefined || conhecido(row.at)) && (row.before === undefined || objeto(row.before)) && (row.after === undefined || objeto(row.after));
}

/** `validOperationalAudit` com os limites do servidor: devolve a lista (ids únicos) ou lança `LogInvalidoError`. */
function validar(eventos) {
  if (!Array.isArray(eventos) || eventos.length === 0 || eventos.length > MAX_EVENTOS) throw new LogInvalidoError('Dados inválidos.');
  if (!eventos.every(eventoValido) || new Set(eventos.map((e) => e.id)).size !== eventos.length) throw new LogInvalidoError('Dados inválidos.');
  if (JSON.stringify(eventos).length > MAX_TEXTO * MAX_EVENTOS) throw new LogInvalidoError('Dados inválidos.');
  return eventos;
}

module.exports = { LogInvalidoError, CATEGORIAS, MAX_EVENTOS, eventoValido, validar };
