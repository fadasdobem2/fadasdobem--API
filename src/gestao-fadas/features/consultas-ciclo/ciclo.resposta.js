'use strict';

/** Formas de resposta da Consulta: leitura (`items`) e gravação (`consultations`), sempre com as versões das tocadas. */

const { hojeOperacional } = require('../../_comum/dia-operacional');
const { duracaoNoInstante } = require('../../_comum/dominio/consulta-comum');

/** Campos internos que a taróloga nunca recebe (Maturacao/28 seção 4.3): observação interna, cobrança, auditoria e decisões financeiras. */
const INTERNOS = ['billing', 'financialReview', 'annulmentComplaint', 'cancellationReview', 'cancellationPayout', 'financialReason', 'specialPrice', 'launchTimeDecision', 'coverage', 'minuteBenefits', 'bonusGrant', 'migrationBonusTariff'];
function recorteDaTarologa(item) {
  const sobra = { ...item };
  for (const k of INTERNOS) delete sobra[k];
  return { ...sobra, observation: '', audit: [] };
}

/** O relógio da consulta que corre vem do servidor (D10), não do que o navegador somou. */
const comRelogio = (item, agoraMs) => (item.status === 'Em curso' ? { ...item, durationSeconds: duracaoNoInstante(item, agoraMs) } : item);

function leitura(registros, { tarologa = false, hoje = hojeOperacional() } = {}) {
  const agora = Date.now();
  const itens = registros.map((r) => comRelogio(r.item, agora)).map((i) => (tarologa ? recorteDaTarologa(i) : i));
  return { readAt: new Date(agora).toISOString(), today: hoje, items: itens, versions: Object.fromEntries(registros.map((r) => [r.item.id, r.version])) };
}

/** `registros`: as consultas que mudaram; `agenda`: agendamentos que a consulta resolveu (opcional). */
function gravacao(registros, agenda = [], { tarologa = false } = {}) {
  const agora = Date.now();
  if (tarologa) agenda = []; // a agenda é dado da equipe
  return {
    readAt: new Date(agora).toISOString(), today: hojeOperacional(), consultations: registros.map((r) => comRelogio(r.item, agora)).map((i) => (tarologa ? recorteDaTarologa(i) : i)),
    versions: Object.fromEntries(registros.map((r) => [r.item.id, r.version])),
    agenda: agenda.map((r) => r.item), agendaVersions: Object.fromEntries(agenda.map((r) => [r.item.id, r.version])),
  };
}

module.exports = { leitura, gravacao, recorteDaTarologa, comRelogio };
