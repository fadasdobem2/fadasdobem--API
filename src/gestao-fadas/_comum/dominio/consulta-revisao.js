'use strict';

/**
 * Revisão guardada de uma consulta já lançada (conferência, correção de tempo, desfechos, revisão de cancelamento, compensação,
 * mais tempo, edição). Para estes comandos o front calcula o registro novo com o domínio dele (cobertura, cobrança e saldo dependem de
 * pagamentos e valores que ainda não são reais aqui); a API NÃO o recalcula inteiro (mesma decisão da Agenda, Maturacao/29 seção 7.3):
 * ela descobre QUAL comando foi pedido comparando antes e depois (`classificar`) e confere as invariantes desse comando
 * (`conferir`): quem pode, transição de estado permitida, história que só cresce, o que é imutável (comissão capturada, início do
 * tarólogo), "encerra uma vez", `expectedVersion` (o `updatedAt` do front) e mensagens do front. Início, pausa, retomada e término
 * informado NÃO passam por aqui: o servidor os recalcula com o relógio dele (consulta-sessao.js).
 * Regras e mensagens vêm de consultation-cancellation-review.ts, consultation-compensation.ts, consultation-time-correction.ts,
 * tarologist-finish-report.ts, tarologist-cancellation.ts e domain/permissions.ts.
 */

const c = require('./consulta-comum');

const { erro } = c;
// Compara por valor com as chaves em ordem: o jsonb do Postgres não guarda a ordem das chaves (lição 8 da Agenda).
const { limpar } = require('./agenda-contato');
const igual = (a, b) => JSON.stringify(limpar(a ?? null)) === JSON.stringify(limpar(b ?? null));
const ENCERRAVEIS = new Set(['Em curso', 'Finalizada pelo tarólogo', 'Concluída', 'Cancelada', 'Desistiu']);
const DESFECHOS = new Set(['Concluída', 'Cancelada', 'Devolvida', 'Não houve', 'Desistiu', 'Anulada', 'Erro']);
const MOTIVOS_ERRO = Object.freeze(['ID errado', 'Não teve', 'Duplicada', 'Outro']);
const BONUS_MOTIVOS = Object.freeze(['Consulta anterior cancelada', 'Abatimento na consulta anterior']);

/** O comando que o par antes/depois representa. `null` quando não corresponde a nada que esta rota aceite. */
function classificar(a, d) {
  if (!a.tarologistFinishReport && d.tarologistFinishReport) return 'termino';
  if (a.status !== 'Em curso' && d.status === 'Em curso') return 'reabertura';
  if (!a.tarologistCancellation && d.tarologistCancellation) return 'cancelamento-taro';
  if (!a.cancellationReview && d.cancellationReview) return 'revisao-cancelamento';
  if (a.cancellationReview && d.cancellationReview && a.cancellationReview.status === 'pending' && d.cancellationReview.status !== 'pending') return 'decisao-cancelamento';
  if ((!a.finishReview && d.finishReview) || (a.status === 'Finalizada pelo tarólogo' && d.status === 'Concluída' && d.finishReview)) return d.finishReview && d.finishReview.result === 'corrected' ? 'correcao-tempo' : 'conferencia';
  if (a.status !== d.status && DESFECHOS.has(d.status)) return 'desfecho';
  if (a.awaitingTarologistStart && !d.awaitingTarologistStart) return 'inicio';
  if (!igual(d.pauseHistory, a.pauseHistory)) return 'pausa';
  if (!a.bonusGrant && d.bonusGrant) return 'compensacao';
  if ((d.finishCorrections || []).length > (a.finishCorrections || []).length) return 'correcao-pedida';
  if (!igual(a.finishCorrections, d.finishCorrections)) return 'correcao-recusada';
  if (!igual(a.readerCorrection, d.readerCorrection)) return 'correcao-tempo';
  if (!igual(a.tarologistMoreTimeRequest, d.tarologistMoreTimeRequest)) {
    return !a.tarologistMoreTimeRequest && d.tarologistMoreTimeRequest && d.tarologistMoreTimeRequest.active ? 'mais-tempo-pedido' : 'mais-tempo';
  }
  return 'edicao';
}

/**
 * Confere as invariantes do comando. `ctx`: `{ perfil, permissoes, tarotIdProprio }`. Lança `RegraConsultaError` (422) com a mensagem do front
 * ou `PermissaoConsultaError` (403). Devolve o comando conferido.
 */
class PermissaoConsultaError extends Error { constructor(m) { super(m); this.name = 'PermissaoConsultaError'; } }
const proibido = (m = 'Esta ação não está disponível para a sua função.') => { throw new PermissaoConsultaError(m); };

