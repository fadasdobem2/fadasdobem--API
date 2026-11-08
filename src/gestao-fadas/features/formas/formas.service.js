'use strict';

/**
 * `/professional-services` (v711), porte de `handleProfessionalServices` (features/professionals/professional-services-service.ts do front):
 * o dia operacional vem do relógio do SERVIDOR (o navegador nunca grava outro dia) e a identidade, só da sessão. Todos os perfis leem; só a
 * profissional (no próprio cadastro) ou a administradora gravam. Devolve `{ status, corpo }`.
 */

const { operationalDateAt } = require('../../_comum/dominio/operacao-calendario');
const { validateServiceModes, MSG_MODOS } = require('../../_comum/dominio/formas-atendimento');

const PERFIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const ID = /^[\w.-]{1,160}$/;
const r = (status, corpo) => ({ status, corpo });

function validarGravacao(corpo, id, data) {
  const ok = corpo && typeof corpo === 'object' && !Array.isArray(corpo) && Object.keys(corpo).every((k) => ['modes', 'revision', 'date'].includes(k))
    && id && ID.test(id) && corpo.date === data && Number.isSafeInteger(corpo.revision) && corpo.revision >= 0;
  return Boolean(ok);
}

/** `req`: `{ metodo, query, corpo, ator: { accountId, role, tarotId? } | null }`; `deps`: `{ store, agora }`. */
async function tratar(req, { store, agora = Date.now }) {
  const { ator } = req;
  if (!ator) return r(401, { error: 'Entre com sua conta para consultar as formas de atendimento.' });
  if (!PERFIS.includes(ator.role)) return r(403, { error: 'Acesso não autorizado.' });
  if (!store) return r(503, { error: 'As formas de atendimento ainda não estão conectadas ao banco deste ambiente.' });
  const data = operationalDateAt(new Date(agora()));
  const pedido = req.query && req.query.tarotId !== undefined ? `${req.query.tarotId}` : null;
  const id = ator.role === 'tarologa' ? ator.tarotId : pedido;
  if (ator.role === 'tarologa' && (!id || (pedido && pedido !== id))) return r(403, { error: 'Você só pode alterar seu atendimento.' });
  try {
    if (req.metodo === 'GET') return r(200, id ? { date: data, row: await store.read(id, data) } : { date: data, rows: await store.list(data) });
    if (req.metodo !== 'PUT') return r(405, { error: 'Método não permitido.' });
    if (ator.role !== 'tarologa' && ator.role !== 'administradora') return r(403, { error: 'Somente a profissional ou a administração pode alterar as formas de hoje.' });
    if (!validarGravacao(req.corpo, id, data)) return r(409, { error: 'O dia ou as formas mudaram. Reabra o controle para conferir.' });
    const modes = validateServiceModes(req.corpo.modes);
    const row = await store.save({ tarotId: id, date: data, modes, updatedAt: new Date(agora()).toISOString(), updatedBy: ator.accountId }, req.corpo.revision);
    return row ? r(200, { row, date: data }) : r(409, { error: 'As formas de hoje mudaram em outra sessão. Reabra para conferir.' });
  } catch (e) {
    const invalido = e instanceof Error && e.message === MSG_MODOS;
    return r(invalido ? 400 : 503, { error: invalido ? e.message : 'Não foi possível consultar ou salvar as formas de atendimento.' });
  }
}

module.exports = { tratar };
