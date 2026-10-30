'use strict';

/**
 * Domínio puro comum do ciclo da consulta, porte versionado do front do suspiro (`NovoCodigo/fadasdobemsuspiro--FRONT`):
 *   - `domain/consultation-time-limit.ts` (limite de tempo), `finance/tarologist-commission-policy.ts` (comissão capturada),
 *   - `domain/consultation-active-state.ts` e `tarologas/tarologist-consultation-session.ts` (aberta, ocupação),
 *   - `domain/consultation-pause.ts` (pausas), `domain/input-validation.ts` (nome e observação).
 * Sem banco, sem Express. A prova é o ouro gerado do CÓDIGO REAL do front (`scripts/gerar-ouro-gf-consulta.js`). As mensagens de
 * `RegraConsultaError` são as dos `throw new Error` do front, para a tela mostrar o mesmo texto.
 */

const COMISSAO_PADRAO = 30; // DEFAULT_TAROLOGIST_COMMISSION_RATE (tarologist-commission-policy.ts:3)

class RegraConsultaError extends Error {
  constructor(mensagem) { super(mensagem); this.name = 'RegraConsultaError'; }
}
const erro = (mensagem) => { throw new RegraConsultaError(mensagem); };

const ESTADOS = Object.freeze(['Em curso', 'Finalizada pelo tarólogo', 'Concluída', 'Cancelada', 'Devolvida', 'Não houve', 'Desistiu', 'Anulada', 'Erro']);
/** consultation-status.ts:9-11 */
const PAGAM_REPASSE = new Set(['Concluída', 'Cancelada', 'Desistiu']);
const CONSOMEM_COBERTURA = new Set(['Em curso', 'Finalizada pelo tarólogo', 'Concluída', 'Cancelada', 'Desistiu']);

