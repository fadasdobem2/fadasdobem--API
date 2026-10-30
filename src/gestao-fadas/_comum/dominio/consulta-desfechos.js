'use strict';

/**
 * Consulta, DESFECHOS no servidor (Maturacao/38): queixa, revisão de cancelamento (cancelar ou anular), compensação (bônus), anulação direta e
 * erro de lançamento. Porte de `domain/consultation-complaint.ts`, `domain/consultation-cancellation-review.ts`,
 * `domain/consultation-compensation.ts`, `consultas/cancellation-review-decision.ts` e `consultas/consultation-input.ts`
 * (`validateConsultationErrorInput`); a anulação e o erro vêm de `confirmAnnul` e `confirmError` (`consultations-experience.tsx`, que não
 * têm função pura: transcritos do componente). Puro: o instante `em` e o papel entram por parâmetro.
 */

const c = require('./consulta-comum');
const { permissionsFor } = require('../politica-acesso');
const cob = require('./financeiro-cobranca');
const vinculos = require('./consulta-vinculos');
const b = require('./financeiro-base');

const { erro } = c;
const MOTIVOS_DE_QUEIXA = Object.freeze(['Achou genérica', 'Demora/lentidão', 'Não bateu', 'Perguntou antes de responder', 'Outros']);
const MOTIVOS_DE_BONUS = Object.freeze(['Consulta anterior cancelada', 'Abatimento na consulta anterior']);
const MOTIVOS_DE_ERRO = Object.freeze(['ID errado', 'Não teve', 'Duplicada', 'Outro']);
/** `auditEvent` do front gera `audit-<Date.now()>-<aleatório>`; o servidor usa o instante dele e `0` (a comparação ignora o id desses eventos). */
const idDeEvento = (em) => `audit-${Date.parse(em)}-0`;
const CANCELAVEIS = new Set(['Em curso', 'Finalizada pelo tarólogo', 'Concluída', 'Cancelada', 'Desistiu']);

/** `consultationComplaint`. */
function queixaDaConsulta(item) {
  const f = item.cancellationReview ?? item.annulmentComplaint;
  return { complaint: (f && f.complaint) ?? '', complaintReasons: (f && f.complaintReasons) ?? [], shareComplaint: Boolean(f && f.shareComplaint === true) };
}

/** `validateComplaint`. */
function validarQueixa(entrada, obrigatoria = false) {
  const queixa = entrada.complaint.trim(); const motivos = [...new Set(entrada.complaintReasons ?? [])];
  if (motivos.some((m) => !MOTIVOS_DE_QUEIXA.includes(m))) erro('Confira os motivos assinalados.');
  if (queixa.length > 4000) erro('A queixa da cliente pode ter até 4000 caracteres.');
  if (obrigatoria && !queixa && !motivos.length) erro('Cole a queixa da cliente ou assinale um motivo.');
  return { complaint: queixa, complaintReasons: motivos, shareComplaint: Boolean(queixa && entrada.shareComplaint) };
}

/** `withConsultationComplaint`. */
function comQueixa(item, entrada, ator, em, papel) {
  if (!permissionsFor(papel).canManageConsultations) erro('Somente a equipe pode registrar a queixa.');
  if (!['Cancelada', 'Anulada'].includes(item.status)) erro('A queixa pertence a uma consulta cancelada ou anulada.');
  if (item.cancellationReview && papel !== 'administradora') erro('Só a administradora pode corrigir esta queixa.');
  if (!ator.trim() || !Number.isFinite(Date.parse(em))) erro('Confira quem registrou e a data da alteração.');
  const dados = validarQueixa(entrada);
  return { ...item, ...(item.cancellationReview ? { cancellationReview: { ...item.cancellationReview, ...dados } } : { annulmentComplaint: dados }), updatedAt: em,
    audit: [...item.audit, { id: `complaint-${item.id}-${em}`, action: 'Dados corrigidos', detail: 'Motivos, queixa da cliente e compartilhamento atualizados.', actor: ator, createdAt: em }] };
}

function validarAtor(ator, em) {
  if (!ator.trim()) erro('Identifique quem está registrando esta ação.');
  if (!Number.isFinite(Date.parse(em))) erro('Confira a data do registro.');
}

/** `requestCancellationReview`. */
function solicitarRevisaoDeCancelamento(item, queixa, ator, em, papel, detalhes) {
  if (!permissionsFor(papel).canManageConsultations) erro('Somente a equipe pode registrar o cancelamento da cliente.');
  validarAtor(ator, em);
  if (item.cancellationReview && item.cancellationReview.status === 'pending') return item;
  if (item.cancellationReview) erro('A administradora já decidiu este cancelamento.');
  if (!CANCELAVEIS.has(item.status)) erro('Esta consulta não pode ser cancelada por reclamação.');
  const dados = validarQueixa(detalhes ?? { complaint: queixa }, true);
  const mensagem = dados.complaint;
  const situacaoDaLeitora = item.status === 'Em curso' || item.status === 'Finalizada pelo tarólogo' ? 'Concluída' : item.status;
  return { ...item, status: 'Cancelada', cancellationReason: mensagem, cancellationReview: { status: 'pending', ...dados, requestedBy: ator, requestedAt: em, readerStatus: situacaoDaLeitora },
    cancellationPayout: { enabled: true, by: ator, at: em }, updatedAt: em,
    audit: [...item.audit, { id: `cancellation-request-${item.id}-${em}`, action: 'Consulta cancelada',
      detail: `Motivos: ${(dados.complaintReasons && dados.complaintReasons.length ? dados.complaintReasons.join(', ') : '') || 'não assinalados'}. Queixa da cliente: ${mensagem || 'não transcrita'}. Decisão sobre o pagamento encaminhada à administradora.`, actor: ator, createdAt: em }] };
}

