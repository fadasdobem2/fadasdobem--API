'use strict';

/**
 * Contexto financeiro de UMA cliente no servidor (Maturacao/29 seção 10): pagamentos, consultas, benefícios concedidos e o SALDO DE PARTIDA.
 * SALDO DE ABERTURA (Maturacao/55, decisão da Nice em 31/10/2026): a PLANILHA DE MIGRAÇÃO manda. Cliente com histórico em `gf_migracao_historicos`
 * abre com `crédito - (cobrar ? débito : 0)` e o corte individual (`migrationOpeningOffset`): só o que vem DEPOIS do corte entra na conta, o que vem
 * antes fica no histórico, nunca contado duas vezes (vale com a planilha chegando antes ou depois do primeiro movimento novo). Cliente SEM planilha
 * começa em ZERO. O saldo calculado do legado (Maturacao/52, `fin.saldo-legado.js`) NÃO decide mais nada: serve só de CONFERÊNCIA
 * (`migracao.conferencia.js`). `gf_saldos_partida` continua registrando, na primeira movimentação nova, de onde a abertura veio (fonte
 * `planilha-migracao` ou `sem-planilha-zero`), mas o saldo é sempre refeito da planilha vigente (última revisão), nunca do valor congelado.
 * Duas fontes com a mesma forma: o executor (dentro de uma transação) e os models (leitura sem escrita, que funciona com a escrita desligada).
 */

const { Op, literal } = require('sequelize');
const { lendo } = require('../../_comum/legado');
const { saldosCalculados } = require('./fin.saldo-legado');
const saldo = require('../../_comum/dominio/financeiro-saldo');
const planilha = require('../../_comum/dominio/migracao-planilha');
const { SEM_HISTORICO } = require('../../_comum/dominio/historico-legado');
const { historicoDoLegadoReal } = require('./fin.historico-legado');

const FONTE_PLANILHA = 'planilha-migracao';
const FONTE_SEM_PLANILHA = 'sem-planilha-zero';
const comoItem = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const reais = (centavos) => Number(centavos) / 100;
const filtroTransferencia = (id) => JSON.stringify({ movements: [{ balanceTransfer: { targetClientId: id } }] });

/** Saldo CALCULADO do legado (Maturacao/52) das clientes (nível 0) pedidas, em centavos. SÓ CONFERÊNCIA: não decide saldo nenhum. */
async function partidaNoLegadoReal(ids) {
  if (!ids.length) return new Map();
  const [linhas, calculados] = await Promise.all([
    lendo((m) => m.LegadoUsuario.findAll({ attributes: ['id', 'nome_id'], where: { nivel: 0, id: ids.map(Number) }, raw: true })),
    saldosCalculados(ids),
  ]);
  return new Map(linhas.map((l) => [String(l.id), { centavos: calculados.get(String(l.id)).centavos, conhecido: true, nome: `${l.nome_id || ''}`.trim() }]));
}

/** Existência e nome das clientes no legado, SEM calcular saldo (leitura leve). */
async function clientesNoLegadoReal(ids) {
  if (!ids.length) return new Map();
  const linhas = await lendo((m) => m.LegadoUsuario.findAll({ attributes: ['id', 'nome_id'], where: { nivel: 0, id: ids.map(Number) }, raw: true }));
  return new Map(linhas.map((l) => [String(l.id), { centavos: 0, conhecido: true, nome: `${l.nome_id || ''}`.trim() }]));
}

let leitorDePartida = null;
/** Troca o leitor do legado (nos testes o MySQL legado nem é configurado). O mesmo leitor serve ao cálculo de conferência e à existência. */
const definirLeitorDePartida = (fn) => { leitorDePartida = fn || null; };

let leitorDeHistorico = null;
/** Troca o leitor do histórico do legado (nos testes o MySQL legado nem é configurado). */
const definirLeitorDeHistorico = (fn) => { leitorDeHistorico = fn || null; };
/**
 * Histórico da cliente no ASP (A3): `{ hasPriorConsultations, firstConsultationAt? }`. Sem legado CONFIGURADO (ambiente de teste) é "sem histórico"; legado FORA DO AR
 * propaga o 503: cobrar pela tabela de primeira compra sem saber seria o erro que esta leitura existe para evitar.
 */
