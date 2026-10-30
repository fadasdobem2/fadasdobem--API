'use strict';

/**
 * Orientação financeira da supervisora (Maturacao/36): porte de `clientes/client-financial-guidance-model.ts` do front
 * (`decideClientFinancialGuidance`, `validClientFinancialGuidance`, `canDecideFinancialGuidance`). O servidor NÃO confia no registro montado pelo
 * navegador (D9): do registro lê só o evento novo (ação, motivo, id e, na autorização, as consultas de partida) e recalcula tudo com o ator da sessão
 * e o relógio do servidor. Mensagens iguais às `throw new Error` do front. Sem banco, sem Express.
 */

const { observacao, nome, RegraConsultaError } = require('./consulta-comum');

class OrientacaoInvalidaError extends Error { constructor(m) { super(m); this.name = 'OrientacaoInvalidaError'; } }
const erro = (m) => { throw new OrientacaoInvalidaError(m); };

const ACOES = ['request', 'require', 'allow-once', 'release', 'close-alert'];
const PAPEIS = ['atendente', 'assistente', 'supervisora', 'administradora'];
/** `canDecideFinancialGuidance`. */
const podeDecidir = (papel) => papel === 'supervisora' || papel === 'administradora';
const instante = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const texto = (fn) => { try { return fn(); } catch (e) { if (e instanceof RegraConsultaError) throw new OrientacaoInvalidaError(e.message); throw e; } };

/** `validClientFinancialGuidance`: forma do registro guardado (revisão, flags, histórico). */
function valida(v) {
  if (!v || typeof v !== 'object') return false;
  return Number.isSafeInteger(v.revision) && v.revision > 0 && typeof v.active === 'boolean' && typeof v.requiresApproval === 'boolean' && typeof v.pendingReview === 'boolean'
    && typeof v.reason === 'string' && typeof v.by === 'string' && instante(v.at) && Array.isArray(v.history)
    && v.history.every((e) => e && typeof e.id === 'string' && ACOES.includes(e.action) && typeof e.reason === 'string' && typeof e.by === 'string' && PAPEIS.includes(e.role) && instante(e.at))
    && (!v.approval || (typeof v.approval.id === 'string' && instante(v.approval.at) && typeof v.approval.by === 'string' && Array.isArray(v.approval.baselineConsultationIds)
      && v.approval.baselineConsultationIds.every((i) => typeof i === 'string')));
}

/** `decideClientFinancialGuidance`, na mesma ordem de conferências do front. */
function decidir(atual, comando, papel, ator, em, id, esperada = atual ? atual.revision : 0) {
  if (papel === 'tarologa') erro('Este encaminhamento está disponível para a equipe.');
  if (!ACOES.includes(comando.action)) erro('Escolha uma orientação válida.');
  if (comando.action !== 'request' && !podeDecidir(papel)) erro('A orientação precisa ser decidida pela supervisora.');
  if (esperada !== (atual ? atual.revision : 0)) erro('A orientação desta cliente mudou. Confira o registro antes de salvar.');
  if (typeof id !== 'string' || !id.trim() || !instante(em)) erro('Não foi possível identificar esta orientação.');
  const by = texto(() => nome(ator, 'Responsável'));
  const reason = texto(() => observacao(comando.reason, 'Motivo da orientação', true));
  if (Array.from(reason).length > 1000) erro('Descreva a orientação em até 1.000 caracteres.');
  if (atual && atual.history.some((e) => e.id === id)) return atual;
  if (comando.action === 'allow-once' && (!Array.isArray(comando.consultationIds) || comando.consultationIds.some((v) => typeof v !== 'string'))) erro('Confira o histórico de consultas antes de autorizar.');
  const exige = comando.action === 'request' || comando.action === 'require' || comando.action === 'allow-once';
  return {
    revision: (atual ? atual.revision : 0) + 1, active: comando.action !== 'close-alert', requiresApproval: exige, pendingReview: comando.action === 'request', reason, at: em, by,
    ...(comando.action === 'allow-once' ? { approval: { id, at: em, by, baselineConsultationIds: [...new Set(comando.consultationIds)] } } : {}),
    history: [...(atual ? atual.history : []), { id, action: comando.action, reason, at: em, by, role: papel }],
  };
}

/**
 * O pedido do front (o registro que a tela deixou) vira UM comando: o evento novo no fim do histórico. O histórico anterior tem de ser o que o
 * servidor guarda (só cresce, no máximo um evento por gravação). Devolve o registro que o SERVIDOR calcula.
 */
function aplicar(atual, pedido, { nome: ator, papel }, agora) {
  if (!valida(pedido)) erro('Confira a orientação.');
  const antes = atual ? atual.history : [];
  if (pedido.history.length !== antes.length + 1) erro('A orientação desta cliente mudou. Confira o registro antes de salvar.');
  const prefixo = antes.every((e, i) => e.id === pedido.history[i].id && e.action === pedido.history[i].action && e.reason === pedido.history[i].reason);
  if (!prefixo) erro('A orientação desta cliente mudou. Confira o registro antes de salvar.');
  const evento = pedido.history[pedido.history.length - 1];
  const ids = pedido.approval && pedido.approval.baselineConsultationIds;
  if (evento.action === 'allow-once' && (ids || []).length > 5000) erro('Confira o histórico de consultas antes de autorizar.');
  const comando = { action: evento.action, reason: evento.reason, ...(evento.action === 'allow-once' ? { consultationIds: ids || [] } : {}) };
  return decidir(atual || undefined, comando, papel, ator, agora, evento.id);
}

module.exports = { OrientacaoInvalidaError, ACOES, podeDecidir, valida, decidir, aplicar };