/** `decideCancellationReview`. */
function decidirRevisaoDeCancelamento(item, decisao, motivo, ator, em, papel, mensagemDaLeitora) {
  if (!permissionsFor(papel).canDecideCancellationPayout) erro('Somente a administradora pode decidir o pagamento deste cancelamento.');
  validarAtor(ator, em);
  if (decisao !== 'paid' && decisao !== 'unpaid') erro('Selecione Cancelar ou Anular.');
  if (item.status !== 'Cancelada' || !item.cancellationReview || item.cancellationReview.status !== 'pending') erro('Este cancelamento não está aguardando decisão.');
  const razao = motivo.trim();
  if (razao.length > 4000) erro('Use até 4.000 caracteres na observação da decisão.');
  const mensagem = decisao === 'unpaid' && mensagemDaLeitora !== undefined ? mensagemDaLeitora.trim() : undefined;
  if (mensagem && mensagem.length > 600) erro('Use até 600 caracteres na mensagem para o tarólogo.');
  const revisao = { ...item.cancellationReview }; delete revisao.decisionReason; delete revisao.readerMessage;
  return { ...item, status: decisao === 'paid' ? 'Cancelada' : 'Anulada', cancellationPayout: { enabled: decisao === 'paid', by: ator, at: em },
    cancellationReview: { ...revisao, status: decisao, decidedBy: ator, decidedAt: em, ...(razao ? { decisionReason: razao } : {}), ...(mensagem ? { readerMessage: mensagem } : {}) }, updatedAt: em,
    audit: [...item.audit, { id: `cancellation-decision-${item.id}-${em}`, action: decisao === 'paid' ? 'Consulta cancelada' : 'Consulta anulada',
      detail: `${decisao === 'paid' ? 'Cancelamento confirmado com pagamento ao tarólogo' : 'Anulação confirmada sem pagamento ao tarólogo'}.${razao ? ` Observação: ${razao}.` : ''} Queixa, bônus e atendimento da cliente preservados.`, actor: ator, createdAt: em }] };
}

/** `decideCancellationInConsultations` sobre `consultas` (inclui a guardada). `entrada`: `{ decision, observation, readerMessage, complaintDetails, actor, at, role }`. */
function decidirNaLista(consultas, alvo, entrada, pagamentos) {
  const atual = consultas.find((i) => i.id === alvo.id);
  if (!atual) erro('Consulta não localizada.');
  if (atual.updatedAt !== alvo.updatedAt) erro('A consulta mudou. Feche e abra a decisão novamente.');
  const preparada = entrada.complaintDetails ? comQueixa(atual, entrada.complaintDetails, entrada.actor, entrada.at, entrada.role) : atual;
  const proxima = decidirRevisaoDeCancelamento(preparada, entrada.decision, entrada.observation, entrada.actor, entrada.at, entrada.role, entrada.readerMessage);
  vinculos.validarComplemento(proxima, consultas, pagamentos);
  return proxima;
}

/** `compensationGrant`. */
function concessaoDaCompensacao(origem, pagamentos, minutos, motivo, ator, em) {
  if (!MOTIVOS_DE_BONUS.includes(motivo)) erro('Selecione o motivo do bônus.');
  const parcial = motivo === MOTIVOS_DE_BONUS[1]; const maximo = vinculos.maximoDaCompensacao(origem, pagamentos, parcial);
  if (!Number.isSafeInteger(minutos) || minutos < 1 || minutos > maximo) erro(`Informe de 1 a ${maximo} minutos de bônus.`);
  return { ...vinculos.concessaoDeBonus(origem, pagamentos, minutos, ator, em), adjustment: parcial ? 'partial' : 'cancellation', reason: motivo, unitValue: cob.valorDoMinutoDaConsulta(origem, pagamentos) };
}

