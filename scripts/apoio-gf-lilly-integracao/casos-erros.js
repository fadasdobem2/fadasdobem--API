'use strict';

/**
 * Como a Lilly REAL classifica cada código da NOSSA API (adapters.mjs:9): POST com 5xx = `uncertain:true` (o runtime parqueia a ação e só reconcilia);
 * qualquer 4xx = definitivo (`uncertain:false`, o runtime cancela); GET nunca é incerto. Cada código é PROVOCADO de verdade no servidor.
 */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, fetchImpl, FadasAdapter, IntegrationError, cru, TOKEN, BASE_FALSA }) => {
  const { acao, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  process.env.GF_LILLY_ACOES_ENABLED = 'true';
  const registro = require(r('src/gestao-fadas/features/lilly/acoes/acoes.registro'));
  const a0 = acao('schedule', { conversationId: 'chat-E', clientId: '900105', tarologistId: 'afila', payload: { reason: 'staff_command', confirmed: true, position: 'last', preserveQueue: true } });
  const classe = async (promessa) => { const { erro } = await tentar(promessa); return erro instanceof IntegrationError ? { status: erro.status, uncertain: erro.uncertain } : { status: null, uncertain: null, erro }; };
  const esperado = (x, status, uncertain) => x.status === status && x.uncertain === uncertain;

  log('classificação de erros (IntegrationError real)');
  await passo('401 (token errado) em POST e GET: definitivo, nunca incerto', async () => {
    const ruim = new FadasAdapter({ baseUrl: BASE_FALSA, token: 'token-errado-token-errado-token', fetchImpl });
    conferir('POST execute 401 -> uncertain:false', esperado(await classe(ruim.execute(a0)), 401, false));
    conferir('GET reconcile 401 -> uncertain:false', esperado(await classe(ruim.reconcile(a0)), 401, false));
    const sem = new FadasAdapter({ baseUrl: BASE_FALSA, token: '', fetchImpl });
    conferir('sem Authorization 401', esperado(await classe(sem.snapshot({ type: 'message', conversationId: 'c' })), 401, false));
  });
  await passo('400 (corpo inválido) e 413 (corpo > 2 MB): definitivos', async () => {
    conferir('snapshot sem evento: 400 INVALID_INPUT', esperado(await classe(adapter.request('/lilly/context', 'POST', { conversation: {} })), 400, false));
    conferir('validate sem action.kind: 400', esperado(await classe(adapter.request('/lilly/actions/validate', 'POST', { action: {} })), 400, false));
    const grande = await classe(adapter.validate({ ...a0, payload: { text: 'x'.repeat(2.2 * 1024 * 1024) } }));
    conferir('2,2 MB: 413 definitivo (não vira 5xx)', esperado(grande, 413, false), JSON.stringify(grande));
    const malformado = await cru('POST', '/lilly/context', { texto: '{"event":' });
    conferir('JSON malformado: 400 (não 500)', malformado.status === 400);
  });
  await passo('404 (fatia Lilly desligada) e 405 (método errado): definitivos', async () => {
    conferir('405 em /lilly/actions com GET: método não permitido', (await cru('GET', '/lilly/actions')).status === 405 || (await cru('GET', '/lilly/actions')).status === 404);
    process.env.GF_FATIA_LILLY = 'false';
    conferir('fatia desligada: 404 em POST -> uncertain:false (cancela, não reconcilia)', esperado(await classe(adapter.execute(a0)), 404, false));
    conferir('fatia desligada: 404 em GET', esperado(await classe(adapter.reconcile(a0)), 404, false));
    process.env.GF_FATIA_LILLY = 'true';
  });
  await passo('409 e 422 do executor: definitivos (já exercitados nos casos de ação); 503 de token curto: POST incerto, GET não', async () => {
    const original = process.env.LILLY_SERVICE_TOKEN;
    process.env.LILLY_SERVICE_TOKEN = 'curto';
    conferir('503 LILLY_NOT_CONFIGURED em POST -> uncertain:true', esperado(await classe(adapter.execute(a0)), 503, true));
    conferir('503 em GET -> uncertain:false', esperado(await classe(adapter.reconcile(a0)), 503, false));
    process.env.LILLY_SERVICE_TOKEN = original;
  });
  await passo('500 inesperado: POST validate/execute/context = incerto (a Lilly parqueia a ação como "uncertain" e só reconcilia, sem reenviar)', async () => {
    const def = registro.obter('note');
    const original = def.validar;
    def.validar = async () => { throw new TypeError('falha simulada'); };
    const v = await classe(adapter.validate(acao('note', { conversationId: 'chat-D', clientId: '900104', payload: { text: 'x' } })));
    def.validar = original;
    conferir('validate 500 -> uncertain:true (adapters.mjs:9)', esperado(v, 500, true), JSON.stringify(v));
    const exec = registro.obter('tarologist_schedule_note');
    const orig2 = exec.executar;
    exec.executar = async () => { throw new TypeError('falha simulada no efeito'); };
    const e = await classe(adapter.execute(acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9001', payload: { scheduleId: 'S-1', text: 'x', informationOnly: true, changesSchedule: false, sourceEventId: 'umbler:ERR1' } })));
    exec.executar = orig2;
    conferir('execute 500 -> uncertain:true', esperado(e, 500, true), JSON.stringify(e));
    const rec = await adapter.reconcile(acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9001', payload: { scheduleId: 'S-1', text: 'x', informationOnly: true, changesSchedule: false, sourceEventId: 'umbler:ERR1' } }));
    conferir('reconcile depois do 500: a falha foi desfeita na transação => not_executed (sem efeito, nada a completar)', rec.committed === false, JSON.stringify(rec));
  });
  await passo('rede indisponível (conexão recusada) em POST: incerto; em GET: não', async () => {
    const morto = new FadasAdapter({ baseUrl: BASE_FALSA, token: TOKEN, fetchImpl: () => Promise.reject(new TypeError('fetch failed')) });
    conferir('POST -> uncertain:true', esperado(await classe(morto.execute(a0)), 0, true));
    conferir('GET -> uncertain:false', esperado(await classe(morto.reconcile(a0)), 0, false));
  });
};