async function historicoNoLegado(clientId) {
  try { return ((await (leitorDeHistorico || historicoDoLegadoReal)([String(clientId)])).get(String(clientId))) || SEM_HISTORICO; } catch (e) {
    if (e && e.dados && e.dados.codigo === 'LEGADO_NAO_CONFIGURADO') return SEM_HISTORICO;
    throw e;
  }
}
const partidaNoLegado = (ids) => (leitorDePartida || partidaNoLegadoReal)(ids);
const clientesNoLegado = (ids) => (leitorDePartida || clientesNoLegadoReal)(ids);

/** Fontes de dados. `executor`: dentro da transação (SQL); `modelos`: leitura pelos models do banco novo. */
const porExecutor = (ex) => ({
  async pagamentos(id) { const [l] = await ex.execute('SELECT id, item FROM gf_pagamentos WHERE id_cliente = ? OR item @> ?::jsonb ORDER BY informado_em, id', [id, filtroTransferencia(id)]); return l.map(comoItem); },
  async consultas(id) { const [l] = await ex.execute('SELECT id, item FROM gf_consultas_ext WHERE id_cliente = ? ORDER BY iniciada_em, id', [id]); return l.map(comoItem); },
  async beneficios(id) { const [l] = await ex.execute('SELECT id, item FROM gf_beneficios_minutos WHERE id_cliente = ? ORDER BY concedido_em, id', [id]); return l.map(comoItem); },
  async partida(id) { const [l] = await ex.execute('SELECT centavos FROM gf_saldos_partida WHERE id_cliente = ?', [id]); return l[0] ? Number(l[0].centavos) : null; },
  async migracao(id) { const [l] = await ex.execute('SELECT item FROM gf_migracao_historicos WHERE id_cliente = ? ORDER BY seq DESC LIMIT 1', [id]); return l[0] ? (typeof l[0].item === 'string' ? JSON.parse(l[0].item) : l[0].item) : null; },
  async perfilEm(id) { const [l] = await ex.execute('SELECT perfil_pagamento_em FROM gf_clientes_ext WHERE id_cliente = ?', [id]); return l[0] && l[0].perfil_pagamento_em ? new Date(l[0].perfil_pagamento_em).toISOString() : null; },
});
const porModelos = (m) => ({
  async pagamentos(id) { return (await m.GfPagamentos.findAll({ where: { [Op.or]: [{ id_cliente: id }, literal(`item @> '${filtroTransferencia(id)}'::jsonb`)] }, order: [['informado_em', 'ASC'], ['id', 'ASC']] })).map(comoItem); },
  async consultas(id) { return (await m.GfConsultasExt.findAll({ where: { id_cliente: id }, order: [['iniciada_em', 'ASC'], ['id', 'ASC']] })).map(comoItem); },
  async beneficios(id) { return (await m.GfBeneficiosMinutos.findAll({ where: { id_cliente: id }, order: [['concedido_em', 'ASC'], ['id', 'ASC']] })).map(comoItem); },
  async partida(id) { const l = await m.GfSaldosPartida.findOne({ where: { id_cliente: id } }); return l ? Number(l.centavos) : null; },
  async migracao(id) { const l = await m.GfMigracaoHistoricos.findOne({ where: { id_cliente: id }, order: [['seq', 'DESC']] }); return l ? (typeof l.item === 'string' ? JSON.parse(l.item) : l.item) : null; },
  async perfilEm(id) { const l = await m.GfClientesExt.findOne({ where: { id_cliente: id } }); return l && l.perfil_pagamento_em ? new Date(l.perfil_pagamento_em).toISOString() : null; },
});

/** Registra, uma vez, de onde veio a abertura da cliente na primeira movimentação nova (idempotente: a primeira vez vence). Só dentro de uma transação de escrita. */
async function congelarPartida(ex, clientId, nomeAtor, operationKey) {
  const [ja] = await ex.execute('SELECT centavos FROM gf_saldos_partida WHERE id_cliente = ?', [clientId]);
  if (ja[0]) return Number(ja[0].centavos);
  const historico = await porExecutor(ex).migracao(clientId);
  const centavos = historico ? planilha.aberturaEmCentavos(historico) : 0;
  await ex.execute('INSERT IGNORE INTO gf_saldos_partida (id_cliente, centavos, fonte, congelado_por, operation_key) VALUES (?, ?, ?, ?, ?)', [clientId, centavos, historico ? FONTE_PLANILHA : FONTE_SEM_PLANILHA, nomeAtor, operationKey]);
  const [final] = await ex.execute('SELECT centavos FROM gf_saldos_partida WHERE id_cliente = ?', [clientId]);
  return Number(final[0].centavos);
}

