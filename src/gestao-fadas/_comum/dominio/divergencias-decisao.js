'use strict';

/**
 * Divergências, DECISÃO da conferência no servidor (Maturacao/35). Dois blocos portados do CÓDIGO do front:
 *   1) `missingConsultationError` (tarologas/tarologist-divergences-model.ts:106): data e horário do relato da taróloga não podem estar no
 *      futuro, duração de 1 a 1.440 minutos, e pedido repetido (o ouro roda a função real);
 *   2) os EFEITOS da resolução em `shared/divergence-detail-dialog.tsx` (`resolveSelected`): o que o front grava na CONSULTA antes de marcar a
 *      divergência como Resolvida (corrigir minutagem = `correctConsultationTime`, vincular atendimento / corrigir profissional = evento
 *      `review-<id>-<instante>`, incluir consulta ausente = consulta nova no horário do relato). O servidor confere que o efeito EXISTE na consulta
 *      que ele guarda; o cálculo da correção (cobertura e saldo) é refeito em `consulta-correcao.js` na rota da consulta.
 * Os textos de decisão e o id `review-` são lidos do componente (não há função pura para o ouro rodar): ver Maturacao/35, limites.
 */

const { DivergenciaInvalidaError, repetida } = require('./divergencias');

const falha = (m) => { throw new DivergenciaInvalidaError(m); };
const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

/** `missingConsultationTimestamp` sem o calendário de demonstração (`operationTimestamp`). `null` quando a data ou a hora não valem. */
function instanteDoRelato(date, time) {
  if (!ehData(date) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

/**
 * `missingConsultationError`. `outras`: divergências da MESMA taróloga (sem a que está sendo gravada); `agoraMs`: relógio do servidor.
 * Devolve o texto do front ou `null`.
 */
function erroDaConsultaAusente(entrada, outras, agoraMs) {
  const inicio = instanteDoRelato(entrada.date, entrada.time);
  if (!inicio || !Number.isFinite(entrada.minutes) || entrada.minutes <= 0 || entrada.minutes > 1440) return 'Confira a data, o horário e a duração (até 1.440 minutos).';
  if (Date.parse(inicio) > agoraMs) return 'A data e o horário informados ainda não aconteceram.';
  const nova = { id: '', issueType: 'Consulta ausente', clientId: entrada.clientId, reportedClientName: entrada.clientReference, reportedDate: entrada.date, reportedTime: entrada.time };
  return repetida(nova, outras, entrada.tarotId) === 'Esta consulta já tem um pedido de conferência aberto. Acompanhe em Divergências.' ? 'Esta consulta já tem um pedido de conferência aberto. Acompanhe em Divergências.' : null;
}

/** Aplica o `missingConsultationError` ao registro que a taróloga cria ou edita (só o assunto "Consulta ausente"). */
function conferirConsultaAusente(registro, outras, agoraMs, tarotId) {
  if (registro.issueType !== 'Consulta ausente') return;
  const erro = erroDaConsultaAusente({ clientId: registro.clientId, clientReference: registro.reportedClientName || registro.reportedClientPhone, date: registro.reportedDate || '', time: registro.reportedTime || '', minutes: registro.reportedMinutes, tarotId }, outras, agoraMs);
  if (erro) falha(erro);
}

const REALIZADA = ['Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Desistiu'];
/** `consultationCanResolveMissing` (divergence-review-model.ts:64). */
const consultaRealizada = (c) => !c.awaitingTarologistStart && c.durationSeconds > 0 && REALIZADA.includes(c.status);
const MSG_EFEITO = 'A decisão não foi aplicada na consulta. Atualize a tela e tente novamente.';
const PREFIXO_TEMPO = 'Tempo corrigido de ';
const PREFIXOS_VINCULO = ['Profissional corrigido de ', 'Atendimento localizado e vinculado à consulta '];

/**
 * Resolução: o efeito que a decisão declara tem de existir na consulta guardada. `consulta`: o registro (`item`) da consulta citada ou `null`.
 * `antes`/`depois`: a divergência. Só roda para a classe `resolucao`.
 */
function conferirEfeitos(antes, depois, consulta) {
  const decisao = depois.decision || '';
  const idNova = depois.consultationId && depois.consultationId !== antes.consultationId;
  if (!idNova && !decisao.startsWith(PREFIXO_TEMPO) && !PREFIXOS_VINCULO.some((p) => decisao.startsWith(p))) return;
  if (!consulta) falha('A consulta não foi localizada. Atualize a seleção.');
  if (consulta.clientId !== depois.clientId) falha('O vínculo da consulta não corresponde à cliente ou ao tarólogo deste relato. Confira o vínculo antes de resolver.');
  const eventos = consulta.audit || [];
  if (decisao.startsWith(PREFIXO_TEMPO)) {
    const alvo = /^Tempo corrigido de .+ para ([\d.]+) minutos\./.exec(decisao);
    const feito = eventos.some((e) => e.action === 'Dados corrigidos' && typeof e.detail === 'string' && e.detail.includes(`Divergência ${depois.id};`)
      && (!alvo || e.detail.startsWith(`${PREFIXO_TEMPO}`) && new RegExp(` para ${alvo[1].replace('.', '\\.')} minutos\\.`).test(e.detail)));
    if (!feito) falha(MSG_EFEITO);
  }
  if (PREFIXOS_VINCULO.some((p) => decisao.startsWith(p))) {
    if (!consultaRealizada(consulta) || !eventos.some((e) => typeof e.id === 'string' && e.id.startsWith(`review-${depois.id}-`))) falha(MSG_EFEITO);
  }
  if (idNova) {
    if (!consultaRealizada(consulta)) falha('Selecione uma consulta realizada. Agendamentos e consultas aguardando início não comprovam atendimento.');
    const vinculada = eventos.some((e) => typeof e.id === 'string' && e.id.startsWith(`review-${depois.id}-`));
    const inicio = instanteDoRelato(depois.reportedDate, depois.reportedTime);
    const incluida = Boolean(inicio) && consulta.startedAt === inicio;
    if (!vinculada && !incluida) falha(MSG_EFEITO);
  }
}

module.exports = { instanteDoRelato, erroDaConsultaAusente, conferirConsultaAusente, conferirEfeitos, consultaRealizada, MSG_EFEITO };
