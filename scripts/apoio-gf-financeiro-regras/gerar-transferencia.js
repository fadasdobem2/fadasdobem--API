'use strict';

/**
 * Ouro de TRANSFERÊNCIA DE SALDO (Maturacao/42, item 3): `transferClientBalance` e `transferableBalance` REAIS do front
 * (`balance-transfer-model.ts`) sobre estados sorteados: compras regulares e sem preço, consulta em curso que reserva saldo, estorno parcial,
 * transferência e reversão, papéis, clientes desconhecidas e valores ruins.
 */

const { AGORA, CLIENTE, OUTRA, NOME, semente, dia, tentar, limpar, perfil, consulta, BASES, criarBase } = require('./fabrica');

const TERCEIRA = '900300';
const NOMES = { ...NOME, [TERCEIRA]: 'Cora Dias' };

function gerar(fr, quantos = 260) {
  const cenarios = [];
  const T = fr.transferencia;
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(11500 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const pagamentos = [];
    for (let i = 0; i < 1 + Math.floor(r() * 3); i += 1) {
      const base = pick(BASES);
      let p = criarBase(fr, base, CLIENTE, `PG-${n}-${i}`, dia(i));
      if (r() < 0.15) p = { ...p, confirmation: 'A confirmar' };
      if (r() < 0.2) {
        const m = tentar(() => fr.livro.recordPaymentMovement(p, { kind: 'refund', amount: pick([10, 20]), bankMoved: true, note: 'Estorno', occurredAt: dia(4) }, 'Clara', `MV-${n}-${i}`, AGORA));
        if (m.ok) p = m.ok;
      }
      pagamentos.push(p);
    }
    if (r() < 0.3) pagamentos.push(criarBase(fr, BASES[0], OUTRA, `PG-${n}-o`, dia(1)));
    const consultas = [];
    if (r() < 0.5) consultas.push(consulta({ id: `K-${n}`, status: pick(['Concluída', 'Em curso']), durationSeconds: pick([900, 1800]), dia: 3, minuteValue: 2.96 }));
    let estado = { payments: pagamentos, consultations: consultas };
    const perfis = { [CLIENTE]: perfil(CLIENTE, { credit: pick([0, 0, 0, 30, -20]) }), [OUTRA]: perfil(OUTRA, {}), [TERCEIRA]: perfil(TERCEIRA, {}) };
    const passos = 1 + Math.floor(r() * 4);
    let ultimaOk;
    for (let i = 0; i < passos; i += 1) {
      const reversao = ultimaOk && r() < 0.35;
      const papel = r() < 0.85 ? pick(['administradora', 'assistente']) : pick(['supervisora', 'atendente', 'tarologa']);
      const entrada = reversao
        ? { id: `TR-${n}-${i}`, sourceClientId: ultimaOk.targetClientId, targetClientId: ultimaOk.sourceClientId, amount: pick([ultimaOk.amount, ultimaOk.amount, ultimaOk.amount / 2]), note: `Reversão da transferência ${ultimaOk.id}.`, reversalOf: pick([ultimaOk.id, ultimaOk.id, 'inexistente']) }
        : { id: `TR-${n}-${i}`, sourceClientId: CLIENTE, targetClientId: pick([OUTRA, OUTRA, OUTRA, TERCEIRA, CLIENTE, '999999']), amount: pick([10, 20, 30, 44.4, 50, 88.8, 100, 5, 0, -3, 1000, 10.555]), note: pick(['Pedido da titular.', 'Pedido da titular.', 'Mudança de conta.', '', 'x'.repeat(4001)]) };
      const contexto = { profiles: perfis, names: pick([NOMES, NOMES, NOMES, { [CLIENTE]: 'Ana Souza' }]), regularMinuteValue: 2.96, actor: pick(['Clara', 'Clara', 'Clara', '']), role: papel, at: pick([AGORA, AGORA, dia(6), 'x']) };
      const antes = estado;
      const res = tentar(() => T.transferClientBalance(estado, entrada, contexto));
      cenarios.push({ tipo: 'transferir', estado: limpar(antes), entrada: limpar(entrada), contexto: limpar(contexto), esperado: res.ok ? { ok: limpar(res.ok.payments) } : { erro: res.erro } });
      if (res.ok && res.ok !== estado) { estado = res.ok; ultimaOk = { ...entrada, amount: entrada.amount }; }
      if (res.ok && res.ok === antes) {
        // repetição idempotente já coberta: repete com outra assinatura
        const outra = tentar(() => T.transferClientBalance(estado, { ...entrada, note: `${entrada.note} (outra)` }, contexto));
        cenarios.push({ tipo: 'transferir', estado: limpar(estado), entrada: limpar({ ...entrada, note: `${entrada.note} (outra)` }), contexto: limpar(contexto), esperado: outra.ok ? { ok: limpar(outra.ok.payments) } : { erro: outra.erro } });
      }
      if (res.ok && res.ok !== antes && r() < 0.2) {
        const rep = tentar(() => T.transferClientBalance(estado, entrada, contexto));
        cenarios.push({ tipo: 'transferir', estado: limpar(estado), entrada: limpar(entrada), contexto: limpar(contexto), esperado: rep.ok ? { ok: limpar(rep.ok.payments) } : { erro: rep.erro } });
      }
    }
    const disponivel = T.transferableBalance(CLIENTE, estado, perfis[CLIENTE], 2.96, AGORA);
    cenarios.push({ tipo: 'disponivel', estado: limpar(estado), clientId: CLIENTE, perfil: perfis[CLIENTE], em: AGORA, esperado: { ok: limpar(disponivel) } });
  }
  return cenarios;
}

module.exports = { gerar };
