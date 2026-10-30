'use strict';

/**
 * Ouro de OCORRÊNCIAS financeiras (Maturacao/42, item 3): `recordFinancialOccurrence`, `updateFinancialOccurrence`, `reconcileFinancialOccurrence`,
 * `settleFinancialOccurrence` e `contactFinancialOccurrence` REAIS do front sobre históricos sorteados (semente fixa), com papéis e entradas
 * boas e ruins. O estado guardado é `{ payments, consultations }`; o esperado é o `payments` que o front devolve (ou a frase da recusa).
 */

const { AGORA, CLIENTE, OUTRA, semente, dia, tentar, limpar, perfil, consulta, BASES, criarBase } = require('./fabrica');

const ATOR = 'Clara';
const PAPEIS = ['administradora', 'assistente', 'administradora', 'assistente', 'administradora', 'assistente', 'administradora', 'assistente', 'administradora', 'assistente', 'administradora', 'assistente', 'administradora', 'assistente', 'administradora', 'assistente', 'supervisora', 'atendente', 'tarologa', 'administradora'];
const MOTIVO = (nature, extra = {}) => ({ id: 'R1', version: 1, scope: 'client', nature, name: 'Motivo de teste', ...extra });

function gerar(fr, quantos = 420) {
  const cenarios = [];
  const F = fr.ocorrencias;
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(9100 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const base = BASES[n % BASES.length];
    let p = criarBase(fr, base);
    const recibo2 = criarBase(fr, BASES[(n + 1) % BASES.length], CLIENTE, 'PG-segundo', dia(1));
    const outra = criarBase(fr, BASES[0], OUTRA, 'PG-outra', dia(1));
    const k1 = consulta({ id: 'K1', durationSeconds: pick([1200, 1800, 900]), dia: 3, billing: { minimumMinutes: 15 }, ...(r() < 0.5 ? {} : {}) });
    k1.minuteValue = 2.96;
    const consultas = r() < 0.85 ? [k1, consulta({ id: 'K9', clientId: OUTRA, durationSeconds: 900, dia: 3 })] : [];
    let estado = { payments: [p, recibo2, outra], consultations: consultas };
    const registrar = (tipo, funcao, entrada, papel, em = AGORA) => {
      const completa = { ...entrada, expectedPaymentVersion: F.financialPaymentVersion(estado.payments.find((x) => x.id === entrada.paymentId) || p), ...(entrada.expectedConsultationVersion === 'auto' ? { expectedConsultationVersion: consultas[0] ? F.financialConsultationVersion(consultas[0]) : '' } : {}) };
      const res = tentar(() => funcao(estado, completa, ATOR, papel, em));
      // A concorrência (versão esperada do pagamento e da consulta) é do servidor (`expectedVersion`, 409): fora do ouro.
      if (res.erro && /^(A consulta mudou|Este pagamento foi atualizado)/.test(res.erro)) return res;
      cenarios.push({ tipo, estado: limpar(estado), entrada: limpar(completa), ator: ATOR, papel, em, esperado: res.ok ? { ok: limpar(res.ok.payments) } : { erro: res.erro } });
      if (res.ok && res.ok !== estado) estado = res.ok;
      return res;
    };
    const passos = 2 + Math.floor(r() * 5);
    let seq = 0;
    for (let i = 0; i < passos; i += 1) {
      const papel = pick(PAPEIS);
      const pagamento = estado.payments.find((x) => x.id === p.id);
      const casos = pagamento.financialOccurrences || [];
      const alvo = casos.length ? pick(casos) : undefined;
      const escolha = alvo && r() < 0.7 ? pick(['atualizar', 'atualizar', 'reconciliar', 'regularizar', 'contatar', 'contatar']) : 'registrar';
      const op = `OPE-${n}-${seq += 1}`;
      const nota = pick(['Cliente pediu devolução.', 'Cliente pediu devolução.', 'Conferido com o banco.', 'Conferido com o banco.', 'Cliente pediu devolução.', 'Conferido com o banco.', 'Cliente pediu devolução.', '', 'x'.repeat(4001)]);
      if (escolha === 'registrar') {
        const kind = pick(['refund', 'refund', 'refund', 'client-refund', 'dispute-pix', 'dispute-card', 'scheduled-unpaid', 'payment-missing']);
        const falha = r() < 0.4;
        const valor = pick([10, 20, 30, 44.4, 50, 20, 10, 30]);
        const remanescente = kind === 'refund' && r() < 0.4;
        const entrada = {
          id: `OC-${n}-${seq}`, operationId: op, paymentId: p.id, kind, amount: valor, note: nota === '' || nota.length > 100 ? 'Cliente pediu devolução.' : nota, initiatedBy: pick(['company', 'client', 'bank', 'unknown']),
          agreement: pick(['pending', 'agreed', 'disagreed']), chargeDecision: pick(['pending', 'maintain', 'pending', 'waive']), bankMoved: kind === 'scheduled-unpaid' || kind === 'payment-missing' ? false : true,
        };
        if (kind === 'dispute-pix') entrada.kind = p.method === 'PIX' ? 'dispute-pix' : 'dispute-card';
        if (kind === 'dispute-card') entrada.kind = p.method === 'Cartão de crédito' ? 'dispute-card' : 'dispute-pix';
        if (remanescente) { entrada.refundSource = 'remaining'; entrada.creditProfile = perfil(CLIENTE, { credit: pick([0, 0, 44.4]) }); if (r() < 0.5) entrada.bankAmount = pick([valor, valor * 0.9]); }
        else if (r() < 0.2) entrada.refundSource = 'bank';
        if (r() < 0.5) entrada.consultationId = 'K1';
        if (entrada.chargeDecision === 'waive' && consultas.length) { entrada.consultationId = 'K1'; entrada.waiverAmount = pick([10, 30, 59.2]); entrada.expectedConsultationVersion = 'auto'; }
        if (r() < 0.3) entrada.reasonSnapshot = MOTIVO(entrada.kind);
        if (r() < 0.3) entrada.occurredAt = dia(5);
        if (falha) {
          const f = Math.floor(r() * 16);
          if (f === 0) entrada.amount = pick([0, -1, 1000]); if (f === 1) entrada.note = pick(['', 'x'.repeat(4001)]); if (f === 2) entrada.initiatedBy = 'inv'; if (f === 3) entrada.consultationId = pick(['K9', 'ZZ']);
          if (f === 4) entrada.reasonSnapshot = pick([MOTIVO('refund'), MOTIVO(entrada.kind, { id: 'other', name: 'Outros' }), { ...MOTIVO(entrada.kind), version: 0 }, MOTIVO(entrada.kind, { statementText: '{x}' })]);
          if (f === 5) entrada.kind = entrada.kind === 'dispute-pix' ? 'dispute-card' : 'dispute-pix'; if (f === 6) entrada.refundSource = pick(['x', 'remaining']); if (f === 7) entrada.bankMoved = !entrada.bankMoved;
          if (f === 8) entrada.creditProfile = perfil(OUTRA, {}); if (f === 9) entrada.waiverAmount = pick([10, 500]); if (f === 10) { entrada.chargeDecision = 'waive'; delete entrada.waiverAmount; }
          if (f === 11) entrada.occurredAt = 'ontem'; if (f === 12) entrada.id = 'a'; if (f === 13) entrada.paymentId = 'PG-nada'; if (f === 14) entrada.kind = 'zzz'; if (f === 15) entrada.agreement = 'zz';
        }
        if (r() < 0.2) { entrada.agendaItemId = 'AG-1'; }
        registrar('registrar', F.recordFinancialOccurrence, entrada, papel);
      } else if (escolha === 'atualizar') {
        const entrada = { operationId: op, paymentId: p.id, occurrenceId: alvo.id, note: nota, ...(r() < 0.6 ? { agreement: pick(['pending', 'agreed', 'disagreed', 'zz']) } : {}), ...(r() < 0.6 ? { chargeDecision: pick(['pending', 'maintain', 'waive']) } : {}) };
        if (r() < 0.5) entrada.action = pick(['review', 'withdraw', 'bank-accepted', 'bank-rejected', 'bank-rejected', 'x']);
        if (entrada.action && entrada.action !== 'review') { entrada.amount = pick([undefined, 10, 20, 500, 30]); entrada.bankMoved = r() < 0.7; }
        if (r() < 0.2) entrada.kind = pick(['scheduled-unpaid', 'payment-missing', 'refund']);
        if (r() < 0.3) { entrada.consultationId = pick(['K1', 'K9']); }
        if (r() < 0.4 && consultas.length) { entrada.waiverAmount = pick([10, 59.2, 500]); entrada.expectedConsultationVersion = 'auto'; }
        registrar('atualizar', F.updateFinancialOccurrence, entrada, papel);
      } else if (escolha === 'reconciliar') {
        registrar('reconciliar', F.reconcileFinancialOccurrence, { operationId: op, paymentId: p.id, occurrenceId: alvo.id, amount: pick([10, 20, 30, 50, 5]), note: nota, ...(r() < 0.4 ? { occurredAt: pick([dia(6), dia(7), 'x']) } : {}) }, papel);
      } else if (escolha === 'regularizar') {
        registrar('regularizar', F.settleFinancialOccurrence, { operationId: op, paymentId: p.id, occurrenceId: alvo.id, settlementPaymentId: pick(['PG-segundo', 'PG-outra', p.id, 'PG-nada']), amount: pick([10, 20, 44.4, 5]), note: nota, creditProfile: perfil(CLIENTE, { credit: 0 }) }, papel);
      } else {
        registrar('contatar', F.contactFinancialOccurrence, { operationId: op, paymentId: p.id, occurrenceId: alvo.id, channel: pick(['WhatsApp', 'Telefone', '']), note: nota }, papel);
      }
      // O mesmo comando repetido (idempotência) e com outra assinatura.
      if (r() < 0.12 && cenarios.length) {
        const ultimo = cenarios[cenarios.length - 1];
        if (ultimo.esperado.ok) {
          const fn = { registrar: F.recordFinancialOccurrence, atualizar: F.updateFinancialOccurrence, reconciliar: F.reconcileFinancialOccurrence, regularizar: F.settleFinancialOccurrence, contatar: F.contactFinancialOccurrence }[ultimo.tipo];
          const entrada = ultimo.entrada; const alterada = { ...entrada, note: `${entrada.note} (outra)` };
          for (const e of [entrada, alterada]) {
            const res = tentar(() => fn(estado, e, ATOR, ultimo.papel, AGORA));
            cenarios.push({ tipo: ultimo.tipo, estado: limpar(estado), entrada: limpar(e), ator: ATOR, papel: ultimo.papel, em: AGORA, esperado: res.ok ? { ok: limpar(res.ok.payments) } : { erro: res.erro } });
          }
        }
      }
    }
  }
  return cenarios;
}

module.exports = { gerar };
