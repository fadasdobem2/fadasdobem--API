'use strict';

/**
 * Gancho entre o ciclo da consulta e a Presença (pendência (a) da fatia Presença, Maturacao/29 seção 6.7). Entrega ao domínio de
 * presença o que ele precisa saber das consultas do tarólogo, lido do Postgres:
 *   - `emAndamento`: há consulta aberta e (iniciada ou pausada), como `consultationInProgress` (consultation-active-state.ts:10);
 *   - `iniciada`: há consulta já iniciada pela taróloga e sem relato (`readerHasStartedConsultation`, reader-start-command.ts:12),
 *     o que IMPEDE a pausa ("Você tem uma consulta em andamento. Finalize antes de pausar.");
 *   - `terminos`: instantes de encerramento, para estender o período conhecido (presence-confirmation-model.ts:73).
 * Só consulta o banco com `GF_FATIA_CONSULTA=true`; desligada devolve o vazio de antes (nada muda para quem não ligou a fatia).
 */

const { SEM_CONSULTAS } = require('../../_comum/dominio/presenca');
const dom = require('../../_comum/dominio/consulta-comum');
const store = require('./ciclo.store');

const consultaLigada = (env = process.env) => `${env.GF_FATIA_CONSULTA || ''}`.trim().toLowerCase() === 'true';
const MENSAGEM_EM_ANDAMENTO = 'Você tem uma consulta em andamento. Finalize antes de pausar.'; // reader-start-command.ts:7

async function resumo(ex, tarotId, env = process.env) {
  if (!consultaLigada(env)) return { ...SEM_CONSULTAS, iniciada: false };
  const itens = await store.resumoParaPresenca(ex, tarotId);
  const ms = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
  return {
    emAndamento: itens.some(dom.emAndamento),
    iniciada: itens.some((i) => i.status === 'Em curso' && !i.awaitingTarologistStart && !i.tarologistFinishReport),
    terminos: itens.filter((i) => i.status !== 'Em curso').map((i) => Math.max(ms(i.endedAt), ms(i.tarologistFinishReport && i.tarologistFinishReport.submittedAt))).filter(Boolean),
  };
}

module.exports = { resumo, consultaLigada, MENSAGEM_EM_ANDAMENTO };
