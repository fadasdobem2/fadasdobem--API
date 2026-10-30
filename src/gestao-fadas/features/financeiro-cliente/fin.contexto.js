'use strict';

/**
 * Contexto financeiro de UMA cliente no servidor (Maturacao/29 seção 10): pagamentos, consultas, benefícios concedidos e o SALDO DE PARTIDA.
 * Saldo de partida = `usuarios.saldo - usuarios.valorAPagar` do legado (SÓ LEITURA), CONGELADO em `gf_saldos_partida` na primeira vez que a
 * cliente recebe um movimento novo (pagamento, benefício, consulta). Depois do congelamento só os movimentos do Postgres mexem no saldo
 * (decisão em aberto com a Nice: Maturacao/29 seção 10.4). Duas fontes com a mesma forma: o executor (dentro de uma transação) e os models
 * (leitura sem escrita, que funciona com a escrita desligada).
 */

const { Op, literal } = require('sequelize');
const { lendo } = require('../../_comum/legado');
const { moneyToCents } = require('../pagamentos/helpers/dinheiro');
const { legacyMoney } = require('../pagamentos/helpers/valores-legado');
const saldo = require('../../_comum/dominio/financeiro-saldo');

const FONTE_PARTIDA = 'legado.saldo-menos-valorAPagar';
const comoItem = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const reais = (centavos) => Number(centavos) / 100;
const filtroTransferencia = (id) => JSON.stringify({ movements: [{ balanceTransfer: { targetClientId: id } }] });

/** `saldo - valorAPagar` das clientes (nível 0) pedidas, em centavos; `conhecido` é falso se o legado não informa o saldo (null não é zero). */
async function partidaNoLegadoReal(ids) {
  if (!ids.length) return new Map();
  const linhas = await lendo((m) => m.LegadoUsuario.findAll({ attributes: ['id', 'nome_id', 'saldo', 'valorAPagar'], where: { nivel: 0, id: ids.map(Number) }, raw: true }));
  return new Map(linhas.map((l) => {
    const credito = legacyMoney(l.saldo); const aPagar = legacyMoney(l.valorAPagar);
    const centavos = (credito === null ? 0n : moneyToCents(credito)) - (aPagar === null ? 0n : moneyToCents(aPagar));
    return [String(l.id), { centavos: Number(centavos), conhecido: credito !== null && aPagar !== null, nome: `${l.nome_id || ''}`.trim() }];
  }));
}

let leitorDePartida = partidaNoLegadoReal;
/** Troca o leitor do legado (nos testes o MySQL legado nem é configurado). */
const definirLeitorDePartida = (fn) => { leitorDePartida = fn || partidaNoLegadoReal; };
const partidaNoLegado = (ids) => leitorDePartida(ids);

/** Fontes de dados. `executor`: dentro da transação (SQL); `modelos`: leitura pelos models do banco novo. */
const porExecutor = (ex) => ({
  async pagamentos(id) { const [l] = await ex.execute('SELECT id, item FROM gf_pagamentos WHERE id_cliente = ? OR item @> ?::jsonb ORDER BY informado_em, id', [id, filtroTransferencia(id)]); return l.map(comoItem); },
  async consultas(id) { const [l] = await ex.execute('SELECT id, item FROM gf_consultas_ext WHERE id_cliente = ? ORDER BY iniciada_em, id', [id]); return l.map(comoItem); },
  async beneficios(id) { const [l] = await ex.execute('SELECT id, item FROM gf_beneficios_minutos WHERE id_cliente = ? ORDER BY concedido_em, id', [id]); return l.map(comoItem); },
  async partida(id) { const [l] = await ex.execute('SELECT centavos FROM gf_saldos_partida WHERE id_cliente = ?', [id]); return l[0] ? Number(l[0].centavos) : null; },
});
const porModelos = (m) => ({
  async pagamentos(id) { return (await m.GfPagamentos.findAll({ where: { [Op.or]: [{ id_cliente: id }, literal(`item @> '${filtroTransferencia(id)}'::jsonb`)] }, order: [['informado_em', 'ASC'], ['id', 'ASC']] })).map(comoItem); },
  async consultas(id) { return (await m.GfConsultasExt.findAll({ where: { id_cliente: id }, order: [['iniciada_em', 'ASC'], ['id', 'ASC']] })).map(comoItem); },
  async beneficios(id) { return (await m.GfBeneficiosMinutos.findAll({ where: { id_cliente: id }, order: [['concedido_em', 'ASC'], ['id', 'ASC']] })).map(comoItem); },
  async partida(id) { const l = await m.GfSaldosPartida.findOne({ where: { id_cliente: id } }); return l ? Number(l.centavos) : null; },
});

