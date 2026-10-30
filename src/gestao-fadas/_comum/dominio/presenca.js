'use strict';

/**
 * Domínio puro da presença (porte versionado de `tarologas/presence-confirmation-model.ts` e `tarologas/staff-presence-model.ts`
 * do front do suspiro, Maturacao/28 seção 5). O servidor recalcula tudo o que o navegador não pode definir (D9): quem chega é a
 * declaração de turno (status, pausa, retorno, saída), e `confirmacao`, `presenceConfirmedAt`, histórico, janela confirmada e
 * `shiftAvailableSince` saem daqui, com o relógio do servidor. Sem banco, sem Express.
 *
 * `advancePresenceConfirmation` é o que o JOB roda a cada minuto (o front só o roda na demonstração):
 * `consultas` = `{ emAndamento: boolean, terminos: number[] }` do tarólogo (hoje vazio: a fatia Consulta ainda não grava consultas).
 */

const { randomUUID } = require('crypto');
const { milissegundos, diaOperacionalDoInstante, instantesDosPeriodos, escalaNaData } = require('./presenca-agenda');
const { RegraPresencaError, retornoDaPausa, rotuloDaPresenca, detalheDaPresenca, escolhaDaPresenca, offlineDesde, TURNO_PADRAO } = require('./presenca-retorno');

const IDLE_PADRAO_MS = 60 * 60_000;
const CONFIRMACAO_PADRAO_MS = 5 * 60_000;
const SEM_CONSULTAS = Object.freeze({ emAndamento: false, terminos: [] });

/** 60 + 5 minutos. Só fora de produção os prazos podem ser encurtados por env (prova real em minutos). */
function prazos(env = process.env) {
  const produto = `${env.FADAS_ENVIRONMENT || ''}`.toLowerCase() === 'production' || `${env.NODE_ENV || ''}` === 'production';
  const n = (v, padrao) => { const x = Number(v); return !produto && Number.isInteger(x) && x >= 1000 ? x : padrao; };
  return { ociosoMs: n(env.GF_PRESENCA_IDLE_MS, IDLE_PADRAO_MS), confirmacaoMs: n(env.GF_PRESENCA_CONFIRM_MS, CONFIRMACAO_PADRAO_MS) };
}

const iso = (ms) => new Date(ms).toISOString();
const semTurno = (p) => p.shiftStatus === 'Offline' || (!p.shiftStatus && !p.online);

