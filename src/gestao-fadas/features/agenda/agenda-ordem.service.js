'use strict';

/**
 * Ordem da fila (Maturacao/28 seção 2.3, `POST /agenda/queues/:tarotId/order`; domínio em `_comum/dominio/agenda-ordem.js`).
 * A API reimplementa a impressão `queue-v1` do front: o comando só vale se a `baseRevision` for a da fila agora (ou descender dela);
 * em conflito entre dois comandos da mesma revisão vence a gestão (supervisora, administradora, assistente) e a atendente é
 * recusada com `agenda.order_rejected`, ambos preservados em `gf_agenda_ordem_comandos`. Mesmo texto de recusa do front:
 * "Não foi possível mover a cliente. Tente arrastar novamente." (`agenda-order-command.ts:21`).
 */

const { chaveDaFila, revisaoDaFila, decidirOrdem } = require('../../_comum/dominio/agenda-ordem');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const store = require('./agenda.store');
const resposta = require('./agenda.resposta');

const MENSAGEM_RECUSA = 'Não foi possível mover a cliente. Tente arrastar novamente.';

async function ordenar(req) {
  const a = comum.ator(req, true);
  const tarotId = validar.idTarologo(req.params.tarotId);
  const c = validar.corpoOrdem(req.body);
  const fila = chaveDaFila(tarotId);
  return comum.gravar(req, a, {
    escopo: 'agenda.ordem', operationKey: c.operationKey, corpo: { ...c, tarotId }, acao: 'agenda.ordem',
    producao: async (ex) => {
      await store.travarFila(ex, tarotId);
      const registros = await store.filaAberta(ex, tarotId);
      const itens = registros.map((r) => r.item);
      const ids = new Set(itens.map((i) => i.id));
      const dosIds = [...c.beforeIds, ...c.afterIds, ...Object.keys(c.ranks), ...(c.movedId ? [c.movedId] : [])];
      if (dosIds.some((id) => !ids.has(id))) throw comum.regra(MENSAGEM_RECUSA);
      const base = { fila, baseRevision: c.baseRevision, movedId: c.movedId, beforeIds: c.beforeIds, afterIds: c.afterIds, lineage: c.lineage, a, operationKey: c.operationKey };
      const decisao = decidirOrdem(itens, tarotId, { id: c.commandId, baseRevision: c.baseRevision, lineage: c.lineage, actorRole: a.perfil });
      const alvoDoEvento = c.movedId || (registros[0] && registros[0].item.id);

      if (decisao.acao === 'recusar') {
        await store.inserirComandoDeOrdem(ex, { ...base, id: c.commandId, status: 'rejected', motivo: decisao.motivo });
        if (alvoDoEvento) {
          const reg = registros.find((r) => r.item.id === alvoDoEvento);
          await store.inserirEvento(ex, { idAgenda: alvoDoEvento, tipo: 'estado', ref: `ordem:${c.commandId}`, a, dados: { codigo: 'agenda.order_rejected', motivo: decisao.motivo, beforeIds: c.beforeIds, afterIds: c.afterIds }, versao: reg.version, operationKey: c.operationKey });
        }
        return {
          entidadeId: tarotId, antes: { fila, revisao: revisaoDaFila(itens, tarotId) }, depois: { aplicada: false, motivo: decisao.motivo, comando: c.commandId },
          resposta: { __recusa: { codigo: 'VERSION_CHANGED', mensagem: MENSAGEM_RECUSA, status: 409 } },
        };
      }

      if (decisao.substitui) await store.marcarComandoSubstituido(ex, decisao.substitui.id);
      const agora = new Date().toISOString();
      const comandoGravado = {
        id: c.commandId, queueKey: fila, baseRevision: c.baseRevision, at: agora, actorId: a.id, actorName: a.nome, actorRole: a.perfil, persisted: true,
        ...(c.movedId ? { movedId: c.movedId } : {}), ...(c.lineage ? { lineage: c.lineage } : {}), beforeIds: c.beforeIds, afterIds: c.afterIds,
      };
      const mudados = [];
      for (const r of registros) {
        const item = { ...r.item, positionOverrides: c.ranks[r.item.id] ? { ...(r.item.positionOverrides || {}), ...c.ranks[r.item.id] } : r.item.positionOverrides, orderCommand: comandoGravado };
        if (item.positionOverrides === undefined) delete item.positionOverrides;
        const versao = r.version + 1;
        await store.atualizar(ex, item, versao);
        mudados.push({ item, version: versao });
      }
      const depois = revisaoDaFila(mudados.map((m) => m.item), tarotId);
      await store.inserirComandoDeOrdem(ex, { ...base, id: c.commandId, status: 'applied', revisaoResultante: depois });
      if (alvoDoEvento) {
        const reg = mudados.find((m) => m.item.id === alvoDoEvento);
        await store.inserirEvento(ex, { idAgenda: alvoDoEvento, tipo: 'estado', ref: `ordem:${c.commandId}`, a, dados: { codigo: 'agenda.reordered', beforeIds: c.beforeIds, afterIds: c.afterIds, substituiu: decisao.substitui ? decisao.substitui.id : undefined }, versao: reg.version, operationKey: c.operationKey });
      }
      return {
        entidadeId: tarotId, antes: { fila, revisao: revisaoDaFila(itens, tarotId) }, depois: { aplicada: true, comando: c.commandId, revisao: depois, ordem: c.afterIds },
        resposta: resposta.gravacao(mudados, mudados.map((m) => m.item), [tarotId]),
      };
    },
  });
}

module.exports = { ordenar, MENSAGEM_RECUSA };
