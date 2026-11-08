'use strict';

/**
 * Campos do pagamento da Lilly v708 (docs/banco/21 §4 da Nice). Funções puras, a API é a autoridade:
 *  - `paidAt`/`date`: o instante efetivo do recebimento (UTC ISO canônico quando o provedor confirma); nunca a data do lançamento;
 *  - `reference` e `mpPaymentId` são o MESMO ID do Mercado Pago; `authorization` = `endToEndId` ou, sem ele, o ID do Mercado Pago;
 *  - `method`/`bank`/`confirmation` do Pix conferido: `PIX`, `Mercado Pago`, `Confirmado`;
 *  - `payerName` é do pagador e fica separado do nome da cliente (pode ser `null`);
 *  - lançamento automático (`authorizedBy: 'lilly:mercado_pago'`): exige `providerConfirmed:true` e `paidAt` canônico.
 */

const { ehObjeto, texto } = require('./executores.comum');

const AUTOMATICO = 'lilly:mercado_pago';
const ID_MP = /^\d{1,30}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MARGEM_FUTURO_MS = 5 * 60 * 1000;

const mesmo = (a, b) => `${a}`.trim().toLowerCase() === `${b}`.trim().toLowerCase();
const ehAutomatico = (p) => ehObjeto(p) && texto(p.authorizedBy) === AUTOMATICO;

/** Data civil ou instante válido; `null` se vier mal formada. Devolve o texto aparado. */
function dataDoPagamento(v, campo) {
  const t = texto(v);
  if (!t) return { vazio: true };
  const ok = DATA.test(t) ? !Number.isNaN(Date.parse(`${t}T12:00:00Z`)) : INSTANTE.test(t) && !Number.isNaN(Date.parse(t));
  return ok ? { valor: t } : { erro: `${campo}: data inválida.` };
}

/** Confere o que é específico de pagamento confirmado pelo provedor (e do automático). `{ motivo }` ou `{ paidAt, autorizacao }`. */
function conferirProvedor(p, refs, agora = Date.now()) {
  const pago = dataDoPagamento(p.paidAt, 'paidAt'); const dia = dataDoPagamento(p.date, 'date');
  if (pago.erro || dia.erro) return { motivo: pago.erro || dia.erro };
  if (pago.valor && dia.valor && Date.parse(pago.valor) !== Date.parse(dia.valor)) return { motivo: 'paidAt e date precisam ser o mesmo instante.' };
  const paidAt = pago.valor || dia.valor;
  if (paidAt && Date.parse(paidAt) > agora + MARGEM_FUTURO_MS) return { motivo: 'A data do pagamento está no futuro.' };
  if (ehAutomatico(p) && refs.reference && refs.mpPaymentId && !mesmo(refs.reference, refs.mpPaymentId)) return { motivo: 'reference e mpPaymentId precisam ser o mesmo ID do pagamento.' };
  if (p.payerName !== undefined && p.payerName !== null && (typeof p.payerName !== 'string' || p.payerName.length > 200)) return { motivo: 'O nome do pagador é inválido.' };
  if (p.providerConfirmed === true) {
    for (const [campo, esperado] of [['method', 'PIX'], ['bank', 'Mercado Pago'], ['confirmation', 'Confirmado']]) {
      if (p[campo] !== undefined && p[campo] !== esperado) return { motivo: `${campo}: o pagamento conferido no provedor é "${esperado}".` };
    }
  }
  const esperadaAut = texto(refs.endToEndId) || texto(refs.mpPaymentId) || texto(refs.reference);
  if (ehAutomatico(p) && p.authorization !== undefined && p.authorization !== null && texto(p.authorization) && !mesmo(p.authorization, esperadaAut)) {
    return { motivo: 'authorization precisa ser o endToEndId ou, sem ele, o ID do Mercado Pago.' };
  }
  if (ehAutomatico(p)) {
    if (p.providerConfirmed !== true) return { motivo: 'O lançamento automático exige a confirmação do provedor.', code: 'LILLY_AUTHORIZATION_MISSING' };
    if (!paidAt || !INSTANTE.test(paidAt) || new Date(paidAt).toISOString() !== paidAt) return { motivo: 'O lançamento automático exige paidAt como instante UTC ISO canônico.' };
    if (!refs.mpPaymentId || !ID_MP.test(refs.mpPaymentId)) return { motivo: 'O lançamento automático exige o ID do pagamento no Mercado Pago (mpPaymentId).' };
  }
  return { paidAt, authorization: texto(p.authorization) || esperadaAut || undefined, providerConfirmed: p.providerConfirmed === true, authorizedBy: texto(p.authorizedBy) || undefined };
}

module.exports = { conferirProvedor, ehAutomatico, AUTOMATICO, mesmo };
