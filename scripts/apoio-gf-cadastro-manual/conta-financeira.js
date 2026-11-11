'use strict';

/** Cadastro -> identidade financeira -> pagamento persistido -> saldo relido.
 * HTTP e Postgres reais/descartáveis; apenas o MySQL legado tem fronteira falsa.
 * Regras financeiras estritas continuam ligadas, sem substituir os leitores da conta.
 */
const assert = require('assert');
const { dados } = require('./ambiente');
const lancamento = require('../../src/gestao-fadas/_comum/dominio/pagamentos-lancamento');
const preco = require('../../src/gestao-fadas/_comum/dominio/pagamentos-preco');
const { PRECOS_PADRAO } = require('../../src/gestao-fadas/_comum/dominio/financeiro-base');

module.exports = async (a, { passo, status }) => {
  const flags = ['GF_FATIA_PAGAMENTOS', 'GF_FINANCEIRO_REGRAS', 'GF_CLIENTES_NOVOS_LEITURA', 'GF_NOVOS_DADOS', 'GESTAO_FADAS_ESCRITA_ENABLED', 'GF_LEGADO_ESCRITA_ENABLED', 'GF_LEGADO_PAGAMENTOS'];
  const anterior = Object.fromEntries(flags.map((flag) => [flag, process.env[flag]]));
  process.env.GF_FATIA_PAGAMENTOS = 'true';
  process.env.GF_FINANCEIRO_REGRAS = 'true';
  let id;
  let resposta;
  let registro;
  let chave;
  const contas = (ids) => a.chamar('GET', `/payments/accounts?ids=${ids.join(',')}`);
  const contar = async (sql, args = []) => Number((await a.sql(sql, args))[0].n);
  const montar = (clientId, nome, valor = 35) => {
    const agora = new Date().toISOString();
    const ref = preco.referenciaDePreco(valor, clientId, agora, PRECOS_PADRAO, { consultations: [], profiles: {}, history: [] }, null, 'PIX');
    return lancamento.criarPagamento({ method: 'PIX', bank: 'Mercado Pago', payerName: nome, authorization: '', note: '', amount: valor.toFixed(2), ...ref },
      { clientId, client: nome }, 'Operadora do navegador', agora, `PG-CMN-${a.chave()}`, undefined, PRECOS_PADRAO);
  };
  try {
    await passo('nova cliente já tem conta financeira sem saldo legado, planilha ou abertura fabricada', async () => {
      const criada = await a.criar(dados({ name: 'Conta Nova', fullName: 'Cliente Conta Nova' })); status(criada, 200);
      id = criada.j.clientId;
      const antes = a.chamadas.leituras;
      const x = await contas([id]); status(x, 200);
      const c = x.j.accounts[id]; assert.ok(c, 'conta da cliente nova precisa existir');
      assert.equal(c.clientId, id); assert.equal(typeof c.clientId, 'string'); assert.equal(c.name, 'Conta Nova');
      assert.equal(c.paymentProfile, 'Pré-pago'); assert.equal(c.openingKnown, true);
      assert.equal(c.openingCents, 0); assert.equal(c.balanceCents, 0); assert.equal(c.receivedCents, 0);
      assert.equal(c.openingSource, 'sem-planilha-zero'); assert.equal(c.openingFrozen, false); assert.equal(c.hasPriorConsultations, false);
      assert.equal(c.firstConsultationAt, undefined); assert.equal(c.migration, undefined);
      assert.equal(a.chamadas.leituras, antes, 'conta nova não pode consultar o MySQL');
      assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_saldos_partida WHERE id_cliente = ?', [id]), 0);
    });
    await passo('pedido misto preserva clientes legadas, limita cada ID à sua fonte e omite inexistentes', async () => {
      assert.ok(id);
      const inicio = a.chamadas.ids.length;
      const x = await contas([id, '900014', '2147483647', id, '999999999']); status(x, 200);
      assert.deepEqual(Object.keys(x.j.accounts).sort(), ['900014', id].sort());
      assert.equal(x.j.accounts['900014'].name, 'Legada Revisão'); assert.equal(x.j.accounts['900014'].hasPriorConsultations, true);
      assert.equal(x.j.accounts[id].hasPriorConsultations, false);
      assert.ok(a.chamadas.ids.slice(inicio).every((v) => Number(v) < 1000000000));
    });
    await passo('contas preservam permissões, sessão e validação de IDs textuais', async () => {
      assert.ok(id);
      for (const role of ['administradora', 'assistente', 'supervisora', 'atendente']) {
        a.como(role); const x = await contas([id]); status(x, 200); assert.ok(x.j.accounts[id]);
      }
      a.como('tarologa'); status(await contas([id]), 403, 'ACCESS_DENIED');
      a.sessao('absent'); status(await contas([id]), 401, 'SESSION_REQUIRED'); a.como();
      for (const invalido of ['0', '2147483648', '1e9', '01000000000', 'cliente']) status(await contas([invalido]), 400, 'INVALID_INPUT');
    });
    await passo('desligar leitura nova omite essas contas sem procurá-las no legado; modo mysql e fatia mantêm travas', async () => {
      assert.ok(id); const antes = a.chamadas.leituras;
      process.env.GF_CLIENTES_NOVOS_LEITURA = 'false';
      try { const x = await contas([id]); status(x, 200); assert.deepEqual(x.j.accounts, {}); assert.equal(a.chamadas.leituras, antes); }
      finally { delete process.env.GF_CLIENTES_NOVOS_LEITURA; }
      process.env.GF_NOVOS_DADOS = 'mysql';
      try { status(await contas([id]), 503); } finally { process.env.GF_NOVOS_DADOS = 'postgres'; }
      process.env.GF_FATIA_PAGAMENTOS = 'false';
      try { status(await contas([id]), 404, 'NOT_FOUND'); } finally { process.env.GF_FATIA_PAGAMENTOS = 'true'; }
    });
    await passo('legado fora do ar não bloqueia conta nova; conta antiga continua acusando indisponibilidade', async () => {
      assert.ok(id); a.chamadas.falharLeitura = true;
      try {
        const antes = a.chamadas.leituras;
        const x = await contas([id]); status(x, 200); assert.ok(x.j.accounts[id]); assert.equal(a.chamadas.leituras, antes);
        status(await contas(['900014']), 503);
      } finally { a.chamadas.falharLeitura = false; }
    });
    await passo('primeiro pagamento da cliente nova usa regra real, grava auditoria e saldo sem acessar o legado', async () => {
      assert.ok(id); chave = a.chave(); registro = montar(id, 'Conta Nova');
      assert.deepEqual(registro.purchase, { amount: 35, minutes: 15, table: 'first', priceVersionId: 'VAL-001' });
      const antes = a.chamadas.leituras;
      a.chamadas.falharLeitura = true;
      try { resposta = await a.chamar('POST', '/payments', { operationKey: chave, record: registro }); status(resposta, 200); }
      finally { a.chamadas.falharLeitura = false; }
      assert.equal(resposta.j.items[0].informedBy, 'Equipe teste manual'); assert.equal(resposta.j.versions[registro.id], 1);
      assert.equal(a.chamadas.leituras, antes);
      const [persistido] = await a.sql('SELECT id_cliente, valor_centavos, legado_id, legado_estado, legado_detalhe FROM gf_pagamentos WHERE id = ?', [registro.id]);
      assert.equal(persistido.id_cliente, id); assert.equal(Number(persistido.valor_centavos), 3500);
      assert.equal(persistido.legado_id, null); assert.equal(persistido.legado_estado, 'nao_espelhada'); assert.match(persistido.legado_detalhe, /sem registro no legado/);
      assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos_eventos WHERE id_pagamento = ?', [registro.id]), 1);
      assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'pagamentos.lancar' AND entidade_id = ?", [registro.id]), 1);
      const x = await contas([id]); status(x, 200); const c = x.j.accounts[id];
      assert.equal(c.openingCents, 0); assert.equal(c.openingFrozen, true); assert.equal(c.balanceCents, 3500);
      assert.equal(c.receivedCents, 3500); assert.equal(c.availableMinutes, 15); assert.equal(c.canLaunch, true);
    });
    await passo('repetir pagamento confirma mesma operação sem dobrar dinheiro, histórico, evento ou auditoria', async () => {
      assert.ok(resposta && resposta.status === 200);
      const replay = await a.chamar('POST', '/payments', { operationKey: chave, record: registro }); status(replay, 200); assert.deepEqual(replay.j, resposta.j);
      const alterada = { ...registro, client: 'Outra identificação' };
      status(await a.chamar('POST', '/payments', { operationKey: chave, record: alterada }), 409, 'OPERATION_KEY_CONFLICT');
      assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos WHERE id_cliente = ?', [id]), 1);
      assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos_eventos WHERE id_pagamento = ?', [registro.id]), 1);
      const lido = await a.chamar('GET', `/payments?clientId=${id}`); status(lido, 200); assert.equal(lido.j.items.length, 1); assert.equal(lido.j.items[0].clientId, id);
      const x = await contas([id]); status(x, 200); assert.equal(x.j.accounts[id].balanceCents, 3500);
    });
    await passo('lançamento recusa ID novo inexistente, escrita desligada e taróloga sem deixar pagamento', async () => {
      const antes = await contar('SELECT COUNT(*) AS n FROM gf_pagamentos');
      status(await a.chamar('POST', '/payments', { operationKey: a.chave(), record: montar('2147483647', 'Inexistente') }), 404, 'CLIENT_NOT_FOUND');
      process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
      try {
        status(await a.chamar('POST', '/payments', { operationKey: a.chave(), record: montar(id, 'Conta Nova') }), 503, 'WRITE_DISABLED');
        status(await contas([id]), 200);
      } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
      a.como('tarologa');
      try { status(await a.chamar('POST', '/payments', { operationKey: a.chave(), record: montar(id, 'Conta Nova') }), 403, 'ACCESS_DENIED'); } finally { a.como(); }
      assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos'), antes);
    });
    await passo('espelho ligado não envia pagamento de cliente nova ao ASP, nem confirmação posterior', async () => {
      const criada = await a.criar(dados({ name: 'Sem Espelho', fullName: 'Cliente Sem Espelho' })); status(criada, 200);
      const legado = require('../../src/gestao-fadas/legado-escrita');
      const espelho = require('../../src/gestao-fadas/features/financeiro-cliente/pagamentos.espelho');
      const original = legado.emTransacao;
      legado.emTransacao = async () => { a.chamadas.escritas += 1; throw new Error('Espelho de cliente nova proibido'); };
      process.env.GF_LEGADO_ESCRITA_ENABLED = 'true'; process.env.GF_LEGADO_PAGAMENTOS = 'true';
      try {
        const r = montar(criada.j.clientId, 'Sem Espelho');
        const x = await a.chamar('POST', '/payments', { operationKey: a.chave(), record: r }); status(x, 200);
        const item = x.j.items[0]; const agora = new Date().toISOString();
        const confirmado = { ...item, confirmation: 'Confirmado', status: 'Informado', updatedAt: agora, updatedBy: 'Equipe teste manual',
          audit: [...item.audit, { id: a.chave(), action: 'Recebimento confirmado', detail: 'recebimento: Informado → Confirmado', actor: 'Equipe teste manual', createdAt: agora }] };
        const revisada = await a.chamar('POST', `/payments/${item.id}/revise`, { operationKey: a.chave(), expectedVersion: 1, record: confirmado });
        status(revisada, 200); assert.equal(revisada.j.items[0].confirmation, 'Confirmado'); assert.equal(revisada.j.versions[item.id], 2);
        assert.equal(await espelho.revisao({}, { legado_estado: 'espelhada', legado_id: '123' }, x.j.items[0], { ...x.j.items[0], confirmation: 'Confirmado' }, a.chave()), null);
        const mudouCliente = await espelho.revisao({}, { legado_estado: 'espelhada', legado_id: '123' }, { ...item, clientId: '900014' }, item, a.chave());
        assert.equal(mudouCliente.estado, 'desatualizada'); assert.equal(mudouCliente.legadoId, '123');
        assert.equal(a.chamadas.escritas, 0);
        const c = await contas([criada.j.clientId]); status(c, 200); assert.equal(c.j.accounts[criada.j.clientId].balanceCents, 3500);
      } finally { legado.emTransacao = original; process.env.GF_LEGADO_ESCRITA_ENABLED = 'false'; delete process.env.GF_LEGADO_PAGAMENTOS; }
    });
    await require('./transferencia')(a, { passo, status, montar, contas });
  } finally {
    a.como(); a.chamadas.falharLeitura = false;
    for (const [flag, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[flag]; else process.env[flag] = valor; }
  }
};
