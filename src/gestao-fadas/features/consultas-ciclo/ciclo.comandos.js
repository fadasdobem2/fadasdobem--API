'use strict';

/**
 * Leitura do COMANDO que o navegador executou (Maturacao/38): o registro que a tela deixou (`pedido`) e o guardado (`antes`) dizem qual função
 * do front rodou (pelo id do evento novo do histórico) e com quais entradas. Cada leitor devolve `calcular(em, ator)`: a MESMA função do
 * front, portada em `_comum/dominio/consulta-*.js`, com o saldo real (`fin`). Quem chama compara o resultado com o `pedido` (instante e
 * ator do navegador) e grava o resultado do servidor (instante e ator dele). `null` = esta fatia não refaz o comando.
 */

const conf = require('../../_comum/dominio/consulta-conferencia');
const aval = require('../../_comum/dominio/consulta-conferencia-avaliacao');
const des = require('../../_comum/dominio/consulta-desfechos');
const equipe = require('../../_comum/dominio/consulta-encerramento-equipe');
const { RegraConsultaError } = require('../../_comum/dominio/consulta-comum');

const NOTA_DA_CONFERENCIA = 'Cliente reconheceu os adicionais; recebimento confirmado conferido.';
const novos = (antes, pedido) => pedido.audit.slice(antes.audit.length);
const comPrefixo = (eventos, p) => eventos.find((e) => typeof e.id === 'string' && e.id.startsWith(p));
const comAcao = (eventos, a) => eventos.find((e) => e.action === a);
const queixaDe = (r) => { const f = r.cancellationReview || r.annulmentComplaint || {}; return { complaint: f.complaint || '', complaintReasons: f.complaintReasons || [], shareComplaint: f.shareComplaint === true }; };

/** Benefícios que a conferência acrescentou: `{ idDoBeneficio: minutos (texto) }`. */
function selecaoDeBeneficios(antes, pedido) {
  const selecao = {};
  for (const x of pedido.minuteBenefits || []) {
    const antigo = ((antes.minuteBenefits || []).find((v) => v.id === x.id) || {}).minutes || 0;
    if (x.minutes - antigo > 0) selecao[x.id] = String(x.minutes - antigo);
  }
  return selecao;
}

