'use strict';

/**
 * Verificação OFFLINE (sem banco, sem rede) de `POST /clientes/:id/history-access` (R25): porta as asserções de
 * `tests/real-clients-history-access*.test` da B para `clientes.service.ampliarHistorico` e o controller. A gravação usa
 * `criarAuditoria` sobre um executor falso em memória (gf_auditoria); a escrita real nunca é ligada.
 *
 *   node scripts/verificar-gf-history-access.js
 */

const assert = require('node:assert/strict');

delete process.env.GESTAO_FADAS_ESCRITA_ENABLED;
process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';

const service = require('../src/gestao-fadas/features/clientes/clientes.service');
const controller = require('../src/gestao-fadas/features/clientes/clientes.controller');
const model = require('../src/gestao-fadas/features/clientes/clientes.model');
const { criarAuditoria } = require('../src/gestao-fadas/_comum/auditoria');
const AppError = require('../src/utils/AppError');

let ok = 0;
let falhas = 0;
let fila = Promise.resolve();
function teste(nome, fn) {
  fila = fila.then(async () => {
    try {
      await fn();
      ok += 1;
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas += 1;
      console.log(`  FALHOU  ${nome}\n${e && e.stack}`);
    }
  });
}

const COLUNAS = ['id', 'ocorrido_em', 'ator_conta_id', 'ator_funcao', 'acao', 'entidade', 'entidade_id', 'antes', 'depois', 'motivo', 'operation_key'];
/** gf_auditoria em memória, com chave única em operation_key como a tabela real. `corrida` simula a outra requisição ganhar. */
function bancoFalso({ falharNoInsert = false } = {}) {
  const linhas = [];
  const executor = {
    async execute(sql, v) {
      if (/^INSERT/.test(sql)) {
        if (falharNoInsert) throw Object.assign(new Error('x'), { code: 'ER_DOWN' });
        const linha = Object.fromEntries(COLUNAS.map((c, i) => [c, v[i]]));
        if (linhas.some((l) => l.operation_key === linha.operation_key)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        linhas.push(linha);
        return [{ affectedRows: 1 }];
      }
      const col = /WHERE (\w+) = \?/.exec(sql)[1];
      return [linhas.filter((l) => l[col] === v[0])];
    },
  };
  return { linhas, executor };
}
let seq = 0;
function dependencias(banco, { existe = true } = {}) {
  const auditoria = criarAuditoria(banco.executor, { novoId: () => `grant-${++seq}`, agora: () => Date.parse('2026-10-21T15:30:00.000Z') });
  return { clienteExiste: async () => existe, gravar: (fato, chave) => auditoria.adicionarUmaVez(fato, chave) };
}
const supervisora = { clientId: '10', actor: { accountId: '7', role: 'supervisora' }, sessionId: 'sessao-1' };
const corpo = { reason: '  Conferir cobrança duplicada  ', operationKey: 'k-1' };
const falha = (codigo, status) => (e) => e instanceof AppError && e.statusCode === status && e.dados.codigo === codigo;

teste('grava clients.history.expand em gf_auditoria e devolve 201 { grant: { id, clientId, grantedAt } }', async () => {
  const banco = bancoFalso();
  const r = await service.ampliarHistorico(supervisora, corpo, dependencias(banco));
  assert.deepEqual(r, { grant: { id: 'grant-' + seq, clientId: '10', grantedAt: '2026-10-21T12:30:00' } });
  assert.equal(banco.linhas.length, 1);
  const l = banco.linhas[0];
  assert.deepEqual([l.ator_conta_id, l.ator_funcao, l.acao, l.entidade, l.entidade_id, l.motivo, l.operation_key], ['7', 'supervisora', 'clients.history.expand', 'cliente', '10', 'Conferir cobrança duplicada', 'k-1']);
  assert.equal(l.depois, '{"sessionId":"sessao-1"}');
  assert.equal(l.antes, null);
});

teste('a liberação gravada é aceita pelo GET do histórico (isRealClientHistoryGrantFor) só da mesma conta, função e sessão', async () => {
  const banco = bancoFalso();
  const f = model.planRealClientHistoryGrant(supervisora, corpo.reason).fact;
  const entrada = await criarAuditoria(banco.executor).adicionarUmaVez(f, 'k-x');
  assert.equal(model.isRealClientHistoryGrantFor(entrada, supervisora), true);
  assert.equal(model.isRealClientHistoryGrantFor(entrada, { ...supervisora, sessionId: 'outra' }), false);
  assert.equal(model.isRealClientHistoryGrantFor(entrada, { ...supervisora, clientId: '11' }), false);
  assert.equal(model.isRealClientHistoryGrantFor(entrada, { ...supervisora, actor: { accountId: '8', role: 'supervisora' } }), false);
});

teste('idempotente por operationKey: a mesma chave e o mesmo corpo devolvem a mesma liberação, sem gravar outra', async () => {
  const banco = bancoFalso();
  const dep = dependencias(banco);
  const a = await service.ampliarHistorico(supervisora, corpo, dep);
  const b = await service.ampliarHistorico(supervisora, { reason: 'Conferir cobrança duplicada', operationKey: 'k-1' }, dep);
  assert.deepEqual(b, a);
  assert.equal(banco.linhas.length, 1);
});

teste('a mesma chave com outro corpo, outra sessão ou outra cliente é 409 OPERATION_KEY_CONFLICT', async () => {
  const banco = bancoFalso();
  const dep = dependencias(banco);
  await service.ampliarHistorico(supervisora, corpo, dep);
  const conflito = falha('OPERATION_KEY_CONFLICT', 409);
  await assert.rejects(() => service.ampliarHistorico(supervisora, { ...corpo, reason: 'Outro motivo' }, dep), conflito);
  await assert.rejects(() => service.ampliarHistorico({ ...supervisora, sessionId: 'sessao-2' }, corpo, dep), conflito);
  await assert.rejects(() => service.ampliarHistorico({ ...supervisora, clientId: '11' }, corpo, dep), conflito);
  assert.equal(banco.linhas.length, 1);
  await assert.rejects(() => service.ampliarHistorico(supervisora, { ...corpo, reason: 'x' }, dep), (e) => e.message === 'Esta operação já foi registrada com outros dados. Atualize a página e confira.');
});

teste('corrida: quem perde a chave única recebe a linha da vencedora', async () => {
  const banco = bancoFalso();
  const f = model.planRealClientHistoryGrant(supervisora, corpo.reason).fact;
  let primeira = true;
  const executor = { async execute(sql, v) {
    // Antes da primeira busca por chave, a outra requisição já gravou: o INSERT bate na chave única.
    if (primeira && /^SELECT/.test(sql) && /operation_key/.test(sql)) { primeira = false; await banco.executor.execute(require('../src/gestao-fadas/_comum/auditoria').AUDIT_INSERT, require('../src/gestao-fadas/_comum/auditoria').linhaDeAuditoria(f, { id: 'vencedora', agora: 1, chave: 'k-1' })); return [[]]; }
    return banco.executor.execute(sql, v);
  } };
  const r = await criarAuditoria(executor).adicionarUmaVez(f, 'k-1');
  assert.equal(r.id, 'vencedora');
  assert.equal(banco.linhas.length, 1);
});

teste('erros da B na ordem: função (403), corpo (400), motivo (400), cliente inexistente (404); mensagens de escrita', async () => {
  const banco = bancoFalso();
  const dep = dependencias(banco);
  const dep404 = dependencias(banco, { existe: false });
  for (const role of ['administradora', 'assistente', 'atendente', 'tarologa']) {
    await assert.rejects(() => service.ampliarHistorico({ ...supervisora, actor: { accountId: '7', role } }, corpo, dep), (e) => falha('ACCESS_DENIED', 403)(e) && e.message === 'Esta ação não está disponível para a sua função.');
  }
  const invalido = (e) => falha('INVALID_INPUT', 400)(e) && e.message === 'Confira os dados informados e tente novamente.';
  for (const c of [undefined, null, {}, { reason: 'x' }, { operationKey: 'k' }, { ...corpo, extra: 1 }, { ...corpo, operationKey: '' }, { ...corpo, operationKey: ' k' },
    { ...corpo, operationKey: 'k'.repeat(65) }, { ...corpo, reason: 5 }, { ...corpo, reason: '   ' }, { ...corpo, reason: 'a'.repeat(501) }]) {
    await assert.rejects(() => service.ampliarHistorico(supervisora, c, dep), invalido);
  }
  await service.ampliarHistorico(supervisora, { reason: 'a'.repeat(500), operationKey: 'k'.repeat(64) }, dep); // limites incluídos
  await assert.rejects(() => service.ampliarHistorico(supervisora, corpo, dep404), (e) => falha('CLIENT_NOT_FOUND', 404)(e) && e.message === 'Cadastro de cliente não encontrado.');
  assert.equal(banco.linhas.length, 1);
});

teste('falha da gravação, inclusive a escrita desligada (flag), é 503 e nenhuma liberação', async () => {
  const quebrado = bancoFalso({ falharNoInsert: true });
  await assert.rejects(() => service.ampliarHistorico(supervisora, corpo, dependencias(quebrado)), falha('SERVICE_UNAVAILABLE', 503));
  assert.equal(quebrado.linhas.length, 0);
  // Sem `gravar` injetado: emTransacao REAL; com GESTAO_FADAS_ESCRITA_ENABLED desligada recusa antes de abrir conexão.
  await assert.rejects(() => service.ampliarHistorico(supervisora, corpo, { clienteExiste: async () => true }),
    (e) => falha('SERVICE_UNAVAILABLE', 503)(e) && e.message === 'Não foi possível acessar o serviço. Tente novamente.');
});

teste('sem identificador de sessão a gravação é recusada com 501 (decisão pendente), sem tocar em gf_auditoria', async () => {
  const banco = bancoFalso();
  await assert.rejects(() => service.ampliarHistorico({ ...supervisora, sessionId: null }, corpo, dependencias(banco)), falha('AMPLIACAO_HISTORICO_SEM_SESSAO', 501));
  assert.equal(banco.linhas.length, 0);
});

/* Controller: perfil, id do caminho, sessão e envelope, com o service substituído. */
function chamar(req) {
  return new Promise((resolve) => {
    const res = { status(c) { this.codigo = c; return this; }, json(c) { this.corpo = c; resolve({ res: this }); return this; } };
    controller.ampliarHistorico({ params: {}, body: {}, ...req }, res, (erro) => resolve({ erro }));
  });
}
const reqSupervisora = (extra = {}) => ({ user: { id: 7 }, accessContext: { roleIds: ['supervisora'] }, jwtClaims: { sid: 'sessao-1' }, params: { id: '10' }, body: corpo, ...extra });

teste('controller: 201 no envelope da A; função, ID e sessão vêm do request, nunca do corpo', async () => {
  const original = service.ampliarHistorico;
  const visto = [];
  service.ampliarHistorico = async (ctx, c) => { visto.push([ctx, c]); return { grant: { id: 'g', clientId: ctx.clientId, grantedAt: 'x' } }; };
  try {
    const { res } = await chamar(reqSupervisora());
    assert.equal(res.codigo, 201);
    assert.equal(res.corpo.sucesso, true);
    assert.deepEqual(res.corpo.dados, { grant: { id: 'g', clientId: '10', grantedAt: 'x' } });
    assert.deepEqual(visto[0][0], { clientId: '10', actor: { accountId: '7', role: 'supervisora' }, sessionId: 'sessao-1' });
    assert.deepEqual((await chamar(reqSupervisora({ params: { id: '007' } }))).erro.dados.codigo, 'INVALID_INPUT');
    assert.equal((await chamar(reqSupervisora({ accessContext: { roleIds: ['atendente'] } }))).erro.dados.codigo, 'ACCESS_DENIED');
    assert.equal((await chamar(reqSupervisora({ accessContext: { roleIds: ['marketing'] }, user: { id: 7, role: 'CLIENTE' } }))).erro.statusCode, 403);
    assert.equal(visto.length, 1);
  } finally { service.ampliarHistorico = original; }
});

teste('rota: POST /:id/history-access exige clientes.historico_completo e não responde mais 501 pelo controller', () => {
  const rota = require('../src/gestao-fadas/features/clientes/clientes.routes').stack.find((c) => c.route && c.route.path === '/:id/history-access');
  assert.ok(rota && rota.route.methods.post);
  assert.equal(rota.route.stack.length, 2);
  assert.ok(!/res\.status\(501\)/.test(require('fs').readFileSync(require.resolve('../src/gestao-fadas/features/clientes/clientes.controller'), 'utf8')));
});

fila.then(() => {
  console.log(`\n${ok} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
});
