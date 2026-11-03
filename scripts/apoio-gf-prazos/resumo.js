'use strict';

/** O formato que o gerador do ouro dos prazos grava e o verificador reproduz (Maturacao/56 grupo D): IGUAL nos dois. `fns` = o front (gerador) ou o domínio portado (verificador). */
const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const tentar = (fn) => { try { return J(fn()); } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

function resumirEspera(fns, entrada, itemId, perfil) {
  const item = entrada.agenda.find((a) => a.id === itemId); const now = entrada.now; const date = entrada.date; const p = perfil || undefined;
  const wait = tentar(() => fns.esperaComum(item, entrada, p));
  const funded = tentar(() => fns.financiado(item, entrada, p));
  const w = wait.erro ? undefined : fns.esperaComum(item, entrada, p); const f = typeof funded === 'boolean' ? funded : false;
  const relogio = (extra) => tentar(() => fns.relogioDeContato({ item, date, funded: f, wait: w, ...extra }));
  const r = {
    wait, funded,
    prazoPedido: tentar(() => fns.prazoPedido(item, now, entrada, p)),
    relogio: relogio({}), relogioSemPagamento: relogio({ hidePaymentClock: true }), relogioComplemento: relogio({ completing: true }),
    relogioComClock: relogio({ clock: { tag: 'Avisada', startedAt: now - 7 * 60000 } }), relogioComClockPagar: relogio({ clock: { tag: 'Vai pagar', startedAt: now - 11 * 60000 } }),
    prontaEm: tentar(() => fns.inicioDoPodeAgora(item, date)),
    alertaPronta: tentar(() => fns.alertaDeProntaEsperando({ item, date, funded: f, now })),
    alertaContato: tentar(() => fns.alertaDeContatoEsperando({ item, date, funded: f, wait: w, now })),
    revisaoExpirada: tentar(() => fns.prazoDeEsperaExpirado(item, entrada, p, undefined)),
    revisaoAtencao: tentar(() => fns.esperaPrecisaDeAtencao(item, entrada, p, undefined)),
    revisaoExpiradaComEspera: tentar(() => fns.prazoDeEsperaExpirado(item, entrada, p, w)),
    revisaoAtencaoComEspera: tentar(() => fns.esperaPrecisaDeAtencao(item, entrada, p, w)),
  };
  if (item.continuationRequest) {
    const origem = entrada.consultations.find((c) => c.id === item.continuationRequest.sourceConsultationId);
    r.maisTempo = origem ? tentar(() => fns.esperaDoMaisTempo(origem, item, entrada.consultations, entrada.payments, now, p)) : null;
  }
  return r;
}

function resumirTurno(fns, caso) { return tentar(() => fns.fimDoTurno(caso.perfil, caso.overrides, caso.date, caso.now)); }

module.exports = { resumirEspera, resumirTurno, J };