/**
 * O contexto que o domínio portado espera: `{ payments, consultations, profile }` (perfil com `credit` em reais e benefícios).
 * `profile.credit` é o offset da abertura: planilha vigente - o que já aconteceu até o corte (cliente sem planilha: zero). `partidaViva` é ignorado
 * (o saldo do legado é só conferência) e fica na assinatura para não quebrar quem ainda o passa.
 */
async function carregar(fonte, clientId, { perfilPagamento = '' } = {}) {
  const [payments, consultations, benefits, congelado, historico, antiga] = await Promise.all([fonte.pagamentos(clientId), fonte.consultas(clientId), fonte.beneficios(clientId), fonte.partida(clientId), fonte.migracao(clientId), historicoNoLegado(clientId)]);
  let credito = 0; let aberturaCentavos = 0; let perfil = perfilPagamento; let posPago;
  if (historico) {
    credito = planilha.offsetDaAbertura(historico, planilha.linhasDaConta(clientId, payments, consultations));
    aberturaCentavos = planilha.aberturaEmCentavos(historico);
    // Regra do front: a edição manual do perfil DEPOIS da aprovação vence; senão vale o que a planilha disse (pós-pago ou pré-pago).
    const editadoEm = perfilPagamento ? await fonte.perfilEm(clientId) : null;
    if (!(editadoEm && Date.parse(editadoEm) > Date.parse(historico.approvedAt))) perfil = historico.postpaid ? 'Pós-pago' : 'Pré-pago';
    posPago = planilha.ultimoCreditoPosPago([historico], clientId);
  }
  const profile = { clientId, name: '', paymentProfile: perfil, birthDate: '', whatsapp: '', credit: credito, creditUpdatedAt: historico ? historico.approvedAt : '', movements: [], neverTarotIds: [], minuteBenefits: benefits, ...(posPago ? { postpaidCredit: posPago } : {}), ...(antiga.hasPriorConsultations ? antiga : {}) };
  return { payments, consultations, profile, partida: { centavos: aberturaCentavos, congelada: congelado !== null, origem: historico ? FONTE_PLANILHA : FONTE_SEM_PLANILHA }, migracao: historico || null };
}

/** Resumo de saldo que a API entrega (e que a tela confere): conta, lotes de crédito e a cobertura da cliente. */
function resumir(ctx, agora = new Date().toISOString()) {
  const { payments, consultations, profile } = ctx;
  const conta = saldo.contaDaCliente(profile.clientId, payments, consultations, profile.credit);
  const tarifa = saldo.tarifaDeCredito(profile.clientId, agora, undefined, consultations, payments, profile);
  const cobertura = saldo.coberturaDaCliente(profile.clientId, payments, consultations, profile);
  return {
    clientId: profile.clientId, openingCents: Math.round(profile.credit * 100), migrationOpeningCents: ctx.partida.centavos, openingSource: ctx.partida.origem, openingFrozen: ctx.partida.congelada, balanceCents: saldo.emCentavos(conta.balance),
    receivedCents: saldo.emCentavos(conta.received), consumedCents: saldo.emCentavos(conta.consumed), adjustmentsCents: saldo.emCentavos(conta.adjustments),
    ...(ctx.migracao ? { migration: { cutoffAt: ctx.migracao.cutoffAt, importedCreditCents: ctx.migracao.importedCreditCents, importedDebitCents: ctx.migracao.importedDebitCents, collectDebt: ctx.migracao.collectDebt, postpaid: ctx.migracao.postpaid } } : {}),
    availableMinutes: tarifa.availableMinutes, availableCents: saldo.emCentavos(tarifa.availableAmount), benefitMinutes: cobertura.benefitMinutes, canLaunch: cobertura.canLaunch, label: cobertura.label,
  };
}

module.exports = { FONTE_PLANILHA, FONTE_SEM_PLANILHA, partidaNoLegado, clientesNoLegado, definirLeitorDePartida, definirLeitorDeHistorico, historicoNoLegado, porExecutor, porModelos, congelarPartida, carregar, resumir };