/** `advancePresenceConfirmation`: avança somente presença; nunca inicia, encerra ou modifica uma consulta. */
function avancarConfirmacao(perfil, consultas, excecoes, data, agora, config = prazos()) {
  if (!Number.isFinite(agora)) return perfil;
  const c = consultas || SEM_CONSULTAS;
  const pendente = perfil.presenceConfirmation;
  if (c.emAndamento) {
    // Uma consulta iniciada por outro fluxo invalida a espera automática anterior.
    return pendente && pendente.reason === 'inactivity' && !pendente.offlineAt ? { ...perfil, presenceConfirmation: undefined } : perfil;
  }
  // Pedido de ontem de quem ficou offline não exige reconfirmar um turno que ainda não começou hoje (mantém dados, descarta o pedido).
  if (pendente && semTurno(perfil)) {
    const pediuEm = milissegundos(pendente.requestedAt) || 0;
    const esperado = milissegundos(perfil.expectedReturn) || 0;
    const diaAtual = diaOperacionalDoInstante(agora);
    const retornoDeclarado = perfil.shiftExit === 'return' && esperado && diaOperacionalDoInstante(esperado) >= diaAtual;
    if (!retornoDeclarado && pediuEm && diaOperacionalDoInstante(pediuEm) < diaAtual) return { ...perfil, presenceConfirmation: undefined };
  }
  // Pedido criado pela regra antiga de 15 minutos não pode ser executado.
  if (pendente && pendente.reason === 'inactivity' && !pendente.offlineAt && pendente.idleTimeoutMs !== config.ociosoMs) {
    if (semTurno(perfil)) return perfil;
    return avancarConfirmacao({ ...perfil, presenceConfirmation: undefined }, consultas, excecoes, data, agora, config);
  }
  if (pendente) {
    const limite = milissegundos(pendente.deadlineAt);
    if (pendente.reason !== 'inactivity' || pendente.offlineAt || !limite || agora < limite) return perfil;
    const em = iso(agora);
    return {
      ...perfil, shiftStatus: 'Offline', online: false, shiftExit: undefined, expectedReturn: undefined, returnUntil: undefined, returnForecast: undefined,
      pauseReason: undefined, shiftAvailableSince: undefined, presenceDate: data,
      presenceConfirmation: { ...pendente, offlineAt: em },
      presenceHistory: [...(perfil.presenceHistory || []), { id: `presence-idle-${perfil.id}-${pendente.requestedAt}`, actorId: 'system-presence', actorName: 'Sistema', at: em, date: data, before: 'Disponível · confirmação pendente', after: 'Offline · aguardando confirmação de disponibilidade' }],
    };
  }
  if (TURNO_PADRAO(perfil) !== 'Disponível') return perfil;
  // Um perfil que atravessou 06h sem confirmação ainda pertence ao período anterior.
  const dataEscala = perfil.presenceDate && perfil.presenceDate < data ? perfil.presenceDate : data;
  const escala = escalaNaData(perfil, excecoes, dataEscala);
  const periodos = escala.instants ? [escala.instants] : instantesDosPeriodos(escala.periods, dataEscala);
  if (periodos.some((p) => p.startsAt <= agora && agora < p.endsAt)) return perfil;
  const fimDoPeriodo = Math.max(0, ...periodos.filter((p) => p.endsAt <= agora).map((p) => p.endsAt));
  // Consulta encerrada apenas estende um período conhecido, não inventa o fim da escala.
  if (!fimDoPeriodo) return perfil;
  const fimDaConsulta = Math.max(0, ...c.terminos.filter((t) => t <= agora));
  const ociosoDesde = Math.max(fimDoPeriodo, fimDaConsulta, milissegundos(perfil.presenceLastActivityAt) || 0, milissegundos(perfil.presenceConfirmedAt) || 0, milissegundos(perfil.shiftAvailableSince) || 0);
  if (agora - ociosoDesde < config.ociosoMs) return perfil;
  // Oferece os cinco minutos completos quando o pedido é efetivamente apresentado.
  return { ...perfil, presenceConfirmation: { reason: 'inactivity', requestedAt: iso(agora), deadlineAt: iso(agora + config.confirmacaoMs), idleTimeoutMs: config.ociosoMs } };
}

const ESCOLHAS_SAIDA = Object.freeze({ ended: 'ended', return: 'return', missing: 'missing', 'shift-ended': 'shift-ended' });
const MOTIVOS_PAUSA = Object.freeze(['Volta logo', 'Refeição', 'Não disse']);

/** `presenceConfirmationAfterReturnForecast`: informar retorno mantém a confirmação pendente, já no estado offline. */
function confirmacaoAposRetorno(perfil, agora) {
  const pendente = perfil.presenceConfirmation;
  if (!pendente || pendente.offlineAt) return pendente;
  return { ...pendente, offlineAt: (semTurno(perfil) ? offlineDesde(perfil) : undefined) ?? iso(agora) };
}

/**
 * `changeProfessionalPresence` do front a partir da declaração de turno. `d` = { shiftStatus, shiftExit?, pauseReason?, expectedReturn?,
 * returnUntil?, returnForecast?, confirmation: 'none'|'keep'|'manual' }. `ator` = { id, name }; `data` = dia operacional do servidor.
 * Recusa com RegraPresencaError (mesma mensagem do front quando existe).
 */