/** Congela o saldo de partida da cliente (idempotente: a primeira vez vence). Só dentro de uma transação de escrita. */
async function congelarPartida(ex, clientId, nomeAtor, operationKey) {
  const [ja] = await ex.execute('SELECT centavos FROM gf_saldos_partida WHERE id_cliente = ?', [clientId]);
  if (ja[0]) return Number(ja[0].centavos);
  const viva = (await partidaNoLegado([clientId])).get(clientId);
  const centavos = viva ? viva.centavos : 0;
  await ex.execute('INSERT IGNORE INTO gf_saldos_partida (id_cliente, centavos, fonte, congelado_por, operation_key) VALUES (?, ?, ?, ?, ?)', [clientId, centavos, FONTE_PARTIDA, nomeAtor, operationKey]);
  const [final] = await ex.execute('SELECT centavos FROM gf_saldos_partida WHERE id_cliente = ?', [clientId]);
  return Number(final[0].centavos);
}

/** O contexto que o domínio portado espera: `{ payments, consultations, profile }` (perfil com `credit` em reais e benefícios). */
async function carregar(fonte, clientId, { perfilPagamento = '', partidaViva } = {}) {
  const [payments, consultations, benefits, congelado] = await Promise.all([fonte.pagamentos(clientId), fonte.consultas(clientId), fonte.beneficios(clientId), fonte.partida(clientId)]);
  const centavos = congelado ?? (partidaViva ? partidaViva.centavos : 0);
  const profile = { clientId, name: '', paymentProfile: perfilPagamento, birthDate: '', whatsapp: '', credit: reais(centavos), creditUpdatedAt: '', movements: [], neverTarotIds: [], minuteBenefits: benefits };
  return { payments, consultations, profile, partida: { centavos, congelada: congelado !== null } };
}

/** Resumo de saldo que a API entrega (e que a tela confere): conta, lotes de crédito e a cobertura da cliente. */
function resumir(ctx, agora = new Date().toISOString()) {
  const { payments, consultations, profile } = ctx;
  const conta = saldo.contaDaCliente(profile.clientId, payments, consultations, profile.credit);
  const tarifa = saldo.tarifaDeCredito(profile.clientId, agora, undefined, consultations, payments, profile);
  const cobertura = saldo.coberturaDaCliente(profile.clientId, payments, consultations, profile);
  return {
    clientId: profile.clientId, openingCents: ctx.partida.centavos, openingFrozen: ctx.partida.congelada, balanceCents: saldo.emCentavos(conta.balance),
    receivedCents: saldo.emCentavos(conta.received), consumedCents: saldo.emCentavos(conta.consumed), adjustmentsCents: saldo.emCentavos(conta.adjustments),
    availableMinutes: tarifa.availableMinutes, availableCents: saldo.emCentavos(tarifa.availableAmount), benefitMinutes: cobertura.benefitMinutes, canLaunch: cobertura.canLaunch, label: cobertura.label,
  };
}

module.exports = { FONTE_PARTIDA, partidaNoLegado, definirLeitorDePartida, porExecutor, porModelos, congelarPartida, carregar, resumir };
