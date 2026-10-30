'use strict';

/**
 * Duplicidade de pagamento no servidor (Maturacao/42, item 4): porte de `findPaymentDuplicateCandidates`, `assertPaymentDuplicateReview` e
 * `recordPaymentDuplicateReview` (`features/finance/payment-duplicate-model.ts`). O front compara o lançamento novo com os pagamentos da MESMA cliente,
 * não cancelados, de mesmo valor e lançados há no máximo 15 minutos; havendo algum, só salva com a conferência da operadora (evento de auditoria
 * "Duplicidade conferida" que lista os pagamentos comparados). O servidor refaz a busca com os pagamentos REAIS e recusa o lançamento sem a conferência
 * que cobre todos eles, com a frase do front. A "decisão" é um clique local da operadora (nunca token do servidor): vale o evento que ela deixou no registro.
 */

const L = require('./pagamentos-livro');
const Lc = require('./pagamentos-lancamento');

const { erro } = L;
const JANELA_MS = 15 * 60000;
const MSG_DUPLICIDADE = 'Há um pagamento recente com o mesmo valor. Confira se já foi lançado ou confirme que é outro pagamento.';

const centavosDoValor = (v) => { const a = typeof v === 'string' ? Lc.lerDinheiro(v) : v; const r = Math.round(a * 100); return Number.isFinite(a) && a > 0 && Number.isSafeInteger(r) ? r : null; };

/** `findPaymentDuplicateCandidates(payments, { clientId, amount }, now, excludeId)`. */
function candidatosDeDuplicidade(pagamentos, rascunho, agora, excetoId) {
  const em = typeof agora === 'number' ? agora : Date.parse(agora); const valor = centavosDoValor(rascunho.amount); const cliente = String(rascunho.clientId || '').trim();
  if (!cliente || valor === null || !Number.isFinite(em)) return [];
  return pagamentos.filter((p) => {
    if (p.id === excetoId || p.clientId !== cliente || p.status === 'Cancelado' || centavosDoValor(p.amount) !== valor) return false;
    const idade = em - Date.parse(p.informedAt);
    return Number.isFinite(idade) && idade >= 0 && idade <= JANELA_MS;
  }).sort((a, b) => Date.parse(b.informedAt) - Date.parse(a.informedAt) || a.id.localeCompare(b.id));
}

const PREFIXO = 'Outro recebimento confirmado após comparar os pagamentos ';
/** O evento "Duplicidade conferida" que o front acrescenta (`recordPaymentDuplicateReview`), ou `undefined`. */
const eventoDeDuplicidade = (p) => (p.audit || []).find((e) => e.action === 'Duplicidade conferida');
/** Ids que a operadora conferiu (do texto do evento do front). */
function idsConferidos(evento) {
  const m = typeof evento.detail === 'string' && evento.detail.startsWith(PREFIXO) ? /^Outro recebimento confirmado após comparar os pagamentos (.*)\. Conferência em (\S+)\.$/.exec(evento.detail) : null;
  return m ? { ids: m[1].split(', '), em: m[2] } : null;
}

/** Recusa se há candidatos que a conferência do registro não cobre. `p` = o lançamento novo (do navegador). */
function conferirDuplicidade(p, pagamentos, agora) {
  const candidatos = candidatosDeDuplicidade(pagamentos, { clientId: p.clientId, amount: p.amount }, agora, p.id);
  if (!candidatos.length) return;
  const evento = eventoDeDuplicidade(p); const conferido = evento && idsConferidos(evento);
  if (!conferido || !Number.isFinite(Date.parse(conferido.em)) || Date.parse(conferido.em) > Date.parse(agora)) erro(MSG_DUPLICIDADE);
  const lista = new Set(conferido.ids);
  if (candidatos.some((c) => !lista.has(c.id))) erro(MSG_DUPLICIDADE);
}

module.exports = { JANELA_MS, MSG_DUPLICIDADE, candidatosDeDuplicidade, eventoDeDuplicidade, idsConferidos, conferirDuplicidade };
