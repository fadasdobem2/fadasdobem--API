'use strict';

/**
 * `GET /api/panel/sources` (Maturacao/28 seção 3.3): as FONTES do Painel numa ida só. O Painel não tem estado próprio (`panelFlow` é função
 * pura sobre agenda, consultas, perfis e escala), então o servidor só entrega as fontes que já existem em Postgres, cada uma pelo service da
 * sua fatia (mesmas permissões, mesmo recorte): agenda, consultas, presença (perfis) e horários (exceções). O que NÃO existe ainda vem em
 * `missing`, para o front não fingir cálculo: pagamentos, valores (`pricing`) e restrições dependem das fatias Pagamentos, Valores e Restrições.
 * Admissão do turno (`intakeEvents`) e solicitações (`requests`) vêm da própria Agenda (Maturacao/29 seção 11) e nunca estão em `missing`.
 */

const agenda = require('../agenda/agenda.service');
const presenca = require('../presenca/presenca.service');
const horarios = require('../horarios/horarios.service');
const consultas = require('./ciclo.service');
const comum = require('./ciclo.comum');
const { hojeOperacional } = require('../../_comum/dia-operacional');

const precosService = require('../financeiro-cliente/precos.service');
const pagamentosService = require('../financeiro-cliente/pagamentos.service');
const restricoesService = require('../financeiro-cliente/restricoes.service');
const { precosLigado, pagamentosLigado, restricoesLigado } = require('../../gate/rotas-financeiro');
const recadosService = require('../recados/recados.service');
const { recadosLigado } = require('../../gate/rotas-recados');
const divergenciasService = require('../divergencias/divergencias.service');
const { divergenciasLigado } = require('../../gate/rotas-divergencias');

/** O que ainda não é real. `payments`, `pricing` e `restrictions` saem daqui quando a flag da fatia está ligada. */
const faltam = (env = process.env) => ['payments', 'pricing', 'restrictions'].filter((nome) => !({ payments: pagamentosLigado, pricing: precosLigado, restrictions: restricoesLigado }[nome]?.(env)));

async function fontes(req) {
  // Equipe só: a mesma regra do Painel (`canViewAgenda`); a taróloga não vê o Painel.
  comum.ator(req, { soEquipe: true });
  const [ag, co, pr, ho] = await Promise.all([agenda.ler(req), consultas.ler(req), presenca.ler(req), horarios.ler(req)]);
  const falta = faltam();
  const [pagamentos, preco, restricoes] = await Promise.all([
    falta.includes('payments') ? null : pagamentosService.ler(req), falta.includes('pricing') ? null : precosService.paraOPainel(), falta.includes('restrictions') ? null : restricoesService.paraOPainel(),
  ]);
  // Recados (Maturacao/30): só com a flag ligada. Fora de `missing` de propósito; quem decide o aviso do Painel é `PANEL_BLOCKS_STILL_EXAMPLE` no front.
  const recados = recadosLigado() ? await recadosService.paraOPainel(req) : null;
  // Divergências (Maturacao/31): só com a flag ligada. Fora de `missing` de propósito (como Recados).
  const divergencias = divergenciasLigado() ? await divergenciasService.paraOPainel(req) : null;
  return {
    readAt: new Date().toISOString(), today: hojeOperacional(), date: `${(req.query && req.query.date) || hojeOperacional()}`,
    agenda: ag.items, queueRevisions: ag.queueRevisions, consultations: co.items, profiles: pr.profiles, overrides: ho.overrides,
    intakeEvents: ag.intakeEvents, requests: ag.requests, restrictions: restricoes || [], payments: pagamentos ? pagamentos.items : [], benefits: pagamentos ? pagamentos.benefits : [], pricing: preco, missing: falta, ...(recados ? { notes: recados.items } : {}), ...(divergencias ? { divergences: divergencias } : {}),
  };
}

module.exports = { fontes, faltam };