function conferir(kind, a, d, ctx) {
  const p = ctx.permissoes;
  // O que nenhum comando altera.
  if (d.id !== a.id) erro('Não foi possível identificar a consulta.');
  if (a.commissionRate !== d.commissionRate) erro('A comissão capturada no lançamento não pode ser alterada.');
  if (a.tarologistStartedAt !== d.tarologistStartedAt) erro('O início registrado pelo tarólogo não pode ser alterado.');
  if (a.sentToTarologistAt !== d.sentToTarologistAt) erro('O horário de envio ao tarólogo não pode ser alterado.');
  if (d.audit.length < a.audit.length || a.audit.some((e, i) => !igual(e, d.audit[i]))) erro('O histórico da consulta só pode ser acrescentado.');
  if (kind !== 'reabertura' && a.tarologistFinishReport && !d.tarologistFinishReport) erro('Esta consulta já foi encerrada. Informe o erro ao atendimento ou abra uma divergência.');
  if (kind !== 'edicao' && kind !== 'reabertura' && a.clientId !== d.clientId) erro('A cliente da consulta só muda pela edição de dados.');
  if (kind !== 'edicao' && kind !== 'reabertura' && a.tarotId !== d.tarotId) erro('O tarólogo da consulta só muda pela edição de dados.');

  // Estado final por comando: nos que não encerram nem reabrem, o estado não muda; conferir e corrigir só vão entre Concluída e Finalizada.
  const MESMO_ESTADO = ['edicao', 'mais-tempo', 'mais-tempo-pedido', 'correcao-pedida', 'correcao-recusada', 'compensacao'];
  if (MESMO_ESTADO.includes(kind) && a.status !== d.status) erro('Esta alteração não muda a situação da consulta.');
  if ((kind === 'conferencia' || kind === 'correcao-tempo') && !['Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Desistiu'].includes(d.status)) erro('Confira a situação da consulta antes de corrigir o tempo.');
  if ((kind === 'conferencia' || kind === 'correcao-tempo') && ['Cancelada', 'Desistiu'].includes(a.status) && a.status !== d.status) erro('Confira a situação da consulta antes de corrigir o tempo.');

  if (ctx.perfil === 'tarologa' || !p.canManageConsultations) proibido();
  if (['termino', 'inicio', 'pausa', 'cancelamento-taro', 'correcao-pedida', 'mais-tempo-pedido'].includes(kind)) erro('Use a ação própria para registrar início, pausa, término, devolução ou pedidos da taróloga.');
  if (kind === 'conferencia' || kind === 'correcao-tempo' || kind === 'correcao-recusada') {
    if (!p.canCorrectFinalized) proibido();
    if (kind === 'correcao-tempo' && !ENCERRAVEIS.has(a.status)) erro('Confira a situação da consulta antes de corrigir o tempo.');
    // O front guarda o motivo em `readerCorrection` (correção de tempo) ou só em `finishReview.reason` (conferência com correção sem mudar o tempo).
    if (kind === 'correcao-tempo') c.observacao((d.readerCorrection && d.readerCorrection.reason) || (d.finishReview && d.finishReview.reason), 'Motivo da correção', true);
    if (kind === 'conferencia' && !c.aguardaConferencia(a) && a.finishReview && d.finishReview && a.finishReview.reportSubmittedAt === d.finishReview.reportSubmittedAt && a.status === 'Concluída') erro('Este encerramento já foi conferido.');
    if (kind === 'conferencia' && !c.aguardaConferencia(a)) erro('Este encerramento já foi conferido.');
    return kind;
  }
  if (kind === 'revisao-cancelamento') {
    if (a.cancellationReview) erro('A administradora já decidiu este cancelamento.');
    if (!ENCERRAVEIS.has(a.status)) erro('Esta consulta não pode ser cancelada por reclamação.');
    if (d.status !== 'Cancelada' || d.cancellationReview.status !== 'pending') erro('Esta consulta não pode ser cancelada por reclamação.');
    return kind;
  }
  if (kind === 'decisao-cancelamento') {
    if (!p.canDecideCancellationPayout) proibido('Somente a administradora pode decidir o pagamento deste cancelamento.');
    if (a.status !== 'Cancelada' || a.cancellationReview.status !== 'pending') erro('Este cancelamento não está aguardando decisão.');
    const dec = d.cancellationReview.status;
    if (dec !== 'paid' && dec !== 'unpaid') erro('Selecione Cancelar ou Anular.');
    if (d.status !== (dec === 'paid' ? 'Cancelada' : 'Anulada')) erro('A decisão não corresponde ao estado da consulta.');
    return kind;
  }
  if (kind === 'compensacao') {
    if (!['Concluída', 'Cancelada'].includes(a.status)) erro('Selecione uma consulta encerrada desta cliente.');
    if (a.bonusGrant) erro('Esta consulta já tem bônus registrado. Use os minutos disponíveis ou revise o bônus existente.');
    const g = d.bonusGrant;
    if (!BONUS_MOTIVOS.includes(g.reason)) erro('Selecione o motivo do bônus.');
    if (!Number.isSafeInteger(g.minutes) || g.minutes < 1) erro('Informe os minutos do bônus.');
    if (g.reason === BONUS_MOTIVOS[1] && a.status === 'Cancelada') erro('Esta consulta já foi cancelada. Selecione Consulta anterior cancelada.');
    return kind;
  }
  if (kind === 'reabertura') {
    if (!p.canCorrectFinalized) proibido();
    return kind;
  }
  if (kind === 'desfecho') {
    if (!ENCERRAVEIS.has(a.status) && !(a.status === 'Em curso')) erro('Esta consulta já foi encerrada.');
    if (d.status === 'Anulada' && !p.canAnnulConsultations) proibido('Somente a administradora pode anular consultas.');
    if (d.status === 'Erro' && !MOTIVOS_ERRO.includes(d.errorReason)) erro('Selecione o motivo do erro de lançamento.');
    if (!Number.isFinite(d.durationSeconds) || d.durationSeconds < 0) erro('Informe um tempo válido em minutos.');
    if (d.endedAt && (!Number.isFinite(Date.parse(d.endedAt)) || Date.parse(d.endedAt) < Date.parse(a.startedAt) - 1000)) erro('Informe um horário de fim válido.');
    return kind;
  }
  if (kind === 'mais-tempo') return kind;
  if (kind !== 'edicao') erro('Comando não reconhecido.');
  // Edição de dados (consultation-operations.ts:294): equipe, com versão; troca de cliente/tarólogo só em consulta sem relato final.
  if (!d.clientId || !d.tarotId) erro('Informe cliente e tarólogo.');
  c.observacao(d.observation || '', 'Observação');
  return 'edicao';
}

module.exports = { classificar, conferir, PermissaoConsultaError, MOTIVOS_ERRO, BONUS_MOTIVOS, DESFECHOS };