function mudarPresenca(perfil, d, data, ator, agora, excecoes = {}) {
  const em = iso(agora);
  const mesmoDiaReal = (inicio) => Number.isFinite(Date.parse(inicio || '')) && diaOperacionalDoInstante(Date.parse(inicio)) === diaOperacionalDoInstante(agora);
  const escolha = d.shiftStatus === 'Disponível' ? 'available' : d.shiftStatus === 'Em pausa' ? 'pause'
    : d.shiftExit === 'ended' ? 'ended' : d.shiftExit === 'return' ? 'return' : d.shiftExit === 'missing' ? 'missing' : 'offline';
  let expectedReturn; let returnUntil; let returnForecast;
  if (escolha === 'return') {
    expectedReturn = d.expectedReturn; returnUntil = d.returnUntil; returnForecast = d.returnForecast;
  } else if (escolha === 'pause' && d.pauseReason !== 'Não disse' && d.expectedReturn) {
    expectedReturn = d.expectedReturn;
    const minutos = Math.round((Date.parse(expectedReturn) - agora) / 60_000);
    retornoDaPausa(Math.max(minutos, 1), agora); // 1 a 1440 minutos, como `pauseReturnTimestamp`
  }
  const preciso = !perfil.returnForecast || ['next-shift', 'exact'].includes(perfil.returnForecast.kind);
  const retornoInformado = perfil.shiftExit === 'return' && preciso && mesmoDiaReal(perfil.expectedReturn) && Date.parse(perfil.returnUntil || '') > Date.parse(perfil.expectedReturn || '');
  const mantemPeriodo = ['available', 'pause', 'missing', 'offline'].includes(escolha);
  const periodoConfirmado = ['available', 'missing', 'offline'].includes(escolha) && retornoInformado
    ? { date: (perfil.returnForecast && perfil.returnForecast.scheduleDate) || perfil.presenceDate || data, startAt: perfil.expectedReturn, endAt: perfil.returnUntil }
    : mantemPeriodo ? perfil.presenceConfirmedPeriod : undefined;
  const equipe = d.confirmation === 'manual';
  const proximo = {
    ...perfil, shiftStatus: d.shiftStatus, shiftExit: escolha === 'available' || escolha === 'pause' ? undefined : d.shiftExit, presenceDate: data, expectedReturn, returnUntil, returnForecast,
    shiftAvailableSince: escolha === 'available' ? (escolhaDaPresenca(perfil, data) === 'available' ? perfil.shiftAvailableSince : em) : undefined,
    pauseReason: escolha === 'pause' ? d.pauseReason : undefined,
    presenceConfirmation: escolha === 'available' || escolha === 'pause' ? undefined : d.confirmation === 'keep' ? confirmacaoAposRetorno(perfil, agora) : equipe ? { reason: 'manual', requestedAt: em, offlineAt: em } : undefined,
    presenceConfirmedAt: escolha === 'available' ? em : perfil.presenceConfirmedAt,
    presenceScheduleUpdatedAt: d.shiftExit === 'return' || (!equipe && d.shiftExit === 'ended') ? em : perfil.presenceScheduleUpdatedAt,
    presenceConfirmedPeriod: periodoConfirmado && periodoConfirmado.date === data && mesmoDiaReal(periodoConfirmado.startAt) ? periodoConfirmado : undefined,
    presenceLastActivityAt: escolha === 'available' ? em : perfil.presenceLastActivityAt,
  };
  const antes = `${rotuloDaPresenca(perfil, data)} · ${detalheDaPresenca(perfil, data)}`;
  const depois = `${proximo.shiftExit === 'ended' ? 'Offline por hoje' : rotuloDaPresenca(proximo, data)} · ${detalheDaPresenca(proximo, data, excecoes)}`;
  return { ...proximo, presenceHistory: [...(perfil.presenceHistory || []), { id: randomUUID(), actorId: ator.id, actorName: ator.name, at: em, date: data, before: antes, after: depois }] };
}

/** `confirmProfessionalPresence`: ação expressa do profissional, limpa pausa/retorno e exigências anteriores. */
function confirmarPresenca(perfil, data, ator, agora) {
  return mudarPresenca(perfil, { shiftStatus: 'Disponível', confirmation: 'none' }, data, ator, agora);
}

module.exports = {
  IDLE_PADRAO_MS, CONFIRMACAO_PADRAO_MS, SEM_CONSULTAS, ESCOLHAS_SAIDA, MOTIVOS_PAUSA, prazos, avancarConfirmacao, mudarPresenca, confirmarPresenca, confirmacaoAposRetorno, RegraPresencaError,
};
