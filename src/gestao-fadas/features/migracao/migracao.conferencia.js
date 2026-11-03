'use strict';

/**
 * Conferência da migração (Maturacao/55), SOMENTE LEITURA, só administradora. O saldo calculado do legado (Maturacao/52) deixou de decidir a
 * abertura: aqui ele só serve para comparar com a planilha.
 *   - `GET /migration/reconciliation`: por cliente COM planilha, abertura da planilha x saldo calculado do legado NO MESMO PONTO (até o corte de cada
 *     histórico; movimento depois do corte não conta); débito "não cobrar" fica fora da abertura, então compara-se só o crédito do legado. Marca a
 *     diferença acima do limite (padrão R$ 50,00 = 5000 centavos; `?thresholdCents=` ou env `GF_MIGRACAO_LIMITE_CONFERENCIA_CENTAVOS`) e explica o
 *     motivo em `reason`/`notes`. Janela `limit` (padrão 200, máx. 500)/`after`.
 *   - `GET /migration/without-sheet`: clientes SEM planilha com movimento: as que o banco novo já conhece (cadastro, pagamento, consulta, benefício ou
 *     abertura registrada), as de `?ids=` (até 500) e TODAS as do legado (nível 0) com pagamento ou consulta (`migracao.legado-sem-planilha.js`, só
 *     SELECT, cursor por id). Elas abrem em ZERO.
 * Sem nome nem outro dado pessoal na resposta nem em log: só id da cliente, centavos, datas de corte e fontes.
 */

const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const planilha = require('../../_comum/dominio/migracao-planilha');
const legadoSemPlanilha = require('./migracao.legado-sem-planilha');
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

