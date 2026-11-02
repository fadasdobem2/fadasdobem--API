'use strict';

/**
 * Conferência da migração (Maturacao/55), SOMENTE LEITURA, só administradora. O saldo calculado do legado (Maturacao/52) deixou de decidir a
 * abertura: aqui ele só serve para comparar com a planilha.
 *   - `GET /migration/reconciliation`: por cliente COM planilha, abertura da planilha x saldo calculado do legado; marca a diferença acima do limite
 *     (padrão R$ 50,00 = 5000 centavos; `?thresholdCents=` ou env `GF_MIGRACAO_LIMITE_CONFERENCIA_CENTAVOS`). Janela `limit` (padrão 200, máx. 500)/`after`.
 *   - `GET /migration/without-sheet`: clientes que o banco novo já conhece (cadastro, pagamento, consulta, benefício ou abertura registrada) e NÃO têm
 *     planilha, mais as de `?ids=` (até 500) que o operador quer conferir. Elas abrem em ZERO.
 * Sem nome nem outro dado pessoal na resposta nem em log: só id da cliente, centavos, datas de corte e fontes.
 */

const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const f = require('../financeiro-cliente/fin.comum');
const ctx = require('../financeiro-cliente/fin.contexto');

const LIMITE_PADRAO_CENTAVOS = 5000;
const PAGINA_PADRAO = 200;
const PAGINA_MAXIMA = 500;

function limiteDaConferencia(query = {}, env = process.env) {
  const bruto = query.thresholdCents !== undefined ? query.thresholdCents : env.GF_MIGRACAO_LIMITE_CONFERENCIA_CENTAVOS;
  if (bruto === undefined || bruto === '') return LIMITE_PADRAO_CENTAVOS;
  if (typeof bruto !== 'string' && typeof bruto !== 'number') throw f.invalido('thresholdCents');
  if (!/^\d{1,12}$/.test(`${bruto}`)) throw f.invalido('thresholdCents');
  return Number(bruto);
}

function paginaDa(query = {}) {
  const jan = janela.ler({ limit: query.limit === undefined ? `${PAGINA_PADRAO}` : query.limit, after: query.after });
  if (jan.limite > PAGINA_MAXIMA) throw f.invalido('limit');
  return jan;
}

/** Classifica uma cliente: diferença acima do limite, confere, ou a cliente não existe mais no legado. */
function classificar(abertura, legado, limite) {
  if (!legado) return { status: 'fora-do-legado', legacyCents: null, differenceCents: null };
  const diferenca = abertura - legado.centavos;
  return { status: Math.abs(diferenca) > limite ? 'diferenca' : 'confere', legacyCents: legado.centavos, differenceCents: diferenca };
}

const administradora = (req) => {
  const a = f.ator(req, { permissao: 'canManageFinancialValues' });
  if (a.perfil !== 'administradora') throw f.negado(false);
  return a;
};

async function conferencia(req) {
  administradora(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const limite = limiteDaConferencia(req.query);
  const jan = paginaDa(req.query);
  const linhas = await lendoNovo((m) => m.GfMigracaoHistoricos.findAll({ attributes: ['id_cliente', 'seq', 'source_key', 'corte_em', 'credito_centavos', 'debito_centavos', 'cobrar_debito'], order: [['id_cliente', 'ASC'], ['seq', 'ASC']] }));
  const vigentes = new Map();
  for (const l of linhas) vigentes.set(l.id_cliente, l); // a última revisão (maior seq) vence
  const todas = [...vigentes.values()];
  const { itens, nextCursor } = janela.fatiar(todas, jan, (l) => l.id_cliente);
  const legados = itens.length ? await ctx.partidaNoLegado(itens.map((l) => l.id_cliente)) : new Map();
  const clientes = itens.map((l) => {
    const abertura = Number(l.credito_centavos) - (l.cobrar_debito ? Number(l.debito_centavos) : 0);
    return {
      clientId: l.id_cliente, sourceKey: l.source_key, cutoffAt: l.corte_em, collectDebt: Boolean(l.cobrar_debito), importedCreditCents: Number(l.credito_centavos),
      importedDebitCents: Number(l.debito_centavos), sheetOpeningCents: abertura, ...classificar(abertura, legados.get(l.id_cliente), limite),
    };
  });
  const contar = (s) => clientes.filter((c) => c.status === s).length;
  return {
    readAt: new Date().toISOString(), thresholdCents: limite, totalWithSheet: todas.length,
    page: { checked: clientes.length, differences: contar('diferenca'), matching: contar('confere'), outsideLegacy: contar('fora-do-legado') },
    clients: clientes, ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

async function semPlanilha(req) {
  administradora(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const jan = paginaDa(req.query);
  let pedidos = [];
  if (req.query && req.query.ids !== undefined) {
    pedidos = [...new Set(`${req.query.ids}`.split(',').map((s) => s.trim()).filter(Boolean))];
    if (!pedidos.length || pedidos.length > PAGINA_MAXIMA) throw f.invalido('ids');
    pedidos.forEach((id) => f.idCliente(id, 'ids'));
  }
  const fontes = await lendoNovo(async (m) => {
    const distintos = (modelo) => modelo.findAll({ attributes: ['id_cliente'], group: ['id_cliente'], raw: true });
    const [com, ext, pag, con, ben, partidas] = await Promise.all([distintos(m.GfMigracaoHistoricos), distintos(m.GfClientesExt), distintos(m.GfPagamentos), distintos(m.GfConsultasExt), distintos(m.GfBeneficiosMinutos), m.GfSaldosPartida.findAll({ attributes: ['id_cliente', 'fonte'] })]);
    return { com, ext, pag, con, ben, partidas };
  });
  const com = new Set(fontes.com.map((l) => l.id_cliente));
  const movimento = new Set([...fontes.pag, ...fontes.con, ...fontes.ben].map((l) => l.id_cliente));
  const partida = new Map(fontes.partidas.map((l) => [l.id_cliente, l.fonte]));
  const conhecidas = new Set([...fontes.ext.map((l) => l.id_cliente), ...movimento, ...partida.keys()]);
  const universo = new Set([...conhecidas, ...pedidos]);
  const ids = [...universo].filter((id) => !com.has(id)).sort();
  const { itens, nextCursor } = janela.fatiar(ids, jan, (id) => id);
  return {
    readAt: new Date().toISOString(), total: ids.length, openingCents: 0,
    clients: itens.map((id) => ({ clientId: id, hasMovements: movimento.has(id), openingSource: partida.get(id) || null, knownToNewBase: conhecidas.has(id) })),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

module.exports = { conferencia, semPlanilha, limiteDaConferencia, classificar, LIMITE_PADRAO_CENTAVOS };
