'use strict';

/**
 * Consulta, AUTORIZAÇÃO da supervisora no lançamento (Maturacao/38). Porte de `clientes/client-financial-guidance-model.ts`
 * (`financialGuidanceApprovalAvailable`, `clientFinancialLaunchError`). Cliente cuja orientação exige aprovação não ganha consulta nova sem a
 * autorização (que vale para UMA consulta: o próprio lançamento a consome). Puro; ouro do código real do front.
 */

const MENSAGEM = 'Esta cliente precisa de orientação da supervisora antes de uma nova consulta. Abra a ficha e encaminhe para revisão.';

/** `financialGuidanceApprovalAvailable`. `orientacao`: o registro da cliente (ou undefined). */
function autorizacaoDisponivel(clientId, orientacao, consultas) {
  const aprovacao = orientacao && orientacao.approval;
  if (!orientacao || !orientacao.requiresApproval || !aprovacao) return false;
  const base = new Set(aprovacao.baselineConsultationIds);
  return !consultas.some((item) => {
    if (item.clientId !== clientId || base.has(item.id)) return false;
    // Uma entrada retroativa concluída antes desta decisão não usou a permissão.
    const fim = Date.parse(item.endedAt || '');
    if (item.status !== 'Em curso' && Number.isFinite(fim) && fim < Date.parse(aprovacao.at)) return false;
    return true;
  });
}

/** `clientFinancialLaunchError`: a frase do front, ou `undefined` quando o lançamento pode seguir. */
function erroDeLancamento(clientId, orientacao, consultas) {
  if (!orientacao || !orientacao.requiresApproval || autorizacaoDisponivel(clientId, orientacao, consultas)) return undefined;
  return MENSAGEM;
}

module.exports = { autorizacaoDisponivel, erroDeLancamento, MENSAGEM };