/** `contexto`: `{ ator (da sessão), papel, versao, fin }`. */
function ler(antes, pedido, { papel, versao, fin }) {
  const eventos = novos(antes, pedido);
  if (!eventos.length) return null;
  const id = antes.id;
  const lista = () => fin.consultations.map((i) => (i.id === id ? antes : i));
  const clone = () => JSON.parse(JSON.stringify(antes));

  const decisao = comPrefixo(eventos, `finance-review-${id}-`);
  // `approveReportedFinish` com adicionais chama a decisão financeira com esta nota; a tela de decisão usa a nota que a pessoa digita.
  const viaConferir = decisao && pedido.financialReview && (pedido.financialReview.note === NOTA_DA_CONFERENCIA || comPrefixo(eventos, `finish-benefits-${id}-`));
  if (decisao && pedido.financialReview && !viaConferir) {
    const estado = pedido.financialReview.history[pedido.financialReview.history.length - 1].status;
    return { nome: 'decisao-financeira', calcular: (em, ator) => conf.decidirRevisaoFinanceira(clone(), estado, ator, pedido.financialReview.note, em, versao, fin) };
  }
  if (comPrefixo(eventos, `reject-correction-${id}-`)) {
    const linha = (pedido.finishCorrections || []).find((r) => r.status === 'rejected' && r.reviewedAt === pedido.updatedAt);
    return { nome: 'rejeitar-correcao', calcular: (em, ator) => conf.rejeitarCorrecao(clone(), versao, ator, (linha && linha.reviewReason) || '', em) };
  }
  const equipeFinal = comAcao(eventos, 'Encerramento conferido') && comPrefixo(eventos, `audit-${id}-tarot-end-`);
  const correcaoDeEquipe = eventos.find((e) => e.action === 'Encerramento conferido' && /^Correção de /.test(e.detail || ''));
  const desfechoDeEquipe = eventos.find((e) => ['Consulta concluída', 'Consulta cancelada', 'Consulta devolvida', 'Não houve'].includes(e.action) && /^audit-\d+-[0-9a-f]+$/.test(e.id));
  const tempoCorrigido = comPrefixo(eventos, `time-${id}-`) && eventos.find((e) => e.action === 'Dados corrigidos' && /^Tempo informado corrigido de /.test(e.detail || ''));
  if (equipeFinal || correcaoDeEquipe || desfechoDeEquipe || tempoCorrigido) {
    const revisao = Boolean(correcaoDeEquipe || tempoCorrigido);
    const excede = pedido.status === 'Finalizada pelo tarólogo';
    const desfecho = excede ? 'Concluída' : pedido.status;
    const minutos = desfecho === 'Não houve' ? 0 : (pedido.performedDurationSeconds ?? pedido.durationSeconds) / 60;
    const queixa = queixaDe(pedido);
    const entrada = { outcome: desfecho, minutes: minutos, startedAt: pedido.startedAt, isReview: revisao, reviewReason: pedido.finishReview && pedido.finishReview.reason, complaint: queixa.complaint, complaintDetails: queixa,
      bonusEnabled: Boolean(pedido.bonusGrant), bonusMinutes: pedido.bonusGrant && pedido.bonusGrant.minutes, benefitSelection: selecaoDeBeneficios(antes, pedido), version: versao };
    return { nome: 'encerramento-equipe', calcular: (em, ator) => equipe.encerrar(clone(), entrada, { ator, papel, em, fin: { ...fin, consultations: lista() } }) };
  }
  if (viaConferir || comPrefixo(eventos, `review-${id}-`) || comPrefixo(eventos, `finish-benefits-${id}-`)) {
    const selecao = selecaoDeBeneficios(antes, pedido);
    return { nome: 'aprovar-encerramento', calcular: (em, ator) => {
      const f = { ...fin, consultations: lista() };
      const candidato = aval.comBeneficiosDaConferencia(clone(), selecao, f, ator, em);
      const avaliacao = aval.avaliarConferencia(candidato, f, em);
      if (avaliacao.error) throw new RegraConsultaError(avaliacao.error);
      return conf.aprovarEncerramento(candidato, versao, ator, em, f);
    } };
  }
  const compensacao = comPrefixo(eventos, `compensation-${id}-`);
  if (compensacao && pedido.bonusGrant) {
    const q = queixaDe(pedido);
    return { nome: 'compensacao', calcular: (em, ator) => des.prepararCompensacao({ clientId: antes.clientId, sourceId: id, minutes: pedido.bonusGrant.minutes, reason: pedido.bonusGrant.reason, complaint: q.complaint, complaintDetails: q }, lista(), fin.payments, ator, em, papel).next };
  }
  if (comPrefixo(eventos, `cancellation-request-${id}-`)) {
    const q = queixaDe(pedido);
    return { nome: 'solicitar-cancelamento', calcular: (em, ator) => des.solicitarRevisaoDeCancelamento(clone(), q.complaint, ator, em, papel, q) };
  }
  if (comPrefixo(eventos, `cancellation-decision-${id}-`) && pedido.cancellationReview) {
    const r = pedido.cancellationReview; const q = comPrefixo(eventos, `complaint-${id}-`) ? queixaDe(pedido) : undefined;
    return { nome: 'decidir-cancelamento', calcular: (em, ator) => des.decidirNaLista(lista(), { id, updatedAt: antes.updatedAt }, { decision: r.status, observation: r.decisionReason || '', readerMessage: r.readerMessage, complaintDetails: q, actor: ator, at: em, role: papel }, fin.payments) };
  }
  const anulada = comAcao(eventos, 'Consulta anulada');
  if (anulada && pedido.status === 'Anulada' && !pedido.cancellationReview) {
    return { nome: 'anular', calcular: (em, ator) => des.anular(clone(), { reason: anulada.detail, complaintDetails: queixaDe(pedido) }, lista(), fin.payments, ator, em, papel) };
  }
  if (comAcao(eventos, 'Erro de lançamento') && pedido.status === 'Erro') {
    return { nome: 'erro', calcular: (em, ator) => des.marcarErro(clone(), { reason: pedido.errorReason, detail: pedido.errorDetail || '' }, lista(), fin.payments, ator, em, papel) };
  }
  return null;
}

module.exports = { ler, novos };
