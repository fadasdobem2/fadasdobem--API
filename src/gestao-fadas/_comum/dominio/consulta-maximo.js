'use strict';

/**
 * Consulta, MÁXIMO NO INÍCIO GRAVADO no servidor (Maturacao/38): porte de `domain/consultation-maximum-minutes.ts` (`consultationMaximumsMap`,
 * `maximumAtRecordedStart`). Recontagem cronológica do saldo da cliente até o início da consulta (pagamentos, estornos, transferências,
 * débitos das consultas anteriores). Puro; ouro do código real do front.
 */

const cob = require('./financeiro-cobranca');
const { minutosDeArredondamento } = require('./credito-arredondamento');
const b = require('./financeiro-base');
const { minutosDoPagamento } = require('./consulta-tarifa');

const centavos = (v) => Math.round(v * 100);
const acessivel = (valor, unidade) => (Number.isFinite(unidade) && unidade > 0 ? Math.max(0, Math.floor((centavos(valor) / 100 + 0.000001) / unidade)) : undefined);
const minutosDeBeneficio = (cobertura) => (cobertura && ['Bônus', 'Cortesia', 'Complemento'].includes(cobertura.kind) ? Math.max(0, cobertura.minutes) : undefined);

/** `consultationMaximumsMap`: `Map<idDaConsulta, { minutes, includesPending }>`. */
function mapaDeMaximos(consultas, pagamentos, perfis = {}) {
  const proprios = pagamentos.filter((p) => p.status !== 'Cancelado');
  const vinculados = new Map(); const eventos = [];
  for (const p of proprios) {
    if (p.linkedConsultationId) { const k = `${p.clientId}:${p.linkedConsultationId}`; vinculados.set(k, [...(vinculados.get(k) || []), p]); }
    const pendente = !cob.confirmado(p);
    eventos.push({ clientId: p.clientId, at: Date.parse(b.pagoEm(p)), rank: 0, effect: centavos(p.amount), pending: pendente ? centavos(p.amount) : 0 });
    for (const m of (p.movements || []).filter((x) => x.kind !== 'balance-transfer')) eventos.push({ clientId: p.clientId, at: Date.parse(m.occurredAt), rank: 0, effect: centavos(m.creditEffect), pending: pendente ? centavos(m.creditEffect) : 0 });
  }
  for (const p of pagamentos) for (const m of p.movements || []) {
    if (m.kind !== 'balance-transfer' || !m.balanceTransfer) continue;
    eventos.push({ clientId: m.balanceTransfer.sourceClientId, at: Date.parse(m.occurredAt), rank: 0, effect: -centavos(m.amount) });
    eventos.push({ clientId: m.balanceTransfer.targetClientId, at: Date.parse(m.occurredAt), rank: 0, effect: centavos(m.amount) });
  }
  for (const c of consultas) {
    eventos.push({ clientId: c.clientId, at: Date.parse(c.startedAt), rank: 1, effect: 0, item: c });
    const debito = cob.acerto(c, vinculados.get(`${c.clientId}:${c.id}`) || []).debit;
    if (debito) eventos.push({ clientId: c.clientId, at: c.endedAt ? Date.parse(c.endedAt) : Date.parse(c.startedAt) + c.durationSeconds * 1000, rank: 0, effect: -centavos(debito) });
  }
  eventos.sort((x, y) => x.at - y.at || x.rank - y.rank);
  const saldos = new Map(); const pendentes = new Map(); const resultado = new Map();
  for (const e of eventos) {
    const saldo = (saldos.get(e.clientId) ?? centavos((perfis[e.clientId] && perfis[e.clientId].credit) || 0)) + e.effect;
    saldos.set(e.clientId, saldo);
    const pendente = (pendentes.get(e.clientId) || 0) + (e.pending || 0);
    pendentes.set(e.clientId, pendente);
    if (!e.item) continue;
    const c = e.item; const gravado = c.maximumMinutesAtStart;
    const valor = c.coverage && c.coverage.balanceOnly && c.coverage.balanceAtLaunch !== undefined ? c.coverage.balanceAtLaunch + pendente / 100 : saldo / 100;
    const unidade = cob.valorDoMinutoDaConsulta(c, vinculados.get(`${c.clientId}:${c.id}`) || []);
    const lotes = !c.specialPrice ? c.billing && c.billing.tariff && c.billing.tariff.creditLots : undefined;
    const pendentesForaDosLotes = lotes && lotes.length ? proprios.filter((p) => p.clientId === c.clientId && !cob.confirmado(p) && Date.parse(b.pagoEm(p)) <= e.at && !lotes.some((l) => l.paymentId === p.id)).reduce((soma, p) => {
      const principal = Math.max(0, p.amount + (p.movements || []).filter((m) => Date.parse(m.occurredAt) <= e.at).reduce((n, m) => n + m.creditEffect, 0));
      return soma + (p.amount > 0 ? (minutosDoPagamento(p, unidade) * principal) / p.amount : 0);
    }, 0) : 0;
    const minutosDosLotes = lotes && lotes.length ? Math.floor(lotes.reduce((s, l) => s + l.minutes, 0) + minutosDeArredondamento(lotes, c.billing && c.billing.tariff && c.billing.tariff.creditRounding) + pendentesForaDosLotes + 0.000001) : undefined;
    const beneficio = minutosDeBeneficio(c.coverage); const dinheiro = beneficio ?? minutosDosLotes ?? acessivel(valor, unidade);
    const minutos = dinheiro === undefined ? undefined : dinheiro + ((c.minuteBenefits || []).reduce((s, x) => s + x.minutes, 0));
    resultado.set(c.id, gravado !== undefined ? { minutes: gravado, includesPending: c.maximumIncludesPendingAtStart === true }
      : { minutes: minutos, includesPending: beneficio === undefined && pendente > 0 && (minutos || 0) > (acessivel(valor - pendente / 100, unidade) || 0) });
  }
  return resultado;
}

/** `maximumAtRecordedStart`. */
function maximoNoInicioGravado(item, consultas, pagamentos, perfis = {}) {
  const previa = { ...item, status: 'Em curso', maximumMinutesAtStart: undefined, coverage: item.coverage ? { ...item.coverage, balanceAtLaunch: undefined } : undefined };
  return mapaDeMaximos([...consultas.filter((c) => c.id !== item.id), previa], pagamentos, perfis).get(item.id) || { minutes: undefined, includesPending: false };
}

module.exports = { mapaDeMaximos, maximoNoInicioGravado };
