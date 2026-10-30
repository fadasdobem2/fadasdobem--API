'use strict';

/**
 * Pendências (Maturacao/34): regras PURAS portadas do CÓDIGO do front (`features/painel/pending-workflow-model.ts`), sem banco nem HTTP.
 * O front DERIVA as pendências no navegador (consultas, pagamentos, divergências, agenda); o servidor guarda só o ENCAMINHAMENTO de cada uma
 * (fila, histórico, resolvida) como o front o monta (`PendingRouting`). O servidor confere forma, a transição (quem pode encaminhar para onde,
 * `canTransferPending`) e carimba autor e instante do evento novo; não refaz a derivação (as fontes vivem no navegador).
 * O ouro (`scripts/gerar-ouro-gf-pendencias.js`) roda as funções reais do front e exige que o porte concorde.
 */

class PendenciaInvalidaError extends Error { constructor(m) { super(m); this.name = 'PendenciaInvalidaError'; } }
const falha = (m) => { throw new PendenciaInvalidaError(m); };

const FILAS = ['atendimento', 'supervisao', 'financeiro', 'administracao'];
const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const ACOES = ['forward', 'return', 'resolved', 'reopened'];
const SISTEMA = { id: 'system', name: 'Sistema', role: 'administradora' };
const MOTIVO_RESOLVIDA = 'A pendência deixou de exigir conferência no registro de origem.';
const MOTIVO_REABERTA = 'O registro de origem voltou a exigir conferência.';
const LIMITE_MOTIVO = 1000;
const LIMITE_TEXTO = 4000;

const texto = (v) => typeof v === 'string';
const instante = (v) => texto(v) && Number.isFinite(Date.parse(v));
const chaveDe = (item) => JSON.stringify([item.id, item.occurrence]);
const filaInicial = (s) => (s.tone === 'guidance' ? 'supervisao' : s.tone === 'cancellation' ? 'administracao' : s.financial ? 'financeiro' : 'atendimento');
const visivel = (papel, s) => papel !== 'tarologa' && (s.tone !== 'cancellation' || papel === 'administradora') && (!s.financial || papel === 'administradora' || papel === 'assistente');

/** Espelho de `canTransferPending`. */
function podeEncaminhar(papel, fila, para, financeira = false, tom) {
  if (para === fila || tom === 'cancellation' || tom === 'guidance' || papel === 'tarologa') return false;
  if (para === 'supervisao') return !financeira && fila === 'atendimento' && papel === 'atendente';
  if (para === 'administracao') return (papel === 'assistente' && ['atendimento', 'supervisao', 'financeiro'].includes(fila)) || (!financeira && papel === 'supervisora' && ['atendimento', 'supervisao'].includes(fila));
  if (para === 'financeiro') return financeira && fila === 'administracao' && papel === 'administradora';
  return !financeira && para === 'atendimento' && ((fila === 'supervisao' && ['supervisora', 'assistente', 'administradora'].includes(papel)) || (fila === 'administracao' && papel === 'administradora'));
}

function opcionalTexto(o, campo, max) { if (o[campo] !== undefined && (!texto(o[campo]) || o[campo].length > max)) falha(`Pendência: ${campo} inválido.`); }

function formaSnapshot(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) falha('Pendência: snapshot inválido.');
  for (const [c, max] of [['id', 100], ['occurrence', 100], ['tone', 40], ['title', 300], ['who', 300], ['detail', LIMITE_TEXTO]]) if (!texto(s[c]) || !s[c] || s[c].length > max) falha(`Pendência: ${c} inválido.`);
  if (typeof s.financial !== 'boolean') falha('Pendência: financial inválido.');
  opcionalTexto(s, 'referenceDate', 40);
  return s;
}

function formaEvento(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) falha('Pendência: evento inválido.');
  if (!instante(e.at) || !ACOES.includes(e.action) || !FILAS.includes(e.from) || !FILAS.includes(e.to) || !texto(e.reason) || e.reason.length > LIMITE_TEXTO) falha('Pendência: evento inválido.');
  const a = e.actor;
  if (!a || !texto(a.id) || !texto(a.name) || !PAPEIS.includes(a.role)) falha('Pendência: autor do evento inválido.');
  return e;
}

/** Forma do `PendingRouting` (`key`, `snapshot`, `queue`, `resolvedAt?`, `events`). */
function forma(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) falha('Pendência: registro inválido.');
  const s = formaSnapshot(r.snapshot);
  if (r.key !== chaveDe(s) || r.key.length > 300) falha('Pendência: a chave não corresponde ao registro.');
  if (!FILAS.includes(r.queue)) falha('Pendência: fila inválida.');
  if (r.resolvedAt !== undefined && !instante(r.resolvedAt)) falha('Pendência: resolvedAt inválido.');
  if (!Array.isArray(r.events) || r.events.length > 200) falha('Pendência: histórico inválido.');
  r.events.forEach(formaEvento);
  return r;
}

