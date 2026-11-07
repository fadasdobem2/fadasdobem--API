'use strict';

/** Flag `GF_LILLY_ACOES_ENABLED` desligada: `FadasAdapter.execute` recebe 403 (IntegrationError definitiva, uncertain:false) e nada é gravado. */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, contar, IntegrationError }) => {
  const { acao, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  log('execute: flag das ações desligada');
  await passo('403 LILLY_ACTIONS_DISABLED: a Lilly vê 4xx definitivo (cancela a ação, não fica incerta) e a API não grava nada', async () => {
    delete process.env.GF_LILLY_ACOES_ENABLED;
    const a = acao('schedule', { conversationId: 'chat-E', clientId: '900105', tarologistId: 'afila', payload: { reason: 'staff_command', confirmed: true, position: 'last', preserveQueue: true } });
    const { erro } = await tentar(adapter.execute(a));
    conferir('IntegrationError status 403, uncertain:false (adapters.mjs:7; runtime.mjs:652 cancelAction)', erro instanceof IntegrationError && erro.status === 403 && erro.uncertain === false, String(erro && erro.message));
    conferir('nenhuma agenda, pagamento ou linha de ação', (await contar('gf_lilly_acoes')) === 0);
  });
  await passo('validate continua respondendo com a flag desligada (a Lilly valida antes de executar)', async () => {
    const a = acao('schedule', { conversationId: 'chat-E', clientId: '900105', tarologistId: 'afila', payload: { reason: 'staff_command', confirmed: true, position: 'last', preserveQueue: true } });
    conferir('allowed true', (await adapter.validate(a)).allowed === true);
  });
  process.env.GF_LILLY_ACOES_ENABLED = 'true';
};
