'use strict';

/** Execução de um caso no harness (Maturacao/56 D3): monta o estado do React do caso, roda a função REAL do componente e normaliza o que ela gravou. */

const clonar = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

function relogioFixo(DateReal, iso) {
  const fixo = DateReal.parse(iso);
  return class DataFixa extends DateReal {
    constructor(...a) { if (a.length === 0) super(fixo); else super(...a); }
    static now() { return fixo; }
  };
}
/** Os ids dos eventos de auditoria do front trazem Date.now e Math.random: o que vale é o resto do registro. */
function normalizar(consulta) {
  if (!consulta) return consulta;
  const c = clonar(consulta); if (c.audit) c.audit = c.audit.map((e) => (String(e.id).startsWith('audit-') ? { ...e, id: 'audit-*' } : e));
  return c;
}
const aplicar = (atual, u) => (typeof u === 'function' ? u(atual) : u);

function preparar(h, estado, DateReal, c) {
  globalThis.Date = relogioFixo(DateReal, c.agora);
  h.limpar();
  const consultations = clonar(c.consultas); const payments = clonar(c.pagamentos); const agenda = clonar(c.agenda || []);
  const vivo = { consultations, payments, agenda }; const toasts = [];
  const alvo = consultations.find((x) => x.id === c.alvoId) || null;
  const ligados = new Map(); payments.filter((p) => p.status !== 'Cancelado' && p.linkedConsultationId).forEach((p) => ligados.set(p.linkedConsultationId, [...(ligados.get(p.linkedConsultationId) || []), p]));
  const clientProfiles = { [c.perfil.clientId]: clonar(c.perfil) };
  estado.valores = {
    operatorName: c.ator, role: c.papel, canFinalize: true, canAnnul: true, canDecideCancellation: ['administradora'].includes(c.papel), consultations, payments, agenda, clientProfiles, dialogsOnly: false, onLaunchClose: undefined, clientId: c.perfil.clientId,
    toast: { error: (m) => toasts.push(m), success: () => {}, info: () => {} }, flushSync: (f) => f(),
    setConsultations: (u) => { vivo.consultations = aplicar(vivo.consultations, u); }, setPayments: (u) => { vivo.payments = aplicar(vivo.payments, u); }, setAgenda: (u) => { vivo.agenda = aplicar(vivo.agenda, u); },
    ...c.estado,
  };
  return { vivo, toasts, alvo, ligados };
}

function executarFinalizar(h, estado, DateReal, c) {
  const { vivo, toasts, alvo, ligados } = preparar(h, estado, DateReal, c);
  Object.assign(estado.valores, { finishTarget: alvo, finishTargetId: alvo && alvo.id, finishPayments: alvo ? ligados.get(alvo.id) || [] : [], linkedPayments: ligados });
  const fixo = DateReal.parse(c.agora); let retorno; let erroInterno = null;
  try { retorno = h.compilar('finishConsultation')(fixo); } catch (e) { erroInterno = e instanceof Error ? e.message : String(e); }
  const campos = clonar(h.compilar('validateFinishFields')(fixo));
  // início que o componente usa (função REAL): igual ao gravado quando o horário não mudou
  const hora = estado.valores.finishStartTime; let inicio = null;
  if (alvo && hora && h.escopo.clockMinutes(hora) !== null) inicio = hora === h.escopo.formatTime(alvo.startedAt) ? alvo.startedAt : h.escopo.consultationTimestampAt(alvo.startedAt, hora);
  const depois = vivo.consultations.find((x) => x.id === c.alvoId);
  const mudou = alvo && JSON.stringify(depois) !== JSON.stringify(alvo);
  const r = { retorno: retorno === undefined ? null : retorno, toast: toasts[0] || null, campos, inicio, tentativas: h.gravacoes.filter((g) => g.nome === 'setFinishValidationAttempt').length,
    consulta: mudou ? normalizar(depois) : null, pagamentos: JSON.stringify(vivo.payments) === JSON.stringify(c.pagamentos) ? null : clonar(vivo.payments), agenda: JSON.stringify(vivo.agenda) === JSON.stringify(c.agenda || []) ? null : clonar(vivo.agenda),
    efeitos: h.gravacoes.map((g) => g.nome).filter((n) => !/^setFinishValidation|^setFinishedConfirmationId$/.test(n)) };
  if (erroInterno) r.erroInterno = erroInterno;
  globalThis.Date = DateReal; return r;
}

function executarAnular(h, estado, DateReal, c) {
  const { vivo, toasts, alvo } = preparar(h, estado, DateReal, c);
  Object.assign(estado.valores, { annulTarget: c.estado.annulTargetPresente === false ? null : alvo, annulTargetId: alvo && alvo.id });
  let retorno; let erroInterno = null;
  try { retorno = h.compilar('confirmAnnul')(); } catch (e) { erroInterno = e instanceof Error ? e.message : String(e); }
  const depois = vivo.consultations.find((x) => x.id === c.alvoId);
  const mudou = alvo && JSON.stringify(depois) !== JSON.stringify(alvo);
  const r = { retorno: retorno === undefined ? null : retorno, toast: toasts[0] || null, consulta: mudou ? normalizar(depois) : null, pagamentos: JSON.stringify(vivo.payments) === JSON.stringify(c.pagamentos) ? null : clonar(vivo.payments),
    agenda: JSON.stringify(vivo.agenda) === JSON.stringify(c.agenda || []) ? null : clonar(vivo.agenda), efeitos: h.gravacoes.map((g) => g.nome) };
  if (erroInterno) r.erroInterno = erroInterno;
  globalThis.Date = DateReal; return r;
}

module.exports = { executarFinalizar, executarAnular, normalizar, clonar };
