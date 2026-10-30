'use strict';

/**
 * Consulta, EDIÇÃO DE DADOS no servidor (Maturacao/38): o que se decide a partir do registro guardado e do que o navegador deixou.
 * Funções reais do front portadas: `validateExtensionChanges` (`consulta-continuacao.js`), `validateMinuteBenefits`, `validatePaymentComplementChanges`
 * e `validateTimeCorrectionCoverage` (`consulta-vinculos.js`, `consulta-correcao.js`), `clientFinancialLaunchError` (`consulta-autorizacao.js`).
 * Transcritas de `saveForm` (`consultations-experience.tsx`) e `resolveConsultationEditSave` (`consultation-operations.ts`): quem pode mexer em
 * consulta com queixa e as regras de horário (início no futuro, tempo inválido, motivo do tempo). NÃO portado: o recálculo de cobrança,
 * tarifa e valor do minuto da edição (dependem de tabelas de preço e do plano de minutos da tela).
 */

const c = require('./consulta-comum');
const vinculos = require('./consulta-vinculos');
const cob = require('./financeiro-cobranca');
const { validarContinuacao } = require('./consulta-continuacao');
const { conferirCobertura } = require('./consulta-correcao');

const { erro } = c;
const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const relogio = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
/** `formatTime` do front: o horário no minuto (a tela só vê minuto). */
const hhmm = (v) => (v && Number.isFinite(Date.parse(v)) ? relogio.format(new Date(v)) : '—');
const FIM = ['Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Desistiu'];

/** O que a edição mudou nos campos financeiros (`financialChange` de `saveForm`, só o que se vê no registro). */
function mudouAlgoFinanceiro(antes, depois) {
  const cobertura = (x) => `${(x.coverage && x.coverage.kind) || ''}|${(x.coverage && x.coverage.minutes) || 0}|${(x.coverage && x.coverage.sourceConsultationId) || ''}`;
  const esperado = (x) => { const l = c.limiteDe(x); return l.kind === 'maximum' ? l.minutes : 0; };
  return antes.clientId !== depois.clientId || antes.tarotId !== depois.tarotId || hhmm(antes.startedAt) !== hhmm(depois.startedAt) || (antes.status !== 'Em curso' && hhmm(antes.endedAt) !== hhmm(depois.endedAt))
    || cob.minutosRelatados(antes) !== cob.minutosRelatados(depois) || esperado(antes) !== esperado(depois) || (antes.minuteValue || 2.96) !== (depois.minuteValue || 2.96)
    || cobertura(antes) !== cobertura(depois) || (antes.paymentDisposition || '') !== (depois.paymentDisposition || '') || antes.paymentProfile !== depois.paymentProfile
    || Boolean(antes.billing && antes.billing.minimumWaived) !== Boolean(depois.billing && depois.billing.minimumWaived) || !igual(antes.minuteBenefits, depois.minuteBenefits);
}

/** Só vale carregar o saldo (pagamentos e legado) quando a edição mexe no que depende dele. */
const precisaDoSaldo = (antes, depois) => mudouAlgoFinanceiro(antes, depois) || !igual(antes.continuation, depois.continuation) || antes.durationSeconds !== depois.durationSeconds || antes.status !== depois.status;

/** Regras sem banco da edição. `fin`: `{ payments, consultations, profile }` da cliente NOVA (pode ser `undefined`). `papel`: papel do ator. */
function conferirEdicao(antes, depois, { papel, agora, fin }) {
  const mudouTempo = hhmm(antes.startedAt) !== hhmm(depois.startedAt) || (antes.status !== 'Em curso' && hhmm(antes.endedAt) !== hhmm(depois.endedAt)) || cob.minutosRelatados(antes) !== cob.minutosRelatados(depois);
  const mexeuNoQueImporta = mudouTempo || mudouAlgoFinanceiro(antes, depois);
  // As regras de horário só valem para quem mexe no tempo (outras gravações, como a queixa ou o encaminhamento, não passam pelo formulário de horário).
  if (antes.status === 'Não houve' && mexeuNoQueImporta) erro('Use Reabrir para iniciar uma nova consulta.');
  if (antes.cancellationReview && papel !== 'administradora' && mudouAlgoFinanceiro(antes, depois)) erro('Só a administradora pode alterar cliente, tarólogo, tempo ou valores desta consulta com queixa registrada. Você pode atualizar as observações.');
  if (antes.startedAt !== depois.startedAt && Date.parse(depois.startedAt) > Date.parse(agora)) erro('O início da consulta não pode estar no futuro.');
  if (mudouTempo) {
    if (!Number.isFinite(depois.durationSeconds) || depois.durationSeconds < 0) erro('O início não pode ser posterior ao fim da consulta.');
    if (antes.status !== 'Em curso' && depois.durationSeconds === 0) erro('Informe um tempo válido.');
    if (antes.status !== 'Em curso' && !(depois.readerCorrection && !igual(antes.readerCorrection, depois.readerCorrection) && String(depois.readerCorrection.reason || '').trim())) erro('Motivo da alteração do tempo: preencha este campo.');
  }
  if (!fin) return;
  validarContinuacao(depois, fin.consultations);
  vinculos.validarBeneficios(depois, fin.consultations, fin.profile);
  conferirCobertura(antes, depois, fin, agora);
}

module.exports = { conferirEdicao, mudouAlgoFinanceiro, precisaDoSaldo, FIM };