/** `prepareConsultationCompensation`. `entrada`: `{ clientId, sourceId, minutes, reason, complaint, complaintDetails }`. Devolve `{ source, next, benefit }`. */
function prepararCompensacao(entrada, consultas, pagamentos, ator, em, papel = 'atendente') {
  if (!permissionsFor(papel).canManageConsultations) erro('Este lançamento está disponível para a equipe.');
  const origem = consultas.find((i) => i.id === entrada.sourceId && i.clientId === entrada.clientId);
  if (!origem || !['Concluída', 'Cancelada'].includes(origem.status)) erro('Selecione uma consulta encerrada desta cliente.');
  if (origem.bonusGrant) erro('Esta consulta já tem bônus registrado. Use os minutos disponíveis ou revise o bônus existente.');
  if (!MOTIVOS_DE_BONUS.includes(entrada.reason)) erro('Selecione o motivo do bônus.');
  const parcial = entrada.reason === MOTIVOS_DE_BONUS[1];
  if (parcial && origem.status === 'Cancelada') erro('Esta consulta já foi cancelada. Selecione Consulta anterior cancelada.');
  const maximo = vinculos.maximoDaCompensacao(origem, pagamentos, parcial);
  if (!Number.isSafeInteger(entrada.minutes) || entrada.minutes < 1 || entrada.minutes > maximo) erro(`Informe de 1 a ${maximo} minutos de bônus.`);
  const dados = validarQueixa(origem.cancellationReview ? queixaDaConsulta(origem) : (entrada.complaintDetails ?? { complaint: entrada.complaint || '' }), true);
  const queixa = dados.complaint;
  const valor = cob.valorDoMinutoDaConsulta(origem, pagamentos);
  const concessao = concessaoDaCompensacao(origem, pagamentos, entrada.minutes, entrada.reason, ator, em);
  const compensada = { ...origem, bonusGrant: concessao, updatedAt: em, audit: [...origem.audit, { id: `compensation-${origem.id}-${em}`, action: 'Dados corrigidos', detail: `${entrada.reason}: ${entrada.minutes} min convertidos em bônus. Minuto da origem: ${valor}. Queixa da cliente: ${queixa}`, actor: ator, createdAt: em }] };
  const decisaoAntiga = origem.status === 'Cancelada' && Boolean(origem.cancellationPayout) && !origem.cancellationReview;
  const proxima = origem.cancellationReview ? compensada : decisaoAntiga ? { ...compensada, annulmentComplaint: dados } : solicitarRevisaoDeCancelamento(compensada, queixa, ator, em, papel, dados);
  vinculos.validarComplemento(proxima, consultas, pagamentos);
  return { source: origem, next: proxima, benefit: b.beneficioDoBonus(proxima) };
}

/** `validateConsultationErrorInput`. */
function validarEntradaDeErro(motivo, detalhe) {
  if (typeof motivo !== 'string' || !MOTIVOS_DE_ERRO.includes(motivo)) erro('Motivo do erro: selecione uma opção válida.');
  return { errorReason: motivo, errorDetail: c.observacao(detalhe, 'Detalhe do erro', motivo === 'Outro') };
}

/** `confirmAnnul` (anulação direta, sem revisão de cancelamento). `lista`: consultas atuais (inclui a guardada). */
function anular(item, entrada, lista, pagamentos, ator, em, papel) {
  if (!permissionsFor(papel).canDecideCancellationPayout) erro('Só a administradora pode anular consultas.');
  c.nome(ator, 'Administradora');
  const queixa = validarQueixa(entrada.complaintDetails);
  const motivo = c.observacao(entrada.reason, 'Motivo da anulação', true);
  if (item.cancellationReview) erro('A consulta mudou. Feche e abra a decisão novamente.');
  const proxima = { ...item, status: 'Anulada', annulmentComplaint: validarQueixa(entrada.complaintDetails), updatedAt: em, audit: [...item.audit, { id: idDeEvento(em), action: 'Consulta anulada', detail: motivo, actor: ator, createdAt: em }] };
  void queixa;
  vinculos.validarComplemento(proxima, lista, pagamentos);
  return proxima;
}

/** `confirmError`. `entrada`: `{ reason, detail }`. */
function marcarErro(item, entrada, lista, pagamentos, ator, em, papel) {
  if (!permissionsFor(papel).canDecideCancellationPayout) erro('Você não pode marcar esta consulta como erro.');
  if (item.cancellationReview) erro('Esta consulta tem uma queixa registrada. Use a decisão do cancelamento.');
  vinculos.validarComplemento({ ...item, status: 'Erro' }, lista, pagamentos);
  c.nome(ator, 'Atendente');
  const dados = validarEntradaDeErro(entrada.reason, entrada.detail);
  const detalhe = `${dados.errorReason}${dados.errorDetail ? `: ${dados.errorDetail}` : ''}; registro preservado somente para auditoria.`;
  return { ...item, status: 'Erro', endedAt: item.endedAt || em, errorReason: entrada.reason, errorDetail: dados.errorDetail || undefined, updatedAt: em, audit: [...item.audit, { id: idDeEvento(em), action: 'Erro de lançamento', detail: detalhe, actor: ator, createdAt: em }] };
}

module.exports = { MOTIVOS_DE_QUEIXA, MOTIVOS_DE_BONUS, MOTIVOS_DE_ERRO, queixaDaConsulta, validarQueixa, comQueixa, solicitarRevisaoDeCancelamento, decidirRevisaoDeCancelamento, decidirNaLista,
  concessaoDaCompensacao, prepararCompensacao, validarEntradaDeErro, anular, marcarErro, idDeEvento };