/** `validateText` (input-validation.ts:34-58) para nome (200, uma linha) e observação (4000, várias linhas). */
function texto(valor, rotulo, { maximo, multilinha = false, obrigatorio = false }) {
  const falha = (m) => erro(`${rotulo}: ${m}`);
  if (typeof valor !== 'string') return falha('informe um texto válido.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(valor)) return falha('há um caractere de controle inválido. Apague e digite novamente o trecho colado.');
  for (const c of valor) { const p = c.codePointAt(0); if (p >= 0xD800 && p <= 0xDFFF) return falha('há um caractere incompleto. Apague e digite novamente o trecho colado.'); }
  if (!multilinha && /[\r\n\t\u2028\u2029]/u.test(valor)) return falha('use uma única linha.');
  const t = valor.trim();
  if (obrigatorio && !t) return falha('preencha este campo.');
  if (Array.from(t).length > maximo) return falha(`use no máximo ${maximo} caracteres. O texto não foi cortado.`);
  return t;
}
const nome = (v, rotulo) => texto(v, rotulo, { maximo: 200, obrigatorio: true });
const observacao = (v, rotulo = 'Observação', obrigatorio = false) => texto(v, rotulo, { maximo: 4000, multilinha: true, obrigatorio });

const minutosValidos = (m) => Number.isSafeInteger(m) && m > 0;

/** `timeLimitFromMinutes` (consultation-time-limit.ts:6). */
function limiteDeMinutos(minutos, perfilPagamento) {
  if (minutosValidos(minutos)) return { kind: 'maximum', minutes: minutos };
  if (perfilPagamento === 'Pós-paga' && minutos === undefined) return { kind: 'free' };
  return erro('Informe o tempo máximo da consulta em minutos. Cliente pré-paga precisa de um limite definido.');
}

/** `consultationTimeLimit` (consultation-time-limit.ts:13): a instrução à taróloga, independente do saldo. */
function limiteDe(item) {
  const l = item.timeLimit;
  if (l && l.kind === 'maximum') return minutosValidos(l.minutes) ? l : { kind: 'unknown' };
  if (l && l.kind === 'free') return item.paymentProfile === 'Pós-paga' ? l : { kind: 'unknown' };
  if (minutosValidos(item.expectedMinutes)) return { kind: 'maximum', minutes: item.expectedMinutes };
  return item.paymentProfile === 'Pós-paga' && item.expectedMinutes === undefined ? { kind: 'free' } : { kind: 'unknown' };
}

/** `commissionRateForProfile` / `commissionRateForNewConsultation` (tarologist-commission-policy.ts:6-20): capturada UMA vez. */
function taxaDoPerfil(taxa) { return typeof taxa === 'number' && Number.isFinite(taxa) && taxa >= 0 && taxa <= 100 ? taxa : COMISSAO_PADRAO; }
function comissaoParaNova(taxaDoTarologo, origem) {
  return origem ? (origem.commissionRate ?? COMISSAO_PADRAO) : taxaDoPerfil(taxaDoTarologo);
}

/** `consultationIsOpen` (consultation-active-state.ts:5): status "Em curso" e sem relato final. */
const emAberto = (item) => item.status === 'Em curso' && !item.tarologistFinishReport;

/** `activeConsultationPause` (consultation-pause.ts:5). */
function pausaAtiva(item) {
  if (item.status !== 'Em curso' || item.tarologistFinishReport) return undefined;
  const ps = item.pauseHistory || [];
  for (let i = ps.length - 1; i >= 0; i -= 1) if (!ps[i].endedAt) return ps[i];
  return undefined;
}

/** `consultationInProgress` (consultation-active-state.ts:10): aberta e (iniciada ou pausada). */
const emAndamento = (item) => emAberto(item) && (!item.awaitingTarologistStart || Boolean(pausaAtiva(item)));

/** `consultationPausedSecondsBetween` (consultation-pause.ts:17): união de intervalos, sem subtrair duas vezes. */
function segundosPausadosEntre(item, de, ate) {
  if (!Number.isFinite(de) || !Number.isFinite(ate) || ate <= de) return 0;
  const intervalos = (item.pauseHistory || []).map((p) => [Math.max(de, Date.parse(p.startedAt)), Math.min(ate, p.endedAt ? Date.parse(p.endedAt) : ate)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((x, y) => x[0] - y[0]);
  let total = 0; let coberto = de;
  for (const [a, b] of intervalos) { total += Math.max(0, b - Math.max(a, coberto)); coberto = Math.max(coberto, b); }
  return total / 1000;
}

/** `consultationEndWithPauses` (consultation-pause.ts:30): o fim real de uma duração, sem virar minuto pago. */
function fimComPausas(item, segundos, agora, inicio = item.startedAt) {
  const start = Date.parse(inicio); const maximo = Date.parse(agora);
  if (!Number.isFinite(start) || !Number.isFinite(maximo) || !Number.isFinite(segundos) || segundos < 0) erro('Não foi possível calcular o horário final da consulta.');
  let cursor = start; let resto = segundos * 1000;
  const ints = (item.pauseHistory || []).map((p) => ({ start: Math.max(start, Date.parse(p.startedAt)), end: Math.min(maximo, p.endedAt ? Date.parse(p.endedAt) : maximo), active: !p.endedAt }))
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start).sort((a, b) => a.start - b.start);
  for (const p of ints) {
    if (p.end <= cursor) continue;
    const atendido = Math.max(0, p.start - cursor);
    if (resto <= atendido) return new Date(Math.min(cursor + resto, maximo)).toISOString();
    resto -= atendido;
    if (p.active) return new Date(Math.min(Math.max(cursor, p.start), maximo)).toISOString();
    cursor = Math.max(cursor, p.end);
  }
  return new Date(Math.min(cursor + resto, maximo)).toISOString();
}

function validarAberta(item, ator, em) {
  nome(ator, 'Responsável');
  if (item.status !== 'Em curso' || item.tarologistFinishReport) erro('Esta consulta já foi encerrada.');
  if (!Number.isFinite(Date.parse(em)) || Date.parse(em) < Date.parse(item.sentToTarologistAt || item.startedAt)) erro('Não foi possível registrar o horário da pausa.');
}

/** `pauseConsultation` (consultation-pause.ts:50). `acesso`: `{ perfil, equipe, tarotIdProprio }` (equipe = `canManageConsultations`). */
function pausar(item, ator, em, acesso) {
  validarAberta(item, ator, em);
  const propriaAguardando = acesso.perfil === 'tarologa' && item.awaitingTarologistStart && acesso.tarotIdProprio === item.tarotId;
  if (!propriaAguardando && !acesso.equipe) erro('Você não tem permissão para pausar esta consulta.');
  if (pausaAtiva(item)) return item;
  const pausa = { id: `pause-${item.id}-${em}`, startedAt: em, startedBy: ator, reason: 'Taróloga pediu tempo', awaitingStart: Boolean(item.awaitingTarologistStart) };
  return { ...item, pauseHistory: [...(item.pauseHistory || []), pausa], updatedAt: em,
    audit: [...item.audit, { id: `audit-${pausa.id}`, action: 'Consulta pausada', actor: ator, createdAt: em, detail: `Taróloga pediu tempo. ${item.awaitingTarologistStart ? 'Consulta aguardando início' : 'Tempo atendido interrompido'}; cliente, vínculo e pagamento preservados.` }] };
}

/** `closeConsultationPause` (consultation-pause.ts:61). */
function fecharPausa(item, ator, em, motivoFim = 'finished') {
  const ps = item.pauseHistory || [];
  let pausa;
  for (let i = ps.length - 1; i >= 0; i -= 1) if (!ps[i].endedAt) { pausa = ps[i]; break; }
  if (!pausa) return item;
  if (!Number.isFinite(Date.parse(em)) || Date.parse(em) < Date.parse(pausa.startedAt)) erro('Não foi possível registrar o fim da pausa.');
  return { ...item, pauseHistory: ps.map((p) => (p.id === pausa.id ? { ...p, endedAt: em, endedBy: ator, endReason: motivoFim } : p)) };
}

/** `resumeConsultation` (consultation-pause.ts:70). */
function retomar(item, ator, em) {
  validarAberta(item, ator, em);
  if (!pausaAtiva(item)) return item;
  return { ...fecharPausa(item, ator, em, 'resumed'), updatedAt: em,
    audit: [...item.audit, { id: `audit-${item.id}-resume-${em}`, action: 'Consulta retomada', actor: ator, createdAt: em, detail: item.awaitingTarologistStart ? 'Pausa encerrada; a mesma consulta continua aguardando início.' : 'Consulta retomada; intervalo da pausa excluído do tempo atendido.' }] };
}

/** `consultationOccupancyConflicts` (tarologist-consultation-session.ts:63): aguardando entrega também ocupa; relato enviado não. */
function conflitosDeOcupacao(consultas, tarotId, clienteId, excecaoId, soCorrendo = false, aprovacao = undefined) {
  const liberadas = aprovacao && aprovacao.clientId === clienteId && aprovacao.tarotId === tarotId ? new Set(aprovacao.consultationIds) : new Set();
  return consultas.filter((c) => c.id !== excecaoId && !liberadas.has(c.id) && c.status === 'Em curso' && !c.tarologistFinishReport
    && (!soCorrendo || !c.awaitingTarologistStart) && (c.tarotId === tarotId || c.clientId === clienteId));
}

/** `consultationClockRuns` (tarologist-consultation-session.ts:25), sem a migração (registro novo nunca a tem). */
function relogioCorre(item) {
  return item.status === 'Em curso' && !item.awaitingTarologistStart && !aguardaConferencia(item) && !pausaAtiva(item);
}

/** `pendingFinishCorrection` / `consultationAwaitsFinishReview` (tarologist-finish-report.ts:30-40). */
function correcaoPendente(item) {
  const cs = item.finishCorrections || [];
  for (let i = cs.length - 1; i >= 0; i -= 1) if (cs[i].status === 'pending') return cs[i];
  return undefined;
}
function aguardaConferencia(item) {
  if (!['Em curso', 'Concluída', 'Finalizada pelo tarólogo'].includes(item.status)) return false;
  if (correcaoPendente(item)) return true;
  return (item.status === 'Finalizada pelo tarólogo' || item.status === 'Em curso') && Boolean(item.tarologistFinishReport) && !item.finishReview;
}

/**
 * Relógio do SERVIDOR (D10): a duração de quem está correndo vem do início confirmado, das pausas e do instante da leitura, nunca do
 * `durationSeconds` que o navegador somou. Mesma conta de `advanceConsultationClock` (tarologist-consultation-session.ts:29) a partir do início.
 */
function duracaoNoInstante(item, agoraMs) {
  const pausa = pausaAtiva(item);
  const correndo = relogioCorre(item);
  // Pausada depois de iniciada: o relógio congela no instante da pausa (o tempo atendido não anda).
  const parado = !correndo && item.status === 'Em curso' && !item.awaitingTarologistStart && Boolean(pausa) && !aguardaConferencia(item);
  if (!correndo && !parado) return item.durationSeconds;
  const inicio = Date.parse(item.tarologistStartedAt || item.startedAt);
  const ate = parado ? Date.parse(pausa.startedAt) : agoraMs;
  if (!Number.isFinite(inicio) || !Number.isFinite(ate) || ate <= inicio) return Math.max(0, item.durationSeconds || 0);
  return Math.max(0, Math.floor((ate - inicio) / 1000 - segundosPausadosEntre(item, inicio, ate)));
}

/** `reportedConsultationMinutes` (consultation-billing.ts:13): o tempo físico relatado. */
function minutosRelatados(item) {
  if (item.status === 'Não houve') return 0;
  const base = item.performedDurationSeconds ?? (item.status === 'Finalizada pelo tarólogo' && Number.isFinite(item.tarologistFinishReport && item.tarologistFinishReport.minutes) ? item.tarologistFinishReport.minutes * 60 : item.durationSeconds);
  return Math.max(0, Math.ceil(base / 60));
}

/** `clearTarologistMoreTimeRequest` (tarologist-finish-report.ts:49). */
function limparPedidoDeMaisTempo(c) {
  return { ...c,
    tarologistMoreTimeRequest: c.tarologistMoreTimeRequest ? { ...c.tarologistMoreTimeRequest, active: false } : undefined,
    tarologistFinishReport: c.tarologistFinishReport ? { ...c.tarologistFinishReport, clientWantsMoreTime: false } : undefined };
}

module.exports = {
  minutosRelatados, limparPedidoDeMaisTempo,
  COMISSAO_PADRAO, ESTADOS, PAGAM_REPASSE, CONSOMEM_COBERTURA, RegraConsultaError, erro, texto, nome, observacao,
  limiteDeMinutos, limiteDe, taxaDoPerfil, comissaoParaNova, emAberto, emAndamento, pausaAtiva, segundosPausadosEntre, fimComPausas,
  pausar, fecharPausa, retomar, conflitosDeOcupacao, relogioCorre, correcaoPendente, aguardaConferencia, duracaoNoInstante,
};
