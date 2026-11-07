'use strict';

/**
 * Painel, pagamentos sem agenda e acompanhamento de pagamento (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front:
 * `painel/panel-flow-model.ts:208-251` (`unassignedPayments`), `painel/payment-service-follow-up.ts` (`paymentContactState`,
 * `markUnassignedPaymentsAsked`, `resumeUnassignedPayments`), `domain/payment-dates.ts` (`knownPaymentPaidAt`, `paymentPaidAt`) e
 * `finance/cash-ledger.ts:35` (`paymentConsultationValue`). Saldo e lotes: `financeiro-saldo.js` (`contaDaCliente`, `tarifaDeCredito`), já portados.
 * Relógio injetado; ids de evento vêm de `novoId`. `followPaymentLater` do front não tem chamador na tela (não portado: código morto).
 */

const { randomUUID } = require('crypto');
const s = require('./financeiro-saldo');
const { valorDoMinuto, PRECOS_PADRAO, contaMinutos } = require('./financeiro-base');
const { diaOperacionalDe, somarDia, hojeDe } = require('./painel-tempo');
const { compararPtBR } = require('./colacao-ptbr');

const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** `validatePaymentDate` sem lançar: texto inválido vira `undefined` (como `validKnownDate`). */
function dataConhecida(valor) {
  if (!valor) return undefined;
  if (DATA.test(valor)) { const d = new Date(`${valor}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === valor ? valor : undefined; }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(valor) || !Number.isFinite(new Date(valor).getTime())) return undefined;
  const [ano, mes, dia] = valor.slice(0, 10).split('-').map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return undefined;
  return valor;
}
/** `knownPaymentPaidAt`. */
function pagoEmConhecido(p) { const v = dataConhecida(p.paidAt); return v && DATA.test(v) ? `${v}T06:00:00-03:00` : v; }
/** `paymentPaidAt`. */
const pagoEm = (p) => { const v = p.paidAt || p.informedAt; return DATA.test(v) ? `${v}T06:00:00-03:00` : v; };
/** `recordOperationDate` sem demonstração. */
const diaDoRegistro = (instante) => (Number.isFinite(Date.parse(instante)) ? diaOperacionalDe(Date.parse(instante)) : '');

const confirmado = s.recebimentoConfirmado;
const valorDaConsulta = (p) => p.unidentified ? 0 : Math.max(0, s.arredondar(p.amount + (p.movements || []).reduce((t, m) => t + (m.kind === 'balance-transfer' ? s.efeitoDaTransferencia(m, p.clientId) : m.creditEffect), 0)));

/** `paymentContactState`. */
function contatoDoPagamento(p, data) {
  const follow = p.serviceFollowUp && p.serviceFollowUp.events.at(-1);
  const chave = follow ? follow.id || `${follow.action}:${follow.at}:${follow.actor}:${follow.reviewOn || ''}` : 'initial';
  const base = { attemptKey: chave, follow, deferred: Boolean(follow && follow.action === 'later' && follow.reviewOn && follow.reviewOn > data) };
  const perguntou = follow && follow.action === 'asked' ? Date.parse(follow.at) : NaN;
  return !Number.isFinite(perguntou) || perguntou > Number.MAX_SAFE_INTEGER ? { ...base, state: 'unasked' } : { ...base, state: 'asked', askedAt: follow.at };
}
/** `paymentContactState` com o relógio: perguntado no futuro ainda é "unasked". */
const contato = (p, data, agora) => { const c = contatoDoPagamento(p, data); return c.state === 'asked' && Date.parse(c.askedAt) > agora ? { ...c, state: 'unasked', askedAt: undefined } : c; };

/** `unassignedPayments`: `perfis` = `{ [clientId]: ClientProfile }`, `cadastros` = `{ [clientId]: { createdAt } }`. */
function pagamentosSemAgenda(pagamentos, consultas, agenda, perfis, cadastros, data, agora, preco = PRECOS_PADRAO, datasDoRecibo) {
  const comAgenda = new Set(agenda.filter((i) => !require('./agenda-contato').encerrado(i)).map((i) => i.clientId));
  const emCurso = new Set(consultas.filter((i) => i.status === 'Em curso' && !i.tarologistFinishReport).map((i) => i.clientId));
  // v706: as datas de recibo escolhidas só FILTRAM a lista; cobertura e contato seguem o dia real e a conta completa da cliente.
  const grupos = new Map(); const datas = new Set(datasDoRecibo ?? [data, somarDia(data, -1)]);
  pagamentos.filter((p) => { const em = pagoEmConhecido(p); const dia = em ? diaDoRegistro(em) : ''; return Boolean(em && datas.has(dia) && confirmado(p) && !comAgenda.has(p.clientId) && !emCurso.has(p.clientId)); })
    .forEach((p) => grupos.set(p.clientId, [...(grupos.get(p.clientId) || []), p]));
  return [...grupos].flatMap(([clientId, linhas0]) => {
    let linhas = linhas0; const perfil = perfis[clientId];
    if (s.contaDaCliente(clientId, pagamentos, consultas, (perfil && perfil.credit) ?? 0).balance <= 0) return [];
    const credito = s.tarifaDeCredito(clientId, new Date(agora).toISOString(), undefined, consultas, pagamentos, perfil);
    const minutos = credito.availableLots.reduce((t, l) => t + (l.minutesKnown ? l.minutes : l.cents / 100 / valorDoMinuto(preco)), 0);
    if (minutos + 0.000001 < preco.minimumMinutes) return [];
    const restante = new Map();
    for (const l of credito.availableLots) if (l.paymentId) restante.set(l.paymentId, (restante.get(l.paymentId) ?? 0) + l.cents);
    linhas = linhas.filter((l) => (restante.get(l.id) ?? 0) > 0); if (!linhas.length) return [];
    const criado = Date.parse((cadastros[clientId] && cadastros[clientId].createdAt) ?? '');
    const recente = Number.isFinite(criado) && criado <= agora && agora - criado <= 7 * 86400000;
    const primeira = !(perfil && perfil.hasPriorConsultations) && !(perfil && perfil.firstConsultationAt) && !(perfil && perfil.movements.some((i) => i.kind === 'consulta')) && !consultas.some((i) => i.clientId === clientId && contaMinutos(i.status));
    const tentativas = new Map();
    for (const p of linhas) {
      const dia = diaDoRegistro(pagoEmConhecido(p)); const c = contato(p, data, agora); const chave = JSON.stringify([clientId, dia, c.state, c.deferred, c.attemptKey]);
      const g = tentativas.get(chave); if (g) g.payments.push(p); else tentativas.set(chave, { contact: c, paymentDate: dia, payments: [p] });
    }
    return [...tentativas].map(([chave, g]) => {
      const ordenados = [...g.payments].sort((p, z) => (Date.parse(pagoEm(p)) - Date.parse(pagoEm(z))) || compararPtBR(p.id, z.id));
      return { key: chave, clientId, client: (perfil && perfil.name) ?? linhas[0].client, payments: ordenados, paymentDate: g.paymentDate, ...g.contact,
        amount: ordenados.reduce((t, r) => t + (restante.get(r.id) ?? 0), 0) / 100, paidAmount: ordenados.reduce((t, r) => t + Math.round(r.amount * 100), 0) / 100,
        remainingAmounts: Object.fromEntries(ordenados.map((r) => [r.id, (restante.get(r.id) ?? 0) / 100])), recent: recente, first: primeira };
    });
  }).sort((p, z) => (Number(p.deferred) - Number(z.deferred)) || (Number(z.recent && z.first) - Number(p.recent && p.first)) || (Date.parse(pagoEm(p.payments[0])) - Date.parse(pagoEm(z.payments[0]))) || compararPtBR(p.key, z.key));
}

class RegraDePagamentoError extends Error { constructor(m) { super(m); this.name = 'RegraDePagamentoError'; } }

/** `changePaymentContact`: `acao` = 'asked' ou 'resume'. */
function mudarContato(pagamentos, ids, ator, agora, acao, novoId = randomUUID) {
  if (!`${ator}`.trim() || !Number.isFinite(agora)) throw new RegraDePagamentoError('Não foi possível identificar quem registrou o contato e seu horário.');
  const escolhidos = new Set(ids);
  const elegiveis = pagamentos.filter((p) => escolhidos.has(p.id) && confirmado(p) && valorDaConsulta(p) > 0);
  if (!elegiveis.length) throw new RegraDePagamentoError('Estes pagamentos não estão mais disponíveis para acompanhamento.');
  const mudaveis = new Set(elegiveis.filter((p) => { const c = contato(p, hojeDe(agora), agora); return acao === 'asked' ? c.state === 'unasked' && !c.deferred : c.deferred; }).map((p) => p.id));
  if (!mudaveis.size) return pagamentos;
  const evento = { id: novoId(), action: acao, at: new Date(agora).toISOString(), actor: `${ator}`.trim(),
    reason: acao === 'asked' ? 'Perguntamos se a cliente gostaria de agendar sua consulta.' : 'Acompanhamento retomado. Falta perguntar se a cliente gostaria de agendar sua consulta.' };
  return pagamentos.map((p) => (mudaveis.has(p.id) ? { ...p, serviceFollowUp: { events: [...((p.serviceFollowUp && p.serviceFollowUp.events) || []), evento] } } : p));
}
const marcarPerguntado = (pagamentos, ids, ator, agora, novoId) => mudarContato(pagamentos, ids, ator, agora, 'asked', novoId);
const retomarAcompanhamento = (pagamentos, ids, ator, agora, novoId) => mudarContato(pagamentos, ids, ator, agora, 'resume', novoId);

/** `followPaymentLater` (panel-flow-model.ts:296; sem chamador na tela, porte completo da função). */
function adiarAcompanhamento(pagamentos, ids, revisarEm, motivo, ator, agora, retomar = false) {
  const hoje = hojeDe(agora);
  if (!`${motivo}`.trim()) throw new RegraDePagamentoError('Registre o que a cliente combinou.');
  if (!retomar && (!DATA.test(revisarEm) || revisarEm <= hoje || !Number.isFinite(Date.parse(revisarEm)))) throw new RegraDePagamentoError('Escolha uma data futura para voltar a acompanhar.');
  return pagamentos.map((p) => (ids.includes(p.id) ? { ...p, serviceFollowUp: { events: [...((p.serviceFollowUp && p.serviceFollowUp.events) || []), { action: retomar ? 'resume' : 'later', reviewOn: retomar ? undefined : revisarEm, reason: `${motivo}`.trim(), actor: ator, at: new Date(agora).toISOString() }] } } : p));
}

/**
 * Conferência da REVISÃO de um pagamento (`POST /payments/:id/revise`): o campo `serviceFollowUp` é do servidor. O navegador só pode ACRESCENTAR
 * um evento (asked, resume ou later) ao que já está gravado; o servidor refaz a transição com as regras do front (`mudarContato`/`adiarAcompanhamento`),
 * com o ator e o instante DELE, e mantém o `id` do evento enviado. Transição sem efeito (já perguntado, sem acompanhamento adiado) não grava nada.
 * Alterar ou apagar história é recusado (422). Devolve o `serviceFollowUp` a gravar (ou undefined).
 */
/** JSON canônico (chaves ordenadas): o jsonb do Postgres reordena as chaves. */
const canonico = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((c) => [c, x[c]])) : x));

function conferirAcompanhamento(antes, pedido, ator, agora, novoId = randomUUID) {
  const gravados = (antes.serviceFollowUp && antes.serviceFollowUp.events) || []; const enviados = (pedido.serviceFollowUp && pedido.serviceFollowUp.events) || [];
  if (canonico(gravados) === canonico(enviados)) return antes.serviceFollowUp;
  if (enviados.length !== gravados.length + 1 || canonico(enviados.slice(0, gravados.length)) !== canonico(gravados)) throw new RegraDePagamentoError('O acompanhamento do pagamento mudou. Confira a situação atual antes de continuar.');
  const novo = enviados[enviados.length - 1];
  if (!novo || !['asked', 'resume', 'later'].includes(novo.action)) throw new RegraDePagamentoError('Não foi possível registrar o contato.');
  const id = typeof novo.id === 'string' && novo.id ? novo.id : novoId();
  const depois = novo.action === 'later' ? adiarAcompanhamento([antes], [antes.id], novo.reviewOn, novo.reason, ator, agora, false)[0]
    : mudarContato([antes], [antes.id], ator, agora, novo.action, () => id)[0];
  const eventos = depois.serviceFollowUp && depois.serviceFollowUp.events;
  if (!eventos || eventos.length === gravados.length) return antes.serviceFollowUp;
  const ultimo = { ...eventos[eventos.length - 1], ...(novo.action === 'later' ? { id } : {}) };
  return { events: [...gravados, ultimo] };
}

module.exports = { RegraDePagamentoError, dataConhecida, pagoEmConhecido, pagoEm, diaDoRegistro, valorDaConsulta, contatoDoPagamento, contato, pagamentosSemAgenda, mudarContato, marcarPerguntado, retomarAcompanhamento, adiarAcompanhamento, conferirAcompanhamento };