const reais = (centavos) => `R$ ${(Math.abs(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const comSinal = (centavos) => `${centavos < 0 ? '-' : ''}${reais(centavos)}`;

/** O corte do histórico (`2026-10-10T12:00:00`, `10/10/2026`...) como instante de parede `YYYY-MM-DD HH:MM:SS`, no mesmo formato dos instantes do legado. */
function corteComoInstante(corte) {
  const ms = planilha.parseMigrationDate(corte);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Classifica uma cliente: diferença acima do limite, confere, ou a cliente não existe mais no legado.
 * `legado` é o saldo calculado ATÉ O CORTE da cliente (Maturacao/55). Débito "não cobrar" não entra na abertura da planilha (`migrationOpeningCents`):
 * por isso, nesse caso, compara-se só a parte de crédito do legado (saldo + dívida). Devolve também o motivo e as notas de leitura.
 */
function classificar(abertura, legado, limite, { cobrarDebito = true } = {}) {
  if (!legado) return { status: 'fora-do-legado', legacyCents: null, differenceCents: null, comparison: null, reason: { code: 'fora-do-legado', text: 'A cliente não foi encontrada no legado (nível 0).' }, notes: [] };
  const divida = Number(legado.dividaCentavos) || 0;
  const comparavel = cobrarDebito ? legado.centavos : legado.centavos + divida;
  const diferenca = abertura - comparavel;
  const notas = [];
  if (!cobrarDebito) notas.push(`Débito "não cobrar" fica fora da abertura: comparado só o crédito do legado até o corte (${comSinal(comparavel)}), sem a dívida de ${reais(divida)}.`);
  const depois = legado.depoisDoCorte;
  if (depois && (depois.pagamentos || depois.consultas)) notas.push(`${depois.pagamentos} pagamento(s) e ${depois.consultas} consulta(s) do legado são depois do corte e não entram na comparação.`);
  const acima = Math.abs(diferenca) > limite;
  return {
    status: acima ? 'diferenca' : 'confere', legacyCents: comparavel, differenceCents: diferenca,
    comparison: cobrarDebito ? 'saldo-ate-o-corte' : 'credito-ate-o-corte',
    ...(depois ? { legacyAfterCutoff: { payments: depois.pagamentos, consultations: depois.consultas } } : {}),
    reason: acima
      ? { code: 'diferenca-no-corte', text: `No corte, a planilha abre em ${comSinal(abertura)} e o legado calculado até o corte dá ${comSinal(comparavel)} (diferença de ${comSinal(diferenca)}, acima do limite).` }
      : null,
    notes: notas,
  };
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
  const cortes = new Map(itens.map((l) => [l.id_cliente, corteComoInstante(l.corte_em)]).filter(([, c]) => c));
  const legados = itens.length ? await ctx.partidaNoLegado(itens.map((l) => l.id_cliente), { cortes }) : new Map();
  const clientes = itens.map((l) => {
    const abertura = Number(l.credito_centavos) - (l.cobrar_debito ? Number(l.debito_centavos) : 0);
    return {
      clientId: l.id_cliente, sourceKey: l.source_key, cutoffAt: l.corte_em, collectDebt: Boolean(l.cobrar_debito), importedCreditCents: Number(l.credito_centavos),
      importedDebitCents: Number(l.debito_centavos), sheetOpeningCents: abertura, ...classificar(abertura, legados.get(l.id_cliente), limite, { cobrarDebito: Boolean(l.cobrar_debito) }),
    };
  });
  const contar = (s) => clientes.filter((c) => c.status === s).length;
  return {
    readAt: new Date().toISOString(), thresholdCents: limite, totalWithSheet: todas.length,
    page: { checked: clientes.length, differences: contar('diferenca'), matching: contar('confere'), outsideLegacy: contar('fora-do-legado') },
    clients: clientes, ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

const numero = (id) => Number(id);

async function semPlanilha(req) {
  administradora(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const jan = paginaDa(req.query);
  if (jan.depois !== undefined) f.idCliente(jan.depois, 'after');
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
  const doBancoNovo = [...new Set([...conhecidas, ...pedidos])].filter((id) => !com.has(id)).sort((x, y) => numero(x) - numero(y));

  // Legado (SOMENTE LEITURA): clientes COM movimento e sem planilha, em ordem de id, por cursor. Sem legado configurado, só a parte do banco novo.
  let legadoOk = true; let totais = null;
  const limite = jan.limite; const depois = jan.depois === undefined ? 0 : numero(jan.depois);
  const doLegado = []; const doLegadoTodas = new Set();
  try {
    totais = await legadoSemPlanilha.totais([...com]);
    let cursor = depois; let esgotou = false;
    for (let volta = 0; volta < 40 && doLegado.length < limite + 1 && !esgotou; volta += 1) {
      const tam = Math.min(1000, Math.max(50, (limite + 1 - doLegado.length) * 2));
      const lote = await legadoSemPlanilha.candidatas(cursor, tam);
      for (const id of lote) { doLegadoTodas.add(id); if (!com.has(id)) doLegado.push(id); }
      esgotou = lote.length < tam;
      if (lote.length) cursor = numero(lote[lote.length - 1]);
    }
  } catch (e) {
    if (!(e && e.dados && e.dados.codigo === 'LEGADO_NAO_CONFIGURADO')) throw e;
    legadoOk = false;
  }

  const mesclado = new Map();
  for (const id of doBancoNovo) if (numero(id) > depois) mesclado.set(id, true);
  for (const id of doLegado) mesclado.set(id, mesclado.get(id) || false);
  const ordenados = [...mesclado.keys()].sort((x, y) => numero(x) - numero(y));
  const pagina = ordenados.slice(0, limite);
  const maisAlem = ordenados.length > limite;
  const agregados = legadoOk && pagina.length ? await legadoSemPlanilha.agregados(pagina) : new Map();

  let total = doBancoNovo.length; let legado = { available: false };
  if (legadoOk) {
    const naLista = await legadoSemPlanilha.comMovimento(doBancoNovo);
    const soBancoNovo = doBancoNovo.filter((id) => !naLista.has(id)).length;
    const semPlanilhaNoLegado = totais.comMovimento - totais.comPlanilhaEMovimento;
    total = semPlanilhaNoLegado + soBancoNovo;
    legado = { available: true, totalWithMovement: totais.comMovimento, withSheetAndMovement: totais.comPlanilhaEMovimento, withoutSheetWithMovement: semPlanilhaNoLegado, onlyInNewBase: soBancoNovo };
  }
  return {
    readAt: new Date().toISOString(), total, openingCents: 0, legacy: legado,
    clients: pagina.map((id) => {
      const a = agregados.get(id);
      return {
        clientId: id, hasMovements: movimento.has(id) || Boolean(a && (a.pagamentos || a.consultas)) || doLegadoTodas.has(id), openingSource: partida.get(id) || null, knownToNewBase: conhecidas.has(id),
        ...(a ? { legacyPaymentCount: a.pagamentos, legacyPaymentCents: a.pagamentosCentavos, legacyConsultationCount: a.consultas } : {}),
      };
    }),
    nextCursor: maisAlem && pagina.length ? pagina[pagina.length - 1] : null,
  };
}

module.exports = { conferencia, semPlanilha, limiteDaConferencia, classificar, corteComoInstante, LIMITE_PADRAO_CENTAVOS };
