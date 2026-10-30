'use strict';

/**
 * Ouro de DUPLICIDADE de pagamento (Maturacao/42, item 4): `assertPaymentDuplicateReview`, `approvePaymentDuplicateReview` e
 * `recordPaymentDuplicateReview` REAIS do front (`payment-duplicate-model.ts`). O registro que o navegador manda é o que o front produz
 * (`createPaymentRecord` + `recordPaymentDuplicateReview`); o servidor tem de aceitar quando o front aceita e recusar com a MESMA frase quando recusa.
 */

const { CLIENTE, OUTRA, semente, tentar, limpar, BASES, criarBase } = require('./fabrica');

const AGORA = '2026-10-30T15:00:00.000Z';
const antes = (min) => new Date(Date.parse(AGORA) - min * 60000).toISOString();

function gerar(fr, quantos = 500) {
  const cenarios = [];
  const D = fr.duplicidade;
  const padrao = fr.precos.defaultFinancialSettings;
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(41000 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const base = BASES[n % 3];
    const valorTexto = base.entrada.amount;
    const existentes = [];
    for (let i = 0; i < Math.floor(r() * 4); i += 1) {
      const outra = pick([base, BASES[(n + 1) % BASES.length], BASES[3]]);
      let p = criarBase(fr, outra, pick([CLIENTE, CLIENTE, CLIENTE, OUTRA]), `PG-EX-${n}-${i}`, pick([antes(1), antes(5), antes(14.9), antes(15.1), antes(30), antes(-5), antes(0)]));
      if (r() < 0.2) p = { ...p, status: 'Cancelado' };
      existentes.push(p);
    }
    const entrada = { ...base.entrada, amount: valorTexto, paidAt: undefined };
    const rascunho = { ...entrada, clientId: CLIENTE };
    const revisao = tentar(() => D.reviewPaymentDuplicates(existentes, rascunho, AGORA));
    let decisao;
    if (revisao.ok && revisao.ok.candidates.length && r() < 0.7) decisao = tentar(() => D.approvePaymentDuplicateReview(revisao.ok, 'Khloe', pick([AGORA, antes(1)]))).ok;
    if (decisao && r() < 0.25) decisao = { ...decisao, paymentIds: [...decisao.paymentIds, 'PG-OUTRO'] };
    const pricing = padrao;
    const criado = criarBase(fr, { ...base, entrada: { ...base.entrada } }, CLIENTE, `PG-NOVO-${n}`, AGORA);
    const afirmar = tentar(() => D.assertPaymentDuplicateReview(existentes, rascunho, AGORA, decisao));
    let registro = criado;
    if (afirmar.ok) { const rr = tentar(() => D.recordPaymentDuplicateReview(criado, afirmar.ok, decisao, 'Khloe', AGORA)); if (rr.ok) registro = rr.ok; }
    cenarios.push({ tipo: 'duplicidade', existentes: limpar(existentes), registro: limpar(registro), agora: AGORA, esperado: afirmar.ok ? { ok: true } : { erro: afirmar.erro } });
  }
  return cenarios;
}

module.exports = { gerar };
