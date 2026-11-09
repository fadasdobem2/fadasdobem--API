'use strict';

/**
 * reconcile (`GET /lilly/actions/{chave}`) nos três estados e scheduleNotes. A Lilly só aceita `committed === true` (runtime.mjs:457-458); qualquer
 * outra coisa vira `{reconciled:false, requiresReview:true}` e a ação segue incerta. GET com 4xx/5xx NUNCA é `uncertain` (adapters.mjs:9).
 */

const { isDeepStrictEqual } = require('util');
const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, consulta, IntegrationError, avulso, cru, importar }) => {
  const { acao, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  const repo = require(r('src/gestao-fadas/features/lilly/dados/acoes.repo'));
  const { normalizarChave } = require(r('src/gestao-fadas/features/lilly/idempotencia/chave'));
  const { emTransacao } = require(r('src/gestao-fadas/features/lilly/dados/executor'));
  const nota = (suf, extra = {}) => acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9002', sufixo: suf, payload: { scheduleId: 'S-9002-x', text: 'Chego às 19h.', status: 'waiting', expectedAt: '19:00', informationOnly: true, changesSchedule: false, sourceEventId: `umbler:RC-${suf}`, sourceConversationId: 'chat-mara', ...extra } });
  const hoje = (await adapter.snapshot({ id: 'umbler:RC0', type: 'message', actor: 'client', conversationId: 'chat-E', clientId: '900105', at: AGORA.toISOString(), data: {} })).operationalDate;

  log('reconcile (3 estados)');
  await passo('confirmada: {committed:true, result} IGUAL ao da execução (a Lilly completa a ação com esse result)', async () => {
    const a = nota('confirmada');
    const x = await adapter.execute(a);
    const rec = await adapter.reconcile(a);
    conferir('committed === true e mesmo result', rec.committed === true && isDeepStrictEqual(rec.result, x.result), JSON.stringify({ rec, x }));
  });
  await passo('nunca vista: committed:false, state:not_executed (Lilly: requiresReview, sem reenvio automático)', async () => {
    const rec = await adapter.reconcile(acao('schedule', { conversationId: 'chat-E', clientId: '900105', tarologistId: 'afila' }));
    conferir('committed false + not_executed', rec.committed === false && rec.state === 'not_executed', JSON.stringify(rec));
  });
  await passo('recusada definitivamente na execução: também not_executed (nada foi feito)', async () => {
    const a = nota('recusada', { changesSchedule: true });
    const { erro } = await tentar(adapter.execute(a));
    conferir('execute foi 422', erro instanceof IntegrationError && erro.status === 422);
    const rec = await adapter.reconcile(a);
    conferir('not_executed', rec.committed === false && rec.state === 'not_executed');
  });
  await passo('incerta e em andamento: committed:false com state uncertain/pending (nunca committed:true)', async () => {
    const incerta = nota('incerta');
    const pendente = nota('pendente');
    const velha = nota('velha');
    for (const a of [incerta, pendente, velha]) {
      const ch = normalizarChave(a.idempotencyKey);
      await emTransacao((ex) => repo.reservar(ex, { chaveInterna: ch.interna, chaveOriginal: ch.original, hash: 'a'.repeat(64), kind: a.kind }));
    }
    await emTransacao((ex) => repo.marcarIncerta(ex, normalizarChave(incerta.idempotencyKey).interna, { message: 'x' }));
    await consulta("UPDATE gf_lilly_acoes SET atualizado_em = :t WHERE chave_original = :c", { c: velha.idempotencyKey, t: new Date(Date.now() - 10 * 60000).toISOString() });
    const [i, p, v] = [await adapter.reconcile(incerta), await adapter.reconcile(pendente), await adapter.reconcile(velha)];
    conferir('incerta', i.committed === false && i.state === 'uncertain', JSON.stringify(i));
    conferir('em execução recente = pending', p.committed === false && p.state === 'pending', JSON.stringify(p));
    conferir('em execução antiga (> 120 s) = uncertain', v.committed === false && v.state === 'uncertain', JSON.stringify(v));
  });
  await passo('conciliação não executa nada e a chave com ":" e 70+ caracteres atravessa o encodeURIComponent do adaptador', async () => {
    const a = nota('longa');
    conferir('chave longa', a.idempotencyKey.length > 70 && a.idempotencyKey.includes(':'));
    const rec = await adapter.reconcile(a);
    conferir('not_executed (GET não cria linha)', rec.state === 'not_executed' && Number((await consulta('SELECT count(*) AS n FROM gf_lilly_acoes WHERE chave_original = :c', { c: a.idempotencyKey }))[0].n) === 0);
  });

  log('scheduleNotes (GET /lilly/schedule-notes)');
  await passo('devolve {notes:[...]} com os campos que o painel exige (id, tarologistId e date iguais ao pedido, text, at ISO, status)', async () => {
    const a = nota('lista', { status: 'arrived' });
    await adapter.execute(a);
    const x = await adapter.scheduleNotes('9002', hoje);
    conferir('notes é array não vazio', Array.isArray(x.notes) && x.notes.length >= 1);
    conferir('campos obrigatórios por nota (59 seção 2.6)', x.notes.every((n) => n.id && n.tarologistId === '9002' && n.date === hoje && typeof n.text === 'string' && n.text && !Number.isNaN(Date.parse(n.at)) && ['waiting', 'arrived', 'resolved'].includes(n.status)), JSON.stringify(x.notes[0]));
    conferir('só notas gravadas no horário pedido (outro tarólogo e outro dia vêm vazios)', (await adapter.scheduleNotes('9001', '2020-01-01')).notes.length === 0);
  });
  await passo('pedido sem tarologistId/data: 400 definitivo (a tela de horários sempre manda os dois; GET nunca é uncertain)', async () => {
    const { erro } = await tentar(adapter.scheduleNotes('', ''));
    conferir('400 e uncertain:false', erro instanceof IntegrationError && erro.status === 400 && erro.uncertain === false);
  });
};
