'use strict';

/**
 * Job da presença no servidor: vence a confirmação 60+5 sem depender de aba aberta ("Servidor precisa vencer e transmitir estado sem
 * depender de aba aberta", 13_Campos:80; Maturacao/28 seção 5.3). A cada minuto roda `avancarConfirmacao` (porte de
 * `advancePresenceConfirmation`) em cada tarólogo Disponível ou com pedido aberto: 60 min de inatividade abrem o pedido com 5 min para
 * responder; vencido, vira Offline com histórico "Sistema"; nunca durante consulta em andamento (com a fatia Consulta ligada o servidor lê as consultas
 * do Postgres pelo gancho `ciclo.presenca`; desligada, `SEM_CONSULTAS`). O front só lê o resultado pela leitura de 30 s.
 *
 * Mesmo padrão de `scheduleSpecialistReservationSweepJob` (setInterval no `app.js`) com o lock distribuído do motor de cobrança:
 * em N instâncias só uma varre por tick. Sem dependência nova. Só liga com GF_FATIA_PRESENCA=true, escrita habilitada e banco novo no Postgres.
 * O vencimento não passa por gf_auditoria (a tabela exige um usuário da A como ator): o "Sistema" fica em gf_presenca_historico.
 */

const { hojeOperacional } = require('../../_comum/dia-operacional');
const { avancarConfirmacao, prazos, SEM_CONSULTAS } = require('../../_comum/dominio/presenca');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const horariosStore = require('../horarios/horarios.store');
const store = require('./presenca.store');
const cicloPresenca = require('../consultas-ciclo/ciclo.presenca');
const { carregar, publico } = require('./presenca.service');

const presencaLigada = (env = process.env) => `${env.GF_FATIA_PRESENCA || ''}`.trim().toLowerCase() === 'true';
const JOB_PADRAO_MS = 60_000;

/** Uma varredura com o relógio `agora` (ms). Devolve `{ avaliados, alterados }`; o teste injeta o relógio simulado. */
async function varrer(agora = Date.now(), { consultasDe = (id, ex) => cicloPresenca.resumo(ex, id), config = prazos() } = {}) {
  const ids = await emTransacao(async (ex) => store.candidatos(ex));
  let alterados = 0;
  for (const id of ids) {
    const mudou = await emTransacao(async (ex) => {
      const { atual, perfil, excecoes } = await carregar(ex, id);
      if (!atual) return false;
      const depois = avancarConfirmacao(perfil, (await consultasDe(id, ex)) || SEM_CONSULTAS, excecoes, hojeOperacional(new Date(agora)), agora, config);
      if (depois === perfil) return false;
      await store.gravar(ex, id, atual, publico(depois), { operationKey: `job:presenca:${agora}` });
      return true;
    });
    if (mudou) alterados += 1;
  }
  return { avaliados: ids.length, alterados };
}

/** Agenda a varredura (chamado no `listen` do app.js). Devolve o timer ou `null` se a fatia/escrita/banco novo não estão ligados. */
function agendar(env = process.env) {
  if (!presencaLigada(env) || !escritaHabilitada() || !novosDadosNoPostgres(env)) return null;
  const pedido = Number(env.GF_PRESENCA_JOB_MS);
  const ms = Number.isFinite(pedido) && pedido >= 1000 ? pedido : JOB_PADRAO_MS;
  const { withDistributedLock } = require('../../../providers/redis/distributed-lock');
  let rodando = false;
  console.log(`[gf-presenca.job] vencimento da confirmação de presença a cada ${ms}ms.`);
  const timer = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      await withDistributedLock('gf:presenca:tick', Math.max(ms * 2, 30_000), async () => {
        const r = await varrer();
        if (r.alterados) console.log(`[gf-presenca.job] alterados: ${r.alterados}`);
      });
    } catch (e) {
      console.error('[gf-presenca.job] varredura falhou:', (e && e.message) || e);
    } finally {
      rodando = false;
    }
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { varrer, agendar, presencaLigada };
