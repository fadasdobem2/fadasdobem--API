'use strict';

/**
 * Fila geral: encaminhar (reservar uma taróloga) e liberar a reserva (Maturacao/28 seção 3.3 e Maturacao/29 seção 11).
 * O servidor refaz a mudança com o domínio portado do front (`_comum/dominio/fila-geral.js`) e o RELÓGIO DELE; do navegador vêm só a
 * intenção (qual agendamento e qual taróloga). Validação de destino = `validateGeneralDestination` (panel-flow-model.ts:267), INTEIRA: o servidor
 * recalcula o `panelFlow` (`_comum/dominio/painel-fluxo.js`, com `freeNow`: fila própria já acionável, agendamento próximo, presença, escala,
 * admissão, continuação) com o `agora` do servidor e recusa com a frase do front quando o front recusaria.
 */

const AppError = require('../../../utils/AppError');
const fg = require('../../_comum/dominio/fila-geral');
const painel = require('../../_comum/dominio/painel-validacao');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const store = require('./agenda.store');
const resposta = require('./agenda.resposta');
const contexto = require('./agenda-painel.contexto');

const AGENDA_VERSAO = 'Este agendamento mudou. Feche e abra novamente para conferir.';
const invalido = (c) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo: c }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function corpo(c, { destino }) {
  if (!ehObjeto(c)) throw invalido('corpo');
  if (!Number.isInteger(c.expectedVersion) || c.expectedVersion < 1) throw invalido('expectedVersion');
  const r = { operationKey: validar.chaveOperacao(c.operationKey), expectedVersion: c.expectedVersion };
  if (destino) {
    r.tarotId = validar.idTarologo(c.tarotId);
    r.mode = c.mode === undefined ? 'reserve' : c.mode;
    if (!['reserve', 'forward'].includes(r.mode)) throw invalido('mode');
  } else {
    if (c.reason !== undefined && !['manual', 'unavailable'].includes(c.reason)) throw invalido('reason');
    r.reason = c.reason; r.notified = c.notified === true;
  }
  return r;
}

/** `validateGeneralMatch` (panel-flow-model.ts:252): o fluxo inteiro do painel (inclui `freeNow`) recalculado no servidor com o relógio de `entrada.now`. Lança 422 com a frase do front. */
function validarDestino(item, tarotId, entrada) {
  try { painel.validarEncaminhamento(entrada, item.id, tarotId); } catch (e) { if (e instanceof painel.RegraDoPainelError) throw comum.regra(e.message); throw e; }
}

async function gravarItem(ex, a, atual, item, { tipo, ref, dados, operationKey, filas }) {
  const versao = atual.version + 1;
  await store.atualizar(ex, item, versao);
  await store.inserirEvento(ex, { idAgenda: item.id, tipo, ref, a, dados, versao, operationKey });
  const abertos = await store.abertosDe(ex, filas);
  return resposta.gravacao([{ item, version: versao }], abertos, filas);
}

/** `POST /agenda/:id/route-general`: reserva (`mode: reserve`, o que a tela faz) ou encaminha para a fila da taróloga (`forward`, `routeGeneral`). */
async function encaminhar(req) {
  const a = comum.ator(req, true);
  const id = validar.idItem(req.params.id);
  const c = corpo(req.body, { destino: true });
  return comum.gravar(req, a, {
    escopo: 'agenda.encaminhar', operationKey: c.operationKey, corpo: { ...c, id }, acao: 'agenda.encaminhar',
    producao: async (ex) => {
      if (!(await store.travar(ex, id))) throw comum.naoEncontrado();
      for (const t of [...new Set([fg.FILA_GERAL, c.tarotId])].sort()) await store.travarFila(ex, t);
      const atual = await store.travar(ex, id);
      if (atual.version !== c.expectedVersion) throw comum.conflitoVersao(AGENDA_VERSAO);
      const agora = Date.now();
      const ctx = await contexto.carregarEntrada(ex, { tarotId: c.tarotId, agora });
      const data = ctx.date;
      validarDestino(atual.item, c.tarotId, ctx);
      const novo = c.mode === 'forward'
        ? fg.encaminharParaTarologa(atual.item, c.tarotId, a.nome, data, agora, fg.proximaPosicaoDe(ctx.agenda, c.tarotId, data))
        : fg.reservarCliente(atual.item, c.tarotId, a.nome, data, agora);
      const filas = [...new Set([atual.item.tarotId, novo.tarotId])];
      if (JSON.stringify(novo) === JSON.stringify(atual.item)) return { entidadeId: id, antes: { version: atual.version }, depois: { igual: true }, resposta: resposta.gravacao([atual], await store.abertosDe(ex, filas), filas) };
      const r = await gravarItem(ex, a, atual, novo, { tipo: c.mode === 'forward' ? 'agendamento' : 'contato', ref: `fila:${c.operationKey}`, dados: { acao: c.mode, tarotId: c.tarotId }, operationKey: c.operationKey, filas });
      return { entidadeId: id, antes: { version: atual.version, tarotId: atual.item.tarotId }, depois: { version: atual.version + 1, acao: c.mode, tarotId: c.tarotId }, resposta: r };
    },
  });
}

/** `POST /agenda/:id/reservation/release`: libera a reserva; a cliente continua em Esperando. Sem reserva ativa não muda nada. */
async function liberar(req) {
  const a = comum.ator(req, true);
  const id = validar.idItem(req.params.id);
  const c = corpo(req.body, { destino: false });
  return comum.gravar(req, a, {
    escopo: 'agenda.liberar-reserva', operationKey: c.operationKey, corpo: { ...c, id }, acao: 'agenda.liberar-reserva',
    producao: async (ex) => {
      if (!(await store.travar(ex, id))) throw comum.naoEncontrado();
      await store.travarFila(ex, fg.FILA_GERAL);
      const atual = await store.travar(ex, id);
      if (atual.version !== c.expectedVersion) throw comum.conflitoVersao(AGENDA_VERSAO);
      const novo = fg.liberarReserva(atual.item, a.nome, Date.now());
      if (JSON.stringify(novo) === JSON.stringify(atual.item)) return { entidadeId: id, antes: { version: atual.version }, depois: { igual: true }, resposta: resposta.gravacao([atual], await store.abertosDe(ex, [atual.item.tarotId]), [atual.item.tarotId]) };
      const r = await gravarItem(ex, a, atual, novo, { tipo: 'contato', ref: `fila:${c.operationKey}`, dados: { acao: 'release', reason: c.reason || 'manual', notified: c.notified }, operationKey: c.operationKey, filas: [atual.item.tarotId] });
      return { entidadeId: id, antes: { version: atual.version }, depois: { version: atual.version + 1, acao: 'release' }, resposta: r };
    },
  });
}

module.exports = { encaminhar, liberar, validarDestino, corpo };
