'use strict';

/** O controller pelo HTTP: 400 para corpo inválido, 200 com o snapshot e 500 SEM detalhe para falha interna. */

module.exports = async ({ r, chamar, conferir, passo }) => {
  console.log('Controller (HTTP)');
  await passo('corpo inválido é 400 INVALID_INPUT (nunca 5xx)', async () => {
    for (const corpo of [{}, { event: 'x' }, { event: [] }, []]) {
      const x = await chamar(corpo);
      conferir(`400 para ${JSON.stringify(corpo)}`, x.status === 400 && x.corpo.error.code === 'INVALID_INPUT');
    }
  });
  await passo('evento válido: 200 com o snapshot do contrato (arrays, relógio, dia operacional) e sem chaves da Lilly', async () => {
    const x = await chamar({ event: { id: 'umbler:E9', type: 'message', conversationId: 'chat-A', at: '2026-11-07T15:00:00Z', data: {} } });
    const s = x.corpo;
    conferir('200', x.status === 200);
    conferir('arrays obrigatórios', ['clients', 'tarologists', 'appointments', 'consultations', 'payments', 'links', 'messages', 'schedules'].every((k) => Array.isArray(s[k])));
    conferir('relógio e dia operacional', typeof s.now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.operationalDate) && s.operationalStartHour === 6 && typeof s.complete === 'boolean');
    conferir('nenhuma chave que só a Lilly acrescenta', ['pausedConversations', 'knowledge', 'instructions', 'config', 'verifiedContactPhone', 'coverage', 'cobertura'].every((k) => !(k in s)));
  });
  await passo('falha interna do conjunto: 500 LILLY_INTERNAL sem detalhe (nem SQL, nem mensagem)', async () => {
    const caminhoServico = r('src/gestao-fadas/features/lilly/contexto/contexto.servico');
    const caminhoController = require.resolve(r('src/gestao-fadas/features/lilly/lilly.controller'));
    const original = require(caminhoServico);
    const controllerOriginal = require.cache[caminhoController];
    delete require.cache[caminhoController];
    require.cache[require.resolve(caminhoServico)].exports = { montarContexto: async () => { throw new Error('SELECT * FROM usuarios WHERE senha = segredo'); }, registrar() {} };
    try {
      const controller = require(caminhoController);
      const express = require('express');
      const app = express();
      app.post('/ctx', express.json(), controller.contexto);
      const srv = await new Promise((res) => { const sv = app.listen(0, '127.0.0.1', () => res(sv)); });
      const erro = console.error; console.error = () => {};
      const resp = await fetch(`http://127.0.0.1:${srv.address().port}/ctx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: { type: 'message' } }) });
      const texto = await resp.text();
      console.error = erro;
      srv.close();
      conferir('500 LILLY_INTERNAL', resp.status === 500 && /LILLY_INTERNAL/.test(texto));
      conferir('sem detalhe do erro', !/SELECT|usuarios|senha|segredo/.test(texto));
    } finally {
      require.cache[require.resolve(caminhoServico)].exports = original;
      delete require.cache[caminhoController];
      if (controllerOriginal) require.cache[caminhoController] = controllerOriginal;
    }
  });
};
