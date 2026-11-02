'use strict';

/**
 * Agendar a cliente da FILA GERAL para uma taróloga (`scheduleGeneralMatch`, Maturacao/39): `POST /agenda/:id/schedule-general`.
 * Do navegador vem só a intenção (taróloga, data, horário, plano de contato, observação, posição e a confirmação do aviso de disponibilidade);
 * o servidor MONTA o agendamento com as regras do front (`_comum/dominio/painel-agendamento.js`): valida o destino, exige a confirmação do aviso
 * (`availabilityConfirmation` = chave do aviso), calcula a posição, a cobertura (`paymentPending`), o plano e o histórico, com o relógio dele.
 * A ordem das outras clientes continua com o comando de ordem da fila (`positionOverrides` é do servidor da ordem).
 */

const AppError = require('../../../utils/AppError');
const painel = require('../../_comum/dominio/painel-validacao');
const agendamento = require('../../_comum/dominio/painel-agendamento');
const fin = require('../financeiro-cliente/fin.contexto');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const store = require('./agenda.store');
const resposta = require('./agenda.resposta');
const contexto = require('./agenda-painel.contexto');

const FILA_GERAL = 'afila';
const AGENDA_VERSAO = 'Este agendamento mudou. Feche e abra novamente para conferir.';
const invalido = (c) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo: c }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function corpo(c) {
  if (!ehObjeto(c)) throw invalido('corpo');
  if (!Number.isInteger(c.expectedVersion) || c.expectedVersion < 1) throw invalido('expectedVersion');
  const d = c.details;
  if (!ehObjeto(d) || typeof d.date !== 'string' || !DATA.test(d.date) || typeof d.observation !== 'string' || d.observation.length > 4000) throw invalido('details');
  if (d.position !== 'last' && !(Number.isInteger(d.position) && d.position >= 1 && d.position <= 10000)) throw invalido('details.position');
  for (const k of ['time', 'requestedTime', 'availabilityConfirmation']) if (d[k] !== undefined && (typeof d[k] !== 'string' || d[k].length > 4000)) throw invalido(`details.${k}`);
  if (d.contactPlan !== undefined && !ehObjeto(d.contactPlan)) throw invalido('details.contactPlan');
  return { operationKey: validar.chaveOperacao(c.operationKey), expectedVersion: c.expectedVersion, tarotId: validar.idTarologo(c.tarotId),
    details: { date: d.date, time: d.time, requestedTime: d.requestedTime, contactPlan: d.contactPlan, observation: d.observation, ...(d.observationFormatting !== undefined ? { observationFormatting: d.observationFormatting } : {}), position: d.position, availabilityConfirmation: d.availabilityConfirmation } };
}

/** Financeiro da cliente (pagamentos, consultas e perfil com saldo de partida), do banco novo, para a cobertura do agendamento. */
async function financeiroDaCliente(ex, clientId) {
  const [linhas] = await ex.execute('SELECT perfil_pagamento FROM gf_clientes_ext WHERE id_cliente = ?', [clientId]);
  return fin.carregar(fin.porExecutor(ex), clientId, { perfilPagamento: (linhas[0] && linhas[0].perfil_pagamento) || '' });
}

async function agendar(req) {
  const a = comum.ator(req, true);
  const id = validar.idItem(req.params.id);
  const c = corpo(req.body);
  return comum.gravar(req, a, {
    escopo: 'agenda.agendar-fila', operationKey: c.operationKey, corpo: { ...c, id }, acao: 'agenda.agendar-fila',
    producao: async (ex) => {
      if (!(await store.travar(ex, id))) throw comum.naoEncontrado();
      for (const t of [...new Set([FILA_GERAL, c.tarotId])].sort()) await store.travarFila(ex, t);
      const atual = await store.travar(ex, id);
      if (atual.version !== c.expectedVersion) throw comum.conflitoVersao(AGENDA_VERSAO);
      const agora = Date.now();
      const entrada = await contexto.carregarEntrada(ex, { tarotId: c.tarotId, agora });
      const financeiro = await financeiroDaCliente(ex, atual.item.clientId);
      const porId = new Map([...entrada.consultations, ...financeiro.consultations].map((x) => [x.id, x]));
      const completa = { ...entrada, payments: financeiro.payments, consultations: [...porId.values()] };
      let proxima;
      try { proxima = agendamento.montarAgendamento(completa, id, c.tarotId, c.details, financeiro.profile, a.nome); } catch (e) { if (e instanceof painel.RegraDoPainelError) throw comum.regra(e.message); throw e; }
      const item = { ...proxima.find((r) => r.id === id), positionOverrides: atual.item.positionOverrides };
      const versao = atual.version + 1; const filas = [...new Set([atual.item.tarotId, item.tarotId])];
      await store.atualizar(ex, item, versao);
      await store.inserirEvento(ex, { idAgenda: id, tipo: 'agendamento', ref: `fila:${c.operationKey}`, a, dados: { acao: 'schedule-general', tarotId: c.tarotId, date: item.date }, versao, operationKey: c.operationKey });
      const abertos = await store.abertosDe(ex, filas);
      return { entidadeId: id, antes: { version: atual.version, tarotId: atual.item.tarotId }, depois: { version: versao, acao: 'schedule-general', tarotId: c.tarotId }, resposta: resposta.gravacao([{ item, version: versao }], abertos, filas) };
    },
  });
}

module.exports = { agendar, corpo };