/** Texto estável (chaves em ordem): o jsonb do Postgres não guarda a ordem das chaves. */
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const igual = (a, b) => estavel(a) === estavel(b);

/**
 * Confere a mudança `antes` (ou null) para `pedido` e devolve o registro CARIMBADO. No máximo um evento novo por gravação.
 * `ator`: `{ id, nome, papel }` da sessão. Evento de encaminhar/devolver vale só pelo ator da sessão; resolvida/reaberta são do Sistema
 * (o navegador deriva da origem) e o servidor só impõe a coerência das filas.
 */
function aplicar(antes, pedido, ator, agora) {
  const p = forma(pedido);
  if (!visivel(ator.papel, p.snapshot)) falha('Seu perfil não pode fazer esse encaminhamento.');
  const eventosAntes = antes ? antes.events : [];
  if (antes) {
    if (antes.key !== p.key) falha('Pendência: a chave não corresponde ao registro.');
    if (!igual(p.events.slice(0, eventosAntes.length), eventosAntes)) falha('Pendência: o histórico só pode crescer.');
  }
  const novos = p.events.slice(eventosAntes.length);
  if (novos.length > 1) falha('Pendência: uma mudança por vez.');
  const filaAntes = antes ? antes.queue : filaInicial(p.snapshot);
  const resolvidaAntes = antes ? antes.resolvedAt : undefined;
  const saida = { key: p.key, snapshot: p.snapshot, queue: p.queue, ...(p.resolvedAt ? { resolvedAt: p.resolvedAt } : {}), events: [...eventosAntes] };
  if (!novos.length) {
    // Sem evento: só a "semente" de orientação ou um snapshot atualizado; fila e situação ficam.
    if (!antes && (p.queue !== filaInicial(p.snapshot) || p.resolvedAt)) falha('Pendência: registro novo sem evento deve estar na fila inicial.');
    if (antes && (p.queue !== antes.queue || p.resolvedAt !== resolvidaAntes)) falha('Pendência: fila e situação só mudam com um evento.');
    return saida;
  }
  const e = novos[0];
  if (e.from !== filaAntes) falha('Esta pendência mudou de responsável. Atualize a lista.');
  if (e.action === 'forward' || e.action === 'return') {
    if (resolvidaAntes) falha('Esta pendência já foi resolvida. Atualize a lista.');
    const motivo = e.reason.trim();
    if (!motivo) falha('Explique o motivo do encaminhamento.');
    if (motivo.length > LIMITE_MOTIVO) falha('Use até 1.000 caracteres no motivo.');
    if (!podeEncaminhar(ator.papel, filaAntes, e.to, p.snapshot.financial, p.snapshot.tone)) falha('Seu perfil não pode fazer esse encaminhamento.');
    if ((e.to === 'supervisao' || e.to === 'administracao') !== (e.action === 'forward')) falha('Pendência: ação incoerente com a fila.');
    if (p.queue !== e.to || p.resolvedAt) falha('Pendência: fila incoerente com o evento.');
    saida.events.push({ at: agora, actor: { id: ator.id, name: ator.nome, role: ator.papel }, action: e.action, from: filaAntes, to: e.to, reason: motivo });
    return saida;
  }
  if (!antes) falha('Pendência: não há o que resolver ou reabrir.');
  if (e.action === 'resolved') {
    if (resolvidaAntes) falha('Esta pendência já foi resolvida. Atualize a lista.');
    if (p.queue !== filaAntes || e.to !== filaAntes || !p.resolvedAt) falha('Pendência: resolução incoerente.');
    saida.resolvedAt = agora;
    saida.events.push({ at: agora, actor: { ...SISTEMA }, action: 'resolved', from: filaAntes, to: filaAntes, reason: MOTIVO_RESOLVIDA });
    return saida;
  }
  if (!resolvidaAntes) falha('Esta pendência não estava resolvida. Atualize a lista.');
  const fila = filaInicial(p.snapshot);
  if (p.queue !== fila || e.to !== fila || p.resolvedAt) falha('Pendência: reabertura incoerente.');
  delete saida.resolvedAt;
  saida.events.push({ at: agora, actor: { ...SISTEMA }, action: 'reopened', from: filaAntes, to: fila, reason: MOTIVO_REABERTA });
  return saida;
}

class PendenciaMudouError extends Error { constructor(m) { super(m); this.name = 'PendenciaMudouError'; } }

module.exports = { PendenciaInvalidaError, PendenciaMudouError, igual, FILAS, filaInicial, chaveDe, visivel, podeEncaminhar, forma, aplicar, MOTIVO_RESOLVIDA, MOTIVO_REABERTA };
